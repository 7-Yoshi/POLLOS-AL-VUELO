/**
 * Módulo M06 — Consumo Diario e Importación Histórica CSV (Problema 2).
 * - Distingue explícitamente 0.000 (consumo real cero) de "—" (DESCONOCIDO: falta de dato).
 * - Muestra progreso real hacia los 60 días mínimos de entrenamiento ML.
 * - Admin y Encargado registran e importan CSV; Gerente supervisa en solo lectura.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'

import {
  AlertTriangleIcon,
  ConsumptionClockIcon,
  DownloadIcon,
  FilterIcon,
  InfoCircleIcon,
  LayersIcon,
  PlusIcon,
  TrendChartIcon,
  UploadIcon,
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
import type {
  ConsumptionRecord,
  ConsumptionStatus,
  CsvImportResult,
  Item,
  MLReadinessResponse,
} from '../../types'

function emptyForm() {
  return {
    item_id: '',
    consumption_date: new Date().toISOString().split('T')[0],
    quantity_base: '',
    unit: '',
    status: 'medido' as ConsumptionStatus,
    method_notes: '',
  }
}

export default function ConsumptionPage() {
  const { currentUser } = useAuth()
  const { activeBranch } = useBranch()
  const canWrite = currentUser?.role === 'admin' || currentUser?.role === 'encargado'

  const [records, setRecords] = useState<ConsumptionRecord[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [readiness, setReadiness] = useState<MLReadinessResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [fromDate, setFromDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [toDate, setToDate] = useState(() => new Date().toISOString().split('T')[0])
  const [statusFilter, setStatusFilter] = useState<'all' | ConsumptionStatus>('all')
  const [itemFilter, setItemFilter] = useState('all')

  // Modal registro individual
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Modal importación CSV
  const [showImport, setShowImport] = useState(false)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<CsvImportResult | null>(null)

  const load = async () => {
    if (!activeBranch) return
    setLoading(true)
    setError(null)
    try {
      const [recRes, itemsRes, readyRes] = await Promise.all([
        api.get<ConsumptionRecord[]>('/api/v1/consumption/', {
          params: { branch_id: activeBranch.id, from_date: fromDate, to_date: toDate, limit: 250 },
        }),
        api.get<Item[]>('/api/v1/items/', { params: { item_type: 'materia_prima', limit: 200 } }),
        api.get<MLReadinessResponse>('/api/v1/consumption/readiness', {
          params: { branch_id: activeBranch.id },
        }),
      ])
      setRecords(recRes.data)
      setItems(itemsRes.data)
      setReadiness(readyRes.data)
    } catch {
      setError('Error al cargar registros de consumo diario.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [activeBranch?.id, fromDate, toDate])

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  const filtered = useMemo(() => {
    return records.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (itemFilter !== 'all' && r.item_id !== itemFilter) return false
      return true
    })
  }, [records, statusFilter, itemFilter])

  const validatedCount = useMemo(
    () => records.filter((r) => r.status !== 'desconocido').length,
    [records]
  )
  const unknownCount = useMemo(
    () => records.filter((r) => r.status === 'desconocido').length,
    [records]
  )

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!activeBranch) return
    if (!form.item_id || !form.unit) {
      setFormError('Selecciona materia prima y unidad.')
      return
    }
    if (form.status !== 'desconocido' && form.quantity_base === '') {
      setFormError('Ingresa la cantidad para estado confirmado.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await api.post('/api/v1/consumption/', {
        branch_id: activeBranch.id,
        item_id: form.item_id,
        consumption_date: form.consumption_date,
        quantity_base: form.status === 'desconocido' ? null : parseFloat(form.quantity_base),
        unit: form.unit,
        status: form.status,
        method_notes: form.method_notes || null,
      })
      setShowForm(false)
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setFormError(detail ?? 'Error al registrar el consumo.')
    } finally {
      setSaving(false)
    }
  }

  const handleDownloadTemplate = async () => {
    try {
      const response = await api.get('/api/v1/consumption/csv-template', { responseType: 'blob' })
      const url = URL.createObjectURL(response.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'plantilla_consumo_historico.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setImportError('No se pudo descargar la plantilla CSV.')
    }
  }

  const handleImportCsv = async (e: FormEvent) => {
    e.preventDefault()
    if (!activeBranch || !csvFile) {
      setImportError('Selecciona un archivo CSV.')
      return
    }
    setImporting(true)
    setImportError(null)
    setImportResult(null)
    try {
      const fd = new FormData()
      fd.append('branch_id', activeBranch.id)
      fd.append('file', csvFile)
      const { data } = await api.post<CsvImportResult>('/api/v1/consumption/import-csv', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setImportResult(data)
      if (data.rows_ok > 0) await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setImportError(detail ?? 'Error al importar el archivo CSV.')
    } finally {
      setImporting(false)
    }
  }

  if (!activeBranch) {
    return <div className="alert-warning">Selecciona una sucursal para ver el consumo diario.</div>
  }

  return (
    <div className="space-y-5">
      {/* KPIs reales */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiStatCard
          label="Registros en período"
          value={records.length}
          subtext={`${fromDate} a ${toDate}`}
          icon={<ConsumptionClockIcon className="w-6 h-6" />}
          tone="gold"
        />
        <KpiStatCard
          label="Validados / Medidos"
          value={validatedCount}
          subtext="Aptos para entrenamiento ML"
          icon={<LayersIcon className="w-6 h-6" />}
          tone="green"
        />
        <KpiStatCard
          label="Estado desconocido"
          value={unknownCount}
          subtext="Sin dato (no genera ceros)"
          icon={<AlertTriangleIcon className="w-6 h-6" />}
          tone="rose"
        />
        <KpiStatCard
          label="Listos para ML (≥60d)"
          value={readiness ? `${readiness.summary.ready_for_training}/${readiness.summary.total_items}` : '—'}
          subtext={
            readiness
              ? `Inferencia (≥30d): ${readiness.summary.ready_for_inference}`
              : 'Madurez histórica'
          }
          icon={<TrendChartIcon className="w-6 h-6" />}
          tone="purple"
          to="/predictions"
        />
      </div>

      {/* Nota semántica 0 vs Desconocido */}
      <div className="alert-info flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <div className="flex items-start gap-2">
          <InfoCircleIcon className="w-4 h-4 text-[#C8102E] shrink-0 mt-0.5" />
          <span>
            Si no se midió un día, regístralo como <strong>Desconocido</strong> (se muestra{' '}
            <code>—</code> y no se imputa como cero). Usa <strong>0.000</strong> únicamente cuando
            el consumo real fue cero. Alcanza <strong>60 días validados</strong> por materia prima
            para entrenar modelos ML.
          </span>
        </div>
        {!canWrite && <span className="badge-blue shrink-0">Supervisión (solo lectura)</span>}
      </div>

      {error && <div className="alert-error">{error}</div>}

      {/* Panel principal */}
      <GradientPanel
        title={`Consumo diario — ${activeBranch.name}`}
        icon={<ConsumptionClockIcon className="w-5 h-5" />}
        bodyClassName="p-0"
        actions={
          canWrite ? (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setShowImport(true)
                  setCsvFile(null)
                  setImportError(null)
                  setImportResult(null)
                }}
                className="inline-flex items-center gap-1.5 bg-white text-[#C8102E] hover:bg-[#FFF5F2] rounded-[10px] px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors"
              >
                <UploadIcon className="w-3.5 h-3.5" />
                Importar CSV
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(true)
                  setFormError(null)
                  setForm(emptyForm())
                }}
                className="inline-flex items-center gap-1.5 bg-[#B70726] hover:bg-[#99051F] text-white border border-white/25 rounded-[10px] px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-colors"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                Registrar consumo
              </button>
            </div>
          ) : undefined
        }
      >
        {/* Barra de filtros */}
        <div className="p-4 border-b border-[#F1E8E4] bg-[#FFFBF9] flex flex-wrap items-end gap-3 justify-between">
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
            <div>
              <label className="block text-[11px] font-medium text-[#666666] mb-1">
                Materia prima
              </label>
              <select
                className="input py-1.5 min-h-[38px] text-xs"
                value={itemFilter}
                onChange={(e) => setItemFilter(e.target.value)}
              >
                <option value="all">Todas</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="inline-flex items-center gap-1.5 bg-white border border-[#E2D9D5] rounded-[10px] px-3 py-1.5 text-xs font-medium text-[#333333]">
            <FilterIcon className="w-3.5 h-3.5 text-[#C8102E]" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | ConsumptionStatus)}
              className="bg-transparent focus:outline-none cursor-pointer"
            >
              <option value="all">Todos los estados</option>
              <option value="medido">Medido</option>
              <option value="calculado_validado">Calculado y validado</option>
              <option value="desconocido">Desconocido</option>
            </select>
          </label>
        </div>

        {loading ? (
          <PageSpinner label="Cargando registros de consumo…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<ConsumptionClockIcon className="w-6 h-6" />}
            title="Sin registros de consumo en este rango"
            description="Registra el consumo diario o carga un archivo histórico CSV para empezar a construir las series temporales."
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
                  <th>Notas del método</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3EAE6]">
                {filtered.map((r) => {
                  const item = itemMap.get(r.item_id)
                  return (
                    <tr key={r.id}>
                      <td className="font-semibold text-[#222222]">{r.consumption_date}</td>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <ItemCategoryAvatar category={item?.category} itemType="materia_prima" />
                          <span className="font-medium text-[#222222]">
                            {item?.name ?? r.item_id}
                          </span>
                        </div>
                      </td>
                      <td className="font-semibold">
                        {r.quantity_base != null ? (
                          r.quantity_base.toFixed(3)
                        ) : (
                          <span className="text-[#888888] font-normal">— (sin dato)</span>
                        )}
                      </td>
                      <td>{r.unit}</td>
                      <td>
                        <ConsStatusBadge status={r.status} />
                      </td>
                      <td className="text-xs text-[#666666] max-w-[240px] truncate">
                        {r.method_notes ?? '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </GradientPanel>

      {/* Modal registrar consumo individual */}
      {showForm && (
        <AppModal
          title="Registrar consumo diario"
          subtitle={activeBranch.name}
          onClose={() => setShowForm(false)}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Materia prima *</label>
                <select
                  className="input"
                  value={form.item_id}
                  onChange={(e) => {
                    const item = items.find((x) => x.id === e.target.value)
                    setForm((s) => ({
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
              <div>
                <label className="label">Fecha *</label>
                <input
                  type="date"
                  className="input"
                  value={form.consumption_date}
                  onChange={(e) => setForm((s) => ({ ...s, consumption_date: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="label">Estado del dato *</label>
                <select
                  className="input"
                  value={form.status}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, status: e.target.value as ConsumptionStatus }))
                  }
                >
                  <option value="medido">Medido</option>
                  <option value="calculado_validado">Calculado y validado</option>
                  <option value="desconocido">Desconocido (sin dato)</option>
                </select>
              </div>
              {form.status !== 'desconocido' && (
                <div>
                  <label className="label">Cantidad consumida *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    className="input"
                    value={form.quantity_base}
                    onChange={(e) => setForm((s) => ({ ...s, quantity_base: e.target.value }))}
                    required
                  />
                </div>
              )}
              <div>
                <label className="label">Unidad *</label>
                <input
                  className="input"
                  value={form.unit}
                  onChange={(e) => setForm((s) => ({ ...s, unit: e.target.value }))}
                  required
                />
              </div>
            </div>

            <div>
              <label className="label">Notas del método de medición</label>
              <input
                className="input"
                value={form.method_notes}
                onChange={(e) => setForm((s) => ({ ...s, method_notes: e.target.value }))}
                placeholder="Pesaje de cierre, conteo físico, etc."
              />
            </div>

            {formError && <p className="alert-error">{formError}</p>}

            <div className="flex justify-end gap-2.5 pt-2 border-t border-[#F1E8E4]">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Guardando…' : 'Registrar consumo'}
              </button>
            </div>
          </form>
        </AppModal>
      )}

      {/* Modal importación CSV */}
      {showImport && (
        <AppModal
          title="Importar consumo histórico CSV"
          subtitle={`${activeBranch.name} · Deduplicación automática por SHA-256`}
          onClose={() => setShowImport(false)}
        >
          <form onSubmit={handleImportCsv} className="space-y-4">
            <div className="alert-info text-xs space-y-2.5">
              <p>
                Columnas requeridas:{' '}
                <code className="bg-white/80 px-1.5 py-0.5 rounded font-mono text-[11px]">
                  fecha,codigo_item,cantidad_base,unidad,estado,notas
                </code>
                . El sistema valida cada fila y evita sobrescribir fechas ya registradas.
              </p>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="inline-flex items-center gap-1.5 font-semibold text-[#C8102E] hover:underline"
              >
                <DownloadIcon className="w-3.5 h-3.5" />
                Descargar plantilla CSV de ejemplo
              </button>
            </div>

            <div>
              <label className="label">Archivo CSV *</label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-[#333333] file:mr-4 file:py-2 file:px-4 file:rounded-[10px] file:border-0 file:text-xs file:font-semibold file:bg-[#FFF0E8] file:text-[#C8102E] hover:file:bg-[#FFE3D5] cursor-pointer"
                required
              />
            </div>

            {importResult && (
              <div
                className={
                  importResult.rows_ok > 0 ? 'alert-success space-y-1.5' : 'alert-warning space-y-1.5'
                }
              >
                <p className="text-xs">
                  <strong>Resultado:</strong> {importResult.rows_ok} de {importResult.rows_total}{' '}
                  filas importadas ({importResult.rows_rejected} rechazadas).
                </p>
                {importResult.errors.length > 0 && (
                  <ul className="list-disc pl-4 text-xs max-h-32 overflow-y-auto space-y-0.5">
                    {importResult.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {importError && <p className="alert-error">{importError}</p>}

            <div className="flex justify-end gap-2.5 pt-2 border-t border-[#F1E8E4]">
              <button type="button" onClick={() => setShowImport(false)} className="btn-secondary">
                Cerrar
              </button>
              <button type="submit" disabled={importing || !csvFile} className="btn-primary">
                <UploadIcon className="w-4 h-4" />
                {importing ? 'Importando…' : 'Subir e importar'}
              </button>
            </div>
          </form>
        </AppModal>
      )}
    </div>
  )
}

function ConsStatusBadge({ status }: { status: ConsumptionStatus }) {
  if (status === 'medido') return <span className="badge-green">Medido</span>
  if (status === 'calculado_validado') return <span className="badge-blue">Validado</span>
  return <span className="badge-gray">Desconocido</span>
}
