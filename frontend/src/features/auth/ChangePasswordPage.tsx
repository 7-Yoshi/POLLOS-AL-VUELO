/**
 * Cambio obligatorio de contraseña en primer ingreso (`must_change_password = true`).
 * Actualiza la contraseña directamente en Firebase Auth (`updatePassword`) y notifica
 * al backend (`/api/v1/auth/password-changed`) para limpiar el flag en Firestore.
 */
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth'

import pollosLogo from '../../assets/login/pollos-logo-official.png'
import { ShieldAuditIcon } from '../../components/ui/Icons'
import { useAuth } from '../../contexts/AuthContext'
import api from '../../lib/api'

export default function ChangePasswordPage() {
  const { firebaseUser, currentUser, refreshUser, signOut } = useAuth()
  const navigate = useNavigate()

  const [currentPassword, setCurrentPassword] = useState('')
  const [needsReauth, setNeedsReauth] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!firebaseUser) return
    if (newPassword.length < 8) {
      setError('La nueva contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (needsReauth && currentPassword && firebaseUser.email) {
        const cred = EmailAuthProvider.credential(firebaseUser.email, currentPassword)
        await reauthenticateWithCredential(firebaseUser, cred)
      }
      await updatePassword(firebaseUser, newPassword)
      await api.post('/api/v1/auth/password-changed')
      await refreshUser()
      navigate('/', { replace: true })
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? ''
      if (code === 'auth/requires-recent-login') {
        setNeedsReauth(true)
        setError('Por seguridad, ingresa tu contraseña actual para confirmar el cambio.')
      } else if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('La contraseña actual es incorrecta.')
      } else if (code === 'auth/weak-password') {
        setError('Contraseña demasiado débil. Usa letras y números (mínimo 8 caracteres).')
      } else {
        setError('No se pudo actualizar la contraseña. Intenta nuevamente.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FFF4EF] px-4 py-10 font-poppins">
      <div className="pav-surface w-full max-w-md overflow-hidden">
        <div className="pav-header-gradient px-6 py-5 text-white flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
            <ShieldAuditIcon className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-[18px] font-bold leading-tight">Cambio obligatorio de contraseña</h1>
            <p className="text-xs text-white/85">Pollos al Vuelo · Seguridad de cuenta</p>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div className="text-center space-y-2">
            <img
              src={pollosLogo}
              alt="Pollos al Vuelo"
              className="h-24 w-auto mx-auto object-contain"
            />
            <p className="text-sm text-[#555555]">
              Hola <strong className="text-[#222222]">{currentUser?.full_name}</strong>. Por
              seguridad, establece una contraseña personal antes de ingresar al sistema.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {needsReauth && (
              <div>
                <label className="label">Contraseña temporal actual *</label>
                <input
                  type="password"
                  className="input"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>
            )}
            <div>
              <label className="label">Nueva contraseña (mín. 8 caracteres) *</label>
              <input
                type="password"
                className="input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <div>
              <label className="label">Confirmar nueva contraseña *</label>
              <input
                type="password"
                className="input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>

            {error && (
              <p role="alert" className="alert-error">
                {error}
              </p>
            )}

            <button type="submit" disabled={saving} className="btn-primary w-full py-2.5">
              {saving ? 'Guardando…' : 'Actualizar contraseña y continuar'}
            </button>
          </form>

          <div className="text-center pt-1">
            <button
              type="button"
              onClick={async () => {
                await signOut()
                navigate('/login', { replace: true })
              }}
              className="text-xs font-medium text-[#777777] hover:text-[#C8102E] hover:underline"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
