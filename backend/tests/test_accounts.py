"""Person sessions, scoped records and role checks use isolated test databases."""
import base64
from datetime import timedelta
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image
import pytest
from sqlalchemy import select

from app.auth import OWNER_EMAIL, hash_password, token_digest, verify_password
from app.auth_models import CompanyUser, UserSession, UserVehicleAssignment
from app.main import create_app
from app.time_utils import local_today, utc_now
from test_api import client, vehicle_data

PASSWORD = "Una frase segura 2026!"
NEW_PASSWORD = "Una nueva frase segura 2026!"
SETUP_TOKEN = "pruebas-setup-aleatorio-de-32-caracteres"


@pytest.fixture
def company(client, vehicle_data):
    first = client.post("/api/vehicles", json=vehicle_data).json()
    second = client.post("/api/vehicles", json=vehicle_data | {"vin": "DEM00000000000998", "plate": "OTHER-998"}).json()
    client.app.state.auth.setup_token = SETUP_TOKEN
    setup = client.post("/api/auth/setup", json={"token": SETUP_TOKEN, "name": "Administración", "email": "  ADMIN.YOKO@gmail.com  ", "password": PASSWORD})
    assert setup.status_code == 201, setup.text
    admin = setup.json()
    admin_headers = {"X-Session-Token": admin["session_token"]}
    created = client.post("/api/users", headers=admin_headers, json={"name": "Ana Operadora", "email": "ana@example.test", "password": PASSWORD,
                           "role": "user", "vehicle_ids": [first["id"]]})
    assert created.status_code == 201, created.text
    login = client.post("/api/auth/login", json={"email": "ana@example.test", "password": PASSWORD})
    assert login.status_code == 200, login.text
    return {"client": client, "first": first, "second": second, "admin": admin, "admin_headers": admin_headers,
            "user": created.json(), "user_token": login.json()["session_token"], "user_headers": {"X-Session-Token": login.json()["session_token"]}}


def photo():
    stream = BytesIO()
    Image.new("RGB", (12, 8), "blue").save(stream, format="PNG")
    return {"filename": "tablero.png", "data_url": "data:image/png;base64," + base64.b64encode(stream.getvalue()).decode()}


def driver_login(client, password=PASSWORD):
    response = client.post("/api/auth/login", json={"email": "ana@example.test", "password": password})
    assert response.status_code == 200, response.text
    return {"X-Session-Token": response.json()["session_token"]}


def test_password_hash_uses_unique_salt_and_rejects_bad_parameters():
    first, second = hash_password(PASSWORD), hash_password(PASSWORD)
    assert first != second
    assert first.startswith("scrypt$131072$8$1$")
    assert PASSWORD not in first
    assert verify_password(PASSWORD, first)
    assert not verify_password("incorrecta", first)
    assert not verify_password(PASSWORD, first.replace("131072", "1073741824"))
    assert not verify_password(PASSWORD, "plaintext")


def test_legacy_and_required_modes_and_shared_key_remain_fail_closed(client, monkeypatch):
    assert client.get("/api/auth/status").json() == {"configured": False, "required": False}
    assert client.get("/api/vehicles").status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/setup", json={"token": SETUP_TOKEN, "name": "Admin", "email": "a@example.test", "password": PASSWORD}).status_code == 503
    bad_key = client.get("/api/auth/status", headers={"X-API-Key": "bad"})
    assert bad_key.status_code == 401 and bad_key.headers["X-Auth-Error"] == "api-key"
    monkeypatch.setenv("YOKOHAMA_REQUIRE_AUTH", "true")
    with TestClient(create_app(database_url="sqlite:///:memory:", api_key="test")) as required:
        required.headers.update({"X-API-Key": "test"})
        assert required.get("/api/auth/status").json() == {"configured": False, "required": True}
        for path in ("/api/vehicles", "/api/catalog", "/api/variants", "/api/users"):
            assert required.get(path).status_code == 401


def test_setup_is_one_time_and_sessions_never_store_raw_tokens(company):
    client = company["client"]
    assert client.get("/api/auth/status").json() == {"configured": True, "required": True}
    assert client.get("/api/vehicles").status_code == 401
    assert client.get("/api/catalog").status_code == 401
    assert client.post("/api/auth/setup", json={"token": SETUP_TOKEN, "name": "Intruso", "email": "second@example.test", "password": PASSWORD}).status_code == 409
    token = company["user_token"]
    assert len(token) == 43
    with client.app.state.sessions() as session:
        stored = session.get(UserSession, token_digest(token))
        assert stored and stored.token_hash != token
        user = session.get(CompanyUser, company["user"]["id"])
        assert user.password_hash.startswith("scrypt$") and PASSWORD not in user.password_hash
    profiles = client.get("/api/users", headers=company["admin_headers"]).json()
    assert len(profiles) == 2
    assert all("password_hash" not in item and "session_token" not in item for item in profiles)


