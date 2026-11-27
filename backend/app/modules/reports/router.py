"""
Módulo Reportes (M09) — consultas, exportación CSV y vista consolidada multi-sucursal.
Realiza análisis y agregación en memoria con `pandas` sobre datos extraídos de Cloud Firestore.
"""
import csv
import io
from datetime import date
from typing import Optional

import pandas as pd
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.api.deps import AuthUser, DbClient
from app.core.permissions import require_branch_access, require_permission
from app.db.collections import (
    BRANCHES,
    CONSUMPTION_DAILY,
    INVENTORY_BALANCES,
    ITEMS,
    PURCHASES,
    apply_filter,
)

router = APIRouter()


def _resolve_target_branches(db: DbClient, current_user: AuthUser, branch_id: Optional[str]) -> dict[str, str]:
    """Devuelve mapa {branch_id: branch_name} respetando RBAC y aislamiento por sucursal."""
    if branch_id:
        require_branch_access(current_user.role, current_user.branch_ids, branch_id)
        snap = db.collection(BRANCHES).document(branch_id).get()
        name = (snap.to_dict() or {}).get("name", branch_id) if snap.exists else branch_id
        return {branch_id: name}

    all_active = list(apply_filter(db.collection(BRANCHES), "is_active", "==", True).stream())
    branch_map: dict[str, str] = {}
    for doc in all_active:
        if current_user.role != "admin" and doc.id not in current_user.branch_ids:
            continue
        branch_map[doc.id] = (doc.to_dict() or {}).get("name", doc.id)
    return branch_map


def _fetch_consumption_records(
    db: DbClient,
    branch_ids: list[str],
    from_date: date,
    to_date: date,
    item_id: Optional[str] = None,
) -> list[dict]:
    from_str = from_date.isoformat()
    to_str = to_date.isoformat()
    rows: list[dict] = []
    for bid in branch_ids:
        for doc in apply_filter(db.collection(CONSUMPTION_DAILY), "branch_id", "==", bid).stream():
            d = doc.to_dict() or {}
            cdate = d.get("consumption_date") or ""
            if cdate < from_str or cdate > to_str:
                continue
            if item_id and d.get("item_id") != item_id:
                continue
            qty = d.get("quantity_base")
            rows.append({
                "branch_id": d.get("branch_id"),
                "date": cdate,
                "item_id": d.get("item_id"),
                "quantity_base": float(qty) if qty is not None else None,
                "unit": d.get("unit", ""),
                "status": d.get("status", "desconocido"),
            })
    rows.sort(key=lambda r: (r["date"], r["branch_id"] or ""))
    return rows


@router.get("/consumption-summary")
async def consumption_summary(
    current_user: AuthUser,
    db: DbClient,
    from_date: date,
    to_date: date,
    branch_id: Optional[str] = None,
    item_id: Optional[str] = None,
):
    """Resumen de consumo para una sucursal o consolidado de todas las autorizadas."""
    require_permission(current_user.role, "reports")
    branch_map = _resolve_target_branches(db, current_user, branch_id)
    records = _fetch_consumption_records(db, list(branch_map.keys()), from_date, to_date, item_id)
    for r in records:
        r["branch_name"] = branch_map.get(r["branch_id"], r["branch_id"])

    return {
        "branch_id": branch_id,
        "scope": "single" if branch_id else "consolidated",
        "branches": [{"id": bid, "name": bname} for bid, bname in branch_map.items()],
        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "total_records": len(records),
        "records": records,
    }


@router.get("/consumption-export")
async def export_consumption_csv(
    current_user: AuthUser,
    db: DbClient,
    from_date: date,
    to_date: date,
    branch_id: Optional[str] = None,
    item_id: Optional[str] = None,
):
    """Exporta consumo (por sucursal o consolidado de las 3 sucursales) como CSV."""
    require_permission(current_user.role, "reports")
    branch_map = _resolve_target_branches(db, current_user, branch_id)
    records = _fetch_consumption_records(db, list(branch_map.keys()), from_date, to_date, item_id)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["fecha", "sucursal_id", "sucursal_nombre", "item_id", "cantidad_base", "unidad", "estado"])
    for r in records:
        writer.writerow([
            r["date"],
            r["branch_id"],
            branch_map.get(r["branch_id"], r["branch_id"]),
            r["item_id"],
            r["quantity_base"] if r["quantity_base"] is not None else "",
            r["unit"],
            r["status"],
        ])

    output.seek(0)
    scope_tag = branch_id or "todas_sucursales"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=consumo_{scope_tag}_{from_date}_{to_date}.csv"
        },
    )


