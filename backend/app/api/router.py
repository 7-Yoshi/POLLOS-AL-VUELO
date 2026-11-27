"""
Router principal — une todas las rutas de módulos bajo /api/v1.
"""
from fastapi import APIRouter

from app.modules.auth.router import router as auth_router
from app.modules.users.router import router as users_router
from app.modules.branches.router import router as branches_router
from app.modules.items.router import router as items_router
from app.modules.purchases.router import router as purchases_router
from app.modules.inventory.router import router as inventory_router
from app.modules.consumption.router import router as consumption_router
from app.modules.operations.router import router as operations_router
from app.modules.predictions.router import router as predictions_router
from app.modules.reports.router import router as reports_router
from app.modules.audit.router import router as audit_router

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(auth_router, prefix="/auth", tags=["Autenticación"])
api_router.include_router(users_router, prefix="/users", tags=["Usuarios"])
api_router.include_router(branches_router, prefix="/branches", tags=["Sucursales"])
api_router.include_router(items_router, prefix="/items", tags=["Materiales e Insumos"])
api_router.include_router(purchases_router, prefix="/purchases", tags=["Compras"])
api_router.include_router(inventory_router, prefix="/inventory", tags=["Inventario"])
api_router.include_router(consumption_router, prefix="/consumption", tags=["Consumo Diario"])
api_router.include_router(operations_router, prefix="/operations", tags=["Calendario"])
api_router.include_router(predictions_router, prefix="/predictions", tags=["Predicciones ML"])
api_router.include_router(reports_router, prefix="/reports", tags=["Reportes"])
api_router.include_router(audit_router, prefix="/audit", tags=["Auditoría"])
