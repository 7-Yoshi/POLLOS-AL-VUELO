/**
 * Módulos M02 (Materias Primas) y M03 (Insumos).
 * - Separación explícita entre materia_prima (elegible para ML) e insumo (apoyo operativo, excluido de ML).
 * - Admin puede crear, editar y desactivar ítems (sin borrar historial).
 * - Gerente y Encargado consultan en modo solo lectura.
 * - Soporta parámetros URL (?q=, ?new=1, ?edit=<id>) para integrarse con la barra superior y el Dashboard.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  AlertTriangleIcon,
  CubeIcon,
  EditPencilIcon,
  FilterIcon,
  InfoCircleIcon,
  LayersIcon,
  PlusIcon,
  SearchIcon,
  SuppliesIcon,
  TrashIcon,
  TrendChartIcon,
} from '../../components/ui/Icons'
import {
  AppModal,
  computeStockHealth,
  EmptyState,
  GradientPanel,
  ItemCategoryAvatar,
  KpiStatCard,
  PageSpinner,
  StockStatusPill,
} from '../../components/ui/SystemUI'
import { useAuth } from '../../contexts/AuthContext'
import { useBranch } from '../../contexts/BranchContext'
import api from '../../lib/api'
import type { InventoryBalance, Item } from '../../types'

export default function ItemsPage() {
  return <ItemCatalogPage itemType="materia_prima" title="Materias primas" />
}

export function InsumosPage() {
  return <ItemCatalogPage itemType="insumo" title="Insumos" />
}

interface ItemFormState {
  code: string
  name: string
  category: string
  base_unit: string
  min_stock: string
  eligible_for_ml: boolean
  notes: string
}

function emptyForm(): ItemFormState {
  return {
    code: '',
    name: '',
    category: '',
    base_unit: '',
    min_stock: '',
    eligible_for_ml: false,
    notes: '',
  }
}

function ItemCatalogPage({
  itemType,
  title,
}: {
  itemType: 'materia_prima' | 'insumo'
  title: string
}) {
  const { currentUser } = useAuth()
  const { activeBranch } = useBranch()
  const [searchParams, setSearchParams] = useSearchParams()
  const canWrite = currentUser?.role === 'admin'
  const isRaw = itemType === 'materia_prima'

  const [items, setItems] = useState<Item[]>([])
  const [balances, setBalances] = useState<InventoryBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sortAsc, setSortAsc] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [formState, setFormState] = useState<ItemFormState>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [confirmDeactivate, setConfirmDeactivate] = useState<Item | null>(null)
  const [deactivating, setDeactivating] = useState(false)

  // Sincronizar ?q= de la barra de búsqueda global
  useEffect(() => {
    const q = searchParams.get('q')
    if (q !== null) setSearch(q)
  }, [searchParams])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [itemsRes, balRes] = await Promise.all([
        api.get<Item[]>('/api/v1/items/', { params: { item_type: itemType, limit: 200 } }),
        activeBranch
          ? api.get<InventoryBalance[]>('/api/v1/inventory/balance', {
              params: { branch_id: activeBranch.id },
            })
          : Promise.resolve({ data: [] as InventoryBalance[] }),
      ])
      setItems(itemsRes.data)
      setBalances(balRes.data)
    } catch {
      setError('No se pudo cargar el catálogo.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [itemType, activeBranch?.id])

  // Abrir modal automáticamente si viene ?new=1 o ?edit=<id> (solo Admin)
  useEffect(() => {
    if (!canWrite || loading) return
    if (searchParams.get('new') === '1') {
      openCreate()
      searchParams.delete('new')
      setSearchParams(searchParams, { replace: true })
      return
    }
    const editId = searchParams.get('edit')
    if (editId) {
      const found = items.find((i) => i.id === editId)
      if (found) openEdit(found)
      searchParams.delete('edit')
      setSearchParams(searchParams, { replace: true })
    }
  }, [canWrite, loading, items, searchParams])

  const balanceMap = useMemo(
    () => new Map(balances.map((b) => [b.item_id, b.balance])),
    [balances]
  )

  const categories = useMemo(() => {
    const set = new Set(items.map((i) => i.category).filter((c): c is string => Boolean(c)))
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'))
  }, [items])

  const lowStockCount = useMemo(() => {
    return items.filter((item) => {
      const stock = balanceMap.get(item.id)
      const h = computeStockHealth(stock, item.min_stock)
      return h === 'low' || h === 'critical'
    }).length
  }, [items, balanceMap])

  const eligibleCount = useMemo(
    () => items.filter((i) => i.eligible_for_ml).length,
    [items]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items
      .filter((i) => {
        if (categoryFilter !== 'all' && (i.category ?? 'General') !== categoryFilter) {
          return false
        }
        if (!q) return true
        return (
          i.name.toLowerCase().includes(q) ||
          i.code.toLowerCase().includes(q) ||
          (i.category ?? '').toLowerCase().includes(q)
        )
      })
      .sort((a, b) =>
        sortAsc
          ? a.name.localeCompare(b.name, 'es')
          : b.name.localeCompare(a.name, 'es')
      )
  }, [items, search, categoryFilter, sortAsc])

  const openCreate = () => {
    setEditingItem(null)
    setFormState({ ...emptyForm(), eligible_for_ml: isRaw })
    setFormError(null)
    setShowForm(true)
  }

  const openEdit = (item: Item) => {
    setEditingItem(item)
    setFormState({
      code: item.code,
      name: item.name,
      category: item.category ?? '',
      base_unit: item.base_unit,
      min_stock: item.min_stock?.toString() ?? '',
      eligible_for_ml: isRaw ? item.eligible_for_ml : false,
      notes: item.notes ?? '',
    })
    setFormError(null)
    setShowForm(true)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!formState.name.trim() || !formState.code.trim() || !formState.base_unit.trim()) {
      setFormError('Código, nombre y unidad base son obligatorios.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const payload = {
        ...formState,
        item_type: itemType,
        eligible_for_ml: isRaw ? formState.eligible_for_ml : false,
        min_stock: formState.min_stock ? parseFloat(formState.min_stock) : null,
        notes: formState.notes || null,
        category: formState.category || null,
      }
      if (editingItem) {
        await api.patch(`/api/v1/items/${editingItem.id}`, payload)
      } else {
        await api.post('/api/v1/items/', payload)
      }
      setShowForm(false)
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setFormError(detail ?? 'Error al guardar el registro.')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmDeactivate = async () => {
    if (!confirmDeactivate) return
    setDeactivating(true)
    try {
      await api.delete(`/api/v1/items/${confirmDeactivate.id}`)
      setConfirmDeactivate(null)
      await load()
    } catch {
      setError('No se pudo desactivar el ítem.')
      setConfirmDeactivate(null)
    } finally {
      setDeactivating(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* KPIs reales */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiStatCard
          label={isRaw ? 'Materias primas activas' : 'Insumos activos'}
          value={items.length}
          subtext="Catálogo vigente"
          icon={isRaw ? <CubeIcon className="w-6 h-6" /> : <SuppliesIcon className="w-6 h-6" />}
          tone="gold"
        />
        <KpiStatCard
          label="Stock bajo o crítico"
          value={lowStockCount}
          subtext={activeBranch ? activeBranch.name : 'Sin sucursal'}
          icon={<AlertTriangleIcon className="w-6 h-6" />}
          tone="rose"
          to="/inventory"
        />
        <KpiStatCard
          label={isRaw ? 'Elegibles para ML' : 'Excluidos de ML'}
          value={isRaw ? eligibleCount : items.length}
          subtext={isRaw ? 'Incluidos en pronóstico' : 'Solo control operativo'}
          icon={<TrendChartIcon className="w-6 h-6" />}
          tone="purple"
        />
        <KpiStatCard
          label="Categorías registradas"
          value={categories.length}
          subtext="Clasificación de catálogo"
          icon={<LayersIcon className="w-6 h-6" />}
          tone="orange"
        />
      </div>

      {/* Aviso normativo de separación M03 (Insumos vs Materias Primas) */}
      {!isRaw && (
        <div className="alert-info flex items-start gap-2.5">
          <InfoCircleIcon className="w-5 h-5 text-[#C8102E] shrink-0 mt-0.5" />
          <p className="text-[13px]">
            Los <strong>insumos</strong> (empaques, descartables, limpieza y apoyo operativo) se
            gestionan en inventario y compras de forma independiente a las materias primas, y{' '}
            <strong>no participan en los modelos predictivos de Machine Learning</strong>.
          </p>
        </div>
      )}

      {!canWrite && (
        <div className="alert-info flex items-center justify-between gap-2 text-[13px]">
          <span>
            Estás consultando el catálogo en modo <strong>solo lectura</strong>. Solo el
            Administrador puede crear, editar o desactivar {title.toLowerCase()}.
          </span>
          <span className="badge-blue shrink-0">Solo lectura</span>
        </div>
      )}

      {error && <div className="alert-error">{error}</div>}

      {/* Panel principal con tabla */}
      <GradientPanel
        title={`Catálogo de ${title.toLowerCase()}`}
        icon={isRaw ? <CubeIcon className="w-5 h-5" /> : <SuppliesIcon className="w-5 h-5" />}
        bodyClassName="p-0"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {canWrite && (
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-1.5 bg-[#B70726] hover:bg-[#99051F] text-white border border-white/25 rounded-[10px] px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-colors"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                Agregar {isRaw ? 'material' : 'insumo'}
              </button>
            )}
          </div>
        }
      >
        {/* Barra de filtros */}
        <div className="p-4 border-b border-[#F1E8E4] bg-[#FFFBF9] flex flex-wrap items-center gap-3 justify-between">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <SearchIcon className="w-4 h-4 text-[#888888] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              placeholder="Buscar por nombre, código o categoría…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10 py-2 min-h-[38px]"
              aria-label="Buscar ítems"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <label className="inline-flex items-center gap-1.5 bg-white border border-[#E2D9D5] rounded-[10px] px-3 py-1.5 text-xs font-medium text-[#333333]">
              <FilterIcon className="w-3.5 h-3.5 text-[#C8102E]" />
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="bg-transparent focus:outline-none cursor-pointer"
                aria-label="Filtrar por categoría"
              >
                <option value="all">Todas las categorías</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </label>

            <span className="text-xs text-[#666666] px-1">
              {filtered.length} de {items.length} registros
            </span>
          </div>
        </div>

        {loading ? (
          <PageSpinner label={`Cargando ${title.toLowerCase()}…`} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={isRaw ? <CubeIcon className="w-6 h-6" /> : <SuppliesIcon className="w-6 h-6" />}
            title={search || categoryFilter !== 'all' ? 'Sin resultados para este filtro' : `No hay ${title.toLowerCase()} registradas`}
            description="Ajusta el criterio de búsqueda o solicita al administrador registrar nuevos elementos en el catálogo."
          />
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      onClick={() => setSortAsc((v) => !v)}
                      className="inline-flex items-center gap-1 hover:text-[#C8102E]"
                    >
                      {isRaw ? 'Material' : 'Insumo'} {sortAsc ? '↑' : '↓'}
                    </button>
                  </th>
                  <th>Categoría</th>
                  <th>Unidad</th>
                  <th>Stock actual</th>
                  <th>Stock mín.</th>
                  {isRaw && <th>ML</th>}
                  <th>Estado ({activeBranch?.name ?? 'Sucursal'})</th>
                  {canWrite && <th className="text-right">Acciones</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3EAE6]">
                {filtered.map((item) => {
                  const stock = balanceMap.get(item.id)
                  const health = computeStockHealth(stock, item.min_stock)
                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <ItemCategoryAvatar category={item.category} itemType={item.item_type} />
                          <div>
                            <p className="font-semibold text-[#222222] leading-tight">{item.name}</p>
                            <p className="text-[11px] font-mono text-[#888888]">{item.code}</p>
                          </div>
                        </div>
                      </td>
                      <td className="text-[#555555]">{item.category ?? 'General'}</td>
                      <td className="font-medium text-[#333333]">{item.base_unit}</td>
                      <td className="font-semibold text-[#222222]">
                        {stock != null ? `${stock.toFixed(2)} ${item.base_unit}` : '—'}
                      </td>
                      <td className="text-[#555555]">
                        {item.min_stock != null ? `${item.min_stock.toFixed(2)} ${item.base_unit}` : '—'}
                      </td>
                      {isRaw && (
                        <td>
                          {item.eligible_for_ml ? (
                            <span className="badge-purple">Elegible ML</span>
                          ) : (
                            <span className="badge-gray">No</span>
                          )}
                        </td>
                      )}
                      <td>
                        <StockStatusPill status={health} />
                      </td>
                      {canWrite && (
                        <td>
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEdit(item)}
                              title="Editar"
                              className="w-8 h-8 rounded-lg border border-[#EAE0DC] hover:border-[#C8102E] hover:bg-[#FFF5F2] text-[#555555] hover:text-[#C8102E] inline-flex items-center justify-center transition-colors"
                            >
                              <EditPencilIcon className="w-4 h-4" />
                            </button>
                            {item.is_active && (
                              <button
                                type="button"
                                onClick={() => setConfirmDeactivate(item)}
                                title="Desactivar"
                                className="w-8 h-8 rounded-lg border border-[#EAE0DC] hover:border-[#B70726] hover:bg-[#FFF0F0] text-[#777777] hover:text-[#B70726] inline-flex items-center justify-center transition-colors"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </GradientPanel>

      {/* Modal Crear / Editar */}
      {showForm && (
        <AppModal
          title={
            editingItem
              ? `Editar: ${editingItem.name}`
              : `Nuevo ${isRaw ? 'ingrediente / materia prima' : 'insumo'}`
          }
          subtitle="La unidad base se mantiene fija en los registros históricos."
          onClose={() => setShowForm(false)}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Código *</label>
                <input
                  className="input"
                  value={formState.code}
                  onChange={(e) => setFormState((s) => ({ ...s, code: e.target.value }))}
                  disabled={!!editingItem}
                  placeholder={isRaw ? 'MP-001' : 'INS-001'}
                  required
                />
              </div>
              <div>
                <label className="label">Nombre *</label>
                <input
                  className="input"
                  value={formState.name}
                  onChange={(e) => setFormState((s) => ({ ...s, name: e.target.value }))}
                  placeholder={isRaw ? 'ej. Pollo entero' : 'ej. Envase térmico'}
                  required
                />
              </div>
              <div>
                <label className="label">Categoría</label>
                <input
                  className="input"
                  value={formState.category}
                  onChange={(e) => setFormState((s) => ({ ...s, category: e.target.value }))}
                  placeholder={isRaw ? 'Proteína, Verdura, Grasa…' : 'Empaque, Limpieza…'}
                />
              </div>
              <div>
                <label className="label">Unidad base *</label>
                <input
                  className="input"
                  value={formState.base_unit}
                  onChange={(e) => setFormState((s) => ({ ...s, base_unit: e.target.value }))}
                  placeholder="kg, L, unidad…"
                  required
                />
              </div>
              <div>
                <label className="label">Stock mínimo de alerta</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input"
                  value={formState.min_stock}
                  onChange={(e) => setFormState((s) => ({ ...s, min_stock: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              {isRaw && (
                <div className="flex items-center gap-2.5 sm:pt-6">
                  <input
                    type="checkbox"
                    id="eligible_ml"
                    checked={formState.eligible_for_ml}
                    onChange={(e) =>
                      setFormState((s) => ({ ...s, eligible_for_ml: e.target.checked }))
                    }
                    className="w-4 h-4 accent-[#C8102E] rounded"
                  />
                  <label htmlFor="eligible_ml" className="text-[13px] font-medium text-[#333333]">
                    Elegible para predicción ML
                  </label>
                </div>
              )}
            </div>

            <div>
              <label className="label">Notas</label>
              <textarea
                className="input"
                rows={2}
                value={formState.notes}
                onChange={(e) => setFormState((s) => ({ ...s, notes: e.target.value }))}
                placeholder="Especificaciones de presentación o conservación…"
              />
            </div>

            {formError && <p className="alert-error">{formError}</p>}

            <div className="flex justify-end gap-2.5 pt-2 border-t border-[#F1E8E4]">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Guardando…' : editingItem ? 'Guardar cambios' : 'Crear registro'}
              </button>
            </div>
          </form>
        </AppModal>
      )}

      {/* Modal confirmación de desactivación */}
      {confirmDeactivate && (
        <AppModal
          title="Confirmar desactivación"
          subtitle="El historial de compras, movimientos y consumo se conservará intacto."
          size="sm"
          onClose={() => setConfirmDeactivate(null)}
        >
          <div className="space-y-4">
            <p className="text-sm text-[#333333]">
              ¿Deseas desactivar <strong>{confirmDeactivate.name}</strong> ({confirmDeactivate.code})?
              Ya no aparecerá para nuevos registros operativos.
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDeactivate(null)}
                className="btn-secondary"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deactivating}
                onClick={handleConfirmDeactivate}
                className="btn-danger"
              >
                {deactivating ? 'Desactivando…' : 'Desactivar'}
              </button>
            </div>
          </div>
        </AppModal>
      )}
    </div>
  )
}
