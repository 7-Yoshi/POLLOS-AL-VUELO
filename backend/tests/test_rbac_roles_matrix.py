"""
Matriz exhaustiva de pruebas RBAC para los 4 perfiles del sistema Pollos al Vuelo:
  1. Administrador (acceso a las 3 sucursales y todos los módulos; NO puede editar/borrar auditoría)
  2. Gerente (supervisión solo lectura operativa + calendario + predicciones + reportes + auditoría de sus sucursales)
  3. Encargado de sucursal (exactamente 1 sucursal; operaciones + CSV + predicciones solo lectura)
  4. Demás trabajadores (cocineros, cajeros, meseros, limpieza: sin acceso salvo autorización como Encargado)
"""
from unittest.mock import patch

from app.db.collections import AUDIT_LOGS, USERS
from app.db.models import now_utc
from tests.conftest import auth_headers


# ───────────────────────── 1. ADMINISTRADOR ─────────────────────────

def test_admin_full_access_and_immutable_audit(client, fake_db):
    """Administrador opera en las 3 sucursales, consulta auditoría, pero recibe 403 al editar/eliminar auditoría."""
    # Acceso a las 3 sucursales
    branches = client.get("/api/v1/branches/", headers=auth_headers("uid_admin"))
    assert branches.status_code == 200
    assert len(branches.json()) == 3

    # Crear ítem (insumo) -> genera evento de auditoría
    item_res = client.post(
        "/api/v1/items/",
        headers=auth_headers("uid_admin"),
        json={"code": "INS-CAJA", "name": "Caja Cartón", "item_type": "insumo", "base_unit": "unidad"},
    )
    assert item_res.status_code == 201

    # Crear compra en suc_sur (tercera sucursal)
    purch_res = client.post(
        "/api/v1/purchases/",
        headers=auth_headers("uid_admin"),
        json={
            "branch_id": "suc_sur",
            "purchase_date": "2026-11-25",
            "lines": [{"item_id": "item_pollo", "quantity_base": 25.0, "unit": "kg"}],
        },
    )
    assert purch_res.status_code == 201

    # Consultar auditoría (debe ver eventos globales y de todas las sucursales)
    audit_res = client.get("/api/v1/audit/", headers=auth_headers("uid_admin"))
    assert audit_res.status_code == 200
    logs = audit_res.json()
    assert len(logs) >= 2
    target_log_id = logs[0]["id"]

    # Inmutabilidad estricta: ni siquiera el Administrador puede modificar o eliminar auditoría
    assert client.put(f"/api/v1/audit/{target_log_id}", headers=auth_headers("uid_admin")).status_code == 403
    assert client.patch(f"/api/v1/audit/{target_log_id}", headers=auth_headers("uid_admin")).status_code == 403
    assert client.delete(f"/api/v1/audit/{target_log_id}", headers=auth_headers("uid_admin")).status_code == 403
    assert fake_db.collection(AUDIT_LOGS).document(target_log_id).get().exists


def test_admin_can_edit_user_role_and_branches_with_strict_cardinality(client, fake_db):
    """Valida cardinalidad Rol <-> Sucursales en POST y PATCH /users/."""
    # Encargado con 0 sucursales -> 422
    res_enc_0 = client.post(
        "/api/v1/users/",
        headers=auth_headers("uid_admin"),
        json={
            "email": "enc0@pollosalvuelo.com",
            "password": "Password2026!",
            "full_name": "Encargado Cero",
            "role": "encargado",
            "branch_ids": [],
        },
    )
    assert res_enc_0.status_code == 422

    # Encargado con 2 sucursales -> 422
    res_enc_2 = client.post(
        "/api/v1/users/",
        headers=auth_headers("uid_admin"),
        json={
            "email": "enc2@pollosalvuelo.com",
            "password": "Password2026!",
            "full_name": "Encargado Dos",
            "role": "encargado",
            "branch_ids": ["suc_central", "suc_norte"],
        },
    )
    assert res_enc_2.status_code == 422

    # Gerente con 0 sucursales -> 422
    res_ger_0 = client.post(
        "/api/v1/users/",
        headers=auth_headers("uid_admin"),
        json={
            "email": "ger0@pollosalvuelo.com",
            "password": "Password2026!",
            "full_name": "Gerente Cero",
            "role": "gerente",
            "branch_ids": [],
        },
    )
    assert res_ger_0.status_code == 422

    # Admin sin branch_ids -> asigna automáticamente las 3 sucursales activas
    with patch("app.modules.users.router.create_firebase_user", return_value="uid_admin_2"), \
         patch("app.modules.users.router.set_user_role_claim"):
        res_adm = client.post(
            "/api/v1/users/",
            headers=auth_headers("uid_admin"),
            json={
                "email": "admin2@pollosalvuelo.com",
                "password": "Password2026!",
                "full_name": "Segundo Admin",
                "role": "admin",
                "branch_ids": [],
            },
        )
    assert res_adm.status_code == 201
    assert set(res_adm.json()["branch_ids"]) == {"suc_central", "suc_norte", "suc_sur"}

    # Editar encargado existente intentando darle 2 sucursales -> 422
    bad_patch = client.patch(
        "/api/v1/users/uid_encargado",
        headers=auth_headers("uid_admin"),
        json={"branch_ids": ["suc_central", "suc_sur"]},
    )
    assert bad_patch.status_code == 422

    # Editar encargado cambiando a otra única sucursal (`suc_sur`) -> 200
    ok_patch = client.patch(
        "/api/v1/users/uid_encargado",
        headers=auth_headers("uid_admin"),
        json={"branch_ids": ["suc_sur"]},
    )
    assert ok_patch.status_code == 200
    assert fake_db.collection(USERS).document("uid_encargado").get().to_dict()["branch_ids"] == ["suc_sur"]


