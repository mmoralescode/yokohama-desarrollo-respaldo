"""Documents share the unit boundary without sharing other authors' reports."""
import pytest
from sqlalchemy import func, select
from app.models import VehicleEvidence, VehicleIncident
from app.time_utils import local_today
from test_accounts import PASSWORD, company, driver_login, photo
from test_api import client, vehicle_data


def add_coassigned_driver(company):
    client = company["client"]
    response = client.post("/api/users", headers=company["admin_headers"], json={
        "name": "Conductor alterno", "email": "other@example.test", "password": PASSWORD,
        "role": "user", "vehicle_ids": [company["first"]["id"]],
    })
    assert response.status_code == 201
    login = client.post("/api/auth/login", json={"email": "other@example.test", "password": PASSWORD})
    assert login.status_code == 200
    return {"X-Session-Token": login.json()["session_token"]}


def test_admin_document_is_visible_to_assigned_driver_without_duplicate_incidents(company):
    client, vehicle_id = company["client"], company["first"]["id"]
    url = f"/api/vehicles/{vehicle_id}/documents"
    response = client.post(url, headers=company["admin_headers"], json={
        "document_type": "circulation", "notes": "Tarjeta vigente", "photos": [photo()],
    })
    assert response.status_code == 201, response.text
    metadata = response.json()["photos"][0]
    assert metadata["document_type"] == "circulation"
    assert metadata["captured_by"] == company["admin"]["user"]["id"]
    assert "data_url" not in metadata and "content" not in metadata
    driver_metadata = client.get(url, headers=company["user_headers"]).json()
    assert driver_metadata == [metadata]
    downloaded = client.get(f"/api/evidence/{metadata['id']}", headers=company["user_headers"])
    assert downloaded.status_code == 200
    assert downloaded.json()["data_url"].startswith("data:image/jpeg;base64,")
    assert downloaded.headers["Cache-Control"] == "no-store"
    assert client.get(f"/api/vehicles/{vehicle_id}/evidence", headers=company["user_headers"]).json() == []
    assert client.get("/api/incidents", headers=company["admin_headers"]).json() == []
    with client.app.state.sessions() as session:
        assert session.scalar(select(func.count(VehicleIncident.id))) == 0


def test_coassigned_drivers_share_documents_but_not_report_photos(company):
    client, vehicle_id = company["client"], company["first"]["id"]
    other = add_coassigned_driver(company)
    url = f"/api/vehicles/{vehicle_id}"
    doc = client.post(url + "/documents", headers=other, json={
        "document_type": "verification", "photos": [photo()],
    }).json()["photos"][0]
    incident = client.post(url + "/incidents", headers=other, json={
        "category": "documentacion", "occurred_on": local_today().isoformat(),
        "description": "Documento faltante reportado", "photos": [photo()],
    }).json()
    assert [row["id"] for row in client.get(url + "/documents", headers=company["user_headers"]).json()] == [doc["id"]]
    assert client.get(f"/api/evidence/{doc['id']}", headers=company["user_headers"]).status_code == 200
    assert client.get(f"/api/evidence/{incident['photos'][0]['id']}", headers=company["user_headers"]).status_code == 404
    assert client.get(url + "/incidents", headers=company["user_headers"]).json() == []
    assert client.post(url + "/evidence", headers=company["user_headers"], json={
        "incident_id": incident["id"], "photos": [photo()],
    }).status_code == 404


def test_document_access_is_lost_after_reassignment_and_other_unit_is_hidden(company):
    client, own, other = company["client"], company["first"]["id"], company["second"]["id"]
    document = client.post(f"/api/vehicles/{other}/documents", headers=company["admin_headers"],
                           json={"document_type": "plates", "photos": [photo()]}).json()["photos"][0]
    assert client.get(f"/api/vehicles/{other}/documents", headers=company["user_headers"]).status_code == 404
    assert client.post(f"/api/vehicles/{other}/documents", headers=company["user_headers"],
                       json={"document_type": "plates", "photos": [photo()]}).status_code == 404
    assert client.get(f"/api/evidence/{document['id']}", headers=company["user_headers"]).status_code == 404
    own_doc = client.post(f"/api/vehicles/{own}/documents", headers=company["admin_headers"],
                         json={"document_type": "other", "photos": [photo()]}).json()["photos"][0]
    assert client.patch(f"/api/users/{company['user']['id']}", headers=company["admin_headers"],
                        json={"vehicle_ids": [other]}).status_code == 200
    assert client.get(f"/api/evidence/{own_doc['id']}", headers=company["user_headers"]).status_code == 401
    fresh = driver_login(client)
    assert client.get(f"/api/evidence/{own_doc['id']}", headers=fresh).status_code == 404
    assert client.get(f"/api/evidence/{document['id']}", headers=fresh).status_code == 200


@pytest.mark.parametrize("invalid", [
    {"document_type": "incident", "photos": [photo()]},
    {"document_type": "verification", "photos": []},
    {"document_type": "verification", "photos": [photo()] * 4},
    {"document_type": "plates", "incident_id": "forged", "photos": [photo()]},
    {"document_type": "plates", "notes": "x" * 2001, "photos": [photo()]},
    {"document_type": "plates", "photos": [photo(), {"filename": "bad.jpg", "data_url": "data:image/jpeg;base64,bm90YW5pbWFnZQ=="}]},
])
def test_invalid_document_batches_are_atomic(company, invalid):
    client = company["client"]
    response = client.post(f"/api/vehicles/{company['first']['id']}/documents", headers=company["admin_headers"], json=invalid)
    assert response.status_code == 422, response.text
    with client.app.state.sessions() as session:
        assert session.scalar(select(func.count(VehicleEvidence.id))) == 0


def test_verification_single_deadline_preserves_optional_existing_start(client, vehicle_data):
    response = client.post("/api/vehicles", json=vehicle_data | {"verification_period_end": "2026-12-31"})
    assert response.status_code == 201, response.text
    row = response.json()
    assert row["verification_period_start"] is None
    assert row["verification_period_end"] == "2026-12-31"
    url = f"/api/vehicles/{row['id']}/administration"
    assert client.patch(url, json={"verification_period_end": "2027-06-30"}).status_code == 200
    assert client.patch(url, json={"verification_period_start": "2027-01-01"}).status_code == 200
    assert client.patch(url, json={"verification_period_end": "2026-12-31"}).status_code == 422
    assert client.patch(url, json={"verification_period_end": None}).status_code == 422
    assert client.patch(url, json={"verification_period_start": None}).status_code == 200


def test_schema_rejects_missing_double_and_unknown_document_targets(client, vehicle_data):
    vehicle = client.post("/api/vehicles", json=vehicle_data).json()
    template = {"id": "constraint-test", "vehicle_id": vehicle["id"], "filename": "safe.jpg", "mime_type": "image/jpeg",
                "content": b"synthetic-only", "size_bytes": 14, "width": 1, "height": 1, "notes": ""}
    from sqlalchemy.exc import IntegrityError
    for target in ({}, {"document_type": "invalid"}, {"document_type": "plates", "reading_id": 1}):
        with pytest.raises(IntegrityError):
            with client.app.state.sessions.begin() as session:
                session.add(VehicleEvidence(**(template | target)))
    with client.app.state.sessions.begin() as session:
        session.add(VehicleEvidence(**(template | {"document_type": "plates"})))
