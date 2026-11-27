/**
 * Módulo M10b — Gestión de Sucursales.
 * - Administrador: crea, edita y activa/desactiva sucursales (con pestaña integrada a Usuarios).
 * - Gerente: consulta en modo solo lectura sus sucursales asignadas.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import {
  BranchStoreIcon,
  EditPencilIcon,
  MapPinIcon,
  PlusIcon,
  UsersGroupIcon,
} from '../../components/ui/Icons'
import {
  AppModal,
  EmptyState,
  GradientPanel,
  KpiStatCard,
  PageSpinner,
} from '../../components/ui/SystemUI'
import { useAuth } from '../../contexts/AuthContext'
import api from '../../lib/api'
import type { Branch } from '../../types'

export default function BranchesPage() {
  const { currentUser } = useAuth()
  const canWrite = currentUser?.role === 'admin'

  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [editBranch, setEditBranch] = useState<Branch | null>(null)
  const [form, setForm] = useState({ name: '', address: '', phone: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [toggleTarget, setToggleTarget] = useState<Branch | null>(null)
  const [toggling, setToggling] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get<Branch[]>('/api/v1/branches/')
      setBranches(data)
    } catch {
      setError('Error al cargar las sucursales.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const openCreate = () => {
    setEditBranch(null)
    setForm({ name: '', address: '', phone: '' })
    setFormError(null)
    setShowForm(true)
  }

  const openEdit = (b: Branch) => {
    setEditBranch(b)
    setForm({ name: b.name, address: b.address ?? '', phone: b.phone ?? '' })
    setFormError(null)
    setShowForm(true)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setFormError('El nombre de la sucursal es obligatorio.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        name: form.name.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
      }
      if (editBranch) {
        await api.patch(`/api/v1/branches/${editBranch.id}`, payload)
      } else {
        await api.post('/api/v1/branches/', payload)
      }
      setShowForm(false)
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setFormError(detail ?? 'Error al guardar la sucursal.')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmToggle = async () => {
    if (!toggleTarget) return
    setToggling(true)
    try {
      await api.patch(`/api/v1/branches/${toggleTarget.id}`, {
        is_active: !toggleTarget.is_active,
      })
      setToggleTarget(null)
      await load()
    } catch {
      setError('No se pudo cambiar el estado de la sucursal.')
      setToggleTarget(null)
    } finally {
      setToggling(false)
    }
  }

  const activeCount = branches.filter((b) => b.is_active).length

  return (
    <div className="space-y-5">
      {/* Pestañas unificadas para Admin */}
      {canWrite && (
        <div className="inline-flex bg-white border border-[#EFE4DF] rounded-[13px] p-1 shadow-sm">
          <Link
            to="/users"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-[10px] text-xs font-semibold text-[#555555] hover:text-[#C8102E] hover:bg-[#FFF5F0] transition-colors"
          >
            <UsersGroupIcon className="w-4 h-4" />
            Usuarios
          </Link>
          <Link
            to="/branches"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-[10px] text-xs font-semibold pav-nav-active text-white"
          >
            <BranchStoreIcon className="w-4 h-4" />
            Sucursales ({branches.length})
          </Link>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiStatCard
          label="Sucursales visibles"
          value={branches.length}
          subtext="Red Pollos al Vuelo"
          icon={<BranchStoreIcon className="w-6 h-6" />}
          tone="gold"
        />
        <KpiStatCard
          label="Sucursales activas"
          value={activeCount}
          subtext="En operación diaria"
          icon={<MapPinIcon className="w-6 h-6" />}
          tone="green"
        />
        <KpiStatCard
          label="Sucursales inactivas"
          value={branches.length - activeCount}
          subtext="Fuera de operación"
          icon={<BranchStoreIcon className="w-6 h-6" />}
          tone="rose"
        />
      </div>

      {!canWrite && (
        <div className="alert-info flex items-center justify-between gap-2 text-[13px]">
          <span>
            Estás visualizando tus sucursales asignadas en modo <strong>solo lectura</strong>.
          </span>
          <span className="badge-blue shrink-0">Supervisión</span>
        </div>
      )}

      {error && <div className="alert-error">{error}</div>}

      <GradientPanel
        title="Sucursales registradas"
        icon={<BranchStoreIcon className="w-5 h-5" />}
        bodyClassName="p-0"
        actions={
          canWrite ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 bg-[#B70726] hover:bg-[#99051F] text-white border border-white/25 rounded-[10px] px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-colors"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              Nueva sucursal
            </button>
          ) : undefined
        }
      >
        {loading ? (
          <PageSpinner label="Cargando sucursales…" />
        ) : branches.length === 0 ? (
          <EmptyState
            icon={<BranchStoreIcon className="w-6 h-6" />}
            title="No hay sucursales registradas"
            description="El administrador puede crear y gestionar las sucursales de Pollos al Vuelo desde este panel."
          />
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Sucursal</th>
                  <th>Dirección</th>
                  <th>Teléfono</th>
                  <th>Estado</th>
                  {canWrite && <th className="text-right">Acciones</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3EAE6]">
                {branches.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-[9px] bg-[#FFEDE0] text-[#D95B00] inline-flex items-center justify-center shrink-0">
                          <MapPinIcon className="w-4 h-4" />
                        </span>
                        <div>
                          <p className="font-semibold text-[#222222]">{b.name}</p>
                          <p className="text-[11px] font-mono text-[#888888]">{b.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-[#555555]">{b.address ?? '—'}</td>
                    <td className="text-[#555555]">{b.phone ?? '—'}</td>
                    <td>
                      {b.is_active ? (
                        <span className="badge-green">Activa</span>
                      ) : (
                        <span className="badge-red">Inactiva</span>
                      )}
                    </td>
                    {canWrite && (
                      <td>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(b)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#EAE0DC] hover:border-[#C8102E] hover:bg-[#FFF5F2] text-xs font-medium text-[#333333] hover:text-[#C8102E] transition-colors"
                          >
                            <EditPencilIcon className="w-3.5 h-3.5" />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => setToggleTarget(b)}
                            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                              b.is_active
                                ? 'border-[#F2B8B5] text-[#B70726] hover:bg-[#FFF0F0]'
                                : 'border-[#B9E4C9] text-[#177245] hover:bg-[#E8F7EE]'
                            }`}
                          >
                            {b.is_active ? 'Desactivar' : 'Activar'}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GradientPanel>

      {/* Modal crear/editar sucursal */}
      {showForm && (
        <AppModal
          title={editBranch ? `Editar sucursal: ${editBranch.name}` : 'Nueva sucursal'}
          size="sm"
          onClose={() => setShowForm(false)}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Nombre *</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                placeholder="ej. Sucursal Central"
                required
              />
            </div>
            <div>
              <label className="label">Dirección</label>
              <input
                className="input"
                value={form.address}
                onChange={(e) => setForm((s) => ({ ...s, address: e.target.value }))}
                placeholder="Av. / Calle / Zona"
              />
            </div>
            <div>
              <label className="label">Teléfono</label>
              <input
                className="input"
                value={form.phone}
                onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))}
                placeholder="+591 …"
              />
            </div>
            {formError && <p className="alert-error">{formError}</p>}
            <div className="flex justify-end gap-2.5 pt-2 border-t border-[#F1E8E4]">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Guardando…' : editBranch ? 'Guardar cambios' : 'Crear sucursal'}
              </button>
            </div>
          </form>
        </AppModal>
      )}

      {/* Modal confirmar estado */}
      {toggleTarget && (
        <AppModal
          title={toggleTarget.is_active ? 'Desactivar sucursal' : 'Activar sucursal'}
          size="sm"
          onClose={() => setToggleTarget(null)}
        >
          <div className="space-y-4">
            <p className="text-sm text-[#333333]">
              ¿Deseas {toggleTarget.is_active ? 'desactivar' : 'activar'} la sucursal{' '}
              <strong>{toggleTarget.name}</strong>?
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setToggleTarget(null)}
                className="btn-secondary"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={toggling}
                onClick={handleConfirmToggle}
                className={toggleTarget.is_active ? 'btn-danger' : 'btn-primary'}
              >
                {toggling ? 'Procesando…' : toggleTarget.is_active ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          </div>
        </AppModal>
      )}
    </div>
  )
}
