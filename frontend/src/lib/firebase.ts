/**
 * Configuración de Firebase Authentication (cliente web).
 * Las claves VITE_ son públicas (identificadores, no secretos de servidor).
 * Cloud Firestore se consume exclusivamente vía FastAPI (Admin SDK).
 */
import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
} from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)

// Persistencia local por defecto (mantiene la sesión al reiniciar el navegador)
export const authPersistenceReady: Promise<void> = setPersistence(
  auth,
  browserLocalPersistence
).catch((err) => {
  console.warn('No se pudo configurar browserLocalPersistence:', err)
})

/**
 * Configura dinámicamente la persistencia de Firebase Auth según la opción "Recordarme".
 * Nunca almacena la contraseña del usuario.
 */
export async function applyAuthPersistence(rememberMe: boolean): Promise<void> {
  await setPersistence(
    auth,
    rememberMe ? browserLocalPersistence : browserSessionPersistence
  )
}

// Conexión opcional al Firebase Auth Emulator en desarrollo/pruebas
if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true') {
  const emulatorUrl =
    import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL ?? 'http://127.0.0.1:9099'
  connectAuthEmulator(auth, emulatorUrl, { disableWarnings: true })
}
