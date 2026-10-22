"""Verified SQLite snapshot -> empty PostgreSQL database, never modifying source.

Destination credentials are read only from YOKOHAMA_MIGRATION_DATABASE_URL.
python -m app.migrate_to_postgres --source /private/verified-snapshot.db
python -m app.migrate_to_postgres --source /private/verified-snapshot.db --verify-only
The optional --revoke-sessions runs AFTER exact parity, retaining session rows.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import sys
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, JSON, LargeBinary, MetaData, String, create_engine, inspect, select, text, update
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

from .auth_models import UserSession
from .database import SCHEMA_VERSION, SCHEMA_MIGRATION_LOCK, V9_TABLES, V10_COLUMNS, _types_match, _validate_schema, _versions, make_database
from .models import Base, SchemaMigration
from .time_utils import as_utc, utc_now


class MigrationError(RuntimeError):
    """Safe error messages contain schema names, never records or credentials."""


def source_engine(source: Path):
    source = source.resolve(strict=True)
    if not source.is_file():
        raise MigrationError("El origen debe ser un snapshot SQLite existente.")

    def connect():
        connection = sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)
        connection.execute("PRAGMA query_only=ON")
        return connection

    return create_engine("sqlite://", creator=connect, poolclass=NullPool)


def _json_valid(value):
    if value is None or isinstance(value, (str, bool)) or type(value) is int:
        return
    if type(value) is float and math.isfinite(value):
        return
    if isinstance(value, list):
        for item in value:
            _json_valid(item)
        return
    if isinstance(value, dict) and all(isinstance(key, str) for key in value):
        for item in value.values():
            _json_valid(item)
        return
    raise MigrationError("JSON no válido o no finito; se canceló la transferencia.")


def typed_value(column, value, *, sqlite_source=False):
    """Validate before binding; do not coerce corrupt booleans or invalid JSON."""
    if value is None:
        if not column.nullable:
            raise MigrationError(f"Valor nulo inesperado en {column.table.name}.{column.name}.")
        return None
    kind = column.type
    if isinstance(kind, Boolean):
        if type(value) is bool:
            return value
        if sqlite_source and type(value) is int and value in (0, 1):
            return bool(value)
        raise MigrationError("Booleano no válido; no se transformará silenciosamente.")
    if isinstance(kind, DateTime):
        if sqlite_source and isinstance(value, str):
            value = datetime.fromisoformat(value)
        if not isinstance(value, datetime):
            raise MigrationError("Timestamp no válido.")
        return as_utc(value)
    if isinstance(kind, Date):
        if sqlite_source and isinstance(value, str):
            value = date.fromisoformat(value)
        if type(value) is not date:
            raise MigrationError("Fecha administrativa no válida.")
        return value
    if isinstance(kind, JSON):
        if sqlite_source:
            if not isinstance(value, str):
                raise MigrationError("La columna JSON SQLite no contiene JSON textual.")
            value = json.loads(value)
        _json_valid(value)
        return value
    if isinstance(kind, LargeBinary):
        if not isinstance(value, (bytes, memoryview)):
            raise MigrationError("La evidencia no contiene bytes válidos.")
        return bytes(value)
    if isinstance(kind, Integer):
        if type(value) is not int or not -(2**31) <= value < 2**31:
            raise MigrationError("Entero fuera del contrato PostgreSQL.")
        return value
    if isinstance(kind, Float):
        if type(value) not in (int, float) or not math.isfinite(value):
            raise MigrationError("Número no finito o inválido.")
        return float(value)
    if isinstance(kind, String):
        if not isinstance(value, str) or "\x00" in value or (kind.length and len(value) > kind.length):
            raise MigrationError("Texto incompatible con el contrato PostgreSQL.")
        return value
    raise MigrationError("Tipo de columna no admitido para migración.")


def _canonical(column, value):
    if value is None:
        return ["null"]
    if isinstance(column.type, DateTime):
        return ["utc", as_utc(value).isoformat(timespec="microseconds")]
    if isinstance(column.type, Date):
        return ["date", value.isoformat()]
    if isinstance(column.type, LargeBinary):
        return ["bytes", len(value), hashlib.sha256(value).hexdigest()]
    if isinstance(column.type, Float):
        return ["float64", value.hex()]
    if isinstance(column.type, JSON):
        return ["json", value]
    if isinstance(column.type, Boolean):
        return ["bool", value]
    if isinstance(column.type, Integer):
        return ["int", value]
    return ["text", value]


def _manifest_columns(table, source_version=None):
    unavailable = V10_COLUMNS.get(table.name, set()) if source_version is not None and source_version < 10 else set()
    return [column for column in table.columns if column.name not in unavailable]


def table_rows(connection, table, *, sqlite_source=False, source_version=None):
    selected_columns = _manifest_columns(table, source_version)
    if sqlite_source:
        # Read raw SQLite values so SQLAlchemy cannot hide malformed booleans.
        quote = connection.dialect.identifier_preparer.quote
        columns = ", ".join(quote(column.name) for column in selected_columns)
        order = ", ".join(quote(column.name) for column in table.primary_key.columns)
        result = connection.exec_driver_sql(f"SELECT {columns} FROM {quote(table.name)} ORDER BY {order}")
    else:
        query = select(*selected_columns).order_by(*table.primary_key.columns)
        if table.name == "schema_migrations" and source_version is not None:
            query = query.where(table.c.version <= source_version)
        result = connection.execute(query.execution_options(stream_results=True))
    while chunk := result.fetchmany(32):
        yield [{column.name: typed_value(column, row[index], sqlite_source=sqlite_source)
                for index, column in enumerate(selected_columns)} for row in chunk]


def table_manifest(connection, table, *, sqlite_source=False, source_version=None):
    columns = _manifest_columns(table, source_version)
    digest = hashlib.sha256()
    digest.update(json.dumps([column.name for column in columns], separators=(",", ":")).encode())
    count = 0
    for chunk in table_rows(connection, table, sqlite_source=sqlite_source, source_version=source_version):
        for row in chunk:
            encoded = json.dumps([_canonical(column, row[column.name]) for column in columns],
                                 sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
            digest.update(len(encoded).to_bytes(8, "big"))
            digest.update(encoded)
            count += 1
    return {"rows": count, "sha256": digest.hexdigest()}


def _source_tables(connection):
    versions = _versions(connection)
    if versions not in tuple(set(range(1, number + 1)) for number in (8, 9, 10)):
        raise MigrationError("El snapshot debe estar validado en versión 8, 9 o 10.")
    version = max(versions)
    _validate_schema(connection, version)
    if connection.exec_driver_sql("PRAGMA integrity_check").scalar_one() != "ok":
        raise MigrationError("El snapshot no superó la integridad SQLite.")
    tables = dict(Base.metadata.tables)
    if version == 8:
        tables = {name: table for name, table in tables.items() if name not in V9_TABLES}
    return version, tables


def _target_metadata():
    metadata = MetaData()
    for table in Base.metadata.tables.values():
        table.to_metadata(metadata)
    # All relationships survive. PostgreSQL checks them before commit, allowing
    # circular associations without deleting refs or patching records to null.
    for table in metadata.tables.values():
        for constraint in table.foreign_key_constraints:
            constraint.deferrable = True
            constraint.initially = "DEFERRED"
    return metadata


def _target_schema(connection):
    schema = connection.scalar(text("SELECT current_schema()"))
    options = connection.engine.url.query.get("options")
    allowed = options.split("=", 1)[1] if options else "public"
    if schema != allowed:
        raise MigrationError("El destino no usa el esquema autorizado.")
    return schema


def _reset_sequences(connection, tables):
    for table in tables.values():
        primary = list(table.primary_key.columns)
        if len(primary) != 1 or not isinstance(primary[0].type, Integer):
            continue
        column = primary[0]
        sequence = connection.scalar(text("SELECT pg_get_serial_sequence(:table_name, :column_name)"),
                                     {"table_name": table.name, "column_name": column.name})
        if sequence is None:
            raise MigrationError(f"Secuencia faltante en {table.name}.")
        maximum = connection.scalar(select(column).order_by(column.desc()).limit(1))
        used = maximum is not None and maximum >= 1
        connection.execute(text("SELECT setval(CAST(:sequence AS regclass), :value, :used)"),
                           {"sequence": sequence, "value": maximum if used else 1, "used": used})


def migrate_sqlite(source_path: Path, destination_url: str, *, verify_only=False, revoke_sessions=False):
    if verify_only and revoke_sessions:
        raise MigrationError("Verificar no puede modificar sesiones.")
    if make_url(destination_url).get_backend_name() != "postgresql":
        raise MigrationError("El destino debe ser PostgreSQL; nunca otro archivo SQLite.")
    original = source_engine(source_path)
    target, _ = make_database(destination_url)
    try:
        with original.connect() as source:
            source.exec_driver_sql("BEGIN")
            version, tables = _source_tables(source)
            expected = {name: table_manifest(source, table, sqlite_source=True, source_version=version)
                        for name, table in tables.items()}
            with target.begin() as destination:
                if verify_only:
                    destination.execute(text("SET TRANSACTION READ ONLY"))
                _target_schema(destination)
                if not verify_only:
                    destination.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": SCHEMA_MIGRATION_LOCK})
                    inspector = inspect(destination)
                    if (inspector.get_table_names() or inspector.get_view_names() or
                            inspector.get_materialized_view_names() or inspector.get_sequence_names()):
                        raise MigrationError("El destino no está vacío; no se reimportará ni sobrescribirá.")
                    metadata = _target_metadata()
                    metadata.create_all(destination)
                    destination.execute(text("SET CONSTRAINTS ALL DEFERRED"))
                    for name, table in tables.items():
                        for chunk in table_rows(source, table, sqlite_source=True, source_version=version):
                            destination.execute(metadata.tables[name].insert(), chunk)
                    for target_version in range(version + 1, SCHEMA_VERSION + 1):
                        destination.execute(SchemaMigration.__table__.insert().values(version=target_version, applied_at=utc_now()))
                    _reset_sequences(destination, metadata.tables)
                    destination.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
                if _versions(destination) != set(range(1, SCHEMA_VERSION + 1)):
                    raise MigrationError("El destino no tiene la versión esperada.")
                _validate_schema(destination, SCHEMA_VERSION)
                actual = {name: table_manifest(destination, table, source_version=version) for name, table in tables.items()}
                if actual != expected:
                    raise MigrationError("Los conteos o digests no coinciden; se canceló la transferencia.")
                revoked = 0
                if revoke_sessions:
                    result = destination.execute(update(UserSession).where(UserSession.revoked_at.is_(None)).values(revoked_at=utc_now()))
                    revoked = result.rowcount
                report = {"verified": True, "verify_only": verify_only, "source_version": version,
                          "destination_version": SCHEMA_VERSION, "tables": expected, "revoked_sessions": revoked}
            return report
    finally:
        original.dispose()
        target.dispose()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--revoke-sessions", action="store_true")
    args, unknown = parser.parse_known_args(argv)
    if unknown:
        parser.error("Solo se admiten --source, --verify-only y --revoke-sessions; el destino usa una variable privada.")
    destination = os.getenv("YOKOHAMA_MIGRATION_DATABASE_URL", "")
    if not destination:
        parser.error("Configure YOKOHAMA_MIGRATION_DATABASE_URL por un canal privado.")
    try:
        report = migrate_sqlite(args.source, destination, verify_only=args.verify_only, revoke_sessions=args.revoke_sessions)
    except Exception as error:
        # Never expose driver exception text, connection URLs, hashes or rows.
        print(str(error) if isinstance(error, MigrationError) else f"Transferencia cancelada ({type(error).__name__}); no se confirmó el destino.", file=sys.stderr)
        return 1
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
