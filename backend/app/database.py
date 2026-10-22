"""Versioned, transactional migrations. Startup never seeds or erases data."""
from datetime import date, datetime, timezone
from pathlib import Path
import os
import sqlite3
import re
from uuid import uuid4

from sqlalchemy import DateTime, Float, create_engine, event, inspect, select, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from .fleet import MAZDA3_CATALOG_KEY
from .models import (Base, DOCUMENT_EVIDENCE_TARGET_CHECK, DOCUMENT_EVIDENCE_TYPE_CHECK,
                     LEGACY_EVIDENCE_TARGET_CHECK, SchemaMigration)
from . import auth_models  # Register account tables for CLI migrations too.
from .time_utils import date_timestamp

SCHEMA_VERSION = 10
SCHEMA_MIGRATION_LOCK = 6435448733156030290
V2_COLUMNS = {
    "vehicles": {"severity_multiplier"},
    "odometer_readings": {"recorded_at", "source", "time_precision"},
    "service_history": {"cost", "maintenance_type", "fault_id", "predicted_due_date",
                        "prediction_error_days", "prediction_evaluation_id"},
    "fault_reports": {"service_id", "was_predicted"},
}
V3_COLUMNS = {
    "vehicles": {"make", "model", "fuel_type", "color", "maintenance_catalog"},
}
V4_COLUMNS = {"service_history": {"captured_at", "appointment_id"}}
V4_TABLES = {"calendar_appointments", "appointment_changes"}
V5_COLUMNS = {"vehicles": {"drivers"}}
V6_COLUMNS = {"vehicles": {"nickname", "registration_state", "verification_period_start",
                            "verification_period_end", "circulation_card_expires_on", "document_alert_days"}}
V6_TABLES = {"company_users", "user_vehicle_assignments", "user_sessions", "vehicle_incidents", "vehicle_evidence"}
V7_COLUMNS = {"vehicles": {"plates_expires_on", "vehicle_tax_due_on", "vehicle_tax_paid_on", "administrative_notes"}}
V7_TABLES = {"vehicle_administration_changes"}
V8_COLUMNS = {"odometer_readings": {"captured_at", "captured_by"},
              "fault_reports": {"captured_at", "captured_by"},
              "vehicle_evidence": {"fault_id", "service_id", "downtime_id"}}
V9_TABLES = {"auth_attempt_counters"}
V10_COLUMNS = {"vehicle_evidence": {"document_type"}}
# v3 makes a catalog variant optional. It was required in both recognized
# snapshots before v3, so schema inspection cannot compare that legacy column
# to the current ORM nullable flag verbatim.
PRE_V3_NOT_NULL_COLUMNS = {"vehicles": {"variant_id"}}


def _postgres_ca_file() -> str:
    """libpq on Windows may open UTF-8 paths through an ANSI filesystem API."""
    import certifi
    path = certifi.where()
    if os.name != "nt" or path.isascii():
        return path
    import ctypes
    short_path = ctypes.windll.kernel32.GetShortPathNameW
    short_path.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint]
    short_path.restype = ctypes.c_uint
    buffer = ctypes.create_unicode_buffer(32768)
    count = short_path(path, buffer, len(buffer))
    candidate = buffer.value
    if (not count or count >= len(buffer) or not candidate.isascii()
            or not Path(candidate).is_file() or not os.path.samefile(path, candidate)):
        # Fail closed; never substitute an unverified temp CA or weaken TLS.
        raise ValueError("libpq requiere el bundle de CA en una ruta ASCII verificada; instale el entorno en una ruta ASCII.")
    return candidate


def make_database(database_url: str) -> tuple[Engine, sessionmaker]:
    url = make_url(database_url)
    options = {}
    if url.get_backend_name() == "postgresql":
        if url.drivername not in {"postgresql", "postgresql+psycopg"}:
            raise ValueError("PostgreSQL requiere el driver psycopg configurado.")
        if not url.host or not url.database or not url.username or not url.password:
            raise ValueError("La conexión PostgreSQL debe incluir servidor, base y credenciales.")
        # Never inherit weaker TLS or routing overrides from a supplied URL.
        allowed = {"sslmode", "sslrootcert", "channel_binding", "connect_timeout", "application_name", "options"}
        if set(url.query) - allowed:
            raise ValueError("La conexión PostgreSQL contiene opciones no admitidas.")
        if "options" in url.query and not re.fullmatch(r"-csearch_path=yokohama_test_[0-9a-f]{32}", url.query["options"]):
            raise ValueError("Las opciones de PostgreSQL solo admiten un esquema de pruebas aislado.")
        url = url.set(drivername="postgresql+psycopg", query={
            **url.query, "sslmode": "verify-full", "channel_binding": "require",
            "sslrootcert": _postgres_ca_file(), "connect_timeout": "15",
        })
        options.update(pool_pre_ping=True, pool_size=3, max_overflow=2,
                       hide_parameters=True)
    file_sqlite = url.get_backend_name() == "sqlite" and url.database not in (None, "", ":memory:")
    if url.get_backend_name() == "sqlite":
        options["connect_args"] = {"check_same_thread": False, "timeout": 30}
        if not file_sqlite:
            options["poolclass"] = StaticPool
        else:
            Path(url.database).resolve().parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(url, **options)
    if url.get_backend_name() == "sqlite":
        @event.listens_for(engine, "connect")
        def set_sqlite_pragmas(connection, _record):
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA busy_timeout=30000")
            if file_sqlite:
                connection.execute("PRAGMA journal_mode=WAL")
                connection.execute("PRAGMA synchronous=FULL")
    return engine, sessionmaker(engine, expire_on_commit=False)


