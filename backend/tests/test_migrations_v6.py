"""Administrative/accounts upgrade leaves every historical value untouched."""
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


@pytest.fixture
def v5(v4):
    engine, sessions, path = v4
    with engine.begin() as connection:
        database._upgrade_v4_to_v5(connection)
        connection.exec_driver_sql("UPDATE vehicles SET drivers='[\"Conductor original\"]'")
    assert versions(engine) == {1, 2, 3, 4, 5}
    return engine, sessions, path


def test_v6_backup_and_preservation_of_all_old_data(v5):
    engine, sessions, path = v5
    before = original_rows(engine)
    migrate(engine)
    assert_previous_data(engine, before)
    assert versions(engine) == set(range(1, database.SCHEMA_VERSION + 1))
    with sessions() as session:
        vehicle = session.get(Vehicle, 41)
        assert vehicle.drivers == ["Conductor original"]
        assert vehicle.nickname is None and vehicle.registration_state is None
        assert vehicle.verification_period_start is None and vehicle.verification_period_end is None
        assert vehicle.circulation_card_expires_on is None and vehicle.document_alert_days == 30
    with engine.connect() as connection:
        for table in database.V6_TABLES:
            assert connection.exec_driver_sql(f'SELECT COUNT(*) FROM "{table}"').scalar_one() == 0
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
        assert connection.exec_driver_sql("PRAGMA quick_check").scalar_one() == "ok"
    backups = list(path.parent.glob("company.db.pre-v6-*.bak"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as backup:
        assert backup.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall() == [(1,), (2,), (3,), (4,), (5,)]
        assert "nickname" not in [row[1] for row in backup.execute("PRAGMA table_info(vehicles)")]
        assert backup.execute("SELECT drivers FROM vehicles").fetchone()[0] == '["Conductor original"]'
        assert backup.execute("PRAGMA quick_check").fetchone()[0] == "ok"
    migrate(engine)
    assert_previous_data(engine, before)
    assert len(list(path.parent.glob("company.db.pre-v6-*.bak"))) == 1


def test_v6_validation_failure_rolls_back_every_table_and_column(v5, monkeypatch):
    engine, _, _ = v5
    before = original_rows(engine)
    original = database._validate_schema

    def fail(connection, version):
        original(connection, version)
        if version == 6:
            raise RuntimeError("after v6")

    monkeypatch.setattr(database, "_validate_schema", fail)
    with pytest.raises(RuntimeError, match="after v6"):
        migrate(engine)
    assert original_rows(engine) == before
    assert not database.V6_TABLES.intersection(inspect(engine).get_table_names())


def test_v6_backup_failure_prevents_mutation(v5, monkeypatch):
    engine, _, _ = v5
    before = original_rows(engine)

    def fail(*_args):
        raise OSError("backup unavailable")

    monkeypatch.setattr(database, "_backup_sqlite_for_version", fail)
    with pytest.raises(OSError, match="backup unavailable"):
        migrate(engine)
    assert original_rows(engine) == before


def test_concurrent_v5_startups_migrate_once(v5):
    engine, _, path = v5
    other, _ = make_database(f"sqlite:///{path.as_posix()}")
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            assert list(executor.map(migrate, (engine, other))) == [None, None]
        assert versions(engine) == set(range(1, database.SCHEMA_VERSION + 1))
        assert len(list(path.parent.glob("company.db.pre-v6-*.bak"))) == 1
    finally:
        other.dispose()
