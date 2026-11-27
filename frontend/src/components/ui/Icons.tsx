/**
 * Biblioteca unificada de iconos lineales SVG para todo el sistema Pollos al Vuelo.
 * Cero emojis en navegación, tarjetas, encabezados, tablas ni botones.
 */
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const base: IconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.85,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

export function HomeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5.5 9.5V20a1 1 0 0 0 1 1h4v-6h3v6h4a1 1 0 0 0 1-1V9.5" />
    </svg>
  )
}

export function UsersGroupIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 19.5c0-3 2.9-5.5 6.5-5.5s6.5 2.5 6.5 5.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M17.5 14c2.4.4 4 2.2 4 4.8" />
    </svg>
  )
}

export function CubeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 2.8L20 7.2v9.6l-8 4.4-8-4.4V7.2L12 2.8Z" />
      <path d="M12 12l8-4.8" />
      <path d="M12 12L4 7.2" />
      <path d="M12 12v9.2" />
    </svg>
  )
}

export function SuppliesIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6.5 15.5V19h11v-3.5" />
      <path d="M5 15.5h14a3 3 0 0 0 .5-5.95A4.2 4.2 0 0 0 12 6a4.2 4.2 0 0 0-7.5 3.55A3 3 0 0 0 5 15.5Z" />
    </svg>
  )
}

export function CartIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="19.5" r="1.5" />
      <circle cx="17.5" cy="19.5" r="1.5" />
      <path d="M3 4h2.5l2.2 10.5a1.5 1.5 0 0 0 1.47 1.2h8.53a1.5 1.5 0 0 0 1.46-1.16L21 7.5H6.3" />
    </svg>
  )
}

export function InventoryBoxesIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="8" y="3.5" width="8" height="6.5" rx="1.2" />
      <rect x="3" y="13.5" width="7.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="13.5" width="7.5" height="6.5" rx="1.2" />
      <path d="M12 10v3.5" />
    </svg>
  )
}

export function ConsumptionClockIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  )
}

export function CalendarOpIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.2" />
      <path d="M3.5 10h17" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M8 14h2M14 14h2M8 17.5h2M14 17.5h2" />
    </svg>
  )
}

export function TrendChartIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 19h16" />
      <path d="M6 15v4" />
      <path d="M10.5 12v7" />
      <path d="M15 9.5v9.5" />
      <path d="M19 6v13" />
      <path d="M5 10.5L10.5 6.5l3.5 2L19 4" />
    </svg>
  )
}

export function BarChartIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="13" width="3.5" height="7" rx="1" />
      <rect x="10.25" y="8.5" width="3.5" height="11.5" rx="1" />
      <rect x="16.5" y="4.5" width="3.5" height="15.5" rx="1" />
    </svg>
  )
}

export function ReportDocIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 3.5h8.5L19 8v12.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" />
      <path d="M14 3.5V8.5h5" />
      <path d="M8.5 12.5h7M8.5 16h5" />
    </svg>
  )
}

export function ShieldAuditIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3l7 3v5.5c0 4.6-3 8.1-7 9.5-4-1.4-7-4.9-7-9.5V6l7-3Z" />
      <path d="M9.2 12.2l2 2 3.8-4.1" />
    </svg>
  )
}

export function BranchStoreIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 9.5V20h16V9.5" />
      <path d="M3 9.5L4.8 4.5h14.4L21 9.5a2.5 2.5 0 0 1-4.5 1.5 2.5 2.5 0 0 1-4.5 0 2.5 2.5 0 0 1-4.5 0A2.5 2.5 0 0 1 3 9.5Z" />
      <path d="M9.5 20v-5.5h5V20" />
    </svg>
  )
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6.5h16M4 12h16M4 17.5h16" />
    </svg>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </svg>
  )
}

export function BellIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6.5 9.5a5.5 5.5 0 1 1 11 0c0 4 1.5 5.5 2 6H4.5c.5-.5 2-2 2-6Z" />
      <path d="M10 18.5a2 2 0 0 0 4 0" />
    </svg>
  )
}

export function AlertTriangleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10.4 4.3L3.1 17.2a1.8 1.8 0 0 0 1.6 2.7h14.6a1.8 1.8 0 0 0 1.6-2.7L13.6 4.3a1.8 1.8 0 0 0-3.2 0Z" />
      <path d="M12 9.5v4.2" />
      <circle cx="12" cy="16.6" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function LayersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5L3 8l9 4.5L21 8l-9-4.5Z" />
      <path d="M3 12.5L12 17l9-4.5" />
      <path d="M3 16.5L12 21l9-4.5" />
    </svg>
  )
}

export function FilterIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 5h16l-6.2 7.2v5.3l-3.6 1.8v-7.1L4 5Z" />
    </svg>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function EditPencilIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M16.5 4.5l3 3L8.5 18.5 4.5 19.5l1-4 11-11Z" />
    </svg>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7" />
      <path d="M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.3h6a1.5 1.5 0 0 0 1.5-1.3L17.5 7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

export function UploadIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 16V5" />
      <path d="M7.5 9.5L12 5l4.5 4.5" />
      <path d="M4 17.5v1.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-1.5" />
    </svg>
  )
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4v11" />
      <path d="M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4 17.5v1.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-1.5" />
    </svg>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

export function InfoCircleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function LogOutIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M15 17l5-5-5-5" />
      <path d="M20 12H9" />
      <path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6" />
    </svg>
  )
}

export function MapPinIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 1 0-13 0c0 5.4 6.5 11 6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  )
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20 12a8 8 0 1 1-2.3-5.6L20 8.5" />
      <path d="M20 4v4.5h-4.5" />
    </svg>
  )
}

export function TargetIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function EyeViewIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.7" />
    </svg>
  )
}

export function CloseXIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function SparkleDropIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5C9.2 7.5 6.5 10.6 6.5 14a5.5 5.5 0 0 0 11 0c0-3.4-2.7-6.5-5.5-10.5Z" />
    </svg>
  )
}
