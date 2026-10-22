"""Server-side sessions and deny-by-default authorization.

The shared API key protects the private backend transport. After the first
administrator is configured, it is never sufficient to authorize a person.
Password settings follow OWASP's scrypt recommendation (N=2**17, r=8, p=1).
"""
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import timedelta
import hashlib
import hmac
import os
import re
import secrets
import threading
import time

from fastapi import HTTPException, Request
from sqlalchemy import case, func, select
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.orm import Session

from .auth_models import AuthAttemptCounter, CompanyUser, UserSession, UserVehicleAssignment
from .models import Vehicle
from .time_utils import as_utc, utc_now

SCRYPT_N = 2**17
SCRYPT_R = 8
SCRYPT_P = 1
SESSION_HOURS = 12
OWNER_EMAIL = "admin.yoko@gmail.com"
DEVELOPER_EMAIL = "martinmoralesbasurto1@gmail.com"
ADMIN_EMAILS = frozenset({OWNER_EMAIL, DEVELOPER_EMAIL})
DUMMY_PASSWORD_HASH = f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${'00' * 16}${'00' * 32}"
PUBLIC_AUTH_PATHS = frozenset({"/api/auth/status", "/api/auth/login", "/api/auth/setup"})
USER_WRITES = re.compile(r"/api/vehicles/[1-9][0-9]*/(?:odometer-evidence|odometer-captures|incidents|faults|evidence|documents)")
USER_READS = re.compile(r"/api/(?:auth/me|vehicles(?:/[1-9][0-9]*(?:/(?:incidents|odometer-evidence|evidence|documents))?)?|incidents|evidence/[A-Za-z0-9_-]+)")


def normalized_email(email: str) -> str:
    return email.strip().casefold()


def effective_role(user: CompanyUser) -> str:
    # Old administrative rows cannot preserve privileges after an upgrade.
    # Only the explicitly authorized identities can have administrative powers;
    # being on the allowlist does not automatically promote a driver account.
    # This is checked on every request, not only at login.
    return "admin" if user.role == "admin" and normalized_email(user.email) in ADMIN_EMAILS else "user"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P,
                            maxmem=256 * 1024 * 1024, dklen=32)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, n, r, p, salt, expected = encoded.split("$")
        # Do not accept attacker-controlled, unbounded cost parameters.
        if algorithm != "scrypt" or (int(n), int(r), int(p)) != (SCRYPT_N, SCRYPT_R, SCRYPT_P):
            return False
        salt_bytes, expected_bytes = bytes.fromhex(salt), bytes.fromhex(expected)
        if len(salt_bytes) != 16 or len(expected_bytes) != 32:
            return False
        actual = hashlib.scrypt(password.encode("utf-8"), salt=salt_bytes, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P,
                                maxmem=256 * 1024 * 1024, dklen=32)
        return hmac.compare_digest(actual, expected_bytes)
    except (ValueError, TypeError, OverflowError):
        return False


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


@dataclass(frozen=True)
class Principal:
    id: int
    name: str
    email: str
    role: str
    vehicle_ids: frozenset[int]


def user_payload(session: Session, user: CompanyUser) -> dict:
    ids = list(session.scalars(select(UserVehicleAssignment.vehicle_id)
                              .where(UserVehicleAssignment.user_id == user.id).order_by(UserVehicleAssignment.vehicle_id)))
    return {"id": user.id, "name": user.name, "email": user.email, "role": effective_role(user),
            "active": user.active, "vehicle_ids": ids}


def principal_from_user(session: Session, user: CompanyUser) -> Principal:
    return Principal(user.id, user.name, user.email, effective_role(user), frozenset(user_payload(session, user)["vehicle_ids"]))


def authorize_admin(session: Session) -> None:
    principal = session.info.get("principal")
    # None is only admitted by AuthManager before the first account exists.
    if principal is not None and (principal.role != "admin" or normalized_email(principal.email) not in ADMIN_EMAILS):
        raise HTTPException(403, "Esta acción requiere un perfil de administrador.")


def actor_id(session: Session) -> int | None:
    principal = session.info.get("principal")
    return principal.id if principal else None


def accessible_vehicle_ids(session: Session) -> frozenset[int] | None:
    principal = session.info.get("principal")
    return principal.vehicle_ids if principal and principal.role != "admin" else None


def scoped_vehicles(session: Session):
    query = select(Vehicle).order_by(Vehicle.id)
    ids = accessible_vehicle_ids(session)
    if ids is not None:
        query = query.where(Vehicle.id.in_(ids))
    return session.scalars(query)


class AttemptLimiter:
    """Bounded process-local throttling; no passwords, tokens or raw email keys.

    This is a local single-process service. A shared rate limiter is required
    before scaling to multiple backend workers or public internet deployment.
    """
    def __init__(self):
        self._attempts = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, request: Request, identity: str, _session: Session | None = None) -> None:
        now = time.monotonic()
        address = request.client.host if request.client else "local"
        identity_digest = hashlib.sha256(identity.encode()).hexdigest()
        # Ignore spoofable forwarded-IP headers. The authenticated local proxy
        # shares an address, so its overall threshold is deliberately broader.
        keys = ((f"identity:{identity_digest}", 8), (f"address:{address}", 60))
        with self._lock:
            for key in list(self._attempts):
                bucket = self._attempts[key]
                while bucket and bucket[0] <= now - 900:
                    bucket.popleft()
                if not bucket:
                    del self._attempts[key]
            if any(len(self._attempts[key]) >= limit for key, limit in keys):
                raise HTTPException(429, "Demasiados intentos. Espere 15 minutos antes de volver a intentar.",
                                    headers={"Retry-After": "900"})
            for key, _limit in keys:
                self._attempts[key].append(now)