def _types_match(actual, expected, dialect) -> bool:
    """Keep SQLite's exact check; compare PostgreSQL's reflected physical types."""
    if dialect.name != "postgresql":
        return str(actual).upper() == str(expected.compile(dialect=dialect)).upper()
    if isinstance(expected, DateTime):
        return (isinstance(actual, DateTime) and bool(actual.timezone) == bool(expected.timezone)
                and getattr(actual, "precision", None) in (None, 6))
    actual_sql = str(actual.compile(dialect=dialect)).upper()
    if isinstance(expected, Float) and expected.precision is None:
        # Generic FLOAT is a PostgreSQL double, not REAL or NUMERIC.
        return actual_sql == "DOUBLE PRECISION"
    return actual_sql == str(expected.compile(dialect=dialect)).upper()


def _postgres_reflection(inspector, tables: set[str]) -> dict:
    """Four bulk reflection calls rather than four calls per table."""
    result = {}
    keys = {(None, name) for name in tables}
    for label, method in (
        ("columns", "get_multi_columns"), ("pk", "get_multi_pk_constraint"),
        ("unique", "get_multi_unique_constraints"), ("foreign", "get_multi_foreign_keys"),
    ):
        reflected = getattr(inspector, method)(filter_names=sorted(tables))
        if set(reflected) != keys:
            raise RuntimeError("Reflexión PostgreSQL incompleta; no se cambiará el esquema.")
        result[label] = {name: reflected[(None, name)] for name in tables}
    return result


def _versions(connection) -> set[int]:
    return set(connection.scalars(select(SchemaMigration.version)))


def _validate_schema(connection, version: int) -> None:
    """Fail closed rather than rebuild an unfamiliar table and lose columns."""
    inspector = inspect(connection)
    expected_tables = set(Base.metadata.tables)
    if version < 9:
        expected_tables -= V9_TABLES
    if version < 7:
        expected_tables -= V7_TABLES
    if version < 6:
        expected_tables -= V6_TABLES
    if version < 4:
        expected_tables -= V4_TABLES
    if version == 1:
        expected_tables.remove("downtime_periods")
    if set(inspector.get_table_names()) != expected_tables:
        raise RuntimeError("Esquema incompleto o desconocido; no se reparará automáticamente.")
    bulk = _postgres_reflection(inspector, expected_tables) if connection.dialect.name == "postgresql" else None
    for name in expected_tables:
        model_table = Base.metadata.tables[name]
        unavailable_columns = set()
        if version < 2:
            unavailable_columns.update(V2_COLUMNS.get(name, set()))
        if version < 3:
            unavailable_columns.update(V3_COLUMNS.get(name, set()))
        if version < 4:
            unavailable_columns.update(V4_COLUMNS.get(name, set()))
        if version < 5:
            unavailable_columns.update(V5_COLUMNS.get(name, set()))
        if version < 6:
            unavailable_columns.update(V6_COLUMNS.get(name, set()))
        if version < 7:
            unavailable_columns.update(V7_COLUMNS.get(name, set()))
        if version < 8:
            unavailable_columns.update(V8_COLUMNS.get(name, set()))
        if version < 10:
            unavailable_columns.update(V10_COLUMNS.get(name, set()))
        expected_columns = set(model_table.columns.keys()) - unavailable_columns
        reflected = {column["name"]: column for column in (bulk["columns"][name] if bulk else inspector.get_columns(name))}
        if set(reflected) != expected_columns:
            raise RuntimeError(f"Esquema desconocido en {name}; se requiere una migración revisada.")
        for column in expected_columns:
            if not _types_match(reflected[column]["type"], model_table.columns[column].type, connection.dialect):
                raise RuntimeError(f"Tipo de columna desconocido en {name}.{column}.")
            expected_nullable = model_table.columns[column].nullable
            if version < 3 and column in PRE_V3_NOT_NULL_COLUMNS.get(name, set()):
                expected_nullable = False
            if version < 4 and name == "service_history" and column == "odometer_km":
                expected_nullable = False
            if reflected[column]["nullable"] != expected_nullable:
                raise RuntimeError(f"Nulabilidad desconocida en {name}.{column}.")
        reflected_pk = bulk["pk"][name] if bulk else inspector.get_pk_constraint(name)
        if tuple(reflected_pk["constrained_columns"]) != tuple(model_table.primary_key.columns.keys()):
            raise RuntimeError(f"Clave primaria desconocida en {name}.")
        expected_unique = {
            tuple(constraint.columns.keys()) for constraint in model_table.constraints
            if constraint.__class__.__name__ == "UniqueConstraint"
        }
        if name == "odometer_readings" and version == 1:
            expected_unique = {("vehicle_id", "date")}
        reflected_unique = bulk["unique"][name] if bulk else inspector.get_unique_constraints(name)
        actual_unique = {tuple(constraint["column_names"]) for constraint in reflected_unique}
        if actual_unique != expected_unique:
            raise RuntimeError(f"Restricciones de unicidad desconocidas en {name}.")
        expected_foreign = {
            (tuple(constraint.column_keys), tuple(element.column.table.name for element in constraint.elements),
             tuple(element.column.name for element in constraint.elements))
            for constraint in model_table.foreign_key_constraints
            if set(constraint.column_keys) <= expected_columns
        }
        reflected_foreign = bulk["foreign"][name] if bulk else inspector.get_foreign_keys(name)
        actual_foreign = {
            (tuple(constraint["constrained_columns"]), (constraint["referred_table"],) * len(constraint["referred_columns"]),
             tuple(constraint["referred_columns"]))
            for constraint in reflected_foreign
        }
        if actual_foreign != expected_foreign:
            raise RuntimeError(f"Claves foráneas desconocidas en {name}.")
    if version >= 8:
        if version < 10:
            _legacy_evidence_check(connection)
        else:
            checks = {check["name"]: check["sqltext"] for check in inspector.get_check_constraints("vehicle_evidence")}
            if set(checks) != {"ck_vehicle_evidence_one_target", "ck_vehicle_evidence_document_type"}:
                raise RuntimeError("Restricciones documentales desconocidas; se requiere revisión.")
            if _check_tokens(checks["ck_vehicle_evidence_one_target"]) != _check_tokens(DOCUMENT_EVIDENCE_TARGET_CHECK):
                raise RuntimeError("Asociación documental desconocida; se requiere revisión.")
            if _document_type_expression(checks["ck_vehicle_evidence_document_type"]) != _document_type_expression(DOCUMENT_EVIDENCE_TYPE_CHECK):
                raise RuntimeError("Tipos documentales desconocidos; se requiere revisión.")
    if connection.dialect.name == "sqlite":
        if connection.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='trigger'").first() is not None:
            raise RuntimeError("La base tiene triggers no reconocidos; requiere revisión antes de migrar.")
        if connection.exec_driver_sql("PRAGMA foreign_key_check").first() is not None:
            raise RuntimeError("La base tiene referencias inválidas; no se migrará automáticamente.")


