/**
 * Layout principal reutilizable de Pollos al Vuelo.
 * Reproduce la arquitectura visual corporativa (menú lateral cálido con degradado superior,
 * ondas inferiores decorativas, barra superior blanca con buscador, alertas reales de stock
 * y perfil de usuario real) conservando el filtrado estricto de rutas por rol (RBAC).
 */
import { useEffect, useRef, useState, type ComponentType, type FormEvent, type SVGProps } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import pollosLogo from '../assets/login/pollos-logo-official.png'
import pollosMascot from '../assets/login/pollos-mascot-running.png'
import {
  BellIcon,
  BranchStoreIcon,
  CalendarOpIcon,
  CartIcon,
  ChevronDownIcon,
  CloseXIcon,
  ConsumptionClockIcon,
  CubeIcon,
  HomeIcon,
  InventoryBoxesIcon,
  LogOutIcon,
  MapPinIcon,
  MenuIcon,
  ReportDocIcon,
  SearchIcon,
  ShieldAuditIcon,
  SuppliesIcon,
  TrendChartIcon,
  UsersGroupIcon,
} from '../components/ui/Icons'
import { computeStockHealth, StockStatusPill, type StockHealth } from '../components/ui/SystemUI'
import { useAuth } from '../contexts/AuthContext'
import { useBranch } from '../contexts/BranchContext'
import api from '../lib/api'
import type { InventoryBalance, Item, UserRole } from '../types'

interface NavEntry {
  to: string
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  roles: UserRole[]
  alsoActiveOn?: string[]
}

const NAV_ITEMS: NavEntry[] = [
  { to: '/',            label: 'Panel principal',         icon: HomeIcon,             roles: ['admin', 'gerente', 'encargado'] },
  { to: '/users',       label: 'Usuarios y sucursales',   icon: UsersGroupIcon,       roles: ['admin'], alsoActiveOn: ['/branches'] },
  { to: '/branches',    label: 'Sucursales',              icon: BranchStoreIcon,      roles: ['gerente'] },
  { to: '/items',       label: 'Materias primas',         icon: CubeIcon,             roles: ['admin', 'gerente', 'encargado'] },
  { to: '/insumos',     label: 'Insumos',                 icon: SuppliesIcon,         roles: ['admin', 'gerente', 'encargado'] },
  { to: '/purchases',   label: 'Compras',                 icon: CartIcon,             roles: ['admin', 'gerente', 'encargado'] },
  { to: '/inventory',   label: 'Inventario',              icon: InventoryBoxesIcon,   roles: ['admin', 'gerente', 'encargado'] },
  { to: '/consumption', label: 'Consumo',                 icon: ConsumptionClockIcon, roles: ['admin', 'gerente', 'encargado'] },
  { to: '/operations',  label: 'Calendario de operación', icon: CalendarOpIcon,       roles: ['admin', 'gerente'] },
  { to: '/predictions', label: 'Predicción ML',           icon: TrendChartIcon,       roles: ['admin', 'gerente', 'encargado'] },
  { to: '/reports',     label: 'Reportes',                icon: ReportDocIcon,        roles: ['admin', 'gerente'] },
  { to: '/audit',       label: 'Auditoría',               icon: ShieldAuditIcon,      roles: ['admin', 'gerente'] },
]

const PAGE_TITLES: Array<{ path: string; title: string }> = [
  { path: '/items',       title: 'Gestión de Materia Prima' },
  { path: '/insumos',     title: 'Gestión de Insumos' },
  { path: '/purchases',   title: 'Registro de Compras' },
  { path: '/inventory',   title: 'Control de Inventario' },
  { path: '/consumption', title: 'Consumo Diario' },
  { path: '/operations',  title: 'Calendario de Operación' },
  { path: '/predictions', title: 'Predicción de Demanda ML' },
  { path: '/reports',     title: 'Reportes y Consolidado' },
  { path: '/audit',       title: 'Auditoría del Sistema' },
  { path: '/users',       title: 'Usuarios y Sucursales' },
  { path: '/branches',    title: 'Sucursales' },
  { path: '/',            title: 'Panel Principal' },
]

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  encargado: 'Encargado de sucursal',
}

