"""Document byte persistence and assignment privacy in an isolated PG schema."""
import base64
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from app.auth import OWNER_EMAIL
from app.auth_models import CompanyUser, UserVehicleAssignment
from app.main import create_app
from app.models import VehicleEvidence
from test_api import vehicle_data
from test_accounts import photo
from test_cloud_auth import KEY, cloud_app
from test_postgres_support import postgres_database


def test_postgres_document_bytes_persist_and_only_assigned_unit_is_shared(cloud_app, postgres_database, vehicle_data):
    # The existing fixture pins the entire app to yokohama_test_<UUID>. Its
    # cleanup can remove only that validated schema, never public tables.
    with TestClient(cloud_app) as client:
        client.headers.update({"X-API-Key": KEY})
        with cloud_app.state.sessions.begin() as session:
            owner = session.scalar(select(CompanyUser).where(CompanyUser.email == OWNER_EMAIL))
            owner_session = cloud_app.state.auth.issue_session(session, owner)
        admin = {"X-Session-Token": owner_session["session_token"]}
        units = []
        for index in range(2):
            created = client.post("/api/vehicles", headers=admin, json=vehicle_data | {
                "vin": f"PGDCT{index:012d}", "plate": f"PGDOC-{index}",
            })
            assert created.status_code == 201, created.text
            units.append(created.json()["id"])
        with cloud_app.state.sessions.begin() as session:
            driver = CompanyUser(name="Synthetic assigned driver", email="docs-driver@example.invalid", role="user",
                                 active=True, password_hash="synthetic-not-used-for-login")
            coassigned = CompanyUser(name="Synthetic coassigned driver", email="docs-other@example.invalid", role="user",
                                     active=True, password_hash="synthetic-not-used-for-login")
            session.add_all([driver, coassigned])
            session.flush()
            session.add_all([UserVehicleAssignment(user_id=user.id, vehicle_id=units[0]) for user in (driver, coassigned)])
            session.flush()
            driver_session = cloud_app.state.auth.issue_session(session, driver)
            other_session = cloud_app.state.auth.issue_session(session, coassigned)
        own = {"X-Session-Token": driver_session["session_token"]}
        other = {"X-Session-Token": other_session["session_token"]}
        document = client.post(f"/api/vehicles/{units[0]}/documents", headers=admin, json={
            "document_type": "circulation", "notes": "Documento conservado en PostgreSQL", "photos": [photo()],
        })
        assert document.status_code == 201, document.text
        metadata = document.json()["photos"][0]
        evidence_url = f"/api/evidence/{metadata['id']}"
        for headers in (admin, own, other):
            listed = client.get(f"/api/vehicles/{units[0]}/documents", headers=headers)
            assert listed.status_code == 200 and listed.json() == [metadata]
            assert "content" not in listed.text and "data_url" not in listed.text
            assert client.get(evidence_url, headers=headers).status_code == 200
        downloaded = client.get(evidence_url, headers=own).json()
        encoded = base64.b64decode(downloaded["data_url"].split(",", 1)[1], validate=True)
        with Image.open(BytesIO(encoded)) as image:
            assert image.format == "JPEG" and image.size == (12, 8)
        with postgres_database["sessions"]() as session:
            stored = session.get(VehicleEvidence, metadata["id"])
            assert stored.content == encoded
            assert stored.document_type == "circulation" and stored.captured_by == owner.id
            assert all(getattr(stored, target) is None for target in (
                "reading_id", "incident_id", "fault_id", "service_id", "downtime_id",
            ))
        # A documentation photo is shared by assignment, not by photo author;
        # ordinary fault/report evidence remains private even on the same unit.
        fault = client.post(f"/api/vehicles/{units[0]}/faults", headers=other, json={
            "description": "Synthetic coassigned private report", "severity": "menor", "photos": [photo()],
        })
        assert fault.status_code == 201, fault.text
        assert client.get(f"/api/evidence/{fault.json()['photos'][0]['id']}", headers=own).status_code == 404
        foreign_doc = client.post(f"/api/vehicles/{units[1]}/documents", headers=admin, json={
            "document_type": "verification", "photos": [photo()],
        })
        assert foreign_doc.status_code == 201
        assert client.get(f"/api/evidence/{foreign_doc.json()['photos'][0]['id']}", headers=own).status_code == 404
        assert client.get(f"/api/vehicles/{units[1]}/documents", headers=own).status_code == 404
        assert client.post(f"/api/vehicles/{units[1]}/documents", headers=own, json={
            "document_type": "plates", "photos": [photo()],
        }).status_code == 404

    # Dispose/recreate the application to prove no instance-local photo storage.
    fresh_app = create_app(database_url=postgres_database["url"], api_key=KEY)
    with TestClient(fresh_app) as restarted:
        restarted.headers.update({"X-API-Key": KEY, **own})
        persisted = restarted.get(evidence_url)
        assert persisted.status_code == 200
        assert persisted.json()["data_url"] == downloaded["data_url"]
        assert restarted.get(f"/api/vehicles/{units[0]}/documents").json() == [metadata]