# ───────────────────────── 2. GERENTE ─────────────────────────

def test_gerente_permissions_and_restrictions(client, fake_db):
    """Gerente supervisa sus sucursales asignadas, gestiona calendario/predicciones/reportes/auditoría y NO escribe operaciones."""
    hdr = auth_headers("uid_gerente")  # asignado a suc_central y suc_norte

    # Consultas permitidas en sucursales asignadas
    assert client.get("/api/v1/branches/", headers=hdr).status_code == 200
    assert len(client.get("/api/v1/branches/", headers=hdr).json()) == 2
    assert client.get("/api/v1/items/", headers=hdr).status_code == 200
    assert client.get("/api/v1/purchases/", params={"branch_id": "suc_central"}, headers=hdr).status_code == 200
    assert client.get("/api/v1/inventory/balance", params={"branch_id": "suc_central"}, headers=hdr).status_code == 200
    assert client.get("/api/v1/consumption/", params={"branch_id": "suc_norte"}, headers=hdr).status_code == 200
    assert client.get("/api/v1/predictions/", params={"branch_id": "suc_central"}, headers=hdr).status_code == 200

    # Aislamiento: NO puede acceder a suc_sur (no asignada)
    assert client.get("/api/v1/consumption/", params={"branch_id": "suc_sur"}, headers=hdr).status_code == 403

    # SÍ puede gestionar calendario operativo en sucursal asignada
    ev_res = client.post(
        "/api/v1/operations/events",
        headers=hdr,
        json={
            "branch_id": "suc_central",
            "event_type": "feriado",
            "name": "Feriado Nacional",
            "start_date": "2026-12-25",
            "end_date": "2026-12-25",
        },
    )
    assert ev_res.status_code == 201
    assert client.get("/api/v1/operations/events", params={"branch_id": "suc_central"}, headers=hdr).status_code == 200

    # Auditoría aislada para Gerente: crear un log global de usuario (admin) y un log en suc_sur (admin)
    client.post(
        "/api/v1/items/",
        headers=auth_headers("uid_admin"),
        json={"code": "MP-ACEITE", "name": "Aceite", "item_type": "materia_prima", "base_unit": "litro"},
    )
    client.post(
        "/api/v1/purchases/",
        headers=auth_headers("uid_admin"),
        json={
            "branch_id": "suc_sur",
            "purchase_date": "2026-11-25",
            "lines": [{"item_id": "item_pollo", "quantity_base": 10, "unit": "kg"}],
        },
    )
    ger_audit = client.get("/api/v1/audit/", headers=hdr)
    assert ger_audit.status_code == 200
    for log in ger_audit.json():
        assert log["branch_id"] in {"suc_central", "suc_norte"}  # Nunca None ni suc_sur

    # Prohibiciones absolutas de Gerente (todos HTTP 403)
    assert client.get("/api/v1/users/", headers=hdr).status_code == 403
    assert client.post("/api/v1/branches/", headers=hdr, json={"name": "Nueva"}).status_code == 403
    assert client.patch("/api/v1/branches/suc_central", headers=hdr, json={"name": "Edit"}).status_code == 403
    assert client.post(
        "/api/v1/items/",
        headers=hdr,
        json={"code": "X", "name": "X", "item_type": "insumo", "base_unit": "u"},
    ).status_code == 403
    assert client.post(
        "/api/v1/purchases/",
        headers=hdr,
        json={
            "branch_id": "suc_central",
            "purchase_date": "2026-11-25",
            "lines": [{"item_id": "item_pollo", "quantity_base": 5, "unit": "kg"}],
        },
    ).status_code == 403
    assert client.post(
        "/api/v1/inventory/movements",
        headers=hdr,
        json={
            "branch_id": "suc_central",
            "item_id": "item_pollo",
            "movement_type": "merma",
            "quantity_base": 2,
            "unit": "kg",
            "effective_date": "2026-11-25",
        },
    ).status_code == 403
    assert client.post(
        "/api/v1/consumption/",
        headers=hdr,
        json={
            "branch_id": "suc_central",
            "item_id": "item_pollo",
            "consumption_date": "2026-11-25",
            "quantity_base": 12,
            "unit": "kg",
            "status": "medido",
        },
    ).status_code == 403
    assert client.post(
        "/api/v1/consumption/import-csv",
        headers=hdr,
        data={"branch_id": "suc_central"},
        files={"file": ("c.csv", b"fecha,codigo_item,cantidad_base,unidad,estado,notas\n", "text/csv")},
    ).status_code == 403
    assert client.delete("/api/v1/audit/cualquier_id", headers=hdr).status_code == 403


