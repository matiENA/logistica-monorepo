import { supabasePublic } from './supabaseClient';

export interface CoordKanbanCard {
  card_id: string;
  unidad_id: string | null;
  n_ute: string | null;
  estado_unidad: string | null;
  // Tractor
  tractor_id: string | null;
  tractor_plate: string;
  tractor_brand: string;
  tractor_wo_id: string | null;
  tractor_ot: string;
  tractor_avg: number | null;
  tractor_snapshot?: any[];
  // Semi
  semi_id: string | null;
  semi_plate: string;
  semi_brand: string;
  semi_wo_id: string | null;
  semi_ot: string;
  semi_avg: number | null;
  semi_snapshot?: any[];
  // Consolidado
  combined_avg: number;
  has_active_task: boolean;
  active_task_id?: string | null;
  active_sector_task?: string | null;
  active_task_sector?: string | null;
  active_task_ubicacion?: string | null;
  active_empezo?: string | null;
  active_termino?: string | null;
  worker_id: string | null;
  worker_name: string;
  worker_op_code: string;
  worker_role: string;
  worker_default_boxes: string[];
  total_tasks: number;
  in_progress_tasks: number;
  completed_tasks: number;
  latest_entry_date?: string | null;
  close_date?: string | null;
}

export interface CoordTaskRow {
  task_id: string;
  work_order_id: string;
  ot_number: string;
  wo_avg: number;
  wo_status: string;
  vehicle_type: 'TRACTOR' | 'SEMI';
  vehicle_id: string | null;
  patente: string;
  task_index: number;
  sector_task: string;
  sector: string;
  descripcion: string;
  ubicacion: string;
  worker_id: string | null;
  worker_name: string;
  worker_op_code: string;
  worker_role: string;
  worker_default_boxes: string[];
  asignado: string | null;
  empezo: string | null;
  termino: string | null;
  estado: string;
  porcentaje: number;
}

export interface StaffMember {
  id: string;
  op_code: string;
  name: string;
  role: string;
  default_boxes: string[];
}

function normalizeKanbanRow(row: any): CoordKanbanCard {
  return {
    card_id: String(row.card_id),
    unidad_id: row.unidad_id || null,
    n_ute: row.n_ute || null,
    estado_unidad: row.estado_unidad || null,
    tractor_id: row.tractor_id || null,
    tractor_plate: row.tractor_plate || '',
    tractor_brand: row.tractor_brand || '',
    tractor_wo_id: row.tractor_wo_id || null,
    tractor_ot: row.tractor_ot || '',
    tractor_avg: row.tractor_avg !== null && row.tractor_avg !== undefined ? Number(row.tractor_avg) : null,
    tractor_snapshot: Array.isArray(row.tractor_snapshot) ? row.tractor_snapshot : [],
    semi_id: row.semi_id || null,
    semi_plate: row.semi_plate || '',
    semi_brand: row.semi_brand || '',
    semi_wo_id: row.semi_wo_id || null,
    semi_ot: row.semi_ot || '',
    semi_avg: row.semi_avg !== null && row.semi_avg !== undefined ? Number(row.semi_avg) : null,
    semi_snapshot: Array.isArray(row.semi_snapshot) ? row.semi_snapshot : [],
    combined_avg: Number(row.combined_avg ?? 0),
    has_active_task: Boolean(row.has_active_task),
    active_task_id: row.active_task_id || null,
    active_sector_task: row.active_sector_task || null,
    active_task_sector: row.active_task_sector || null,
    active_task_ubicacion: row.active_task_ubicacion || null,
    active_empezo: row.active_empezo || null,
    active_termino: row.active_termino || null,
    worker_id: row.worker_id || null,
    worker_name: row.worker_name || '',
    worker_op_code: row.worker_op_code || '',
    worker_role: (row.worker_role || '').toUpperCase().trim(),
    worker_default_boxes: Array.isArray(row.worker_default_boxes) ? row.worker_default_boxes : [],
    total_tasks: Number(row.total_tasks ?? 0),
    in_progress_tasks: Number(row.in_progress_tasks ?? 0),
    completed_tasks: Number(row.completed_tasks ?? 0),
    latest_entry_date: row.latest_entry_date || null,
    close_date: row.close_date || null,
  };
}

/**
 * Obtiene las cards en curso desde v_coord_kanban_progreso
 */
export async function fetchKanbanProgreso(): Promise<CoordKanbanCard[]> {
  const { data, error } = await supabasePublic
    .from('v_coord_kanban_progreso')
    .select('*');

  if (error) {
    console.error('[Coordinacion] Error cargando v_coord_kanban_progreso:', error);
    throw error;
  }

  return (data || []).map(normalizeKanbanRow);
}

/**
 * Obtiene las cards terminadas (últimos 7 días) desde v_coord_kanban_terminados
 */
export async function fetchKanbanTerminados(): Promise<CoordKanbanCard[]> {
  const { data, error } = await supabasePublic
    .from('v_coord_kanban_terminados')
    .select('*');

  if (error) {
    console.error('[Coordinacion] Error cargando v_coord_kanban_terminados:', error);
    throw error;
  }

  return (data || []).map(normalizeKanbanRow);
}

/**
 * Obtiene todas las tareas vivas de un par (Tractor + Semi) desde v_coord_unit_tasks
 */
