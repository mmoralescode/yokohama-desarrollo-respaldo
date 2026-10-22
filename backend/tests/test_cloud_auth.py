"""Cloud authentication uses isolated PostgreSQL schemas, never live tables."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from types import SimpleNamespace

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select, update
from starlette.requests import Request

from app.auth import DEVELOPER_EMAIL, OWNER_EMAIL, PersistentAttemptLimiter, hash_password
from app.auth_models import AuthAttemptCounter, CompanyUser
from app.database import migrate
import app.main as main
from app.main import create_app
from app.time_utils import local_today, utc_now
from test_api import vehicle_data
from test_accounts import photo
from test_postgres_support import postgres_database

KEY = "cloud-test-only-key-not-a-real-secret-2026"
PASSWORD = "Cloud test phrase only 2026!"


def request(address="a" * 64, extra_headers=()):
    headers = [(b"x-trusted-client", address.encode())] if address is not None else []
    return Request({"type": "http", "method": "POST", "path": "/api/auth/login", "headers": headers + list(extra_headers),
                    "client": ("127.0.0.1", 1), "scheme": "https", "server": ("api.example.test", 443)})


@pytest.fixture
def cloud_app(postgres_database, monkeypatch):
    migrate(postgres_database["engine"])
    with postgres_database["sessions"].begin() as session:
        session.add(CompanyUser(name="Test administrator", email=OWNER_EMAIL,
                                role="admin", active=True, password_hash=hash_password(PASSWORD)))
    monkeypatch.setenv("YOKOHAMA_DEPLOYMENT_MODE", "cloud")
    monkeypatch.setenv("YOKOHAMA_REQUIRE_AUTH", "false")
    monkeypatch.delenv("YOKOHAMA_SETUP_TOKEN", raising=False)
    return create_app(database_url=postgres_database["url"], api_key=KEY)


def test_cloud_configuration_is_explicit_and_fail_closed(monkeypatch):
    monkeypatch.setenv("YOKOHAMA_DEPLOYMENT_MODE", "cloud")
    monkeypatch.delenv("YOKOHAMA_SETUP_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="PostgreSQL"):
        create_app(database_url="sqlite:///:memory:", api_key=KEY)
    for key in ("", "too-short"):
        with pytest.raises(RuntimeError, match="clave API"):
            create_app(database_url="postgresql://test.invalid/test", api_key=key)
    monkeypatch.setenv("YOKOHAMA_SETUP_TOKEN", "setup-must-not-exist-in-cloud")
    with pytest.raises(RuntimeError, match="token"):
        create_app(database_url="postgresql://test.invalid/test", api_key=KEY)
    monkeypatch.setenv("YOKOHAMA_DEPLOYMENT_MODE", "typo")
    with pytest.raises(RuntimeError, match="local o cloud"):
        create_app(database_url="sqlite:///:memory:", api_key=KEY)


def test_limiter_digests_and_trusted_header_fail_closed():
    limiter = PersistentAttemptLimiter(KEY)
    buckets = limiter._buckets(request(), OWNER_EMAIL)
    assert [limit for _, limit in buckets] == [60, 8]
    assert len(buckets) == 2 and {limit for _, limit in buckets} == {8, 60}
    assert all(len(key) == 64 and OWNER_EMAIL not in key for key, _ in buckets)
    missing = limiter._buckets(request(None), OWNER_EMAIL)
    assert limiter._buckets(request("spoofed-client-ip"), OWNER_EMAIL) == missing
    assert limiter._buckets(request(None, [(b"x-forwarded-for", b"1.2.3.4")]), OWNER_EMAIL) == missing
    assert PersistentAttemptLimiter(KEY + "different")._buckets(request(), OWNER_EMAIL) != buckets


def test_cloud_owner_required_before_serving(postgres_database, monkeypatch):
    monkeypatch.setenv("YOKOHAMA_DEPLOYMENT_MODE", "cloud")
    monkeypatch.delenv("YOKOHAMA_SETUP_TOKEN", raising=False)
    application = create_app(database_url=postgres_database["url"], api_key=KEY)
    with pytest.raises(RuntimeError, match="administradora autorizada"):
        with TestClient(application):
            pass


def test_cloud_auth_forced_bootstrap_closed_no_background_job(cloud_app, monkeypatch, postgres_database):
    scheduled = []
    monkeypatch.setattr(main, "asyncio", SimpleNamespace(Lock=asyncio.Lock, to_thread=asyncio.to_thread,
                                                       sleep=asyncio.sleep, create_task=lambda task: scheduled.append(task)))
    with TestClient(cloud_app) as client:
        client.headers.update({"X-API-Key": KEY})
        assert client.get("/api/auth/status").json() == {"configured": True, "required": True}
        assert client.get("/api/vehicles").status_code == 401
        assert client.post("/api/auth/setup", json={"token": "closed", "name": "Admin", "email": OWNER_EMAIL,
                                                   "password": PASSWORD}).status_code == 403
        assert client.post("/api/auth/login", headers={"X-API-Key": "bad", "X-Trusted-Client": "b" * 64},
                           json={"email": OWNER_EMAIL, "password": "wrong"}).status_code == 401
    assert scheduled == []
    assert cloud_app.state.deployment_mode == "cloud"
    assert isinstance(cloud_app.state.auth.limiter, PersistentAttemptLimiter)
    with postgres_database["sessions"]() as session:
        assert session.scalar(select(func.count()).select_from(AuthAttemptCounter)) == 0


def test_invalid_login_counters_survive_rollback_and_new_instance(cloud_app, postgres_database):
    for application in (cloud_app, create_app(database_url=postgres_database["url"], api_key=KEY)):
        with TestClient(application) as client:
            client.headers.update({"X-API-Key": KEY, "X-Trusted-Client": "a" * 64})
            for _ in range(4):
                assert client.post("/api/auth/login", json={"email": OWNER_EMAIL, "password": "wrong"}).status_code == 401
    with TestClient(create_app(database_url=postgres_database["url"], api_key=KEY)) as client:
        client.headers.update({"X-API-Key": KEY, "X-Trusted-Client": "a" * 64})
        response = client.post("/api/auth/login", json={"email": OWNER_EMAIL, "password": PASSWORD})
        assert response.status_code == 429 and response.headers["Retry-After"] == "900"
    with postgres_database["sessions"]() as session:
        assert sorted(session.scalars(select(AuthAttemptCounter.attempts))) == [9, 9]


def test_counter_concurrency_window_and_independent_transactions(postgres_database):
    migrate(postgres_database["engine"])

    def attempt(_index):
        limiter = PersistentAttemptLimiter(KEY)
        with postgres_database["sessions"]() as session:
            try:
                limiter.check(request(), OWNER_EMAIL, session)
                session.rollback()
                return 200
            except HTTPException as exc:
                session.rollback()
                return exc.status_code

    with ThreadPoolExecutor(max_workers=8) as workers:
        outcomes = list(workers.map(attempt, range(20)))
    assert outcomes.count(200) == 8 and outcomes.count(429) == 12
    with postgres_database["sessions"].begin() as session:
        assert sorted(session.scalars(select(AuthAttemptCounter.attempts))) == [9, 20]
        session.execute(update(AuthAttemptCounter).values(window_started_at=utc_now() - timedelta(minutes=16)))
    assert attempt(0) == 200
    with postgres_database["sessions"]() as session:
        assert list(session.scalars(select(AuthAttemptCounter.attempts))) == [1, 1]


def test_global_address_limit_for_missing_trusted_header(postgres_database):
    migrate(postgres_database["engine"])
    limiter = PersistentAttemptLimiter(KEY)
    with postgres_database["sessions"]() as session:
        for index in range(60):
            limiter.check(request(None), f"identity-{index}@example.test", session)
        with pytest.raises(HTTPException) as caught:
            limiter.check(request(None), "last@example.test", session)
        assert caught.value.status_code == 429
        with pytest.raises(HTTPException) as caught:
            limiter.check(request("untrusted"), "another@example.test", session)
        assert caught.value.status_code == 429


def test_cloud_driver_assignment_and_photo_privacy(cloud_app, vehicle_data):
    with TestClient(cloud_app) as client:
        client.headers.update({"X-API-Key": KEY, "X-Trusted-Client": "a" * 64})
        login = client.post("/api/auth/login", json={"email": OWNER_EMAIL, "password": PASSWORD})
        assert login.status_code == 200, login.text
        admin = {"X-Session-Token": login.json()["session_token"]}
        units = []
        for index in range(2):
            unit = client.post("/api/vehicles", headers=admin, json=vehicle_data | {
                "vin": f"CLDTR{index:012d}", "plate": f"CLOUD-{index}"})
            assert unit.status_code == 201, unit.text
            units.append(unit.json()["id"])
        created = client.post("/api/users", headers=admin, json={"name": "Cloud driver", "email": "driver@example.test",
            "password": PASSWORD, "vehicle_ids": [units[0]], "role": "user"})
        assert created.status_code == 201, created.text
        own_login = client.post("/api/auth/login", json={"email": "driver@example.test", "password": PASSWORD})
        assert own_login.status_code == 200, own_login.text
        driver = {"X-Session-Token": own_login.json()["session_token"]}
        assert [unit["id"] for unit in client.get("/api/vehicles", headers=driver).json()] == [units[0]]
        assert client.get("/api/fleet-statistics", headers=driver).status_code == 403
        assert client.get(f"/api/vehicles/{units[1]}", headers=driver).status_code == 404
        for headers, unit in ((driver, units[0]), (admin, units[0]), (admin, units[1])):
            evidence = client.post(f"/api/vehicles/{unit}/faults", headers=headers, json={
                "description": "Cloud test fault with evidence", "severity": "menor",
                "safe_to_defer": False, "photos": [photo()]})
            assert evidence.status_code == 201, evidence.text
            photo_id = evidence.json()["photos"][0]["id"]
            expected = 200 if headers is driver else 404
            assert client.get(f"/api/evidence/{photo_id}", headers=driver).status_code == expected


def test_cloud_developer_admin_is_explicit_full_access_and_persists_across_instances(cloud_app, vehicle_data, postgres_database):
    with TestClient(cloud_app) as client:
        client.headers.update({"X-API-Key": KEY, "X-Trusted-Client": "a" * 64})
        login = client.post("/api/auth/login", json={"email": OWNER_EMAIL, "password": PASSWORD})
        assert login.status_code == 200
        owner = {"X-Session-Token": login.json()["session_token"]}
        unit = client.post("/api/vehicles", headers=owner, json=vehicle_data)
        assert unit.status_code == 201
        created = client.post("/api/users", headers=owner, json={
            "name": "Cloud developer", "email": f"  {DEVELOPER_EMAIL.upper()}  ",
            "password": PASSWORD, "role": "admin", "vehicle_ids": [],
        })
        assert created.status_code == 201, created.text
        assert created.json()["email"] == DEVELOPER_EMAIL and created.json()["role"] == "admin"
        developer_login = client.post("/api/auth/login", json={"email": DEVELOPER_EMAIL, "password": PASSWORD})
        assert developer_login.status_code == 200
        developer = {"X-Session-Token": developer_login.json()["session_token"]}
        assert client.get("/api/auth/me", headers=developer).json()["vehicle_ids"] == []
        assert [row["id"] for row in client.get("/api/vehicles", headers=developer).json()] == [unit.json()["id"]]
        today = local_today().isoformat()
        for path in ("/api/users", "/api/fleet-statistics", "/api/metrics", "/api/alerts",
                     f"/api/calendar?start={today}&end={today}"):
            assert client.get(path, headers=developer).status_code == 200
        denied = client.post("/api/users", headers=developer, json={
            "name": "Other admin", "email": "cloud-other-admin@example.test",
            "password": PASSWORD, "role": "admin",
        })
        assert denied.status_code == 403
        assert client.patch(f"/api/users/{login.json()['user']['id']}", headers=developer,
                            json={"active": False}).status_code == 409
    application = create_app(database_url=postgres_database["url"], api_key=KEY)
    with TestClient(application) as restarted:
        restarted.headers.update({"X-API-Key": KEY, "X-Trusted-Client": "b" * 64})
        assert restarted.get("/api/users", headers=developer).status_code == 200
        assert restarted.get("/api/auth/me", headers=developer).json()["role"] == "admin"
        fresh = restarted.post("/api/auth/login", json={"email": DEVELOPER_EMAIL, "password": PASSWORD})
        assert fresh.status_code == 200 and fresh.json()["user"]["role"] == "admin"
