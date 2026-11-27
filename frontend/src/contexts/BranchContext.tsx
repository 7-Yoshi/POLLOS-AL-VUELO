/**
 * Contexto de sucursal activa — el usuario puede cambiar entre sus sucursales autorizadas.
 */
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import api from '../lib/api'
import type { Branch } from '../types'
import { useAuth } from './AuthContext'

interface BranchContextValue {
  branches: Branch[]
  activeBranch: Branch | null
  setActiveBranch: (branch: Branch) => void
  loading: boolean
}

const BranchContext = createContext<BranchContextValue | null>(null)

export function BranchProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth()
  const [branches, setBranches] = useState<Branch[]>([])
  const [activeBranch, setActiveBranch] = useState<Branch | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!currentUser) {
      setBranches([])
      setActiveBranch(null)
      return
    }

    const load = async () => {
      setLoading(true)
      try {
        const { data } = await api.get<Branch[]>('/api/v1/branches/')
        setBranches(data)
        // Si el usuario tiene una sola sucursal, se asigna automáticamente
        if (data.length === 1) {
          setActiveBranch(data[0])
        } else if (data.length > 1) {
          setActiveBranch(data[0])
        }
      } catch {
        setBranches([])
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [currentUser])

  return (
    <BranchContext.Provider value={{ branches, activeBranch, setActiveBranch, loading }}>
      {children}
    </BranchContext.Provider>
  )
}

export function useBranch(): BranchContextValue {
  const ctx = useContext(BranchContext)
  if (!ctx) throw new Error('useBranch must be used within BranchProvider')
  return ctx
}
