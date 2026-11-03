import { panolFetch } from './api';
import { supabase } from './supabaseClient';
import { CatalogItem, TimelineGroup, HistoricalNode, HoldUnit } from '../types';

/**
 * Llama a una acción RPC en el backend
 */
export async function rpcCall<T = any>(action: string, ...args: any[]): Promise<T> {
  const res = await panolFetch<{ success?: boolean; result?: T; error?: string }>('/api/rpc', {
    method: 'POST',
    body: JSON.stringify({ action, args }),
  });

  return (res.result !== undefined ? res.result : res) as T;
}

/**
 * Obtiene el catálogo de repuestos
 */
export async function getItemCatalog(): Promise<CatalogItem[]> {
  try {
    const raw = await rpcCall<any[]>('getItemCatalog');
    if (!Array.isArray(raw)) return [];
    return raw.map((item, idx) => ({
      id: item.id || `item-${idx}`,
      code: item.code || item.name || '',
      description: item.name || item.description || '',
      category: item.category || 'GENERAL',
      stock: item.stock !== undefined ? Number(item.stock) : 10,
      unit: item.unit || 'UN',
      requires_exchange: !!(item.requiereCanje || item.requires_exchange),
    }));
  } catch (err) {
    console.error('Error fetching item catalog:', err);
    return [];
  }
}

/**
 * Obtiene el catálogo de flota para autocompletado de patentes
 */
export async function getFleetSearchCatalog(): Promise<{
  tractores: string[];
  semis: string[];
  unidades: any[];
  pairs?: any[];
}> {
  try {
    const res = await panolFetch<{ tractores?: string[]; semis?: string[]; unidades?: any[]; pairs?: any[] }>(
      '/api/fleet/search-catalog'
    );
    return {
      tractores: res.tractores || [],
      semis: res.semis || [],
      unidades: res.unidades || [],
      pairs: res.pairs || [],
    };
  } catch (err) {
    console.error('Error fetching fleet catalog:', err);
    return { tractores: [], semis: [], unidades: [], pairs: [] };
  }
}

/**
 * Obtiene las unidades que un operario tiene retenidas en su taller/box (panol.v_staff_holds)
 * con reconocimiento dinámico de tareas asignadas vivas directamente desde Supabase
 */
export async function getOperarioHoldUnits(opId: string): Promise<HoldUnit[]> {
  try {
    const cleanOp = String(opId || '').trim();

    // 1. Consulta directa a Supabase (panol.v_staff_holds) para datos en vivo y consistencia total
    if (cleanOp) {
      try {
        const { data: dbHolds, error: dbErr } = await supabase
          .from('v_staff_holds')
          .select('*')
          .or(`op_code.eq.${cleanOp},staff_id.eq.${cleanOp}`)
          .order('created_at', { ascending: false });

        if (!dbErr && Array.isArray(dbHolds) && dbHolds.length > 0) {
          const staffId = dbHolds[0].staff_id;
          const activeWoMap = new Map<string, { pending: number; inProgress: number }>();

          if (staffId) {
            const { data: tasks } = await supabase
              .from('work_order_tasks')
              .select('work_order_id, empezo, termino, estado')
              .eq('worker_id', staffId)
              .is('termino', null);

            if (Array.isArray(tasks)) {
              tasks.forEach((t: any) => {
                if (t.estado !== 'COMPLETADA' && t.work_order_id) {
                  const wid = String(t.work_order_id);
                  const cur = activeWoMap.get(wid) || { pending: 0, inProgress: 0 };
                  if (!t.empezo) cur.pending++;
                  else cur.inProgress++;
                  activeWoMap.set(wid, cur);
                }
              });
            }
          }

          return dbHolds.map((r: any) => {
            const trWoId = r.tractor_work_order_id ? String(r.tractor_work_order_id) : null;
            const smWoId = r.semi_work_order_id ? String(r.semi_work_order_id) : null;

            const trTaskInfo = trWoId ? activeWoMap.get(trWoId) : null;
            const smTaskInfo = smWoId ? activeWoMap.get(smWoId) : null;

            const tractorHasCoordTasks = Boolean(trTaskInfo && (trTaskInfo.pending > 0 || trTaskInfo.inProgress > 0));
            const semiHasCoordTasks = Boolean(smTaskInfo && (smTaskInfo.pending > 0 || smTaskInfo.inProgress > 0));
            const hasCoordTasks = tractorHasCoordTasks || semiHasCoordTasks;

            const isCoordAssigned = hasCoordTasks || Boolean(r.is_coord_assigned) || (r.source === 'COORDINACION' && !r.reviewed_at);

            return {
              id: r.hold_id,
              holdId: r.hold_id,
              staffId: r.staff_id,
              opCode: r.op_code,
              staffName: r.staff_name,
              tractorWorkOrderId: r.tractor_work_order_id,
              semiWorkOrderId: r.semi_work_order_id,
              tractorOtStatus: r.tractor_ot_status,
              semiOtStatus: r.semi_ot_status,
              tractorId: r.tractor_id,
              semiId: r.semi_id,
              tractorPlate: r.tractor_plate,
              tractorOt: r.tractor_ot,
              semiPlate: r.semi_plate,
              semiOt: r.semi_ot,
              brand: r.tractor_brand,
              brandSemi: r.semi_brand,
              tractorBrand: r.tractor_brand,
              semiBrand: r.semi_brand,
              addedAt: r.created_at,
              source: r.source || (hasCoordTasks ? 'COORDINACION' : 'MANUAL'),
              reviewedAt: r.reviewed_at || null,
              isCoordAssigned,
              tractorHasCoordTasks,
              semiHasCoordTasks,
              hasCoordTasks,
              assignedTasksCount: (trTaskInfo?.pending || 0) + (smTaskInfo?.pending || 0)
            };
          });
        }
      } catch (sbErr) {
        console.warn('[tallerApi] Supabase direct holds query failed, using REST fallback:', sbErr);
      }
    }

    // 2. Fallback REST backend
    const res = await panolFetch<{ success?: boolean; holds?: HoldUnit[]; units?: HoldUnit[] }>(
      `/api/holds/${encodeURIComponent(opId)}?_t=${Date.now()}`
    );
    if (res) {
      if (Array.isArray(res.holds)) return res.holds;
      if (Array.isArray(res.units)) return res.units;
    }
    return [];
  } catch (err) {
    console.error('Error fetching holds:', err);
    return [];
  }
}

