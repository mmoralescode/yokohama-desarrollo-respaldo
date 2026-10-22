"""Migration checks use synthetic SQLite snapshots and isolated PostgreSQL schemas."""
from datetime import date, datetime, timedelta, timezone
import hashlib
import sqlite3

import pytest
from sqlalchemy import MetaData, inspect, select, text

from app import database
from app.auth_models import CompanyUser, UserSession, UserVehicleAssignment
from app.database import _validate_schema, make_database, migrate
from app.migrate_to_postgres import MigrationError, main, migrate_sqlite, source_engine, table_manifest, typed_value
from app.models import Base, PlanEvaluation, SchemaMigration, ServiceCatalog, ServiceHistory, Vehicle, VehicleEvidence, VehicleIncident
from test_postgres_support import postgres_database


@pytest.fixture
def snapshot(tmp_path):
    path = tmp_path / "synthetic-snapshot.db"
    engine, sessions = make_database(f"sqlite:///{path.as_posix()}")
    # A real frozen v8 snapshot, not today's ORM schema.
    metadata = MetaData()
    for name, table in Base.metadata.tables.items():
        if name not in database.V9_TABLES and name != "vehicle_evidence":
            table.to_metadata(metadata)
    moment = datetime(2026, 9, 3, 14, 22, 36, 123456, timezone.utc)
    with engine.begin() as connection:
        metadata.create_all(connection)
        database._create_v8_evidence(connection)
        connection.execute(SchemaMigration.__table__.insert(), [{"version": i, "applied_at": moment} for i in range(1, 9)])
    with sessions.begin() as session:
        vehicle = Vehicle(id=41, vin="1HGCM82633A004352", plate="TST-041-A", model_year=2024,
                          version="Base", body_style="sedán", engine="2.0", transmission="AT", drive="FWD",
                          current_km=12345.25, in_service_date=date(2024, 1, 1), is_synthetic=True,
                          make="Toyota", model="Corolla", drivers=["Conductora de prueba"], nickname="Prueba",
                          verification_period_start=None, verification_period_end=None)
        user = CompanyUser(id=51, name="Persona de prueba", email="driver@example.invalid", role="user",
                           password_hash="synthetic-hash-not-a-password", active=True, created_at=moment, updated_at=moment)
        catalog = ServiceCatalog(id="test-service", catalog_version="test-v1", source_snapshot={"a": None, "lista": [1, "México", True]})
        session.add_all([vehicle, user, catalog]); session.flush()
        session.add(UserVehicleAssignment(id=61, user_id=51, vehicle_id=41))
        session.add(UserSession(token_hash="a" * 64, user_id=51, created_at=moment, expires_at=moment + timedelta(days=1)))
        evaluation = PlanEvaluation(id=71, vehicle_id=41, fingerprint="f" * 64, evaluated_at=moment,
                                    catalog_version="test-v1", policy_version="test-policy", inputs_snapshot={"km": 12345.25},
                                    policy_snapshot={"nested": {"a": 1, "b": 2.5}}, catalog_snapshot={"preserve": True},
                                    result={"prediction": {"date": "2026-12-01", "confidence": None}})
        incident = VehicleIncident(id="12345678-1234-1234-1234-123456789012", vehicle_id=41, occurred_on=date(2026, 9, 2),
                                   category="otro", description="Evidencia histórica ficticia", captured_at=moment,
                                   updated_at=moment, captured_by=51)
        session.add_all([evaluation, incident]); session.flush()
        session.add(ServiceHistory(id=81, vehicle_id=41, service_id="test-service", performed_on=date(2026, 9, 2),
                                   odometer_km=None, notes="Captura atrasada", catalog_snapshot={"original": "immutable"},
                                   predicted_due_date=date(2026, 9, 1), prediction_error_days=1, prediction_evaluation_id=71,
                                   cost=0.0, captured_at=moment, maintenance_type="preventive"))
        content = b"\xff\xd8\x00\xff\xfehistorical-image-bytes\xff\xd9"
        session.flush()
        session.connection().exec_driver_sql("""INSERT INTO vehicle_evidence
            (id, vehicle_id, incident_id, filename, mime_type, content, size_bytes, width, height, captured_at, captured_by, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            ("87654321-4321-4321-4321-210987654321", 41, incident.id, "private.jpg", "image/jpeg",
             content, len(content), 16, 16, moment.replace(tzinfo=None).isoformat(), 51, ""))
    with engine.connect() as connection:
        _validate_schema(connection, 8)
        connection.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")
    engine.dispose()
    return path


def test_source_is_read_only_and_typed_digest_preserves_values(snapshot):
    before = hashlib.sha256(snapshot.read_bytes()).hexdigest()
    engine = source_engine(snapshot)
    try:
        with engine.connect() as connection:
            with pytest.raises(Exception):
                connection.exec_driver_sql("DELETE FROM vehicles")
            result = table_manifest(connection, Base.metadata.tables["vehicle_evidence"], sqlite_source=True, source_version=8)
            assert result["rows"] == 1 and len(result["sha256"]) == 64
    finally:
        engine.dispose()
    assert hashlib.sha256(snapshot.read_bytes()).hexdigest() == before


def test_migration_rejects_invalid_raw_booleans_and_numbers():
    with pytest.raises(MigrationError, match="Booleano"):
        typed_value(Vehicle.__table__.c.is_synthetic, 2, sqlite_source=True)
    with pytest.raises(MigrationError, match="Número"):
        typed_value(Vehicle.__table__.c.current_km, float("inf"), sqlite_source=True)
    with pytest.raises(MigrationError, match="nulo"):
        typed_value(Vehicle.__table__.c.plate, None, sqlite_source=True)


def test_cli_rejects_destination_arguments_without_echoing_secret(monkeypatch, capsys):
    monkeypatch.delenv("YOKOHAMA_MIGRATION_DATABASE_URL", raising=False)
    with pytest.raises(SystemExit):
        main(["--source", "none.db", "--database-url", "postgresql://secret-user:secret-password@invalid/db"])
    output = capsys.readouterr()
    assert "secret-password" not in output.err
    assert "secret-user" not in output.err


def test_v9_sqlite_upgrade_is_additive_and_backed_up(snapshot):
    engine, _ = make_database(f"sqlite:///{snapshot.as_posix()}")
    try:
        with engine.connect() as connection:
            original = table_manifest(connection, Base.metadata.tables["vehicle_evidence"], sqlite_source=True, source_version=8)
        migrate(engine)
        migrate(engine)
        with engine.connect() as connection:
            _validate_schema(connection, database.SCHEMA_VERSION)
            assert table_manifest(connection, Base.metadata.tables["vehicle_evidence"], sqlite_source=True, source_version=8) == original
            assert connection.execute(select(SchemaMigration.version)).scalars().all() == list(range(1, database.SCHEMA_VERSION + 1))
            assert connection.exec_driver_sql("SELECT COUNT(*) FROM auth_attempt_counters").scalar_one() == 0
        backups = list(snapshot.parent.glob("synthetic-snapshot.db.pre-v9-*.bak"))
        assert len(backups) == 1
        with sqlite3.connect(backups[0]) as connection:
            assert connection.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0] == 8
            assert connection.execute("SELECT name FROM sqlite_master WHERE name='auth_attempt_counters'").fetchone() is None
    finally:
        engine.dispose()


def test_postgres_import_preserves_all_tables_and_restarts(snapshot, postgres_database):
    before = hashlib.sha256(snapshot.read_bytes()).hexdigest()
    report = migrate_sqlite(snapshot, postgres_database["url"])
    assert report["verified"] is True and len(report["tables"]) == 19
    assert report["source_version"] == 8 and report["destination_version"] == database.SCHEMA_VERSION
    verification = migrate_sqlite(snapshot, postgres_database["url"], verify_only=True)
    assert verification["tables"] == report["tables"]
    engine = postgres_database["engine"]
    migrate(engine)
    migrate(engine)
    with engine.connect() as connection:
        _validate_schema(connection, database.SCHEMA_VERSION)
        assert len(inspect(connection).get_table_names()) == 20
        assert connection.execute(select(Vehicle.id)).scalar_one() == 41
        assert connection.execute(select(VehicleEvidence.content)).scalar_one().startswith(b"\xff\xd8\x00")
        assert connection.execute(select(ServiceHistory.odometer_km)).scalar_one() is None
        assert connection.execute(select(PlanEvaluation.result)).scalar_one()["prediction"]["date"] == "2026-12-01"
        assert connection.execute(select(PlanEvaluation.evaluated_at)).scalar_one().tzinfo is not None
        deferred = connection.execute(text("SELECT condeferrable, condeferred FROM pg_constraint WHERE connamespace=current_schema()::regnamespace AND contype='f'")).all()
        assert deferred and all(row == (True, True) for row in deferred)
    with pytest.raises(MigrationError, match="vacío"):
        migrate_sqlite(snapshot, postgres_database["url"])
    assert hashlib.sha256(snapshot.read_bytes()).hexdigest() == before
    with postgres_database["sessions"].begin() as session:
        next_user = CompanyUser(name="Nueva persona de prueba", email="new@example.invalid", password_hash="synthetic", role="user")
        session.add(next_user); session.flush()
        assert next_user.id == 52


def test_postgres_failure_rolls_back_ddl_and_import(snapshot, postgres_database, monkeypatch):
    import app.migrate_to_postgres as migration
    actual = migration.table_manifest

    def mismatch(connection, table, **kwargs):
        value = actual(connection, table, **kwargs)
        return {**value, "sha256": "0" * 64} if connection.dialect.name == "postgresql" else value

    monkeypatch.setattr(migration, "table_manifest", mismatch)
    with pytest.raises(MigrationError, match="digests"):
        migration.migrate_sqlite(snapshot, postgres_database["url"])
    with postgres_database["engine"].connect() as connection:
        assert inspect(connection).get_table_names() == []
        assert inspect(connection).get_sequence_names() == []


def test_postgres_explicit_revocation_retains_session_rows(snapshot, postgres_database):
    report = migrate_sqlite(snapshot, postgres_database["url"], revoke_sessions=True)
    assert report["revoked_sessions"] == 1
    with postgres_database["engine"].connect() as connection:
        row = connection.execute(select(UserSession)).one()
        assert row.token_hash == "a" * 64 and row.revoked_at is not None


@pytest.mark.parametrize("version", [9, 10])
def test_postgres_imports_v9_and_v10_snapshots(snapshot, postgres_database, version):
    engine, sessions = make_database(f"sqlite:///{snapshot.as_posix()}")
    with engine.begin() as connection:
        database._upgrade_v8_to_v9(connection)
        if version == 10:
            database._upgrade_v9_to_v10(connection)
        _validate_schema(connection, version)
    if version == 10:
        with sessions.begin() as session:
            session.add(VehicleEvidence(id="12345678-9999-4321-4321-210987654321", vehicle_id=41,
                                       document_type="verification", filename="document.jpg", mime_type="image/jpeg",
                                       content=b"synthetic-document", size_bytes=18, width=1, height=1, notes="Visible por unidad", captured_by=51))
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")
    engine.dispose()
    before = hashlib.sha256(snapshot.read_bytes()).hexdigest()
    report = migrate_sqlite(snapshot, postgres_database["url"])
    assert report["source_version"] == version
    assert report["destination_version"] == database.SCHEMA_VERSION
    assert len(report["tables"]) == 20
    assert migrate_sqlite(snapshot, postgres_database["url"], verify_only=True)["tables"] == report["tables"]
    assert hashlib.sha256(snapshot.read_bytes()).hexdigest() == before
    if version == 10:
        with postgres_database["engine"].connect() as connection:
            assert connection.execute(select(VehicleEvidence.document_type).where(
                VehicleEvidence.id == "12345678-9999-4321-4321-210987654321"
            )).scalar_one() == "verification"
