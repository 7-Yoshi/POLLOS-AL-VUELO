/**
 * Cliente Axios para Pollos al Vuelo.
 * - Adjunta el ID token de Firebase en cada solicitud.
 * - Ante un 401, refresca el token con `getIdToken(true)` y reintenta exactamente una vez.
 * - Timeout amplio (45s) para tolerar el arranque en frío (cold start) de Render Free.
 */
import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { auth } from './firebase'

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
  timeout: 45000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Adjuntar token de Firebase
api.interceptors.request.use(async (config) => {
  const user = auth.currentUser

  if (user) {
    const token = await user.getIdToken()
    config.headers.Authorization = `Bearer ${token}`
  }

  return config
})

// Reintento único con refresh de token ante HTTP 401
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      auth.currentUser
    ) {
      originalRequest._retry = true
      try {
        const freshToken = await auth.currentUser.getIdToken(true)
        originalRequest.headers.Authorization = `Bearer ${freshToken}`
        return await api(originalRequest)
      } catch (refreshError) {
        console.error('Error refrescando token Firebase tras 401:', refreshError)
        return Promise.reject(refreshError)
      }
    }

    console.error('Error de conexión con FastAPI:', {
      status: error.response?.status,
      endpoint: error.config?.url,
      mensaje: error.message,
    })

    return Promise.reject(error)
  }
)

export default api
