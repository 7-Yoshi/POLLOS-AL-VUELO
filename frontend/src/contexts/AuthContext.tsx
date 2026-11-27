/**
 * Contexto de autenticación — provee el usuario actual a toda la app.
 * - Escucha la sesión de Firebase (`browserLocalPersistence`).
 * - Lee custom claim `role` como hint rápido de interfaz; Cloud Firestore (`/api/v1/auth/me`)
 *   permanece siempre como única fuente de verdad.
 * - Detecta arranque lento del servidor en Render Free (> 3 segundos) para mostrar mensaje amigable.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { onAuthStateChanged, signOut as firebaseSignOut, type User as FirebaseUser } from 'firebase/auth'
import { auth } from '../lib/firebase'
import api from '../lib/api'
import type { CurrentUser, UserRole } from '../types'

interface AuthState {
  firebaseUser: FirebaseUser | null
  currentUser: CurrentUser | null
  claimRole: UserRole | null
  loading: boolean
  slowServer: boolean
  error: string | null
}

interface AuthContextValue extends AuthState {
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    firebaseUser: null,
    currentUser: null,
    claimRole: null,
    loading: true,
    slowServer: false,
    error: null,
  })

  const fetchProfile = async (firebaseUser: FirebaseUser): Promise<void> => {
    let hintRole: UserRole | null = null
    try {
      const tokenRes = await firebaseUser.getIdTokenResult()
      const rawClaim = tokenRes.claims?.role
      if (rawClaim === 'admin' || rawClaim === 'gerente' || rawClaim === 'encargado') {
        hintRole = rawClaim
      }
    } catch {
      // Ignorar fallo de lectura de claim; el backend decide el rol real
    }

    setState((s) => ({ ...s, firebaseUser, claimRole: hintRole, loading: true, slowServer: false, error: null }))

    const slowTimer = window.setTimeout(() => {
      setState((s) => (s.loading ? { ...s, slowServer: true } : s))
    }, 3000)

    try {
      const { data } = await api.get<CurrentUser>('/api/v1/auth/me')
      window.clearTimeout(slowTimer)
      if (!data.is_active) {
        setState({
          firebaseUser,
          currentUser: null,
          claimRole: null,
          loading: false,
          slowServer: false,
          error: 'Cuenta desactivada. Contacta al administrador.',
        })
        await firebaseSignOut(auth)
        return
      }
      setState({
        firebaseUser,
        currentUser: data,
        claimRole: data.role,
        loading: false,
        slowServer: false,
        error: null,
      })
    } catch (err: unknown) {
      window.clearTimeout(slowTimer)
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      const msg =
        detail ??
        (err instanceof Error
          ? 'No se pudo conectar con el servidor API. Si está en Render Free, intenta nuevamente en unos segundos.'
          : 'Error al cargar perfil de usuario.')
      setState({
        firebaseUser,
        currentUser: null,
        claimRole: hintRole,
        loading: false,
        slowServer: false,
        error: msg,
      })
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        await fetchProfile(fbUser)
      } else {
        setState({
          firebaseUser: null,
          currentUser: null,
          claimRole: null,
          loading: false,
          slowServer: false,
          error: null,
        })
      }
    })
    return unsubscribe
  }, [])

  const signOut = async () => {
    await firebaseSignOut(auth)
    setState({
      firebaseUser: null,
      currentUser: null,
      claimRole: null,
      loading: false,
      slowServer: false,
      error: null,
    })
  }

  const refreshUser = async () => {
    if (state.firebaseUser) await fetchProfile(state.firebaseUser)
  }

  return (
    <AuthContext.Provider value={{ ...state, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