def _backup_sqlite_for_version(engine: Engine, target_version: int) -> Path | None:
    """Online backup API includes committed WAL pages, unlike copying the .db."""
    database = engine.url.database
    if not database or database == ":memory:":
        return None
    source = Path(database).resolve()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    target = source.with_name(f"{source.name}.pre-v{target_version}-{stamp}-{uuid4().hex[:8]}.bak")
    # A failed backup aborts before mutation. Preserve a partial backup for diagnosis.
    with sqlite3.connect(source) as original, sqlite3.connect(target) as backup:
        original.backup(backup)
        if backup.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise RuntimeError("No se pudo verificar el respaldo previo a la migración.")
    return target


def _backup_sqlite(engine: Engine) -> Path | None:
    """Compatibility wrapper used by the documented v1→v2 upgrade."""
    return _backup_sqlite_for_version(engine, 2)


def _backup_sqlite_v3(engine: Engine) -> Path | None:
    return _backup_sqlite_for_version(engine, 3)


def _upgrade_v1_to_v2(connection) -> None:
    """Explicit SQLite upgrade. Caller owns BEGIN IMMEDIATE and the rollback."""
    connection.exec_driver_sql(
        "ALTER TABLE vehicles ADD COLUMN severity_multiplier FLOAT NOT NULL DEFAULT 1 "
        "CHECK (severity_multiplier BETWEEN 0.1 AND 1)"
    )
    additions = {
        "service_history": [
            "cost FLOAT CHECK (cost IS NULL OR (cost >= 0 AND cost < 1e308))",
            "maintenance_type VARCHAR(16) NOT NULL DEFAULT 'unknown' "
            "CHECK (maintenance_type IN ('preventive', 'corrective', 'unknown'))",
            "fault_id INTEGER REFERENCES fault_reports(id)",
            "predicted_due_date DATE",
            "prediction_error_days INTEGER",
            "prediction_evaluation_id INTEGER REFERENCES plan_evaluations(id)",
        ],
        "fault_reports": ["service_id VARCHAR(80) REFERENCES service_catalog(id)", "was_predicted BOOLEAN"],
    }
    for table, columns in additions.items():
        for definition in columns:
            connection.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {definition}")
    # No table references odometer_readings. Foreign keys remain ON throughout.
    connection.exec_driver_sql("""
        CREATE TABLE odometer_readings_v2 (
            id INTEGER NOT NULL PRIMARY KEY,
            vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
            date DATE NOT NULL,
            odometer_km FLOAT NOT NULL CHECK (odometer_km >= 0),
            recorded_at DATETIME NOT NULL,
            source VARCHAR(10) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','gps','obd')),
            time_precision VARCHAR(12) NOT NULL DEFAULT 'date' CHECK (time_precision IN ('date','timestamp')),
            UNIQUE (vehicle_id, recorded_at)
        )
    """)
    previous_count = connection.exec_driver_sql("SELECT COUNT(*) FROM odometer_readings").scalar_one()
    rows = connection.exec_driver_sql("SELECT id, vehicle_id, date, odometer_km FROM odometer_readings ORDER BY id")
    while chunk := rows.fetchmany(1000):
        migrated = []
        for row in chunk:
            # Historical dates never gain fictitious time precision.
            recorded = date_timestamp(date.fromisoformat(row[2])).replace(tzinfo=None)
            migrated.append((*row, recorded.strftime("%Y-%m-%d %H:%M:%S.%f"), "manual", "date"))
        connection.exec_driver_sql("INSERT INTO odometer_readings_v2 VALUES (?, ?, ?, ?, ?, ?, ?)", migrated)
    if connection.exec_driver_sql("SELECT COUNT(*) FROM odometer_readings_v2").scalar_one() != previous_count:
        raise RuntimeError("El conteo de lecturas no coincide; se canceló la migración.")
    connection.exec_driver_sql("DROP TABLE odometer_readings")
    connection.exec_driver_sql("ALTER TABLE odometer_readings_v2 RENAME TO odometer_readings")
    connection.exec_driver_sql("CREATE INDEX ix_odometer_readings_vehicle_id ON odometer_readings(vehicle_id)")
    Base.metadata.tables["downtime_periods"].create(connection)
    connection.execute(SchemaMigration.__table__.insert().values(version=2))


