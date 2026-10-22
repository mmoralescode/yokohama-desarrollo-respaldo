import base64
from datetime import timedelta
from io import BytesIO

from PIL import Image
import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.administration import decode_photo
from app.models import OdometerReading, PlanEvaluation, VehicleAdministrationChange, VehicleEvidence, VehicleIncident
from app.planner import serialize
from app.schemas import EvidencePhoto
from app.time_utils import local_today, utc_now
from test_api import client, vehicle, vehicle_data


def photo_payload(format="PNG", *, size=(8, 6), filename="odometro.png"):
    output = BytesIO()
    image = Image.new("RGB", size, "blue")
    exif = image.getexif()
    exif[270] = "private location information"
    image.save(output, format=format, exif=exif)
    mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[format]
    return {"filename": filename, "data_url": f"data:{mime};base64,{base64.b64encode(output.getvalue()).decode()}"}


def reading_id(client, vehicle_id):
    return client.get(f"/api/vehicles/{vehicle_id}").json()["readings"][0]["id"]


def test_vehicle_create_administration_and_patch_without_forecast_rewrites(client, vehicle_data):
    fields = {"nickname": "Unidad de compras", "registration_state": "Puebla",
              "verification_period_start": "2026-07-01", "verification_period_end": "2026-12-31",
              "circulation_card_expires_on": "2027-05-01", "document_alert_days": 45}
    response = client.post("/api/vehicles", json=vehicle_data | fields)
    assert response.status_code == 201, response.text
    vehicle = response.json()
    assert all(vehicle[name] == value for name, value in fields.items())
    with client.app.state.sessions() as session:
        before = {row.id: serialize(row) for row in session.scalars(select(PlanEvaluation))}
    url = f"/api/vehicles/{vehicle['id']}/administration"
    changed = client.patch(url, json={"nickname": "Compras", "circulation_card_expires_on": None})
    assert changed.status_code == 200, changed.text
    assert changed.json()["nickname"] == "Compras"
    assert changed.json()["circulation_card_expires_on"] is None
    assert changed.json()["verification_period_start"] == "2026-07-01"
    assert client.patch(url, json={"verification_period_start": None}).status_code == 200
    assert client.patch(url, json={"verification_period_start": None, "verification_period_end": None}).status_code == 200
    with client.app.state.sessions() as session:
        assert {row.id: serialize(row) for row in session.scalars(select(PlanEvaluation))} == before


@pytest.mark.parametrize("invalid", [
    {}, {"nickname": ""}, {"nickname": "x" * 81}, {"document_alert_days": 0},
    {"document_alert_days": 181}, {"document_alert_days": None}, {"document_alert_days": True},
    {"verification_period_start": "2026-08-01"},
    {"verification_period_start": "2026-08-01", "verification_period_end": "2026-07-01"},
    {"plate": "OTHER"},
])
def test_admin_rejects_bad_partial_updates_atomically(client, vehicle, invalid):
    response = client.patch(f"/api/vehicles/{vehicle['id']}/administration", json=invalid)
    assert response.status_code == 422, response.text
    row = client.get(f"/api/vehicles/{vehicle['id']}").json()["vehicle"]
    assert row["nickname"] is None and row["document_alert_days"] == 30


def test_document_alert_window_expiry_boundary_and_clear(client, vehicle):
    today = local_today()
    url = f"/api/vehicles/{vehicle['id']}/administration"
    assert client.get("/api/document-alerts").json() == []
    update = {"verification_period_start": (today - timedelta(days=60)).isoformat(),
              "verification_period_end": (today - timedelta(days=1)).isoformat(),
              "circulation_card_expires_on": (today + timedelta(days=30)).isoformat()}
    assert client.patch(url, json=update).status_code == 200
    alerts = client.get("/api/document-alerts").json()
    assert [(row["severity"], row["days_remaining"]) for row in alerts] == [("critico", -1), ("importante", 30)]
    assert all(row["kind"] == "document" and row["vehicle_id"] == vehicle["id"] for row in alerts)
    assert client.patch(url, json={"circulation_card_expires_on": (today + timedelta(days=31)).isoformat()}).status_code == 200
    assert len(client.get("/api/document-alerts").json()) == 1
    assert client.patch(url, json={"verification_period_start": None, "verification_period_end": None}).status_code == 200
    assert client.get("/api/document-alerts").json() == []
    assert client.patch(url, json={"circulation_card_expires_on": today.isoformat()}).status_code == 200
    assert client.get("/api/document-alerts").json()[0]["message"].endswith("vence hoy.")


