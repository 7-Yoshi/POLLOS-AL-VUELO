/**
 * App.tsx — enrutador raíz con contextos y rutas protegidas.
 */
import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { BranchProvider } from './contexts/BranchContext'
import PrivateRoute from './features/auth/PrivateRoute'
import LoginPage from './features/auth/LoginPage'
import ChangePasswordPage from './features/auth/ChangePasswordPage'
import AppLayout from './layouts/AppLayout'

const DashboardPage   = lazy(() => import('./features/dashboard/DashboardPage'))
const ItemsPage       = lazy(() => import('./features/items/ItemsPage'))
const InsumosPage     = lazy(() => import('./features/items/InsumosPage'))
const PurchasesPage   = lazy(() => import('./features/purchases/PurchasesPage'))
const InventoryPage   = lazy(() => import('./features/inventory/InventoryPage'))
const ConsumptionPage = lazy(() => import('./features/consumption/ConsumptionPage'))
const OperationsPage  = lazy(() => import('./features/operations/OperationsPage'))
const PredictionsPage = lazy(() => import('./features/predictions/PredictionsPage'))
const ReportsPage     = lazy(() => import('./features/reports/ReportsPage'))
const AuditPage       = lazy(() => import('./features/audit/AuditPage'))
const UsersPage       = lazy(() => import('./features/users/UsersPage'))
const BranchesPage    = lazy(() => import('./features/branches/BranchesPage'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-48">
      <div className="w-8 h-8 border-4 border-brand-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BranchProvider>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            {/* Cambio obligatorio de contraseña en primer ingreso */}
            <Route element={<PrivateRoute allowPasswordChange />}>
              <Route path="/change-password" element={<ChangePasswordPage />} />
            </Route>

            {/* Rutas protegidas (cualquier usuario autenticado) */}
            <Route element={<PrivateRoute />}>
              <Route element={<AppLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="items"       element={<ItemsPage />} />
                <Route path="insumos"     element={<InsumosPage />} />
                <Route path="purchases"   element={<PurchasesPage />} />
                <Route path="inventory"   element={<InventoryPage />} />
                <Route path="consumption" element={<ConsumptionPage />} />
                {/* Problema 3: Encargado accede a Predicciones en modo solo lectura */}
                <Route path="predictions" element={<PredictionsPage />} />

                {/* Solo admin y gerente */}
                <Route element={<PrivateRoute allowedRoles={['admin', 'gerente']} />}>
                  <Route path="operations" element={<OperationsPage />} />
                  <Route path="reports"    element={<ReportsPage />} />
                  <Route path="audit"      element={<AuditPage />} />
                  <Route path="branches"   element={<BranchesPage />} />
                </Route>

                {/* Solo admin */}
                <Route element={<PrivateRoute allowedRoles={['admin']} />}>
                  <Route path="users" element={<UsersPage />} />
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BranchProvider>
    </AuthProvider>
  )
}