def _upgrade_v2_to_v3(connection) -> None:
    """Rebuild ``vehicles`` for broader model years and catalog ownership.

    SQLite cannot widen the old model-year CHECK constraint in place. The caller
    disables foreign-key enforcement only while this transaction swaps the
    parent table, after validating all references before and during migration.
    Child table definitions continue to reference ``vehicles`` after the swap.
    """
    connection.exec_driver_sql("""
        CREATE TABLE vehicles_v3 (
            id INTEGER NOT NULL PRIMARY KEY,
            vin VARCHAR(17) NOT NULL,
            plate VARCHAR(16) NOT NULL,
            model_year INTEGER NOT NULL CHECK (model_year BETWEEN 1886 AND 2100),
            variant_id VARCHAR(80),
            version VARCHAR(80) NOT NULL,
            body_style VARCHAR(20) NOT NULL,
            engine VARCHAR(20) NOT NULL,
            transmission VARCHAR(10) NOT NULL,
            drive VARCHAR(10) NOT NULL,
            current_km FLOAT NOT NULL CHECK (current_km >= 0),
            in_service_date DATE NOT NULL,
            usage_regime VARCHAR(10) NOT NULL,
            is_synthetic BOOLEAN NOT NULL,
            severity_multiplier FLOAT NOT NULL DEFAULT 1 CHECK (severity_multiplier BETWEEN 0.1 AND 1),
            make VARCHAR(80),
            model VARCHAR(80),
            fuel_type VARCHAR(40),
            color VARCHAR(40),
            maintenance_catalog VARCHAR(80),
            UNIQUE (vin),
            UNIQUE (plate)
        )
    """)
    previous_count = connection.exec_driver_sql("SELECT COUNT(*) FROM vehicles").scalar_one()
    connection.exec_driver_sql("""
        INSERT INTO vehicles_v3 (
            id, vin, plate, model_year, variant_id, version, body_style, engine,
            transmission, drive, current_km, in_service_date, usage_regime,
            is_synthetic, severity_multiplier, make, model, fuel_type, color,
            maintenance_catalog
        )
        SELECT
            id, vin, plate, model_year, variant_id, version, body_style, engine,
            transmission, drive, current_km, in_service_date, usage_regime,
            is_synthetic, severity_multiplier, ?, ?, NULL, NULL, ?
        FROM vehicles
    """, ("Mazda", "Mazda3", MAZDA3_CATALOG_KEY))
    if connection.exec_driver_sql("SELECT COUNT(*) FROM vehicles_v3").scalar_one() != previous_count:
        raise RuntimeError("El conteo de unidades no coincide; se canceló la migración.")
    connection.exec_driver_sql("DROP TABLE vehicles")
    connection.exec_driver_sql("ALTER TABLE vehicles_v3 RENAME TO vehicles")
    connection.execute(SchemaMigration.__table__.insert().values(version=3))


