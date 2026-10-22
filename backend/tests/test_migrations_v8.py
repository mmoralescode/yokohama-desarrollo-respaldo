"""Photo associations migrate transactionally without changing historical facts."""
import sqlite3

import pytest
from sqlalchemy import inspect

import app.database as database
from app.database import migrate
from test_migrations_v2 import original_rows, v1, versions
from test_migrations_v4 import v3
from test_migrations_v5 import assert_previous_data, v4
from test_migrations_v6 import v5
from test_migrations_v7 import v6


@pytest.fixture
def v7(v6):
    engine, sessions, path = v6
    with engine.begin() as connection:
        database._upgrade_v6_to_v7(connection)
        database._validate_schema(connection, 7)
    return engine, sessions, path


def test_v8_preserves_photo_bytes_dates_accounts_and_every_old_value(v7):
    engine, _, path = v7
    before = original_rows(engine)
    migrate(engine)
    assert_previous_data(engine, before)
    assert versions(engine) == set(range(1, database.SCHEMA_VERSION + 1))
    with engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
        assert connection.exec_driver_sql("PRAGMA quick_check").scalar_one() == "ok"
        for table in ("odometer_readings", "fault_reports"):
            assert connection.exec_driver_sql(f"SELECT captured_at, captured_by FROM {table}").fetchall()
            assert all(row == (None, None) for row in connection.exec_driver_sql(
                f"SELECT captured_at, captured_by FROM {table}"))
        row = connection.exec_driver_sql("SELECT content, fault_id, service_id, downtime_id FROM vehicle_evidence").one()
        assert row == (b'\xff\xd8\xff\xd9', None, None, None)
    backups = list(path.parent.glob("company.db.pre-v8-*.bak"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as backup:
        assert backup.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0] == 7
        assert backup.execute("SELECT content FROM vehicle_evidence").fetchone()[0] == b'\xff\xd8\xff\xd9'
        assert "fault_id" not in [row[1] for row in backup.execute("PRAGMA table_info(vehicle_evidence)")]
    migrate(engine)
    assert_previous_data(engine, before)
    assert len(list(path.parent.glob("company.db.pre-v8-*.bak"))) == 1


def test_v8_failure_restores_original_evidence_and_schema(v7, monkeypatch):
    engine, _, _ = v7
    before = original_rows(engine)
    validation = database._validate_schema

    def fail(connection, version):
        validation(connection, version)
        if version == 8:
            raise RuntimeError("rollback photo migration")

    monkeypatch.setattr(database, "_validate_schema", fail)
    with pytest.raises(RuntimeError, match="rollback photo migration"):
        migrate(engine)
    assert original_rows(engine) == before
    assert "vehicle_evidence_v7" not in inspect(engine).get_table_names()


def test_v8_backup_failure_leaves_database_unchanged(v7, monkeypatch):
    engine, _, _ = v7
    before = original_rows(engine)

    def fail(*_args):
        raise OSError("cannot create backup")

    monkeypatch.setattr(database, "_backup_sqlite_for_version", fail)
    with pytest.raises(OSError, match="cannot create backup"):
        migrate(engine)
    assert original_rows(engine) == before


def test_v8_unknown_photo_column_fails_before_backup(v7):
    engine, _, path = v7
    with engine.begin() as connection:
        connection.exec_driver_sql("ALTER TABLE vehicle_evidence ADD COLUMN private_original TEXT")
    before = original_rows(engine)
    with pytest.raises(RuntimeError, match="Esquema desconocido"):
        migrate(engine)
    assert original_rows(engine) == before
    assert list(path.parent.glob("company.db.pre-v8-*.bak")) == []
