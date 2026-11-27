/**
 * Módulo M10c — Auditoría Inmutable del Sistema (`audit_logs`).
 * - Administrador: consulta todos los eventos del sistema y las 3 sucursales.
 * - Gerente: consulta únicamente eventos de sus sucursales asignadas.
 * - Ningún rol (incluido Administrador) puede editar ni eliminar registros de auditoría.
 */
import { useEffect, useMemo, useState } from 'react'

import {
  InfoCircleIcon,
  LayersIcon,
  RefreshIcon,
  ShieldAuditIcon,
  UsersGroupIcon,
} from '../../components/ui/Icons'
import {
  EmptyState,
  GradientPanel,
  KpiStatCard,
  PageSpinner,
} from '../../components/ui/SystemUI'
import { useAuth } from '../../contexts/AuthContext'
import { useBranch } from '../../contexts/BranchContext'
import api from '../../lib/api'
import type { AuditLogItem } from '../../types'

const ENTITY_OPTIONS = [
  { value: '', label: 'Todas las entidades' },
  { value: 'purchase', label: 'Compras' },
  { value: 'inventory_movement', label: 'Movimientos de inventario' },
  { value: 'consumption_daily', label: 'Consumo diario' },
  { value: 'operation_event', label: 'Calendario operativo' },
  { value: 'prediction', label: 'Predicciones ML' },
  { value: 'item', label: 'Materias primas / Insumos' },
  { value: 'branch', label: 'Sucursales' },
  { value: 'user', label: 'Usuarios' },
]

const ACTION_OPTIONS = [
  { value: '', label: 'Todas las acciones' },
  { value: 'CREATE', label: 'Creación (CREATE)' },
  { value: 'UPDATE', label: 'Actualización (UPDATE)' },
  { value: 'DELETE', label: 'Eliminación (DELETE)' },
  { value: 'SOFT_DELETE', label: 'Desactivación (SOFT_DELETE)' },
  { value: 'IMPORT_CSV', label: 'Importación CSV' },
  { value: 'PREDICT', label: 'Predicción ML' },
  { value: 'DEACTIVATE_AND_REVOKE', label: 'Desactivar + Revocar' },
  { value: 'REACTIVATE', label: 'Reactivar usuario' },
  { value: 'PASSWORD_CHANGE', label: 'Cambio de contraseña' },
]