def _upgrade_v3_to_v4(connection) -> None:
    """Administrative dates stay independent of immutable forecast snapshots."""
    Base.metadata.tables["calendar_appointments"].create(connection)
    Base.metadata.tables["appointment_changes"].create(connection)
    connection.exec_driver_sql("""
        CREATE TABLE service_history_v4 (
            id INTEGER NOT NULL PRIMARY KEY,
            vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
            service_id VARCHAR(80) NOT NULL REFERENCES service_catalog(id),
            performed_on DATE NOT NULL,
            odometer_km FLOAT CHECK (odometer_km >= 0),
            notes TEXT NOT NULL,
            catalog_snapshot JSON NOT NULL,
            cost FLOAT CHECK (cost IS NULL OR (cost >= 0 AND cost < 1e308)),
            maintenance_type VARCHAR(16) NOT NULL DEFAULT 'unknown'
                CHECK (maintenance_type IN ('preventive', 'corrective', 'unknown')),
            fault_id INTEGER REFERENCES fault_reports(id),
            predicted_due_date DATE,
            prediction_error_days INTEGER,
            prediction_evaluation_id INTEGER REFERENCES plan_evaluations(id),
            captured_at DATETIME,
            appointment_id VARCHAR(36) REFERENCES calendar_appointments(id),
            UNIQUE (vehicle_id, service_id, performed_on)
        )
    """)
    count = connection.exec_driver_sql("SELECT COUNT(*) FROM service_history").scalar_one()
    connection.exec_driver_sql("""
        INSERT INTO service_history_v4
        SELECT id, vehicle_id, service_id, performed_on, odometer_km, notes,
               catalog_snapshot, cost, maintenance_type, fault_id,
               predicted_due_date, prediction_error_days, prediction_evaluation_id,
               NULL, NULL FROM service_history
    """)
    if connection.exec_driver_sql("SELECT COUNT(*) FROM service_history_v4").scalar_one() != count:
        raise RuntimeError("El conteo del historial no coincide; se canceló la migración.")
    connection.exec_driver_sql("DROP TABLE service_history")
    connection.exec_driver_sql("ALTER TABLE service_history_v4 RENAME TO service_history")
    connection.exec_driver_sql("CREATE INDEX ix_service_history_vehicle_id ON service_history(vehicle_id)")
    # Only the known synthetic seed identities may be renamed. An operator's
    # plate (even on a synthetic row) is never silently overwritten.
    for index in range(1, 21):
        plate = f"YKH-{100 + index:03d}-A"
        if connection.exec_driver_sql("SELECT 1 FROM vehicles WHERE plate = ?", (plate,)).first():
            continue
        connection.exec_driver_sql(
            "UPDATE vehicles SET plate = ? WHERE is_synthetic = 1 AND vin = ? AND plate = ?",
            (plate, f"DEM{index:014d}", f"DEMO-{index:03d}"),
        )
    connection.execute(SchemaMigration.__table__.insert().values(version=4))


def _upgrade_v4_to_v5(connection) -> None:
    """Add driver assignments without rebuilding or rewriting vehicle records."""
    connection.exec_driver_sql("ALTER TABLE vehicles ADD COLUMN drivers JSON NOT NULL DEFAULT '[]'")
    connection.execute(SchemaMigration.__table__.insert().values(version=5))


def _upgrade_v5_to_v6(connection) -> None:
    """Add administrative data, private evidence and accounts without rewriting history."""
    for definition in (
        "nickname VARCHAR(80)", "registration_state VARCHAR(80)",
        "verification_period_start DATE", "verification_period_end DATE",
        "circulation_card_expires_on DATE",
        "document_alert_days INTEGER NOT NULL DEFAULT 30 CHECK (document_alert_days BETWEEN 1 AND 180)",
    ):
        connection.exec_driver_sql(f"ALTER TABLE vehicles ADD COLUMN {definition}")
    # metadata sorting creates parent tables before their foreign-key children.
    for table in Base.metadata.sorted_tables:
        if table.name in V6_TABLES:
            if table.name == "vehicle_evidence":
                # Keep the published v6 schema exact while later migrations add
                # associations. Creating the current ORM here would skip v8.
                connection.exec_driver_sql("""CREATE TABLE vehicle_evidence (
                    id VARCHAR(36) NOT NULL PRIMARY KEY,
                    vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
                    reading_id INTEGER REFERENCES odometer_readings(id),
                    incident_id VARCHAR(36) REFERENCES vehicle_incidents(id),
                    filename VARCHAR(160) NOT NULL, mime_type VARCHAR(24) NOT NULL,
                    content BLOB NOT NULL, size_bytes INTEGER NOT NULL,
                    width INTEGER NOT NULL, height INTEGER NOT NULL, notes TEXT NOT NULL,
                    captured_at DATETIME NOT NULL, captured_by INTEGER REFERENCES company_users(id),
                    CHECK ((reading_id IS NOT NULL AND incident_id IS NULL) OR
                           (reading_id IS NULL AND incident_id IS NOT NULL))
                )""")
                for name in ("vehicle_id", "reading_id", "incident_id"):
                    connection.exec_driver_sql(f"CREATE INDEX ix_vehicle_evidence_{name} ON vehicle_evidence({name})")
            else:
                table.create(connection)
    connection.execute(SchemaMigration.__table__.insert().values(version=6))


