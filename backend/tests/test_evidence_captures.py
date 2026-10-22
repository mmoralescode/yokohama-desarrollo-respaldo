"""Interactive evidence is atomic and isolated even for coassigned operators."""
from datetime import timedelta

from sqlalchemy import func, select

from app.models import FaultReport, OdometerReading, VehicleEvidence
from app.time_utils import local_today
from test_accounts import company, PASSWORD, photo
from test_administration import photo_payload
from test_api import client, vehicle, vehicle_data


def test_atomic_odometer_bad_photo_never_creates_orphan_or_changes_km(client, vehicle):
    url = f"/api/vehicles/{vehicle['id']}/odometer-captures"
    payload = {"date": (local_today() - timedelta(days=1)).isoformat(), "odometer_km": 9950,
               "photos": [photo_payload(), {"filename": "broken.png", "data_url": "data:image/png;base64,YmFk"}]}
    with client.app.state.sessions() as session:
        count = session.scalar(select(func.count()).select_from(OdometerReading))
    assert client.post(url, json=payload).status_code == 422
    with client.app.state.sessions() as session:
        assert session.scalar(select(func.count()).select_from(OdometerReading)) == count
        assert session.scalar(select(func.count()).select_from(VehicleEvidence)) == 0
    response = client.post(url, json=payload | {"photos": [photo_payload()]})
    assert response.status_code == 201, response.text
    row = response.json()
    assert len(row["photos"]) == 1 and row["photos"][0]["reading_id"] == row["id"]
    assert row["captured_at"] and row["captured_at"][:10] != row["date"]
    assert client.get(f"/api/vehicles/{vehicle['id']}/evidence").json()[0]["id"] == row["photos"][0]["id"]


def test_pending_evidence_can_be_attached_later_and_invalid_batch_is_atomic(client, vehicle):
    url = f"/api/vehicles/{vehicle['id']}"
    fault = client.post(url + "/faults", json={"description": "Golpe observado en carrocería", "severity": "menor",
                       "reported_on": (local_today() - timedelta(days=2)).isoformat()}).json()
    assert fault["photos"] == []
    body = {"fault_id": fault["id"], "photos": [photo_payload(), {"filename": "bad.png", "data_url": "data:image/png;base64,YmFk"}]}
    assert client.post(url + "/evidence", json=body).status_code == 422
    assert client.get(url + "/evidence").json() == []
    attached = client.post(url + "/evidence", json=body | {"photos": [photo_payload()]})
    assert attached.status_code == 201, attached.text
    assert client.get(url).json()["faults"][0]["photos"][0]["fault_id"] == fault["id"]
    assert client.post(url + "/evidence", json={"fault_id": fault["id"], "reading_id": 1, "photos": [photo_payload()]}).status_code == 422


def test_admin_services_and_downtime_support_evidence_without_duplicate_blobs(client, vehicle):
    url = f"/api/vehicles/{vehicle['id']}"
    service = client.post(url + "/services/batch", json={"performed_on": local_today().isoformat(),
                          "service_ids": ["aceite_normal", "filtro_motor"], "photos": [photo_payload()]})
    assert service.status_code == 201, service.text
    batch = service.json()
    assert len(batch["photos"]) == 1
    assert sum(len(record["photos"]) for record in batch["records"]) == 1
    start = (local_today() - timedelta(days=1)).isoformat() + "T09:00:00-06:00"
    downtime = client.post(url + "/downtime", json={"started_at": start, "photos": [photo_payload()]})
    assert downtime.status_code == 201, downtime.text
    assert downtime.json()["photos"][0]["downtime_id"] == downtime.json()["id"]