def test_multistate_fields_create_retroactive_payment_and_clear(client, vehicle_data):
    today = local_today()
    fields = {"plates_expires_on": (today + timedelta(days=30)).isoformat(),
              "vehicle_tax_due_on": (today - timedelta(days=60)).isoformat(),
              "vehicle_tax_paid_on": (today - timedelta(days=20)).isoformat(),
              "administrative_notes": "  Plazo confirmado en documento; pago capturado después.  "}
    response = client.post("/api/vehicles", json=vehicle_data | fields)
    assert response.status_code == 201, response.text
    row = response.json()
    assert row["administrative_notes"] == fields["administrative_notes"].strip()
    assert all(row[name] == fields[name] for name in fields if name != "administrative_notes")
    assert [alert["document_type"] for alert in client.get("/api/document-alerts").json()] == ["plates"]
    changed = client.patch(f"/api/vehicles/{row['id']}/administration", json={name: None for name in fields})
    assert changed.status_code == 200, changed.text
    assert all(changed.json()[name] is None for name in fields)


@pytest.mark.parametrize("invalid", [
    {"vehicle_tax_paid_on": (local_today() + timedelta(days=1)).isoformat(), "vehicle_tax_due_on": "2026-03-31"},
    {"vehicle_tax_paid_on": (local_today() - timedelta(days=1)).isoformat()},
    {"administrative_notes": "x" * 1501}, {"administrative_notes": "   "},
    {"plates_expires_on": "2026-02-30"}, {"vehicle_tax_due_on": "not-a-date"},
])
def test_multistate_invalid_create_and_patch_are_atomic(client, vehicle, vehicle_data, invalid):
    assert client.post("/api/vehicles", json=vehicle_data | {"vin": "DEM00000000000998", "plate": "TEST-998"} | invalid).status_code == 422
    url = f"/api/vehicles/{vehicle['id']}/administration"
    assert client.patch(url, json=invalid).status_code == 422
    current = client.get(f"/api/vehicles/{vehicle['id']}").json()["vehicle"]
    assert all(current[name] is None for name in ("plates_expires_on", "vehicle_tax_due_on", "vehicle_tax_paid_on", "administrative_notes"))


def test_tax_payment_suppresses_alert_but_new_period_requires_explicit_reset(client, vehicle):
    today = local_today()
    url = f"/api/vehicles/{vehicle['id']}/administration"
    due = (today - timedelta(days=30)).isoformat()
    paid = (today - timedelta(days=20)).isoformat()
    with client.app.state.sessions() as session:
        before = {row.id: serialize(row) for row in session.scalars(select(PlanEvaluation))}
    assert client.patch(url, json={"vehicle_tax_due_on": due}).status_code == 200
    alert = client.get("/api/document-alerts").json()[0]
    assert alert["document_type"] == "vehicle_tax" and alert["days_remaining"] == -30 and alert["severity"] == "critico"
    assert client.patch(url, json={"vehicle_tax_paid_on": paid}).status_code == 200
    assert client.get("/api/document-alerts").json() == []
    assert client.patch(url, json={"vehicle_tax_due_on": due, "nickname": "Con pago"}).status_code == 200
    for update in ({"vehicle_tax_due_on": today.isoformat()},
                   {"vehicle_tax_due_on": today.isoformat(), "vehicle_tax_paid_on": paid},
                   {"vehicle_tax_due_on": None}):
        response = client.patch(url, json=update)
        assert response.status_code == 422 and "pago anterior" in response.text
        saved = client.get(f"/api/vehicles/{vehicle['id']}").json()["vehicle"]
        assert saved["vehicle_tax_due_on"] == due and saved["vehicle_tax_paid_on"] == paid
    response = client.patch(url, json={"vehicle_tax_due_on": today.isoformat(), "vehicle_tax_paid_on": None})
    assert response.status_code == 200, response.text
    assert client.get("/api/document-alerts").json()[0]["days_remaining"] == 0
    # Early payment is valid too; it identifies the captured period, not a computed liability.
    assert client.patch(url, json={"vehicle_tax_paid_on": paid}).status_code == 200
    assert client.get("/api/document-alerts").json() == []
    with client.app.state.sessions() as session:
        # Detail GET may add a new evaluation, but no prior snapshot can be rewritten.
        assert {row.id: serialize(row) for row in session.scalars(select(PlanEvaluation).where(PlanEvaluation.id.in_(before)))} == before


