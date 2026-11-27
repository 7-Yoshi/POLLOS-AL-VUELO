/**
 * Pantalla de Login — Pollos al Vuelo.
 * Rediseño fiel a la referencia visual corporativa manteniendo 100 % la autenticación
 * con Firebase Auth, persistencia controlada por "Recordarme", recuperación de contraseña,
 * aviso de arranque lento en Render Free y redirección según rol / must_change_password.
 */
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth'
import { auth, applyAuthPersistence } from '../../lib/firebase'
import { useAuth } from '../../contexts/AuthContext'
import officialLogoImg from '../../assets/login/pollos-logo-official.png'
import runningMascotImg from '../../assets/login/pollos-mascot-running.png'
import {
  CenterCurveDivider,
  LeftPanelArtwork,
  OuterBackgroundDecor,
} from './LoginArtwork'
import {
  CheckMarkIcon,
  EyeIcon,
  EyeOffIcon,
  LockFieldIcon,
  LoginArrowIcon,
  ShieldCheckIcon,
  UserFieldIcon,
} from './LoginIcons'

export default function LoginPage() {
  const navigate = useNavigate()
  const { currentUser, loading: authLoading, slowServer, error: authError, refreshUser } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'login' | 'reset'>('login')

  useEffect(() => {
    if (currentUser) {
      if (currentUser.must_change_password) {
        navigate('/change-password', { replace: true })
      } else {
        navigate('/', { replace: true })
      }
    }
  }, [currentUser, navigate])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError('Ingresa tu correo electrónico y contraseña.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await applyAuthPersistence(rememberMe)
      await signInWithEmailAndPassword(auth, email.trim(), password)
      navigate('/', { replace: true })
    } catch (err: unknown) {
      setError(friendlyFirebaseError(err))
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) {
      setError('Ingresa tu correo electrónico.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await sendPasswordResetEmail(auth, email.trim())
      setResetSent(true)
    } catch {
      // Mensaje genérico para no revelar si el correo existe
      setResetSent(true)
    } finally {
      setLoading(false)
    }
  }

  const isBusy = loading || authLoading

  return (
    <div className="font-poppins relative min-h-screen w-full overflow-x-hidden flex items-center justify-center p-3 sm:p-5 lg:p-6 bg-[#FFF4EF]">
      {/* Fondo crema exterior con curvas suaves en rosa, beige y naranja claro */}
      <OuterBackgroundDecor />

      {/* Tarjeta principal centrada (aprox. 90% ancho, máx. 1280px, ~83% alto en escritorio) */}
      <main
        className="relative z-10 w-[94vw] sm:w-[90vw] max-w-[1280px] md:h-[83vh] md:min-h-[620px] md:max-h-[820px] rounded-[28px] sm:rounded-[34px] lg:rounded-[36px] border-2 border-white/95 bg-[#FFFCFA] overflow-hidden flex flex-col md:flex-row"
        style={{
          boxShadow:
            '0 26px 68px -14px rgba(168, 68, 42, 0.20), 0 10px 28px -8px rgba(0, 0, 0, 0.08)',
        }}
      >
        {/* ─── PANEL IZQUIERDO: IDENTIDAD VISUAL (~49%) ─── */}
        <section
          aria-label="Identidad visual Pollos al Vuelo"
          className="relative w-full md:w-[49%] shrink-0 overflow-hidden flex flex-col justify-between text-white"
        >
          <LeftPanelArtwork />
          <CenterCurveDivider />

          {/* Contenido superior: titular (exactamente 3 líneas) + línea amarilla + descripción */}
          <div className="relative z-10 px-7 pt-7 pb-3 sm:px-9 sm:pt-9 md:px-9 md:pt-10 lg:px-14 lg:pt-14 pr-8 md:pr-10 lg:pr-14">
            <h1 className="font-extrabold text-white text-[clamp(26px,3.15vw,46px)] leading-[1.13] tracking-[-0.02em]">
              <span className="block">Gestiona,</span>
              <span className="block whitespace-nowrap">planifica y predice</span>
              <span className="block">tu inventario</span>
            </h1>

            {/* Barra horizontal amarilla redondeada */}
            <div
              className="mt-4 mb-4 lg:mt-5 lg:mb-5 h-[6px] w-[56px] lg:w-[66px] rounded-full bg-[#FFD129]"
              aria-hidden="true"
            />

            <p className="font-normal text-white/95 text-[clamp(14px,1.45vw,21px)] leading-[1.44] max-w-[420px]">
              Controla tu materia prima, optimiza tus compras y anticipa tus necesidades con un
              sistema inteligente.
            </p>
          </div>

          {/* Ilustración oficial del pollito corriendo (integrada con las ondas inferiores) */}
          <div className="relative z-10 hidden md:flex items-end justify-center px-5 pb-3 lg:pb-5 pr-8 lg:pr-12 flex-1 min-h-0">
            <img
              src={runningMascotImg}
              alt="Mascota corriendo de Pollos al Vuelo"
              className="w-[82%] max-w-[355px] lg:max-w-[410px] max-h-[325px] lg:max-h-[375px] object-contain select-none drop-shadow-[0_10px_18px_rgba(145,42,10,0.16)]"
              draggable={false}
            />
          </div>
        </section>

        {/* ─── PANEL DERECHO: FORMULARIO DE INICIO DE SESIÓN (~51%) ─── */}
        <section
          aria-label="Inicio de sesión"
          className="relative flex-1 bg-[#FFFCFA] flex flex-col items-center justify-center px-6 py-8 sm:px-10 sm:py-9 md:px-10 lg:px-14 xl:px-16"
        >
          <div className="w-full max-w-[410px] flex flex-col items-center">
            {/* Logotipo oficial de Pollos al Vuelo */}
            <div className="mb-2 lg:mb-3 flex justify-center">
              <img
                src={officialLogoImg}
                alt="Logotipo oficial Pollos al Vuelo"
                className="w-[155px] sm:w-[175px] md:w-[180px] lg:w-[205px] max-h-[190px] lg:max-h-[215px] object-contain select-none"
                draggable={false}
              />
            </div>

            {mode === 'login' ? (
              <>
                <h2 className="text-[32px] sm:text-[36px] lg:text-[41px] font-bold text-[#222222] leading-[1.15] tracking-[-0.02em] text-center">
                  Bienvenido
                </h2>
                <p className="mt-1 mb-6 lg:mb-7 text-[16px] sm:text-[18px] lg:text-[19px] font-normal text-[#666666] text-center">
                  Inicia sesión para continuar
                </p>

                <form onSubmit={handleLogin} noValidate className="w-full space-y-4">
                  {/* Campo Correo electrónico */}
                  <div>
                    <label htmlFor="email" className="sr-only">
                      Correo electrónico
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 pl-4 flex items-center text-[#7A7A7A]">
                        <UserFieldIcon className="w-5 h-5" />
                      </span>
                      <input
                        id="email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Correo electrónico"
                        required
                        aria-describedby={error || authError ? 'login-error' : undefined}
                        className="w-full h-[54px] pl-12 pr-4 rounded-[12px] bg-white border border-[#DDDDDD] text-[15px] sm:text-[16px] text-[#222222] placeholder:text-[#8A8A8A] transition-colors duration-150 focus:outline-none focus:border-[#C8102E] focus:ring-2 focus:ring-[#C8102E]/15"
                      />
                    </div>
                  </div>

                  {/* Campo Contraseña con botón mostrar/ocultar */}
                  <div>
                    <label htmlFor="password" className="sr-only">
                      Contraseña
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 pl-4 flex items-center text-[#7A7A7A]">
                        <LockFieldIcon className="w-5 h-5" />
                      </span>
                      <input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Contraseña"
                        required
                        className="w-full h-[54px] pl-12 pr-12 rounded-[12px] bg-white border border-[#DDDDDD] text-[15px] sm:text-[16px] text-[#222222] placeholder:text-[#8A8A8A] transition-colors duration-150 focus:outline-none focus:border-[#C8102E] focus:ring-2 focus:ring-[#C8102E]/15"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        aria-pressed={showPassword}
                        className="absolute inset-y-0 right-0 pr-4 flex items-center text-[#7A7A7A] hover:text-[#C8102E] transition-colors focus:outline-none"
                      >
                        {showPassword ? (
                          <EyeOffIcon className="w-5 h-5" />
                        ) : (
                          <EyeIcon className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Fila: Recordarme + ¿Olvidaste tu contraseña? */}
                  <div className="flex items-center justify-between gap-2 pt-1 pb-1">
                    <label
                      htmlFor="remember-me"
                      className="inline-flex items-center gap-2.5 cursor-pointer select-none"
                    >
                      <span className="relative flex items-center justify-center">
                        <input
                          id="remember-me"
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => setRememberMe(e.target.checked)}
                          className="peer sr-only"
                        />
                        <span
                          className={`w-[21px] h-[21px] rounded-[5px] border flex items-center justify-center transition-colors ${
                            rememberMe
                              ? 'bg-[#B70726] border-[#B70726] text-white'
                              : 'bg-white border-[#CCCCCC] text-transparent'
                          } peer-focus-visible:ring-2 peer-focus-visible:ring-[#C8102E]/35`}
                        >
                          <CheckMarkIcon className="w-3.5 h-3.5" />
                        </span>
                      </span>
                      <span className="text-[13.5px] lg:text-[15px] font-medium text-[#333333] whitespace-nowrap">
                        Recordarme
                      </span>
                    </label>

                    <button
                      type="button"
                      onClick={() => {
                        setMode('reset')
                        setError(null)
                        setResetSent(false)
                      }}
                      className="text-[13.5px] lg:text-[15px] font-medium text-[#C8102E] hover:text-[#B70726] hover:underline transition-colors whitespace-nowrap"
                    >
                      ¿Olvidaste tu contraseña?
                    </button>
                  </div>

                  {/* Aviso de arranque lento en Render Free */}
                  {slowServer && isBusy && (
                    <div className="rounded-[12px] bg-[#FFF7E6] border border-[#FFD129] px-4 py-2.5 text-xs text-[#7A4B00]">
                      El servidor se está iniciando. El primer acceso puede tardar unos segundos…
                    </div>
                  )}

                  {/* Mensaje de error */}
                  {(error || authError) && (
                    <div
                      id="login-error"
                      role="alert"
                      className="rounded-[12px] bg-[#FFF0F0] border border-[#F2B8B5] px-4 py-2.5 text-[13px] text-[#B70726] space-y-1.5"
                    >
                      <p>{error ?? authError}</p>
                      {authError && !error && (
                        <button
                          type="button"
                          onClick={() => refreshUser()}
                          className="text-xs font-semibold underline hover:text-[#C8102E]"
                        >
                          Reintentar conexión
                        </button>
                      )}
                    </div>
                  )}

                  {/* Botón principal de inicio de sesión */}
                  <button
                    type="submit"
                    disabled={isBusy}
                    className="w-full h-[58px] rounded-[13px] text-white font-semibold text-[19px] sm:text-[20px] flex items-center justify-center gap-3 transition-all duration-150 hover:brightness-105 active:scale-[0.99] disabled:opacity-65 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#C8102E]"
                    style={{
                      background:
                        'linear-gradient(180deg, #DC1C2D 0%, #C8102E 52%, #B70726 100%)',
                      boxShadow: '0 10px 22px -6px rgba(183, 7, 38, 0.45)',
                    }}
                  >
                    {isBusy ? (
                      <>
                        <span
                          className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"
                          aria-hidden="true"
                        />
                        <span>{slowServer ? 'Despertando servidor…' : 'Iniciando sesión…'}</span>
                      </>
                    ) : (
                      <>
                        <LoginArrowIcon className="w-[22px] h-[22px]" />
                        <span>Iniciar sesión</span>
                      </>
                    )}
                  </button>
                </form>
              </>
            ) : (
              /* ─── MODO RECUPERACIÓN DE CONTRASEÑA ─── */
              <div className="w-full">
                <h2 className="text-[28px] sm:text-[32px] font-bold text-[#222222] leading-tight text-center">
                  Recuperar contraseña
                </h2>
                <p className="mt-1 mb-6 text-[15px] text-[#666666] text-center">
                  Ingresa tu correo electrónico y te enviaremos un enlace de restablecimiento.
                </p>

                {resetSent ? (
                  <div className="rounded-[12px] bg-[#FFF7E6] border border-[#FFD129] px-4 py-3.5 text-sm text-[#5C3A00] text-center">
                    Si existe una cuenta registrada con ese correo, recibirás un enlace de
                    recuperación en breve.
                  </div>
                ) : (
                  <form onSubmit={handleReset} noValidate className="space-y-4">
                    <div>
                      <label htmlFor="reset-email" className="sr-only">
                        Correo electrónico
                      </label>
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 left-0 pl-4 flex items-center text-[#7A7A7A]">
                          <UserFieldIcon className="w-5 h-5" />
                        </span>
                        <input
                          id="reset-email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="Correo electrónico"
                          required
                          className="w-full h-[54px] pl-12 pr-4 rounded-[12px] bg-white border border-[#DDDDDD] text-[15px] text-[#222222] placeholder:text-[#8A8A8A] focus:outline-none focus:border-[#C8102E] focus:ring-2 focus:ring-[#C8102E]/15"
                        />
                      </div>
                    </div>

                    {error && (
                      <p
                        role="alert"
                        className="rounded-[12px] bg-[#FFF0F0] border border-[#F2B8B5] px-4 py-2.5 text-[13px] text-[#B70726]"
                      >
                        {error}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full h-[56px] rounded-[13px] text-white font-semibold text-[18px] transition-all hover:brightness-105 disabled:opacity-65"
                      style={{
                        background:
                          'linear-gradient(180deg, #DC1C2D 0%, #C8102E 52%, #B70726 100%)',
                        boxShadow: '0 10px 22px -6px rgba(183, 7, 38, 0.42)',
                      }}
                    >
                      {loading ? 'Enviando…' : 'Enviar enlace'}
                    </button>
                  </form>
                )}

                <p className="mt-5 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login')
                      setError(null)
                    }}
                    className="text-sm font-medium text-[#C8102E] hover:text-[#B70726] hover:underline"
                  >
                    ← Volver al inicio de sesión
                  </button>
                </p>
              </div>
            )}

            {/* Sección inferior de seguridad */}
            <footer className="w-full mt-6 lg:mt-7">
              <div className="flex items-center gap-4 mb-2.5">
                <div className="flex-1 h-px bg-[#E8E2DF]" />
                <span className="text-[#C8102E] flex items-center justify-center">
                  <ShieldCheckIcon className="w-[22px] h-[22px]" />
                </span>
                <div className="flex-1 h-px bg-[#E8E2DF]" />
              </div>
              <p className="text-[13px] text-[#666666] text-center font-normal">
                Sistema de gestión y predicción de materia prima
              </p>
            </footer>
          </div>
        </section>
      </main>
    </div>
  )
}

function friendlyFirebaseError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? ''
  switch (code) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Correo o contraseña incorrectos.'
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Espera unos minutos.'
    case 'auth/user-disabled':
      return 'Cuenta desactivada. Contacta al administrador.'
    case 'auth/network-request-failed':
      return 'Error de red. Verifica tu conexión.'
    default:
      return 'No se pudo iniciar sesión. Intenta nuevamente.'
  }
}
