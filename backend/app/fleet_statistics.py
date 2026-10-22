"""Read-only fleet totals from persisted odometers and technical fault reports."""
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from .auth import ADMIN_EMAILS
from .auth_models import CompanyUser, UserVehicleAssignment
from .models import FaultReport, Vehicle


def _driver_names(names) -> list[str]:
    result, seen = [], set()
    for value in names:
        name = " ".join(value.split())
        if name and name.casefold() not in seen:
            result.append(name)
            seen.add(name.casefold())
    return result


def fleet_statistics(session: Session) -> list[dict]:
    # One grouped query, including vehicles with no reports. Readings are
    # measurements of the same odometer and must never be summed together.
    faults = select(
        FaultReport.vehicle_id.label("vehicle_id"),
        func.count(FaultReport.id).label("total_faults"),
        func.sum(case((FaultReport.status != "resolved", 1), else_=0)).label("open_faults"),
        func.sum(case(((FaultReport.status != "resolved") & (FaultReport.severity == "critico"), 1), else_=0)).label("critical_faults"),
    ).group_by(FaultReport.vehicle_id).subquery()
    rows = session.execute(select(
        Vehicle.id, Vehicle.plate, Vehicle.nickname, Vehicle.current_km, Vehicle.drivers.label("legacy_drivers"),
        func.coalesce(faults.c.open_faults, 0).label("open_faults"),
        func.coalesce(faults.c.total_faults, 0).label("total_faults"),
        func.coalesce(faults.c.critical_faults, 0).label("critical_faults"),
    ).outerjoin(faults, faults.c.vehicle_id == Vehicle.id).order_by(Vehicle.plate, Vehicle.id))
    result = [dict(row._mapping) for row in rows]
    if not result:
        return result

    # A single batch also tells us whether company accounts are configured.
    # Once configured, account assignments replace legacy free-text names:
    # removing or disabling an assignment must not revive an old driver name.
    ids = [row["id"] for row in result]
    users = session.execute(select(
        CompanyUser.id, CompanyUser.name, CompanyUser.active,
        ~((CompanyUser.role == "admin") &
          func.lower(func.trim(CompanyUser.email)).in_(ADMIN_EMAILS)).label("is_driver"),
        UserVehicleAssignment.vehicle_id,
    ).outerjoin(UserVehicleAssignment,
                (UserVehicleAssignment.user_id == CompanyUser.id) & UserVehicleAssignment.vehicle_id.in_(ids))
        .order_by(CompanyUser.id)).all()
    assigned: dict[int, list[str]] = {}
    for user in users:
        if user.active and user.is_driver and user.vehicle_id is not None:
            assigned.setdefault(user.vehicle_id, []).append(user.name)
    for row in result:
        legacy = row.pop("legacy_drivers")
        row["drivers"] = sorted(_driver_names(assigned.get(row["id"], [])), key=str.casefold) if users else _driver_names(legacy or [])
    return result