interface StockAlertItem {
  item_id: string
  name: string
  balance: number
  min_stock: number | null
  unit: string
  status: StockHealth
}

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'PV'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function SidebarTopArtwork({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={`relative w-full overflow-hidden shrink-0 select-none ${
        collapsed ? 'h-[86px]' : 'h-[178px]'
      }`}
    >
      <svg
        viewBox="0 0 260 184"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="pavSidebarTopGrad" x1="0%" y1="0%" x2="90%" y2="100%">
            <stop offset="0%" stopColor="#B70726" />
            <stop offset="32%" stopColor="#D81A27" />
            <stop offset="68%" stopColor="#FF781F" />
            <stop offset="100%" stopColor="#FFD129" />
          </linearGradient>
          <radialGradient id="pavLogoGlow" cx="50%" cy="62%" r="48%">
            <stop offset="0%" stopColor="#FFF7DE" stopOpacity="0.92" />
            <stop offset="65%" stopColor="#FFE08C" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#FF9B3D" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Base degradado rojo → naranja → amarillo */}
        <path
          d="M0,0 L260,0 L260,136 C215,170 155,176 92,162 C44,151 16,158 0,174 Z"
          fill="url(#pavSidebarTopGrad)"
        />

        {/* Curva decorativa rojo profundo esquina superior izquierda */}
        <path
          d="M0,0 L118,0 C90,42 46,66 0,74 Z"
          fill="#A10620"
          fillOpacity="0.45"
        />

        {/* Nubes suaves laterales */}
        <path
          d="M-8,84 C6,72 28,74 36,86 C46,85 54,93 52,102 L-8,102 Z"
          fill="#FFBF70"
          fillOpacity="0.34"
        />
        <path
          d="M214,62 C226,48 250,48 266,62 L266,82 L208,82 C206,74 209,66 214,62 Z"
          fill="#FFD17A"
          fillOpacity="0.34"
        />

        {/* Halo cálido para que el logotipo oficial resalte con máxima nitidez */}
        {!collapsed && <ellipse cx="130" cy="108" rx="108" ry="62" fill="url(#pavLogoGlow)" />}

        {/* Onda inferior cálida suave que integra con #FFFCFA */}
        <path
          d="M0,162 C44,142 104,158 164,156 C208,154 238,140 260,126 L260,184 L0,184 Z"
          fill="#FFE8B5"
          fillOpacity="0.45"
        />
        <path
          d="M0,172 C52,150 112,168 176,164 C216,161 242,148 260,138 L260,184 L0,184 Z"
          fill="#FFFCFA"
        />
      </svg>

      <div className="relative z-10 h-full flex items-center justify-center px-3 pb-3">
        {collapsed ? (
          <img
            src={pollosMascot}
            alt="Pollos al Vuelo"
            className="h-12 w-auto object-contain drop-shadow-sm"
          />
        ) : (
          <img
            src={pollosLogo}
            alt="Pollos al Vuelo"
            className="h-[132px] w-auto object-contain drop-shadow-[0_3px_6px_rgba(120,25,15,0.18)]"
          />
        )}
      </div>
    </div>
  )
}

