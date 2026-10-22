"""An explicitly approved developer admin is not an open-ended admin role."""
from datetime import timedelta

from fastapi import HTTPException
import pytest
from sqlalchemy import select

from app.auth import (
    ADMIN_EMAILS, DEVELOPER_EMAIL, OWNER_EMAIL, Principal, authorize_admin,
    effective_role, hash_password, token_digest,
)
from app.auth_models import CompanyUser, UserSession, UserVehicleAssignment
from app.provision_owner import provision_owner
from app.time_utils import as_utc, local_today, utc_now
from test_accounts import PASSWORD, NEW_PASSWORD, SETUP_TOKEN, company
from test_api import client, vehicle_data


def create_developer(company, *, role="admin", email=DEVELOPER_EMAIL):
    response = company["client"].post("/api/users", headers=company["admin_headers"], json={
        "name": "Desarrollador de pruebas", "email": email, "password": PASSWORD,
        "role": role, "vehicle_ids": [],
    })
    assert response.status_code == 201, response.text
    return response.json()


def developer_login(company):
    response = company["client"].post("/api/auth/login", json={
        "email": f"  {DEVELOPER_EMAIL.upper()}  ", "password": PASSWORD,
    })
    assert response.status_code == 200, response.text
    return response.json(), {"X-Session-Token": response.json()["session_token"]}


def test_allowlist_is_exact_and_also_requires_an_admin_role():
    assert ADMIN_EMAILS == frozenset({OWNER_EMAIL, DEVELOPER_EMAIL})
    for email in (OWNER_EMAIL, DEVELOPER_EMAIL):
        user = CompanyUser(email=f"  {email.upper()}  ", role="admin")
        assert effective_role(user) == "admin"
        user.role = "user"
        assert effective_role(user) == "user"
    assert effective_role(CompanyUser(email="legacy@example.test", role="admin")) == "user"
    assert effective_role(CompanyUser(email="martinmoralesbasurto1+alias@gmail.com", role="admin")) == "user"


def test_authorize_admin_checks_the_identity_even_for_a_forged_role():
    class TestSession:
        info = {}

    session = TestSession()
    for email in ADMIN_EMAILS:
        session.info["principal"] = Principal(1, "Test", email.upper(), "admin", frozenset())
        authorize_admin(session)
    for email, role in ((DEVELOPER_EMAIL, "user"), ("legacy@example.test", "admin")):
        session.info["principal"] = Principal(1, "Test", email, role, frozenset())
        with pytest.raises(HTTPException) as rejected:
            authorize_admin(session)
        assert rejected.value.status_code == 403


def test_developer_has_all_units_dashboard_and_user_management_without_assignments(company):
    created = create_developer(company, email=f"  {DEVELOPER_EMAIL.upper()}  ")
    assert created["email"] == DEVELOPER_EMAIL and created["role"] == "admin"
    assert created["active"] is True and created["vehicle_ids"] == []
    login, headers = developer_login(company)
    assert login["user"]["role"] == "admin"
    client = company["client"]
    assert {row["id"] for row in client.get("/api/vehicles", headers=headers).json()} == {
        company["first"]["id"], company["second"]["id"],
    }
    today = local_today().isoformat()
    for path in ("/api/users", "/api/fleet-statistics", "/api/metrics", "/api/alerts",
                 f"/api/calendar?start={today}&end={today}"):
        response = client.get(path, headers=headers)
        assert response.status_code == 200, (path, response.text)
    driver = client.post("/api/users", headers=headers, json={
        "name": "Conductor de prueba", "email": "new-driver@example.test", "password": PASSWORD,
        "vehicle_ids": [company["second"]["id"]],
    })
    assert driver.status_code == 201 and driver.json()["role"] == "user"
    assert client.get("/api/users", headers=company["user_headers"]).status_code == 403
    with client.app.state.sessions() as session:
        # Accounts have no validity deadline. Sessions still expire securely;
        # granting indefinite account access is not a non-expiring bearer token.
        user = session.get(CompanyUser, created["id"])
        assert not hasattr(user, "expires_at")
        bearer = session.get(UserSession, token_digest(login["session_token"]))
        remaining = as_utc(bearer.expires_at) - utc_now()
        assert timedelta(hours=11) < remaining <= timedelta(hours=12)


def test_developer_allowlist_does_not_change_the_reserved_setup_identity(client):
    client.app.state.auth.setup_token = SETUP_TOKEN
    rejected = client.post("/api/auth/setup", json={
        "token": SETUP_TOKEN, "name": "Developer", "email": DEVELOPER_EMAIL, "password": PASSWORD,
    })
    assert rejected.status_code == 403
    assert client.get("/api/auth/status").json()["configured"] is False


