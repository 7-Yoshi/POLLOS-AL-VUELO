/**
 * Ruta protegida — verifica sesión, fuerza cambio de contraseña si `must_change_password=true`,
 * valida roles permitidos y muestra aviso de arranque lento de Render Free.
 */
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import type { UserRole } from '../../types'

interface PrivateRouteProps {
  allowedRoles?: UserRole[]
  allowPasswordChange?: boolean
}

export default function PrivateRoute({
  allowedRoles,
  allowPasswordChange = false,
}: PrivateRouteProps) {
  const { currentUser, loading, slowServer } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center space-y-3 max-w-sm">
          <div className="inline-block w-10 h-10 border-4 border-brand-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-600 text-sm font-medium">Verificando sesión…</p>
          {slowServer && (
            <p className="text-xs text-gray-500 bg-blue-50 border border-blue-200 rounded-lg p-3">
              El servidor backend en Render Free se está iniciando. Esto puede tardar hasta 45 segundos en el primer acceso.
            </p>
          )}
        </div>
      </div>
    )
  }

  if (!currentUser) return <Navigate to="/login" replace />

  if (currentUser.must_change_password && !allowPasswordChange) {
    return <Navigate to="/change-password" replace />
  }

  if (!currentUser.must_change_password && allowPasswordChange) {
    return <Navigate to="/" replace />
  }

  if (allowedRoles && !allowedRoles.includes(currentUser.role)) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