function SidebarBottomWaves({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={`relative w-full overflow-hidden shrink-0 pointer-events-none select-none ${
        collapsed ? 'h-[42px]' : 'h-[82px]'
      }`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 260 88"
        preserveAspectRatio="none"
        className="w-full h-full block"
      >
        <defs>
          <linearGradient id="pavWaveGold" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFD84D" />
            <stop offset="55%" stopColor="#FFA726" />
            <stop offset="100%" stopColor="#FF781F" />
          </linearGradient>
          <linearGradient id="pavWaveOrange" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#FF781F" />
            <stop offset="60%" stopColor="#F24726" />
            <stop offset="100%" stopColor="#E52429" />
          </linearGradient>
        </defs>
        <path
          d="M0,36 C56,10 116,50 184,26 C218,14 242,8 260,4 L260,88 L0,88 Z"
          fill="url(#pavWaveGold)"
        />
        <path
          d="M0,58 C66,34 128,74 202,48 C228,38 246,32 260,28 L260,88 L0,88 Z"
          fill="url(#pavWaveOrange)"
          fillOpacity="0.92"
        />
      </svg>
    </div>
  )
}

export default function AppLayout() {
  const { currentUser, signOut } = useAuth()
  const { branches, activeBranch, setActiveBranch } = useBranch()
  const location = useLocation()
  const navigate = useNavigate()

  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const [alertsOpen, setAlertsOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [stockAlerts, setStockAlerts] = useState<StockAlertItem[]>([])
  const [alertsLoaded, setAlertsLoaded] = useState(false)

  const alertsRef = useRef<HTMLDivElement>(null)
  const userMenuRef = useRef<HTMLDivElement>(null)

  // Cerrar popovers al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (alertsRef.current && !alertsRef.current.contains(event.target as Node)) {
        setAlertsOpen(false)
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Cargar alertas reales de stock bajo/crítico de la sucursal activa
  useEffect(() => {
    if (!currentUser || !activeBranch) {
      setStockAlerts([])
      return
    }
    let cancelled = false
    const loadAlerts = async () => {
      try {
        const [balRes, itemsRes] = await Promise.all([
          api.get<InventoryBalance[]>('/api/v1/inventory/balance', {
            params: { branch_id: activeBranch.id },
          }),
          api.get<Item[]>('/api/v1/items/'),
        ])
        if (cancelled) return
        const itemMap = new Map(itemsRes.data.map((it) => [it.id, it]))
        const found: StockAlertItem[] = []
        for (const b of balRes.data) {
          const item = itemMap.get(b.item_id)
          if (!item) continue
          const health = computeStockHealth(b.balance, item.min_stock)
          if (health === 'low' || health === 'critical') {
            found.push({
              item_id: b.item_id,
              name: item.name,
              balance: b.balance,
              min_stock: item.min_stock,
              unit: b.unit ?? item.base_unit,
              status: health,
            })
          }
        }
        found.sort((a, b) => (a.status === 'critical' ? -1 : 1) - (b.status === 'critical' ? -1 : 1))
        setStockAlerts(found)
        setAlertsLoaded(true)
      } catch {
        if (!cancelled) {
          setStockAlerts([])
          setAlertsLoaded(true)
        }
      }
    }
    loadAlerts()
    return () => {
      cancelled = true
    }
  }, [currentUser, activeBranch?.id])

  if (!currentUser) return null

  const visibleItems = NAV_ITEMS.filter((item) => item.roles.includes(currentUser.role))
  const currentTitle =
    PAGE_TITLES.find((p) =>
      p.path === '/' ? location.pathname === '/' : location.pathname.startsWith(p.path)
    )?.title ?? 'Panel Principal'

  const handleSignOut = async () => {
    setUserMenuOpen(false)
    await signOut()
    navigate('/login', { replace: true })
  }

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault()
    const q = searchTerm.trim()
    if (!q) {
      navigate('/items')
      return
    }
    navigate(`/items?q=${encodeURIComponent(q)}`)
  }

  const toggleMenu = () => {
    if (window.innerWidth < 768) {
      setMobileOpen((prev) => !prev)
    } else {
      setCollapsed((prev) => !prev)
    }
  }

  return (
    <div className="min-h-screen flex bg-[#FFF4EF] text-[#222222] font-poppins">
      {/* Fondo oscuro en móvil al abrir el menú lateral */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-[#222222]/45 backdrop-blur-[1px] z-30 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Menú lateral corporativo */}
      <aside
        className={`
          fixed md:sticky top-0 left-0 h-screen z-40 flex flex-col
          bg-[#FFFCFA] border-r border-[#F0E2DC]
          shadow-[4px_0_24px_-12px_rgba(145,62,34,0.16)]
          transition-all duration-200 ease-out
          ${collapsed ? 'md:w-[78px]' : 'md:w-[258px]'}
          w-[264px]
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        {/* Botón cerrar en móvil */}
        {mobileOpen && (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="md:hidden absolute top-3 right-3 z-20 w-8 h-8 rounded-full bg-black/20 text-white flex items-center justify-center"
            aria-label="Cerrar menú"
          >
            <CloseXIcon className="w-4 h-4" />
          </button>
        )}

        <SidebarTopArtwork collapsed={collapsed && !mobileOpen} />

        {/* Navegación principal */}
        <nav
          className="flex-1 overflow-y-auto px-3 py-1.5 space-y-1"
          aria-label="Menú principal"
        >
          {visibleItems.map((item) => {
            const Icon = item.icon
            const isExtraActive =
              item.alsoActiveOn?.some((prefix) => location.pathname.startsWith(prefix)) ?? false

            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                title={collapsed && !mobileOpen ? item.label : undefined}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) => {
                  const active = isActive || isExtraActive
                  return [
                    'group flex items-center rounded-[12px] text-[13.5px] transition-all duration-150',
                    collapsed && !mobileOpen
                      ? 'justify-center px-2 py-2.5'
                      : 'gap-3 px-3.5 py-2.5',
                    active
                      ? 'pav-nav-active text-white font-semibold'
                      : 'text-[#2E2E2E] font-medium hover:bg-[#FFF0E8] hover:text-[#C8102E]',
                  ].join(' ')
                }}
              >
                {({ isActive }) => {
                  const active = isActive || isExtraActive
                  return (
                    <>
                      <Icon
                        className={`w-[19px] h-[19px] shrink-0 transition-colors ${
                          active ? 'text-white' : 'text-[#3A3A3A] group-hover:text-[#C8102E]'
                        }`}
                      />
                      {(!collapsed || mobileOpen) && (
                        <span className="truncate leading-snug">{item.label}</span>
                      )}
                    </>
                  )
                }}
              </NavLink>
            )
          })}
        </nav>

        <SidebarBottomWaves collapsed={collapsed && !mobileOpen} />
      </aside>

      {/* Contenedor derecho: barra superior + área de trabajo */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-[#EFE2DC] px-4 lg:px-6 py-3">
          <div className="flex items-center justify-between gap-3">
            {/* Izquierda: botón menú + título dinámico del módulo */}
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={toggleMenu}
                className="w-9 h-9 rounded-[10px] hover:bg-[#FFF3EC] text-[#333333] hover:text-[#C8102E] flex items-center justify-center transition-colors shrink-0"
                aria-label="Alternar menú lateral"
                title="Contraer o expandir menú"
              >
                <MenuIcon className="w-5 h-5" />
              </button>

              <div className="hidden sm:block h-7 w-px bg-[#EAE0DC] shrink-0" />

              <div className="min-w-[130px] flex-1">
                <h1 className="text-[18px] sm:text-[21px] lg:text-[23px] font-bold text-[#222222] leading-tight truncate">
                  {currentTitle}
                </h1>
                <p className="text-[12px] sm:text-[13px] italic text-[#7A6B66] leading-tight truncate">
                  Pollos al Vuelo
                </p>
              </div>
            </div>

            {/* Derecha: selector de sucursal, buscador, alertas reales y perfil */}
            <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
              {/* Selector / indicador de sucursal activa */}
              {branches.length > 1 && (
                <div className="hidden lg:flex items-center gap-1.5 bg-[#FAF6F4] border border-[#E8DCD7] rounded-full px-3 py-1.5">
                  <MapPinIcon className="w-4 h-4 text-[#C8102E] shrink-0" />
                  <select
                    aria-label="Sucursal activa"
                    className="bg-transparent text-[13px] font-medium text-[#333333] focus:outline-none cursor-pointer pr-1"
                    value={activeBranch?.id ?? ''}
                    onChange={(e) => {
                      const b = branches.find((x) => x.id === e.target.value)
                      if (b) setActiveBranch(b)
                    }}
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {branches.length === 1 && activeBranch && (
                <div className="hidden lg:flex items-center gap-1.5 bg-[#FFF6F2] border border-[#F0DCD4] rounded-full px-3 py-1.5 text-[12.5px] font-medium text-[#5C3A2E]">
                  <MapPinIcon className="w-3.5 h-3.5 text-[#C8102E]" />
                  <span>{activeBranch.name}</span>
                </div>
              )}

              {/* Buscador global */}
              <form
                onSubmit={handleSearchSubmit}
                className="hidden xl:flex items-center bg-[#FAF6F4] border border-[#E8DCD7] rounded-full px-3.5 py-1.5 w-[268px] focus-within:border-[#C8102E] focus-within:bg-white transition-colors"
              >
                <SearchIcon className="w-4 h-4 text-[#888888] shrink-0 mr-2" />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar material o insumo..."
                  className="w-full bg-transparent text-[13px] text-[#222222] placeholder-[#8C8C8C] focus:outline-none"
                  aria-label="Buscar material o insumo"
                />
              </form>

              {/* Campana de alertas reales de inventario */}
              <div className="relative" ref={alertsRef}>
                <button
                  type="button"
                  onClick={() => {
                    setAlertsOpen((v) => !v)
                    setUserMenuOpen(false)
                  }}
                  className="relative w-10 h-10 rounded-full hover:bg-[#FFF3EC] text-[#333333] hover:text-[#C8102E] flex items-center justify-center transition-colors"
                  aria-label="Alertas de inventario"
                >
                  <BellIcon className="w-[21px] h-[21px]" />
                  {stockAlerts.length > 0 && (
                    <span className="absolute top-1.5 right-1.5 min-w-[17px] h-[17px] px-1 rounded-full bg-[#C8102E] text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
                      {stockAlerts.length > 9 ? '9+' : stockAlerts.length}
                    </span>
                  )}
                </button>

                {alertsOpen && (
                  <div className="absolute right-0 mt-2 w-80 bg-white rounded-[16px] border border-[#EFE4DF] shadow-xl overflow-hidden z-30">
                    <div className="pav-header-gradient px-4 py-3 text-white flex items-center justify-between">
                      <span className="text-[13.5px] font-semibold">Alertas de stock</span>
                      <span className="text-[11px] bg-white/20 px-2 py-0.5 rounded-full">
                        {activeBranch?.name ?? 'Sucursal'}
                      </span>
                    </div>
                    <div className="max-h-72 overflow-y-auto divide-y divide-[#F3EAE6]">
                      {!alertsLoaded ? (
                        <p className="p-4 text-xs text-[#666666] text-center">Consultando inventario…</p>
                      ) : stockAlerts.length === 0 ? (
                        <p className="p-4 text-xs text-[#666666] text-center">
                          No hay alertas activas de stock bajo o crítico en esta sucursal.
                        </p>
                      ) : (
                        stockAlerts.slice(0, 6).map((a) => (
                          <div
                            key={a.item_id}
                            className="px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-[#FFF9F6]"
                          >
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-[#222222] truncate">{a.name}</p>
                              <p className="text-[11.5px] text-[#666666]">
                                Actual: <strong>{a.balance.toFixed(2)} {a.unit}</strong>
                                {a.min_stock != null && ` · Mín: ${a.min_stock} ${a.unit}`}
                              </p>
                            </div>
                            <StockStatusPill status={a.status} />
                          </div>
                        ))
                      )}
                    </div>
                    <div className="px-4 py-2.5 bg-[#FFF9F6] border-t border-[#F1E8E4] text-right">
                      <Link
                        to="/inventory"
                        onClick={() => setAlertsOpen(false)}
                        className="text-xs font-semibold text-[#C8102E] hover:underline"
                      >
                        Ver control de inventario →
                      </Link>
                    </div>
                  </div>
                )}
              </div>

              {/* Perfil de usuario autenticado */}
              <div className="relative" ref={userMenuRef}>
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen((v) => !v)
                    setAlertsOpen(false)
                  }}
                  className="flex items-center gap-2.5 bg-[#FFF6F2] hover:bg-[#FFEFE8] border border-[#F0DCD4] rounded-full pl-1.5 pr-3 py-1 transition-colors"
                >
                  <span
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{
                      background: 'linear-gradient(135deg, #FF781F 0%, #FFB029 100%)',
                    }}
                  >
                    {getInitials(currentUser.full_name)}
                  </span>
                  <div className="hidden sm:block text-left leading-tight max-w-[155px]">
                    <p className="text-[13px] font-semibold text-[#222222] truncate">
                      {currentUser.full_name}
                    </p>
                    <p className="text-[11px] text-[#666666] truncate">
                      {ROLE_LABELS[currentUser.role]}
                    </p>
                  </div>
                  <ChevronDownIcon className="w-4 h-4 text-[#666666] shrink-0" />
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-64 bg-white rounded-[16px] border border-[#EFE4DF] shadow-xl overflow-hidden z-30">
                    <div className="px-4 py-3.5 bg-[#FFF8F5] border-b border-[#F1E8E4]">
                      <p className="text-sm font-semibold text-[#222222] truncate">
                        {currentUser.full_name}
                      </p>
                      <p className="text-xs text-[#666666] truncate">{currentUser.email}</p>
                      <span className="inline-block mt-1.5 badge-red text-[11px]">
                        {ROLE_LABELS[currentUser.role]}
                      </span>
                    </div>

                    {/* Selector de sucursal en pantallas < lg dentro del menú */}
                    {branches.length > 1 && (
                      <div className="lg:hidden px-4 py-2.5 border-b border-[#F1E8E4]">
                        <label className="text-[11px] font-medium text-[#666666] block mb-1">
                          Sucursal activa
                        </label>
                        <select
                          className="w-full rounded-lg border border-[#E2D9D5] px-2.5 py-1.5 text-xs text-[#222222]"
                          value={activeBranch?.id ?? ''}
                          onChange={(e) => {
                            const b = branches.find((x) => x.id === e.target.value)
                            if (b) setActiveBranch(b)
                          }}
                        >
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="p-2">
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-sm font-medium text-[#B70726] hover:bg-[#FFF0F0] transition-colors"
                      >
                        <LogOutIcon className="w-4 h-4" />
                        Cerrar sesión
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Área principal de trabajo */}
        <main className="flex-1 p-4 sm:p-5 lg:p-6 max-w-[1600px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