export async function fetchUnitTasks(workOrderIds: string[]): Promise<CoordTaskRow[]> {
  const validIds = workOrderIds.filter(Boolean);
  if (validIds.length === 0) return [];

  const { data, error } = await supabasePublic
    .from('v_coord_unit_tasks')
    .select('*')
    .in('work_order_id', validIds)
    .order('task_index', { ascending: true });

  if (error) {
    console.error('[Coordinacion] Error cargando v_coord_unit_tasks:', error);
    throw error;
  }

  return (data || []).map((t: any) => ({
    task_id: String(t.task_id),
    work_order_id: String(t.work_order_id),
    ot_number: t.ot_number || '',
    wo_avg: Number(t.wo_avg ?? 0),
    wo_status: t.wo_status || 'ACTIVA',
    vehicle_type: t.vehicle_type === 'SEMI' ? 'SEMI' : 'TRACTOR',
    vehicle_id: t.vehicle_id || null,
    patente: t.patente || '',
    task_index: Number(t.task_index ?? 0),
    sector_task: t.sector_task || '',
    sector: (t.sector || 'GENERAL').toUpperCase(),
    descripcion: t.descripcion || t.sector_task || '',
    ubicacion: t.ubicacion || '',
    worker_id: t.worker_id || null,
    worker_name: t.worker_name || '',
    worker_op_code: t.worker_op_code || '',
    worker_role: (t.worker_role || '').toUpperCase().trim(),
    worker_default_boxes: Array.isArray(t.worker_default_boxes) ? t.worker_default_boxes : [],
    asignado: t.asignado || null,
    empezo: t.empezo || null,
    termino: t.termino || null,
    estado: t.estado || 'PENDIENTE',
    porcentaje: Number(t.porcentaje ?? 0),
  }));
}

/**
 * Convierte el snapshot JSONB de una OT cerrada en filas compatibles con el modal de detalle
 */
export function mapSnapshotToTasks(
  snapshot: any[],
  params: {
    workOrderId: string;
    otNumber: string;
    patente: string;
    vehicleType: 'TRACTOR' | 'SEMI';
    avg: number;
  }
): CoordTaskRow[] {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.map((item: any, idx: number) => {
    const rawSectorTask = item.sector_task || item.sectorTask || item.desc || item.descripcion || '';
    const match = rawSectorTask.match(/^\[([^\]]+)\]\s*(.*)$/);
    const sector = (item.rubro || item.sector || (match ? match[1] : 'GENERAL')).toUpperCase().trim();
    const descripcion = item.descripcion || item.desc || (match ? match[2] : rawSectorTask);
    return {
      task_id: String(item.id || `${params.workOrderId}-${idx}`),
      work_order_id: params.workOrderId,
      ot_number: params.otNumber,
      wo_avg: params.avg,
      wo_status: 'COMPLETADA',
      vehicle_type: params.vehicleType,
      vehicle_id: null,
      patente: params.patente,
      task_index: Number(item.task_index ?? idx + 1),
      sector_task: rawSectorTask || `[${sector}] ${descripcion}`,
      sector,
      descripcion,
      ubicacion: item.ubicacion || item.box || '',
      worker_id: item.worker_id || null,
      worker_name: item.operario || item.assigned_staff_name || '',
      worker_op_code: item.assigned_op_code || '',
      worker_role: '',
      worker_default_boxes: [],
      asignado: item.asignado || null,
      empezo: item.empezo || null,
      termino: item.termino || null,
      estado: item.estado || 'COMPLETADA',
      porcentaje: Number(item.porcentaje ?? 100),
    };
  });
}

/**
 * Obtiene la nómina de personal de panol.staff (a través de la vista espejo public.panol_staff)
 */
export async function fetchCoordStaffList(): Promise<StaffMember[]> {
  const { data, error } = await supabasePublic
    .from('panol_staff')
    .select('id, op_code, name, role, default_boxes')
    .order('name', { ascending: true });

  if (error) {
    console.error('[Coordinacion] Error cargando panol_staff:', error);
    return [];
  }

  return (data || [])
    .filter((s: any) => (s.role || '').toUpperCase().trim() !== 'SECTOR_PRUEBA')
    .map((s: any) => ({
      id: String(s.id),
      op_code: String(s.op_code || ''),
      name: String(s.name || '').trim(),
      role: String(s.role || '').toUpperCase().trim(),
      default_boxes: Array.isArray(s.default_boxes) ? s.default_boxes : [],
    }));
}

/**
 * Actualiza únicamente Ubicación y/o Operario en panol.work_order_tasks vía RPC public.coord_assign_task.
 * Si se asigna recurso por primera vez y `asignado` estaba vacío, registra `asignado = NOW()`.
 * Los campos `empezo` y `termino` son exclusivos de la interacción en Terminal Taller / Mobile.
 */
export async function updateTaskCoordinationAssignment(params: {
  taskId: string;
  ubicacion?: string | null;
  workerId?: string | null;
  currentAsignado?: string | null;
}): Promise<void> {
  const { error } = await supabasePublic.rpc('coord_assign_task', {
    p_task_id: params.taskId,
    p_ubicacion: params.ubicacion ?? null,
    p_worker_id: params.workerId ?? null,
    p_update_ubicacion: params.ubicacion !== undefined,
    p_update_worker: params.workerId !== undefined,
  });

  if (error) {
    console.error('[Coordinacion] Error actualizando asignación en work_order_tasks:', error);
    throw error;
  }
}

/**
 * Suscripción en tiempo real a cambios en panol.work_order_tasks y panol.work_orders
 */
export function subscribeCoordinacionRealtime(onChange: () => void): () => void {
  const channel = supabasePublic
    .channel('coord-kanban-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'panol', table: 'work_order_tasks' },
      () => onChange()
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'panol', table: 'work_orders' },
      () => onChange()
    )
    .subscribe();

  return () => {
    supabasePublic.removeChannel(channel);
  };
}
