/**
 * Módulo M04 — Registro de Compras por sucursal.
 * - Admin y Encargado pueden registrar compras multilínea (impacta inventario atómicamente).
 * - Gerente visualiza en modo supervisión (solo lectura).
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'

import {
  CartIcon,
  CloseXIcon,
  EyeViewIcon,
  LayersIcon,
  PlusIcon,
  SearchIcon,
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
import { useBranch } from '../../contexts/BranchContext'
import api from '../../lib/api'
import type { Item, Purchase } from '../../types'

interface LineInput {
  item_id: string
  quantity_base: string
  unit: string
  unit_cost: string
  notes: string
}

function emptyLine(): LineInput {
  return { item_id: '', quantity_base: '', unit: '', unit_cost: '', notes: '' }
}

function today(): string {
  return new Date().toISOString().split('T')[0]
}

export default function PurchasesPage() {
  const { currentUser } = useAuth()
  const { activeBranch } = useBranch()
  const canWrite = currentUser?.role === 'admin' || currentUser?.role === 'encargado'

  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filtros
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  // Modal nueva compra
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [purchaseDate, setPurchaseDate] = useState(today())
  const [supplier, setSupplier] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineInput[]>([emptyLine()])

  // Modal detalle
  const [detailPurchase, setDetailPurchase] = useState<Purchase | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = async () => {
    if (!activeBranch) return
    setLoading(true)
    setError(null)
    try {
      const [purchasesRes, itemsRes] = await Promise.all([
        api.get<Purchase[]>('/api/v1/purchases/', {
          params: {
            branch_id: activeBranch.id,
            from_date: fromDate || undefined,
            to_date: toDate || undefined,
            limit: 150,
          },
        }),
        api.get<Item[]>('/api/v1/items/', { params: { limit: 250 } }),
      ])
      setPurchases(purchasesRes.data)
      setItems(itemsRes.data)
    } catch {
      setError('No se pudieron cargar las compras de la sucursal.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [activeBranch?.id, fromDate, toDate])

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return purchases
    return purchases.filter(
      (p) =>
        (p.supplier ?? '').toLowerCase().includes(q) ||
        (p.notes ?? '').toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.purchase_date.includes(q)
    )
  }, [purchases, search])

  const totalLines = useMemo(
    () => purchases.reduce((acc, p) => acc + (p.lines_count ?? p.lines?.length ?? 0), 0),
    [purchases]
  )

  const uniqueSuppliers = useMemo(() => {
    return new Set(
      purchases.map((p) => p.supplier?.trim()).filter((s): s is string => Boolean(s))
    ).size
  }, [purchases])

  const openDetail = async (p: Purchase) => {
    setDetailLoading(true)
    setDetailPurchase(p)
    try {
      const { data } = await api.get<Purchase>(`/api/v1/purchases/${p.id}`)
      setDetailPurchase(data)
    } catch {
      setError('Error al cargar el detalle de la compra.')
      setDetailPurchase(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const addLine = () => setLines((ls) => [...ls, emptyLine()])
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i))
  const updateLine = (i: number, field: keyof LineInput, value: string) => {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)))
  }

  const estimatedTotal = useMemo(() => {
    return lines.reduce((sum, l) => {
      const q = parseFloat(l.quantity_base)
      const c = parseFloat(l.unit_cost)
      if (!Number.isNaN(q) && !Number.isNaN(c)) return sum + q * c
      return sum
    }, 0)
  }, [lines])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!activeBranch) return
    if (lines.some((l) => !l.item_id || !l.quantity_base || !l.unit)) {
      setFormError('Completa ítem, cantidad y unidad en todas las líneas.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await api.post('/api/v1/purchases/', {
        branch_id: activeBranch.id,
        purchase_date: purchaseDate,
        supplier: supplier || null,
        notes: notes || null,
        lines: lines.map((l) => ({
          item_id: l.item_id,
          quantity_base: parseFloat(l.quantity_base),
          unit: l.unit,
          unit_cost: l.unit_cost ? parseFloat(l.unit_cost) : null,
          notes: l.notes || null,
        })),
      })
      setShowForm(false)
      setSupplier('')
      setNotes('')
      setPurchaseDate(today())
      setLines([emptyLine()])
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setFormError(detail ?? 'Error al registrar la compra.')
    } finally {
      setSaving(false)
    }
  }

  if (!activeBranch) {
    return <div className="alert-warning">Selecciona una sucursal para ver las compras.</div>
  }

  return (
    <div className="space-y-5">
      {/* KPIs reales */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiStatCard
          label="Compras registradas"
          value={purchases.length}
          subtext={activeBranch.name}
          icon={<CartIcon className="w-6 h-6" />}
          tone="orange"
        />
        <KpiStatCard
          label="Líneas adquiridas"
          value={totalLines}
          subtext="Entradas a inventario generadas"
          icon={<LayersIcon className="w-6 h-6" />}
          tone="gold"
        />
        <KpiStatCard
          label="Proveedores distintos"
          value={uniqueSuppliers}
          subtext="Registrados en el período"
          icon={<UsersGroupIcon className="w-6 h-6" />}
          tone="purple"
        />
      </div>

      {!canWrite && (
        <div className="alert-info flex items-center justify-between gap-2 text-[13px]">
          <span>
            Modo <strong>Supervisión (solo lectura)</strong>: el Gerente puede auditar todas las
            compras y sus líneas, pero no registrar compras nuevas.
          </span>
          <span className="badge-blue shrink-0">Supervisión</span>
        </div>
      )}

      {error && <div className="alert-error">{error}</div>}

      <GradientPanel
        title={`Historial de compras — ${activeBranch.name}`}
        icon={<CartIcon className="w-5 h-5" />}
        bodyClassName="p-0"
        actions={
          canWrite ? (
            <button
              type="button"
              onClick={() => {
                setShowForm(true)
                setFormError(null)
                setLines([emptyLine()])
              }}
              className="inline-flex items-center gap-1.5 bg-[#B70726] hover:bg-[#99051F] text-white border border-white/25 rounded-[10px] px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-colors"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              Nueva compra
            </button>
          ) : undefined
        }
      >
        {/* Filtros */}
        <div className="p-4 border-b border-[#F1E8E4] bg-[#FFFBF9] flex flex-wrap items-end gap-3 justify-between">
          <div className="relative flex-1 min-w-[210px] max-w-sm">
            <SearchIcon className="w-4 h-4 text-[#888888] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              placeholder="Buscar por proveedor, nota o ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10 py-2 min-h-[38px]"
            />
          </div>

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
            {(fromDate || toDate || search) && (
              <button
                type="button"
                onClick={() => {
                  setFromDate('')
                  setToDate('')
                  setSearch('')
                }}
                className="btn-secondary text-xs py-2 px-3"
              >
                Limpiar
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <PageSpinner label="Cargando compras…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<CartIcon className="w-6 h-6" />}
            title="No hay compras registradas"
            description="Registra una compra para generar automáticamente los movimientos de entrada en inventario."
          />
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Proveedor</th>
                  <th>Líneas</th>
                  <th>Observaciones</th>
                  <th>ID documento</th>
                  <th className="text-right">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3EAE6]">
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td className="font-semibold text-[#222222]">{p.purchase_date}</td>
                    <td>{p.supplier ?? <span className="text-[#888888]">Sin proveedor</span>}</td>
                    <td>
                      <span className="badge-blue">
                        {p.lines_count ?? p.lines?.length ?? 0} ítems
                      </span>
                    </td>
                    <td className="text-[#666666] max-w-[240px] truncate">{p.notes ?? '—'}</td>
                    <td className="font-mono text-xs text-[#888888]">{p.id.slice(0, 10)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => openDetail(p)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#EAE0DC] hover:border-[#C8102E] hover:bg-[#FFF5F2] text-xs font-medium text-[#333333] hover:text-[#C8102E] transition-colors"
                      >
                        <EyeViewIcon className="w-3.5 h-3.5" />
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GradientPanel>

      {/* Modal nueva compra */}
      {showForm && (
        <AppModal
          title="Registrar compra"
          subtitle={`${activeBranch.name} · Genera entradas automáticas de inventario`}
          size="lg"
          onClose={() => setShowForm(false)}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Fecha de compra *</label>
                <input
                  type="date"
                  className="input"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="label">Proveedor</label>
                <input
                  className="input"
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  placeholder="Nombre del proveedor"
                />
              </div>
            </div>

            <div>
              <label className="label">Observaciones</label>
              <input
                className="input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Referencia de factura, lote o notas de recepción…"
              />
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="label mb-0">Líneas de compra *</span>
                <button
                  type="button"
                  onClick={addLine}
                  className="btn-secondary text-xs py-1.5 px-3"
                >
                  <PlusIcon className="w-3.5 h-3.5" />
                  Agregar línea
                </button>
              </div>

              <div className="space-y-2">
                {lines.map((line, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-12 gap-2 items-center p-2.5 rounded-xl bg-[#FFFBF9] border border-[#F0E4DF]"
                  >
                    <div className="col-span-12 sm:col-span-5">
                      <select
                        className="input text-xs min-h-[38px] py-1.5"
                        value={line.item_id}
                        onChange={(e) => {
                          const item = items.find((x) => x.id === e.target.value)
                          updateLine(i, 'item_id', e.target.value)
                          if (item) updateLine(i, 'unit', item.base_unit)
                        }}
                        required
                      >
                        <option value="">— Seleccionar ítem —</option>
                        {items
                          .filter((it) => it.is_active)
                          .map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.name} ({it.base_unit})
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        className="input text-xs min-h-[38px] py-1.5"
                        placeholder="Cant."
                        value={line.quantity_base}
                        onChange={(e) => updateLine(i, 'quantity_base', e.target.value)}
                        required
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <input
                        className="input text-xs min-h-[38px] py-1.5"
                        placeholder="Unidad"
                        value={line.unit}
                        onChange={(e) => updateLine(i, 'unit', e.target.value)}
                        required
                      />
                    </div>
                    <div className="col-span-3 sm:col-span-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="input text-xs min-h-[38px] py-1.5"
                        placeholder="Costo u."
                        value={line.unit_cost}
                        onChange={(e) => updateLine(i, 'unit_cost', e.target.value)}
                      />
                    </div>
                    <div className="col-span-1 flex justify-end">
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(i)}
                          className="w-7 h-7 rounded-lg hover:bg-[#FFF0F0] text-[#B70726] flex items-center justify-center"
                          aria-label="Quitar línea"
                        >
                          <CloseXIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {estimatedTotal > 0 && (
                <div className="flex justify-end text-xs text-[#555555] pt-1">
                  Total estimado según costos ingresados:{' '}
                  <strong className="ml-1 text-[#222222]">Bs {estimatedTotal.toFixed(2)}</strong>
                </div>
              )}
            </div>

            {formError && <p className="alert-error">{formError}</p>}

            <div className="flex justify-end gap-2.5 pt-2 border-t border-[#F1E8E4]">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Registrando…' : 'Registrar compra'}
              </button>
            </div>
          </form>
        </AppModal>
      )}

      {/* Modal detalle de compra */}
      {detailPurchase && (
        <AppModal
          title={`Detalle de compra — ${detailPurchase.purchase_date}`}
          subtitle={`ID: ${detailPurchase.id}`}
          size="lg"
          onClose={() => setDetailPurchase(null)}
        >
          {detailLoading ? (
            <PageSpinner label="Cargando líneas de compra…" />
          ) : (
            <div className="space-y-4 text-sm">
              <div className="grid sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-[#FFF9F6] border border-[#F2E6DF] text-xs">
                <div>
                  <span className="text-[#777777] block">Proveedor</span>
                  <span className="font-semibold text-[#222222]">
                    {detailPurchase.supplier ?? 'No especificado'}
                  </span>
                </div>
                <div>
                  <span className="text-[#777777] block">Sucursal</span>
                  <span className="font-semibold text-[#222222]">
                    {detailPurchase.branch_name ?? activeBranch.name}
                  </span>
                </div>
                {detailPurchase.notes && (
                  <div className="sm:col-span-2">
                    <span className="text-[#777777] block">Observaciones</span>
                    <span className="text-[#333333]">{detailPurchase.notes}</span>
                  </div>
                )}
              </div>

              <div className="table-container border border-[#F1E8E4] rounded-xl">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Ítem</th>
                      <th>Cantidad</th>
                      <th>Unidad</th>
                      <th>Costo unit.</th>
                      <th className="text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3EAE6]">
                    {detailPurchase.lines?.map((l, idx) => (
                      <tr key={l.line_index ?? idx}>
                        <td className="font-medium">
                          {l.item_name ?? itemMap.get(l.item_id)?.name ?? l.item_id}
                        </td>
                        <td className="font-semibold">{l.quantity_base.toFixed(3)}</td>
                        <td>{l.unit}</td>
                        <td>{l.unit_cost != null ? `Bs ${l.unit_cost.toFixed(2)}` : '—'}</td>
                        <td className="text-right font-semibold">
                          {l.unit_cost != null
                            ? `Bs ${(l.quantity_base * l.unit_cost).toFixed(2)}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </AppModal>
      )}
    </div>
  )
}
