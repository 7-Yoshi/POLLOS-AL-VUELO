/**
 * Módulo M05 — Control de Inventario por sucursal.
 * - Saldos actuales calculados a partir de movimientos (nunca edición directa de saldo).
 * - Historial filtrable de movimientos (compra, consumo, ajuste +, ajuste -, merma, traslados).
 * - Estados diferenciados: Normal (verde), Stock bajo (amarillo), Crítico (rojo), Desconocido (gris).
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'

import {
  AlertTriangleIcon,
  FilterIcon,
  InfoCircleIcon,
  InventoryBoxesIcon,
  LayersIcon,
  PlusIcon,
  SearchIcon,
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
  type StockHealth,
} from '../../components/ui/SystemUI'
import { useAuth } from '../../contexts/AuthContext'
import { useBranch } from '../../contexts/BranchContext'
import api from '../../lib/api'
import type { InventoryBalance, InventoryMovement, Item, MovementType } from '../../types'

type ViewMode = 'balances' | 'movements'

function emptyMvForm(itemId = '', unit = '') {
  return {
    item_id: itemId,
    movement_type: 'ajuste_entrada' as MovementType,
    quantity_base: '',
    unit,
    effective_date: new Date().toISOString().split('T')[0],
    notes: '',
  }
}

export default function InventoryPage() {
  const { currentUser } = useAuth()
  const { activeBranch } = useBranch()
  const canWrite = currentUser?.role === 'admin' || currentUser?.role === 'encargado'

  const [view, setView] = useState<ViewMode>('balances')
  const [balances, setBalances] = useState<InventoryBalance[]>([])
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filtros
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | StockHealth>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  // Modal nuevo movimiento
  const [showForm, setShowForm] = useState(false)
  const [mvForm, setMvForm] = useState(emptyMvForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    if (!activeBranch) return
    setLoading(true)
    setError(null)
    try {
      const [balRes, mvRes, itemsRes] = await Promise.all([
        api.get<InventoryBalance[]>('/api/v1/inventory/balance', {
          params: { branch_id: activeBranch.id },
        }),
        api.get<InventoryMovement[]>('/api/v1/inventory/movements', {
          params: {
            branch_id: activeBranch.id,
            from_date: fromDate || undefined,
            to_date: toDate || undefined,
            limit: 150,
          },
        }),
        api.get<Item[]>('/api/v1/items/', { params: { limit: 250 } }),
      ])
      setBalances(balRes.data)
      setMovements(mvRes.data)
      setItems(itemsRes.data)
    } catch {
      setError('Error al cargar la información de inventario.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [activeBranch?.id, fromDate, toDate])

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  const enrichedBalances = useMemo(() => {
    return balances.map((b) => {
      const item = itemMap.get(b.item_id)
      const health = computeStockHealth(b.balance, item?.min_stock)
      return { balance: b, item, health }
    })
  }, [balances, itemMap])

  const kpis = useMemo(() => {
    let normal = 0
    let low = 0
    let critical = 0
    for (const row of enrichedBalances) {
      if (row.health === 'normal') normal++
      else if (row.health === 'low') low++
      else if (row.health === 'critical') critical++
    }
    return { total: enrichedBalances.length, normal, low, critical }
  }, [enrichedBalances])

  const filteredBalances = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enrichedBalances.filter(({ item, balance, health }) => {
      if (statusFilter !== 'all' && health !== statusFilter) return false
      if (!q) return true
      const name = item?.name ?? balance.item_id
      const code = item?.code ?? ''
      return name.toLowerCase().includes(q) || code.toLowerCase().includes(q)
    })
  }, [enrichedBalances, statusFilter, search])

  const filteredMovements = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return movements
    return movements.filter((m) => {
      const name = itemMap.get(m.item_id)?.name ?? m.item_id
      return (
        name.toLowerCase().includes(q) ||
        m.movement_type.toLowerCase().includes(q) ||
        (m.notes ?? '').toLowerCase().includes(q)
      )
    })
  }, [movements, search, itemMap])

  const openMovementFor = (item?: Item) => {
    setMvForm(emptyMvForm(item?.id ?? '', item?.base_unit ?? ''))
    setFormError(null)
    setShowForm(true)
  }

  const handleMvSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!activeBranch) return
    if (!mvForm.item_id || !mvForm.quantity_base || !mvForm.unit) {
      setFormError('Ítem, cantidad y unidad son obligatorios.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await api.post('/api/v1/inventory/movements', {
        branch_id: activeBranch.id,
        item_id: mvForm.item_id,
        movement_type: mvForm.movement_type,
        quantity_base: parseFloat(mvForm.quantity_base),
        unit: mvForm.unit,
        effective_date: mvForm.effective_date,
        notes: mvForm.notes || null,
      })
      setShowForm(false)
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setFormError(detail ?? 'Error al registrar el movimiento.')
    } finally {
      setSaving(false)
    }
  }

  if (!activeBranch) {
    return <div className="alert-warning">Selecciona una sucursal para ver el inventario.</div>
  }

  return (
    <div className="space-y-5">
      {/* KPIs de estado de inventario */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiStatCard
          label="Ítems con saldo"
          value={kpis.total}
          subtext={activeBranch.name}
          icon={<InventoryBoxesIcon className="w-6 h-6" />}
          tone="gold"
        />
        <KpiStatCard
          label="Stock normal"
          value={kpis.normal}
          subtext="Sobre el mínimo configurado"
          icon={<LayersIcon className="w-6 h-6" />}
          tone="green"
        />
        <KpiStatCard
          label="Stock bajo"
          value={kpis.low}
          subtext="Requiere reposición pronta"
          icon={<AlertTriangleIcon className="w-6 h-6" />}
          tone="orange"
        />
        <KpiStatCard
          label="Nivel crítico"
          value={kpis.critical}
          subtext="Atención inmediata"
          icon={<AlertTriangleIcon className="w-6 h-6" />}
          tone="rose"
        />
      </div>

      {/* Nota de trazabilidad contable */}
      <div className="alert-info flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <div className="flex items-start gap-2">
          <InfoCircleIcon className="w-4 h-4 text-[#C8102E] shrink-0 mt-0.5" />
          <span>
            El saldo actual se deriva estrictamente de los <strong>movimientos registrados</strong>{' '}
            (compras, consumos, ajustes, mermas y traslados). Nunca se sobrescribe el stock manualmente.
          </span>
        </div>
        {!canWrite && <span className="badge-blue shrink-0">Supervisión (solo lectura)</span>}
      </div>

      {error && <div className="alert-error">{error}</div>}

      {/* Panel principal con selector de pestañas */}
      <GradientPanel
        title={
          view === 'balances'
            ? `Saldos actuales — ${activeBranch.name}`
            : `Historial de movimientos — ${activeBranch.name}`
        }
        icon={<InventoryBoxesIcon className="w-5 h-5" />}
        bodyClassName="p-0"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex bg-white/15 rounded-[10px] p-0.5">
              <button
                type="button"
                onClick={() => setView('balances')}
                className={`px-3 py-1 rounded-[8px] text-xs font-semibold transition-colors ${
                  view === 'balances' ? 'bg-white text-[#C8102E] shadow-sm' : 'text-white hover:bg-white/10'
                }`}
              >
                Saldos actuales
              </button>
              <button
                type="button"
                onClick={() => setView('movements')}
                className={`px-3 py-1 rounded-[8px] text-xs font-semibold transition-colors ${
                  view === 'movements' ? 'bg-white text-[#C8102E] shadow-sm' : 'text-white hover:bg-white/10'
                }`}
              >
                Movimientos ({movements.length})
              </button>
            </div>

            {canWrite && (
              <button
                type="button"
                onClick={() => openMovementFor()}
                className="inline-flex items-center gap-1.5 bg-[#B70726] hover:bg-[#99051F] text-white border border-white/25 rounded-[10px] px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-colors"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                Registrar movimiento
              </button>
            )}
          </div>
        }
      >
        {/* Barra de filtros */}
        <div className="p-4 border-b border-[#F1E8E4] bg-[#FFFBF9] flex flex-wrap items-end gap-3 justify-between">
          <div className="relative flex-1 min-w-[210px] max-w-sm">
            <SearchIcon className="w-4 h-4 text-[#888888] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              placeholder={
                view === 'balances' ? 'Buscar ítem o código…' : 'Buscar por ítem, tipo o nota…'
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10 py-2 min-h-[38px]"
            />
          </div>

          {view === 'balances' ? (
            <label className="inline-flex items-center gap-1.5 bg-white border border-[#E2D9D5] rounded-[10px] px-3 py-1.5 text-xs font-medium text-[#333333]">
              <FilterIcon className="w-3.5 h-3.5 text-[#C8102E]" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | StockHealth)}
                className="bg-transparent focus:outline-none cursor-pointer"
              >
                <option value="all">Todos los estados</option>
                <option value="normal">Normal</option>
                <option value="low">Stock bajo</option>
                <option value="critical">Crítico</option>
                <option value="unknown">Desconocido</option>
              </select>
            </label>
          ) : (
            <div className="flex flex-wrap items-end gap-2.5">
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
          )}
        </div>

        {loading ? (
          <PageSpinner label="Cargando inventario…" />
        ) : view === 'balances' ? (
          filteredBalances.length === 0 ? (
            <EmptyState
              icon={<InventoryBoxesIcon className="w-6 h-6" />}
              title="Sin saldos registrados"
              description="Registra una compra o un movimiento de entrada para comenzar a controlar el stock de esta sucursal."
            />
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Ítem</th>
                    <th>Tipo</th>
                    <th>Unidad</th>
                    <th>Saldo actual</th>
                    <th>Stock mín.</th>
                    <th>Estado</th>
                    {canWrite && <th className="text-right">Acción</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3EAE6]">
                  {filteredBalances.map(({ balance, item, health }) => (
                    <tr key={balance.item_id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <ItemCategoryAvatar
                            category={item?.category}
                            itemType={item?.item_type}
                          />
                          <div>
                            <p className="font-semibold text-[#222222] leading-tight">
                              {item?.name ?? balance.item_id}
                            </p>
                            <p className="text-[11px] font-mono text-[#888888]">
                              {item?.code ?? '—'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="text-xs text-[#666666]">
                        {item?.item_type === 'insumo' ? 'Insumo' : 'Materia prima'}
                      </td>
                      <td>{item?.base_unit ?? balance.unit ?? '—'}</td>
                      <td
                        className={`font-bold ${
                          health === 'critical'
                            ? 'text-[#B70726]'
                            : health === 'low'
                              ? 'text-[#B86E00]'
                              : 'text-[#222222]'
                        }`}
                      >
                        {balance.balance.toFixed(3)} {item?.base_unit ?? balance.unit ?? ''}
                      </td>
                      <td className="text-[#555555]">
                        {item?.min_stock != null ? `${item.min_stock.toFixed(2)}` : '—'}
                      </td>
                      <td>
                        <StockStatusPill status={health} />
                      </td>
                      {canWrite && (
                        <td className="text-right">
                          <button
                            type="button"
                            onClick={() => openMovementFor(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#EAE0DC] hover:border-[#C8102E] hover:bg-[#FFF5F2] text-xs font-medium text-[#333333] hover:text-[#C8102E] transition-colors"
                          >
                            <PlusIcon className="w-3.5 h-3.5" />
                            Movimiento
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : filteredMovements.length === 0 ? (
          <EmptyState
            icon={<InventoryBoxesIcon className="w-6 h-6" />}
            title="Sin movimientos en este período"
            description="Ajusta el rango de fechas o registra un movimiento nuevo."
          />
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha efectiva</th>
                  <th>Ítem</th>
                  <th>Tipo</th>
                  <th>Cantidad</th>
                  <th>Unidad</th>
                  <th>Observaciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3EAE6]">
                {filteredMovements.map((m) => (
                  <tr key={m.id}>
                    <td className="font-medium">{m.effective_date}</td>
                    <td className="font-semibold text-[#222222]">
                      {itemMap.get(m.item_id)?.name ?? m.item_id}
                    </td>
                    <td>
                      <MovTypeBadge type={m.movement_type} />
                    </td>
                    <td className="font-semibold">{m.quantity_base.toFixed(3)}</td>
                    <td>{m.unit}</td>
                    <td className="text-xs text-[#666666] max-w-[260px] truncate">
                      {m.notes ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GradientPanel>

      {/* Modal registrar movimiento */}
      {showForm && (
        <AppModal
          title="Registrar movimiento de inventario"
          subtitle={activeBranch.name}
          onClose={() => setShowForm(false)}
        >
          <form onSubmit={handleMvSubmit} className="space-y-4">
            <div>
              <label className="label">Ítem *</label>
              <select
                className="input"
                value={mvForm.item_id}
                onChange={(e) => {
                  const item = items.find((x) => x.id === e.target.value)
                  setMvForm((s) => ({
                    ...s,
                    item_id: e.target.value,
                    unit: item?.base_unit ?? '',
                  }))
                }}
                required
              >
                <option value="">— Seleccionar —</option>
                {items
                  .filter((it) => it.is_active)
                  .map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} ({it.base_unit})
                    </option>
                  ))}
              </select>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Tipo de movimiento *</label>
                <select
                  className="input"
                  value={mvForm.movement_type}
                  onChange={(e) =>
                    setMvForm((s) => ({ ...s, movement_type: e.target.value as MovementType }))
                  }
                  required
                >
                  <option value="ajuste_entrada">Entrada / Ajuste (+)</option>
                  <option value="ajuste_salida">Salida / Ajuste (-)</option>
                  <option value="merma">Merma (-)</option>
                  <option value="traslado_entrada">Traslado entrada (+)</option>
                  <option value="traslado_salida">Traslado salida (-)</option>
                </select>
              </div>
              <div>
                <label className="label">Fecha efectiva *</label>
                <input
                  type="date"
                  className="input"
                  value={mvForm.effective_date}
                  onChange={(e) => setMvForm((s) => ({ ...s, effective_date: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="label">Cantidad *</label>
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  className="input"
                  value={mvForm.quantity_base}
                  onChange={(e) => setMvForm((s) => ({ ...s, quantity_base: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="label">Unidad *</label>
                <input
                  className="input"
                  value={mvForm.unit}
                  onChange={(e) => setMvForm((s) => ({ ...s, unit: e.target.value }))}
                  required
                />
              </div>
            </div>

            <div>
              <label className="label">Motivo / Observaciones</label>
              <input
                className="input"
                value={mvForm.notes}
                onChange={(e) => setMvForm((s) => ({ ...s, notes: e.target.value }))}
                placeholder="Justificación del ajuste, merma o traslado…"
              />
            </div>

            {formError && <p className="alert-error">{formError}</p>}

            <div className="flex justify-end gap-2.5 pt-2 border-t border-[#F1E8E4]">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Guardando…' : 'Registrar movimiento'}
              </button>
            </div>
          </form>
        </AppModal>
      )}
    </div>
  )
}

function MovTypeBadge({ type }: { type: MovementType }) {
  const labels: Record<MovementType, [string, string]> = {
    compra: ['Compra (+)', 'badge-green'],
    consumo: ['Consumo (-)', 'badge-blue'],
    ajuste_entrada: ['Ajuste (+)', 'badge-green'],
    ajuste_salida: ['Ajuste (-)', 'badge-yellow'],
    merma: ['Merma (-)', 'badge-red'],
    traslado_entrada: ['Traslado (+)', 'badge-green'],
    traslado_salida: ['Traslado (-)', 'badge-yellow'],
  }
  const [label, cls] = labels[type] ?? [type, 'badge-gray']
  return <span className={cls}>{label}</span>
}