/**
 * Agrega una unidad al puesto de trabajo en Supabase
 */
export async function addOperarioHoldUnit(payload: {
  opCode: string;
  tractorPlate?: string;
  tractorOt?: string;
  semiPlate?: string;
  semiOt?: string;
  brand?: string;
  brandSemi?: string;
}): Promise<HoldUnit | null> {
  try {
    const res = await panolFetch<{ success?: boolean; hold?: HoldUnit }>('/api/holds', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return res.hold || null;
  } catch (err) {
    console.error('Error adding hold unit:', err);
    return null;
  }
}

/**
 * Elimina una unidad del puesto de trabajo en Supabase
 */
export async function removeOperarioHoldUnit(holdId: string): Promise<boolean> {
  try {
    await panolFetch(`/api/holds/${encodeURIComponent(holdId)}`, {
      method: 'DELETE'
    });
    return true;
  } catch (err) {
    console.error('Error removing hold unit:', err);
    return false;
  }
}

/**
 * Marca una unidad retenida en el puesto como revisada por el operario
 */
export async function reviewOperarioHoldUnit(holdId: string): Promise<boolean> {
  try {
    const res = await panolFetch<{ success?: boolean }>(`/api/holds/${encodeURIComponent(holdId)}/review`, {
      method: 'POST'
    });
    return !!res?.success;
  } catch (err) {
    console.error('Error reviewing hold unit:', err);
    return false;
  }
}

/**
 * Solicita devolución de un repuesto de un pedido entregado
 */
export async function requestOrderReturn(payload: {
  id?: string;
  reqId: string;
  itemName?: string;
  returnQty?: number;
  reason?: string;
  opId?: string;
}): Promise<boolean> {
  try {
    await panolFetch('/api/pedidos/return', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return true;
  } catch (err) {
    console.error('Error requesting return:', err);
    return false;
  }
}

/**
 * Guarda las unidades retenidas por el operario
 */
export async function saveOperarioHoldUnits(opId: string, units: HoldUnit[]): Promise<boolean> {
  try {
    await rpcCall('saveOperarioHoldUnits', opId, units);
    return true;
  } catch (err) {
    console.error('Error saving holds:', err);
    return false;
  }
}

/**
 * Búsqueda bidireccional de Unidades y OTs
 */
export async function findUnitOrOt(
  query: string,
  type: 'TRACTOR' | 'OT' | 'OT_TRACTOR' | 'SEMI' | 'SEMI_OT'
): Promise<{
  success: boolean;
  unit?: string;
  ot?: string;
  semi?: string;
  semiOt?: string;
  marca?: string;
  marcaSemi?: string;
}> {
  try {
    const res = await rpcCall<any>('findUnitOrOt', query, type);
    return res || { success: false };
  } catch (err) {
    console.error('Error finding unit/ot:', err);
    return { success: false };
  }
}

/**
 * Obtiene las tareas de la unidad seleccionada (DB_OT_TASKS / SQL / ots_anteriores)
 */
export async function getUnitTimelineTasks(params: {
  tractorOt?: string;
  semiOt?: string;
  tractorPlate?: string;
  semiPlate?: string;
}): Promise<{
  success: boolean;
  tasks?: any[];
  progress?: number;
  timelineGroups?: TimelineGroup[];
  historicalNodes?: HistoricalNode[];
}> {
  try {
    const res = await rpcCall<any>('getUnitTimelineTasks', params);
    if (!res) return { success: false, timelineGroups: [], historicalNodes: [] };

    // Formatear si viene en formato SQL plano { tasks, progress }
    if (res.tasks && !res.timelineGroups) {
      const primaryOt = params.tractorOt || params.semiOt || 'OT-ACTIVA';
      const group: TimelineGroup = {
        ot: primaryOt,
        date: new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }),
        tasks: res.tasks.map((t: any) => ({
          id: String(t.id || t.task_id || t.task_index),
          taskIndex: t.task_index || t.taskIndex,
          rubro: t.rubro || t.sector || 'GENERAL',
          desc: t.desc || t.description || t.sector_task,
          descripcion: t.descripcion || t.desc || t.description || t.sector_task,
          sectorTask: t.sector_task || t.sectorTask,
          estado: t.estado || t.status || t.task_status || 'PENDIENTE',
          operario: t.assigned_staff_name || t.assignedStaffName || t.operario || '',
          assignedStaffId: t.worker_id || t.assigned_staff_id || t.assignedStaffId || null,
          workerId: t.worker_id || t.assigned_staff_id || t.assignedStaffId || null,
          assignedStaffName: t.assigned_staff_name || t.assignedStaffName || t.operario || '',
          assignedOpCode: t.assigned_op_code || t.assignedOpCode || '',
          box: t.box || t.ubicacion,
          ubicacion: t.ubicacion || t.box,
          empezo: t.empezo,
          termino: t.termino,
          isEmpezado: t.estado === 'EN_CURSO' || t.task_status === 'EN_CURSO' || !!t.empezo,
          isTerminado: t.estado === 'TERMINADO' || t.estado === 'COMPLETADA' || t.task_status === 'TERMINADO' || t.task_status === 'COMPLETADA' || !!t.termino,
        })),
        progress: res.progress || 0,
      };
      return {
        success: true,
        timelineGroups: [group],
        historicalNodes: res.historicalNodes || [],
        progress: res.progress,
      };
    }

    // Si viene timelineGroups desde backend Supabase, normalizar campos de worker y staff
    const normalizedGroups: TimelineGroup[] = (res.timelineGroups || []).map((g: any) => ({
      ...g,
      tasks: (g.tasks || []).map((t: any) => ({
        ...t,
        id: String(t.id || t.task_id || t.taskIndex),
        taskIndex: t.taskIndex || t.task_index,
        rubro: t.rubro || t.sector || 'GENERAL',
        desc: t.desc || t.description || t.sectorTask || t.sector_task,
        descripcion: t.descripcion || t.desc || t.description || t.sectorTask || t.sector_task,
        sectorTask: t.sectorTask || t.sector_task,
        estado: t.estado || t.status || (t.isTerminado ? 'COMPLETADA' : t.isEmpezado ? 'EN_CURSO' : 'PENDIENTE'),
        workerId: t.workerId || t.worker_id || t.assignedStaffId || t.assigned_staff_id || null,
        assignedStaffId: t.workerId || t.worker_id || t.assignedStaffId || t.assigned_staff_id || null,
        assignedStaffName: t.assignedStaffName || t.assigned_staff_name || t.operario || '',
        assignedOpCode: t.assignedOpCode || t.assigned_op_code || '',
        operario: t.assignedStaffName || t.assigned_staff_name || t.operario || '',
        box: t.box || t.ubicacion,
        ubicacion: t.ubicacion || t.box,
        isEmpezado: t.isEmpezado || t.estado === 'EN_CURSO' || !!t.empezo,
        isTerminado: t.isTerminado || t.estado === 'TERMINADO' || t.estado === 'COMPLETADA' || !!t.termino,
      })),
    }));

    return {
      success: true,
      timelineGroups: normalizedGroups,
      historicalNodes: res.historicalNodes || [],
      progress: res.progress,
    };
  } catch (err) {
    console.error('Error fetching timeline tasks:', err);
    return { success: false, timelineGroups: [], historicalNodes: [] };
  }
}

