"""Account provisioning is administrative; there is no public sign-up."""
import hmac
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from .auth import ADMIN_EMAILS, OWNER_EMAIL, AuthManager, authorize_admin, hash_password, normalized_email, token_digest, user_payload
from .auth_models import CompanyUser, UserSession, UserVehicleAssignment
from .models import Vehicle
from .time_utils import utc_now


class Login(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=254)
    password: SecretStr = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        value = normalized_email(value)
        if value.count("@") != 1 or any(character.isspace() for character in value) or not all(value.split("@")):
            raise ValueError("Indique un correo válido.")
        return value


class UserCreate(Login):
    name: str = Field(min_length=1, max_length=100)
    password: SecretStr = Field(min_length=12, max_length=128)
    role: Literal["admin", "user"] = "user"
    vehicle_ids: list[int] = Field(default_factory=list, max_length=1000)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value):
        value = " ".join(value.split())
        if not value:
            raise ValueError("Indique el nombre de la persona.")
        return value

    @field_validator("vehicle_ids", mode="before")
    @classmethod
    def validate_ids(cls, value):
        if not isinstance(value, list) or any(type(item) is not int or item < 1 for item in value):
            raise ValueError("Seleccione unidades válidas.")
        return list(dict.fromkeys(value))


class Setup(UserCreate):
    token: SecretStr = Field(min_length=1, max_length=256)
    # Setup can only create an administrator; clients cannot assign arbitrary
    # vehicles before the first administrator has authenticated.
    role: Literal["admin"] = "admin"
    vehicle_ids: list[int] = Field(default_factory=list, max_length=0)


class PasswordChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: SecretStr = Field(min_length=1, max_length=128)
    new_password: SecretStr = Field(min_length=12, max_length=128)


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=100)
    email: str | None = Field(default=None, min_length=3, max_length=254)
    password: SecretStr | None = Field(default=None, min_length=12, max_length=128)
    role: Literal["admin", "user"] | None = None
    active: bool | None = Field(default=None, strict=True)
    vehicle_ids: list[int] | None = Field(default=None, max_length=1000)

    @model_validator(mode="before")
    @classmethod
    def reject_nulls(cls, value):
        if isinstance(value, dict) and any(item is None for item in value.values()):
            raise ValueError("No se admiten valores nulos. Omita los campos que no desea cambiar.")
        return value

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value):
        return UserCreate.normalize_name(value)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        return Login.normalize_email(value)

    @field_validator("vehicle_ids", mode="before")
    @classmethod
    def validate_ids(cls, value):
        return UserCreate.validate_ids(value)


