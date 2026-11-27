/**
 * Módulo M07 — Calendario de Operación (feriados, bloqueos, cierres y días especiales).
 * - Solo Admin y Gerente pueden consultar, crear y eliminar eventos operativos.
 * - Incluye vista de calendario mensual interactivo + lista detallada del mes + tabla completa.
 * - Los eventos alimentan directamente las variables calendario del modelo predictivo ML.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'

import {
  CalendarOpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  InfoCircleIcon,
  PlusIcon,
  TrashIcon,
} from '../../components/ui/Icons'
import {
  AppModal,
  EmptyState,
  GradientPanel,
  KpiStatCard,
  PageSpinner,
} from '../../components/ui/SystemUI'
import { useBranch } from '../../contexts/BranchContext'
import api from '../../lib/api'
import type { EventType, OperationEvent } from '../../types'

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

const EVENT_META: Record<
  EventType,
  { label: string; badge: string; cellBg: string; dot: string }
> = {
  feriado: {
    label: 'Feriado',
    badge: 'badge-red',
    cellBg: 'bg-[#FCE4E4] text-[#B70726] border-[#F6B8B8]',
    dot: 'bg-[#C8102E]',
  },
  bloqueo: {
    label: 'Bloqueo',
    badge: 'badge-blue',
    cellBg: 'bg-[#FFEDE0] text-[#B84A00] border-[#F7CCA8]',
    dot: 'bg-[#FF781F]',
  },
  cierre: {
    label: 'Cierre',
    badge: 'badge-yellow',
    cellBg: 'bg-[#FFF3CD] text-[#9A6700] border-[#F2D57B]',
    dot: 'bg-[#D48A00]',
  },
  dia_especial: {
    label: 'Día especial',
    badge: 'badge-purple',
    cellBg: 'bg-[#F0E6FA] text-[#6B21A8] border-[#D8B4FE]',
    dot: 'bg-[#7C3AED]',
  },
}

function toIsoDate(year: number, month0: number, day: number): string {
  return `${year}-${String(month0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function emptyForm(branchId?: string, dateIso?: string) {
  const target = dateIso ?? new Date().toISOString().split('T')[0]
  return {
    branch_id: branchId ?? '',
    event_type: 'feriado' as EventType,
    name: '',
    start_date: target,
    end_date: target,
    description: '',
  }
}

export default function OperationsPage() {
  const { activeBranch, branches } = useBranch()

  const [events, setEvents] = useState<OperationEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const now = new Date()
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth())
  const [selectedIso, setSelectedIso] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm(activeBranch?.id))
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [confirmDelete, setConfirmDelete] = useState<OperationEvent | null>(null)
  const [deleting, setDeleting] = useState(false)

  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get<OperationEvent[]>('/api/v1/operations/events', {
        params: { branch_id: activeBranch?.id, limit: 200 },
      })
      setEvents(data)
    } catch {
      setError('Error al cargar el calendario de operación.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [activeBranch?.id])

  const counts = useMemo(() => {
    const byType: Record<EventType, number> = {
      feriado: 0,
      bloqueo: 0,
      cierre: 0,
      dia_especial: 0,
    }
    for (const ev of events) {
      byType[ev.event_type] = (byType[ev.event_type] ?? 0) + 1
    }
    return byType
  }, [events])

  const calendarCells = useMemo(() => {
    const first = new Date(calYear, calMonth, 1)
    const offset = (first.getDay() + 6) % 7
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
    const daysInPrev = new Date(calYear, calMonth, 0).getDate()

    const list: Array<{ iso: string; day: number; inMonth: boolean; dayEvents: OperationEvent[] }> = []

    const getEventsFor = (iso: string) =>
      events.filter((ev) => ev.start_date <= iso && ev.end_date >= iso)

    for (let i = offset - 1; i >= 0; i--) {
      const d = daysInPrev - i
      const pm = calMonth === 0 ? 11 : calMonth - 1
      const py = calMonth === 0 ? calYear - 1 : calYear
      const iso = toIsoDate(py, pm, d)
      list.push({ iso, day: d, inMonth: false, dayEvents: getEventsFor(iso) })
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = toIsoDate(calYear, calMonth, d)
      list.push({ iso, day: d, inMonth: true, dayEvents: getEventsFor(iso) })
    }
    const rem = (7 - (list.length % 7)) % 7
    for (let d = 1; d <= rem; d++) {
      const nm = calMonth === 11 ? 0 : calMonth + 1
      const ny = calMonth === 11 ? calYear + 1 : calYear
      const iso = toIsoDate(ny, nm, d)
      list.push({ iso, day: d, inMonth: false, dayEvents: getEventsFor(iso) })
    }
    return list
  }, [calYear, calMonth, events])

  const visibleSideEvents = useMemo(() => {
    if (selectedIso) {
      return events.filter((ev) => ev.start_date <= selectedIso && ev.end_date >= selectedIso)
    }
    const firstIso = toIsoDate(calYear, calMonth, 1)
    const lastIso = toIsoDate(calYear, calMonth, new Date(calYear, calMonth + 1, 0).getDate())
    return events
      .filter((ev) => ev.end_date >= firstIso && ev.start_date <= lastIso)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
  }, [events, selectedIso, calYear, calMonth])

  const openCreateModal = (dateIso?: string) => {
    setForm(emptyForm(activeBranch?.id ?? branches[0]?.id, dateIso))
    setFormError(null)
    setShowForm(true)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.branch_id || !form.name.trim() || !form.start_date || !form.end_date) {
      setFormError('Completa todos los campos obligatorios.')
      return
    }
    if (form.start_date > form.end_date) {
      setFormError('La fecha de inicio debe ser anterior o igual a la fecha de fin.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await api.post('/api/v1/operations/events', {
        branch_id: form.branch_id,
        event_type: form.event_type,
        name: form.name.trim(),
        start_date: form.start_date,
        end_date: form.end_date,
        description: form.description.trim() || null,
      })
      setShowForm(false)
      await load()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setFormError(detail ?? 'Error al registrar el evento.')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await api.delete(`/api/v1/operations/events/${confirmDelete.id}`)
      setConfirmDelete(null)
      await load()
    } catch {
      setError('No se pudo eliminar el evento.')
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const todayIso = new Date().toISOString().split('T')[0]

  return (
    <div className="space-y-5">
      {/* KPIs de eventos */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiStatCard
          label="Feriados"
          value={counts.feriado}
          subtext="Eventos registrados"
          icon={<CalendarOpIcon className="w-6 h-6" />}
          tone="rose"
        />
        <KpiStatCard
          label="Bloqueos"
          value={counts.bloqueo}
          subtext="Incidencias viales / zona"
          icon={<CalendarOpIcon className="w-6 h-6" />}
          tone="orange"
        />
        <KpiStatCard
          label="Cierres programados"
          value={counts.cierre}
          subtext="Sin atención al público"
          icon={<CalendarOpIcon className="w-6 h-6" />}
          tone="gold"
        />
        <KpiStatCard
          label="Días especiales"
          value={counts.dia_especial}
          subtext="Alta demanda / promociones"
          icon={<CalendarOpIcon className="w-6 h-6" />}
          tone="purple"
        />
      </div>

      <div className="alert-info flex items-start gap-2.5 text-[13px]">
        <InfoCircleIcon className="w-4 h-4 text-[#C8102E] shrink-0 mt-0.5" />
        <span>
          Un <strong>feriado</strong> no implica cierre automático. Registra los eventos conocidos con
          anticipación para enriquecer las variables del modelo predictivo ML sin introducir fuga de
          datos futura.
        </span>
      </div>

      {error && <div className="alert-error">{error}</div>}

      {/* Vista principal: Calendario mensual (7 col) + Panel del mes/día (5 col) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <GradientPanel
          className="xl:col-span-7"
          title={`Calendario operativo — ${activeBranch?.name ?? 'Todas las sucursales'}`}
          icon={<CalendarOpIcon className="w-5 h-5" />}
          actions={
            <button
              type="button"
              onClick={() => openCreateModal(selectedIso ?? undefined)}
              className="inline-flex items-center gap-1.5 bg-[#B70726] hover:bg-[#99051F] text-white border border-white/25 rounded-[10px] px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-colors"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              Agregar evento
            </button>
          }
        >
          {/* Navegación mes/año + leyenda */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedIso(null)
                  if (calMonth === 0) {
                    setCalMonth(11)
                    setCalYear((y) => y - 1)
                  } else {
                    setCalMonth((m) => m - 1)
                  }
                }}
                className="w-8 h-8 rounded-lg border border-[#EAE0DC] hover:bg-[#FFF3EC] text-[#444444] flex items-center justify-center"
                aria-label="Mes anterior"
              >
                <ChevronLeftIcon className="w-4 h-4" />
              </button>
              <span className="text-[16px] font-bold text-[#222222] min-w-[155px] text-center">
                {MONTHS_ES[calMonth]} {calYear}
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedIso(null)
                  if (calMonth === 11) {
                    setCalMonth(0)
                    setCalYear((y) => y + 1)
                  } else {
                    setCalMonth((m) => m + 1)
                  }
                }}
                className="w-8 h-8 rounded-lg border border-[#EAE0DC] hover:bg-[#FFF3EC] text-[#444444] flex items-center justify-center"
                aria-label="Mes siguiente"
              >
                <ChevronRightIcon className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-3 flex-wrap text-[11.5px] text-[#555555]">
              {(Object.keys(EVENT_META) as EventType[]).map((type) => (
                <span key={type} className="inline-flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${EVENT_META[type].dot}`} />
                  {EVENT_META[type].label}
                </span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-semibold text-[#777777] bg-[#FAF5F2] rounded-xl py-2 mb-2">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {calendarCells.map((cell) => {
              const firstEv = cell.dayEvents[0]
              const isSelected = selectedIso === cell.iso
              const isToday = cell.iso === todayIso
              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => setSelectedIso(isSelected ? null : cell.iso)}
                  className={`min-h-[54px] rounded-xl p-1.5 border text-left flex flex-col justify-between transition-all ${
                    isSelected
                      ? 'border-[#C8102E] ring-2 ring-[#C8102E]/20 bg-[#FFF5F2]'
                      : firstEv
                        ? EVENT_META[firstEv.event_type].cellBg
                        : isToday
                          ? 'bg-[#FFF7DF] border-[#F5C542] text-[#8A5A00]'
                          : cell.inMonth
                            ? 'bg-white border-[#F2E9E4] hover:border-[#E4C7BC] text-[#222222]'
                            : 'bg-[#FAF7F5] border-transparent text-[#BDB2AE]'
                  }`}
                >
                  <span className="text-xs font-semibold leading-none">{cell.day}</span>
                  {cell.dayEvents.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap mt-1">
                      {cell.dayEvents.slice(0, 3).map((ev) => (
                        <span
                          key={ev.id}
                          className={`w-2 h-2 rounded-full ${EVENT_META[ev.event_type].dot}`}
                          title={ev.name}
                        />
                      ))}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </GradientPanel>

        {/* Lista contextual del día / mes */}
        <GradientPanel
          className="xl:col-span-5"
          title={
            selectedIso
              ? `Eventos del ${selectedIso}`
              : `Eventos de ${MONTHS_ES[calMonth]} ${calYear}`
          }
          icon={<CalendarOpIcon className="w-5 h-5" />}
          actions={
            selectedIso ? (
              <button
                type="button"
                onClick={() => setSelectedIso(null)}
                className="text-xs bg-white/15 hover:bg-white/25 text-white px-2.5 py-1 rounded-full"
              >
                Ver todo el mes
              </button>
            ) : undefined
          }
        >
          {loading ? (
            <PageSpinner label="Cargando eventos…" />
          ) : visibleSideEvents.length === 0 ? (
            <EmptyState
              icon={<CalendarOpIcon className="w-6 h-6" />}
              title="Sin eventos registrados"
              description={
                selectedIso
                  ? `No hay eventos programados para el ${selectedIso}.`
                  : `No hay eventos registrados en ${MONTHS_ES[calMonth].toLowerCase()} ${calYear}.`
              }
              action={
                <button
                  type="button"
                  onClick={() => openCreateModal(selectedIso ?? undefined)}
                  className="btn-primary text-xs py-2 px-3.5"
                >
                  <PlusIcon className="w-3.5 h-3.5" />
                  Registrar evento
                </button>
              }
            />
          ) : (
            <ul className="space-y-2.5">
              {visibleSideEvents.map((ev) => (
                <li
                  key={ev.id}
                  className="p-3.5 rounded-xl border border-[#F0E4DF] bg-[#FFFBF9] flex items-start justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={EVENT_META[ev.event_type].badge}>
                        {EVENT_META[ev.event_type].label}
                      </span>
                      <span className="text-xs font-medium text-[#666666]">
                        {ev.start_date === ev.end_date
                          ? ev.start_date
                          : `${ev.start_date} → ${ev.end_date}`}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-[#222222]">{ev.name}</p>
                    {ev.description && (
                      <p className="text-xs text-[#666666]">{ev.description}</p>
                    )}
                    <p className="text-[11px] text-[#888888]">
                      Sucursal: {branchMap.get(ev.branch_id)?.name ?? ev.branch_id}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(ev)}
                    title="Eliminar evento"
                    className="w-8 h-8 rounded-lg border border-[#EAE0DC] hover:border-[#B70726] hover:bg-[#FFF0F0] text-[#777777] hover:text-[#B70726] flex items-center justify-center shrink-0 transition-colors"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </GradientPanel>
      </div>

      {/* Tabla cronológica completa */}
      <GradientPanel
        title="Todos los eventos registrados"
        icon={<CalendarOpIcon className="w-5 h-5" />}
        bodyClassName="p-0"
      >
        {loading ? (
          <PageSpinner label="Cargando historial de eventos…" />
        ) : events.length === 0 ? (
          <EmptyState
            title="Aún no hay eventos en el calendario"
            description="Los feriados, bloqueos, cierres y días especiales aparecerán listados aquí."
          />
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Tipo</th>
                  <th>Sucursal</th>
                  <th>Inicio</th>
                  <th>Fin</th>
                  <th>Descripción</th>
                  <th className="text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3EAE6]">
                {events.map((ev) => (
                  <tr key={ev.id}>
                    <td className="font-semibold text-[#222222]">{ev.name}</td>
                    <td>
                      <span className={EVENT_META[ev.event_type].badge}>
                        {EVENT_META[ev.event_type].label}
                      </span>
                    </td>
                    <td>{branchMap.get(ev.branch_id)?.name ?? ev.branch_id}</td>
                    <td>{ev.start_date}</td>
                    <td>{ev.end_date}</td>
                    <td className="text-xs text-[#666666] max-w-[240px] truncate">
                      {ev.description ?? '—'}
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(ev)}
                        className="w-8 h-8 rounded-lg border border-[#EAE0DC] hover:border-[#B70726] hover:bg-[#FFF0F0] text-[#777777] hover:text-[#B70726] inline-flex items-center justify-center transition-colors"
                        title="Eliminar"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GradientPanel>

      {/* Modal crear evento */}
      {showForm && (
        <AppModal
          title="Nuevo evento de operación"
          subtitle="Se incorporará al calendario y a las variables predictivas ML."
          onClose={() => setShowForm(false)}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Sucursal *</label>
              <select
                className="input"
                value={form.branch_id}
                onChange={(e) => setForm((s) => ({ ...s, branch_id: e.target.value }))}
                required
              >
                <option value="">— Seleccionar —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Tipo de evento *</label>
                <select
                  className="input"
                  value={form.event_type}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, event_type: e.target.value as EventType }))
                  }
                  required
                >
                  <option value="feriado">Feriado</option>
                  <option value="bloqueo">Bloqueo</option>
                  <option value="cierre">Cierre</option>
                  <option value="dia_especial">Día especial</option>
                </select>
              </div>
              <div>
                <label className="label">Nombre *</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                  placeholder="ej. Feriado nacional, Día de la Madre…"
                  required
                />
              </div>
              <div>
                <label className="label">Fecha inicio *</label>
                <input
                  type="date"
                  className="input"
                  value={form.start_date}
                  onChange={(e) => setForm((s) => ({ ...s, start_date: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="label">Fecha fin *</label>
                <input
                  type="date"
                  className="input"
                  value={form.end_date}
                  onChange={(e) => setForm((s) => ({ ...s, end_date: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div>
              <label className="label">Descripción</label>
              <textarea
                className="input"
                rows={2}
                value={form.description}
                onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
                placeholder="Detalle operativo del impacto esperado…"
              />
            </div>

            {formError && <p className="alert-error">{formError}</p>}

            <div className="flex justify-end gap-2.5 pt-2 border-t border-[#F1E8E4]">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? 'Guardando…' : 'Crear evento'}
              </button>
            </div>
          </form>
        </AppModal>
      )}

      {/* Modal confirmar eliminación */}
      {confirmDelete && (
        <AppModal
          title="Eliminar evento"
          size="sm"
          onClose={() => setConfirmDelete(null)}
        >
          <div className="space-y-4">
            <p className="text-sm text-[#333333]">
              ¿Deseas eliminar <strong>{confirmDelete.name}</strong> ({confirmDelete.start_date}) del
              calendario operativo?
            </p>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="btn-secondary"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="btn-danger"
              >
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </AppModal>
      )}
    </div>
  )
}