def test_owner_can_promote_only_the_approved_developer_and_normalization_is_unique(company):
    created = create_developer(company, role="user")
    login, old_headers = developer_login(company)
    assert login["user"]["role"] == "user"
    assert company["client"].get("/api/users", headers=old_headers).status_code == 403
    promoted = company["client"].patch(f"/api/users/{created['id']}", headers=company["admin_headers"],
                                     json={"role": "admin"})
    assert promoted.status_code == 200 and promoted.json()["role"] == "admin"
    assert company["client"].get("/api/auth/me", headers=old_headers).status_code == 401
    login, new_headers = developer_login(company)
    assert login["user"]["role"] == "admin"
    assert company["client"].get("/api/users", headers=new_headers).status_code == 200
    duplicate = company["client"].post("/api/users", headers=company["admin_headers"], json={
        "name": "Duplicate", "email": f" {DEVELOPER_EMAIL.upper()} ", "password": PASSWORD, "role": "admin",
    })
    assert duplicate.status_code == 409
    rejected = company["client"].patch(f"/api/users/{company['user']['id']}",
                                      headers=company["admin_headers"], json={"role": "admin"})
    assert rejected.status_code == 403


def test_admin_identity_cannot_be_transferred_to_an_arbitrary_email(company):
    created = create_developer(company)
    _, headers = developer_login(company)
    client = company["client"]
    for changes in ({"email": "other@example.test"},
                    {"email": "martinmoralesbasurto1+alias@gmail.com", "role": "admin"}):
        response = client.patch(f"/api/users/{created['id']}", headers=company["admin_headers"], json=changes)
        assert response.status_code == 403
        assert client.get("/api/auth/me", headers=headers).json()["email"] == DEVELOPER_EMAIL
    rejected = client.post("/api/users", headers=headers, json={
        "name": "Unauthorized", "email": "arbitrary-admin@example.test", "password": PASSWORD, "role": "admin",
    })
    assert rejected.status_code == 403
    assert all(user["email"] != "arbitrary-admin@example.test" for user in client.get("/api/users", headers=headers).json())


def test_developer_cannot_remove_disable_or_replace_the_owner(company):
    create_developer(company)
    _, headers = developer_login(company)
    client = company["client"]
    owner_id = company["admin"]["user"]["id"]
    for changes in ({"role": "user"}, {"active": False}, {"email": DEVELOPER_EMAIL}, {"email": "other@example.test"}):
        assert client.patch(f"/api/users/{owner_id}", headers=headers, json=changes).status_code == 409
    assert client.patch(f"/api/users/{company['user']['id']}", headers=headers,
                        json={"email": OWNER_EMAIL, "role": "admin"}).status_code == 409
    assert client.post("/api/users", headers=headers, json={
        "name": "Duplicate owner", "email": OWNER_EMAIL, "password": PASSWORD, "role": "admin",
    }).status_code == 409
    owner = client.get("/api/auth/me", headers=company["admin_headers"])
    assert owner.status_code == 200
    assert owner.json()["email"] == OWNER_EMAIL and owner.json()["role"] == "admin" and owner.json()["active"]


def test_permissions_are_rechecked_on_existing_developer_sessions(company):
    created = create_developer(company)
    _, headers = developer_login(company)
    client = company["client"]
    with client.app.state.sessions.begin() as session:
        developer = session.get(CompanyUser, created["id"])
        developer.email = "not-approved@example.test"
        # Simulate a stale administrative row without relying on a PATCH.
        assert developer.role == "admin"
    assert client.get("/api/auth/me", headers=headers).json()["role"] == "user"
    for path in ("/api/users", "/api/fleet-statistics", "/api/metrics", "/api/alerts"):
        assert client.get(path, headers=headers).status_code == 403
    assert client.get("/api/vehicles", headers=headers).json() == []


def test_owner_provisioning_keeps_developer_hash_sessions_and_all_data(company):
    created = create_developer(company)
    login, headers = developer_login(company)
    client = company["client"]
    with client.app.state.sessions.begin() as session:
        developer = session.get(CompanyUser, created["id"])
        developer.email = f"  {DEVELOPER_EMAIL.upper()}  "
        original_hash, original_name = developer.password_hash, developer.name
        session.add(UserVehicleAssignment(user_id=developer.id, vehicle_id=company["first"]["id"]))
        legacy = CompanyUser(name="Legacy admin", email="legacy@example.test", role="admin", active=True,
                             password_hash=hash_password(PASSWORD))
        session.add(legacy)
        session.flush()
        result = provision_owner(session, NEW_PASSWORD)
        assert result == {"email": OWNER_EMAIL, "previous_admins_demoted": 1, "created": False}
        assert developer.role == "admin" and developer.active
        assert developer.password_hash == original_hash and developer.name == original_name
        assert legacy.role == "user"
        assert session.get(UserSession, token_digest(login["session_token"])).revoked_at is None
        assert list(session.scalars(select(UserVehicleAssignment.vehicle_id).where(
            UserVehicleAssignment.user_id == developer.id))) == [company["first"]["id"]]
    assert client.get("/api/auth/me", headers=headers).json()["role"] == "admin"
    assert client.get("/api/auth/me", headers=company["admin_headers"]).status_code == 401
    assert len(client.get("/api/vehicles", headers=headers).json()) == 2
    statistics = client.get("/api/fleet-statistics", headers=headers)
    assert statistics.status_code == 200
    assert all("Desarrollador de pruebas" not in row["drivers"] for row in statistics.json())
    fresh_owner = client.post("/api/auth/login", json={"email": OWNER_EMAIL, "password": NEW_PASSWORD})
    assert fresh_owner.status_code == 200 and fresh_owner.json()["user"]["role"] == "admin"
