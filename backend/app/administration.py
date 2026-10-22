"""Administrative dates and private evidence, independent of maintenance forecasts."""
import base64
import binascii
from datetime import date
from io import BytesIO
import re
from uuid import uuid4
import warnings

from fastapi import Depends, HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Downtime, FaultReport, OdometerReading, ServiceHistory, Vehicle, VehicleAdministrationChange, VehicleEvidence, VehicleIncident
from .planner import serialize
from .schemas import (DocumentEvidenceCreate, EvidenceAttachmentCreate, EvidencePhoto, IncidentCreate, IncidentUpdate, OdometerEvidenceCreate,
                      VehicleAdministrationFields, VehicleAdministrationUpdate)
from .time_utils import as_utc, local_today, utc_now

MAX_PHOTO_BYTES = 3 * 1024 * 1024
MAX_PHOTO_PIXELS = 20_000_000
PHOTO_MIMES = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
ADMINISTRATION_FIELDS = tuple(VehicleAdministrationFields.model_fields)
EVIDENCE_TARGETS = {"reading_id": OdometerReading, "incident_id": VehicleIncident,
                    "fault_id": FaultReport, "service_id": ServiceHistory, "downtime_id": Downtime}
DOCUMENT_TYPES = frozenset({"verification", "circulation", "plates", "vehicle_tax", "other"})


def is_document_photo(row: VehicleEvidence) -> bool:
    # Documents are shared by the assigned unit, never by trusting notes or an
    # arbitrary photo category. Ordinary report photos remain author-private.
    return row.document_type in DOCUMENT_TYPES and all(getattr(row, name) is None for name in EVIDENCE_TARGETS)


def driver_actor(session: Session) -> int | None:
    principal = session.info.get("principal")
    return principal.id if principal and principal.role != "admin" else None


def owned_query(session: Session, query, model):
    actor = driver_actor(session)
    return query.where(model.captured_by == actor) if actor is not None else query


def require_owned_record(session: Session, row) -> None:
    actor = driver_actor(session)
    if actor is not None and getattr(row, "captured_by", None) != actor:
        raise HTTPException(404, "Registro no encontrado.")


def store_photos(session: Session, vehicle_id: int, captured_by, decoded: list[dict], *, notes="", **target) -> list[dict]:
    """Caller validates all images first and owns the enclosing transaction."""
    rows = [VehicleEvidence(id=str(uuid4()), vehicle_id=vehicle_id, captured_by=captured_by,
                            notes=notes, **target, **photo) for photo in decoded]
    session.add_all(rows)
    session.flush()
    return [evidence_metadata(row) for row in rows]


def record_photos(session: Session, **target) -> list[dict]:
    query = select(VehicleEvidence)
    for name, value in target.items():
        query = query.where(getattr(VehicleEvidence, name) == value)
    query = owned_query(session, query, VehicleEvidence)
    return [evidence_metadata(row) for row in session.scalars(query.order_by(VehicleEvidence.captured_at, VehicleEvidence.id))]


def vehicle_photo_map(session: Session, vehicle_id: int) -> dict:
    """One metadata query for an entire detail page, with no private blob load."""
    result = {name: {} for name in EVIDENCE_TARGETS}
    query = owned_query(session, select(VehicleEvidence).where(VehicleEvidence.vehicle_id == vehicle_id), VehicleEvidence)
    for row in session.scalars(query.order_by(VehicleEvidence.captured_at, VehicleEvidence.id)):
        metadata = evidence_metadata(row)
        for name in EVIDENCE_TARGETS:
            target_id = getattr(row, name)
            if target_id is not None:
                result[name].setdefault(target_id, []).append(metadata)
                break
    return result


