/**
 * Módulo M10a — Usuarios y Roles (solo Administrador).
 * - Pestañas compartidas Usuarios | Sucursales preservando las rutas /users y /branches.
 * - Creación/edición unificada en Firebase Auth + Cloud Firestore.
 * - Reglas estrictas por rol: Admin (3 sucursales), Gerente (≥1), Encargado (exactamente 1).
 * - Revocación inmediata de sesiones al desactivar.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import {
  BranchStoreIcon,
  EditPencilIcon,
  InfoCircleIcon,
  PlusIcon,
  SearchIcon,
  ShieldAuditIcon,
  UsersGroupIcon,
} from '../../components/ui/Icons'
import {
  AppModal,
  EmptyState,
  GradientPanel,
  KpiStatCard,
  PageSpinner,
} from '../../components/ui/SystemUI'
import api from '../../lib/api'
import type { Branch, UserListItem, UserRole } from '../../types'

const ROLES: Array<{ value: UserRole; label: string }> = [
  { value: 'admin', label: 'Administrador (acceso a las 3 sucursales)' },
  { value: 'gerente', label: 'Gerente (sucursales asignadas)' },
  { value: 'encargado', label: 'Encargado de sucursal (exactamente 1 sucursal)' },
]

function emptyCreateForm() {
  return {
    email: '',
    password: '',
    full_name: '',
    username: '',
    role: 'encargado' as UserRole,
    branch_ids: [] as string[],
    must_change_password: true,
  }
}

function emptyEditForm() {
  return {
    full_name: '',
    username: '',
    role: 'encargado' as UserRole,
    branch_ids: [] as string[],
    must_change_password: false,
  }
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserListItem[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all')

  // Modal Crear
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(emptyCreateForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Modal Editar
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null)
  const [editForm, setEditForm] = useState(emptyEditForm())
  const [editError, setEditError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)

  // Modal Confirmar activar/desactivar
  const [toggleTarget, setToggleTarget] = useState<UserListItem | null>(null)
  const [toggling, setToggling] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [usersRes, branchesRes] = await Promise.all([
        api.get<UserListItem[]>('/api/v1/users/'),
        api.get<Branch[]>('/api/v1/branches/'),
      ])
      setUsers(usersRes.data)
      setBranches(branchesRes.data)
    } catch {
      setError('Error al cargar los usuarios del sistema.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches])

  const kpis = useMemo(() => {
    return {
      total: users.length,
      admins: users.filter((u) => u.role === 'admin').length,
      gerentes: users.filter((u) => u.role === 'gerente').length,
      encargados: users.filter((u) => u.role === 'encargado').length,
    }
  }, [users])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (!q) return true
      return (
        u.full_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.username ?? '').toLowerCase().includes(q)
      )
    })
  }, [users, search, roleFilter])

  const handleConfirmToggle = async () => {
    if (!toggleTarget) return
    setToggling(true)
    try {
      await api.patch(`/api/v1/users/${toggleTarget.id}`, { is_active: !toggleTarget.is_active })
      setToggleTarget(null)
      await load()
    } catch {
      setError('Error al actualizar el estado del usuario.')
      setToggleTarget(null)
    } finally {
      setToggling(false)
    }
  }

  const openEditModal = (u: UserListItem) => {
    setEditingUser(u)
    setEditForm({
      full_name: u.full_name,
      username: u.username ?? '',
      role: u.role,
      branch_ids: u.role === 'encargado' ? u.branch_ids.slice(0, 1) : [...u.branch_ids],
      must_change_password: u.must_change_password,
    })
    setEditError(null)
  }

  const handleRoleChangeCreate = (newRole: UserRole) => {
    setForm((s) => ({
      ...s,
      role: newRole,
      branch_ids:
        newRole === 'admin'
          ? branches.map((b) => b.id)
          : newRole === 'encargado'
            ? s.branch_ids.slice(0, 1)
            : s.branch_ids,
    }))
  }

  const handleRoleChangeEdit = (newRole: UserRole) => {
    setEditForm((s) => ({
      ...s,
      role: newRole,
      branch_ids:
        newRole === 'admin'
          ? branches.map((b) => b.id)
          : newRole === 'encargado'
            ? s.branch_ids.slice(0, 1)
            : s.branch_ids,
    }))
  }

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.email || !form.password || !form.full_name || !form.role) {
      setFormError('Completa correo, contraseña temporal, nombre completo y rol.')
      return
    }
    if (form.password.length < 8) {
      setFormError('La contraseña temporal debe tener al menos 8 caracteres.')
      return
    }
    if (form.role === 'gerente' && form.branch_ids.length < 1) {
      setFormError('Un Gerente debe tener al menos una sucursal asignada.')
      return
    }
    if (form.role === 'encargado' && form.branch_ids.length !== 1) {
      setFormError('Un Encargado de sucursal debe tener exactamente una sucursal asignada.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await api.post('/api/v1/users/', {
        email: form.email.trim(),
        password: form.password,
        full_name: form.full_name.trim(),
        username: form.username.trim() || null,
        role: form.role,
        branch_ids: form.role === 'admin' ? branches.map((b) => b.id) : form.branch_ids,
        must_change_password: form.must_change_password,
      })
      setShowCreate(false)
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setFormError(detail ?? 'Error al crear el usuario.')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async (e: FormEvent) => {
    e.preventDefault()
    if (!editingUser) return
    if (!editForm.full_name.trim()) {
      setEditError('El nombre completo es obligatorio.')
      return
    }
    if (editForm.role === 'gerente' && editForm.branch_ids.length < 1) {
      setEditError('Un Gerente debe tener al menos una sucursal asignada.')
      return
    }
    if (editForm.role === 'encargado' && editForm.branch_ids.length !== 1) {
      setEditError('Un Encargado de sucursal debe tener exactamente una sucursal asignada.')
      return
    }
    setUpdating(true)
    setEditError(null)
    try {
      await api.patch(`/api/v1/users/${editingUser.id}`, {
        full_name: editForm.full_name.trim(),
        username: editForm.username.trim() || null,
        role: editForm.role,
        branch_ids: editForm.role === 'admin' ? branches.map((b) => b.id) : editForm.branch_ids,
        must_change_password: editForm.must_change_password,
      })
      setEditingUser(null)
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setEditError(detail ?? 'Error al actualizar el usuario.')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Pestañas unificadas Usuarios | Sucursales para Administrador */}
      <div className="inline-flex bg-white border border-[#EFE4DF] rounded-[13px] p-1 shadow-sm">
        <Link
          to="/users"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-[10px] text-xs font-semibold pav-nav-active text-white"
        >
          <UsersGroupIcon className="w-4 h-4" />
          Usuarios ({users.length})
        </Link>
        <Link
          to="/branches"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-[10px] text-xs font-semibold text-[#555555] hover:text-[#C8102E] hover:bg-[#FFF5F0] transition-colors"
        >
          <BranchStoreIcon className="w-4 h-4" />
          Sucursales ({branches.length})
        </Link>
      </div>

      {/* KPIs de cuentas */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiStatCard
          label="Cuentas registradas"
          value={kpis.total}
          subtext="Firebase Auth + Firestore"
          icon={<UsersGroupIcon className="w-6 h-6" />}
          tone="gold"
        />
        <KpiStatCard
          label="Administradores"
          value={kpis.admins}
          subtext="Acceso a las 3 sucursales"
          icon={<ShieldAuditIcon className="w-6 h-6" />}
          tone="rose"
        />
        <KpiStatCard
          label="Gerentes"
          value={kpis.gerentes}
          subtext="Supervisión y ML"
          icon={<UsersGroupIcon className="w-6 h-6" />}
          tone="orange"
        />
        <KpiStatCard
          label="Encargados"
          value={kpis.encargados}
          subtext="Operación en 1 sucursal"
          icon={<BranchStoreIcon className="w-6 h-6" />}
          tone="purple"
        />
      </div>

      {/* Política de control de acceso */}
      <div className="alert-info flex items-start gap-2.5 text-[13px]">
        <InfoCircleIcon className="w-4 h-4 text-[#C8102E] shrink-0 mt-0.5" />
        <span>
          <strong>Política de acceso (lista blanca):</strong> Solo los usuarios registrados aquí por
          el Administrador pueden ingresar. Cocineros, cajeros, meseros y personal de limpieza{' '}
          <strong>no tienen acceso al sistema</strong>, salvo autorización explícita con rol{' '}
          <strong>Encargado de sucursal</strong> en una única sucursal.
        </span>
      </div>

      {error && <div className="alert-error">{error}</div>}

      {/* Tabla principal de usuarios */}
      <GradientPanel
        title="Usuarios autorizados del sistema"
        icon={<UsersGroupIcon className="w-5 h-5" />}
        bodyClassName="p-0"
        actions={
          <button
            type="button"
            onClick={() => {
              setShowCreate(true)
              setFormError(null)
              setForm(emptyCreateForm())
            }}
            className="inline-flex items-center gap-1.5 bg-[#B70726] hover:bg-[#99051F] text-white border border-white/25 rounded-[10px] px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-colors"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            Crear usuario
          </button>
        }
      >
        <div className="p-4 border-b border-[#F1E8E4] bg-[#FFFBF9] flex flex-wrap items-center gap-3 justify-between">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <SearchIcon className="w-4 h-4 text-[#888888] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              placeholder="Buscar por nombre o correo…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10 py-2 min-h-[38px]"
            />
          </div>
          <select
            className="input w-auto py-1.5 min-h-[38px] text-xs"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'all' | UserRole)}
          >
            <option value="all">Todos los roles</option>
            <option value="admin">Administrador</option>
            <option value="gerente">Gerente</option>
            <option value="encargado">Encargado</option>
          </select>
        </div>

        {loading ? (
          <PageSpinner label="Cargando usuarios…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<UsersGroupIcon className="w-6 h-6" />}
            title="No se encontraron usuarios"
            description="Ajusta el filtro o crea un nuevo usuario autorizado."
          />
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Correo</th>
                  <th>Rol</th>
                  <th>Sucursales asignadas</th>
                  <th>Estado</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3EAE6]">
                {filtered.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="font-semibold text-[#222222]">{u.full_name}</div>
                      {u.must_change_password && (
                        <span className="text-[11px] text-[#B86E00] font-medium">
                          Pendiente cambio de contraseña
                        </span>
                      )}
                    </td>
                    <td className="text-xs text-[#555555]">{u.email}</td>
                    <td>
                      <RoleBadge role={u.role} />
                    </td>
                    <td className="text-xs text-[#555555]">
                      {u.role === 'admin'
                        ? `Todas (${branches.length} sucursales)`
                        : u.branch_ids.length > 0
                          ? u.branch_ids.map((bid) => branchMap.get(bid) ?? bid).join(', ')
                          : '—'}
                    </td>
                    <td>
                      {u.is_active ? (
                        <span className="badge-green">Activo</span>
                      ) : (
                        <span className="badge-red">Inactivo</span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(u)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#EAE0DC] hover:border-[#C8102E] hover:bg-[#FFF5F2] text-xs font-medium text-[#333333] hover:text-[#C8102E] transition-colors"
                        >
                          <EditPencilIcon className="w-3.5 h-3.5" />
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => setToggleTarget(u)}
                          className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                            u.is_active
                              ? 'border-[#F2B8B5] text-[#B70726] hover:bg-[#FFF0F0]'
                              : 'border-[#B9E4C9] text-[#177245] hover:bg-[#E8F7EE]'
                          }`}
                        >
                          {u.is_active ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GradientPanel>

      {/* Modal Crear Usuario */}
      {showCreate && (
        <AppModal
          title="Crear usuario autorizado"
          subtitle="Crea la cuenta en Firebase Authentication y asigna su rol en Firestore."
          onClose={() => setShowCreate(false)}
        >
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Correo electrónico *</label>
                <input
                  type="email"
                  className="input"
                  value={form.email}
                  onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="label">Contraseña temporal (mín. 8) *</label>
                <input
                  type="password"
                  className="input"
                  value={form.password}
                  onChange={(e) => setForm((s) => ({ ...s, password: e.target.value }))}
                  minLength={8}
                  required
                />
              </div>
              <div>
                <label className="label">Nombre completo *</label>
                <input
                  className="input"
                  value={form.full_name}
                  onChange={(e) => setForm((s) => ({ ...s, full_name: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="label">Alias (opcional)</label>
                <input
                  className="input"
                  value={form.username}
                  onChange={(e) => setForm((s) => ({ ...s, username: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Rol *</label>
                <select
                  className="input"
                  value={form.role}
                  onChange={(e) => handleRoleChangeCreate(e.target.value as UserRole)}
                  required
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <BranchRoleSelector
              role={form.role}
              branches={branches}
              selectedIds={form.branch_ids}
              onChange={(ids) => setForm((s) => ({ ...s, branch_ids: ids }))}
            />

            <label className="flex items-center gap-2.5 text-[13px] text-[#333333]">
              <input
                type="checkbox"
                checked={form.must_change_password}
                onChange={(e) =>
                  setForm((s) => ({ ...s, must_change_password: e.target.checked }))
                }
                className="w-4 h-4 accent-[#C8102E] rounded"
              />
              Exigir cambio de contraseña en el primer inicio de sesión
            </label>

            {formError && <p className="alert-error">{formError}</p>}

            <div className="flex justify-end gap-2.5 pt-2 border-t border-[#F1E8E4]">
              <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Creando…' : 'Crear usuario'}
              </button>
            </div>
          </form>
        </AppModal>
      )}

      {/* Modal Editar Usuario */}
      {editingUser && (
        <AppModal
          title={`Editar usuario: ${editingUser.full_name}`}
          subtitle={editingUser.email}
          onClose={() => setEditingUser(null)}
        >
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Nombre completo *</label>
                <input
                  className="input"
                  value={editForm.full_name}
                  onChange={(e) => setEditForm((s) => ({ ...s, full_name: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="label">Alias (opcional)</label>
                <input
                  className="input"
                  value={editForm.username}
                  onChange={(e) => setEditForm((s) => ({ ...s, username: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Rol *</label>
                <select
                  className="input"
                  value={editForm.role}
                  onChange={(e) => handleRoleChangeEdit(e.target.value as UserRole)}
                  required
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <BranchRoleSelector
              role={editForm.role}
              branches={branches}
              selectedIds={editForm.branch_ids}
              onChange={(ids) => setEditForm((s) => ({ ...s, branch_ids: ids }))}
            />

            <label className="flex items-center gap-2.5 text-[13px] text-[#333333]">
              <input
                type="checkbox"
                checked={editForm.must_change_password}
                onChange={(e) =>
                  setEditForm((s) => ({ ...s, must_change_password: e.target.checked }))
                }
                className="w-4 h-4 accent-[#C8102E] rounded"
              />
              Exigir cambio de contraseña en el próximo ingreso
            </label>

            {editError && <p className="alert-error">{editError}</p>}

            <div className="flex justify-end gap-2.5 pt-2 border-t border-[#F1E8E4]">
              <button type="button" onClick={() => setEditingUser(null)} className="btn-secondary">
                Cancelar
              </button>
              <button type="submit" disabled={updating} className="btn-primary">
                {updating ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </AppModal>
      )}

      {/* Modal confirmar activación/desactivación */}
      {toggleTarget && (
        <AppModal
          title={toggleTarget.is_active ? 'Desactivar usuario' : 'Reactivar usuario'}
          size="sm"
          onClose={() => setToggleTarget(null)}
        >
          <div className="space-y-4">
            <p className="text-sm text-[#333333]">
              {toggleTarget.is_active ? (
                <>
                  ¿Desactivar a <strong>{toggleTarget.full_name}</strong>? Sus sesiones activas en
                  Firebase Authentication serán revocadas inmediatamente.
                </>
              ) : (
                <>
                  ¿Reactivar la cuenta de <strong>{toggleTarget.full_name}</strong>?
                </>
              )}
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
                {toggling
                  ? 'Procesando…'
                  : toggleTarget.is_active
                    ? 'Desactivar y revocar'
                    : 'Reactivar cuenta'}
              </button>
            </div>
          </div>
        </AppModal>
      )}
    </div>
  )
}

function BranchRoleSelector({
  role,
  branches,
  selectedIds,
  onChange,
}: {
  role: UserRole
  branches: Branch[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  if (role === 'admin') {
    return (
      <div className="alert-info text-xs">
        El rol <strong>Administrador</strong> recibe acceso automático a todas las sucursales
        activas ({branches.length}).
      </div>
    )
  }

  if (role === 'encargado') {
    return (
      <div>
        <label className="label">Sucursal asignada (exactamente 1) *</label>
        <div className="grid sm:grid-cols-2 gap-2 mt-1">
          {branches.map((b) => (
            <label
              key={b.id}
              className={`flex items-center gap-2.5 text-[13px] p-2.5 rounded-xl border cursor-pointer transition-colors ${
                selectedIds[0] === b.id
                  ? 'border-[#C8102E] bg-[#FFF4F0] text-[#B70726] font-semibold'
                  : 'border-[#E6DAD4] hover:bg-[#FFFBF9] text-[#333333]'
              }`}
            >
              <input
                type="radio"
                name="encargado_branch"
                checked={selectedIds[0] === b.id}
                onChange={() => onChange([b.id])}
                className="w-4 h-4 accent-[#C8102E]"
              />
              {b.name}
            </label>
          ))}
        </div>
      </div>
    )
  }

  const toggle = (bid: string) => {
    onChange(
      selectedIds.includes(bid) ? selectedIds.filter((x) => x !== bid) : [...selectedIds, bid]
    )
  }

  return (
    <div>
      <label className="label">Sucursales asignadas (al menos 1) *</label>
      <div className="grid sm:grid-cols-2 gap-2 mt-1">
        {branches.map((b) => (
          <label
            key={b.id}
            className={`flex items-center gap-2.5 text-[13px] p-2.5 rounded-xl border cursor-pointer transition-colors ${
              selectedIds.includes(b.id)
                ? 'border-[#C8102E] bg-[#FFF4F0] text-[#B70726] font-semibold'
                : 'border-[#E6DAD4] hover:bg-[#FFFBF9] text-[#333333]'
            }`}
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(b.id)}
              onChange={() => toggle(b.id)}
              className="w-4 h-4 accent-[#C8102E] rounded"
            />
            {b.name}
          </label>
        ))}
      </div>
    </div>
  )
}

function RoleBadge({ role }: { role: string }) {
  if (role === 'admin') return <span className="badge-red">Administrador</span>
  if (role === 'gerente') return <span className="badge-blue">Gerente</span>
  return <span className="badge-purple">Encargado</span>
}