/**
 * Actualiza el estado de una tarea operativa (Empecé / Terminé)
 */
export async function updateTaskExecution(payload: {
  taskId: string;
  status?: 'PENDIENTE' | 'EN_CURSO' | 'TERMINADO';
  estado?: 'PENDIENTE' | 'EN_CURSO' | 'TERMINADO' | 'COMPLETADA';
  empezo?: string;
  termino?: string;
  operario?: string;
  workerId?: string;
  assignedStaffId?: string;
  ubicacion?: string;
  box?: string;
  otNumber?: string;
  plate?: string;
  isCompleted?: boolean;
}): Promise<any> {
  try {
    const res = await panolFetch('/api/tasks/update', {
      method: 'POST',
      body: JSON.stringify({
        taskId: payload.taskId,
        estado: payload.estado || payload.status,
        empezo: payload.empezo,
        termino: payload.termino,
        operario: payload.operario,
        workerId: payload.workerId || payload.assignedStaffId,
        assignedStaffId: payload.workerId || payload.assignedStaffId,
        ubicacion: payload.ubicacion || payload.box,
        otNumber: payload.otNumber,
        plate: payload.plate,
        isCompleted: payload.isCompleted,
      }),
    });
    return res;
  } catch (err) {
    return rpcCall('updateTaskExecution', payload);
  }
}