def decode_photo(photo: EvidencePhoto) -> dict:
    """Decode real images and discard EXIF/GPS, profiles, scripts and trailing bytes.

    Size and dimensions are checked before decompression. Store only freshly
    encoded JPEG bytes, never an uploaded path or an untrusted original file.
    """
    match = re.fullmatch(r"data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})", photo.data_url)
    if not match:
        raise HTTPException(422, "Seleccione una fotografía JPEG, PNG o WebP válida.")
    try:
        raw = base64.b64decode(match[2], validate=True)
    except (ValueError, binascii.Error):
        raise HTTPException(422, "La fotografía está incompleta o dañada.") from None
    if not raw or len(raw) > MAX_PHOTO_BYTES:
        raise HTTPException(422, "Cada fotografía debe ocupar como máximo 3 MiB.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw), formats=list(PHOTO_MIMES)) as uploaded:
                width, height = uploaded.size
                if (PHOTO_MIMES.get(uploaded.format) != match[1] or
                        width < 1 or height < 1 or max(width, height) > 10_000 or
                        width * height > MAX_PHOTO_PIXELS or getattr(uploaded, "n_frames", 1) != 1):
                    raise ValueError("Unsupported image")
                uploaded.load()
                oriented = ImageOps.exif_transpose(uploaded).convert("RGB")
                # A clean canvas cannot inherit EXIF, ICC/XMP or PNG text chunks.
                clean = Image.new("RGB", oriented.size, "white")
                clean.paste(oriented)
                output = BytesIO()
                clean.save(output, format="JPEG", quality=88, optimize=True)
                encoded = output.getvalue()
                width, height = clean.size
    except (OSError, ValueError, SyntaxError, UnidentifiedImageError,
            Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise HTTPException(422, "No se pudo validar la foto: use JPEG, PNG o WebP sin animación, de hasta 20 megapíxeles.") from None
    if len(encoded) > MAX_PHOTO_BYTES:
        raise HTTPException(422, "La fotografía procesada supera 3 MiB; reduzca su tamaño e intente de nuevo.")
    name = photo.filename.replace("\\", "/").rsplit("/", 1)[-1].rsplit(".", 1)[0]
    name = re.sub(r"[^\w -]", "", name, flags=re.UNICODE).strip()[:140] or "fotografia"
    return {"filename": f"{name}.jpg", "mime_type": "image/jpeg", "content": encoded, "size_bytes": len(encoded),
            "width": width, "height": height}


def evidence_metadata(row: VehicleEvidence) -> dict:
    # Do not use the generic serializer: evidence.content is a private blob.
    return {"id": row.id, "vehicle_id": row.vehicle_id, "reading_id": row.reading_id,
            "incident_id": row.incident_id, "fault_id": row.fault_id, "service_id": row.service_id,
            "downtime_id": row.downtime_id, "filename": row.filename, "mime_type": row.mime_type,
            "document_type": row.document_type,
            "width": row.width, "height": row.height, "size_bytes": row.size_bytes,
            "notes": row.notes, "captured_at": as_utc(row.captured_at).isoformat(), "captured_by": row.captured_by}


def document_alerts(vehicles, today: date | None = None) -> list[dict]:
    """Capture supplied deadlines only; never infer a state's legal schedule."""
    today = today or local_today()
    result = []
    for vehicle in vehicles:
        for kind, deadline, label in (
            ("verification", vehicle.verification_period_end, "Periodo de verificación"),
            ("circulation", vehicle.circulation_card_expires_on, "Tarjeta de circulación"),
            ("plates", vehicle.plates_expires_on, "Vigencia de placas"),
            ("vehicle_tax", vehicle.vehicle_tax_due_on if vehicle.vehicle_tax_paid_on is None else None,
             "Tenencia / refrendo: plazo registrado"),
        ):
            if deadline is None:
                continue
            remaining = (deadline - today).days
            if remaining > vehicle.document_alert_days:
                continue
            key = f"document:{vehicle.id}:{kind}:{deadline.isoformat()}"
            message = (f"{label}: venció hace {-remaining} días." if remaining < 0 else
                       f"{label}: vence hoy." if remaining == 0 else f"{label}: vence en {remaining} días.")
            result.append({"id": key, "key": key, "kind": "document", "document_type": kind,
                           "vehicle_id": vehicle.id, "plate": vehicle.plate, "nickname": vehicle.nickname,
                           "severity": "critico" if remaining < 0 else "importante", "status": "open",
                           "deadline": deadline.isoformat(), "days_remaining": remaining, "message": message,
                           "action": "Revise el documento y actualice su vigencia cuando corresponda."})
    return sorted(result, key=lambda row: (row["deadline"], row["vehicle_id"], row["document_type"]))


def register_administration(api, session_dependency, find_vehicle, authorize_admin, actor_id, scoped_vehicles):
    """Auth callbacks enforce the same assignment boundaries as the existing API."""

    def incident_payload(session, row, *, vehicle=None, photos=None):
        vehicle = vehicle or find_vehicle(session, row.vehicle_id)
        return {**serialize(row), "plate": vehicle.plate, "nickname": vehicle.nickname,
                "photos": photos if photos is not None else record_photos(session, incident_id=row.id)}

    def incident_list_payload(session, rows, vehicles):
        rows = list(rows)
        photos = {row.id: [] for row in rows}
        if rows:
            query = owned_query(session, select(VehicleEvidence).where(VehicleEvidence.incident_id.in_(photos)), VehicleEvidence)
            for photo in session.scalars(query.order_by(VehicleEvidence.captured_at, VehicleEvidence.id)):
                photos[photo.incident_id].append(evidence_metadata(photo))
        return [incident_payload(session, row, vehicle=vehicles[row.vehicle_id], photos=photos[row.id]) for row in rows]

    @api.patch("/vehicles/{vehicle_id}/administration")
    def update_administration(vehicle_id: int, payload: VehicleAdministrationUpdate,
                              session: Session = Depends(session_dependency, scope="function")):
        authorize_admin(session)
        vehicle = find_vehicle(session, vehicle_id)
        changes = payload.model_dump(exclude_unset=True)
        if ("vehicle_tax_due_on" in changes
                and changes["vehicle_tax_due_on"] != vehicle.vehicle_tax_due_on
                and vehicle.vehicle_tax_paid_on is not None
                and ("vehicle_tax_paid_on" not in changes or changes["vehicle_tax_paid_on"] is not None)):
            raise HTTPException(422, "Al cambiar el plazo, quite explícitamente la fecha de pago anterior. "
                                     "Un pago previo no cubre automáticamente el nuevo periodo.")
        merged = {name: getattr(vehicle, name) for name in ADMINISTRATION_FIELDS} | changes
        try:
            validated = VehicleAdministrationFields.model_validate(merged)
        except ValidationError as exc:
            message = exc.errors(include_url=False)[0]["msg"].removeprefix("Value error, ")
            raise HTTPException(422, message) from None
        previous = serialize(vehicle)
        changed_names = [name for name in changes if getattr(vehicle, name) != getattr(validated, name)]
        for name in changed_names:
            setattr(vehicle, name, getattr(validated, name))
        if changed_names:
            current = serialize(vehicle)
            session.add(VehicleAdministrationChange(
                vehicle_id=vehicle.id, changed_by=actor_id(session),
                previous_values={name: previous[name] for name in changed_names},
                new_values={name: current[name] for name in changed_names},
            ))
        session.flush()
        return serialize(vehicle)

    @api.get("/vehicles/{vehicle_id}/administration-history")
    def administration_history(vehicle_id: int, session: Session = Depends(session_dependency, scope="function")):
        authorize_admin(session)
        find_vehicle(session, vehicle_id)
        changes = session.scalars(select(VehicleAdministrationChange)
                                  .where(VehicleAdministrationChange.vehicle_id == vehicle_id)
                                  .order_by(VehicleAdministrationChange.changed_at.desc(), VehicleAdministrationChange.id.desc())
                                  .limit(50))
        return [serialize(change) for change in changes]

    @api.get("/document-alerts")
    def list_document_alerts(session: Session = Depends(session_dependency, scope="function")):
        return document_alerts(scoped_vehicles(session))

    @api.get("/vehicles/{vehicle_id}/odometer-evidence")
    def list_odometer_evidence(vehicle_id: int, session: Session = Depends(session_dependency, scope="function")):
        find_vehicle(session, vehicle_id)
        rows = session.execute(select(VehicleEvidence, OdometerReading)
                               .join(OdometerReading, OdometerReading.id == VehicleEvidence.reading_id)
                               .where(VehicleEvidence.vehicle_id == vehicle_id)
                               .where(VehicleEvidence.captured_by == driver_actor(session) if driver_actor(session) is not None else True)
                               .order_by(VehicleEvidence.captured_at.desc(), VehicleEvidence.id))
        return [{**evidence_metadata(photo), "observed_on": reading.date.isoformat(),
                 "odometer_km": reading.odometer_km} for photo, reading in rows]

    @api.post("/vehicles/{vehicle_id}/odometer-evidence", status_code=201)
    def create_odometer_evidence(vehicle_id: int, payload: OdometerEvidenceCreate,
                                 session: Session = Depends(session_dependency, scope="function")):
        find_vehicle(session, vehicle_id)
        reading = session.get(OdometerReading, payload.reading_id)
        if reading is None or reading.vehicle_id != vehicle_id:
            raise HTTPException(404, "No se encontró la lectura de esta unidad.")
        require_owned_record(session, reading)
        decoded = decode_photo(payload.photo)
        row = VehicleEvidence(id=str(uuid4()), vehicle_id=vehicle_id, reading_id=reading.id,
                              notes=payload.notes, captured_by=actor_id(session), **decoded)
        session.add(row)
        session.flush()
        return {**evidence_metadata(row), "observed_on": reading.date.isoformat(), "odometer_km": reading.odometer_km}

    @api.get("/evidence/{evidence_id}")
    def get_evidence(evidence_id: str, session: Session = Depends(session_dependency, scope="function")):
        photo = session.get(VehicleEvidence, evidence_id)
        if photo is None:
            raise HTTPException(404, "Fotografía no encontrada.")
        find_vehicle(session, photo.vehicle_id)
        if not is_document_photo(photo):
            require_owned_record(session, photo)
        return {**evidence_metadata(photo), "data_url": f"data:{photo.mime_type};base64,{base64.b64encode(photo.content).decode('ascii')}"}

    @api.get("/vehicles/{vehicle_id}/evidence")
    def list_vehicle_evidence(vehicle_id: int, session: Session = Depends(session_dependency, scope="function")):
        find_vehicle(session, vehicle_id)
        rows = session.scalars(owned_query(session, select(VehicleEvidence)
                              .where(VehicleEvidence.vehicle_id == vehicle_id), VehicleEvidence)
                              .where(VehicleEvidence.document_type.is_(None))
                              .order_by(VehicleEvidence.captured_at.desc(), VehicleEvidence.id))
        return [evidence_metadata(row) for row in rows]

    @api.get("/vehicles/{vehicle_id}/documents")
    def list_documents(vehicle_id: int, session: Session = Depends(session_dependency, scope="function")):
        find_vehicle(session, vehicle_id)
        rows = session.scalars(select(VehicleEvidence).where(
            VehicleEvidence.vehicle_id == vehicle_id, VehicleEvidence.document_type.in_(DOCUMENT_TYPES),
            *(getattr(VehicleEvidence, name).is_(None) for name in EVIDENCE_TARGETS),
        ).order_by(VehicleEvidence.captured_at.desc(), VehicleEvidence.id))
        return [evidence_metadata(row) for row in rows]

    @api.post("/vehicles/{vehicle_id}/documents", status_code=201)
    def create_documents(vehicle_id: int, payload: DocumentEvidenceCreate,
                         session: Session = Depends(session_dependency, scope="function")):
        find_vehicle(session, vehicle_id)
        decoded = [decode_photo(photo) for photo in payload.photos]
        return {"photos": store_photos(session, vehicle_id, actor_id(session), decoded,
                                       notes=payload.notes, document_type=payload.document_type)}

    @api.post("/vehicles/{vehicle_id}/evidence", status_code=201)
    def attach_evidence(vehicle_id: int, payload: EvidenceAttachmentCreate,
                        session: Session = Depends(session_dependency, scope="function")):
        find_vehicle(session, vehicle_id)
        name, reference = next((name, getattr(payload, name)) for name in EVIDENCE_TARGETS
                               if getattr(payload, name) is not None)
        row = session.get(EVIDENCE_TARGETS[name], reference)
        if row is None or row.vehicle_id != vehicle_id:
            raise HTTPException(404, "Registro no encontrado en esta unidad.")
        require_owned_record(session, row)
        decoded = [decode_photo(photo) for photo in payload.photos]
        return {"photos": store_photos(session, vehicle_id, actor_id(session), decoded,
                                       notes=payload.notes, **{name: reference})}

    @api.get("/vehicles/{vehicle_id}/incidents")
    def list_vehicle_incidents(vehicle_id: int, session: Session = Depends(session_dependency, scope="function")):
        vehicle = find_vehicle(session, vehicle_id)
        rows = session.scalars(owned_query(session, select(VehicleIncident).where(VehicleIncident.vehicle_id == vehicle_id), VehicleIncident)
                               .order_by(VehicleIncident.occurred_on.desc(), VehicleIncident.captured_at.desc()))
        return incident_list_payload(session, rows, {vehicle_id: vehicle})

    @api.get("/incidents")
    def list_incidents(session: Session = Depends(session_dependency, scope="function")):
        vehicles = {vehicle.id: vehicle for vehicle in scoped_vehicles(session)}
        rows = session.scalars(owned_query(session, select(VehicleIncident).where(VehicleIncident.vehicle_id.in_(vehicles)), VehicleIncident)
                               .order_by(VehicleIncident.occurred_on.desc(), VehicleIncident.captured_at.desc()))
        return incident_list_payload(session, rows, vehicles)

    @api.post("/vehicles/{vehicle_id}/incidents", status_code=201)
    def create_incident(vehicle_id: int, payload: IncidentCreate,
                        session: Session = Depends(session_dependency, scope="function")):
        find_vehicle(session, vehicle_id)
        # Validate every image before any insert: a bad third file cannot leave
        # a half-created incident or orphaned evidence.
        decoded = [decode_photo(photo) for photo in payload.photos]
        row = VehicleIncident(id=str(uuid4()), vehicle_id=vehicle_id, captured_by=actor_id(session),
                              **payload.model_dump(exclude={"photos"}))
        session.add(row)
        session.flush()
        store_photos(session, vehicle_id, actor_id(session), decoded, incident_id=row.id)
        return incident_payload(session, row)

    @api.patch("/incidents/{incident_id}")
    def update_incident(incident_id: str, payload: IncidentUpdate,
                        session: Session = Depends(session_dependency, scope="function")):
        authorize_admin(session)
        row = session.get(VehicleIncident, incident_id)
        if row is None:
            raise HTTPException(404, "Incidencia no encontrada.")
        find_vehicle(session, row.vehicle_id)
        decoded = [decode_photo(photo) for photo in payload.photos]
        row.status = payload.status
        row.resolution_notes = payload.resolution_notes
        row.updated_at = utc_now()
        session.flush()
        store_photos(session, row.vehicle_id, actor_id(session), decoded, incident_id=row.id)
        return incident_payload(session, row)