# ───────────────────────── 3. ENCARGADO DE SUCURSAL ─────────────────────────

def test_encargado_permissions_and_restrictions(client):
    """Encargado opera en su única sucursal asignada y recibe 403 en todos los módulos restringidos."""
    hdr = auth_headers("uid_encargado")  # asignado solo a suc_central

    # Operaciones permitidas en su sucursal
    assert client.get("/api/v1/items/", headers=hdr).status_code == 200
    assert client.get("/api/v1/predictions/", params={"branch_id": "suc_central"}, headers=hdr).status_code == 200
    assert client.post(
        "/api/v1/consumption/",
        headers=hdr,
        json={
            "branch_id": "suc_central",
            "item_id": "item_pollo",
            "consumption_date": "2026-11-25",
            "quantity_base": 33.5,
            "unit": "kg",
            "status": "medido",
        },
    ).status_code == 201

    # Prohibiciones absolutas de Encargado (todos HTTP 403)
    assert client.get("/api/v1/operations/events", params={"branch_id": "suc_central"}, headers=hdr).status_code == 403
    assert client.post(
        "/api/v1/operations/events",
        headers=hdr,
        json={
            "branch_id": "suc_central",
            "event_type": "feriado",
            "name": "No permitido",
            "start_date": "2026-12-25",
            "end_date": "2026-12-25",
        },
    ).status_code == 403
    assert client.post(
        "/api/v1/predictions/predict",
        headers=hdr,
        json={"branch_id": "suc_central", "item_id": "item_pollo", "prediction_for_date": "2026-11-26"},
    ).status_code == 403
    assert client.get("/api/v1/users/", headers=hdr).status_code == 403
    assert client.post("/api/v1/branches/", headers=hdr, json={"name": "Sucursal Nueva"}).status_code == 403
    assert client.post(
        "/api/v1/items/",
        headers=hdr,
        json={"code": "NO-OK", "name": "No", "item_type": "materia_prima", "base_unit": "kg"},
    ).status_code == 403
    assert client.get(
        "/api/v1/reports/consumption-summary",
        params={"branch_id": "suc_central", "from_date": "2026-11-01", "to_date": "2026-11-30"},
        headers=hdr,
    ).status_code == 403
    assert client.get("/api/v1/audit/", headers=hdr).status_code == 403


# ───────────────────────── 4. DEMÁS TRABAJADORES ─────────────────────────

def test_other_workers_denied_unless_authorized_as_encargado(client, fake_db):
    """Cocineros, cajeros, meseros y limpieza no tienen acceso salvo autorización expresa como Encargado."""
    # Trabajador sin cuenta registrada en Firestore -> HTTP 401
    res_unregistered = client.get("/api/v1/auth/me", headers=auth_headers("uid_mesero_no_registrado"))
    assert res_unregistered.status_code == 401

    # Trabajador con documento pero rol fuera de lista blanca (ej. cocinero) -> HTTP 403
    now = now_utc()
    fake_db.collection(USERS).document("uid_cocinero").set({
        "firebase_uid": "uid_cocinero",
        "email": "cocinero@pollosalvuelo.com",
        "full_name": "Juan Cocinero",
        "role": "cocinero",
        "branch_ids": ["suc_central"],
        "is_active": True,
        "must_change_password": False,
        "created_at": now,
        "updated_at": now,
    })
    res_bad_role = client.get("/api/v1/auth/me", headers=auth_headers("uid_cocinero"))
    assert res_bad_role.status_code == 403

    # Autorización explícita por Administrador como Encargado de suc_sur -> accede solo a suc_sur
    with patch("app.modules.users.router.create_firebase_user", return_value="uid_cajero_autorizado"), \
         patch("app.modules.users.router.set_user_role_claim"):
        auth_res = client.post(
            "/api/v1/users/",
            headers=auth_headers("uid_admin"),
            json={
                "email": "cajero.sur@pollosalvuelo.com",
                "password": "ClaveTemporal2026!",
                "full_name": "María Cajera Autorizada",
                "role": "encargado",
                "branch_ids": ["suc_sur"],
                "must_change_password": True,
            },
        )
    assert auth_res.status_code == 201

    me_res = client.get("/api/v1/auth/me", headers=auth_headers("uid_cajero_autorizado"))
    assert me_res.status_code == 200
    assert me_res.json()["role"] == "encargado"
    assert me_res.json()["branch_ids"] == ["suc_sur"]
    assert client.get(
        "/api/v1/consumption/", params={"branch_id": "suc_sur"}, headers=auth_headers("uid_cajero_autorizado")
    ).status_code == 200
    assert client.get(
        "/api/v1/consumption/", params={"branch_id": "suc_central"}, headers=auth_headers("uid_cajero_autorizado")
    ).status_code == 403