def _upgrade_v6_to_v7(connection) -> None:
    """Add captured state-specific obligations; never infer deadlines or payments."""
    for definition in (
        "plates_expires_on DATE", "vehicle_tax_due_on DATE", "vehicle_tax_paid_on DATE",
        "administrative_notes VARCHAR(1500)",
    ):
        connection.exec_driver_sql(f"ALTER TABLE vehicles ADD COLUMN {definition}")
    Base.metadata.tables["vehicle_administration_changes"].create(connection)
    connection.execute(SchemaMigration.__table__.insert().values(version=7))


def _upgrade_v7_to_v8(connection) -> None:
    """Attribute new captures without inventing authors for historical rows.

    Evidence bytes and all original columns are copied verbatim; only the
    association constraint expands to include faults, services and downtime.
    """
    for table in ("odometer_readings", "fault_reports"):
        connection.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN captured_at DATETIME")
        connection.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN captured_by INTEGER REFERENCES company_users(id)")
    previous_count = connection.exec_driver_sql("SELECT COUNT(*) FROM vehicle_evidence").scalar_one()
    connection.exec_driver_sql("ALTER TABLE vehicle_evidence RENAME TO vehicle_evidence_v7")
    for name in ("vehicle_id", "reading_id", "incident_id"):
        connection.exec_driver_sql(f"DROP INDEX ix_vehicle_evidence_{name}")
    # Keep historical v8 exact even when today's ORM gains future columns.
    _create_v8_evidence(connection)
    columns = "id, vehicle_id, reading_id, incident_id, filename, mime_type, content, size_bytes, width, height, notes, captured_at, captured_by"
    connection.exec_driver_sql(f"INSERT INTO vehicle_evidence ({columns}) SELECT {columns} FROM vehicle_evidence_v7")
    if connection.exec_driver_sql("SELECT COUNT(*) FROM vehicle_evidence").scalar_one() != previous_count:
        raise RuntimeError("El conteo de evidencias no coincide; se canceló la migración.")
    connection.exec_driver_sql("DROP TABLE vehicle_evidence_v7")
    connection.execute(SchemaMigration.__table__.insert().values(version=8))


def _upgrade_v8_to_v9(connection) -> None:
    """Shared login throttling is additive; no accounts or sessions are reset."""
    Base.metadata.tables["auth_attempt_counters"].create(connection)
    connection.execute(SchemaMigration.__table__.insert().values(version=9))


def _create_v8_evidence(connection) -> None:
    connection.exec_driver_sql(f"""CREATE TABLE vehicle_evidence (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
        reading_id INTEGER REFERENCES odometer_readings(id),
        incident_id VARCHAR(36) REFERENCES vehicle_incidents(id),
        fault_id INTEGER REFERENCES fault_reports(id),
        service_id INTEGER REFERENCES service_history(id),
        downtime_id INTEGER REFERENCES downtime_periods(id),
        filename VARCHAR(160) NOT NULL, mime_type VARCHAR(24) NOT NULL,
        content BLOB NOT NULL, size_bytes INTEGER NOT NULL,
        width INTEGER NOT NULL, height INTEGER NOT NULL, notes TEXT NOT NULL,
        captured_at DATETIME NOT NULL, captured_by INTEGER REFERENCES company_users(id),
        CHECK ({LEGACY_EVIDENCE_TARGET_CHECK})
    )""")
    for name in ("vehicle_id", "reading_id", "incident_id", "fault_id", "service_id", "downtime_id"):
        connection.exec_driver_sql(f"CREATE INDEX ix_vehicle_evidence_{name} ON vehicle_evidence({name})")


def _check_tokens(expression: str) -> tuple[str, ...]:
    # PostgreSQL adds harmless parentheses around each IS NOT NULL predicate.
    # CASE sums contain only + and integer equality, so ignoring parentheses
    # cannot change this specific expression's meaning. Retain all operators.
    return tuple(re.findall(r"[a-z_][a-z_0-9]*|[0-9]+|[+*/=<>!-]", expression.lower()))


def _document_type_expression(expression: str) -> str:
    # PostgreSQL renders IN literals as = ANY(ARRAY[...]) with explicit casts.
    value = re.sub(r"::(?:character varying|text)(?:\[\])?", "", expression.lower())
    value = re.sub(r'[\s()"\[\]]', "", value)
    return value.replace("=anyarray", "in")


def _legacy_evidence_check(connection) -> dict:
    checks = inspect(connection).get_check_constraints("vehicle_evidence")
    if len(checks) != 1 or _check_tokens(checks[0]["sqltext"]) != _check_tokens(LEGACY_EVIDENCE_TARGET_CHECK):
        raise RuntimeError("Restricción de evidencia desconocida; no se ampliará automáticamente.")
    return checks[0]