export default function AuditPage() {
  const { currentUser } = useAuth()
  const { branches } = useBranch()

  const [logs, setLogs] = useState<AuditLogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [branchFilter, setBranchFilter] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get<AuditLogItem[]>('/api/v1/audit/', {
        params: {
          branch_id: branchFilter || undefined,
          entity_type: entityFilter || undefined,
          action: actionFilter || undefined,
          from_date: fromDate || undefined,
          to_date: toDate || undefined,
          limit: 150,
        },
      })
      setLogs(data)
    } catch {
      setError('Error al cargar la bitácora de auditoría.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [branchFilter, entityFilter, actionFilter, fromDate, toDate])

  const uniqueActors = useMemo(
    () => new Set(logs.map((l) => l.user_email).filter(Boolean)).size,
    [logs]
  )

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiStatCard
          label="Eventos consultados"
          value={logs.length}
          subtext="Según filtros activos"
          icon={<LayersIcon className="w-6 h-6" />}
          tone="gold"
        />
        <KpiStatCard
          label="Usuarios registrados en bitácora"
          value={uniqueActors}
          subtext="Identificados por firebase_uid"
          icon={<UsersGroupIcon className="w-6 h-6" />}
          tone="orange"
        />
        <KpiStatCard
          label="Integridad de bitácora"
          value="Inmutable"
          subtext="Solo lectura (sin edición ni borrado)"
          icon={<ShieldAuditIcon className="w-6 h-6" />}
          tone="rose"
        />
      </div>

      <div className="alert-info flex items-start gap-2.5 text-[13px]">
        <InfoCircleIcon className="w-4 h-4 text-[#C8102E] shrink-0 mt-0.5" />
        <span>
          <strong>Trazabilidad e inmutabilidad:</strong> Cada operación crítica queda registrada con
          el usuario responsable (<code>firebase_uid</code>) y marca temporal UTC.{' '}
          <strong>
            Ningún usuario —incluido el Administrador— puede modificar ni eliminar registros de
            auditoría.
          </strong>
          {currentUser?.role === 'gerente' && (
            <span> Como Gerente, visualizas únicamente los eventos de tus sucursales asignadas.</span>
          )}
        </span>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <GradientPanel
        title="Bitácora inmutable de auditoría"
        icon={<ShieldAuditIcon className="w-5 h-5" />}
        bodyClassName="p-0"
        actions={
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 bg-white text-[#C8102E] hover:bg-[#FFF5F2] rounded-[10px] px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors"
          >
            <RefreshIcon className="w-3.5 h-3.5" />
            Actualizar
          </button>
        }
      >
        {/* Barra de 5 filtros */}
        <div className="p-4 border-b border-[#F1E8E4] bg-[#FFFBF9] grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-[#666666] mb-1">Sucursal</label>
            <select
              className="input py-1.5 min-h-[38px] text-xs"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
            >
              <option value="">
                {currentUser?.role === 'admin'
                  ? 'Todas las sucursales'
                  : 'Mis sucursales asignadas'}
              </option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[#666666] mb-1">Entidad</label>
            <select
              className="input py-1.5 min-h-[38px] text-xs"
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
            >
              {ENTITY_OPTIONS.filter(
                (opt) => !(currentUser?.role === 'gerente' && opt.value === 'user')
              ).map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[#666666] mb-1">Acción</label>
            <select
              className="input py-1.5 min-h-[38px] text-xs"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
            >
              {ACTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[#666666] mb-1">Desde</label>
            <input
              type="date"
              className="input py-1.5 min-h-[38px] text-xs"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[#666666] mb-1">Hasta</label>
            <input
              type="date"
              className="input py-1.5 min-h-[38px] text-xs"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <PageSpinner label="Cargando bitácora…" />
        ) : logs.length === 0 ? (
          <EmptyState
            icon={<ShieldAuditIcon className="w-6 h-6" />}
            title="Sin registros para estos filtros"
            description="Ajusta el rango de fechas o los filtros de sucursal, entidad y acción."
          />
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha / Hora</th>
                  <th>Usuario</th>
                  <th>Acción</th>
                  <th>Entidad</th>
                  <th>Sucursal</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3EAE6]">
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="text-xs text-[#555555]">
                      {log.created_at ? new Date(log.created_at).toLocaleString() : '—'}
                    </td>
                    <td>
                      <div className="text-xs font-semibold text-[#222222]">{log.user_email}</div>
                      <div className="text-[11px] text-[#888888] font-mono">
                        {log.user_role} · {log.firebase_uid.slice(0, 10)}…
                      </div>
                    </td>
                    <td>
                      <ActionBadge action={log.action} />
                    </td>
                    <td>
                      <div className="text-xs font-medium text-[#222222]">{log.entity_type}</div>
                      {log.entity_id && (
                        <div className="text-[11px] text-[#888888] font-mono truncate max-w-[140px]">
                          {log.entity_id}
                        </div>
                      )}
                    </td>
                    <td className="text-xs text-[#555555]">
                      {log.branch_id ? (branchMap.get(log.branch_id) ?? log.branch_id) : 'Global'}
                    </td>
                    <td
                      className="text-xs text-[#666666] max-w-[260px] truncate"
                      title={log.details ?? ''}
                    >
                      {formatDetails(log.details)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GradientPanel>
    </div>
  )
}

function formatDetails(raw: string | null): string {
  if (!raw) return '—'
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    return Object.entries(obj)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join(' · ')
  } catch {
    return raw
  }
}

function ActionBadge({ action }: { action: string }) {
  if (action === 'CREATE' || action === 'IMPORT_CSV') {
    return <span className="badge-green">{action}</span>
  }
  if (action === 'DELETE' || action === 'SOFT_DELETE' || action === 'DEACTIVATE_AND_REVOKE') {
    return <span className="badge-red">{action}</span>
  }
  if (action === 'PREDICT' || action === 'UPDATE' || action === 'REACTIVATE') {
    return <span className="badge-blue">{action}</span>
  }
  return <span className="badge-gray">{action}</span>
}
