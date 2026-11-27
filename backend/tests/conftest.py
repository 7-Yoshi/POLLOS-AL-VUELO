"""
Fixtures compartidas de pytest — Pollos al Vuelo (Cloud Firestore).
"""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.db.collections import BRANCHES, ITEM_CODES, ITEMS, USERS
from app.db.firestore_client import get_db
from app.db.models import now_utc
from app.main import app
from tests.fake_firestore import FakeFirestoreClient


@pytest.fixture
def fake_db() -> FakeFirestoreClient:
    """Base Cloud Firestore en memoria poblada con 3 sucursales, 4 usuarios y 2 ítems."""
    db = FakeFirestoreClient()
    now = now_utc()

    # 3 sucursales de Pollos al Vuelo
    for bid, name in [
        ("suc_central", "Sucursal Central"),
        ("suc_norte", "Sucursal Norte"),
        ("suc_sur", "Sucursal Sur"),
    ]:
        db.collection(BRANCHES).document(bid).set({
            "name": name,
            "address": f"Dirección {name}",
            "phone": "70000000",
            "is_active": True,
            "created_at": now,
            "updated_at": now,
        })

    # Usuarios con distintos roles y aislamiento de sucursales
    db.collection(USERS).document("uid_admin").set({
        "firebase_uid": "uid_admin",
        "email": "admin@pollosalvuelo.com",
        "full_name": "Admin General",
        "role": "admin",
        "branch_ids": ["suc_central", "suc_norte", "suc_sur"],
        "is_active": True,
        "must_change_password": False,
        "created_at": now,
        "updated_at": now,
    })
    db.collection(USERS).document("uid_gerente").set({
        "firebase_uid": "uid_gerente",
        "email": "gerente@pollosalvuelo.com",
        "full_name": "Gerente Operaciones",
        "role": "gerente",
        "branch_ids": ["suc_central", "suc_norte"],
        "is_active": True,
        "must_change_password": False,
        "created_at": now,
        "updated_at": now,
    })
    db.collection(USERS).document("uid_encargado").set({
        "firebase_uid": "uid_encargado",
        "email": "encargado.central@pollosalvuelo.com",
        "full_name": "Encargado Central",
        "role": "encargado",
        "branch_ids": ["suc_central"],
        "is_active": True,
        "must_change_password": False,
        "created_at": now,
        "updated_at": now,
    })
    db.collection(USERS).document("uid_nuevo").set({
        "firebase_uid": "uid_nuevo",
        "email": "nuevo@pollosalvuelo.com",
        "full_name": "Nuevo Empleado",
        "role": "encargado",
        "branch_ids": ["suc_central"],
        "is_active": True,
        "must_change_password": True,
        "created_at": now,
        "updated_at": now,
    })
    db.collection(USERS).document("uid_inactivo").set({
        "firebase_uid": "uid_inactivo",
        "email": "inactivo@pollosalvuelo.com",
        "full_name": "Usuario Inactivo",
        "role": "encargado",
        "branch_ids": ["suc_central"],
        "is_active": False,
        "must_change_password": False,
        "created_at": now,
        "updated_at": now,
    })

    # Ítems catálogo
    db.collection(ITEMS).document("item_pollo").set({
        "code": "MP-POLLO",
        "name": "Pollo Entero",
        "item_type": "materia_prima",
        "category": "proteina",
        "base_unit": "kg",
        "min_stock": 20.0,
        "eligible_for_ml": True,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
    })
    db.collection(ITEM_CODES).document("MP-POLLO").set({"item_id": "item_pollo", "code": "MP-POLLO"})

    db.collection(ITEMS).document("item_papa").set({
        "code": "MP-PAPA",
        "name": "Papa Holandesa",
        "item_type": "materia_prima",
        "category": "vegetal",
        "base_unit": "kg",
        "min_stock": 15.0,
        "eligible_for_ml": True,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
    })
    db.collection(ITEM_CODES).document("MP-PAPA").set({"item_id": "item_papa", "code": "MP-PAPA"})

    return db


@pytest.fixture
def client(fake_db: FakeFirestoreClient):
    """Cliente HTTP FastAPI conectado al FakeFirestoreClient y verificador de token stub."""
    app.dependency_overrides[get_db] = lambda: fake_db

    def _fake_verify(token: str) -> dict:
        if token.startswith("valid::"):
            uid = token.split("valid::", 1)[1]
            return {"uid": uid, "email": f"{uid}@pollosalvuelo.com"}
        raise ValueError("Token inválido o revocado")

    with patch("app.api.deps.verify_firebase_token", side_effect=_fake_verify):
        yield TestClient(app)

    app.dependency_overrides.clear()


def auth_headers(uid: str) -> dict[str, str]:
    return {"Authorization": f"Bearer valid::{uid}"}