def _upgrade_v9_to_v10(connection) -> None:
    """Private documents gain their own target; preserve every old photo byte."""
    legacy = _legacy_evidence_check(connection)
    if connection.dialect.name == "postgresql":
        if not legacy["name"]:
            raise RuntimeError("La restricción de evidencia no tiene un nombre PostgreSQL verificable.")
        quote = connection.dialect.identifier_preparer.quote
        connection.exec_driver_sql("ALTER TABLE vehicle_evidence ADD COLUMN document_type VARCHAR(20)")
        connection.exec_driver_sql(f"ALTER TABLE vehicle_evidence DROP CONSTRAINT {quote(legacy['name'])}")
        connection.exec_driver_sql(
            f"ALTER TABLE vehicle_evidence ADD CONSTRAINT ck_vehicle_evidence_one_target CHECK ({DOCUMENT_EVIDENCE_TARGET_CHECK})"
        )
        connection.exec_driver_sql(
            f"ALTER TABLE vehicle_evidence ADD CONSTRAINT ck_vehicle_evidence_document_type CHECK ({DOCUMENT_EVIDENCE_TYPE_CHECK})"
        )
    elif connection.dialect.name == "sqlite":
        inspector = inspect(connection)
        expected_indexes = {f"ix_vehicle_evidence_{name}" for name in (
            "vehicle_id", "reading_id", "incident_id", "fault_id", "service_id", "downtime_id"
        )}
        indexes = inspector.get_indexes("vehicle_evidence")
        if ({index["name"] for index in indexes} != expected_indexes or any(
                index["unique"] or index["column_names"] != [index["name"].removeprefix("ix_vehicle_evidence_")]
                or index.get("dialect_options") for index in indexes)):
            raise RuntimeError("Índices de evidencia desconocidos; no se reconstruirá automáticamente.")
        columns = ", ".join(column.name for column in Base.metadata.tables["vehicle_evidence"].columns
                            if column.name != "document_type")
        connection.exec_driver_sql("ALTER TABLE vehicle_evidence RENAME TO vehicle_evidence_v9")
        for name in sorted(expected_indexes):
            connection.exec_driver_sql(f"DROP INDEX {name}")
        Base.metadata.tables["vehicle_evidence"].create(connection)
        connection.exec_driver_sql(f"INSERT INTO vehicle_evidence ({columns}) SELECT {columns} FROM vehicle_evidence_v9")
        for left, right in (("vehicle_evidence", "vehicle_evidence_v9"), ("vehicle_evidence_v9", "vehicle_evidence")):
            mismatch = connection.exec_driver_sql(
                f"SELECT COUNT(*) FROM (SELECT {columns} FROM {left} EXCEPT SELECT {columns} FROM {right})"
            ).scalar_one()
            if mismatch:
                raise RuntimeError("La evidencia no coincide byte por byte; se canceló la migración.")
        connection.exec_driver_sql("DROP TABLE vehicle_evidence_v9")
    else:
        raise RuntimeError("La migración documental requiere SQLite o PostgreSQL.")
    connection.execute(SchemaMigration.__table__.insert().values(version=10))


