/**
 * Panel Principal (M01) — Pollos al Vuelo.
 * - 4 tarjetas KPI con métricas reales de Firestore (sin porcentajes ficticios).
 * - Gráfico de predicción de consumo ML agrupado estrictamente por unidad de medida (kg, L, unidad)
 *   + lista lateral con estimación y rango ± RMSE.
 * - Calendario de operación mensual real para Admin y Gerente (sin invocar /operations para Encargado).
 * - Indicador de madurez histórica ML (días acumulados / 60).
 * - Resumen de inventario filtrable, ordenable y con estados reales (Normal / Stock bajo / Crítico / Desconocido).
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import {
  AlertTriangleIcon,
  BarChartIcon,
  BranchStoreIcon,
  CalendarOpIcon,
  CartIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CubeIcon,
  EditPencilIcon,
  EyeViewIcon,
  FilterIcon,
  InfoCircleIcon,
  LayersIcon,
  PlusIcon,
  TargetIcon,
  TrendChartIcon,
} from '../../components/ui/Icons'
import {
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
import type {
  EventType,
  InventoryBalance,
  Item,
  MLReadinessResponse,
  OperationEvent,
  Prediction,
  Purchase,
} from '../../types'

interface DashboardPayload {
  items: Item[]
  balances: InventoryBalance[]
  purchases: Purchase[]
  predictions: Prediction[]
  readiness: MLReadinessResponse | null
  events: OperationEvent[]
}

type SortKey = 'name' | 'category' | 'stock' | 'status'

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const MONTHS_SHORT_ES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
]
const DAYS_SHORT_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const WEEKDAYS_HEADER = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const EVENT_STYLE: Record<EventType, { label: string; pill: string; dayBg: string; iconColor: string }> = {
  feriado: {
    label: 'Feriado',
    pill: 'bg-[#FCE4E4] text-[#B70726]',
    dayBg: 'bg-[#FCE4E4] text-[#B70726] font-semibold',
    iconColor: 'text-[#C8102E]',
  },
  bloqueo: {
    label: 'Bloqueo',
    pill: 'bg-[#FFEDE0] text-[#B84A00]',
    dayBg: 'bg-[#FFEDE0] text-[#B84A00] font-semibold',
    iconColor: 'text-[#E8660C]',
  },
  cierre: {
    label: 'Cierre',
    pill: 'bg-[#FAD4D8] text-[#9F1239]',
    dayBg: 'bg-[#FAD4D8] text-[#9F1239] font-semibold',
    iconColor: 'text-[#9F1239]',
  },
  dia_especial: {
    label: 'Día especial',
    pill: 'bg-[#F0E6FA] text-[#6B21A8]',
    dayBg: 'bg-[#F0E6FA] text-[#6B21A8] font-semibold',
    iconColor: 'text-[#7C3AED]',
  },
}

const STATUS_WEIGHT: Record<StockHealth, number> = {
  critical: 0,
  low: 1,
  normal: 2,
  unknown: 3,
}

function formatShortDateEs(isoDate: string): string {
  const parts = isoDate.split('-').map(Number)
  if (parts.length !== 3) return isoDate
  const dt = new Date(parts[0], parts[1] - 1, parts[2])
  const wd = DAYS_SHORT_ES[dt.getDay()]
  const mon = MONTHS_SHORT_ES[parts[1] - 1] ?? ''
  return `${wd}, ${parts[2]} ${mon}`
}

function toIsoDate(year: number, month0: number, day: number): string {
  const mm = String(month0 + 1).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

export default function DashboardPage() {
  const { currentUser } = useAuth()
  const { activeBranch, branches } = useBranch()
  const navigate = useNavigate()

  const [data, setData] = useState<DashboardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filtros e interacciones locales
  const [selectedUnit, setSelectedUnit] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<'all' | StockHealth>('all')
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortAsc, setSortAsc] = useState(true)
  const [showInfoTip, setShowInfoTip] = useState(false)

  // Mes visible del calendario operativo
  const now = new Date()
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth())

  const canSeeOperations = currentUser?.role === 'admin' || currentUser?.role === 'gerente'
  const canCreateMaterial = currentUser?.role === 'admin'
  const canViewConsolidated = canSeeOperations && branches.length > 1

  useEffect(() => {
    if (!activeBranch || !currentUser) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const today = new Date().toISOString().split('T')[0]
        const from30 = new Date(Date.now() - 30 * 86400_000).toISOString().split('T')[0]

        const [itemsRes, balancesRes, purchasesRes, predictionsRes, readinessRes, eventsRes] =
          await Promise.all([
            api.get<Item[]>('/api/v1/items/', { params: { item_type: 'materia_prima', limit: 200 } }),
            api.get<InventoryBalance[]>('/api/v1/inventory/balance', {
              params: { branch_id: activeBranch.id },
            }),
            api.get<Purchase[]>('/api/v1/purchases/', {
              params: { branch_id: activeBranch.id, from_date: from30, to_date: today, limit: 100 },
            }),
            api.get<Prediction[]>('/api/v1/predictions/', {
              params: { branch_id: activeBranch.id, limit: 30 },
            }),
            api.get<MLReadinessResponse>('/api/v1/consumption/readiness', {
              params: { branch_id: activeBranch.id },
            }),
            canSeeOperations
              ? api.get<OperationEvent[]>('/api/v1/operations/events', {
                  params: { branch_id: activeBranch.id, limit: 200 },
                })
              : Promise.resolve({ data: [] as OperationEvent[] }),
          ])

        if (cancelled) return
        setData({
          items: itemsRes.data,
          balances: balancesRes.data,
          purchases: purchasesRes.data,
          predictions: predictionsRes.data,
          readiness: readinessRes.data,
          events: eventsRes.data,
        })
      } catch {
        if (!cancelled) {
          setError('No se pudo cargar el panel principal. Intenta recargar.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [activeBranch?.id, currentUser?.role, canSeeOperations])

  // Agrupar últimas predicciones únicas por item_id para evitar duplicados en el gráfico
  const latestPredictionsByItem = useMemo(() => {
    if (!data) return []
    const seen = new Map<string, Prediction>()
    for (const p of data.predictions) {
      if (!seen.has(p.item_id)) {
        seen.set(p.item_id, p)
      }
    }
    return Array.from(seen.values()).sort((a, b) => b.predicted_quantity - a.predicted_quantity)
  }, [data])

  const availableUnits = useMemo(() => {
    const units = Array.from(new Set(latestPredictionsByItem.map((p) => p.unit).filter(Boolean)))
    return units
  }, [latestPredictionsByItem])

  useEffect(() => {
    if (availableUnits.length === 0) {
      setSelectedUnit('')
    } else if (!selectedUnit || !availableUnits.includes(selectedUnit)) {
      setSelectedUnit(availableUnits[0])
    }
  }, [availableUnits, selectedUnit])

  const itemMap = useMemo(() => {
    return new Map((data?.items ?? []).map((it) => [it.id, it]))
  }, [data?.items])

  const balanceMap = useMemo(() => {
    return new Map((data?.balances ?? []).map((b) => [b.item_id, b]))
  }, [data?.balances])

  const inventoryRows = useMemo(() => {
    if (!data) return []
    return data.items.map((item) => {
      const bal = balanceMap.get(item.id)
      const stock = bal ? bal.balance : null
      const status = computeStockHealth(stock, item.min_stock)
      return {
        item,
        stock,
        status,
      }
    })
  }, [data, balanceMap])

  const lowCount = useMemo(
    () => inventoryRows.filter((r) => r.status === 'low' || r.status === 'critical').length,
    [inventoryRows]
  )
  const criticalCount = useMemo(
    () => inventoryRows.filter((r) => r.status === 'critical').length,
    [inventoryRows]
  )

  const filteredInventoryRows = useMemo(() => {
    const rows =
      statusFilter === 'all'
        ? inventoryRows
        : inventoryRows.filter((r) => r.status === statusFilter)

    return [...rows].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') {
        cmp = a.item.name.localeCompare(b.item.name, 'es')
      } else if (sortKey === 'category') {
        cmp = (a.item.category ?? '').localeCompare(b.item.category ?? '', 'es')
      } else if (sortKey === 'stock') {
        cmp = (a.stock ?? -1) - (b.stock ?? -1)
      } else {
        cmp = STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status]
      }
      return sortAsc ? cmp : -cmp
    })
  }, [inventoryRows, statusFilter, sortKey, sortAsc])

  // Gráfico de predicciones estrictamente en la unidad seleccionada
  const chartData = useMemo(() => {
    if (!selectedUnit) return []
    return latestPredictionsByItem
      .filter((p) => p.unit === selectedUnit)
      .slice(0, 6)
      .map((p) => {
        const item = itemMap.get(p.item_id)
        const fullName = item?.name ?? p.item_id
        const shortName = fullName.length > 13 ? `${fullName.slice(0, 12)}…` : fullName
        return {
          name: shortName,
          fullName,
          qty: Number(p.predicted_quantity.toFixed(2)),
          unit: p.unit,
          date: p.prediction_for_date,
          rangeMin: p.range_min,
          rangeMax: p.range_max,
          rmse: p.rmse,
        }
      })
  }, [latestPredictionsByItem, selectedUnit, itemMap])

  // Celdas del calendario mensual real
  const calendarCells = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1)
    const startOffset = (firstDay.getDay() + 6) % 7 // Lunes = 0
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
    const daysInPrev = new Date(calYear, calMonth, 0).getDate()

    const cells: Array<{
      iso: string
      day: number
      inMonth: boolean
      event?: OperationEvent
    }> = []

    const events = data?.events ?? []
    const findEvent = (iso: string) =>
      events.find((ev) => ev.start_date <= iso && ev.end_date >= iso)

    for (let i = startOffset - 1; i >= 0; i--) {
      const d = daysInPrev - i
      const prevMonth = calMonth === 0 ? 11 : calMonth - 1
      const prevYear = calMonth === 0 ? calYear - 1 : calYear
      const iso = toIsoDate(prevYear, prevMonth, d)
      cells.push({ iso, day: d, inMonth: false, event: findEvent(iso) })
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = toIsoDate(calYear, calMonth, d)
      cells.push({ iso, day: d, inMonth: true, event: findEvent(iso) })
    }
    const remaining = (7 - (cells.length % 7)) % 7
    for (let d = 1; d <= remaining; d++) {
      const nextMonth = calMonth === 11 ? 0 : calMonth + 1
      const nextYear = calMonth === 11 ? calYear + 1 : calYear
      const iso = toIsoDate(nextYear, nextMonth, d)
      cells.push({ iso, day: d, inMonth: false, event: findEvent(iso) })
    }
    return cells
  }, [calYear, calMonth, data?.events])

  const monthEvents = useMemo(() => {
    const events = data?.events ?? []
    const firstIso = toIsoDate(calYear, calMonth, 1)
    const lastDay = new Date(calYear, calMonth + 1, 0).getDate()
    const lastIso = toIsoDate(calYear, calMonth, lastDay)
    const inThisMonth = events.filter((ev) => ev.end_date >= firstIso && ev.start_date <= lastIso)
    return inThisMonth.sort((a, b) => a.start_date.localeCompare(b.start_date))
  }, [data?.events, calYear, calMonth])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((prev) => !prev)
    } else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const prevMonth = () => {
    if (calMonth === 0) {
      setCalMonth(11)
      setCalYear((y) => y - 1)
    } else {
      setCalMonth((m) => m - 1)
    }
  }

  const nextMonth = () => {
    if (calMonth === 11) {
      setCalMonth(0)
      setCalYear((y) => y + 1)
    } else {
      setCalMonth((m) => m + 1)
    }
  }

  if (!activeBranch) {
    return (
      <div className="alert-warning">
        No tienes sucursales asignadas. Contacta al administrador del sistema.
      </div>
    )
  }

  if (loading) return <PageSpinner label="Cargando panel principal…" />
  if (error) return <div className="alert-error">{error}</div>
  if (!data) return null

  const todayIso = new Date().toISOString().split('T')[0]
  const latestPredDate = latestPredictionsByItem[0]?.prediction_for_date
  const mlEligibleCount = data.items.filter((i) => i.eligible_for_ml).length

  return (
    <div className="space-y-5">
      {/* Fila superior: 4 tarjetas KPI con datos 100% reales */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiStatCard
          label="Materias primas activas"
          value={data.items.length}
          subtext={`${mlEligibleCount} elegibles para ML`}
          icon={<CubeIcon className="w-6 h-6" />}
          tone="gold"
          to="/items"
        />
        <KpiStatCard
          label="Stock bajo"
          value={lowCount}
          subtext={
            criticalCount > 0
              ? `${criticalCount} en nivel crítico`
              : lowCount > 0
                ? 'Requiere reposición'
                : 'Niveles saludables'
          }
          icon={<AlertTriangleIcon className="w-6 h-6" />}
          tone="rose"
          to="/inventory"
        />
        <KpiStatCard
          label="Compras registradas"
          value={data.purchases.length}
          subtext="Últimos 30 días"
          icon={<CartIcon className="w-6 h-6" />}
          tone="orange"
          to="/purchases"
        />
        <KpiStatCard
          label="Predicciones disponibles"
          value={data.predictions.length}
          subtext={
            latestPredDate
              ? `Fecha: ${formatShortDateEs(latestPredDate)}`
              : 'Mín. 30 días validados'
          }
          icon={<BarChartIcon className="w-6 h-6" />}
          tone="purple"
          to="/predictions"
        />
      </div>

      {/* Fila media: Predicción de consumo (8 col) + Calendario operativo o Madurez ML (4 col) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Panel Predicción de consumo */}
        <GradientPanel
          className="xl:col-span-8"
          title="Predicción de consumo"
          icon={<BarChartIcon className="w-5 h-5" />}
          actions={
            <div className="flex items-center gap-2 relative">
              <Link
                to="/predictions"
                className="text-xs font-medium bg-white/15 hover:bg-white/25 text-white px-2.5 py-1 rounded-full transition-colors"
              >
                Ver módulo ML →
              </Link>
              <button
                type="button"
                onClick={() => setShowInfoTip((v) => !v)}
                className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors"
                aria-label="Información sobre predicción"
              >
                <InfoCircleIcon className="w-4 h-4" />
              </button>
              {showInfoTip && (
                <div className="absolute right-0 top-9 z-20 w-72 rounded-xl bg-white text-[#333333] p-3 text-xs shadow-xl border border-[#EFE4DF]">
                  Las barras agrupan únicamente ítems con la <strong>misma unidad de medida</strong> para
                  evitar mezclar escalas incompatibles (kg, L, unidad). Cada estimación conserva su rango ± RMSE.
                </div>
              )}
            </div>
          }
        >
          {latestPredictionsByItem.length === 0 ? (
            <EmptyState
              icon={<TrendChartIcon className="w-6 h-6" />}
              title="Aún no hay predicciones calculadas para esta sucursal"
              description="El modelo predictivo requiere al menos 30 días de consumo diario validado (y 60 días recomendados para entrenamiento)."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Link to="/predictions" className="btn-primary text-xs py-2 px-3.5">
                    Ir a Predicción ML
                  </Link>
                  <Link to="/consumption" className="btn-secondary text-xs py-2 px-3.5">
                    Cargar consumo diario
                  </Link>
                </div>
              }
            />
          ) : (
            <div className="space-y-4">
              {/* Subencabezado con fecha y selector de unidad */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[13.5px] font-semibold text-[#333333]">
                  <CalendarOpIcon className="w-4 h-4 text-[#C8102E]" />
                  <span>
                    Consumo estimado
                    {latestPredDate ? ` (${formatShortDateEs(latestPredDate)})` : ''}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11.5px] text-[#666666]">Unidad del gráfico:</span>
                  {availableUnits.map((unit) => (
                    <button
                      key={unit}
                      type="button"
                      onClick={() => setSelectedUnit(unit)}
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                        selectedUnit === unit
                          ? 'bg-[#C8102E] text-white shadow-sm'
                          : 'bg-[#FFF3EC] text-[#5C3A2E] hover:bg-[#FFE4D6]'
                      }`}
                    >
                      {unit}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
                {/* Gráfico de barras verticales con degradado rojo → naranja → amarillo */}
                <div className="lg:col-span-7 h-[250px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartData}
                      margin={{ top: 24, right: 12, left: 0, bottom: 6 }}
                      barCategoryGap="24%"
                    >
                      <defs>
                        <linearGradient id="pavBar0" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#E52429" />
                          <stop offset="100%" stopColor="#B70726" />
                        </linearGradient>
                        <linearGradient id="pavBar1" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#FFD129" />
                          <stop offset="100%" stopColor="#FF9800" />
                        </linearGradient>
                        <linearGradient id="pavBar2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#FFA726" />
                          <stop offset="100%" stopColor="#FF781F" />
                        </linearGradient>
                        <linearGradient id="pavBar3" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#FFE082" />
                          <stop offset="100%" stopColor="#FFB74D" />
                        </linearGradient>
                        <linearGradient id="pavBar4" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#FFCC80" />
                          <stop offset="100%" stopColor="#FF8A3D" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F2E7E1" />
                      <XAxis
                        dataKey="name"
                        axisLine={{ stroke: '#E5D8D2' }}
                        tickLine={false}
                        tick={{ fontSize: 11.5, fill: '#444444', fontWeight: 500 }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: '#666666' }}
                        tickFormatter={(v) => `${v} ${selectedUnit}`}
                        width={62}
                      />
                      <Tooltip
                        cursor={{ fill: '#FFF4EF', opacity: 0.7 }}
                        contentStyle={{
                          borderRadius: '12px',
                          border: '1px solid #EFE4DF',
                          boxShadow: '0 8px 20px rgba(0,0,0,0.08)',
                          fontSize: '12px',
                        }}
                        formatter={(value: number, _name, props) => {
                          const p = props.payload as (typeof chartData)[number]
                          const rangeText =
                            p.rangeMin != null && p.rangeMax != null
                              ? ` (rango: ${p.rangeMin.toFixed(1)}–${p.rangeMax.toFixed(1)} ${p.unit})`
                              : ''
                          return [`${value.toFixed(2)} ${p.unit}${rangeText}`, p.fullName]
                        }}
                        labelFormatter={() => 'Estimación ML'}
                      />
                      <Bar dataKey="qty" radius={[10, 10, 0, 0]} maxBarSize={54}>
                        {chartData.map((entry, idx) => (
                          <Cell
                            key={entry.fullName}
                            fill={`url(#pavBar${Math.min(idx, 4)})`}
                          />
                        ))}
                        <LabelList
                          dataKey="qty"
                          position="top"
                          formatter={(val: number) => `${val.toFixed(1)} ${selectedUnit}`}
                          style={{ fontSize: 11, fontWeight: 600, fill: '#333333' }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Lista lateral de estimaciones por ítem */}
                <div className="lg:col-span-5 bg-[#FFF9F6] border border-[#F3E6DF] rounded-[14px] p-3.5">
                  <div className="flex items-center gap-2 pb-2.5 mb-2 border-b border-[#EFE2DC]">
                    <TargetIcon className="w-4 h-4 text-[#C8102E]" />
                    <span className="text-[13px] font-semibold text-[#333333]">
                      Consumo estimado reciente
                    </span>
                  </div>
                  <ul className="divide-y divide-[#F3E8E2]">
                    {latestPredictionsByItem.slice(0, 5).map((p) => {
                      const item = itemMap.get(p.item_id)
                      return (
                        <li
                          key={p.id}
                          className="py-2 flex items-center justify-between gap-2.5 text-[13px]"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <ItemCategoryAvatar
                              category={item?.category}
                              itemType={item?.item_type}
                            />
                            <div className="min-w-0">
                              <p className="font-medium text-[#222222] truncate">
                                {item?.name ?? p.item_id}
                              </p>
                              <p className="text-[11px] text-[#777777] truncate">
                                {p.range_min != null && p.range_max != null
                                  ? `±RMSE: ${p.range_min.toFixed(1)}–${p.range_max.toFixed(1)} ${p.unit}`
                                  : formatShortDateEs(p.prediction_for_date)}
                              </p>
                            </div>
                          </div>
                          <span className="font-bold text-[#222222] whitespace-nowrap">
                            {p.predicted_quantity.toFixed(1)} {p.unit}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </GradientPanel>

        {/* Columna derecha (4 col): Calendario operativo para Admin/Gerente; Madurez ML para Encargado */}
        {canSeeOperations ? (
          <GradientPanel
            className="xl:col-span-4"
            title="Calendario de operación"
            icon={<CalendarOpIcon className="w-5 h-5" />}
            bodyClassName="p-4 flex-1 flex flex-col justify-between gap-4"
            actions={
              <Link
                to="/operations"
                className="text-xs font-medium bg-white/15 hover:bg-white/25 text-white px-2.5 py-1 rounded-full transition-colors"
              >
                Abrir →
              </Link>
            }
          >
            <div>
              {/* Navegador de mes */}
              <div className="flex items-center justify-between mb-3 px-1">
                <button
                  type="button"
                  onClick={prevMonth}
                  className="w-7 h-7 rounded-lg hover:bg-[#FFF3EC] text-[#555555] hover:text-[#C8102E] flex items-center justify-center transition-colors"
                  aria-label="Mes anterior"
                >
                  <ChevronLeftIcon className="w-4 h-4" />
                </button>
                <span className="text-[14.5px] font-bold text-[#222222]">
                  {MONTHS_ES[calMonth]} {calYear}
                </span>
                <button
                  type="button"
                  onClick={nextMonth}
                  className="w-7 h-7 rounded-lg hover:bg-[#FFF3EC] text-[#555555] hover:text-[#C8102E] flex items-center justify-center transition-colors"
                  aria-label="Mes siguiente"
                >
                  <ChevronRightIcon className="w-4 h-4" />
                </button>
              </div>

              {/* Encabezados días de la semana */}
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-[#777777] mb-1.5 bg-[#FAF5F2] rounded-lg py-1.5">
                {WEEKDAYS_HEADER.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>

              {/* Grilla de días */}
              <div className="grid grid-cols-7 gap-1 text-center text-[12px]">
                {calendarCells.map((cell) => {
                  const isToday = cell.iso === todayIso
                  const evStyle = cell.event ? EVENT_STYLE[cell.event.event_type] : null
                  return (
                    <div
                      key={cell.iso}
                      title={cell.event ? `${EVENT_STYLE[cell.event.event_type].label}: ${cell.event.name}` : undefined}
                      className={`h-8 rounded-lg flex items-center justify-center transition-colors ${
                        evStyle
                          ? evStyle.dayBg
                          : isToday
                            ? 'bg-[#FFF3CD] text-[#9A6700] font-bold ring-1 ring-[#F5C542]'
                            : cell.inMonth
                              ? 'text-[#333333] hover:bg-[#FFF6F2]'
                              : 'text-[#C2B8B4]'
                      }`}
                    >
                      {cell.day}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Eventos reales del mes seleccionado */}
            <div className="border-t border-[#F1E8E4] pt-3 space-y-2">
              {monthEvents.length === 0 ? (
                <div className="text-center py-2">
                  <p className="text-xs text-[#777777]">
                    No hay eventos registrados en {MONTHS_ES[calMonth].toLowerCase()} {calYear}.
                  </p>
                  <Link
                    to="/operations"
                    className="inline-block mt-1.5 text-xs font-semibold text-[#C8102E] hover:underline"
                  >
                    + Registrar evento operativo
                  </Link>
                </div>
              ) : (
                monthEvents.slice(0, 4).map((ev) => {
                  const st = EVENT_STYLE[ev.event_type]
                  return (
                    <div
                      key={ev.id}
                      className="flex items-center justify-between gap-2 text-[12px]"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <CalendarOpIcon className={`w-3.5 h-3.5 shrink-0 ${st.iconColor}`} />
                        <span className="text-[#555555] whitespace-nowrap">
                          {formatShortDateEs(ev.start_date)}
                        </span>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold shrink-0 ${st.pill}`}>
                        {st.label}
                      </span>
                      <span className="text-[#333333] font-medium truncate max-w-[105px]" title={ev.name}>
                        {ev.name}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          </GradientPanel>
        ) : (
          <GradientPanel
            className="xl:col-span-4"
            title="Madurez histórica ML"
            icon={<TrendChartIcon className="w-5 h-5" />}
            bodyClassName="p-4 flex-1 flex flex-col justify-between gap-3"
          >
            {data.readiness && data.readiness.items.length > 0 ? (
              <>
                <div className="text-xs text-[#555555] bg-[#FFF8F5] border border-[#F3E6DF] rounded-xl p-3">
                  Meta de entrenamiento: <strong>{data.readiness.min_training_days} días</strong> ·
                  Listos: <strong>{data.readiness.summary.ready_for_training}</strong> de{' '}
                  {data.readiness.summary.total_items} materias primas.
                </div>
                <div className="space-y-2.5 flex-1">
                  {data.readiness.items.slice(0, 5).map((item) => (
                    <div key={item.item_id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[#222222] truncate pr-2">
                          {item.item_name}
                        </span>
                        <span className="font-semibold text-[#555555] whitespace-nowrap">
                          {item.accumulated_days} / {item.target_days} d
                        </span>
                      </div>
                      <div className="w-full h-2 bg-[#F2E9E4] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            item.ready_for_training
                              ? 'bg-[#177245]'
                              : item.ready_for_inference
                                ? 'bg-[#FF781F]'
                                : 'bg-[#C8102E]'
                          }`}
                          style={{ width: `${Math.min(100, item.progress_pct)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <Link
                  to="/consumption"
                  className="btn-secondary text-xs py-2 w-full"
                >
                  Registrar o importar consumo CSV
                </Link>
              </>
            ) : (
              <EmptyState
                title="Sin datos históricos aún"
                description="Registra el consumo diario o importa un archivo CSV para alimentar el modelo ML."
                action={
                  <Link to="/consumption" className="btn-primary text-xs py-2 px-3.5">
                    Ir a Consumo diario
                  </Link>
                }
              />
            )}
          </GradientPanel>
        )}
      </div>

      {/* Barra compacta de Madurez Histórica ML (visible para Admin/Gerente; Encargado ya la ve arriba) */}
      {canSeeOperations && data.readiness && (
        <section className="pav-surface p-4 sm:p-5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-[#FFEDE0] text-[#E8660C] flex items-center justify-center shrink-0">
                <TrendChartIcon className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-[15px] font-semibold text-[#222222]">
                  Madurez histórica para Machine Learning (días acumulados / {data.readiness.min_training_days})
                </h2>
                <p className="text-xs text-[#666666]">
                  Listos para entrenar (≥60d):{' '}
                  <strong className="text-[#222222]">{data.readiness.summary.ready_for_training}</strong> de{' '}
                  {data.readiness.summary.total_items} · Listos para inferencia (≥30d):{' '}
                  <strong className="text-[#222222]">{data.readiness.summary.ready_for_inference}</strong>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {canViewConsolidated && (
                <Link
                  to="/reports?mode=consolidated"
                  className="btn-secondary text-xs py-1.5 px-3"
                >
                  <BranchStoreIcon className="w-3.5 h-3.5 text-[#C8102E]" />
                  Comparativo ({branches.length} sucursales)
                </Link>
              )}
              <Link
                to="/consumption"
                className="text-xs font-semibold text-[#C8102E] hover:underline px-2"
              >
                Cargar histórico CSV →
              </Link>
            </div>
          </div>

          {data.readiness.items.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {data.readiness.items.slice(0, 4).map((item) => (
                <div
                  key={item.item_id}
                  className="rounded-xl border border-[#F0E4DF] bg-[#FFFBF9] p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="font-semibold text-[#222222] truncate">{item.item_name}</span>
                    <span className="font-semibold text-[#666666] whitespace-nowrap">
                      {item.accumulated_days}/{item.target_days} d
                    </span>
                  </div>
                  <div className="w-full h-2 bg-[#EFE5E0] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        item.ready_for_training
                          ? 'bg-[#177245]'
                          : item.ready_for_inference
                            ? 'bg-[#FF781F]'
                            : 'bg-[#C8102E]'
                      }`}
                      style={{ width: `${Math.min(100, item.progress_pct)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-[#777777]">
                    {item.ready_for_training
                      ? 'Listo para entrenamiento ML'
                      : item.ready_for_inference
                        ? `Faltan ${item.target_days - item.accumulated_days} días para entrenar`
                        : `Faltan ${item.min_inference_days - item.accumulated_days} días para inferencia`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Fila inferior: Resumen de inventario con encabezado rojo-naranja degradado */}
      <GradientPanel
        title="Resumen de inventario"
        icon={<LayersIcon className="w-5 h-5" />}
        bodyClassName="p-0"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <label className="inline-flex items-center gap-1.5 bg-white text-[#333333] rounded-[10px] px-3 py-1.5 text-xs font-medium shadow-sm">
              <FilterIcon className="w-3.5 h-3.5 text-[#C8102E]" />
              <select
                aria-label="Filtrar inventario por estado"
                className="bg-transparent focus:outline-none cursor-pointer"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | StockHealth)}
              >
                <option value="all">Todos los estados</option>
                <option value="normal">Normal</option>
                <option value="low">Stock bajo</option>
                <option value="critical">Crítico</option>
                <option value="unknown">Desconocido</option>
              </select>
            </label>

            {canCreateMaterial && (
              <button
                type="button"
                onClick={() => navigate('/items?new=1')}
                className="inline-flex items-center gap-1.5 bg-[#B70726] hover:bg-[#99051F] text-white border border-white/25 rounded-[10px] px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-colors"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                Agregar material
              </button>
            )}
          </div>
        }
      >
        {filteredInventoryRows.length === 0 ? (
          <EmptyState
            icon={<CubeIcon className="w-6 h-6" />}
            title="Sin materias primas para mostrar"
            description={
              statusFilter === 'all'
                ? 'Todavía no existen materias primas registradas en el catálogo.'
                : 'No hay materias primas que coincidan con el estado seleccionado.'
            }
          />
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      onClick={() => handleSort('name')}
                      className="inline-flex items-center gap-1 hover:text-[#C8102E]"
                    >
                      Material {sortKey === 'name' ? (sortAsc ? '↑' : '↓') : '↕'}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      onClick={() => handleSort('category')}
                      className="inline-flex items-center gap-1 hover:text-[#C8102E]"
                    >
                      Categoría {sortKey === 'category' ? (sortAsc ? '↑' : '↓') : '↕'}
                    </button>
                  </th>
                  <th>Unidad</th>
                  <th>
                    <button
                      type="button"
                      onClick={() => handleSort('stock')}
                      className="inline-flex items-center gap-1 hover:text-[#C8102E]"
                    >
                      Stock actual {sortKey === 'stock' ? (sortAsc ? '↑' : '↓') : '↕'}
                    </button>
                  </th>
                  <th>Sucursal</th>
                  <th>
                    <button
                      type="button"
                      onClick={() => handleSort('status')}
                      className="inline-flex items-center gap-1 hover:text-[#C8102E]"
                    >
                      Estado {sortKey === 'status' ? (sortAsc ? '↑' : '↓') : '↕'}
                    </button>
                  </th>
                  <th className="text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3EAE6]">
                {filteredInventoryRows.slice(0, 10).map(({ item, stock, status }) => (
                  <tr key={item.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <ItemCategoryAvatar category={item.category} itemType={item.item_type} />
                        <div>
                          <p className="font-semibold text-[#222222] leading-tight">{item.name}</p>
                          <p className="text-[11px] text-[#888888] font-mono">{item.code}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-[#555555]">{item.category ?? 'General'}</td>
                    <td className="font-medium text-[#444444]">{item.base_unit}</td>
                    <td className="font-semibold text-[#222222]">
                      {stock != null ? `${stock.toFixed(1)} ${item.base_unit}` : '—'}
                    </td>
                    <td className="text-[#555555]">{activeBranch.name}</td>
                    <td>
                      <StockStatusPill status={status} />
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5">
                        <Link
                          to="/inventory"
                          title="Ver inventario y movimientos"
                          className="w-8 h-8 rounded-lg border border-[#EAE0DC] hover:border-[#C8102E] hover:bg-[#FFF5F2] text-[#555555] hover:text-[#C8102E] inline-flex items-center justify-center transition-colors"
                        >
                          <EyeViewIcon className="w-4 h-4" />
                        </Link>
                        {canCreateMaterial && (
                          <Link
                            to={`/items?edit=${encodeURIComponent(item.id)}`}
                            title="Editar materia prima"
                            className="w-8 h-8 rounded-lg border border-[#EAE0DC] hover:border-[#C8102E] hover:bg-[#FFF5F2] text-[#555555] hover:text-[#C8102E] inline-flex items-center justify-center transition-colors"
                          >
                            <EditPencilIcon className="w-4 h-4" />
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filteredInventoryRows.length > 10 && (
              <div className="px-5 py-3 bg-[#FFFBF9] border-t border-[#F1E8E4] flex items-center justify-between text-xs text-[#666666]">
                <span>
                  Mostrando 10 de {filteredInventoryRows.length} materias primas
                </span>
                <Link to="/inventory" className="font-semibold text-[#C8102E] hover:underline">
                  Ver inventario completo →
                </Link>
              </div>
            )}
          </div>
        )}
      </GradientPanel>
    </div>
  )
}
