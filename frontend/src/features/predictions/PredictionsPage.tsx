/**
 * Módulo M08 — Predicción de Demanda con Machine Learning (CRISP-DM).
 * - Admin y Gerente: consultan historial y solicitan nuevas predicciones.
 * - Encargado: acceso en modo SOLO LECTURA para su sucursal asignada (Problema 3).
 * - Gráfico agrupado estrictamente por unidad de medida (nunca mezcla kg, L y unidad).
 * - Muestra rango de confianza ± RMSE y métricas reales (MAE, RMSE, R²) sin valores simulados.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'
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
  BarChartIcon,
  CubeIcon,
  InfoCircleIcon,
  PlusIcon,
  TargetIcon,
  TrendChartIcon,
} from '../../components/ui/Icons'
import {
  AppModal,
  EmptyState,
  GradientPanel,
  ItemCategoryAvatar,
  KpiStatCard,
  PageSpinner,
} from '../../components/ui/SystemUI'
import { useAuth } from '../../contexts/AuthContext'
import { useBranch } from '../../contexts/BranchContext'
import api from '../../lib/api'
import type { Item, MLReadinessResponse, Prediction, PredictionResult } from '../../types'

export default function PredictionsPage() {
  const { currentUser } = useAuth()
  const { activeBranch } = useBranch()
  const canGenerate = currentUser?.role === 'admin' || currentUser?.role === 'gerente'

  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [eligibleItems, setEligibleItems] = useState<Item[]>([])
  const [allItems, setAllItems] = useState<Item[]>([])
  const [readiness, setReadiness] = useState<MLReadinessResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedUnit, setSelectedUnit] = useState('')

  // Modal solicitar predicción
  const [showForm, setShowForm] = useState(false)
  const [predItemId, setPredItemId] = useState('')
  const [predDate, setPredDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().split('T')[0]
  })
  const [predResult, setPredResult] = useState<PredictionResult | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [reqError, setReqError] = useState<string | null>(null)

  const load = async () => {
    if (!activeBranch) return
    setLoading(true)
    setError(null)
    try {
      const [predsRes, itemsRes, readyRes] = await Promise.all([
        api.get<Prediction[]>('/api/v1/predictions/', {
          params: { branch_id: activeBranch.id, limit: 60 },
        }),
        api.get<Item[]>('/api/v1/items/', { params: { item_type: 'materia_prima', limit: 200 } }),
        api.get<MLReadinessResponse>('/api/v1/consumption/readiness', {
          params: { branch_id: activeBranch.id },
        }),
      ])
      setPredictions(predsRes.data)
      setAllItems(itemsRes.data)
      setEligibleItems(itemsRes.data.filter((i) => i.eligible_for_ml && i.is_active))
      setReadiness(readyRes.data)
    } catch {
      setError('Error al cargar el módulo de predicciones ML.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [activeBranch?.id])

  const allItemMap = useMemo(() => new Map(allItems.map((i) => [i.id, i])), [allItems])

  // Última predicción única por ítem para la gráfica comparativa
  const latestByItem = useMemo(() => {
    const map = new Map<string, Prediction>()
    for (const p of predictions) {
      if (!map.has(p.item_id)) map.set(p.item_id, p)
    }
    return Array.from(map.values()).sort((a, b) => b.predicted_quantity - a.predicted_quantity)
  }, [predictions])

  const units = useMemo(
    () => Array.from(new Set(latestByItem.map((p) => p.unit).filter(Boolean))),
    [latestByItem]
  )

  useEffect(() => {
    if (units.length === 0) setSelectedUnit('')
    else if (!selectedUnit || !units.includes(selectedUnit)) setSelectedUnit(units[0])
  }, [units, selectedUnit])

  const chartData = useMemo(() => {
    if (!selectedUnit) return []
    return latestByItem
      .filter((p) => p.unit === selectedUnit)
      .slice(0, 8)
      .map((p) => {
        const name = allItemMap.get(p.item_id)?.name ?? p.item_id
        return {
          name: name.length > 14 ? `${name.slice(0, 13)}…` : name,
          fullName: name,
          qty: Number(p.predicted_quantity.toFixed(2)),
          unit: p.unit,
          rangeMin: p.range_min,
          rangeMax: p.range_max,
          date: p.prediction_for_date,
        }
      })
  }, [latestByItem, selectedUnit, allItemMap])

  const latestR2 = useMemo(() => {
    const withR2 = predictions.find((p) => p.r2 != null)
    return withR2?.r2 != null ? withR2.r2.toFixed(3) : '—'
  }, [predictions])

  const handlePredict = async (e: FormEvent) => {
    e.preventDefault()
    if (!activeBranch || !predItemId) return
    setRequesting(true)
    setReqError(null)
    setPredResult(null)
    try {
      const { data } = await api.post<PredictionResult>('/api/v1/predictions/predict', {
        branch_id: activeBranch.id,
        item_id: predItemId,
        prediction_for_date: predDate,
      })
      setPredResult(data)
      if (data.status === 'ok') await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setReqError(detail ?? 'Error al solicitar la predicción.')
    } finally {
      setRequesting(false)
    }
  }

  if (!activeBranch) {
    return <div className="alert-warning">Selecciona una sucursal para ver predicciones ML.</div>
  }

  return (
    <div className="space-y-5">
      {/* KPIs reales */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiStatCard
          label="Predicciones registradas"
          value={predictions.length}
          subtext={activeBranch.name}
          icon={<BarChartIcon className="w-6 h-6" />}
          tone="purple"
        />
        <KpiStatCard
          label="Materias elegibles ML"
          value={eligibleItems.length}
          subtext="Con bandera eligible_for_ml"
          icon={<CubeIcon className="w-6 h-6" />}
          tone="gold"
        />
        <KpiStatCard
          label="Listos para entrenar (≥60d)"
          value={
            readiness
              ? `${readiness.summary.ready_for_training}/${readiness.summary.total_items}`
              : '—'
          }
          subtext={
            readiness
              ? `Inferencia (≥30d): ${readiness.summary.ready_for_inference}`
              : 'Madurez histórica'
          }
          icon={<TrendChartIcon className="w-6 h-6" />}
          tone="green"
        />
        <KpiStatCard
          label="Último R² del modelo"
          value={latestR2}
          subtext="Métrica real de validación"
          icon={<TargetIcon className="w-6 h-6" />}
          tone="orange"
        />
      </div>

      {/* Explicación transparente del modelo ML */}
      <div className="alert-info flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <div className="flex items-start gap-2">
          <InfoCircleIcon className="w-4 h-4 text-[#C8102E] shrink-0 mt-0.5" />
          <span>
            Cada predicción combina variables históricas (rezagos y medias móviles) con el{' '}
            <strong>calendario operativo</strong> (feriados, días especiales y cierres), reportando
            su <strong>rango de incertidumbre (± RMSE)</strong> y métricas reales (MAE, RMSE, R²).
          </span>
        </div>
        {!canGenerate && (
          <span className="badge-blue shrink-0">Solo lectura — {activeBranch.name}</span>
        )}
      </div>

      {canGenerate && eligibleItems.length === 0 && !loading && (
        <div className="alert-warning">
          No hay materias primas activas con <code>eligible_for_ml = true</code>. Habilítalas en el
          catálogo de Materias Primas (solo Administrador).
        </div>
      )}

      {error && <div className="alert-error">{error}</div>}

      {/* Gráfico comparativo por unidad (sin mezclar escalas) */}
      {!loading && chartData.length > 0 && (
        <GradientPanel
          title={`Comparativa de consumo estimado (${selectedUnit})`}
          icon={<BarChartIcon className="w-5 h-5" />}
          actions={
            <div className="flex items-center gap-1.5 flex-wrap">
              {units.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setSelectedUnit(u)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                    selectedUnit === u
                      ? 'bg-white text-[#C8102E] shadow-sm'
                      : 'bg-white/15 text-white hover:bg-white/25'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          }
        >
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 24, right: 16, left: 4, bottom: 6 }}>
                <defs>
                  <linearGradient id="mlBar0" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#E52429" />
                    <stop offset="100%" stopColor="#B70726" />
                  </linearGradient>
                  <linearGradient id="mlBar1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFD129" />
                    <stop offset="100%" stopColor="#FF9800" />
                  </linearGradient>
                  <linearGradient id="mlBar2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFA726" />
                    <stop offset="100%" stopColor="#FF781F" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F2E7E1" />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={{ stroke: '#E5D8D2' }}
                  tick={{ fontSize: 11.5, fill: '#444444' }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: '#666666' }}
                  tickFormatter={(v) => `${v} ${selectedUnit}`}
                  width={62}
                />
                <Tooltip
                  cursor={{ fill: '#FFF4EF', opacity: 0.7 }}
                  formatter={(value: number, _n, props) => {
                    const row = props.payload as (typeof chartData)[number]
                    const range =
                      row.rangeMin != null && row.rangeMax != null
                        ? ` (rango ±RMSE: ${row.rangeMin.toFixed(1)}–${row.rangeMax.toFixed(1)} ${row.unit})`
                        : ''
                    return [`${value.toFixed(2)} ${row.unit}${range}`, row.fullName]
                  }}
                />
                <Bar dataKey="qty" radius={[10, 10, 0, 0]} maxBarSize={56}>
                  {chartData.map((d, i) => (
                    <Cell key={d.fullName} fill={`url(#mlBar${i % 3})`} />
                  ))}
                  <LabelList
                    dataKey="qty"
                    position="top"
                    formatter={(v: number) => `${v.toFixed(1)} ${selectedUnit}`}
                    style={{ fontSize: 11, fontWeight: 600, fill: '#333333' }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GradientPanel>
      )}

      {/* Historial de predicciones */}
      <GradientPanel
        title={`Historial de predicciones — ${activeBranch.name}`}
        icon={<TrendChartIcon className="w-5 h-5" />}
        bodyClassName="p-0"
        actions={
          canGenerate ? (
            <button
              type="button"
              onClick={() => {
                setShowForm(true)
                setReqError(null)
                setPredResult(null)
              }}
              className="inline-flex items-center gap-1.5 bg-[#B70726] hover:bg-[#99051F] text-white border border-white/25 rounded-[10px] px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-colors"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              Solicitar predicción
            </button>
          ) : undefined
        }
      >
        {loading ? (
          <PageSpinner label="Cargando predicciones ML…" />
        ) : predictions.length === 0 ? (
          <EmptyState
            icon={<TrendChartIcon className="w-6 h-6" />}
            title="No hay predicciones registradas para esta sucursal"
            description="Cuando existan modelos entrenados y ≥30 días de consumo diario validado podrás consultar y generar pronósticos aquí."
          />
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha objetivo</th>
                  <th>Materia prima</th>
                  <th>Estimación</th>
                  <th>Rango (± RMSE)</th>
                  <th>Métricas reales del modelo</th>
                  <th>Calculada</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3EAE6]">
                {predictions.map((p) => {
                  const item = allItemMap.get(p.item_id)
                  return (
                    <tr key={p.id}>
                      <td className="font-semibold text-[#222222]">{p.prediction_for_date}</td>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <ItemCategoryAvatar category={item?.category} itemType="materia_prima" />
                          <span className="font-medium text-[#222222]">
                            {item?.name ?? p.item_id}
                          </span>
                        </div>
                      </td>
                      <td className="font-bold text-[#C8102E]">
                        {p.predicted_quantity.toFixed(2)} {p.unit}
                      </td>
                      <td>
                        {p.range_min != null && p.range_max != null ? (
                          <span className="badge-yellow">
                            {p.range_min.toFixed(2)} – {p.range_max.toFixed(2)} {p.unit}
                          </span>
                        ) : (
                          <span className="text-[#888888]">—</span>
                        )}
                      </td>
                      <td className="text-xs text-[#555555]">
                        {p.mae != null || p.rmse != null ? (
                          <div className="space-y-0.5">
                            <div>
                              MAE: <strong>{p.mae?.toFixed(2) ?? '—'}</strong> · RMSE:{' '}
                              <strong>{p.rmse?.toFixed(2) ?? '—'}</strong> · R²:{' '}
                              <strong>{p.r2 != null ? p.r2.toFixed(3) : '—'}</strong>
                            </div>
                            {p.algorithm && (
                              <div className="text-[11px] text-[#888888]">{p.algorithm}</div>
                            )}
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="text-xs text-[#777777]">
                        {p.calculated_at ? new Date(p.calculated_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </GradientPanel>

      {/* Modal solicitar predicción (solo Admin y Gerente) */}
      {showForm && canGenerate && (
        <AppModal
          title="Solicitar predicción de consumo"
          subtitle={activeBranch.name}
          size="sm"
          onClose={() => setShowForm(false)}
        >
          <form onSubmit={handlePredict} className="space-y-4">
            <div>
              <label className="label">Materia prima elegible *</label>
              <select
                className="input"
                value={predItemId}
                onChange={(e) => setPredItemId(e.target.value)}
                required
              >
                <option value="">— Seleccionar —</option>
                {eligibleItems.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name} ({it.base_unit})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Fecha objetivo *</label>
              <input
                type="date"
                className="input"
                value={predDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setPredDate(e.target.value)}
                required
              />
            </div>

            {predResult && (
              <div
                className={
                  predResult.status === 'ok'
                    ? 'alert-success'
                    : predResult.status === 'datos_insuficientes'
                      ? 'alert-warning'
                      : 'alert-info'
                }
              >
                {predResult.status === 'ok' ? (
                  <div className="space-y-1.5">
                    <div>
                      <strong>Predicción estimada:</strong>{' '}
                      <span className="text-base font-bold">
                        {predResult.predicted_quantity?.toFixed(2)} {predResult.unit ?? ''}
                      </span>{' '}
                      ({predResult.prediction_for_date})
                    </div>
                    {predResult.range_min != null && predResult.range_max != null && (
                      <div className="text-xs font-medium">
                        Rango (± RMSE):{' '}
                        <strong>
                          {predResult.range_min.toFixed(2)} – {predResult.range_max.toFixed(2)}{' '}
                          {predResult.unit ?? ''}
                        </strong>
                      </div>
                    )}
                    <div className="text-xs">
                      Modelo: {predResult.algorithm ?? predResult.model_version} · MAE:{' '}
                      {predResult.mae?.toFixed(2) ?? '—'} · RMSE:{' '}
                      {predResult.rmse?.toFixed(2) ?? '—'} · R²:{' '}
                      {predResult.r2 != null ? predResult.r2.toFixed(3) : '—'}
                    </div>
                    <div className="text-[11px] opacity-80">
                      Datos conocidos hasta: {predResult.known_at}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs">
                    <strong>
                      {predResult.status === 'datos_insuficientes'
                        ? 'Datos insuficientes:'
                        : 'Sin modelo entrenado:'}
                    </strong>{' '}
                    {predResult.message}
                  </p>
                )}
              </div>
            )}

            {reqError && <p className="alert-error">{reqError}</p>}

            <div className="flex justify-end gap-2.5 pt-2 border-t border-[#F1E8E4]">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
                Cerrar
              </button>
              <button
                type="submit"
                disabled={requesting || eligibleItems.length === 0}
                className="btn-primary"
              >
                {requesting ? 'Calculando…' : 'Generar predicción'}
              </button>
            </div>
          </form>
        </AppModal>
      )}
    </div>
  )
}
