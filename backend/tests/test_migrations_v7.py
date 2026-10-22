"""State-specific capture upgrade preserves all v6 values, including private evidence."""
from concurrent.futures import ThreadPoolExecutor
import sqlite3

import pytest
from sqlalchemy import inspect

import app.database as database
from app.database import make_database, migrate
from app.models import Vehicle
from test_migrations_v2 import original_rows, v1, versions
from test_migrations_v4 import v3
from test_migrations_v5 import assert_previous_data, v4
from test_migrations_v6 import v5


@pytest.fixture
def v6(v5):
    engine, sessions, path = v5
    with engine.begin() as connection:
        database._upgrade_v5_to_v6(connection)
        connection.exec_driver_sql("""UPDATE vehicles SET nickname='Unidad original', registration_state='Puebla',
            verification_period_start='2026-07-01', verification_period_end='2026-12-31',
            circulation_card_expires_on='2027-04-30', document_alert_days=45""")
        connection.exec_driver_sql("""INSERT INTO company_users
            VALUES (1, 'Cuenta original', 'original@example.test', 'unchanged-password-digest', 'admin', 1,
                    '2026-07-01', '2026-07-02')""")
        connection.exec_driver_sql("INSERT INTO user_vehicle_assignments VALUES (1, 1, 41)")
        connection.exec_driver_sql("""INSERT INTO user_sessions
            VALUES ('unchanged-session-digest', 1, '2026-07-01', '2026-07-02', NULL)""")
        connection.exec_driver_sql("""INSERT INTO vehicle_incidents
            VALUES ('original-incident', 41, '2026-07-01', 'documentacion', 'Incidencia original', 'abierta',
                    '2026-07-02', 1, 'Seguimiento original', '2026-07-03')""")
        connection.exec_driver_sql("""INSERT INTO vehicle_evidence
            VALUES ('original-evidence', 41, NULL, 'original-incident', 'evidencia.jpg', 'image/jpeg',
                    ?, 4, 1, 1, 'Evidencia original', '2026-07-02', 1)""", (b'\xff\xd8\xff\xd9',))
        database._validate_schema(connection, 6)
    assert versions(engine) == {1, 2, 3, 4, 5, 6}
    return engine, sessions, path


def test_v7_backup_defaults_idempotency_preserve_every_old_value(v6):
    engine, sessions, path = v6
    before = original_rows(engine)
    migrate(engine)
    assert_previous_data(engine, before)
    assert versions(engine) == set(range(1, database.SCHEMA_VERSION + 1))
    with sessions() as session:
        vehicle = session.get(Vehicle, 41)
        assert all(getattr(vehicle, name) is None for name in database.V7_COLUMNS["vehicles"])
        assert vehicle.nickname == "Unidad original" and vehicle.document_alert_days == 45
    with engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT COUNT(*) FROM vehicle_administration_changes").scalar_one() == 0
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
        assert connection.exec_driver_sql("PRAGMA quick_check").scalar_one() == "ok"
    backups = list(path.parent.glob("company.db.pre-v7-*.bak"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as backup:
        assert backup.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall() == [
            (1,), (2,), (3,), (4,), (5,), (6,),
        ]
        assert "vehicle_tax_due_on" not in [row[1] for row in backup.execute("PRAGMA table_info(vehicles)")]
        assert backup.execute("SELECT name FROM sqlite_master WHERE name='vehicle_administration_changes'").fetchall() == []
        assert backup.execute("SELECT content FROM vehicle_evidence").fetchone()[0] == b'\xff\xd8\xff\xd9'
        assert backup.execute("SELECT password_hash FROM company_users").fetchone()[0] == "unchanged-password-digest"
        assert backup.execute("PRAGMA quick_check").fetchone()[0] == "ok"
    migrate(engine)
    assert_previous_data(engine, before)
    assert len(list(path.parent.glob("company.db.pre-v7-*.bak"))) == 1


def test_v7_validation_failure_rolls_back_all_added_columns(v6, monkeypatch):
    engine, _, _ = v6
    before = original_rows(engine)
    original = database._validate_schema

    def fail(connection, version):
        original(connection, version)
        if version == 7:
            raise RuntimeError("after v7")

    monkeypatch.setattr(database, "_validate_schema", fail)
    with pytest.raises(RuntimeError, match="after v7"):
        migrate(engine)
    assert original_rows(engine) == before
    assert not database.V7_COLUMNS["vehicles"].intersection(column["name"] for column in inspect(engine).get_columns("vehicles"))
    assert "vehicle_administration_changes" not in inspect(engine).get_table_names()


def test_v7_failed_backup_prevents_mutation(v6, monkeypatch):
    engine, _, _ = v6
    before = original_rows(engine)

    def fail(*_args):
        raise OSError("backup unavailable")

    monkeypatch.setattr(database, "_backup_sqlite_for_version", fail)
    with pytest.raises(OSError, match="backup unavailable"):
        migrate(engine)
    assert original_rows(engine) == before


def test_v7_refuses_unknown_legacy_columns_before_backup(v6):
    engine, _, path = v6
    with engine.begin() as connection:
        connection.exec_driver_sql("ALTER TABLE vehicles ADD COLUMN company_private_data TEXT")
    before = original_rows(engine)
    with pytest.raises(RuntimeError, match="Esquema desconocido"):
        migrate(engine)
    assert original_rows(engine) == before
    assert list(path.parent.glob("company.db.pre-v7-*.bak")) == []


def test_concurrent_v6_startups_migrate_once(v6):
    engine, _, path = v6
    other, _ = make_database(f"sqlite:///{path.as_posix()}")
    before = original_rows(engine)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            assert list(executor.map(migrate, (engine, other))) == [None, None]
        assert versions(engine) == set(range(1, database.SCHEMA_VERSION + 1))
        assert_previous_data(engine, before)
        assert len(list(path.parent.glob("company.db.pre-v7-*.bak"))) == 1
    finally:
        other.dispose()
