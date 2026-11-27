"""
Doble de pruebas fiel de Cloud Firestore en memoria para ejecutar pruebas unitarias
y de integración 100% offline sin requerir proyecto Firebase ni red externa.
"""
from copy import deepcopy
from types import SimpleNamespace
from typing import Any, Callable, Optional
import uuid

from app.db.firestore_client import DuplicateDocumentError


class FakeDocumentSnapshot:
    def __init__(self, doc_id: str, data: Optional[dict[str, Any]], reference: "FakeDocumentReference"):
        self.id = doc_id
        self._data = deepcopy(data) if data is not None else None
        self.reference = reference

    @property
    def exists(self) -> bool:
        return self._data is not None

    def to_dict(self) -> Optional[dict[str, Any]]:
        return deepcopy(self._data) if self._data is not None else None


class FakeDocumentReference:
    def __init__(self, client: "FakeFirestoreClient", collection_name: str, doc_id: str):
        self._client = client
        self._collection = collection_name
        self.id = doc_id

    def get(self, transaction: Any = None) -> FakeDocumentSnapshot:
        col = self._client._store.setdefault(self._collection, {})
        return FakeDocumentSnapshot(self.id, col.get(self.id), self)

    def create(self, data: dict[str, Any]) -> None:
        col = self._client._store.setdefault(self._collection, {})
        if self.id in col:
            raise DuplicateDocumentError(f"Documento {self._collection}/{self.id} ya existe")
        col[self.id] = deepcopy(data)

    def set(self, data: dict[str, Any], merge: bool = False) -> None:
        col = self._client._store.setdefault(self._collection, {})
        if merge and self.id in col:
            col[self.id].update(deepcopy(data))
        else:
            col[self.id] = deepcopy(data)

    def update(self, data: dict[str, Any]) -> None:
        col = self._client._store.setdefault(self._collection, {})
        if self.id not in col:
            raise KeyError(f"Documento {self._collection}/{self.id} no existe")
        col[self.id].update(deepcopy(data))

    def delete(self) -> None:
        col = self._client._store.setdefault(self._collection, {})
        col.pop(self.id, None)


class FakeAggregationQuery:
    def __init__(self, query: "FakeQuery"):
        self._query = query

    def get(self) -> list[list[SimpleNamespace]]:
        total = len(list(self._query.stream()))
        return [[SimpleNamespace(value=total)]]


class FakeQuery:
    def __init__(
        self,
        client: "FakeFirestoreClient",
        collection_name: str,
        filters: Optional[list[tuple[str, str, Any]]] = None,
        order_field: Optional[str] = None,
        order_desc: bool = False,
        limit_n: Optional[int] = None,
    ):
        self._client = client
        self._collection = collection_name
        self._filters = list(filters or [])
        self._order_field = order_field
        self._order_desc = order_desc
        self._limit_n = limit_n

    def where_filter(self, field: str, op: str, value: Any) -> "FakeQuery":
        return FakeQuery(
            self._client,
            self._collection,
            self._filters + [(field, op, value)],
            self._order_field,
            self._order_desc,
            self._limit_n,
        )

    def where(self, field: Any = None, op: str = "==", value: Any = None, filter: Any = None) -> "FakeQuery":
        if filter is not None:
            return self.where_filter(filter.field_path, filter.op_string, filter.value)
        return self.where_filter(field, op, value)

    def order_by(self, field: str, direction: str = "ASCENDING") -> "FakeQuery":
        desc = str(direction).upper().endswith("DESCENDING")
        return FakeQuery(self._client, self._collection, self._filters, field, desc, self._limit_n)

    def limit(self, n: int) -> "FakeQuery":
        return FakeQuery(self._client, self._collection, self._filters, self._order_field, self._order_desc, n)

    def select(self, fields: list[str]) -> "FakeQuery":
        return self

    def count(self) -> FakeAggregationQuery:
        return FakeAggregationQuery(self)

    @staticmethod
    def _matches(doc_data: dict[str, Any], field: str, op: str, value: Any) -> bool:
        actual = doc_data.get(field)
        if op == "==":
            return actual == value
        if op == "!=":
            return actual != value
        if op == "in":
            return actual in value
        if op == "array_contains":
            return isinstance(actual, list) and value in actual
        if actual is None:
            return False
        if op == "<":
            return actual < value
        if op == "<=":
            return actual <= value
        if op == ">":
            return actual > value
        if op == ">=":
            return actual >= value
        raise ValueError(f"Operador no soportado en FakeFirestore: {op}")

    def stream(self):
        col = self._client._store.setdefault(self._collection, {})
        snaps: list[FakeDocumentSnapshot] = []
        for doc_id, data in col.items():
            if all(self._matches(data, f, op, val) for f, op, val in self._filters):
                ref = FakeDocumentReference(self._client, self._collection, doc_id)
                snaps.append(FakeDocumentSnapshot(doc_id, data, ref))

        if self._order_field:
            snaps.sort(
                key=lambda s: (s._data.get(self._order_field) is None, s._data.get(self._order_field)),
                reverse=self._order_desc,
            )
        if self._limit_n is not None:
            snaps = snaps[: self._limit_n]
        return iter(snaps)


class FakeCollection(FakeQuery):
    def __init__(self, client: "FakeFirestoreClient", collection_name: str):
        super().__init__(client, collection_name)

    def document(self, doc_id: Optional[str] = None) -> FakeDocumentReference:
        final_id = doc_id if doc_id is not None else uuid.uuid4().hex[:20]
        return FakeDocumentReference(self._client, self._collection, str(final_id))


class FakeWriteBatch:
    def __init__(self, client: "FakeFirestoreClient"):
        self._client = client
        self._ops: list[tuple[str, FakeDocumentReference, Any]] = []

    def create(self, ref: FakeDocumentReference, data: dict[str, Any]) -> None:
        self._ops.append(("create", ref, deepcopy(data)))

    def set(self, ref: FakeDocumentReference, data: dict[str, Any], merge: bool = False) -> None:
        self._ops.append(("set", ref, (deepcopy(data), merge)))

    def update(self, ref: FakeDocumentReference, data: dict[str, Any]) -> None:
        self._ops.append(("update", ref, deepcopy(data)))

    def delete(self, ref: FakeDocumentReference) -> None:
        self._ops.append(("delete", ref, None))

    def commit(self) -> None:
        if self._client.fail_next_commit:
            self._client.fail_next_commit = False
            raise RuntimeError("Fallo simulado de escritura en Firestore")

        # Validación atómica antes de aplicar cambios
        snapshot = deepcopy(self._client._store)
        try:
            for op, ref, payload in self._ops:
                if op == "create":
                    ref.create(payload)
                elif op == "set":
                    data, merge = payload
                    ref.set(data, merge=merge)
                elif op == "update":
                    ref.update(payload)
                elif op == "delete":
                    ref.delete()
        except Exception:
            self._client._store = snapshot
            raise
        finally:
            self._ops.clear()


class FakeFirestoreClient:
    def __init__(self):
        self._store: dict[str, dict[str, dict[str, Any]]] = {}
        self.fail_next_commit: bool = False

    def collection(self, name: str) -> FakeCollection:
        return FakeCollection(self, name)

    def batch(self) -> FakeWriteBatch:
        return FakeWriteBatch(self)

    def run_transaction(self, callback: Callable[[FakeWriteBatch], Any]) -> Any:
        snapshot = deepcopy(self._store)
        txn = FakeWriteBatch(self)
        try:
            result = callback(txn)
            txn.commit()
            return result
        except Exception:
            self._store = snapshot
            raise