def register_auth(api: APIRouter, session_dependency, manager: AuthManager) -> None:
    def validate_assignments(session: Session, ids: list[int]):
        found = set(session.scalars(select(Vehicle.id).where(Vehicle.id.in_(ids))))
        if found != set(ids):
            raise HTTPException(422, "Una o más unidades seleccionadas ya no existen. Actualice la lista.")

    def set_assignments(session: Session, user_id: int, ids: list[int]):
        session.execute(delete(UserVehicleAssignment).where(UserVehicleAssignment.user_id == user_id))
        session.add_all(UserVehicleAssignment(user_id=user_id, vehicle_id=vehicle_id) for vehicle_id in ids)

    @api.get("/auth/status")
    def status(session: Session = Depends(session_dependency, scope="function")):
        return manager.status(session)

    @api.post("/auth/setup", status_code=201)
    def setup(payload: Setup, request: Request, session: Session = Depends(session_dependency, scope="function")):
        if manager.cloud:
            raise HTTPException(403, "La configuración inicial pública está cerrada.")
        manager.limiter.check(request, "initial-setup", session)
        if manager.status(session)["configured"]:
            raise HTTPException(409, "La empresa ya tiene una cuenta administradora. Inicie sesión.")
        if len(manager.setup_token) < 24:
            raise HTTPException(503, "La configuración inicial está cerrada. Configure YOKOHAMA_SETUP_TOKEN en el servidor.")
        if not hmac.compare_digest(payload.token.get_secret_value().encode(), manager.setup_token.encode()):
            raise HTTPException(401, "El código de configuración no es válido.")
        if payload.email != OWNER_EMAIL:
            raise HTTPException(403, "La cuenta administradora autorizada es admin.yoko@gmail.com.")
        # A fixed bootstrap identity is also a database-level concurrency guard:
        # two processes cannot both provision a different first administrator.
        user = CompanyUser(id=1, name=payload.name, email=payload.email, password_hash=hash_password(payload.password.get_secret_value()), role="admin", active=True)
        session.add(user)
        session.flush()
        return manager.issue_session(session, user)

    @api.post("/auth/login")
    def login(payload: Login, request: Request, session: Session = Depends(session_dependency, scope="function")):
        manager.limiter.check(request, payload.email, session)
        matches = list(session.scalars(select(CompanyUser).where(func.lower(func.trim(CompanyUser.email)) == payload.email)))
        user = matches[0] if len(matches) == 1 else None
        if not manager.password_matches(payload.password.get_secret_value(), user):
            raise HTTPException(401, "Correo o contraseña incorrectos.")
        return manager.issue_session(session, user)

    @api.get("/auth/me")
    def me(session: Session = Depends(session_dependency, scope="function")):
        principal = session.info.get("principal")
        if principal is None:
            raise HTTPException(401, "Inicie sesión para consultar su perfil.")
        return user_payload(session, session.get(CompanyUser, principal.id))

    @api.post("/auth/logout")
    def logout(request: Request, session: Session = Depends(session_dependency, scope="function")):
        token = request.headers.get("x-session-token", "")
        if token:
            row = session.get(UserSession, token_digest(token))
            if row:
                row.revoked_at = utc_now()
        return {"ok": True}

    @api.post("/auth/password")
    def change_password(payload: PasswordChange, request: Request, session: Session = Depends(session_dependency, scope="function")):
        principal = session.info.get("principal")
        if principal is None:
            raise HTTPException(401, "Inicie sesión para cambiar su contraseña.")
        manager.limiter.check(request, f"password-change:{principal.id}", session)
        user = session.get(CompanyUser, principal.id)
        if not manager.password_matches(payload.current_password.get_secret_value(), user):
            # The session is authenticated; this is a rejected form value, not
            # an expired session. Do not make the proxy discard a valid cookie.
            raise HTTPException(400, "La contraseña actual no es correcta.")
        user.password_hash = hash_password(payload.new_password.get_secret_value())
        user.updated_at = utc_now()
        session.execute(update(UserSession).where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None)).values(revoked_at=utc_now()))
        return {"ok": True, "detail": "Contraseña actualizada. Inicie sesión nuevamente en sus dispositivos."}

    @api.get("/users")
    def list_users(session: Session = Depends(session_dependency, scope="function")):
        authorize_admin(session)
        return [user_payload(session, user) for user in session.scalars(select(CompanyUser).order_by(CompanyUser.name, CompanyUser.id))]

    @api.post("/users", status_code=201)
    def create_user(payload: UserCreate, session: Session = Depends(session_dependency, scope="function")):
        authorize_admin(session)
        if not manager.status(session)["configured"]:
            raise HTTPException(409, "Configure primero la cuenta administradora desde el inicio de sesión.")
        if payload.email == OWNER_EMAIL:
            raise HTTPException(409, "Este correo está reservado para la cuenta administradora.")
        if payload.role == "admin" and payload.email not in ADMIN_EMAILS:
            raise HTTPException(403, "Este correo no está autorizado para tener el perfil de administrador.")
        validate_assignments(session, payload.vehicle_ids)
        if session.scalar(select(CompanyUser.id).where(func.lower(func.trim(CompanyUser.email)) == payload.email)):
            raise HTTPException(409, "Ya existe una cuenta con ese correo.")
        user = CompanyUser(name=payload.name, email=payload.email, password_hash=hash_password(payload.password.get_secret_value()), role=payload.role, active=True)
        session.add(user)
        session.flush()
        set_assignments(session, user.id, payload.vehicle_ids)
        session.flush()
        return user_payload(session, user)

    @api.patch("/users/{user_id}")
    def update_user(user_id: int, payload: UserUpdate, session: Session = Depends(session_dependency, scope="function")):
        authorize_admin(session)
        user = session.get(CompanyUser, user_id)
        if user is None:
            raise HTTPException(404, "Cuenta no encontrada.")
        values = payload.model_dump(exclude_unset=True)
        owner = normalized_email(user.email) == OWNER_EMAIL
        if owner:
            if values.get("active") is False or values.get("role", "admin") != "admin" or values.get("email", OWNER_EMAIL) != OWNER_EMAIL:
                raise HTTPException(409, "La cuenta administradora debe conservar su correo, perfil y acceso activo.")
        else:
            email = values.get("email", normalized_email(user.email))
            if email == OWNER_EMAIL:
                raise HTTPException(409, "Este correo está reservado para la cuenta administradora.")
            # Validate the resulting identity AND role together. Checking only
            # an explicit role change would allow moving an admin account to
            # an unapproved email while retaining its stored admin role.
            if values.get("role", user.role) == "admin" and email not in ADMIN_EMAILS:
                raise HTTPException(403, "Este correo no está autorizado para tener el perfil de administrador.")
        if "email" in values and session.scalar(select(CompanyUser.id).where(
            func.lower(func.trim(CompanyUser.email)) == values["email"], CompanyUser.id != user.id,
        )):
            raise HTTPException(409, "Ya existe una cuenta con ese correo.")
        assignment_changed = False
        if "vehicle_ids" in values:
            ids = values.pop("vehicle_ids")
            validate_assignments(session, ids)
            existing_ids = set(session.scalars(select(UserVehicleAssignment.vehicle_id).where(UserVehicleAssignment.user_id == user.id)))
            assignment_changed = existing_ids != set(ids)
            if assignment_changed:
                set_assignments(session, user.id, ids)
        invalidate_sessions = "password" in values or assignment_changed or any(
            field in values and values[field] != getattr(user, field)
            for field in ("role", "active", "email")
        )
        if "password" in values:
            user.password_hash = hash_password(values.pop("password").get_secret_value())
        for field, value in values.items():
            setattr(user, field, value)
        user.updated_at = utc_now()
        if invalidate_sessions:
            session.execute(update(UserSession).where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None)).values(revoked_at=utc_now()))
        session.flush()
        return user_payload(session, user)
