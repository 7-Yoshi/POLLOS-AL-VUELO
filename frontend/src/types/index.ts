/** Tipos compartidos entre módulos del frontend (IDs nativos string de Cloud Firestore) */

export type UserRole = 'admin' | 'gerente' | 'encargado'

export interface CurrentUser {
  id: string
  firebase_uid: string
  email: string
  full_name: string
  role: UserRole
  branch_ids: string[]
  is_active: boolean
  must_change_password: boolean
}

export interface UserListItem {
  id: string
  firebase_uid: string
  email: string
  full_name: string
  username: string | null
  role: UserRole
  branch_ids: string[]
  is_active: boolean
  must_change_password: boolean
  created_at?: string | null
}

export interface Branch {
  id: string
  name: string
  address: string | null
  phone: string | null
  is_active: boolean
}

export type ItemType = 'materia_prima' | 'insumo'

export interface Item {
  id: string
  code: string
  name: string
  item_type: ItemType
  category: string | null
  base_unit: string
  min_stock: number | null
  eligible_for_ml: boolean
  is_active: boolean
  notes?: string | null
}

export type MovementType =
  | 'compra'
  | 'consumo'
  | 'ajuste_entrada'
  | 'ajuste_salida'
  | 'merma'
  | 'traslado_entrada'
  | 'traslado_salida'

export interface InventoryMovement {
  id: string
  branch_id?: string
  item_id: string
  movement_type: MovementType
  quantity_base: number
  unit: string
  effective_date: string
  notes?: string | null
  created_by_uid?: string | null
  created_at?: string | null
}

export interface InventoryBalance {
  branch_id?: string
  item_id: string
  balance: number
  unit?: string
  updated_at?: string | null
}

export type ConsumptionStatus = 'medido' | 'calculado_validado' | 'desconocido'

export interface ConsumptionRecord {
  id: string
  branch_id: string
  item_id: string
  consumption_date: string
  quantity_base: number | null
  unit: string
  status: ConsumptionStatus
  method_notes: string | null
  created_by_uid?: string | null
  created_at?: string | null
}

export interface MLReadinessItem {
  item_id: string
  item_code: string
  item_name: string
  base_unit: string
  eligible_for_ml: boolean
  accumulated_days: number
  target_days: number
  min_inference_days: number
  progress_pct: number
  ready_for_inference: boolean
  ready_for_training: boolean
}

export interface MLReadinessResponse {
  branch_id: string | null
  min_training_days: number
  min_inference_days: number
  summary: {
    total_items: number
    ready_for_training: number
    ready_for_inference: number
    max_days: number
    avg_days: number
  }
  items: MLReadinessItem[]
}

export interface CsvImportResult {
  import_batch_id: string
  status: string
  rows_total: number
  rows_ok: number
  rows_rejected: number
  errors: string[]
}

export interface PurchaseLine {
  line_index?: number
  item_id: string
  item_name: string | null
  quantity_base: number
  unit: string
  unit_cost: number | null
  notes?: string | null
}

export interface Purchase {
  id: string
  branch_id: string
  branch_name?: string | null
  purchase_date: string
  supplier: string | null
  notes?: string | null
  lines?: PurchaseLine[]
  lines_count?: number
  created_by_uid?: string | null
  created_at?: string | null
}

export type EventType = 'feriado' | 'cierre' | 'dia_especial' | 'bloqueo'

export interface OperationEvent {
  id: string
  branch_id: string
  event_type: EventType
  name: string
  start_date: string
  end_date: string
  description: string | null
}

export interface Prediction {
  id: string
  branch_id: string
  item_id: string
  prediction_for_date: string
  predicted_quantity: number
  unit: string
  model_version?: string | null
  algorithm?: string | null
  mae?: number | null
  rmse?: number | null
  r2?: number | null
  range_min?: number | null
  range_max?: number | null
  known_at?: string | null
  calculated_at: string
}

export interface PredictionResult {
  status: 'ok' | 'sin_modelo' | 'datos_insuficientes'
  message?: string
  predicted_quantity: number | null
  branch_id?: string
  item_id?: string
  prediction_for_date?: string
  unit?: string
  model_version?: string
  algorithm?: string
  mae?: number | null
  rmse?: number | null
  r2?: number | null
  range_min?: number | null
  range_max?: number | null
  known_at?: string
}

export interface ConsumptionSummary {
  branch_id: string | null
  scope?: 'single' | 'consolidated'
  branches?: Array<{ id: string; name: string }>
  from_date: string
  to_date: string
  total_records: number
  records: Array<{
    branch_id: string
    branch_name?: string
    date: string
    item_id: string
    quantity_base: number | null
    unit: string
    status: ConsumptionStatus
  }>
}

export interface ConsolidatedBranchSummary {
  branch_id: string
  branch_name: string
  total_consumption: number
  avg_daily_consumption: number
  active_days: number
  validated_records: number
  unknown_records: number
  purchases_count: number
  low_stock_count: number
}

export interface ConsolidatedReport {
  from_date: string
  to_date: string
  item_id: string | null
  branches: Array<{ id: string; name: string }>
  totals: {
    total_consumption: number
    validated_records: number
    unknown_records: number
    purchases_count: number
    low_stock_count: number
  }
  by_branch: ConsolidatedBranchSummary[]
  daily_comparison: Array<Record<string, string | number>>
}

export interface AuditLogItem {
  id: string
  firebase_uid: string
  user_email: string
  user_role: string
  action: string
  entity_type: string
  entity_id: string | null
  branch_id: string | null
  details: string | null
  created_at: string
}

export interface PageParams {
  skip?: number
  limit?: number
}

export interface ApiError {
  detail: string
}