@router.get("/consolidated")
async def consolidated_branches_report(
    current_user: AuthUser,
    db: DbClient,
    from_date: date,
    to_date: date,
    item_id: Optional[str] = None,
):
    """
    Problema 4: Vista consolidada y comparativa de las sucursales autorizadas (Admin / Gerente).
    Extrae consumos, compras y saldos desde Cloud Firestore y agrega con `pandas`.
    """
    require_permission(current_user.role, "reports")
    branch_map = _resolve_target_branches(db, current_user, branch_id=None)
    branch_ids = list(branch_map.keys())
    from_str = from_date.isoformat()
    to_str = to_date.isoformat()

    # 1. Consumo en período
    consumption_rows = _fetch_consumption_records(db, branch_ids, from_date, to_date, item_id)
    df_cons = pd.DataFrame(consumption_rows)

    # 2. Compras en período por sucursal
    purchases_count: dict[str, int] = {bid: 0 for bid in branch_ids}
    for bid in branch_ids:
        for doc in apply_filter(db.collection(PURCHASES), "branch_id", "==", bid).stream():
            d = doc.to_dict() or {}
            pdate = d.get("purchase_date") or ""
            if from_str <= pdate <= to_str:
                purchases_count[bid] += 1

    # 3. Stock bajo desde vista materializada `inventory_balances`
    min_stocks: dict[str, Optional[float]] = {}
    for doc in apply_filter(db.collection(ITEMS), "is_active", "==", True).stream():
        d = doc.to_dict() or {}
        min_stocks[doc.id] = float(d["min_stock"]) if d.get("min_stock") is not None else None

    low_stock_count: dict[str, int] = {bid: 0 for bid in branch_ids}
    for bid in branch_ids:
        for doc in apply_filter(db.collection(INVENTORY_BALANCES), "branch_id", "==", bid).stream():
            d = doc.to_dict() or {}
            ms = min_stocks.get(str(d.get("item_id")))
            if ms is not None and float(d.get("balance", 0.0)) < ms:
                low_stock_count[bid] += 1

    # 4. Métricas comparativas por sucursal usando pandas
    by_branch = []
    for bid, bname in branch_map.items():
        if not df_cons.empty:
            sub = df_cons[df_cons["branch_id"] == bid]
            valid = sub[sub["quantity_base"].notna()]
            total_qty = round(float(valid["quantity_base"].sum()), 4) if not valid.empty else 0.0
            daily_totals = valid.groupby("date")["quantity_base"].sum() if not valid.empty else pd.Series(dtype=float)
            avg_daily = round(float(daily_totals.mean()), 4) if not daily_totals.empty else 0.0
            validated_cnt = int(len(valid))
            unknown_cnt = int(sub["quantity_base"].isna().sum())
            active_days = int(daily_totals.shape[0])
        else:
            total_qty, avg_daily, validated_cnt, unknown_cnt, active_days = 0.0, 0.0, 0, 0, 0

        by_branch.append({
            "branch_id": bid,
            "branch_name": bname,
            "total_consumption": total_qty,
            "avg_daily_consumption": avg_daily,
            "active_days": active_days,
            "validated_records": validated_cnt,
            "unknown_records": unknown_cnt,
            "purchases_count": purchases_count.get(bid, 0),
            "low_stock_count": low_stock_count.get(bid, 0),
        })

    # 5. Serie diaria comparativa para gráfica multi-sucursal
    daily_comparison: list[dict] = []
    if not df_cons.empty:
        valid_all = df_cons[df_cons["quantity_base"].notna()]
        if not valid_all.empty:
            pivot = (
                valid_all.pivot_table(
                    index="date",
                    columns="branch_id",
                    values="quantity_base",
                    aggfunc="sum",
                    fill_value=0.0,
                )
                .sort_index()
            )
            for dt_str, row in pivot.iterrows():
                entry: dict = {"date": str(dt_str)}
                for bid in branch_ids:
                    entry[bid] = round(float(row[bid]), 4) if bid in pivot.columns else 0.0
                daily_comparison.append(entry)

    return {
        "from_date": from_str,
        "to_date": to_str,
        "item_id": item_id,
        "branches": [{"id": bid, "name": bname} for bid, bname in branch_map.items()],
        "totals": {
            "total_consumption": round(sum(b["total_consumption"] for b in by_branch), 4),
            "validated_records": sum(b["validated_records"] for b in by_branch),
            "unknown_records": sum(b["unknown_records"] for b in by_branch),
            "purchases_count": sum(b["purchases_count"] for b in by_branch),
            "low_stock_count": sum(b["low_stock_count"] for b in by_branch),
        },
        "by_branch": by_branch,
        "daily_comparison": daily_comparison,
    }
