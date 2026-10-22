"""Document targets migrate safely from frozen v9 SQLite and PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import sqlite3

import pytest
from sqlalchemy import inspect, select, text

from app import database
from app.database import make_database, migrate
from app.auth_models import CompanyUser
from app.migrate_to_postgres import table_manifest
from app.models import Base, SchemaMigration, Vehicle, VehicleIncident
from app.time_utils import utc_now
from test_migrations_v2 import original_rows, v1, versions
from test_migrations_v4 import v3
from test_migrations_v5 import assert_previous_data, v4
from test_migrations_v6 import v5
from test_migrations_v7 import v6
from test_migrations_v8 import v7
from test_postgres_migration import snapshot
from test_postgres_support import postgres_database


@pytest.fixture
def v9(v7):
    engine, sessions, path = v7
    with engine.begin() as connection:
        database._upgrade_v7_to_v8(connection)
        database._upgrade_v8_to_v9(connection)
        database._validate_schema(connection, 9)
    assert versions(engine) == set(range(1, 10))
    return engine, sessions, path


def test_v10_preserves_all_values_bytes_foreign_keys_and_backups(v9):
    engine, _, path = v9
    before = original_rows(engine)
    migrate(engine)
    assert_previous_data(engine, before)
    with engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT content, document_type FROM vehicle_evidence").one() == (b'\xff\xd8\xff\xd9', None)
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
        assert connection.exec_driver_sql("PRAGMA integrity_check").scalar_one() == "ok"
    assert versions(engine) == set(range(1, 11))
    backups = list(path.parent.glob("company.db.pre-v10-*.bak"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as backup:
        assert backup.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0] == 9
        assert backup.execute("SELECT content FROM vehicle_evidence").fetchone()[0] == b'\xff\xd8\xff\xd9'
        assert "document_type" not in {row[1] for row in backup.execute("PRAGMA table_info(vehicle_evidence)")}
    migrate(engine)
    assert_previous_data(engine, before)
    assert len(list(path.parent.glob("company.db.pre-v10-*.bak"))) == 1


def test_v10_failure_rolls_back_entire_schema_and_keeps_evidence(v9, monkeypatch):
    engine, _, _ = v9
    before = original_rows(engine)
    validate = database._validate_schema

    def fail(connection, version):
        validate(connection, version)
        if version == 10:
            raise RuntimeError("cancel document migration")

    monkeypatch.setattr(database, "_validate_schema", fail)
    with pytest.raises(RuntimeError, match="cancel document"):
        migrate(engine)
    assert original_rows(engine) == before
    assert "vehicle_evidence_v9" not in inspect(engine).get_table_names()


def test_v10_backup_failure_aborts_before_mutation(v9, monkeypatch):
    engine, _, _ = v9
    before = original_rows(engine)

    def fail(*_args):
        raise OSError("backup unavailable")

    monkeypatch.setattr(database, "_backup_sqlite_for_version", fail)
    with pytest.raises(OSError, match="backup unavailable"):
        migrate(engine)
    assert original_rows(engine) == before


def test_v10_unknown_columns_and_indexes_fail_closed(v9):
    engine, _, path = v9
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE INDEX custom_private_evidence ON vehicle_evidence(filename)")
    before = original_rows(engine)
    with pytest.raises(RuntimeError, match="Índices"):
        migrate(engine)
    assert original_rows(engine) == before


def test_v10_multiple_sqlite_startups_do_not_repeat_rebuild(v9):
    engine, _, path = v9
    before = original_rows(engine)

    def startup(_):
        separate, _sessions = make_database(f"sqlite:///{path.as_posix()}")
        try:
            migrate(separate)
        finally:
            separate.dispose()

    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(startup, range(3)))
    assert_previous_data(engine, before)
    assert versions(engine) == set(range(1, 11))
    assert len(list(path.parent.glob("company.db.pre-v10-*.bak"))) == 1


def frozen_postgres_v9(connection):
    metadata = Base.metadata
    metadata.create_all(connection)
    connection.exec_driver_sql("ALTER TABLE vehicle_evidence DROP CONSTRAINT ck_vehicle_evidence_document_type")
    connection.exec_driver_sql("ALTER TABLE vehicle_evidence DROP CONSTRAINT ck_vehicle_evidence_one_target")
    connection.exec_driver_sql("ALTER TABLE vehicle_evidence DROP COLUMN document_type")
    connection.exec_driver_sql(f"ALTER TABLE vehicle_evidence ADD CONSTRAINT legacy_one_target CHECK ({database.LEGACY_EVIDENCE_TARGET_CHECK})")
    connection.execute(SchemaMigration.__table__.insert(), [{"version": number} for number in range(1, 10)])
    connection.execute(Vehicle.__table__.insert().values(
        id=41, vin="1HGCM82633A004352", plate="TST-041-A", model_year=2024, version="Base", body_style="sedan",
        engine="2.0", transmission="AT", drive="FWD", current_km=12345.25, in_service_date=date(2024, 1, 1),
        is_synthetic=True, make="Toyota", model="Corolla", drivers=["Conductor original"],
    ))
    connection.execute(CompanyUser.__table__.insert().values(
        id=51, name="Conductor original", email="original@example.invalid", password_hash="synthetic-original-hash", role="user",
    ))
    connection.execute(VehicleIncident.__table__.insert().values(
        id="original-incident", vehicle_id=41, occurred_on=date(2024, 1, 2), category="documentacion",
        description="Incidencia documental previa", captured_by=51,
    ))
    connection.execute(text("""INSERT INTO vehicle_evidence
        (id, vehicle_id, incident_id, filename, mime_type, content, size_bytes, width, height, notes, captured_at, captured_by)
        VALUES ('original-evidence', 41, 'original-incident', 'original.jpg', 'image/jpeg', :content, 4, 1, 1,
                'Nota histórica', :captured_at, 51)"""), {"content": b'\xff\xd8\xff\xd9', "captured_at": utc_now()})
    database._validate_schema(connection, 9)


def test_postgres_v10_transactional_upgrade_idempotent_and_document_check(postgres_database):
    engine = postgres_database["engine"]
    with engine.begin() as connection:
        frozen_postgres_v9(connection)
        before = {name: table_manifest(connection, table, source_version=9) for name, table in Base.metadata.tables.items()}
    migrate(engine)
    migrate(engine)
    with engine.connect() as connection:
        database._validate_schema(connection, 10)
        assert set(connection.scalars(select(SchemaMigration.version))) == set(range(1, 11))
        checks = {row["name"] for row in inspect(connection).get_check_constraints("vehicle_evidence")}
        assert checks == {"ck_vehicle_evidence_one_target", "ck_vehicle_evidence_document_type"}
        assert {name: table_manifest(connection, table, source_version=9) for name, table in Base.metadata.tables.items()} == before


def test_postgres_v10_failure_rolls_back_column_and_constraints(postgres_database, monkeypatch):
    engine = postgres_database["engine"]
    with engine.begin() as connection:
        frozen_postgres_v9(connection)
        before = {name: table_manifest(connection, table, source_version=9) for name, table in Base.metadata.tables.items()}
    validate = database._validate_schema

    def fail(connection, version):
        validate(connection, version)
        if version == 10:
            raise RuntimeError("cancel PostgreSQL document migration")

    monkeypatch.setattr(database, "_validate_schema", fail)
    with pytest.raises(RuntimeError, match="cancel PostgreSQL"):
        migrate(engine)
    with engine.connect() as connection:
        validate(connection, 9)
        assert "document_type" not in {column["name"] for column in inspect(connection).get_columns("vehicle_evidence")}
        assert set(connection.scalars(select(SchemaMigration.version))) == set(range(1, 10))
        assert {name: table_manifest(connection, table, source_version=9) for name, table in Base.metadata.tables.items()} == before