/**
 * Envía un pedido por lote de repuestos al Pañol
 */
export async function submitBatchOrder(payload: {
  opId: string;
  mechanicId?: string;
  mechanicName?: string;
  box: string;
  tractorPlate: string;
  semiPlate?: string;
  otNumber?: string;
  semiOt?: string;
  unitId?: string;
  targetType: 'TRACTOR' | 'SEMI';
  items: { code: string; name: string; qty: number; canje: boolean; notes?: string }[];
}): Promise<any> {
  return rpcCall('submitBatchRequest', payload);
}

/**
 * Obtiene información del entorno (Localhost vs Producción Render/Railway)
 */
export async function getEnvInfo(): Promise<{
  environment?: string;
  isProduction?: boolean;
  hosting?: string;
  spreadsheetTitle?: string;
  spreadsheetId?: string;
  spreadsheetIdShort?: string;
  serverTime?: string;
} | null> {
  try {
    return await panolFetch('/api/env-info');
  } catch (err) {
    return null;
  }
}

/**
 * Obtiene los pedidos activos e históricos combinando el endpoint REST y el RPC enriquecido
 */
export async function getOrdersFeed(): Promise<any[]> {
  try {
    const res = await panolFetch<any[]>('/api/orders');
    return Array.isArray(res) ? res : [];
  } catch (err) {
    console.error('Error fetching orders feed:', err);
    return [];
  }
}

/**
 * Marca un pedido como LISTO (preparado en pañol)
 */
export async function markOrderAsReady(
  reqId: string,
  panolOpId: string = 'panol',
  confirmedItems?: { name: string; qty: number }[]
): Promise<any> {
  return rpcCall('markAsReady', reqId, panolOpId, confirmedItems);
}

/**
 * Marca un pedido como ENTREGADO (retirado por mecánico)
 */
export async function markOrderAsDelivered(
  reqId: string,
  panolOpId: string = 'panol'
): Promise<any> {
  return rpcCall('markAsDelivered', reqId, panolOpId);
}

/**
 * Actualiza la cantidad de un ítem en un pedido PENDIENTE
 */
export async function updatePendingItemQty(
  reqId: string,
  itemName: string,
  newQty: number
): Promise<any> {
  return rpcCall('updatePendingItemQty', reqId, itemName, newQty);
}

/**
 * Elimina un ítem de un pedido PENDIENTE y restituye stock
 */