def test_user_cannot_read_other_units_or_global_admin_endpoints(company):
    client, headers = company["client"], company["user_headers"]
    first, second = company["first"]["id"], company["second"]["id"]
    assert [row["id"] for row in client.get("/api/vehicles", headers=headers).json()] == [first]
    assert client.get(f"/api/vehicles/{first}", headers=headers).status_code == 200
    for path in (f"/api/vehicles/{second}", f"/api/vehicles/{second}/incidents", f"/api/vehicles/{second}/odometer-evidence", f"/api/vehicles/{second}/evidence"):
        assert client.get(path, headers=headers).status_code == 404, path
    for path in ("/api/users", "/api/notifications", "/api/metrics", "/api/alerts", "/api/calendar",
                 "/api/document-alerts", "/api/catalog", "/api/variants", f"/api/vehicles/{first}/plan",
                 f"/api/vehicles/{first}/administration-history", f"/api/vehicles/{second}/administration-history"):
        assert client.get(path, headers=headers).status_code == 403, path
    assert client.get("/api/auth/me", headers=headers).json()["vehicle_ids"] == [first]
    assert len(client.get("/api/vehicles", headers=company["admin_headers"]).json()) == 2


def test_aggregates_and_private_photo_scope(company):
    client, admin, user = company["client"], company["admin_headers"], company["user_headers"]
    own, other = company["first"]["id"], company["second"]["id"]
    today = local_today().isoformat()
    private_photo = None
    for vehicle_id in (own, other):
        assert client.patch(f"/api/vehicles/{vehicle_id}/administration", headers=admin, json={
            "circulation_card_expires_on": today, "plates_expires_on": today, "vehicle_tax_due_on": today,
        }).status_code == 200
        incident = client.post(f"/api/vehicles/{vehicle_id}/incidents", headers=admin,
                              json={"occurred_on": today, "category": "otro", "description": "Detalle administrativo pendiente", "photos": [photo()]})
        assert incident.status_code == 201, incident.text
        if vehicle_id == other:
            private_photo = incident.json()["photos"][0]["id"]
        service = client.post(f"/api/vehicles/{vehicle_id}/services/batch", headers=admin,
                              json={"performed_on": today, "manual_description": "Revisión administrativa"})
        assert service.status_code == 201, service.text
    assert client.get(f"/api/evidence/{private_photo}", headers=user).status_code == 404
    assert client.get(f"/api/evidence/{private_photo}", headers=admin).status_code == 200
    for path in ("/api/alerts", "/api/document-alerts", f"/api/calendar?start={today}&end={today}"):
        assert client.get(path, headers=user).status_code == 403
    assert client.get("/api/incidents", headers=user).json() == []
    created = client.post(f"/api/vehicles/{own}/incidents", headers=user,
                          json={"occurred_on": today, "category": "otro", "description": "Mi propio reporte", "photos": [photo()]})
    assert created.status_code == 201, created.text
    own_reports = client.get("/api/incidents", headers=user).json()
    assert len(own_reports) == 1 and own_reports[0]["captured_by"] == company["user"]["id"]
    history = client.get(f"/api/vehicles/{own}/administration-history", headers=user)
    assert history.status_code == 403