def migrate(engine: Engine) -> None:
    """Create current schema or atomically upgrade recognized v1 through v9 schemas.

    Unknown versions, altered columns/uniqueness, or broken foreign keys fail
    closed. Existing values are preserved; nullable new fields remain unknown.
    """
    with engine.connect() as connection:
        if engine.dialect.name == "sqlite":
            # Legacy sqlite3 mode otherwise runs each introspection SELECT in a
            # separate snapshot, racing another process's startup migration.
            connection.exec_driver_sql("BEGIN")
        elif engine.dialect.name == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": SCHEMA_MIGRATION_LOCK})
        tables = set(inspect(connection).get_table_names())
        if tables and "schema_migrations" not in tables:
            raise RuntimeError("Base existente sin versión: use una base nueva o una migración revisada.")
        versions = _versions(connection) if tables else set()
        if tables and versions not in tuple(set(range(1, version + 1)) for version in range(1, SCHEMA_VERSION + 1)):
            raise RuntimeError("Versión de base no compatible; se requiere migración explícita.")
        if tables:
            _validate_schema(connection, max(versions))
        connection.rollback()
        if versions == set(range(1, SCHEMA_VERSION + 1)):
            return
        if versions == {1}:
            if engine.dialect.name != "sqlite":
                raise RuntimeError("La migración v1→v2 requiere SQLite; revise el upgrade del otro motor.")
        if versions == {1, 2} and engine.dialect.name != "sqlite":
            raise RuntimeError("La migración v2→v3 requiere SQLite; revise el upgrade del otro motor.")
        if versions == {1, 2, 3} and engine.dialect.name != "sqlite":
            raise RuntimeError("La migración v3→v4 requiere SQLite; revise el upgrade del otro motor.")
        if versions == {1, 2, 3, 4} and engine.dialect.name != "sqlite":
            raise RuntimeError("La migración v4→v5 requiere SQLite; revise el upgrade del otro motor.")
        if versions == {1, 2, 3, 4, 5} and engine.dialect.name != "sqlite":
            raise RuntimeError("La migración v5→v6 requiere SQLite; revise el upgrade del otro motor.")
        if versions == {1, 2, 3, 4, 5, 6} and engine.dialect.name != "sqlite":
            raise RuntimeError("La migración v6→v7 requiere SQLite; revise el upgrade del otro motor.")
        if versions == {1, 2, 3, 4, 5, 6, 7} and engine.dialect.name != "sqlite":
            raise RuntimeError("La migración v7→v8 requiere SQLite; revise el upgrade del otro motor.")
        # Rebuilding the referenced vehicles table needs SQLite foreign keys off
        # before BEGIN. Integrity is validated both before this point and before
        # commit, then enforcement is restored on the pooled connection.
        foreign_keys_disabled = engine.dialect.name == "sqlite" and versions in ({1}, {1, 2})
        if foreign_keys_disabled:
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            connection.commit()
        # Explicit BEGIN prevents sqlite3 legacy mode from committing DDL early.
        if engine.dialect.name == "sqlite":
            connection.exec_driver_sql("BEGIN IMMEDIATE")
        else:
            connection.begin()
            if engine.dialect.name == "postgresql":
                connection.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": SCHEMA_MIGRATION_LOCK})
        try:
            # Another process may have completed startup while we waited.
            current_tables = set(inspect(connection).get_table_names())
            if not current_tables:
                Base.metadata.create_all(connection)
                connection.execute(SchemaMigration.__table__.insert(), [{"version": number} for number in range(1, SCHEMA_VERSION + 1)])
            elif "schema_migrations" not in current_tables:
                raise RuntimeError("Base existente sin versión; se canceló la migración.")
            else:
                current_versions = _versions(connection)
                backup_taken = False
                if current_versions == {1}:
                    _validate_schema(connection, 1)
                    # We hold the write reservation but have changed no data.
                    # A separate reader backs up this committed v1 snapshot;
                    # another startup/writer cannot race the verified backup.
                    _backup_sqlite(engine)
                    _upgrade_v1_to_v2(connection)
                    current_versions = {1, 2}
                    backup_taken = True
                if current_versions == {1, 2}:
                    _validate_schema(connection, 2)
                    if not backup_taken:
                        _backup_sqlite_v3(engine)
                    _upgrade_v2_to_v3(connection)
                    current_versions = {1, 2, 3}
                    backup_taken = True
                if current_versions == {1, 2, 3}:
                    _validate_schema(connection, 3)
                    if not backup_taken:
                        _backup_sqlite_for_version(engine, 4)
                    _upgrade_v3_to_v4(connection)
                    current_versions = {1, 2, 3, 4}
                    backup_taken = True
                if current_versions == {1, 2, 3, 4}:
                    _validate_schema(connection, 4)
                    if not backup_taken:
                        _backup_sqlite_for_version(engine, 5)
                    _upgrade_v4_to_v5(connection)
                    current_versions = {1, 2, 3, 4, 5}
                    backup_taken = True
                if current_versions == {1, 2, 3, 4, 5}:
                    _validate_schema(connection, 5)
                    if not backup_taken:
                        _backup_sqlite_for_version(engine, 6)
                    _upgrade_v5_to_v6(connection)
                    current_versions = {1, 2, 3, 4, 5, 6}
                    backup_taken = True
                if current_versions == {1, 2, 3, 4, 5, 6}:
                    _validate_schema(connection, 6)
                    if not backup_taken:
                        _backup_sqlite_for_version(engine, 7)
                    _upgrade_v6_to_v7(connection)
                    current_versions = {1, 2, 3, 4, 5, 6, 7}
                    backup_taken = True
                if current_versions == {1, 2, 3, 4, 5, 6, 7}:
                    _validate_schema(connection, 7)
                    if not backup_taken:
                        _backup_sqlite_for_version(engine, 8)
                    _upgrade_v7_to_v8(connection)
                    current_versions = set(range(1, 9))
                    backup_taken = True
                if current_versions == set(range(1, 9)):
                    _validate_schema(connection, 8)
                    if engine.dialect.name == "sqlite" and not backup_taken:
                        _backup_sqlite_for_version(engine, 9)
                    _upgrade_v8_to_v9(connection)
                    current_versions = set(range(1, 10))
                    backup_taken = True
                if current_versions == set(range(1, 10)):
                    _validate_schema(connection, 9)
                    if engine.dialect.name == "sqlite" and not backup_taken:
                        _backup_sqlite_for_version(engine, 10)
                    _upgrade_v9_to_v10(connection)
                    current_versions = set(range(1, 11))
                elif current_versions != set(range(1, 11)):
                    raise RuntimeError("La versión cambió durante la migración.")
            _validate_schema(connection, SCHEMA_VERSION)
            if engine.dialect.name == "sqlite" and connection.exec_driver_sql("PRAGMA quick_check").scalar_one() != "ok":
                raise RuntimeError("La verificación de integridad falló; se canceló la migración.")
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            if foreign_keys_disabled:
                # PRAGMA foreign_keys is a no-op inside a transaction, so make
                # absolutely sure a failed DDL transaction is closed first.
                if connection.in_transaction():
                    connection.rollback()
                connection.exec_driver_sql("PRAGMA foreign_keys=ON")
