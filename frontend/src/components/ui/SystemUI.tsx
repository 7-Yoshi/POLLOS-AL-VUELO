/**
 * Componentes visuales reutilizables para todos los módulos de Pollos al Vuelo:
 *  - KpiStatCard (tarjetas pastel superiores)
 *  - GradientPanel (tarjetas con encabezado rojo-naranja degradado)
 *  - StockStatusPill (verde normal, amarillo bajo, rojo crítico, gris desconocido)
 *  - ItemCategoryAvatar (icono vectorial por categoría de materia prima / insumo)
 *  - AppModal (ventana modal coherente con encabezado degradado)
 *  - PageLoading / EmptyState
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  CloseXIcon,
  CubeIcon,
  SparkleDropIcon,
  SuppliesIcon,
} from './Icons'

export type KpiTone = 'gold' | 'rose' | 'orange' | 'purple' | 'green'

const KPI_TONE_STYLES: Record<KpiTone, { box: string; icon: string; pill: string }> = {
  gold: {
    box: 'bg-[#FFF5D6]',
    icon: 'text-[#D48A00]',
    pill: 'bg-[#FFF5D6] text-[#9A6700]',
  },
  rose: {
    box: 'bg-[#FDE6E6]',
    icon: 'text-[#C8102E]',
    pill: 'bg-[#FDE6E6] text-[#B70726]',
  },
  orange: {
    box: 'bg-[#FFEDE0]',
    icon: 'text-[#E8660C]',
    pill: 'bg-[#FFEDE0] text-[#B84A00]',
  },
  purple: {
    box: 'bg-[#F1E8FC]',
    icon: 'text-[#7C3AED]',
    pill: 'bg-[#F1E8FC] text-[#6D28D9]',
  },
  green: {
    box: 'bg-[#E5F6EC]',
    icon: 'text-[#177245]',
    pill: 'bg-[#E5F6EC] text-[#177245]',
  },
}

export function KpiStatCard({
  label,
  value,
  subtext,
  icon,
  tone = 'gold',
  to,
}: {
  label: string
  value: string | number
  subtext?: string
  icon: ReactNode
  tone?: KpiTone
  to?: string
}) {
  const styles = KPI_TONE_STYLES[tone]
  const inner = (
    <div className="bg-white rounded-[16px] border border-[#EFE4DF] px-4 py-4 flex items-center gap-3.5 transition-all hover:shadow-md hover:border-[#E8CFC4] h-full"
      style={{ boxShadow: '0 4px 16px -6px rgba(145, 62, 34, 0.08)' }}
    >
      <div className={`w-12 h-12 rounded-[13px] ${styles.box} ${styles.icon} flex items-center justify-center shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-[#555555] truncate">{label}</p>
        <p
          className={`font-bold text-[#222222] leading-tight mt-0.5 truncate ${
            typeof value === 'string' && value.length > 6
              ? 'text-[20px] xl:text-[24px]'
              : 'text-[26px] lg:text-[30px]'
          }`}
        >
          {value}
        </p>
        {subtext && (
          <span className={`inline-block mt-1 px-2 py-0.5 rounded-md text-[11px] font-medium ${styles.pill} truncate max-w-full`}>
            {subtext}
          </span>
        )}
      </div>
    </div>
  )

  return to ? <Link to={to} className="block h-full">{inner}</Link> : inner
}

export function GradientPanel({
  title,
  icon,
  actions,
  children,
  className = '',
  bodyClassName = 'p-5',
}: {
  title: string
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={`pav-surface overflow-hidden flex flex-col ${className}`}>
      <div className="pav-header-gradient px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-white">
        <div className="flex items-center gap-2.5 min-w-0">
          {icon && <span className="shrink-0 text-white/95">{icon}</span>}
          <h2 className="text-[16px] lg:text-[17px] font-semibold tracking-[-0.01em] truncate">
            {title}
          </h2>
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

export type StockHealth = 'normal' | 'low' | 'critical' | 'unknown'

export function computeStockHealth(
  balance: number | null | undefined,
  minStock: number | null | undefined
): StockHealth {
  if (balance == null) return 'unknown'
  if (minStock == null || minStock <= 0) {
    return balance <= 0 ? 'critical' : 'normal'
  }
  if (balance <= minStock * 0.5 || balance <= 0) return 'critical'
  if (balance < minStock) return 'low'
  return 'normal'
}

export function StockStatusPill({ status }: { status: StockHealth }) {
  if (status === 'normal') {
    return (
      <span className="badge-green">
        <span className="w-1.5 h-1.5 rounded-full bg-[#177245]" />
        Normal
      </span>
    )
  }
  if (status === 'low') {
    return (
      <span className="badge-yellow">
        <span className="w-1.5 h-1.5 rounded-full bg-[#D48A00]" />
        Stock bajo
      </span>
    )
  }
  if (status === 'critical') {
    return (
      <span className="badge-red">
        <span className="w-1.5 h-1.5 rounded-full bg-[#C8102E]" />
        Crítico
      </span>
    )
  }
  return (
    <span className="badge-gray">
      <span className="w-1.5 h-1.5 rounded-full bg-[#888888]" />
      Desconocido
    </span>
  )
}

export function ItemCategoryAvatar({
  category,
  itemType = 'materia_prima',
}: {
  category?: string | null
  itemType?: 'materia_prima' | 'insumo'
}) {
  const cat = (category ?? '').toLowerCase()
  if (itemType === 'insumo') {
    return (
      <span className="w-8 h-8 rounded-[9px] bg-[#FFEDE0] text-[#D95B00] inline-flex items-center justify-center shrink-0">
        <SuppliesIcon className="w-4 h-4" />
      </span>
    )
  }
  if (cat.includes('aceite') || cat.includes('grasa') || cat.includes('líquido') || cat.includes('liquido')) {
    return (
      <span className="w-8 h-8 rounded-[9px] bg-[#FFF5D6] text-[#C47F00] inline-flex items-center justify-center shrink-0">
        <SparkleDropIcon className="w-4 h-4" />
      </span>
    )
  }
  if (cat.includes('prot') || cat.includes('pollo') || cat.includes('carne')) {
    return (
      <span className="w-8 h-8 rounded-[9px] bg-[#FDE6E6] text-[#C8102E] inline-flex items-center justify-center shrink-0">
        <CubeIcon className="w-4 h-4" />
      </span>
    )
  }
  if (cat.includes('veg') || cat.includes('verdura') || cat.includes('papa')) {
    return (
      <span className="w-8 h-8 rounded-[9px] bg-[#E5F6EC] text-[#177245] inline-flex items-center justify-center shrink-0">
        <CubeIcon className="w-4 h-4" />
      </span>
    )
  }
  return (
    <span className="w-8 h-8 rounded-[9px] bg-[#FFF2E8] text-[#D95B00] inline-flex items-center justify-center shrink-0">
      <CubeIcon className="w-4 h-4" />
    </span>
  )
}

export function AppModal({
  title,
  subtitle,
  children,
  onClose,
  size = 'md',
}: {
  title: string
  subtitle?: string
  children: ReactNode
  onClose: () => void
  size?: 'sm' | 'md' | 'lg'
}) {
  const maxW =
    size === 'lg' ? 'max-w-2xl' : size === 'sm' ? 'max-w-md' : 'max-w-lg'

  return (
    <div
      className="fixed inset-0 bg-[#222222]/50 backdrop-blur-[2px] z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className={`bg-white rounded-[20px] shadow-2xl w-full ${maxW} max-h-[90vh] overflow-hidden flex flex-col border border-[#EFE4DF]`}>
        <div className="pav-header-gradient px-5 py-4 flex items-center justify-between text-white shrink-0">
          <div>
            <h3 className="text-[17px] font-semibold leading-tight">{title}</h3>
            {subtitle && <p className="text-xs text-white/85 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors"
            aria-label="Cerrar"
          >
            <CloseXIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

export function PageSpinner({ label = 'Cargando datos…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="w-9 h-9 border-[3px] border-[#C8102E] border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-[#666666]">{label}</p>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="py-10 px-4 text-center flex flex-col items-center justify-center gap-2">
      {icon && (
        <div className="w-12 h-12 rounded-2xl bg-[#FFF4EF] text-[#C8102E] flex items-center justify-center mb-1">
          {icon}
        </div>
      )}
      <p className="text-[15px] font-semibold text-[#222222]">{title}</p>
      {description && <p className="text-[13px] text-[#666666] max-w-md">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
