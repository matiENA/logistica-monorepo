import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LicensePlate } from '../components/common/LicensePlate';
import { useAuthStore } from '../stores/authStore';
import {
  getOrdersFeed,
  markOrderAsReady,
  getPendingReturnsFeed,
  submitReturnAudit,
  getPanolStaffList,
} from '../services/tallerApi';
import { getSocket } from '../services/socket';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Plus,
  Minus,
  X,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ItemDetail {
  id: string;
  name: string;
  qty: number;
  code: string;
  loc: string;
  requiresExchange?: boolean;
}

interface PanolCardOrder {
  reqId: string;
  box: string;
  mechanic: string;
  elapsedTime: string;
  isUrgent?: boolean;
  otTractor?: string;
  brandTractor?: string;
  plateTractor: string;
  otSemi?: string;
  brandSemi?: string;
  plateSemi: string;
  items: ItemDetail[];
  deliveredBy?: string;
  status: 'PENDIENTE' | 'LISTO' | 'ENTREGADO';
}

/**
 * Resuelve la etiqueta y valor del Box o Sector según el protocolo legacy de Pañol:
 * - Si es numérico o 'BOX xx' (ej: '01', '25', '12 A') -> label 'BOX', isSector: false
 * - Si es un sector operativo (ej: 'LUBRICENTRO', 'MOTORES', 'LAVADERO', 'GOMERIA') -> isSector: true, sin prefijo BOX
 */
export function resolveBoxOrSector(rawBox?: string, opInfo?: string) {
  let rawLoc = (rawBox || '').trim();
  if ((!rawLoc || rawLoc.toLowerCase() === 'prueba' || rawLoc === '--') && opInfo) {
    const m = opInfo.match(/\[(.*?)\]/);
    if (m && m[1]) rawLoc = m[1].trim();
    if (!rawLoc) {
      const m2 = opInfo.match(/box\s*([0-9a-zA-Z]+)/i);
      if (m2) rawLoc = m2[0].trim();
    }
  }
  if (!rawLoc || rawLoc.toLowerCase() === 'prueba') rawLoc = '01';

  const cleanUpper = rawLoc.toUpperCase().replace(/^BOX\s*/i, '').trim();
  const isNumericBox = /^\d+[a-zA-Z]?$/.test(cleanUpper) || /^BOX\s*\d+/i.test(rawLoc) || cleanUpper === '--';

  if (isNumericBox) {
    return {
      isSector: false,
      label: 'BOX',
      value: cleanUpper || '01',
    };
  } else {
    return {
      isSector: true,
      label: '',
      value: cleanUpper || rawLoc,
    };
  }
}

