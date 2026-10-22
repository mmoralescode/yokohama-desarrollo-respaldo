"""Provision the reserved owner without placing a password in arguments.

Run from backend: python -m app.provision_owner --database-url sqlite:///data/yokohama.db
Use --password-file with a private plaintext file, --password-env with the name
of an environment variable, or the default hidden interactive prompt. Make a
database backup before running; this command never migrates or replaces data.
"""
import argparse
import getpass
import os
from pathlib import Path

from sqlalchemy import inspect, select, update
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from .auth import ADMIN_EMAILS, OWNER_EMAIL, hash_password, normalized_email
from .auth_models import CompanyUser, UserSession
from .database import make_database
from .time_utils import utc_now


def provision_owner(session: Session, password: str, name: str = "Administración Yokohama") -> dict:
    """Account-only changes in the caller's transaction; never return secrets."""
    if not 12 <= len(password) <= 128:
        raise ValueError("La contraseña debe tener entre 12 y 128 caracteres.")
    name = " ".join(name.split())
    if not name or len(name) > 100:
        raise ValueError("El nombre debe tener entre 1 y 100 caracteres.")
    users = list(session.scalars(select(CompanyUser)))
    owners = [user for user in users if normalized_email(user.email) == OWNER_EMAIL]
    if len(owners) > 1:
        raise ValueError("Hay correos duplicados de la cuenta administradora. Revise las cuentas antes de continuar.")
    encoded = hash_password(password)
    now = utc_now()
    demoted = 0
    for user in users:
        if normalized_email(user.email) not in ADMIN_EMAILS and user.role == "admin":
            user.role = "user"
            user.updated_at = now
            session.execute(update(UserSession).where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None)).values(revoked_at=now))
            demoted += 1
    if owners:
        owner = owners[0]
        owner.email = OWNER_EMAIL
        owner.role = "admin"
        owner.active = True
        owner.password_hash = encoded
        owner.updated_at = now
        session.execute(update(UserSession).where(UserSession.user_id == owner.id, UserSession.revoked_at.is_(None)).values(revoked_at=now))
    else:
        owner = CompanyUser(name=name, email=OWNER_EMAIL, password_hash=encoded, role="admin", active=True)
        session.add(owner)
    session.flush()
    return {"email": OWNER_EMAIL, "previous_admins_demoted": demoted, "created": not owners}


def main() -> None:
    parser = argparse.ArgumentParser(description="Preparar la cuenta administradora principal de Yokohama.")
    parser.add_argument("--database-url", default=os.getenv("YOKOHAMA_DATABASE_URL"), help="URL de una base existente y migrada.")
    parser.add_argument("--name", default="Administración Yokohama")
    sources = parser.add_mutually_exclusive_group()
    sources.add_argument("--password-file", type=Path, help="Archivo privado con la contraseña; nunca se imprime.")
    sources.add_argument("--password-env", help="Nombre de la variable que contiene la contraseña.")
    args = parser.parse_args()
    if not args.database_url:
        parser.error("Indique --database-url o configure YOKOHAMA_DATABASE_URL.")
    try:
        url = make_url(args.database_url)
        if url.get_backend_name() == "sqlite" and (not url.database or url.database == ":memory:" or not Path(url.database).is_file()):
            parser.error("La base SQLite indicada no existe. No se creará una base vacía.")
        if args.password_file:
            password = args.password_file.read_text(encoding="utf-8-sig").rstrip("\r\n")
        elif args.password_env:
            password = os.getenv(args.password_env, "")
        else:
            password = getpass.getpass("Nueva contraseña de admin.yoko@gmail.com: ")
            if password != getpass.getpass("Confirmar contraseña: "):
                parser.error("Las contraseñas no coinciden.")
        engine, sessions = make_database(args.database_url)
        try:
            if not {"company_users", "user_sessions", "user_vehicle_assignments"}.issubset(inspect(engine).get_table_names()):
                parser.error("La base no tiene el esquema de cuentas. Ejecute las migraciones de la aplicación primero.")
            with sessions.begin() as session:
                result = provision_owner(session, password, args.name)
            print(f"Cuenta administradora preparada: {result['email']}. Administradores anteriores convertidos a conductores: {result['previous_admins_demoted']}.")
        finally:
            engine.dispose()
    except (OSError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
