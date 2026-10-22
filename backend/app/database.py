"""Migración inicial no destructiva; nunca se ejecuta seed automáticamente."""
from pathlib import Path
import re

from sqlalchemy import create_engine, event, inspect, select, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from .models import Base, SchemaMigration

SCHEMA_VERSION = 2


def make_database(database_url: str) -> tuple[Engine, sessionmaker]:
    url = make_url(database_url)
    options = {}
    if url.get_backend_name() == "sqlite":
        options["connect_args"] = {"check_same_thread": False, "timeout": 30}
        if url.database in (None, "", ":memory:"):
            options["poolclass"] = StaticPool
        else:
            Path(url.database).resolve().parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(database_url, **options)
    if url.get_backend_name() == "sqlite":
        @event.listens_for(engine, "connect")
        def set_sqlite_pragmas(connection, _record):
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA busy_timeout=30000")
    return engine, sessionmaker(engine, expire_on_commit=False)


def _sqlite_upgrade_v1_to_v2(engine: Engine) -> None:
    """Rebuild just the constrained table, retaining rows and all references.

    SQLite cannot drop the former 2021..2026 CHECK constraint in place.  The
    ids copied below are preserved, so readings, history, evaluations, alerts,
    visits and notifications continue to point to the same units.
    """
    with engine.connect() as connection:
        # This pragma must be toggled outside a transaction for SQLite to apply
        # it.  It is always restored, even when the copy fails.
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        connection.commit()
        try:
            with connection.begin():
                connection.exec_driver_sql("""
                    CREATE TABLE vehicles_v2 (
                        id INTEGER NOT NULL PRIMARY KEY,
                        vin VARCHAR(17) NOT NULL UNIQUE,
                        plate VARCHAR(16) NOT NULL UNIQUE,
                        make VARCHAR(80) NOT NULL,
                        model VARCHAR(80) NOT NULL,
                        model_year INTEGER NOT NULL,
                        variant_id VARCHAR(80),
                        maintenance_catalog VARCHAR(80),
                        version VARCHAR(80) NOT NULL,
                        body_style VARCHAR(20) NOT NULL,
                        engine VARCHAR(20) NOT NULL,
                        transmission VARCHAR(30) NOT NULL,
                        drive VARCHAR(30) NOT NULL,
                        fuel_type VARCHAR(40) NOT NULL DEFAULT '',
                        color VARCHAR(40) NOT NULL DEFAULT '',
                        current_km FLOAT NOT NULL,
                        in_service_date DATE NOT NULL,
                        usage_regime VARCHAR(10) NOT NULL,
                        is_synthetic BOOLEAN NOT NULL,
                        CONSTRAINT ck_vehicles_current_km_nonnegative CHECK (current_km >= 0),
                        CONSTRAINT ck_vehicles_model_year_range CHECK (model_year BETWEEN 1886 AND 2100)
                    )
                """)
                connection.exec_driver_sql("""
                    INSERT INTO vehicles_v2 (
                        id, vin, plate, make, model, model_year, variant_id,
                        maintenance_catalog, version, body_style, engine,
                        transmission, drive, fuel_type, color, current_km,
                        in_service_date, usage_regime, is_synthetic
                    )
                    SELECT
                        id, vin, plate, 'Mazda', 'Mazda3', model_year, variant_id,
                        'mazda3-mx.v0.1.0', version, body_style, engine,
                        transmission, drive, '', '', current_km,
                        in_service_date, usage_regime, is_synthetic
                    FROM vehicles
                """)
                connection.exec_driver_sql("DROP TABLE vehicles")
                connection.exec_driver_sql("ALTER TABLE vehicles_v2 RENAME TO vehicles")
                connection.execute(SchemaMigration.__table__.insert().values(version=2))
        finally:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")


def _postgres_upgrade_v1_to_v2(engine: Engine) -> None:
    """Apply the same non-destructive v1 upgrade on PostgreSQL."""
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE vehicles ADD COLUMN make VARCHAR(80) NOT NULL DEFAULT 'Mazda'"))
        connection.execute(text("ALTER TABLE vehicles ADD COLUMN model VARCHAR(80) NOT NULL DEFAULT 'Mazda3'"))
        connection.execute(text("ALTER TABLE vehicles ADD COLUMN maintenance_catalog VARCHAR(80)"))
        connection.execute(text("ALTER TABLE vehicles ADD COLUMN fuel_type VARCHAR(40) NOT NULL DEFAULT ''"))
        connection.execute(text("ALTER TABLE vehicles ADD COLUMN color VARCHAR(40) NOT NULL DEFAULT ''"))
        connection.execute(text("ALTER TABLE vehicles ALTER COLUMN variant_id DROP NOT NULL"))
        connection.execute(text("ALTER TABLE vehicles ALTER COLUMN transmission TYPE VARCHAR(30)"))
        connection.execute(text("ALTER TABLE vehicles ALTER COLUMN drive TYPE VARCHAR(30)"))
        checks = connection.execute(text("""
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = 'vehicles'::regclass
              AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%model_year%'
        """)).scalars()
        for name in checks:
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
                raise RuntimeError("Unexpected model-year constraint name; database unchanged.")
            connection.execute(text(f'ALTER TABLE vehicles DROP CONSTRAINT "{name}"'))
        connection.execute(text("ALTER TABLE vehicles ADD CONSTRAINT ck_vehicles_model_year_range CHECK (model_year BETWEEN 1886 AND 2100)"))
        connection.execute(text("UPDATE vehicles SET maintenance_catalog = 'mazda3-mx.v0.1.0' WHERE maintenance_catalog IS NULL"))
        connection.execute(SchemaMigration.__table__.insert().values(version=2))


def _upgrade_v1_to_v2(engine: Engine) -> None:
    backend = engine.url.get_backend_name()
    if backend == "sqlite":
        _sqlite_upgrade_v1_to_v2(engine)
        return
    if backend == "postgresql":
        _postgres_upgrade_v1_to_v2(engine)
        return
    raise RuntimeError(f"Migration v2 is not implemented for {backend}; database unchanged.")


def _validate_v2_schema(engine: Engine) -> None:
    columns = {column["name"] for column in inspect(engine).get_columns("vehicles")}
    required = {"make", "model", "maintenance_catalog", "fuel_type", "color"}
    missing = required - columns
    if missing:
        raise RuntimeError("Vehicle schema is incomplete; it will not be repaired automatically.")


def migrate(engine: Engine) -> None:
    """001: create schema once; refuse unknown/non-versioned databases.

    Future versions must add an explicit upgrade function. create_all is NOT
    used to pretend existing columns have been migrated. No downgrade/delete.
    """
    tables = set(inspect(engine).get_table_names())
    if tables and "schema_migrations" not in tables:
        raise RuntimeError("Base existente sin versión: use una base nueva o una migración revisada.")
    if "schema_migrations" in tables:
        with engine.connect() as connection:
            versions = set(connection.scalars(select(SchemaMigration.version)))
        if versions == {1}:
            _upgrade_v1_to_v2(engine)
            versions = {1, 2}
        if versions not in ({2}, {1, 2}):
            raise RuntimeError("Versión de base no compatible; se requiere migración explícita.")
        missing = set(Base.metadata.tables) - tables
        if missing:
            raise RuntimeError("Esquema incompleto; no se reparará automáticamente.")
        _validate_v2_schema(engine)
        return
    with engine.begin() as connection:
        Base.metadata.create_all(connection)
        connection.execute(SchemaMigration.__table__.insert(), [{"version": 1}, {"version": SCHEMA_VERSION}])