def test_user_allowed_captures_and_denied_admin_mutations(company):
    client, headers = company["client"], company["user_headers"]
    own, other = company["first"]["id"], company["second"]["id"]
    yesterday = (local_today() - timedelta(days=1)).isoformat()
    reading = client.post(f"/api/vehicles/{own}/odometer-captures", headers=headers, json={"date": yesterday, "odometer_km": 9950})
    assert reading.status_code == 201, reading.text
    evidence = client.post(f"/api/vehicles/{own}/odometer-evidence", headers=headers, json={"reading_id": reading.json()["id"], "photo": photo()})
    assert evidence.status_code == 201, evidence.text
    assert evidence.json()["captured_by"] == company["user"]["id"]
    incident_data = {"occurred_on": yesterday, "category": "averia", "description": "La unidad presenta un ruido extraño"}
    incident = client.post(f"/api/vehicles/{own}/incidents", headers=headers, json=incident_data)
    assert incident.status_code == 201, incident.text
    assert incident.json()["captured_by"] == company["user"]["id"]
    assert client.post(f"/api/vehicles/{other}/incidents", headers=headers, json=incident_data).status_code == 404
    assert client.post(f"/api/vehicles/{other}/odometer-captures", headers=headers, json={"date": yesterday, "odometer_km": 9950}).status_code == 404
    for method, path, data in (
        ("post", "/api/vehicles", {}), ("patch", f"/api/vehicles/{own}", {"drivers": []}),
        ("patch", f"/api/vehicles/{own}/administration", {"nickname": "Cambio"}),
        ("patch", f"/api/vehicles/{own}/administration", {"vehicle_tax_due_on": yesterday, "vehicle_tax_paid_on": yesterday}),
        ("post", f"/api/vehicles/{own}/services/batch", {}),
        ("post", f"/api/vehicles/{own}/readings", {"date": yesterday, "odometer_km": 9950}),
        ("post", f"/api/vehicles/{own}/readings/batch", {}),
        ("post", f"/api/vehicles/{own}/appointments", {}), ("post", "/api/recalculate", {}),
        ("patch", f"/api/incidents/{incident.json()['id']}", {"status": "resuelta", "resolution_notes": "Todo reparado"}),
        ("post", "/api/users", {"role": "admin"}), ("patch", f"/api/users/{company['user']['id']}", {"role": "admin"}),
    ):
        response = getattr(client, method)(path, headers=headers, json=data)
        assert response.status_code == 403, (path, response.text)


def test_reassignment_revokes_existing_sessions_and_driver_names_are_not_accounts(company):
    client, admin, user = company["client"], company["admin_headers"], company["user_headers"]
    own, other = company["first"]["id"], company["second"]["id"]
    assert client.patch(f"/api/vehicles/{other}", headers=admin, json={"drivers": [company["user"]["name"]]}).status_code == 200
    assert client.get(f"/api/vehicles/{other}", headers=user).status_code == 404
    assert client.patch(f"/api/users/{company['user']['id']}", headers=admin, json={"vehicle_ids": [other]}).status_code == 200
    assert client.get("/api/auth/me", headers=user).status_code == 401
    user = driver_login(client)
    assert client.get(f"/api/vehicles/{own}", headers=user).status_code == 404
    assert client.get(f"/api/vehicles/{other}", headers=user).status_code == 200
    assert client.patch(f"/api/users/{company['user']['id']}", headers=admin, json={"vehicle_ids": []}).status_code == 200
    assert client.get("/api/auth/me", headers=user).status_code == 401
    user = driver_login(client)
    assert client.get("/api/vehicles", headers=user).json() == []


def test_logout_expiry_deactivation_and_password_changes_revoke_sessions(company):
    client, admin, user = company["client"], company["admin_headers"], company["user_headers"]
    assert client.post("/api/auth/logout", headers=user).status_code == 200
    assert client.get("/api/auth/me", headers=user).status_code == 401
    def login():
        response = client.post("/api/auth/login", json={"email": "ana@example.test", "password": PASSWORD})
        assert response.status_code == 200, response.text
        return {"X-Session-Token": response.json()["session_token"]}
    expired = login()
    with client.app.state.sessions.begin() as session:
        row = session.get(UserSession, token_digest(expired["X-Session-Token"]))
        row.expires_at = utc_now() - timedelta(seconds=1)
    assert client.get("/api/auth/me", headers=expired).status_code == 401
    active = login()
    assert client.patch(f"/api/users/{company['user']['id']}", headers=admin, json={"active": False}).status_code == 200
    assert client.get("/api/auth/me", headers=active).status_code == 401
    assert client.post("/api/auth/login", json={"email": "ana@example.test", "password": PASSWORD}).status_code == 401
    assert client.patch(f"/api/users/{company['user']['id']}", headers=admin, json={"active": True}).status_code == 200
    active, another = login(), login()
    assert client.post("/api/auth/password", headers=active, json={"current_password": PASSWORD, "new_password": NEW_PASSWORD}).status_code == 200
    assert client.get("/api/auth/me", headers=active).status_code == 401
    assert client.get("/api/auth/me", headers=another).status_code == 401
    changed = client.post("/api/auth/login", json={"email": "ana@example.test", "password": NEW_PASSWORD})
    assert changed.status_code == 200, changed.text


