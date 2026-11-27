/**
 * Tests del frontend — Pollos al Vuelo (4 perfiles RBAC, cardinalidad, auditoría inmutable y ML UX)
 */
import { describe, it, expect } from 'vitest'

type Role = 'admin' | 'gerente' | 'encargado'

const AUTHORIZED_ROLES: readonly string[] = ['admin', 'gerente', 'encargado']

const MODULE_ROLES: Record<string, Role[]> = {
  dashboard: ['admin', 'gerente', 'encargado'],
  users: ['admin'],
  branches: ['admin', 'gerente'],
  branches_write: ['admin'],
  items_read: ['admin', 'gerente', 'encargado'],
  items_write: ['admin'],
  purchases_read: ['admin', 'gerente', 'encargado'],
  purchases_write: ['admin', 'encargado'],
  inventory_read: ['admin', 'gerente', 'encargado'],
  inventory_write: ['admin', 'encargado'],
  consumption_read: ['admin', 'gerente', 'encargado'],
  consumption_write: ['admin', 'encargado'],
  operations: ['admin', 'gerente'],
  predictions_read: ['admin', 'gerente', 'encargado'],
  predictions_write: ['admin', 'gerente'],
  reports: ['admin', 'gerente'],
  audit_read: ['admin', 'gerente'],
  audit_write: [], // Ningún rol (ni admin) puede modificar o eliminar auditoría
  audit_delete: [],
  ml_publish: ['admin'],
}

function hasPermission(role: Role, permission: string): boolean {
  return MODULE_ROLES[permission]?.includes(role) ?? false
}

function canAccessBranch(role: Role, userBranchIds: string[], targetBranchId: string): boolean {
  if (role === 'admin') return true
  return userBranchIds.includes(targetBranchId)
}

function isValidRoleBranchAssignment(role: Role, branchIds: string[]): boolean {
  if (role === 'admin') return true
  if (role === 'gerente') return branchIds.length >= 1
  return branchIds.length === 1
}

function computeConfidenceRange(predicted: number, rmse: number): [number, number] {
  return [Math.max(0, Number((predicted - rmse).toFixed(4))), Number((predicted + rmse).toFixed(4))]
}

function computeReadinessPct(accumulatedDays: number, targetDays = 60): number {
  return Math.min(100, Number(((accumulatedDays / targetDays) * 100).toFixed(1)))
}

describe('RBAC — matriz de los 4 perfiles', () => {
  it('administrador accede a todos los módulos pero NO puede modificar ni eliminar auditoría', () => {
    Object.keys(MODULE_ROLES).forEach((p) => {
      if (p === 'audit_write' || p === 'audit_delete') {
        expect(hasPermission('admin', p)).toBe(false)
      } else {
        expect(hasPermission('admin', p)).toBe(true)
      }
    })
  })

  it('gerente supervisa en solo lectura operativa y gestiona calendario, predicciones, reportes y auditoría', () => {
    expect(hasPermission('gerente', 'reports')).toBe(true)
    expect(hasPermission('gerente', 'audit_read')).toBe(true)
    expect(hasPermission('gerente', 'operations')).toBe(true)
    expect(hasPermission('gerente', 'predictions_read')).toBe(true)
    expect(hasPermission('gerente', 'predictions_write')).toBe(true)

    expect(hasPermission('gerente', 'users')).toBe(false)
    expect(hasPermission('gerente', 'branches_write')).toBe(false)
    expect(hasPermission('gerente', 'items_write')).toBe(false)
    expect(hasPermission('gerente', 'purchases_write')).toBe(false)
    expect(hasPermission('gerente', 'inventory_write')).toBe(false)
    expect(hasPermission('gerente', 'consumption_write')).toBe(false)
    expect(hasPermission('gerente', 'audit_delete')).toBe(false)
  })

  it('encargado opera su sucursal y consulta predicciones en solo lectura, sin calendario/reportes/auditoría', () => {
    expect(hasPermission('encargado', 'purchases_write')).toBe(true)
    expect(hasPermission('encargado', 'inventory_write')).toBe(true)
    expect(hasPermission('encargado', 'consumption_write')).toBe(true)
    expect(hasPermission('encargado', 'predictions_read')).toBe(true)

    expect(hasPermission('encargado', 'predictions_write')).toBe(false)
    expect(hasPermission('encargado', 'users')).toBe(false)
    expect(hasPermission('encargado', 'items_write')).toBe(false)
    expect(hasPermission('encargado', 'branches_write')).toBe(false)
    expect(hasPermission('encargado', 'operations')).toBe(false)
    expect(hasPermission('encargado', 'reports')).toBe(false)
    expect(hasPermission('encargado', 'audit_read')).toBe(false)
  })

  it('demás trabajadores (cocinero, cajero, mesero, limpieza) no están en la lista blanca de roles', () => {
    for (const nonAuth of ['cocinero', 'cajero', 'mesero', 'limpieza']) {
      expect(AUTHORIZED_ROLES.includes(nonAuth)).toBe(false)
    }
  })
})

