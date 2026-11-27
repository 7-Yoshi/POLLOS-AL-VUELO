"""
Módulo Operaciones (M07) — calendario de eventos operativos (feriados, cierres, días especiales).
Almacena `active_dates` para integración directa con features del modelo ML en Cloud Firestore.
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, model_validator

from app.api.deps import AuthUser, DbClient
from app.core.audit import record_audit
from app.core.permissions import require_branch_access, require_permission
from app.db.collections import OPERATION_EVENTS, apply_filter, expand_date_range
from app.db.models import EventType, now_utc, to_iso

router = APIRouter()


class EventCreateSchema(BaseModel):
    branch_id: str
    event_type: EventType
    name: str
    start_date: date
    end_date: date
    description: Optional[str] = None

    @model_validator(mode="after")
    def check_dates(self) -> "EventCreateSchema":
        if self.start_date > self.end_date:
            raise ValueError("start_date debe ser <= end_date")
        return self


@router.get("/events")
async def list_events(
    current_user: AuthUser,
    db: DbClient,
    branch_id: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
):
    require_permission(current_user.role, "operations")
    docs = []
    if branch_id:
        require_branch_access(current_user.role, current_user.branch_ids, branch_id)
        docs = list(apply_filter(db.collection(OPERATION_EVENTS), "branch_id", "==", branch_id).stream())
    elif current_user.role == "admin":
        docs = list(db.collection(OPERATION_EVENTS).stream())
    else:
        for bid in current_user.branch_ids:
            docs.extend(apply_filter(db.collection(OPERATION_EVENTS), "branch_id", "==", bid).stream())

    from_str = from_date.isoformat() if from_date else None
    to_str = to_date.isoformat() if to_date else None

    events = []
    for doc in docs:
        d = doc.to_dict() or {}
        sdate = d.get("start_date") or ""
        edate = d.get("end_date") or ""
        if from_str and edate < from_str:
            continue
        if to_str and sdate > to_str:
            continue
        events.append({
            "id": doc.id,
            "branch_id": d.get("branch_id"),
            "event_type": d.get("event_type"),
            "name": d.get("name"),
            "start_date": sdate,
            "end_date": edate,
            "description": d.get("description"),
            "created_by_uid": d.get("created_by_uid"),
            "created_at": to_iso(d.get("created_at")),
        })

    events.sort(key=lambda e: e["start_date"])
    return events


@router.post("/events", status_code=status.HTTP_201_CREATED)
async def create_event(data: EventCreateSchema, current_user: AuthUser, db: DbClient):
    require_permission(current_user.role, "operations")
    require_branch_access(current_user.role, current_user.branch_ids, data.branch_id)

    now = now_utc()
    ref = db.collection(OPERATION_EVENTS).document()
    active_dates = expand_date_range(data.start_date, data.end_date)

    batch = db.batch()
    batch.create(ref, {
        "branch_id": data.branch_id,
        "event_type": data.event_type.value,
        "name": data.name.strip(),
        "start_date": data.start_date.isoformat(),
        "end_date": data.end_date.isoformat(),
        "active_dates": active_dates,
        "description": data.description,
        "created_by_uid": current_user.firebase_uid,
        "created_at": now,
    })
    record_audit(
        db=db,
        current_user=current_user,
        action="CREATE",
        entity_type="operation_event",
        entity_id=ref.id,
        branch_id=data.branch_id,
        details={
            "event_type": data.event_type.value,
            "name": data.name.strip(),
            "start_date": data.start_date.isoformat(),
            "end_date": data.end_date.isoformat(),
        },
        batch=batch,
    )
    batch.commit()
    return {"id": ref.id, "message": "Evento registrado"}


@router.delete("/events/{event_id}", status_code=status.HTTP_200_OK)
async def delete_event(event_id: str, current_user: AuthUser, db: DbClient):
    require_permission(current_user.role, "operations")
    ref = db.collection(OPERATION_EVENTS).document(event_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Evento no encontrado")
    d = snap.to_dict() or {}
    require_branch_access(current_user.role, current_user.branch_ids, d.get("branch_id"))

    batch = db.batch()
    batch.delete(ref)
    record_audit(
        db=db,
        current_user=current_user,
        action="DELETE",
        entity_type="operation_event",
        entity_id=event_id,
        branch_id=d.get("branch_id"),
        details={"name": d.get("name")},
        batch=batch,
    )
    batch.commit()
    return {"message": "Evento eliminado"}