def test_administration_history_keeps_previous_payment_and_records_only_effective_changes(client, vehicle):
    url = f"/api/vehicles/{vehicle['id']}/administration"
    history_url = f"/api/vehicles/{vehicle['id']}/administration-history"
    yesterday = (local_today() - timedelta(days=1)).isoformat()
    today = local_today().isoformat()
    assert client.get(history_url).json() == []
    assert client.patch(url, json={"vehicle_tax_due_on": yesterday, "vehicle_tax_paid_on": yesterday}).status_code == 200
    first = client.get(history_url).json()
    assert len(first) == 1
    assert first[0]["previous_values"] == {"vehicle_tax_due_on": None, "vehicle_tax_paid_on": None}
    assert first[0]["new_values"] == {"vehicle_tax_due_on": yesterday, "vehicle_tax_paid_on": yesterday}
    assert first[0]["changed_at"].endswith("+00:00") and first[0]["changed_by"] is None
    assert client.patch(url, json={"vehicle_tax_paid_on": yesterday}).status_code == 200
    assert client.patch(url, json={"vehicle_tax_due_on": today}).status_code == 422
    assert client.patch(url, json={"verification_period_start": yesterday}).status_code == 422
    assert client.get(history_url).json() == first
    assert client.patch(url, json={"vehicle_tax_due_on": today, "vehicle_tax_paid_on": None}).status_code == 200
    changes = client.get(history_url).json()
    assert len(changes) == 2 and changes[0]["id"] > changes[1]["id"]
    assert changes[0]["previous_values"] == {"vehicle_tax_due_on": yesterday, "vehicle_tax_paid_on": yesterday}
    assert changes[0]["new_values"] == {"vehicle_tax_due_on": today, "vehicle_tax_paid_on": None}
    assert changes[1] == first[0]
    assert client.get("/api/vehicles/999999/administration-history").status_code == 404


def test_administration_history_returns_latest_50_without_deleting_older_changes(client, vehicle):
    stamp = utc_now()
    with client.app.state.sessions.begin() as session:
        for index in range(52):
            session.add(VehicleAdministrationChange(vehicle_id=vehicle["id"], changed_at=stamp,
                                                    previous_values={"nickname": f"Unidad {index}"},
                                                    new_values={"nickname": f"Unidad {index + 1}"}))
    rows = client.get(f"/api/vehicles/{vehicle['id']}/administration-history").json()
    assert len(rows) == 50 and [row["id"] for row in rows] == list(range(52, 2, -1))
    with client.app.state.sessions() as session:
        assert session.scalar(select(func.count()).select_from(VehicleAdministrationChange)) == 52


def test_failed_history_write_rolls_back_vehicle_change(client, vehicle):
    def fail_history(session, _context, _instances):
        if any(isinstance(row, VehicleAdministrationChange) for row in session.new):
            raise RuntimeError("history write unavailable")

    event.listen(Session, "before_flush", fail_history)
    try:
        with pytest.raises(RuntimeError, match="history write unavailable"):
            client.patch(f"/api/vehicles/{vehicle['id']}/administration", json={"nickname": "No debe guardarse"})
    finally:
        event.remove(Session, "before_flush", fail_history)
    assert client.get(f"/api/vehicles/{vehicle['id']}").json()["vehicle"]["nickname"] is None
    assert client.get(f"/api/vehicles/{vehicle['id']}/administration-history").json() == []


def test_plates_and_unpaid_tax_respect_notice_window(client, vehicle):
    today = local_today()
    url = f"/api/vehicles/{vehicle['id']}/administration"
    assert client.patch(url, json={"plates_expires_on": (today + timedelta(days=31)).isoformat(),
                                   "vehicle_tax_due_on": (today + timedelta(days=30)).isoformat()}).status_code == 200
    alerts = client.get("/api/document-alerts").json()
    assert [(row["document_type"], row["days_remaining"]) for row in alerts] == [("vehicle_tax", 30)]
    assert client.patch(url, json={"document_alert_days": 31}).status_code == 200
    assert {row["document_type"] for row in client.get("/api/document-alerts").json()} == {"plates", "vehicle_tax"}


@pytest.mark.parametrize("format", ["PNG", "JPEG", "WEBP"])
def test_photos_decode_reencode_and_strip_metadata(format):
    decoded = decode_photo(EvidencePhoto(**photo_payload(format)))
    assert decoded["mime_type"] == "image/jpeg" and decoded["filename"].endswith(".jpg")
    with Image.open(BytesIO(decoded["content"])) as image:
        assert image.size == (8, 6) and image.format == "JPEG"
        assert not image.getexif()
        assert not image.info.get("icc_profile") and not image.info.get("xmp")


def test_attach_photo_to_existing_reading_keeps_odometer_and_forecasts(client, vehicle):
    rid = reading_id(client, vehicle["id"])
    with client.app.state.sessions() as session:
        before = {row.id: serialize(row) for row in session.scalars(select(PlanEvaluation))}
        reading_count = session.scalar(select(func.count()).select_from(OdometerReading))
    url = f"/api/vehicles/{vehicle['id']}/odometer-evidence"
    response = client.post(url, json={"reading_id": rid, "notes": "Capturada después del recorrido",
                                      "photo": photo_payload(filename="../../privado\\odometro.png")})
    assert response.status_code == 201, response.text
    created = response.json()
    assert created["reading_id"] == rid and created["filename"] == "odometro.jpg"
    assert created["odometer_km"] == 10000
    assert "data_url" not in created and "content" not in created
    rows = client.get(url).json()
    assert len(rows) == 1 and rows[0]["id"] == created["id"]
    assert rows[0]["captured_at"].endswith("+00:00")
    image = client.get(f"/api/evidence/{created['id']}")
    assert image.status_code == 200 and image.json()["data_url"].startswith("data:image/jpeg;base64,")
    assert image.headers["cache-control"] == "no-store"
    with client.app.state.sessions() as session:
        assert session.scalar(select(func.count()).select_from(OdometerReading)) == reading_count
        assert {row.id: serialize(row) for row in session.scalars(select(PlanEvaluation))} == before


