"""
Script idempotente de inicialización para Cloud Firestore — Pollos al Vuelo.
Crea las 3 sucursales iniciales y crea (o vincula si ya existe en Firebase Auth)
el usuario administrador en la colección `users/{uid}` de Cloud Firestore.

Uso:
    python -m scripts.seed_firestore
    python -m scripts.seed_firestore --admin-email admin@pollosalvuelo.com --admin-password AdminPollos2026! --admin-name "Administrador General"
"""
import argparse
import logging

from firebase_admin import auth as firebase_auth

from app.core.firebase_auth import create_firebase_user, get_firebase_app, set_user_role_claim
from app.db.collections import BRANCHES, USERS
from app.db.firestore_client import get_firestore_client
from app.db.models import now_utc

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_BRANCHES = [
    {"id": "suc_central", "name": "Sucursal Central", "address": "Av. Principal #100", "phone": ""},
    {"id": "suc_norte", "name": "Sucursal Norte", "address": "Zona Norte", "phone": ""},
    {"id": "suc_sur", "name": "Sucursal Sur", "address": "Zona Sur", "phone": ""},
]


def seed_branches(db) -> list[str]:
    now = now_utc()
    ids: list[str] = []
    for b in DEFAULT_BRANCHES:
        ref = db.collection(BRANCHES).document(b["id"])
        snap = ref.get()
        if not snap.exists:
            ref.set({
                "name": b["name"],
                "address": b["address"],
                "phone": b["phone"],
                "is_active": True,
                "created_at": now,
                "updated_at": now,
            })
            logger.info("Sucursal creada: %s (%s)", b["name"], b["id"])
        else:
            logger.info("Sucursal existente: %s (%s)", b["name"], b["id"])
        ids.append(b["id"])
    return ids


def seed_admin(
    db,
    email: str,
    password: str,
    full_name: str,
    branch_ids: list[str],
    reset_password: bool = False,
) -> str:
    now = now_utc()
    email_norm = email.lower().strip()
    get_firebase_app()

    try:
        uid = create_firebase_user(email=email_norm, password=password, display_name=full_name)
        logger.info("Cuenta creada en Firebase Auth: %s (uid=%s)", email_norm, uid)
    except ValueError:
        # El correo ya existe en Firebase Auth: recuperar su UID y vincularlo a Firestore
        existing = firebase_auth.get_user_by_email(email_norm)
        uid = existing.uid
        if reset_password:
            firebase_auth.update_user(uid, password=password, disabled=False, display_name=full_name.strip())
            logger.info("Contraseña actualizada en Firebase Auth para %s (uid=%s)", email_norm, uid)
        else:
            logger.info("Cuenta ya existía en Firebase Auth; vinculando a Firestore: %s (uid=%s)", email_norm, uid)

    set_user_role_claim(uid, "admin")
    db.collection(USERS).document(uid).set({
        "firebase_uid": uid,
        "email": email_norm,
        "full_name": full_name.strip(),
        "username": "admin",
        "role": "admin",
        "branch_ids": branch_ids,
        "is_active": True,
        "must_change_password": False,
        "created_by_uid": uid,
        "created_at": now,
        "updated_at": now,
    }, merge=True)
    logger.info("Perfil administrador listo en Cloud Firestore: users/%s", uid)
    return uid


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed inicial de Cloud Firestore para Pollos al Vuelo")
    parser.add_argument("--admin-email", help="Correo del primer administrador")
    parser.add_argument("--admin-password", help="Contraseña del administrador (mín. 8 caracteres)")
    parser.add_argument("--admin-name", default="Administrador General", help="Nombre completo")
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help="Si el correo ya existe en Firebase Auth, actualiza también su contraseña",
    )
    args = parser.parse_args()

    db = get_firestore_client()
    branch_ids = seed_branches(db)

    if args.admin_email and args.admin_password:
        seed_admin(
            db,
            args.admin_email,
            args.admin_password,
            args.admin_name,
            branch_ids,
            reset_password=args.reset_password,
        )
    else:
        logger.info("Sucursales verificadas. Pasa --admin-email y --admin-password para crear/vincular el admin inicial.")


if __name__ == "__main__":
    main()