class PersistentAttemptLimiter:
    """PostgreSQL counters commit independently of a rejected login.

    ON CONFLICT UPDATE locks each counter row across all backend instances.
    The proxy has already authenticated its API key before these routes run;
    its optional trusted-client digest is never read from a public IP header.
    """
    def __init__(self, api_key: str):
        self._key = api_key.encode("utf-8")

    def _digest(self, value: str) -> str:
        return hmac.new(self._key, value.encode("utf-8"), hashlib.sha256).hexdigest()

    def _buckets(self, request: Request, identity: str) -> list[tuple[str, int]]:
        trusted_client = request.headers.get("x-trusted-client", "")
        address = trusted_client if re.fullmatch(r"[a-f0-9]{64}", trusted_client) else "global"
        # Always lock the address bucket BEFORE an identity bucket. Check the
        # address first so a blocked sender cannot create unlimited new email
        # counters. Domains keep address and identity locks disjoint. A keyed
        # digest also prevents guessing emails from a leaked counter table.
        return [(self._digest(f"address:{address}"), 60),
                (self._digest(f"identity:{identity}"), 8)]

    @staticmethod
    def _statement(key_digest: str, limit: int):
        table = AuthAttemptCounter.__table__
        now = func.now()
        expired = table.c.window_started_at <= now - timedelta(minutes=15)
        statement = postgres_insert(table).values(key_digest=key_digest, window_started_at=now, attempts=1)
        return statement.on_conflict_do_update(
            index_elements=[table.c.key_digest],
            set_={"window_started_at": case((expired, now), else_=table.c.window_started_at),
                  "attempts": case((expired, 1), (table.c.attempts < limit + 1, table.c.attempts + 1),
                                   else_=table.c.attempts)},
        ).returning(table.c.attempts)

    def check(self, request: Request, identity: str, session: Session | None = None) -> None:
        if session is None:
            raise RuntimeError("El limitador público requiere una sesión PostgreSQL.")
        engine = session.get_bind()
        # Sessions bind to the shared Engine in the app. A Connection-bound
        # administrative caller must still use a NEW connection, not the
        # outer transaction that may roll back after HTTPException(401).
        if hasattr(engine, "engine"):
            engine = engine.engine
        if engine.dialect.name != "postgresql":
            raise RuntimeError("El limitador público requiere PostgreSQL.")
        blocked = False
        with engine.begin() as connection:
            for key_digest, limit in self._buckets(request, identity):
                attempts = connection.scalar(self._statement(key_digest, limit))
                if attempts > limit:
                    blocked = True
                    break
        # Raise only after the independent transaction has committed, even
        # when both buckets were already at their limit.
        if blocked:
            raise HTTPException(429, "Demasiados intentos. Espere 15 minutos antes de volver a intentar.",
                                headers={"Retry-After": "900"})


class AuthManager:
    def __init__(self, api_key: str = ""):
        self.cloud = os.getenv("YOKOHAMA_DEPLOYMENT_MODE", "local").strip().lower() == "cloud"
        self.require_auth = self.cloud or os.getenv("YOKOHAMA_REQUIRE_AUTH", "").strip().lower() in {"1", "true", "yes"}
        self.setup_token = os.getenv("YOKOHAMA_SETUP_TOKEN", "")
        self.limiter = PersistentAttemptLimiter(api_key) if self.cloud else AttemptLimiter()

    def status(self, session: Session) -> dict:
        configured = session.scalar(select(CompanyUser.id).limit(1)) is not None
        return {"configured": configured, "required": configured or self.require_auth}

    def authenticate_request(self, request: Request, session: Session) -> Principal | None:
        if request.url.path in PUBLIC_AUTH_PATHS:
            return None
        required = self.status(session)["required"]
        token = request.headers.get("x-session-token", "")
        principal = None
        if token:
            if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
                raise HTTPException(401, "La sesión no es válida o venció. Inicie sesión nuevamente.")
            record = session.get(UserSession, token_digest(token))
            user = session.get(CompanyUser, record.user_id) if record else None
            if record is None or record.revoked_at is not None or as_utc(record.expires_at) <= utc_now() or user is None or not user.active:
                raise HTTPException(401, "La sesión no es válida o venció. Inicie sesión nuevamente.")
            principal = principal_from_user(session, user)
        elif required:
            raise HTTPException(401, "Inicie sesión para acceder a las unidades de la empresa.")
        if principal and principal.role != "admin":
            path = request.url.path
            if request.method in {"GET", "HEAD"} and not USER_READS.fullmatch(path):
                raise HTTPException(403, "Esta sección requiere un perfil de administrador.")
            if request.method not in {"GET", "HEAD", "OPTIONS"}:
                if not (request.method == "POST" and (path in {"/api/auth/logout", "/api/auth/password"} or USER_WRITES.fullmatch(path))):
                    raise HTTPException(403, "Esta acción requiere un perfil de administrador.")
        session.info["principal"] = principal
        return principal

    def issue_session(self, session: Session, user: CompanyUser) -> dict:
        token = secrets.token_urlsafe(32)
        expires = utc_now() + timedelta(hours=SESSION_HOURS)
        session.add(UserSession(token_hash=token_digest(token), user_id=user.id, expires_at=expires))
        session.flush()
        return {"user": user_payload(session, user), "session_token": token, "expires_at": expires.isoformat()}

    def password_matches(self, password: str, user: CompanyUser | None) -> bool:
        # This public, deliberately impossible dummy record is not a credential.
        # It performs the same scrypt work for unknown and known accounts; the
        # explicit user check below never authenticates an absent account.
        correct = verify_password(password, user.password_hash if user else DUMMY_PASSWORD_HASH)
        return bool(user and user.active and correct)