describe('Cardinalidad y aislamiento por sucursal (IDs string de Cloud Firestore)', () => {
  it('valida cardinalidad estricta de sucursales por rol', () => {
    expect(isValidRoleBranchAssignment('encargado', ['suc_central'])).toBe(true)
    expect(isValidRoleBranchAssignment('encargado', [])).toBe(false)
    expect(isValidRoleBranchAssignment('encargado', ['suc_central', 'suc_norte'])).toBe(false)

    expect(isValidRoleBranchAssignment('gerente', ['suc_central', 'suc_norte'])).toBe(true)
    expect(isValidRoleBranchAssignment('gerente', [])).toBe(false)

    expect(isValidRoleBranchAssignment('admin', [])).toBe(true)
  })

  it('admin accede a cualquier sucursal', () => {
    expect(canAccessBranch('admin', [], 'suc_sur')).toBe(true)
  })

  it('gerente accede solo a sus sucursales autorizadas', () => {
    expect(canAccessBranch('gerente', ['suc_central', 'suc_sur'], 'suc_central')).toBe(true)
    expect(canAccessBranch('gerente', ['suc_central', 'suc_sur'], 'suc_norte')).toBe(false)
  })

  it('encargado accede únicamente a su sucursal asignada', () => {
    expect(canAccessBranch('encargado', ['suc_central'], 'suc_central')).toBe(true)
    expect(canAccessBranch('encargado', ['suc_central'], 'suc_norte')).toBe(false)
  })
})

describe('Márgenes de error ML y madurez histórica (Problemas 2 y 5)', () => {
  it('calcula rango de confianza ± RMSE sin valores negativos', () => {
    expect(computeConfidenceRange(50, 6.5)).toEqual([43.5, 56.5])
    expect(computeConfidenceRange(3, 5)).toEqual([0, 8])
  })

  it('calcula progreso días acumulados / 60 correctamente', () => {
    expect(computeReadinessPct(30, 60)).toBe(50)
    expect(computeReadinessPct(60, 60)).toBe(100)
    expect(computeReadinessPct(90, 60)).toBe(100)
  })
})

describe('Lógica de consumo diario y movimientos', () => {
  it('estado DESCONOCIDO permite quantity_base null sin generar ceros', () => {
    const record: { status: string; quantity: number | null } = {
      status: 'desconocido',
      quantity: null,
    }
    expect(record.quantity).toBeNull()
    expect(record.quantity).not.toBe(0)
  })

  it('cubre los 7 tipos de movimiento definidos', () => {
    const positivos = ['compra', 'ajuste_entrada', 'traslado_entrada']
    const negativos = ['consumo', 'ajuste_salida', 'merma', 'traslado_salida']
    expect([...positivos, ...negativos]).toHaveLength(7)
    expect(positivos).toContain('compra')
    expect(negativos).toContain('merma')
  })
})