def test_resolution_photos_and_status_change_are_atomic(client, vehicle):
    url = f"/api/vehicles/{vehicle['id']}"
    bad = {"filename": "broken.png", "data_url": "data:image/png;base64,YmFk"}
    fault = client.post(url + "/faults", json={"description": "Falla por reparar en el taller", "severity": "menor"}).json()
    resolve = f"/api/faults/{fault['id']}/resolve"
    assert client.patch(resolve, json={"resolution_notes": "Reparación completa", "photos": [bad]}).status_code == 422
    assert client.get(url).json()["faults"][0]["status"] == "open"
    response = client.patch(resolve, json={"resolution_notes": "Reparación completa", "photos": [photo_payload()]})
    assert response.status_code == 200 and response.json()["status"] == "resolved"
    assert len(response.json()["photos"]) == 1
    incident = client.post(url + "/incidents", json={"occurred_on": local_today().isoformat(), "category": "otro",
                           "description": "Detalle por resolver con evidencia"}).json()
    resolve_incident = f"/api/incidents/{incident['id']}"
    assert client.patch(resolve_incident, json={"status": "resuelta", "resolution_notes": "Reparación completa", "photos": [bad]}).status_code == 422
    assert client.get(url + "/incidents").json()[0]["status"] == "abierta"
    result = client.patch(resolve_incident, json={"status": "resuelta", "resolution_notes": "Reparación completa", "photos": [photo_payload()]})
    assert result.status_code == 200 and len(result.json()["photos"]) == 1


def test_coassigned_drivers_only_own_reports_and_photos_and_reassignment_revokes_access(company):
    client, admin, driver = company["client"], company["admin_headers"], company["user_headers"]
    vehicle_id = company["first"]["id"]
    url = f"/api/vehicles/{vehicle_id}"
    second = client.post("/api/users", headers=admin, json={"name": "Otro conductor", "email": "otro@example.test",
                         "password": PASSWORD, "role": "user", "vehicle_ids": [vehicle_id]}).json()
    login = client.post("/api/auth/login", json={"email": second["email"], "password": PASSWORD}).json()
    other = {"X-Session-Token": login["session_token"]}
    incident_data = {"occurred_on": local_today().isoformat(), "category": "otro", "description": "Daño por revisar en el taller", "photos": [photo()]}
    own_incident = client.post(url + "/incidents", headers=driver, json=incident_data).json()
    foreign_incident = client.post(url + "/incidents", headers=other, json=incident_data).json()
    own_fault = client.post(url + "/faults", headers=driver, json={"description": "Ruido extraño al conducir", "severity": "menor", "photos": [photo()]}).json()
    own_reading = client.post(url + "/odometer-captures", headers=driver, json={
        "date": (local_today() - timedelta(days=1)).isoformat(), "odometer_km": 9950, "photos": [photo()]}).json()
    assert own_reading["captured_by"] == company["user"]["id"]
    assert [row["id"] for row in client.get("/api/incidents", headers=driver).json()] == [own_incident["id"]]
    assert [row["id"] for row in client.get(url + "/incidents", headers=driver).json()] == [own_incident["id"]]
    assert client.get(f"/api/evidence/{foreign_incident['photos'][0]['id']}", headers=driver).status_code == 404
    assert client.post(url + "/evidence", headers=driver, json={"incident_id": foreign_incident["id"], "photos": [photo()]}).status_code == 404
    assert client.post(url + "/evidence", headers=other, json={"reading_id": own_reading["id"], "photos": [photo()]}).status_code == 404
    detail = client.get(url, headers=other).json()
    assert detail["readings"] == [] and detail["faults"] == [] and detail["history"] == [] and detail["downtime"] == []
    assert detail["vehicle"]["drivers"] == []
    own_detail = client.get(url, headers=driver).json()
    assert [row["id"] for row in own_detail["faults"]] == [own_fault["id"]]
    assert [row["id"] for row in own_detail["readings"]] == [own_reading["id"]]
    assert len(client.get(url + "/evidence", headers=driver).json()) == 3
    assert len(client.get(url + "/evidence", headers=admin).json()) == 4
    assert client.patch(f"/api/users/{company['user']['id']}", headers=admin, json={"vehicle_ids": []}).status_code == 200
    assert client.get(f"/api/evidence/{own_incident['photos'][0]['id']}", headers=driver).status_code == 401
    fresh_login = client.post("/api/auth/login", json={"email": company["user"]["email"], "password": PASSWORD}).json()
    driver = {"X-Session-Token": fresh_login["session_token"]}
    assert client.get(f"/api/evidence/{own_incident['photos'][0]['id']}", headers=driver).status_code == 404
    assert client.get(url + "/evidence", headers=driver).status_code == 404
