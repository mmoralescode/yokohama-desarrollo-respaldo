"""Optional onboarding assignments remain atomic and admin-controlled."""
import pytest
from sqlalchemy import func, select

from app.auth_models import CompanyUser, UserVehicleAssignment
from app.models import Vehicle
from test_accounts import PASSWORD, company, driver_login
from test_api import client, vehicle_data


def test_new_vehicle_adds_assignment_without_replacing_existing_units(company, vehicle_data):
    client, headers = company["client"], company["admin_headers"]
    body = vehicle_data | {"vin": "DEM00000000000997", "plate": "NEW-997",
                           "assigned_user_id": company["user"]["id"], "drivers": ["Conductor de relevo"]}
    response = client.post("/api/vehicles", headers=headers, json=body)
    assert response.status_code == 201, response.text
    created = response.json()
    assert "assigned_user_id" not in created
    assert created["drivers"] == ["Conductor de relevo", "Ana Operadora"]
    user = client.get("/api/users", headers=headers).json()[1]
    assert user["vehicle_ids"] == [company["first"]["id"], created["id"]]
    assert client.get("/api/vehicles", headers=company["user_headers"]).status_code == 401
    refreshed = driver_login(client)
    assert {row["id"] for row in client.get("/api/vehicles", headers=refreshed).json()} == set(user["vehicle_ids"])


def test_manual_vehicle_can_be_assigned_at_creation(company, vehicle_data):
    body = vehicle_data | {"vin": "DEM00000000000996", "plate": "NEW-996", "variant_id": None,
                           "assigned_user_id": company["user"]["id"], "make": "Toyota", "model": "Corolla",
                           "version": "Base", "body_style": "sedan", "engine": "2.0", "transmission": "CVT",
                           "drive": "FWD"}
    response = company["client"].post("/api/vehicles", headers=company["admin_headers"], json=body)
    assert response.status_code == 201, response.text
    with company["client"].app.state.sessions() as session:
        assert session.scalar(select(UserVehicleAssignment.id).where(
            UserVehicleAssignment.user_id == company["user"]["id"],
            UserVehicleAssignment.vehicle_id == response.json()["id"],
        )) is not None


@pytest.mark.parametrize("assigned", [0, -1, True, "2", 999999, 1])
def test_invalid_assignment_never_creates_partial_vehicle(company, vehicle_data, assigned):
    client = company["client"]
    response = client.post("/api/vehicles", headers=company["admin_headers"],
                           json=vehicle_data | {"vin": "DEM00000000000995", "plate": "NEW-995",
                                                "assigned_user_id": assigned})
    assert response.status_code == 422, response.text
    with client.app.state.sessions() as session:
        assert session.scalar(select(func.count(Vehicle.id))) == 2
        assert session.scalar(select(func.count(UserVehicleAssignment.id))) == 1


def test_inactive_user_and_driver_request_cannot_create_assigned_vehicle(company, vehicle_data):
    client = company["client"]
    body = vehicle_data | {"vin": "DEM00000000000994", "plate": "NEW-994", "assigned_user_id": company["user"]["id"]}
    assert client.post("/api/vehicles", headers=company["user_headers"], json=body).status_code == 403
    with client.app.state.sessions.begin() as session:
        session.get(CompanyUser, company["user"]["id"]).active = False
    assert client.post("/api/vehicles", headers=company["admin_headers"], json=body).status_code == 422
    with client.app.state.sessions() as session:
        assert session.scalar(select(func.count(Vehicle.id))) == 2


def test_duplicate_vehicle_rolls_back_assignment_and_keeps_session(company, vehicle_data):
    client = company["client"]
    response = client.post("/api/vehicles", headers=company["admin_headers"],
                           json=vehicle_data | {"assigned_user_id": company["user"]["id"]})
    assert response.status_code == 409
    assert client.get("/api/vehicles", headers=company["user_headers"]).status_code == 200
    with client.app.state.sessions() as session:
        assert session.scalar(select(func.count(UserVehicleAssignment.id))) == 1