def test_last_admin_cannot_be_removed_and_invalid_assignments_are_atomic(company):
    client, admin = company["client"], company["admin_headers"]
    admin_id = company["admin"]["user"]["id"]
    user_id = company["user"]["id"]
    for change in ({"role": "user"}, {"active": False}):
        assert client.patch(f"/api/users/{admin_id}", headers=admin, json=change).status_code == 409
    assert client.patch(f"/api/users/{user_id}", headers=admin, json={"name": "No se guardará", "vehicle_ids": [999999]}).status_code == 422
    assert client.get("/api/auth/me", headers=company["user_headers"]).json()["name"] == company["user"]["name"]
    for change in ({"role": "superadmin"}, {"active": None}, {"vehicle_ids": [True]}, {"password": "corta"}, {"password_hash": "forged"}):
        assert client.patch(f"/api/users/{user_id}", headers=admin, json=change).status_code == 422
    assert client.post("/api/users", headers=admin, json={"name": "Otro admin", "email": "second-admin@example.test", "password": PASSWORD, "role": "admin"}).status_code == 403
    assert client.patch(f"/api/users/{user_id}", headers=admin, json={"role": "admin"}).status_code == 403
    assert client.patch(f"/api/users/{admin_id}", headers=admin, json={"email": "other@example.test"}).status_code == 409
    assert client.patch(f"/api/users/{user_id}", headers=admin, json={"email": OWNER_EMAIL}).status_code == 409
    assert client.get("/api/users", headers=admin).status_code == 200


def test_invalid_current_password_and_unchanged_sensitive_fields_keep_valid_session(company):
    client, admin, user = company["client"], company["admin_headers"], company["user_headers"]
    rejected = client.post("/api/auth/password", headers=user, json={"current_password": "incorrecta", "new_password": NEW_PASSWORD})
    assert rejected.status_code == 400
    assert client.get("/api/auth/me", headers=user).status_code == 200
    updated = client.patch(f"/api/users/{company['user']['id']}", headers=admin,
                           json={"name": "Nombre actualizado", "email": company["user"]["email"], "role": "user", "active": True,
                                 "vehicle_ids": [company["first"]["id"]]})
    assert updated.status_code == 200, updated.text
    profile = client.get("/api/auth/me", headers=user)
    assert profile.status_code == 200
    assert profile.json()["name"] == "Nombre actualizado"
    assert profile.json()["vehicle_ids"] == [company["first"]["id"]]
    assert client.get(f"/api/vehicles/{company['second']['id']}", headers=user).status_code == 404


def test_login_errors_are_generic_and_rate_limited(company):
    client = company["client"]
    unknown = client.post("/api/auth/login", json={"email": "unknown@example.test", "password": "incorrecta"})
    wrong = client.post("/api/auth/login", json={"email": "ana@example.test", "password": "incorrecta"})
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json() == {"detail": "Correo o contraseña incorrectos."}
    for _ in range(7):
        assert client.post("/api/auth/login", json={"email": "unknown@example.test", "password": "incorrecta"}).status_code == 401
    limited = client.post("/api/auth/login", json={"email": "unknown@example.test", "password": "incorrecta"})
    assert limited.status_code == 429 and limited.headers["Retry-After"] == "900"
    assert client.get("/api/auth/me", headers={"X-Session-Token": "?" * 43}).status_code == 401


def test_only_reserved_owner_can_be_bootstrapped(client):
    client.app.state.auth.setup_token = SETUP_TOKEN
    rejected = client.post("/api/auth/setup", json={"token": SETUP_TOKEN, "name": "Otro admin", "email": "other@example.test", "password": PASSWORD})
    assert rejected.status_code == 403
    assert client.get("/api/auth/status").json()["configured"] is False
    accepted = client.post("/api/auth/setup", json={"token": SETUP_TOKEN, "name": "Admin", "email": " ADMIN.YOKO@GMAIL.COM ", "password": PASSWORD})
    assert accepted.status_code == 201, accepted.text
    assert accepted.json()["user"]["email"] == OWNER_EMAIL
    assert accepted.json()["user"]["role"] == "admin"