def test_reading_evidence_cannot_link_another_vehicle(client, vehicle, vehicle_data):
    other = client.post("/api/vehicles", json=vehicle_data | {"vin": "DEM00000000000998", "plate": "OTHER-998"}).json()
    response = client.post(f"/api/vehicles/{vehicle['id']}/odometer-evidence",
                           json={"reading_id": reading_id(client, other["id"]), "photo": photo_payload()})
    assert response.status_code == 404
    assert client.get(f"/api/vehicles/{vehicle['id']}/odometer-evidence").json() == []


@pytest.mark.parametrize("photo", [
    {"filename": "script.svg", "data_url": "data:image/svg+xml;base64,PHN2Zz4="},
    {"filename": "fake.png", "data_url": "data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="},
    {"filename": "broken.png", "data_url": "data:image/png;base64,not.valid"},
    {"filename": "large.png", "data_url": "data:image/png;base64," + base64.b64encode(b"x" * (3 * 1024 * 1024 + 1)).decode()},
])
def test_invalid_images_leave_no_orphan_records(client, vehicle, photo):
    response = client.post(f"/api/vehicles/{vehicle['id']}/odometer-evidence",
                           json={"reading_id": reading_id(client, vehicle["id"]), "photo": photo})
    assert response.status_code == 422, response.text[:500]
    assert client.get(f"/api/vehicles/{vehicle['id']}/odometer-evidence").json() == []


def test_dimensions_and_declared_mime_validated(client, vehicle):
    url = f"/api/vehicles/{vehicle['id']}/odometer-evidence"
    for photo in (photo_payload(size=(10_001, 1)), photo_payload() | {
            "data_url": photo_payload()["data_url"].replace("image/png", "image/jpeg")}):
        response = client.post(url, json={"reading_id": reading_id(client, vehicle["id"]), "photo": photo})
        assert response.status_code == 422


def test_incident_late_capture_photos_and_resolution(client, vehicle):
    url = f"/api/vehicles/{vehicle['id']}/incidents"
    actual_day = (local_today() - timedelta(days=8)).isoformat()
    response = client.post(url, json={"occurred_on": actual_day, "category": "otro",
                                      "description": "Daño observado en el estacionamiento", "photos": [photo_payload()]})
    assert response.status_code == 201, response.text
    incident = response.json()
    assert incident["occurred_on"] == actual_day and incident["captured_at"][:10] != actual_day
    assert incident["status"] == "abierta" and len(incident["photos"]) == 1
    assert incident["plate"] == vehicle["plate"]
    assert client.get("/api/incidents").json()[0]["id"] == incident["id"]
    patch = f"/api/incidents/{incident['id']}"
    assert client.patch(patch, json={"status": "resuelta"}).status_code == 422
    assert client.patch(patch, json={"status": "en_revision"}).status_code == 200
    resolved = client.patch(patch, json={"status": "resuelta", "resolution_notes": "Daño reparado por el taller"})
    assert resolved.status_code == 200 and resolved.json()["status"] == "resuelta"
    assert client.get(url).json()[0]["resolution_notes"] == "Daño reparado por el taller"


def test_incident_invalid_photo_atomicity_and_date_validation(client, vehicle):
    url = f"/api/vehicles/{vehicle['id']}/incidents"
    payload = {"occurred_on": local_today().isoformat(), "category": "averia", "description": "Ruido al encender la unidad"}
    bad = {"filename": "bad.png", "data_url": "data:image/png;base64,YmFk"}
    assert client.post(url, json=payload | {"photos": [photo_payload(), bad]}).status_code == 422
    assert client.post(url, json=payload | {"photos": [photo_payload()] * 4}).status_code == 422
    assert client.post(url, json=payload | {"occurred_on": (local_today() + timedelta(days=1)).isoformat()}).status_code == 422
    with client.app.state.sessions() as session:
        assert session.scalar(select(func.count()).select_from(VehicleIncident)) == 0
        assert session.scalar(select(func.count()).select_from(VehicleEvidence)) == 0
    # Administrative incidents do not silently become technical fault diagnoses.
    assert client.get(f"/api/vehicles/{vehicle['id']}").json()["faults"] == []
