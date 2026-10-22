"""Fleet charts use actual persisted odometers and isolated administrator totals."""
from datetime import timedelta

from sqlalchemy import event, func, select

from app.fleet_statistics import fleet_statistics
from app.auth_models import CompanyUser, UserVehicleAssignment
from app.models import FaultReport, OdometerReading, PlanEvaluation, Vehicle
from app.time_utils import local_today
from test_accounts import company
from test_api import client, vehicle_data


def test_stats_counts_reports_and_never_sums_odometer_readings(company):
    client, admin = company["client"], company["admin_headers"]
    first, second = company["first"]["id"], company["second"]["id"]
    with client.app.state.sessions.begin() as session:
        session.get(Vehicle, first).current_km = 12345.5
        session.add(OdometerReading(vehicle_id=first, date=local_today() - timedelta(days=2), odometer_km=9000))
        for severity, status in (("critico", "open"), ("critico", "resolved"), ("menor", "open")):
            session.add(FaultReport(vehicle_id=first, reported_on=local_today(), description="Reporte para estadística",
                                    severity=severity, status=status))
        before = session.scalar(select(func.count()).select_from(PlanEvaluation))
    response = client.get("/api/fleet-statistics", headers=admin)
    assert response.status_code == 200, response.text
    rows = {row["id"]: row for row in response.json()}
    assert rows[first]["current_km"] == 12345.5
    assert (rows[first]["total_faults"], rows[first]["open_faults"], rows[first]["critical_faults"]) == (3, 2, 1)
    assert (rows[second]["total_faults"], rows[second]["open_faults"], rows[second]["critical_faults"]) == (0, 0, 0)
    assert rows[first]["drivers"] == ["Ana Operadora"]
    assert rows[second]["drivers"] == []
    assert set(rows[first]) == {"id", "plate", "nickname", "current_km", "drivers", "open_faults", "total_faults", "critical_faults"}
    with client.app.state.sessions() as session:
        assert session.scalar(select(func.count()).select_from(PlanEvaluation)) == before


def test_driver_and_missing_session_cannot_read_fleet_statistics(company):
    client = company["client"]
    assert client.get("/api/fleet-statistics", headers=company["user_headers"]).status_code == 403
    assert client.get("/api/fleet-statistics").status_code == 401


def test_stats_is_one_aggregate_query_and_empty_fleet_is_empty(client):
    statements = []

    def record(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    engine = client.app.state.engine
    event.listen(engine, "before_cursor_execute", record)
    try:
        with client.app.state.sessions() as session:
            assert fleet_statistics(session) == []
        assert len(statements) == 1
        assert "LEFT OUTER JOIN" in statements[0]
    finally:
        event.remove(engine, "before_cursor_execute", record)


def test_stats_batches_current_active_assignments_without_legacy_names(company):
    client, admin = company["client"], company["admin_headers"]
    first, second = company["first"]["id"], company["second"]["id"]
    with client.app.state.sessions.begin() as session:
        session.get(Vehicle, first).drivers = ["Nombre anterior"]
        session.get(Vehicle, second).drivers = ["Nombre desasignado"]
        # Names in old imports are normalized without inventing account data.
        for name, active, assigned_to in (("  Bruno   Operador ", True, first), ("ANA  OPERADORA", True, first),
                                          ("Conductor inactivo", False, first)):
            user = CompanyUser(name=name, email=f"stats-{name.strip().split()[0].lower()}@example.test",
                               password_hash="unused-test-record", role="user", active=active)
            session.add(user)
            session.flush()
            session.add(UserVehicleAssignment(user_id=user.id, vehicle_id=assigned_to))
        # Even a persisted owner assignment must not be presented as a driver.
        session.add(UserVehicleAssignment(user_id=company["admin"]["user"]["id"], vehicle_id=first))
    statements = []

    def record(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    engine = client.app.state.engine
    event.listen(engine, "before_cursor_execute", record)
    try:
        with client.app.state.sessions() as session:
            rows = {row["id"]: row for row in fleet_statistics(session)}
        assert len(statements) == 2
        assert rows[first]["drivers"] == ["Ana Operadora", "Bruno Operador"]
        assert rows[second]["drivers"] == []
        assert all("email" not in row and "password_hash" not in row for row in rows.values())
    finally:
        event.remove(engine, "before_cursor_execute", record)
    # Disabling the only remaining assigned accounts leaves no current driver;
    # their old free-text names are not a fallback in a configured company.
    with client.app.state.sessions.begin() as session:
        for user in session.scalars(select(CompanyUser).where(CompanyUser.role == "user")):
            user.active = False
    rows = {row["id"]: row for row in client.get("/api/fleet-statistics", headers=admin).json()}
    assert rows[first]["drivers"] == []
    assert rows[second]["drivers"] == []


def test_stats_keeps_legacy_driver_names_only_before_account_configuration(client, vehicle_data):
    first = client.post("/api/vehicles", json=vehicle_data | {"drivers": ["Ana Operadora", "Bruno Operador"]}).json()
    second = client.post("/api/vehicles", json=vehicle_data | {"vin": "DEM00000000000997", "plate": "LEGACY-997"}).json()
    rows = {row["id"]: row for row in client.get("/api/fleet-statistics").json()}
    assert rows[first["id"]]["drivers"] == ["Ana Operadora", "Bruno Operador"]
    assert rows[second["id"]]["drivers"] == []