def test_legacy_admin_rows_cannot_keep_admin_privileges_or_leak_other_accounts(company):
    client = company["client"]
    with client.app.state.sessions.begin() as session:
        legacy = CompanyUser(name="Administrador anterior", email="old-admin@example.test", role="admin", active=True, password_hash=hash_password(PASSWORD))
        session.add(legacy)
        session.flush()
        session.add(UserVehicleAssignment(user_id=legacy.id, vehicle_id=company["first"]["id"]))
    response = client.post("/api/auth/login", json={"email": "old-admin@example.test", "password": PASSWORD})
    assert response.status_code == 200, response.text
    assert response.json()["user"]["role"] == "user"
    headers = {"X-Session-Token": response.json()["session_token"]}
    assert client.get("/api/auth/me", headers=headers).json()["role"] == "user"
    assert client.get("/api/users", headers=headers).status_code == 403
    assert client.post("/api/users", headers=headers, json={"name": "Cuenta", "email": "new@example.test", "password": PASSWORD}).status_code == 403
    assert [vehicle["id"] for vehicle in client.get("/api/vehicles", headers=headers).json()] == [company["first"]["id"]]
    assert client.get(f"/api/vehicles/{company['second']['id']}", headers=headers).status_code == 404


def test_driver_password_reset_is_private_and_revokes_all_driver_sessions(company):
    client, admin = company["client"], company["admin_headers"]
    other_session = driver_login(client)
    response = client.patch(f"/api/users/{company['user']['id']}", headers=admin, json={"password": NEW_PASSWORD})
    assert response.status_code == 200, response.text
    assert "password" not in response.text
    assert PASSWORD not in response.text and NEW_PASSWORD not in response.text
    for headers in (company["user_headers"], other_session):
        assert client.get("/api/auth/me", headers=headers).status_code == 401
    assert client.post("/api/auth/login", json={"email": "ana@example.test", "password": PASSWORD}).status_code == 401
    fresh = driver_login(client, NEW_PASSWORD)
    assert client.get("/api/auth/me", headers=fresh).status_code == 200
    assert client.get("/api/users", headers=admin).status_code == 200


def test_owner_password_change_hides_secret_and_revokes_existing_sessions(company):
    client, admin = company["client"], company["admin_headers"]
    response = client.post("/api/auth/login", json={"email": "ADMIN.YOKO@GMAIL.COM", "password": PASSWORD})
    assert response.status_code == 200 and response.json()["user"]["role"] == "admin"
    other_session = {"X-Session-Token": response.json()["session_token"]}
    changed = client.post("/api/auth/password", headers=admin, json={"current_password": PASSWORD, "new_password": NEW_PASSWORD})
    assert changed.status_code == 200, changed.text
    assert PASSWORD not in changed.text and NEW_PASSWORD not in changed.text and "password_hash" not in changed.text
    for headers in (admin, other_session):
        assert client.get("/api/auth/me", headers=headers).status_code == 401
    response = client.post("/api/auth/login", json={"email": OWNER_EMAIL, "password": NEW_PASSWORD})
    assert response.status_code == 200 and response.json()["user"]["role"] == "admin"


def test_invalid_assignment_update_preserves_assignment_and_sessions(company):
    client, admin, user = company["client"], company["admin_headers"], company["user_headers"]
    rejected = client.patch(f"/api/users/{company['user']['id']}", headers=admin,
                            json={"password": NEW_PASSWORD, "vehicle_ids": [999999]})
    assert rejected.status_code == 422
    assert client.get("/api/auth/me", headers=user).json()["vehicle_ids"] == [company["first"]["id"]]
    assert driver_login(client)


def test_provision_owner_preserves_existing_records_and_demotes_other_admins(company):
    from app.provision_owner import provision_owner

    client = company["client"]
    old_session = driver_login(client)
    with client.app.state.sessions.begin() as session:
        user = session.get(CompanyUser, company["user"]["id"])
        user.role = "admin"
        previous_user_hash = user.password_hash
        previous_assignments = list(session.scalars(select(UserVehicleAssignment.vehicle_id).where(UserVehicleAssignment.user_id == user.id)))
        result = provision_owner(session, NEW_PASSWORD)
        assert result == {"email": OWNER_EMAIL, "previous_admins_demoted": 1, "created": False}
        assert user.role == "user" and user.password_hash == previous_user_hash
        assert list(session.scalars(select(UserVehicleAssignment.vehicle_id).where(UserVehicleAssignment.user_id == user.id))) == previous_assignments
    assert client.get("/api/auth/me", headers=old_session).status_code == 401
    assert client.get("/api/auth/me", headers=company["admin_headers"]).status_code == 401
    login = client.post("/api/auth/login", json={"email": OWNER_EMAIL, "password": NEW_PASSWORD})
    assert login.status_code == 200 and login.json()["user"]["role"] == "admin"
    assert len(client.get("/api/vehicles", headers={"X-Session-Token": login.json()["session_token"]}).json()) == 2
