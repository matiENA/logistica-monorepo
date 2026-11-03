// ==============================================================
// 📋 MODELOS TIPADOS DE PAÑOL LOGISTICS (SUPABASE + BACKEND API)
// ==============================================================

export type SectorType =
  | 'GOMERIA'
  | 'MECANICA'
  | 'ELECTRICIDAD'
  | 'LAVADERO'
  | 'ENGRASE'
  | 'LUBRICENTRO'
  | 'MOTORES'
  | 'CARROCERIA'
  | 'VTV'
  | 'DEFAULT';

export type TaskStatus = 'PENDIENTE' | 'EN_CURSO' | 'TERMINADO';

export type OrderStatus = 'PENDIENTE' | 'EN_PREPARACION' | 'LISTO' | 'ENTREGADO' | 'CANCELADO';

export interface Unidad {
  id: string; // UUID de public.unidades
  n_ute?: string;
  tractor: string;
  semi?: string;
  marca_tr?: string;
  marca_semi?: string;
  servicio?: string;
  estado?: 'disponible' | 'circulando' | 'taller' | 'mantenimiento' | 'baja';
}

export interface WorkOrder {
  id: string;
  ot_number: string;
  unidad_id?: string | null;
  tractor_id?: string | null;
  semi_id?: string | null;
  target_type?: 'TRACTOR' | 'SEMI';
  plate?: string;
  status: 'ACTIVA' | 'COMPLETADA' | 'CERRADA' | 'SUSPENDIDA';
  avg?: number;
  progress_percentage?: number;
  entry_date?: string;
  close_date?: string | null;
  created_at: string;
  tasks?: WorkOrderTask[];
}

export interface UnitWorkOrder {
  id: string;
  tractor_id?: string | null;
  semi_id?: string | null;
  work_order_id: string;
  vehicle_type?: 'TRACTOR' | 'SEMI';
  vehicle_id?: string;
  created_at?: string;
}

export interface WorkOrderTask {
  id: string;
  work_order_id: string;
  task_index: number;
  task_description?: string;
  sector_task?: string;
  sector?: SectorType;
  status?: TaskStatus;
  estado?: 'PENDIENTE' | 'EN_CURSO' | 'TERMINADO' | 'COMPLETADA';
  porcentaje?: number;
  ubicacion?: string | null;
  assigned_box?: string | null;
  asignado?: string | null;
  started_at?: string | null;
  empezo?: string | null;
  finished_at?: string | null;
  termino?: string | null;
  worker_id?: string | null;
  assigned_staff_id?: string | null;
  assigned_staff_name?: string | null;
  assigned_op_code?: string | null;
  operario?: string | null;
}

export interface CatalogItem {
  id: string;
  code: string;
  description: string;
  category: string;
  stock: number;
  unit: string;
  requires_exchange: boolean; // Requiere canje de repuesto usado
  location?: string;
}

export interface CartItem {
  item: CatalogItem;
  quantity: number;
  exchangeStatus: 'PENDIENTE' | 'ENTREGADO' | 'NO_APLICA';
}

export interface CanjePayload {
  canje: boolean;
  tipo: 'ENTREGO_USADA' | 'FALTANTE' | 'NO_APLICA';
  cant_pedida: number;
  cant_entregada: number;
  cant_faltante: number;
  motivo?: string;
}

export interface StockMovement {
  movement_id: string;
  created_at: string;
  ready_at?: string | null;
  order_id?: string | null;
  order_item_id?: string | null;
  item_id: string;
  item_code: string;
  item_name: string;
  quantity_delta: number;
  previous_stock: number;
  new_stock: number;
  movement_type: 'PEDIDO_LISTO' | 'DEVOLUCION_NUEVO' | 'DEVOLUCION_CANJE' | 'AJUSTE_MANUAL';
  mechanic_id?: string | null;
  mechanic_op_code?: string | null;
  mechanic_name?: string | null;
  panol_staff_id?: string | null;
  panol_op_code?: string | null;
  panol_staff_name?: string | null;
  notes?: string | null;
}

export interface PanolOrderItem {
  id?: string;
  order_id?: string;
  item_id: string;
  code: string;
  description: string;
  quantity: number;
  exchange_status: string;
  requires_exchange?: boolean;
  returned_qty?: number | null;
  return_notes?: string | null;
  panol_confirmation?: string | null;
  status?: string;
}

export interface PanolOrder {
  id: string;
  req_code: string;
  mechanic_id: string;
  mechanic_name: string;
  work_order_id?: string;
  unidad_id?: string;
  tractor_plate?: string;
  semi_plate?: string;
  box_number: string;
  status: OrderStatus;
  items: PanolOrderItem[];
  created_at: string;
  ready_at?: string | null;
  delivered_at?: string | null;
  notes?: string;
}

export interface StaffUser {
  id: string;
  op_code: string; // Legajo / PIN
  name: string;
  role: 'OPERARIO' | 'PANOLERO' | 'COORDINADOR' | 'ADMIN';
  default_boxes?: string[];
  active: boolean;
}

export interface EnvInfo {
  environment: 'development' | 'production';
  backendUrl: string;
  database: 'supabase' | 'sheets';
  connected: boolean;
}

export interface HoldUnit {
  id?: string;
  holdId?: string;
  staffId?: string;
  opCode?: string;
  staffName?: string;
  workOrderId?: string;
  tractorWorkOrderId?: string;
  semiWorkOrderId?: string;
  tractorOtStatus?: string;
  semiOtStatus?: string;
  tractorId?: string;
  semiId?: string;
  tractorPlate: string;
  tractorOt: string;
  semiPlate: string;
  semiOt: string;
  addedAt?: string;
  createdAt?: string;
  brand?: string;
  brandSemi?: string;
  tractorBrand?: string;
  semiBrand?: string;
  source?: 'MANUAL' | 'COORDINACION';
  reviewedAt?: string | null;
  isCoordAssigned?: boolean;
  tractorHasCoordTasks?: boolean;
  semiHasCoordTasks?: boolean;
  hasCoordTasks?: boolean;
  assignedTasksCount?: number;
}

export interface TimelineTask {
  id: string;
  taskIndex?: number;
  task_index?: number;
  rubro?: string;
  sector?: string;
  desc?: string;
  descripcion?: string;
  description?: string;
  sectorTask?: string;
  sector_task?: string;
  estado?: 'PENDIENTE' | 'EN_CURSO' | 'TERMINADO' | 'COMPLETADA';
  status?: string;
  porcentaje?: number;
  operario?: string;
  workerId?: string | null;
  worker_id?: string | null;
  assignedStaffId?: string | null;
  assignedStaffName?: string | null;
  assignedOpCode?: string | null;
  box?: string;
  ubicacion?: string;
  empezo?: string;
  termino?: string;
  isEmpezado?: boolean;
  isTerminado?: boolean;
}

export interface TimelineGroup {
  ot: string;
  workOrderId?: string;
  work_order_id?: string;
  type?: 'TRACTOR' | 'SEMI';
  vehicleType?: 'TRACTOR' | 'SEMI';
  date?: string;
  tasks: TimelineTask[];
  progress?: number;
}

export interface HistoricalNode {
  ot?: string;
  date?: string;
  ots?: string[];
  type?: 'TRACTOR' | 'SEMI';
  status?: string;
  avg?: number;
  tasks?: (TimelineTask | { rubro?: string; desc?: string; descripcion?: string; sectorTask?: string; operario?: string; box?: string; empezo?: string; termino?: string; isTerminado?: boolean; estado?: string })[];
}