export async function removePendingItem(
  reqId: string,
  itemName: string
): Promise<any> {
  return rpcCall('removePendingItem', reqId, itemName);
}

/**
 * Agrega un nuevo ítem a un pedido PENDIENTE
 */
export async function addItemToPendingOrder(
  reqId: string,
  itemName: string,
  qty: number
): Promise<any> {
  return rpcCall('addItemToPendingOrder', reqId, itemName, qty);
}

/**
 * Busca repuestos en el inventario para agregar a un pedido
 */
export async function getInventoryItems(query: string): Promise<{
  id?: string;
  code?: string;
  item_code?: string;
  name: string;
  brand?: string;
  category?: string;
  stock?: number;
  loc?: string;
  requiereCanje?: boolean;
}[]> {
  try {
    const res = await rpcCall<any[]>('getInventoryItems', query);
    return Array.isArray(res) ? res : [];
  } catch (err) {
    console.error('Error searching inventory items:', err);
    return [];
  }
}

/**
 * Confirma la devolución o canje de un repuesto usado (Auditoría Pañol)
 */
export async function confirmReturnItem(
  reqId: string,
  itemName: string,
  action: 'confirm' | 'incident' = 'confirm'
): Promise<any> {
  return rpcCall('confirmReturnItem', reqId, itemName, action);
}

/**
 * Obtiene el feed de devoluciones y canjes pendientes desde Supabase (v_devoluciones_pendientes)
 */
export async function getPendingReturnsFeed(tipo?: 'NUEVO' | 'CANJE'): Promise<any[]> {
  try {
    const url = tipo ? `/api/devoluciones?tipo=${tipo}` : '/api/devoluciones';
    const res = await panolFetch<{ success?: boolean; devoluciones?: any[] }>(url);
    return Array.isArray(res.devoluciones) ? res.devoluciones : [];
  } catch (err) {
    console.error('Error fetching pending returns:', err);
    return [];
  }
}

/**
 * Obtiene el listado completo de devoluciones nuevas (pendientes e histórico)
 */
export async function getNewReturnsHistoryFeed(): Promise<any[]> {
  try {
    const res = await panolFetch<{ success?: boolean; devoluciones?: any[] }>('/api/devoluciones/nuevas');
    return Array.isArray(res.devoluciones) ? res.devoluciones : [];
  } catch (err) {
    console.error('Error fetching new returns history feed:', err);
    return [];
  }
}

/**
 * Envía la auditoría de devolución de repuesto anterior (RECIBÍ OK o INCOMPLETO)
 */
export async function submitReturnAudit(
  reqId: string,
  itemName: string,
  status: 'OK' | 'INCOMPLETO',
  declaredQty?: number | null,
  opId?: string,
  id?: string
): Promise<any> {
  return rpcCall('confirmReturnItem', reqId, itemName, opId || 'panol', status, declaredQty ?? null, id);
}

/**
 * Confirma el reintegro a stock de una devolución de repuesto nuevo (sin uso)
 */
export async function confirmNewReturn(
  reqId: string,
  itemName: string = 'ALL',
  returnQty: number | null = null,
  panolOpId: string = '',
  id?: string
): Promise<any> {
  return rpcCall('confirmNewReturn', reqId, itemName, returnQty, panolOpId, id);
}

/**
 * Obtiene la lista de pañoleros activos
 */
export async function getPanolStaffList(): Promise<{ id: string; name: string }[]> {
  try {
    const res = await rpcCall<any[]>('getPanolStaff');
    return Array.isArray(res) ? res : [];
  } catch (err) {
    console.error('Error fetching panol staff:', err);
    return [];
  }
}

/**
 * Obtiene el historial transaccional de movimientos de stock desde panol.v_stock_movements
 */
export async function getStockMovements(): Promise<any[]> {
  try {
    const res = await panolFetch<{ success?: boolean; movements?: any[] }>('/api/stock-movements');
    return Array.isArray(res.movements) ? res.movements : [];
  } catch (err) {
    console.error('Error fetching stock movements:', err);
    return [];
  }
}

/**
 * Alterna el indicador de canje obligatorio (requires_exchange) para un repuesto
 */
export async function toggleItemExchange(itemIdOrCode: string): Promise<any> {
  return panolFetch(`/api/items/${encodeURIComponent(itemIdOrCode)}/toggle-exchange`, {
    method: 'POST'
  });
}


