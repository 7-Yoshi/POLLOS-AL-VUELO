/**
 * Módulo M09 — Reportes y Análisis Consolidado Multi-Sucursal (Admin y Gerente).
 * - Vista por sucursal activa o consolidado comparativo de todas las sucursales (Problema 4).
 * - Exportación real a CSV desde el backend FastAPI.
 * - Filtros de período e ítem para evitar mezclar escalas al comparar series.
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import {
  AlertTriangleIcon,
  BarChartIcon,
  BranchStoreIcon,
  CartIcon,
  DownloadIcon,
  LayersIcon,
  MapPinIcon,
  ReportDocIcon,
} from '../../components/ui/Icons'
import {
  EmptyState,
  GradientPanel,
  KpiStatCard,
  PageSpinner,
} from '../../components/ui/SystemUI'
import { useBranch } from '../../contexts/BranchContext'
import api from '../../lib/api'
import type { ConsolidatedReport, ConsumptionSummary, Item } from '../../types'

const BRANCH_COLORS = ['#C8102E', '#FF781F', '#F5B800', '#7C3AED', '#177245']

export default function ReportsPage() {
  const { activeBranch, branches } = useBranch()
  const [searchParams] = useSearchParams()
  const [scope, setScope] = useState<'single' | 'consolidated'>(
    searchParams.get('mode') === 'consolidated' ? 'consolidated' : 'single'
  )

  const [fromDate, setFromDate] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return d.toISOString().split('T')[0]
  })
  const [toDate, setToDate] = useState(() => new Date().toISOString().split('T')[0])
  const [itemFilter, setItemFilter] = useState('')

  const [items, setItems] = useState<Item[]>([])
  const [summary, setSummary] = useState<ConsumptionSummary | null>(null)
  const [consolidated, setConsolidated] = useState<ConsolidatedReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    api
      .get<Item[]>('/api/v1/items/', { params: { item_type: 'materia_prima', limit: 200 } })
      .then((res) => setItems(res.data))
      .catch(() => {})
  }, [])

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  const handleGenerate = async () => {
    if (scope === 'single' && !activeBranch) return
    setLoading(true)
    setError(null)
    try {
      if (scope === 'consolidated') {
        const { data } = await api.get<ConsolidatedReport>('/api/v1/reports/consolidated', {
          params: {
            from_date: fromDate,
            to_date: toDate,
            item_id: itemFilter || undefined,
          },
        })
        setConsolidated(data)
        setSummary(null)
      } else {
        const { data } = await api.get<ConsumptionSummary>('/api/v1/reports/consumption-summary', {
          params: {
            branch_id: activeBranch!.id,
            from_date: fromDate,
            to_date: toDate,
          },
        })
        setSummary(data)
        setConsolidated(null)
      }
    } catch {
      setError('No se pudo generar el reporte para el período seleccionado.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (scope === 'consolidated' || activeBranch) {
      handleGenerate()
    }
  }, [scope, activeBranch?.id])

  const handleExportCSV = async () => {
    if (scope === 'single' && !activeBranch) return
    setDownloading(true)
    try {
      const params: Record<string, string> = { from_date: fromDate, to_date: toDate }
      if (scope === 'single' && activeBranch) {
        params.branch_id = activeBranch.id
      }
      const response = await api.get('/api/v1/reports/consumption-export', {
        params,
        responseType: 'blob',
      })
      const url = URL.createObjectURL(response.data as Blob)
      const a = document.createElement('a')
      a.href = url
      const suffix = scope === 'consolidated' ? 'todas_sucursales' : activeBranch?.id ?? 'sucursal'
      a.download = `consumo_${suffix}_${fromDate}_${toDate}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Error al exportar el archivo CSV.')
    } finally {
      setDownloading(false)
    }
  }

  const filteredSingleRecords = useMemo(() => {
    if (!summary) return []
    return itemFilter
      ? summary.records.filter((r) => r.item_id === itemFilter)
      : summary.records
  }, [summary, itemFilter])

  const singleChartArray = useMemo(() => {
    const grouped: Record<string, number> = {}
    for (const r of filteredSingleRecords) {
      if (r.quantity_base != null) {
        grouped[r.date] = (grouped[r.date] ?? 0) + r.quantity_base
      }
    }
    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, total]) => ({ date: date.slice(5), total: Number(total.toFixed(2)) }))
  }, [filteredSingleRecords])

  if (!activeBranch && scope === 'single') {
    return <div className="alert-warning">Selecciona una sucursal para generar reportes.</div>
  }

  const selectedItemObj = itemFilter ? itemMap.get(itemFilter) : null

  return (
    <div className="space-y-5">
      {/* Barra de configuración del reporte */}
      <GradientPanel
        title="Parámetros del reporte"
        icon={<ReportDocIcon className="w-5 h-5" />}
        actions={
          <div className="inline-flex bg-white/15 rounded-[10px] p-0.5">
            <button
              type="button"
              onClick={() => setScope('single')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-[8px] text-xs font-semibold transition-colors ${
                scope === 'single' ? 'bg-white text-[#C8102E] shadow-sm' : 'text-white hover:bg-white/10'
              }`}
            >
              <MapPinIcon className="w-3.5 h-3.5" />
              Sucursal ({activeBranch?.name ?? '—'})
            </button>
            <button
              type="button"
              onClick={() => setScope('consolidated')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-[8px] text-xs font-semibold transition-colors ${
                scope === 'consolidated'
                  ? 'bg-white text-[#C8102E] shadow-sm'
                  : 'text-white hover:bg-white/10'
              }`}
            >
              <BranchStoreIcon className="w-3.5 h-3.5" />
              Consolidado ({branches.length})
            </button>
          </div>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label text-xs">Desde</label>
            <input
              type="date"
              className="input py-1.5 min-h-[38px] text-xs"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label text-xs">Hasta</label>
            <input
              type="date"
              className="input py-1.5 min-h-[38px] text-xs"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
          <div className="min-w-[200px]">
            <label className="label text-xs">Materia prima (opcional)</label>
            <select
              className="input py-1.5 min-h-[38px] text-xs"
              value={itemFilter}
              onChange={(e) => setItemFilter(e.target.value)}
            >
              <option value="">Todas las materias primas</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name} ({it.base_unit})
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            className="btn-primary text-xs py-2.5 px-4"
          >
            <BarChartIcon className="w-4 h-4" />
            {loading
              ? 'Generando…'
              : scope === 'consolidated'
                ? 'Comparar sucursales'
                : 'Generar reporte'}
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            disabled={downloading}
            className="btn-secondary text-xs py-2.5 px-4"
          >
            <DownloadIcon className="w-4 h-4 text-[#C8102E]" />
            {downloading ? 'Exportando…' : 'Exportar CSV'}
          </button>
        </div>
      </GradientPanel>

      {error && <div className="alert-error">{error}</div>}
      {loading && <PageSpinner label="Generando reporte analítico…" />}

      {/* Vista Consolidada Multi-Sucursal */}
      {!loading && consolidated && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <KpiStatCard
              label="Consumo total consolidado"
              value={
                selectedItemObj
                  ? `${consolidated.totals.total_consumption.toFixed(2)} ${selectedItemObj.base_unit}`
                  : consolidated.totals.total_consumption.toFixed(2)
              }
              subtext={`${consolidated.branches.length} sucursales`}
              icon={<BarChartIcon className="w-6 h-6" />}
              tone="rose"
            />
            <KpiStatCard
              label="Registros validados"
              value={consolidated.totals.validated_records}
              subtext={`Desconocidos: ${consolidated.totals.unknown_records}`}
              icon={<LayersIcon className="w-6 h-6" />}
              tone="green"
            />
            <KpiStatCard
              label="Compras del período"
              value={consolidated.totals.purchases_count}
              subtext={`${fromDate} a ${toDate}`}
              icon={<CartIcon className="w-6 h-6" />}
              tone="orange"
            />
            <KpiStatCard
              label="Alertas de stock bajo"
              value={consolidated.totals.low_stock_count}
              subtext="Total en sucursales supervisadas"
              icon={<AlertTriangleIcon className="w-6 h-6" />}
              tone="gold"
            />
          </div>

          {consolidated.daily_comparison.length > 0 && (
            <GradientPanel
              title={`Comparativo diario entre sucursales${selectedItemObj ? ` — ${selectedItemObj.name} (${selectedItemObj.base_unit})` : ''}`}
              icon={<BarChartIcon className="w-5 h-5" />}
            >
              <div className="h-[290px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={consolidated.daily_comparison}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F2E7E1" />
                    <XAxis dataKey="date" tick={{ fontSize: 10.5, fill: '#555555' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#666666' }} />
                    <Tooltip />
                    <Legend />
                    {consolidated.branches.map((b, idx) => (
                      <Bar
                        key={b.id}
                        dataKey={b.id}
                        name={b.name}
                        fill={BRANCH_COLORS[idx % BRANCH_COLORS.length]}
                        radius={[6, 6, 0, 0]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </GradientPanel>
          )}

          <GradientPanel
            title="Resumen comparativo por sucursal"
            icon={<BranchStoreIcon className="w-5 h-5" />}
            bodyClassName="p-0"
          >
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Sucursal</th>
                    <th>Consumo total</th>
                    <th>Promedio diario</th>
                    <th>Días activos</th>
                    <th>Validados</th>
                    <th>Desconocidos</th>
                    <th>Compras</th>
                    <th>Stock bajo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3EAE6]">
                  {consolidated.by_branch.map((b) => (
                    <tr key={b.branch_id}>
                      <td className="font-semibold text-[#222222]">{b.branch_name}</td>
                      <td className="font-bold text-[#C8102E]">{b.total_consumption.toFixed(2)}</td>
                      <td>{b.avg_daily_consumption.toFixed(2)}</td>
                      <td>{b.active_days}</td>
                      <td>
                        <span className="badge-green">{b.validated_records}</span>
                      </td>
                      <td>
                        <span className="badge-gray">{b.unknown_records}</span>
                      </td>
                      <td>{b.purchases_count}</td>
                      <td>
                        {b.low_stock_count > 0 ? (
                          <span className="badge-red">{b.low_stock_count}</span>
                        ) : (
                          <span className="badge-green">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GradientPanel>
        </div>
      )}

      {/* Vista de Sucursal Individual */}
      {!loading && summary && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KpiStatCard
              label="Total de registros"
              value={filteredSingleRecords.length}
              subtext={activeBranch?.name ?? ''}
              icon={<ReportDocIcon className="w-6 h-6" />}
              tone="gold"
            />
            <KpiStatCard
              label="Registros con dato"
              value={filteredSingleRecords.filter((r) => r.quantity_base != null).length}
              subtext="Medidos y validados"
              icon={<LayersIcon className="w-6 h-6" />}
              tone="green"
            />
            <KpiStatCard
              label="Sin dato (Desconocido)"
              value={filteredSingleRecords.filter((r) => r.quantity_base == null).length}
              subtext="Excluidos de totales"
              icon={<AlertTriangleIcon className="w-6 h-6" />}
              tone="rose"
            />
          </div>

          {singleChartArray.length > 0 && (
            <GradientPanel
              title={`Evolución diaria de consumo${selectedItemObj ? ` — ${selectedItemObj.name} (${selectedItemObj.base_unit})` : ''}`}
              icon={<BarChartIcon className="w-5 h-5" />}
            >
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={singleChartArray}>
                    <defs>
                      <linearGradient id="repSingleBar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#E52429" />
                        <stop offset="100%" stopColor="#B70726" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F2E7E1" />
                    <XAxis dataKey="date" tick={{ fontSize: 10.5, fill: '#555555' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#666666' }} />
                    <Tooltip />
                    <Bar
                      dataKey="total"
                      name="Consumo diario"
                      fill="url(#repSingleBar)"
                      radius={[8, 8, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </GradientPanel>
          )}

          <GradientPanel
            title="Detalle de registros del período"
            icon={<ReportDocIcon className="w-5 h-5" />}
            bodyClassName="p-0"
          >
            {filteredSingleRecords.length === 0 ? (
              <EmptyState
                icon={<ReportDocIcon className="w-6 h-6" />}
                title="Sin registros en este período"
                description="Amplía el rango de fechas o quita el filtro de materia prima."
              />
            ) : (
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Materia prima</th>
                      <th>Cantidad</th>
                      <th>Unidad</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3EAE6]">
                    {filteredSingleRecords.slice(0, 100).map((r, i) => (
                      <tr key={`${r.date}-${r.item_id}-${i}`}>
                        <td className="font-medium">{r.date}</td>
                        <td className="font-semibold text-[#222222]">
                          {itemMap.get(r.item_id)?.name ?? r.item_id}
                        </td>
                        <td className="font-semibold">
                          {r.quantity_base != null ? r.quantity_base.toFixed(3) : '—'}
                        </td>
                        <td>{r.unit}</td>
                        <td>
                          {r.status === 'medido' ? (
                            <span className="badge-green">Medido</span>
                          ) : r.status === 'calculado_validado' ? (
                            <span className="badge-blue">Validado</span>
                          ) : (
                            <span className="badge-gray">Desconocido</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredSingleRecords.length > 100 && (
                  <div className="px-5 py-3 bg-[#FFFBF9] border-t border-[#F1E8E4] text-xs text-[#666666]">
                    Mostrando 100 de {filteredSingleRecords.length} registros. Usa{' '}
                    <strong>Exportar CSV</strong> para descargar el detalle completo.
                  </div>
                )}
              </div>
            )}
          </GradientPanel>
        </div>
      )}
    </div>
  )
}
