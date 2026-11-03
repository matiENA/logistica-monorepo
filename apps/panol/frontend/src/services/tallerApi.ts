import { panolFetch } from './api';
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
 */
export async function getOperarioHoldUnits(opId: string): Promise<HoldUnit[]> {
  try {
    const res = await panolFetch<{ success?: boolean; holds?: HoldUnit[] }>(`/api/holds/${encodeURIComponent(opId)}`);
    if (res && Array.isArray(res.holds)) {
      return res.holds;
    }
    const rpcRes = await rpcCall<any[]>('getOperarioHoldUnits', opId);
    return Array.isArray(rpcRes) ? rpcRes : [];
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
 * Solicita devolución de un repuesto de un pedido entregado
 */
export async function requestOrderReturn(payload: {
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
          id: String(t.id || t.task_index),
          taskIndex: t.task_index || t.taskIndex,
          rubro: t.rubro || t.sector || 'GENERAL',
          desc: t.desc || t.description,
          estado: t.estado || t.status || 'PENDIENTE',
          operario: t.operario,
          box: t.box,
          empezo: t.empezo,
          termino: t.termino,
          isEmpezado: t.estado === 'EN_CURSO' || !!t.empezo,
          isTerminado: t.estado === 'TERMINADO' || t.estado === 'COMPLETADA' || !!t.termino,
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

    return {
      success: true,
      timelineGroups: res.timelineGroups || [],
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
  ubicacion?: string;
  box?: string;
  otNumber?: string;
  plate?: string;
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
        ubicacion: payload.ubicacion || payload.box,
        otNumber: payload.otNumber,
        plate: payload.plate,
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
 * Obtiene los pedidos activos e históricos
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
 * Obtiene el feed de devoluciones y canjes pendientes desde Supabase
 */
export async function getPendingReturnsFeed(): Promise<any[]> {
  try {
    const res = await panolFetch<{ success?: boolean; devoluciones?: any[] }>('/api/devoluciones');
    return Array.isArray(res.devoluciones) ? res.devoluciones : [];
  } catch (err) {
    console.error('Error fetching pending returns:', err);
    return [];
  }
}

/**
 * Envía la auditoría de devolución (RECIBÍ OK o INCOMPLETO)
 */
export async function submitReturnAudit(
  reqId: string,
  itemName: string,
  status: 'OK' | 'INCOMPLETO',
  declaredQty?: number | null,
  opId?: string
): Promise<any> {
  return rpcCall('confirmReturnItem', reqId, itemName, opId || 'panol', status, declaredQty);
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
