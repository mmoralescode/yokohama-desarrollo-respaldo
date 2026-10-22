"""PostgreSQL tests use a UUID schema, never public tables or production rows."""
import os
import re
from uuid import uuid4

import pytest
from sqlalchemy import DateTime, Float, Integer, text
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.engine import make_url

from app.database import _postgres_ca_file, _postgres_reflection, _types_match, make_database


@pytest.fixture
def postgres_database():
    private_url = os.getenv("YOKOHAMA_POSTGRES_TEST_ROOT_URL")
    if not private_url:
        pytest.skip("PostgreSQL temporal requiere el helper privado autorizado.")
    schema = "yokohama_test_" + uuid4().hex
    if not re.fullmatch(r"yokohama_test_[0-9a-f]{32}", schema):
        raise RuntimeError("Esquema temporal no válido.")
    root_engine, _ = make_database(make_url(private_url))
    isolated = None
    try:
        with root_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        url = make_url(private_url).update_query_dict({"options": f"-csearch_path={schema}"})
        isolated, sessions = make_database(url)
        with isolated.connect() as connection:
            assert connection.scalar(text("SELECT current_schema()")) == schema
        # URL objects redact their password in pytest failure representations.
        yield {"engine": isolated, "sessions": sessions, "url": url, "schema": schema}
    finally:
        if isolated is not None:
            isolated.dispose()
        # Only the exact generated and validated schema can be removed.
        with root_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        root_engine.dispose()


def test_postgres_reflection_is_semantic_but_tight():
    dialect = postgresql.dialect()
    assert _types_match(postgresql.DOUBLE_PRECISION(), Float(), dialect)
    assert not _types_match(postgresql.REAL(), Float(), dialect)
    assert not _types_match(postgresql.NUMERIC(), Float(), dialect)
    assert _types_match(postgresql.TIMESTAMP(timezone=True), DateTime(timezone=True), dialect)
    assert not _types_match(postgresql.TIMESTAMP(timezone=False), DateTime(timezone=True), dialect)
    assert not _types_match(postgresql.TIMESTAMP(timezone=True, precision=0), DateTime(timezone=True), dialect)
    assert not _types_match(Integer(), Float(), dialect)
    assert _types_match(Float(), Float(), sqlite.dialect())
    assert not _types_match(postgresql.DOUBLE_PRECISION(), Float(), sqlite.dialect())


def test_postgres_forces_verified_tls_and_channel_binding():
    engine, _ = make_database("postgresql://test:private-not-real@db.example.invalid/unit?sslmode=disable&channel_binding=disable")
    try:
        assert engine.url.drivername == "postgresql+psycopg"
        assert engine.url.query["sslmode"] == "verify-full"
        assert engine.url.query["channel_binding"] == "require"
        assert os.path.isfile(engine.url.query["sslrootcert"])
        assert engine.hide_parameters is True
    finally:
        engine.dispose()


def test_postgres_ca_is_the_original_trusted_bundle():
    import certifi
    trusted = _postgres_ca_file()
    assert os.path.samefile(trusted, certifi.where())
    assert os.path.isfile(trusted)
    if os.name == "nt":
        assert trusted.isascii()


def test_postgres_rejects_arbitrary_routing_options():
    with pytest.raises(ValueError, match="opciones"):
        make_database("postgresql://test:private-not-real@db.example.invalid/unit?options=-csearch_path=public")
    with pytest.raises(ValueError, match="opciones"):
        make_database("postgresql://test:private-not-real@db.example.invalid/unit?hostaddr=127.0.0.1")


def test_postgres_bulk_reflection_preserves_single_table_contract():
    tables = {"parent", "child"}
    reflected = {
        "columns": {name: [{"name": "id", "type": Integer(), "nullable": False}] for name in tables},
        "pk": {name: {"constrained_columns": ["id"]} for name in tables},
        "unique": {name: [{"column_names": ["id"]}] for name in tables},
        "foreign": {name: [] for name in tables},
    }
    calls = []

    class Inspector:
        def __getattr__(self, method):
            label = {"get_multi_columns": "columns", "get_multi_pk_constraint": "pk",
                     "get_multi_unique_constraints": "unique", "get_multi_foreign_keys": "foreign"}[method]

            def get(*, filter_names):
                calls.append((label, filter_names))
                return {(None, name): reflected[label][name] for name in filter_names}
            return get

    assert _postgres_reflection(Inspector(), tables) == reflected
    assert len(calls) == 4
    assert all(names == ["child", "parent"] for _, names in calls)


def test_postgres_bulk_reflection_rejects_missing_or_extra_tables():
    class Inspector:
        def get_multi_columns(self, **_kwargs):
            return {(None, "unexpected"): []}

    with pytest.raises(RuntimeError, match="incompleta"):
        _postgres_reflection(Inspector(), {"expected"})