export const MonitorPanol: React.FC = () => {
  const { logout } = useAuthStore();
  const navigate = useNavigate();

  // Tabs superiores: 'PEDIDOS' | 'DEV_ANTERIOR' | 'DEV_NUEVO'
  const [activeHeaderTab, setActiveHeaderTab] = useState<'PEDIDOS' | 'DEV_ANTERIOR' | 'DEV_NUEVO'>('PEDIDOS');
  const [subTab, setSubTab] = useState<'PENDIENTES' | 'COMPLETADOS'>('PENDIENTES');

  // Reloj en vivo (19:15 como en la captura)
  const [currentTime, setCurrentTime] = useState('');

  // Audio de sirena
  const [audioEnabled, setAudioEnabled] = useState(true);

  // Acordeón para expandir ítems por pedido
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});

  // Operario seleccionador "ENTREGADO POR"
  const [deliveredByMap, setDeliveredByMap] = useState<Record<string, string>>({});

  // Devoluciones y Canjes
  const [pendingReturns, setPendingReturns] = useState<any[]>([]);
  const [panolStaff, setPanolStaff] = useState<{ id: string; name: string }[]>([]);
  const [selectedStaffMap, setSelectedStaffMap] = useState<Record<string, string>>({});
  const [incompleteModalData, setIncompleteModalData] = useState<{
    reqId: string;
    itemName: string;
    originalQty: number;
    declaredQty: number;
  } | null>(null);
  const [incompleteQty, setIncompleteQty] = useState(1);

  // Lista de pedidos activos (con datos por defecto fieles a la captura de pantalla 2)
  const [orders, setOrders] = useState<PanolCardOrder[]>([
    {
      reqId: 'REQ-101',
      box: '01',
      mechanic: 'CERDA BRAIAN',
      elapsedTime: '03:33',
      isUrgent: true,
      otTractor: '11483',
      brandTractor: 'IVECO',
      plateTractor: 'AG 426 00',
      otSemi: '11483',
      brandSemi: 'DANES',
      plateSemi: 'AF 997 CP',
      items: [
        {
          id: 'i-1',
          name: 'FARO POSTERIOR DERECHA 5801631433',
          qty: 1,
          code: 'GR-20000097N',
          loc: 'Pañol Pañol Ppal -> A -> 20 -> :',
        },
        {
          id: 'i-1-b',
          name: 'LAMPARA 24V 21W 1 POLO',
          qty: 2,
          code: 'GR-10044',
          loc: 'Pañol Ppal -> B -> 02',
        },
        {
          id: 'i-1-c',
          name: 'FUSIBLE 15A MINI',
          qty: 4,
          code: 'GR-10090',
          loc: 'Pañol Ppal -> B -> 05',
        },
      ],
      status: 'PENDIENTE',
    },
    {
      reqId: 'REQ-102',
      box: '25',
      mechanic: 'LUCERO CARLOS',
      elapsedTime: '08:44',
      isUrgent: true,
      otTractor: '--',
      brandTractor: 'VOLVO',
      plateTractor: 'AE 617 01',
      otSemi: '--',
      brandSemi: 'FANGIO',
      plateSemi: 'AE 494 IL',
      items: [
        {
          id: 'i-2',
          name: 'SOPORTE ROTOR UNIVERSAL (ARCO) VIGIA',
          qty: 1,
          code: 'GR-92000709M',
          loc: 'B15D',
        },
        {
          id: 'i-2-b',
          name: 'MANGUERA POLIAMIDA 6MM AZUL',
          qty: 5,
          code: 'GR-8802',
          loc: 'Pañol Ppal -> C -> 12',
        },
        {
          id: 'i-2-c',
          name: 'CONECTOR RECTO 6MM ROSCA 1/8',
          qty: 2,
          code: 'GR-8840',
          loc: 'Pañol Ppal -> C -> 14',
        },
      ],
      status: 'PENDIENTE',
    },
    {
      reqId: 'REQ-103',
      box: '01',
      mechanic: 'CERDA BRAIAN',
      elapsedTime: '11:29',
      isUrgent: true,
      otTractor: '11477',
      brandTractor: 'IVECO',
      plateTractor: 'AD 217 WS',
      otSemi: '11510',
      brandSemi: 'FANGIO',
      plateSemi: 'KKA 535',
      items: [
        {
          id: 'i-3',
          name: 'BATERIA 12 V X 180. (IVECO)',
          qty: 2,
          code: 'GR-91002701N',
          loc: 'F12A',
        },
      ],
      status: 'PENDIENTE',
    },
    {
      reqId: 'REQ-104',
      box: '25',
      mechanic: 'LUCERO CARLOS',
      elapsedTime: '11:46',
      isUrgent: true,
      otTractor: '10809',
      brandTractor: 'TRACTOR',
      plateTractor: 'AI 420 AR',
      otSemi: '10670',
      brandSemi: 'FANGIO',
      plateSemi: 'AD 413 LP',
      items: [
        {
          id: 'i-4',
          name: 'FUELLE 32-195-390',
          qty: 1,
          code: 'GR-70004505N',
          loc: 'S/D',
        },
        {
          id: 'i-4-b',
          name: 'ABRAZADERA CREMALLERA 40-60',
          qty: 2,
          code: 'GR-3310',
          loc: 'Pañol Ppal -> E -> 01',
        },
      ],
      status: 'PENDIENTE',
    },
  ]);

  // Actualizar reloj
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
      );
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // Web Audio Synthesizer para la alarma del Pañol
  const playAlertSound = () => {
    if (!audioEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {}
  };

  // Carga inicial y WebSockets
  const knownReqIdsRef = useRef<Set<string>>(new Set(['REQ-101', 'REQ-102', 'REQ-103', 'REQ-104']));

  useEffect(() => {
    const socket = getSocket();
    fetchLiveOrders();
    loadPendingReturns();
    loadStaff();

    const handleSync = (incoming: any[]) => {
      fetchLiveOrders();
      loadPendingReturns();
      if (Array.isArray(incoming) && incoming.length > 0) {
        let hasNew = false;
        incoming.forEach((o) => {
          const reqId = o.req_code || o.reqId;
          if (reqId && !knownReqIdsRef.current.has(reqId)) {
            hasNew = true;
            knownReqIdsRef.current.add(reqId);
          }
        });
        if (hasNew) {
          playAlertSound();
          toast.info('🔔 ¡Nuevo pedido de repuestos en Pañol!');
        }
      }
    };

    socket.on('orders_sync', handleSync);
    return () => {
      socket.off('orders_sync', handleSync);
    };
  }, [audioEnabled]);

  const loadPendingReturns = async () => {
    try {
      const data = await getPendingReturnsFeed();
      setPendingReturns(data || []);
    } catch (err) {
      console.warn('Error loading pending returns:', err);
    }
  };

  const loadStaff = async () => {
    try {
      const staff = await getPanolStaffList();
      setPanolStaff(staff || []);
      // Si hay staff, preseleccionar al primer operario si no está seteado
      if (staff && staff.length > 0) {
        setSelectedStaffMap((prev) => {
          const updated = { ...prev };
          return updated;
        });
      }
    } catch (err) {
      console.warn('Error loading panol staff:', err);
    }
  };

  const fetchLiveOrders = async () => {
    try {
      const res = await getOrdersFeed();
      if (Array.isArray(res) && res.length > 0) {
        const mapped: PanolCardOrder[] = res.map((r: any) => {
          const now = Date.now();
          const orderTime = r.timestamp ? new Date(r.timestamp).getTime() : now;
          const diffMins = Math.max(0, Math.floor((now - orderTime) / 60000));
          const minsStr = String(diffMins).padStart(2, '0');
          const secsStr = String(Math.floor((now / 1000) % 60)).padStart(2, '0');

          return {
            reqId: r.reqId || r.req_code,
            box: r.box || r.box_number || '01',
            mechanic: r.opInfo || r.mechanic_name || 'MECÁNICO',
            elapsedTime: `${minsStr}:${secsStr}`,
            isUrgent: diffMins >= 15,
            otTractor: r.otNumber || r.ot_number || '--',
            brandTractor: r.tractorBrand || r.marca_tr || 'TRACTOR',
            plateTractor: r.tractorPlate || r.tractor || '--',
            otSemi: r.semiOt || (r.semi ? '--' : ''),
            brandSemi: r.semiBrand || r.marca_semi || 'SEMI',
            plateSemi: r.semiPlate || r.semi || '',
            items: (r.items || []).map((it: any, iIdx: number) => ({
              id: it.order_item_id || it.id || `it-${iIdx}`,
              name: it.name,
              qty: Math.round(Number(it.qty) || 1),
              code: it.code || 'GEN',
              loc: it.location || it.loc || 'Pañol Ppal',
            })),
            status: r.status || 'PENDIENTE',
          };
        });
        setOrders(mapped);
      }
    } catch (e) {
      console.warn('Error loading live orders:', e);
    }
  };

  // Agrupamiento de devoluciones por Pedido / Box para la vista DEV_ANTERIOR
  const groupedReturns = useMemo(() => {
    const map = new Map<string, {
      orderId: string;
      reqCode: string;
      boxNumber: string;
      otNumber: string;
      mechanicName: string;
      tractor: string;
      semi: string;
      items: any[];
    }>();

    pendingReturns.forEach((r: any) => {
      const reqCode = r.req_code || (r.order_number ? `REQ-${r.order_number}` : r.order_id);
      if (!map.has(reqCode)) {
        map.set(reqCode, {
          orderId: r.order_id,
          reqCode,
          boxNumber: r.box_number || '01',
          otNumber: r.ot_number || '--',
          mechanicName: r.mechanic_name || 'MECÁNICO',
          tractor: r.tractor || '',
          semi: r.semi || '',
          items: [],
        });
      }

      let canjeJson: any = null;
      if (typeof r.exchange_status === 'string' && r.exchange_status.trim().startsWith('{')) {
        try {
          canjeJson = JSON.parse(r.exchange_status);
        } catch (e) {}
      } else if (typeof r.exchange_status === 'object') {
        canjeJson = r.exchange_status;
      }

      const origQty = Math.round(Number(r.requested_qty || 1));
      let returnedQty = origQty;
      let reasonText = '';

      if (canjeJson && canjeJson.motivo) {
        reasonText = canjeJson.motivo;
      } else if (r.return_notes) {
        reasonText = r.return_notes;
      } else if (r.item_notes) {
        reasonText = r.item_notes;
      }

      if (canjeJson) {
        if (canjeJson.tipo === 'ENTREGO_USADA') {
          returnedQty = canjeJson.cant_entregada !== undefined ? canjeJson.cant_entregada : origQty;
        } else if (canjeJson.tipo === 'FALTANTE') {
          returnedQty = canjeJson.cant_entregada !== undefined ? canjeJson.cant_entregada : 0;
        }
      } else if (r.returned_qty !== undefined && r.returned_qty !== null && r.returned_qty !== '') {
        returnedQty = Math.round(Number(r.returned_qty));
      }

      const panolConf = String(r.panol_confirmation || '');
      const isResolved = panolConf.includes('OK') || panolConf.includes('INCOMPLETO');
      const isOk = panolConf.includes('OK');

      map.get(reqCode)!.items.push({
        orderItemId: r.order_item_id,
        itemName: r.item_name || 'REPUESTO',
        itemCode: r.item_code || '',
        location: r.location || '',
        originalQty: origQty,
        returnedQty,
        tipo: canjeJson?.tipo || 'NORMAL',
        motivo: reasonText,
        panolConfirmation: panolConf,
        isResolved,
        isOk,
      });
    });

    return Array.from(map.values());
  }, [pendingReturns]);

  // Auditoría: RECIBÍ OK
  const handleAuditOk = async (reqId: string, itemName: string, returnedQty: number) => {
    const panolOpId = selectedStaffMap[reqId];
    if (!panolOpId) {
      toast.warning('Por favor selecciona qué pañolero revisa el pedido primero.');
      return;
    }

    try {
      await submitReturnAudit(reqId, itemName, 'OK', returnedQty, panolOpId);
      toast.success(`Auditoría OK confirmada para ${itemName}.`);
      loadPendingReturns();
    } catch (err: any) {
      toast.error('Error al auditar devolución: ' + err.message);
    }
  };

  // Auditoría: Apertura de modal INCOMPLETO
  const openIncompleteModal = (reqId: string, itemName: string, originalQty: number, declaredQty: number) => {
    setIncompleteModalData({ reqId, itemName, originalQty, declaredQty });
    setIncompleteQty(declaredQty);
  };

  // Auditoría: Confirmar INCOMPLETO
  const handleConfirmIncomplete = async () => {
    if (!incompleteModalData) return;
    const { reqId, itemName } = incompleteModalData;
    const panolOpId = selectedStaffMap[reqId];
    if (!panolOpId) {
      toast.warning('Por favor selecciona qué pañolero revisa el pedido.');
      return;
    }

    try {
      await submitReturnAudit(reqId, itemName, 'INCOMPLETO', incompleteQty, panolOpId);
      toast.warning(`Devolución incompleta registrada (${incompleteQty} recibidas) para ${itemName}.`);
      setIncompleteModalData(null);
      loadPendingReturns();
    } catch (err: any) {
      toast.error('Error al registrar devolución incompleta: ' + err.message);
    }
  };

  // Stepper de cantidades en las tarjetas
  const updateItemQty = (reqId: string, itemId: string, delta: number) => {
    setOrders((prev) =>
      prev.map((ord) => {
        if (ord.reqId === reqId) {
          return {
            ...ord,
            items: ord.items
              .map((it) => {
                if (it.id === itemId) {
                  const newQty = it.qty + delta;
                  return newQty > 0 ? { ...it, qty: newQty } : null;
                }
                return it;
              })
              .filter((it): it is ItemDetail => it !== null),
          };
        }
        return ord;
      })
    );
  };

  const removeItem = (reqId: string, itemId: string) => {
    setOrders((prev) =>
      prev.map((ord) => {
        if (ord.reqId === reqId) {
          return {
            ...ord,
            items: ord.items.filter((it) => it.id !== itemId),
          };
        }
        return ord;
      })
    );
  };

  // Marcar como LISTO
  const handleMarkReady = async (ord: PanolCardOrder) => {
    const entregadoPor = deliveredByMap[ord.reqId] || 'Ema';
    try {
      await markOrderAsReady(
        ord.reqId,
        entregadoPor,
        ord.items.map((i) => ({ name: i.name, qty: i.qty }))
      );
      toast.success(`Pedido ${ord.reqId} (Box ${ord.box}) marcado como LISTO.`);
      setOrders((prev) =>
        prev.map((o) => (o.reqId === ord.reqId ? { ...o, status: 'LISTO' } : o))
      );
    } catch (err: any) {
      toast.error('Error al actualizar pedido: ' + err.message);
    }
  };

  const toggleExpand = (reqId: string) => {
    setExpandedOrders((prev) => ({ ...prev, [reqId]: !prev[reqId] }));
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#070A0F] text-[#F3F4F6] flex flex-col font-sans select-none overflow-x-hidden">
      {/* ========================================================================= */}
      {/* 1. TOPBAR HEADER (Exacto a la captura: PAÑOL | TABS | 19:15 | Salir)      */}
      {/* ========================================================================= */}
      <header className="h-[60px] bg-[#0A0D14] border-b border-[#1E2530] px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-8">
          <div className="text-xl font-black tracking-wider text-white">
            PAÑOL
          </div>

          {/* Selector de Pestañas Superiores */}
          <nav className="flex items-center gap-2">
            <button
              onClick={() => setActiveHeaderTab('PEDIDOS')}
              className={`px-4 py-1.5 rounded-lg text-xs font-black tracking-wider border transition-colors ${
                activeHeaderTab === 'PEDIDOS'
                  ? 'bg-[#111622] text-[#388BFD] border-[#388BFD]/60 shadow-sm'
                  : 'bg-transparent text-zinc-400 border-transparent hover:text-white'
              }`}
            >
              PEDIDOS
            </button>

            <button
              onClick={() => setActiveHeaderTab('DEV_ANTERIOR')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold tracking-wider flex items-center gap-2 border transition-colors ${
                activeHeaderTab === 'DEV_ANTERIOR'
                  ? 'bg-[#111622] text-[#388BFD] border-[#388BFD]/60 shadow-sm'
                  : 'bg-transparent text-zinc-400 border-transparent hover:text-white'
              }`}
            >
              <span>DEVOLUCIÓN REPUESTO ANTERIOR</span>
              <span className="w-5 h-5 rounded-full bg-[#D97706] text-black font-black text-[11px] flex items-center justify-center">
                {pendingReturns.length}
              </span>
            </button>

            <button
              onClick={() => setActiveHeaderTab('DEV_NUEVO')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold tracking-wider flex items-center gap-2 border transition-colors ${
                activeHeaderTab === 'DEV_NUEVO'
                  ? 'bg-[#111622] text-[#388BFD] border-[#388BFD]/60 shadow-sm'
                  : 'bg-transparent text-zinc-400 border-transparent hover:text-white'
              }`}
            >
              <span>DEVOLUCIÓN REPUESTO NUEVO</span>
              <span className="w-5 h-5 rounded-full bg-[#388BFD] text-black font-black text-[11px] flex items-center justify-center">
                0
              </span>
            </button>
          </nav>
        </div>

        {/* Reloj en Vivo & Botones de Audio y Salir */}
        <div className="flex items-center gap-5">
          <button
            onClick={() => {
              setAudioEnabled(!audioEnabled);
              if (!audioEnabled) playAlertSound();
            }}
            className="text-zinc-400 hover:text-white transition-colors"
            title="Activar o desactivar sirena"
          >
            {audioEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <span className="text-sm font-mono font-bold text-zinc-300">
            {currentTime || '19:15'}
          </span>

          <button
            onClick={handleLogout}
            className="px-4 py-1.5 rounded-lg text-xs font-bold text-zinc-300 hover:text-white bg-[#111622] border border-[#202938] hover:border-zinc-500 transition-colors"
          >
            Salir
          </button>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. SUBHEADER: PENDIENTES vs COMPLETADOS                                  */}
      {/* ========================================================================= */}
      <div className="h-12 bg-[#080B10] px-6 flex items-center gap-2 border-b border-[#1A2230]">
        <button
          onClick={() => setSubTab('PENDIENTES')}
          className={`px-4 py-1.5 rounded-lg text-xs font-black tracking-wider border transition-colors ${
            subTab === 'PENDIENTES'
              ? 'bg-[#0E1726] text-[#388BFD] border-[#388BFD]'
              : 'text-zinc-400 hover:text-white border-transparent'
          }`}
        >
          PENDIENTES
        </button>

        <button
          onClick={() => setSubTab('COMPLETADOS')}
          className={`px-4 py-1.5 rounded-lg text-xs font-bold tracking-wider transition-colors ${
            subTab === 'COMPLETADOS'
              ? 'bg-[#0E1726] text-[#388BFD] border border-[#388BFD]'
              : 'text-zinc-500 hover:text-white'
          }`}
        >
          COMPLETADOS
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 3. STREAM HORIZONTAL DE CARDS DE DESPACHO (Exacto a la captura 2)        */}
      {/* ========================================================================= */}
      {activeHeaderTab === 'PEDIDOS' && (
        <main className="flex-1 p-6 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-5 h-full items-start pb-4">
          {orders.map((ord) => {
            const isExpanded = expandedOrders[ord.reqId];
            const visibleItems = isExpanded ? ord.items : ord.items.slice(0, 1);
            const remainingCount = Math.max(0, ord.items.length - 1);

            return (
              <div
                key={ord.reqId}
                className="w-[305px] shrink-0 bg-[#0E131E] border border-[#1E2530] rounded-2xl p-4 flex flex-col justify-between shadow-xl shadow-black/60 relative group"
                style={{
                  borderImage: ord.isUrgent
                    ? 'linear-gradient(to bottom, #DC2626 0%, #1E2530 50%) 1'
                    : undefined,
                }}
              >
                {/* Header de Tarjeta: BOX + MECÁNICO + TIMER */}
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      {(() => {
                        const loc = resolveBoxOrSector(ord.box, ord.mechanic);
                        return loc.isSector ? (
                          <h2 className="text-xl font-black text-white leading-none tracking-tight uppercase">
                            {loc.value}
                          </h2>
                        ) : (
                          <h2 className="text-2xl font-black text-white leading-none tracking-tight flex items-baseline gap-1.5">
                            <span className="font-light text-zinc-400 text-xs tracking-wider">BOX</span>
                            <span>{loc.value}</span>
                          </h2>
                        );
                      })()}
                      <span className="text-xs font-black text-zinc-300 uppercase tracking-wide block mt-1">
                        {ord.mechanic}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-xs font-mono font-black text-[#F59E0B]">
                      <span>{ord.elapsedTime}</span>
                      <AlertTriangle className="w-3.5 h-3.5 fill-[#F59E0B] text-black" />
                    </div>
                  </div>

                  {/* Línea divisoria punteada */}
                  <div className="border-b border-dashed border-[#1E2530] my-3" />

                  {/* ============================================================ */}
                  {/* SECCIÓN DE PATENTES CON BARRA SUPERIOR AZUL & OT / MARCA    */}
                  {/* ============================================================ */}
                  <div className="flex items-center justify-between gap-2 mb-4">
                    {/* Patente Tractor */}
                    <LicensePlate
                      plate={ord.plateTractor}
                      ot={ord.otTractor}
                      brand={ord.brandTractor}
                      showOtBadge={true}
                      size="sm"
                    />

                    {/* Patente Semi */}
                    <LicensePlate
                      plate={ord.plateSemi}
                      ot={ord.otSemi}
                      brand={ord.brandSemi}
                      showOtBadge={true}
                      size="sm"
                    />
                  </div>

                  {/* ============================================================ */}
                  {/* LISTA DE ÍTEMS CON CONTADORES [-] [1] [+] [x]                */}
                  {/* ============================================================ */}
                  <div className="space-y-2 mb-3">
                    {visibleItems.map((item) => (
                      <div
                        key={item.id}
                        className="bg-[#080B10] border border-[#1A2230] rounded-xl p-3 flex flex-col gap-2"
                      >
                        {/* Nombre del repuesto */}
                        <div className="text-[11px] font-black text-white leading-tight uppercase">
                          {item.name}
                        </div>

                        {/* Fila del Modificador y Contador: [-] [qty] [+] [x] */}
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => updateItemQty(ord.reqId, item.id, -1)}
                            className="w-7 h-7 bg-[#111622] hover:bg-[#1A2230] text-zinc-300 font-black text-xs rounded border border-[#202938] flex items-center justify-center transition-colors"
                          >
                            <Minus className="w-3 h-3" />
                          </button>

                          <div className="w-8 h-7 bg-[#080B10] text-white font-mono font-black text-xs flex items-center justify-center border border-[#202938] rounded">
                            {item.qty}
                          </div>

                          <button
                            onClick={() => updateItemQty(ord.reqId, item.id, 1)}
                            className="w-7 h-7 bg-[#111622] hover:bg-[#1A2230] text-zinc-300 font-black text-xs rounded border border-[#202938] flex items-center justify-center transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                          </button>

                          <button
                            onClick={() => removeItem(ord.reqId, item.id)}
                            className="w-7 h-7 bg-[#111622] hover:bg-red-950/40 text-red-500 font-bold text-xs rounded border border-red-950/60 flex items-center justify-center transition-colors ml-1"
                            title="Quitar ítem"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Pills de Código y Ubicación */}
                        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                          <span className="px-2 py-0.5 rounded bg-[#161D2A] text-[#388BFD] font-mono text-[9px] font-black tracking-tight">
                            {item.code}
                          </span>

                          <span className="px-2 py-0.5 rounded bg-[#0D2447] text-[#60A5FA] text-[9px] font-bold tracking-tight truncate max-w-[180px]">
                            {item.loc}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Acordeón para ver más ítems */}
                  {remainingCount > 0 && (
                    <button
                      onClick={() => toggleExpand(ord.reqId)}
                      className="w-full text-center text-xs font-bold text-zinc-400 hover:text-white py-1 flex items-center justify-center gap-1 transition-colors"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="w-3.5 h-3.5" />
                          <span>Ocultar adicionales</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3.5 h-3.5" />
                          <span>Ver {remainingCount} más</span>
                        </>
                      )}
                    </button>
                  )}

                  {/* Botón Agregar Ítem */}
                  <button
                    onClick={() => {
                      toast.info(`Abriendo catálogo para Box ${ord.box}...`);
                    }}
                    className="w-full py-2 bg-transparent hover:bg-[#161D2A] border border-dashed border-[#202938] hover:border-[#388BFD] text-zinc-300 text-xs font-bold rounded-xl transition-colors mt-2"
                  >
                    Agregar item +
                  </button>
                </div>

                {/* ============================================================ */}
                {/* FOOTER: ENTREGADO POR + BOTÓN LISTO                          */}
                {/* ============================================================ */}
                <div className="pt-4 border-t border-[#1E2530] flex items-center gap-2 mt-3">
                  {/* Selector Entregado Por */}
                  <div className="flex-1 relative">
                    <select
                      value={deliveredByMap[ord.reqId] || 'Ema'}
                      onChange={(e) =>
                        setDeliveredByMap((prev) => ({ ...prev, [ord.reqId]: e.target.value }))
                      }
                      className="w-full bg-[#111622] border border-[#202938] rounded-lg px-2.5 py-1.5 text-xs font-extrabold text-zinc-300 outline-none focus:border-[#388BFD]"
                    >
                      <option value="Ema">ENTREGADO POR: Ema</option>
                      <option value="Matias">ENTREGADO POR: Matias</option>
                      <option value="Pañolero">ENTREGADO POR: Pañolero</option>
                    </select>
                  </div>

                  {/* Botón LISTO */}
                  <button
                    onClick={() => handleMarkReady(ord)}
                    className="px-5 py-1.5 bg-[#161D2A] hover:bg-[#202938] text-zinc-400 hover:text-white font-extrabold text-xs rounded-lg border border-[#202938] transition-colors"
                  >
                    LISTO
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </main>
      )}

      {/* ========================================================================= */}
      {/* 4. TAB DEVOLUCIÓN REPUESTO ANTERIOR (CANJES) - DISEÑO EXACTO A LA CAPTURA */}
      {/* ========================================================================= */}
      {activeHeaderTab === 'DEV_ANTERIOR' && (
        <main className="flex-1 p-6 overflow-y-auto">
          {groupedReturns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-950/40 border border-emerald-600 flex items-center justify-center text-emerald-400 text-xl font-bold mb-3">
                ✓
              </div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider">
                Sin Devoluciones Pendientes
              </h3>
              <p className="text-xs text-zinc-500 mt-1 max-w-sm">
                No hay repuestos viejos ni canjes pendientes a auditar en este momento.
              </p>
            </div>
          ) : (
            <div className="space-y-4 max-w-5xl mx-auto">
              {groupedReturns.map((card) => (
                <div
                  key={card.reqCode}
                  className="rounded-xl bg-[#161B22] border border-[#30363D] border-l-[6px] border-l-[#F59E0B] flex items-stretch shadow-lg overflow-hidden"
                >
                  {/* Columna Izquierda: Ubicación / Box, OT, Mecánico */}
                  {(() => {
                    const loc = resolveBoxOrSector(card.boxNumber, card.mechanicName);
                    return (
                      <div className="p-5 flex flex-col justify-center border-r border-dashed border-white/15 min-w-[200px] max-w-[220px] shrink-0 bg-[#0F141C]">
                        {!loc.isSector && (
                          <span className="text-[11px] font-black text-[#8B949E] tracking-wider uppercase">
                            BOX
                          </span>
                        )}
                        <span className={`${loc.isSector ? 'text-lg text-[#388BFD]' : 'text-2xl text-white'} font-black my-1 leading-tight tracking-tight uppercase`}>
                          {loc.value}
                        </span>
                        <span className="text-xs font-mono font-bold text-[#58A6FF]">
                          OT: {card.otNumber && card.otNumber !== '--' ? card.otNumber : '--'}
                        </span>
                        <span className="text-xs font-black text-[#8B949E] uppercase mt-1">
                          {card.mechanicName}
                        </span>
                      </div>
                    );
                  })()}

                  {/* Columna Derecha: Topbar con Selector de Pañolero + Filas de Repuestos */}
                  <div className="flex-1 flex flex-col">
                    {/* Top derecho con selector de Pañolero */}
                    <div className="flex justify-end p-3.5 pb-2">
                      <div className="w-72">
                        <select
                          value={selectedStaffMap[card.reqCode] || ''}
                          onChange={(e) =>
                            setSelectedStaffMap((prev) => ({ ...prev, [card.reqCode]: e.target.value }))
                          }
                          className="w-full bg-[#090D16] border border-[#30363D] rounded-lg px-3 py-1.5 text-white font-bold text-xs outline-none focus:border-[#388BFD]"
                        >
                          <option value="" disabled>👤 Revisa Pañolero...</option>
                          {panolStaff.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Lista de Repuestos de esta orden */}
                    <div className="flex flex-col flex-1 justify-center pb-2">
                      {card.items.map((it, idx) => (
                        <div
                          key={it.orderItemId || idx}
                          className={`flex items-center px-5 py-3 min-h-[56px] ${
                            idx < card.items.length - 1 ? 'border-b border-white/5' : ''
                          }`}
                        >
                          {/* Nombre del repuesto + Pedido Original + Motivo */}
                          <div
                            className={`flex-1 flex justify-between items-center pr-6 ${
                              it.isResolved ? 'opacity-40 grayscale pointer-events-none' : ''
                            }`}
                          >
                            <div className="flex flex-col">
                              <div className="text-sm font-black text-[#F0F6FC] tracking-tight">
                                • {it.itemName}{' '}
                                <span className="text-[#8B949E] font-medium text-xs">
                                  [Pedido Original: x{it.originalQty}]
                                </span>
                              </div>
                              {it.tipo === 'FALTANTE' && it.motivo && (
                                <div className="text-xs text-[#F59E0B] font-semibold mt-0.5">
                                  ⚠ Motivo faltante: {it.motivo}
                                </div>
                              )}
                            </div>

                            {/* Entrega count */}
                            <div className="flex items-baseline gap-2 shrink-0 ml-4">
                              <span className="text-[#F59E0B] font-bold text-xs uppercase">entrega:</span>
                              <span className="text-white text-3xl font-black min-w-[28px] text-right leading-none">
                                {it.returnedQty}
                              </span>
                            </div>
                          </div>

                          {/* Botones de acción / Estado auditado */}
                          <div className="w-[280px] pl-5 shrink-0 border-l border-white/10 flex items-center">
                            {it.isResolved ? (
                              <div
                                className={`w-full text-center py-2 px-3 text-xs font-black rounded-lg border ${
                                  it.isOk
                                    ? 'bg-emerald-950/40 text-emerald-400 border-emerald-600'
                                    : 'bg-amber-950/40 text-amber-400 border-amber-600'
                                }`}
                              >
                                {it.isOk ? '✓ AUDITADO OK' : '⚠ AUDITADO INCOMPLETO'}
                              </div>
                            ) : (
                              <div className="flex gap-2 w-full">
                                <button
                                  onClick={() => handleAuditOk(card.reqCode, it.itemName, it.returnedQty)}
                                  className="flex-1 py-2 px-3 text-xs font-black bg-emerald-900/30 hover:bg-emerald-800/50 text-[#3FB950] border border-[#238636] rounded-lg transition-colors uppercase whitespace-nowrap"
                                  title={`Confirmar que recibiste exactamente ${it.returnedQty} unidad(es)`}
                                >
                                  ✓ RECIBÍ {it.returnedQty}
                                </button>
                                <button
                                  onClick={() =>
                                    openIncompleteModal(card.reqCode, it.itemName, it.originalQty, it.returnedQty)
                                  }
                                  className="flex-1 py-2 px-3 text-xs font-black bg-transparent hover:bg-amber-950/30 text-[#F59E0B] border border-[#D97706] rounded-lg transition-colors uppercase whitespace-nowrap"
                                  title={`Reportar que NO recibiste las ${it.returnedQty} unidad(es)`}
                                >
                                  INCOMPLETO
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      )}

      {/* ========================================================================= */}
      {/* 5. TAB DEVOLUCIÓN REPUESTO NUEVO                                         */}
      {/* ========================================================================= */}
      {activeHeaderTab === 'DEV_NUEVO' && (
        <main className="flex-1 p-6 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-full bg-blue-950/40 border border-blue-600 flex items-center justify-center text-blue-400 text-xl font-bold mb-3">
            📦
          </div>
          <h3 className="text-sm font-black text-white uppercase tracking-wider">
            Sin Devoluciones de Repuestos Nuevos
          </h3>
          <p className="text-xs text-zinc-500 mt-1 max-w-sm">
            No hay repuestos nuevos devueltos a stock pendientes de reintegrar.
          </p>
        </main>
      )}

      {/* Modal Declaración Incompleta */}
      {incompleteModalData && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 max-w-sm w-full space-y-4 shadow-2xl">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-white flex items-center gap-2">
                  <span>⚠️</span>
                  <span>Declaración de Devolución Incompleta</span>
                </h3>
                <button
                  onClick={() => setIncompleteModalData(null)}
                  className="text-zinc-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="bg-[#0D1117] border border-[#30363D] rounded-lg p-2.5 mt-3 text-xs text-zinc-300">
                <span className="font-black text-white block">{incompleteModalData.itemName}</span>
                <span className="text-zinc-400 text-[11px] block mt-0.5">
                  El mecánico declaró:{' '}
                  <strong className="text-white">{incompleteModalData.declaredQty}</strong> de{' '}
                  <strong className="text-white">{incompleteModalData.originalQty}</strong> unidad(es)
                </span>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-zinc-300 block mb-1.5">
                Cantidad efectivamente recibida:
              </label>
              <input
                type="number"
                min="0"
                max={incompleteModalData.originalQty}
                value={incompleteQty}
                onChange={(e) => setIncompleteQty(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="w-full bg-[#0D1117] border border-[#388BFD] rounded-lg px-3 py-2 text-white font-black text-lg outline-none text-center"
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#30363D]">
              <button
                onClick={() => setIncompleteModalData(null)}
                className="px-3 py-1.5 rounded text-xs font-bold text-zinc-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmIncomplete}
                className="px-4 py-1.5 bg-[#D97706] hover:bg-[#B45309] text-black font-black text-xs rounded transition-colors uppercase"
              >
                Confirmar Incompleto
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
