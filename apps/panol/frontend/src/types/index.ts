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
  unidad_id: string;
  target_type: 'TRACTOR' | 'SEMI';
  plate: string;
  status: 'ACTIVA' | 'CERRADA' | 'SUSPENDIDA';
  progress_percentage: number;
  created_at: string;
  tasks?: WorkOrderTask[];
}

export interface WorkOrderTask {
  id: string;
  work_order_id: string;
  task_index: number;
  task_description: string;
  sector: SectorType;
  status: TaskStatus;
  started_at?: string | null;
  finished_at?: string | null;
  assigned_staff_id?: string | null;
  assigned_staff_name?: string | null;
  assigned_box?: string | null;
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

export interface PanolOrderItem {
  id?: string;
  order_id?: string;
  item_id: string;
  code: string;
  description: string;
  quantity: number;
  exchange_status: string;
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
  tractorPlate: string;
  tractorOt: string;
  semiPlate: string;
  semiOt: string;
  addedAt?: string;
  brand?: string;
  brandSemi?: string;
}

export interface TimelineTask {
  id: string;
  taskIndex?: number;
  rubro?: string;
  desc?: string;
  descripcion?: string;
  estado?: 'PENDIENTE' | 'EN_CURSO' | 'TERMINADO' | 'COMPLETADA';
  operario?: string;
  box?: string;
  empezo?: string;
  termino?: string;
  isEmpezado?: boolean;
  isTerminado?: boolean;
}

export interface TimelineGroup {
  ot: string;
  date?: string;
  tasks: TimelineTask[];
  progress?: number;
}

export interface HistoricalNode {
  ot?: string;
  date?: string;
  ots?: string[];
  tasks?: { rubro?: string; desc?: string; descripcion?: string }[];
}

