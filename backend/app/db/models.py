"""
Modelos y enumeraciones de dominio — Pollos al Vuelo (Cloud Firestore NoSQL).
"""
from datetime import datetime, date, timezone
from enum import Enum as PyEnum
from typing import Any


class RoleName(str, PyEnum):
    admin = "admin"
    gerente = "gerente"
    encargado = "encargado"


class ItemType(str, PyEnum):
    materia_prima = "materia_prima"
    insumo = "insumo"


class MovementType(str, PyEnum):
    compra = "compra"
    consumo = "consumo"
    ajuste_entrada = "ajuste_entrada"
    ajuste_salida = "ajuste_salida"
    merma = "merma"
    traslado_entrada = "traslado_entrada"
    traslado_salida = "traslado_salida"


class ConsumptionStatus(str, PyEnum):
    medido = "medido"
    calculado_validado = "calculado_validado"
    desconocido = "desconocido"


class ImportStatus(str, PyEnum):
    pendiente = "pendiente"
    procesado = "procesado"
    rechazado = "rechazado"


class EventType(str, PyEnum):
    feriado = "feriado"
    cierre = "cierre"
    dia_especial = "dia_especial"
    bloqueo = "bloqueo"


POSITIVE_MOVEMENT_TYPES: frozenset[str] = frozenset({
    MovementType.compra.value,
    MovementType.ajuste_entrada.value,
    MovementType.traslado_entrada.value,
})

NEGATIVE_MOVEMENT_TYPES: frozenset[str] = frozenset({
    MovementType.consumo.value,
    MovementType.ajuste_salida.value,
    MovementType.merma.value,
    MovementType.traslado_salida.value,
})


def signed_movement_quantity(movement_type: MovementType | str, quantity_base: float) -> float:
    """Retorna la variación con signo (+ entrada / - salida) para actualizar saldos."""
    val = movement_type.value if isinstance(movement_type, MovementType) else str(movement_type)
    qty = abs(float(quantity_base))
    return qty if val in POSITIVE_MOVEMENT_TYPES else -qty


def now_utc() -> datetime:
    """Timestamp UTC con zona horaria (compatible nativamente con Firestore Timestamp)."""
    return datetime.now(timezone.utc)


def to_iso(value: Any) -> str | None:
    """Convierte datetime/date/Timestamp de Firestore a cadena ISO-8601."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)
