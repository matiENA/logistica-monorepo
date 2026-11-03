import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import {
  getOrdersFeed,
  markOrderAsReady,
  getPendingReturnsFeed,
  getNewReturnsHistoryFeed,
  submitReturnAudit,
  getPanolStaffList,
  getEnvInfo,
  updatePendingItemQty,
  removePendingItem,
  addItemToPendingOrder,
  getInventoryItems,
  confirmNewReturn,
} from '../services/tallerApi';
import { getSocket } from '../services/socket';
import { useNavigate } from 'react-router-dom';

export interface PanolItem {
  id: string;
  order_item_id?: string;
  code?: string;
  item_code?: string;
  name: string;
  qty: number;
  loc: string;
  note?: string;
  notesColO?: string;
  requiereCanje?: boolean;
  estadoCanje?: string;
  panolConfirmacion?: string;
  stock?: number;
  status?: string;
}

export interface PanolOrderData {
  reqId: string;
  opId?: string;
  timestamp?: string;
  box?: string;
  opInfo?: string;
  otNumber?: string;
  semiOt?: string;
  unitInfo?: string;
  tractorPlate?: string;
  tractorBrand?: string;
  semiPlate?: string;
  semiBrand?: string;
  product?: string;
  brand?: string;
  status: string;
  panolOpId?: string;
  items: PanolItem[];
  notes?: string;
  uiColor?: string;
  uiPing?: string | null;
}

/**
 * Resuelve la etiqueta y valor del Box o Sector según el protocolo legacy de Pañol:
 * - Si es numérico o 'BOX xx' (ej: '01', '25', '12 A') -> label 'BOX', isSector: false
 * - Si es un sector operativo (ej: 'LUBRICENTRO', 'MOTORES', 'LAVADERO', 'GOMERIA') -> isSector: true, sin prefijo BOX
 */
export function resolveBoxOrSector(rawBox?: string, opInfo?: string) {
  let rawLoc = (rawBox || '').trim();
  if (!rawLoc && opInfo) {
    const m = opInfo.match(/\[(.*?)\]/);
    if (m && m[1]) rawLoc = m[1].trim();
  }
  if (!rawLoc && opInfo) {
    const m2 = opInfo.match(/box\s*([0-9a-zA-Z]+)/i);
    if (m2) rawLoc = m2[0].trim();
  }
  if (!rawLoc) rawLoc = '--';

  const cleanUpper = rawLoc.toUpperCase().replace(/^BOX\s*/i, '').trim();
  const isNumericBox =
    /^\d+[a-zA-Z]?$/.test(cleanUpper) ||
    /^BOX\s*\d+/i.test(rawLoc) ||
    cleanUpper === '--';

  if (isNumericBox) {
    return {
      isSector: false,
      label: 'BOX',
      value: cleanUpper || '--',
    };
  } else {
    return {
      isSector: true,
      label: '',
      value: cleanUpper || rawLoc,
    };
  }
}

export function formatPlate(plate?: string): string {
  if (!plate) return '';
  const clean = plate.replace(/[\s-]/g, '').toUpperCase();
  if (clean.length === 7) {
    return `${clean.slice(0, 2)} ${clean.slice(2, 5)} ${clean.slice(5, 7)}`;
  } else if (clean.length === 6) {
    return `${clean.slice(0, 3)} ${clean.slice(3, 6)}`;
  }
  return plate;
}

export function formatLocationBox(
  unitInfo?: string,
  firstItemLoc?: string,
  opInfo?: string,
  box?: string
): { isSector: boolean; label: string; value: string; number: string } {
  let rawLoc = (box || '').trim();

  // 1. Matchear ubicación entre corchetes ej: [BOX 25] o [LUBRICENTRO] en opInfo
  if (!rawLoc && opInfo) {
    const opBracket = opInfo.match(/\[(.*?)\]/);
    if (opBracket && opBracket[1]) {
      rawLoc = opBracket[1].trim();
    }
  }

  // 2. Matchear ubicación entre corchetes en unitInfo (que no sea patente vehicular)
  if (!rawLoc && unitInfo) {
    const bracketMatch = unitInfo.match(/\[(.*?)\]/);
    if (
      bracketMatch &&
      bracketMatch[1] &&
      !/^[A-Z0-9]{6,8}$/i.test(bracketMatch[1].trim())
    ) {
      rawLoc = bracketMatch[1].trim();
    }
  }

  // 3. Matchear "BOX <numero>" directo en unitInfo u opInfo
  if (!rawLoc) {
    const boxMatch = (`${unitInfo || ''} ${opInfo || ''}`).match(/BOX\s*\d+/i);
    if (boxMatch) rawLoc = boxMatch[0].trim();
  }

  // 4. Matchear ubicación de estantería o ítem si no es S/D
  if (!rawLoc && firstItemLoc && firstItemLoc !== 'S/D') {
    rawLoc = String(firstItemLoc).trim();
  }

  // 5. Fallback si no hay ubicación definida
  if (!rawLoc) {
    rawLoc = '--';
  }

  const cleanUpper = rawLoc.toUpperCase().replace(/^BOX\s*/i, '').trim();
  const isNumericBox =
    /^\d+[a-zA-Z]?$/.test(cleanUpper) ||
    /^BOX\s*\d+/i.test(rawLoc) ||
    cleanUpper === '--';

  if (isNumericBox) {
    const val = cleanUpper || '--';
    return {
      isSector: false,
      label: 'BOX',
      value: val,
      number: val,
    };
  } else {
    const val = cleanUpper || rawLoc;
    return {
      isSector: true,
      label: '',
      value: val,
      number: val,
    };
  }
}

function getDynamicMaxVisibleItems(order: PanolOrderData, vh: number): number {
  if (!order || !order.items || order.items.length <= 1) return 1;

  // Espacio disponible para la tarjeta: altura del viewport menos cabecera (130px), padding superior/inferior del tablero y margen de seguridad (24px)
  const maxCardHeight = Math.max(350, vh - 146 - 24);

  // Altura fija no negociable de la tarjeta:
  // Cabecera (~73px) + separador punteado (~15px) + bloque tractor/semi (~75px) + separador sólido (~15px) + padding inferior ítems (~12px) + footer (~58px)
  let fixedOverhead = 248;
  if (order.status === 'PENDIENTE') {
    fixedOverhead += 46; // Botón "Agregar item +" (36px + 10px gap)
  }

  let availableForItems = maxCardHeight - fixedOverhead;
  const VER_MAS_BTN_HEIGHT = 46; // Botón "Ver más" (36px + 10px gap)

  let count = 0;
  for (let i = 0; i < order.items.length; i++) {
    const item = order.items[i];
    const hasNote = Boolean((item.note || item.notesColO || '').trim());
    const itemHeight = hasNote ? 165 : 138;

    const isLastItem = i === order.items.length - 1;
    const requiredSpace = itemHeight + (isLastItem ? 0 : VER_MAS_BTN_HEIGHT);

    if (availableForItems >= requiredSpace || count === 0) {
      availableForItems -= itemHeight;
      count++;
    } else {
      break;
    }
  }

  return Math.max(1, count);
}

export function cleanItemNote(note?: string): string {
  if (!note) return '';
  return note.replace(/Despacho listo:[^|]*(\|)?\s*/gi, '').trim();
}

export function isUuid(val?: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(val || '').trim()
  );
}

function normalizeRawOrder(r: any, pendingQtyEdits: Record<string, Record<string, number>>): PanolOrderData {
  const reqId = String(r.reqId || r.req_code || '');
  const edits = pendingQtyEdits[reqId] || {};

  const rawItems = Array.isArray(r.items) ? r.items : [];
  const items: PanolItem[] = rawItems.map((it: any) => {
    const name = String(it.name || it.item_name || 'REPUESTO').trim();
    const key = name.toLowerCase();
    const rawQty = Number(it.qty ?? it.quantity ?? 1) || 1;
    const finalQty = edits[key] !== undefined ? edits[key] : rawQty;
    const rawCode = String(it.code || it.item_code || '').trim();
    const rawId = String(it.id || it.order_item_id || '').trim();

    const resolvedCode =
      (rawCode && !isUuid(rawCode) ? rawCode : null) ||
      (!isUuid(rawId) ? rawId : null) ||
      '';

    return {
      id: rawId || resolvedCode || 'S/D',
      order_item_id: rawId,
      code: resolvedCode,
      item_code: resolvedCode,
      name,
      qty: finalQty,
      loc: String(it.loc || it.location || 'S/D').trim() || 'S/D',
      note: cleanItemNote(String(it.note || it.notes || '')),
      notesColO: cleanItemNote(String(it.notesColO || it.return_notes || '')),
      requiereCanje: Boolean(it.requiereCanje || it.requires_exchange),
      estadoCanje:
        typeof it.estadoCanje === 'string'
          ? it.estadoCanje
          : typeof it.exchange_status === 'string'
          ? it.exchange_status
          : it.exchange_status
          ? JSON.stringify(it.exchange_status)
          : '',
      panolConfirmacion: String(it.panolConfirmacion || it.panol_confirmation || it.panolConfirmation || '').trim(),
      stock: Number(it.stock) || 0,
      status: String(it.status || r.status || r.order_status || 'PENDIENTE').trim(),
    };
  });

  const tractorPlate = String(r.tractorPlate || r.tractor || '').trim();
  const semiPlate = String(r.semiPlate || r.semi || '').trim();
  const unitInfo =
    r.unitInfo ||
    (tractorPlate && semiPlate
      ? `${tractorPlate} / ${semiPlate}`
      : tractorPlate || semiPlate || '');

  return {
    reqId,
    opId: String(r.opId || r.mechanic_op_code || ''),
    timestamp: r.timestamp || r.created_at || '',
    box: String(r.box || r.box_number || '').trim(),
    opInfo: String(r.opInfo || r.mechanic_name || 'Sin asignar').trim(),
    otNumber: String(r.otNumber || r.ot_number || '').trim(),
    semiOt: String(r.semiOt || r.semi_ot || '').trim(),
    unitInfo,
    tractorPlate,
    tractorBrand: String(r.tractorBrand || r.marca_tr || r.brand || '').trim(),
    semiPlate,
    semiBrand: String(r.semiBrand || r.marca_semi || '').trim(),
    product: String(r.product || '').trim(),
    brand: String(r.brand || r.tractorBrand || r.marca_tr || '').trim(),
    status: String(r.status || r.order_status || 'PENDIENTE').trim(),
    panolOpId: String(r.panolOpId || r.panol_staff_id || '').trim(),
    items,
    notes: String(r.notes || r.order_notes || '').trim(),
    uiColor: r.uiColor || 'default',
    uiPing: r.uiPing || null,
  };
}

export const MonitorPanol: React.FC = () => {
  const { logout } = useAuthStore();
  const navigate = useNavigate();

  // Vistas principales: 'despacho' | 'returns' | 'returns-new'
  const [activeView, setActiveView] = useState<'despacho' | 'returns' | 'returns-new'>('despacho');
  const [currentPedidosSubtab, setCurrentPedidosSubtab] = useState<'PENDIENTES' | 'COMPLETADOS'>('PENDIENTES');

  // Datos principales
  const [allOrders, setAllOrders] = useState<PanolOrderData[]>([]);
  const [pendingReturnsSql, setPendingReturnsSql] = useState<any[]>([]);
  const [newReturnsSql, setNewReturnsSql] = useState<any[]>([]);
  const [panolStaffList, setPanolStaffList] = useState<{ id: string; name: string }[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);

  // Badge de entorno (sólo en localhost / pruebas)
  const [envInfo, setEnvInfo] = useState<{
    isProduction?: boolean;
    spreadsheetTitle?: string;
    environment?: string;
  } | null>(null);

  // Reloj 24hs HH:mm
  const [clockText, setClockText] = useState<string>('--:--');

  // Altura de ventana para cálculo dinámico de ítems visibles (getDynamicMaxVisibleItems)
  const [viewportHeight, setViewportHeight] = useState<number>(
    typeof window !== 'undefined' ? window.innerHeight || 800 : 800
  );

  // Estados de interacción en tarjetas
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [pendingSelections, setPendingSelections] = useState<Record<string, string>>({});
  const [pendingQtyEdits, setPendingQtyEdits] = useState<Record<string, Record<string, number>>>({});
  const pendingQtyEditsRef = useRef<Record<string, Record<string, number>>>({});
  pendingQtyEditsRef.current = pendingQtyEdits;

  // Instancia de 5 segundos para deshacer ("CANCELAR LISTO")
  const [undoTimers, setUndoTimers] = useState<
    Record<string, { panolOpId: string; secondsLeft: number }>
  >({});
  const undoTimersRef = useRef<Record<string, { panolOpId: string; secondsLeft: number }>>({});
  undoTimersRef.current = undoTimers;
  const undoIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  // Estados visuales de ejecución / validación (shake-error, shake-card, opacidad al ejecutar)
  const [executingReadyMap, setExecutingReadyMap] = useState<Record<string, boolean>>({});
  const [shakingSelectIds, setShakingSelectIds] = useState<Record<string, boolean>>({});
  const [shakingCards, setShakingCards] = useState<Record<string, boolean>>({});
  const [auditingItemsMap, setAuditingItemsMap] = useState<Record<string, boolean>>({});
  const [reintegratingRowMap, setReintegratingRowMap] = useState<Record<string, boolean>>({});

  // Modales (Eliminar Ítem, Agregar Ítem, Declaración Incompleta)
  const [removeModalData, setRemoveModalData] = useState<{
    reqId: string;
    itemName: string;
  } | null>(null);

  const [addItemModalReqId, setAddItemModalReqId] = useState<string | null>(null);
  const [addItemSearchQuery, setAddItemSearchQuery] = useState<string>('');
  const [addItemSearchResults, setAddItemSearchResults] = useState<
    { name: string; stock: number; code?: string }[]
  >([]);
  const [isSearchingInventory, setIsSearchingInventory] = useState<boolean>(false);
  const [addItemSelectedItem, setAddItemSelectedItem] = useState<{
    name: string;
    stock: number;
    code?: string;
  } | null>(null);
  const [addItemQty, setAddItemQty] = useState<number>(1);
  const addItemSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addItemInputRef = useRef<HTMLInputElement | null>(null);

  const [incompleteModalData, setIncompleteModalData] = useState<{
    reqId: string;
    itemName: string;
    originalQty: number;
    declaredByMechanic: number;
    itemTag: string;
    id?: string;
  } | null>(null);
  const [incompleteQtyInput, setIncompleteQtyInput] = useState<string>('0');
  const incompleteInputRef = useRef<HTMLInputElement | null>(null);

  // Referencias para Carousel Auto-Scroll, Polling, Alertas y Memoria de Scroll
  const viewDespachoRef = useRef<HTMLElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const isCarouselHoveredRef = useRef<boolean>(false);
  const lastCardInteractionTimeRef = useRef<number>(0);
  const cardItemsScrollMemoryRef = useRef<Record<string, number>>({});
  const isPollingPausedRef = useRef<boolean>(false);
  const knownReqIdsRef = useRef<Set<string> | null>(null);
  const lastPingMemRef = useRef<Record<string, string>>({});
  const titleFlashIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const apiQueueRef = useRef<Array<(done: () => void) => void>>([]);
  const isProcessingQueueRef = useRef<boolean>(false);

  // Trigger shake animation on a select element
  const triggerSelectShake = useCallback((selectKey: string) => {
    setShakingSelectIds((prev) => ({ ...prev, [selectKey]: false }));
    setTimeout(() => {
      setShakingSelectIds((prev) => ({ ...prev, [selectKey]: true }));
      setTimeout(() => {
        setShakingSelectIds((prev) => ({ ...prev, [selectKey]: false }));
      }, 450);
    }, 10);
  }, []);

  // Cola secuencial de tareas API (idéntica a enqueueApiTask en panol.html)
  const processApiQueue = useCallback(() => {
    if (isProcessingQueueRef.current || apiQueueRef.current.length === 0) return;
    isProcessingQueueRef.current = true;
    const nextTask = apiQueueRef.current.shift();
    if (nextTask) {
      nextTask(() => {
        isProcessingQueueRef.current = false;
        setTimeout(processApiQueue, 150);
      });
    } else {
      isProcessingQueueRef.current = false;
    }
  }, []);

  const enqueueApiTask = useCallback(
    (taskFn: (done: () => void) => void) => {
      apiQueueRef.current.push(taskFn);
      processApiQueue();
    },
    [processApiQueue]
  );

  // === SISTEMA DE ALERTA SONORA, FAVICON Y FLASH DE TÍTULO ===
  const updateBrowserFavicon = useCallback((hasAlert: boolean) => {
    let faviconEl = document.getElementById('favicon') as HTMLLinkElement | null;
    if (!faviconEl) {
      faviconEl = document.createElement('link');
      faviconEl.id = 'favicon';
      faviconEl.rel = 'icon';
      faviconEl.type = 'image/png';
      document.head.appendChild(faviconEl);
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.font = '46px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔧', 32, 34);

      if (hasAlert) {
        ctx.beginPath();
        ctx.arc(48, 16, 12, 0, 2 * Math.PI);
        ctx.fillStyle = '#f85149';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#0d1117';
        ctx.stroke();
      }
      faviconEl.href = canvas.toDataURL('image/png');
    } catch (e) {}
  }, []);

  const setDocumentTitle = useCallback((titleText: string) => {
    document.title = titleText;
    try {
      if (window.top && window.top !== window) {
        window.top.document.title = titleText;
      }
    } catch (e) {}
  }, []);

  const playAlertSound = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const audioCtx = new AudioCtx();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.3);
    } catch (e) {}
  }, []);

  const clearWindowsTaskbarAlert = useCallback(() => {
    if (titleFlashIntervalRef.current) {
      clearInterval(titleFlashIntervalRef.current);
      titleFlashIntervalRef.current = null;
      setDocumentTitle('Pañol');
      updateBrowserFavicon(false);
    }
    if ('clearAppBadge' in navigator) {
      try {
        (navigator as any).clearAppBadge();
      } catch (e) {}
    }
  }, [setDocumentTitle, updateBrowserFavicon]);

  const triggerWindowsTaskbarAlert = useCallback(
    (order?: PanolOrderData) => {
      const target = order || ({ opInfo: 'Mecánico', unitInfo: 'General' } as PanolOrderData);
      try {
        window.focus();
      } catch (e) {}
      try {
        if (window.top) window.top.focus();
      } catch (e) {}

      if ('setAppBadge' in navigator) {
        try {
          (navigator as any).setAppBadge(1);
        } catch (e) {}
      }

      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          const notif = new Notification('Pañol: ¡Nuevo Pedido!', {
            body: `Solicitud de ${target.opInfo || 'Mecánico'} - Unidad: ${target.unitInfo || 'S/D'}`,
            tag: 'new-card-alert',
            requireInteraction: true,
          });
          notif.onclick = () => {
            try {
              window.focus();
            } catch (e) {}
            try {
              if (window.top) window.top.focus();
            } catch (e) {}
            clearWindowsTaskbarAlert();
          };
        } catch (e) {}
      }

      if (titleFlashIntervalRef.current) {
        clearInterval(titleFlashIntervalRef.current);
      }
      let flashState = false;
      titleFlashIntervalRef.current = setInterval(() => {
        const titleStr = flashState ? '🔴 (1) ¡NUEVO PEDIDO! | Pañol' : 'Pañol';
        setDocumentTitle(titleStr);
        updateBrowserFavicon(flashState);
        flashState = !flashState;
      }, 500);

      playAlertSound();
    },
    [clearWindowsTaskbarAlert, playAlertSound, setDocumentTitle, updateBrowserFavicon]
  );

  const checkForNewCardsAlert = useCallback(
    (orders: PanolOrderData[]) => {
      const pendingOrders = (orders || []).filter((o) => o.status === 'PENDIENTE');
      const currentPendingIds = new Set(pendingOrders.map((o) => String(o.reqId)));

      if (knownReqIdsRef.current === null) {
        knownReqIdsRef.current = currentPendingIds;
        return;
      }

      let brandNewCard: PanolOrderData | null = null;
      pendingOrders.forEach((o) => {
        if (!knownReqIdsRef.current!.has(String(o.reqId))) {
          brandNewCard = o;
        }
      });

      knownReqIdsRef.current = currentPendingIds;

      if (brandNewCard) {
        triggerWindowsTaskbarAlert(brandNewCard);
      }
    },
    [triggerWindowsTaskbarAlert]
  );

  // Procesar órdenes recibidas
  const onDataReceived = useCallback(
    (rawOrders: any[]) => {
      const normalized = (rawOrders || []).map((r) =>
        normalizeRawOrder(r, pendingQtyEditsRef.current)
      );

      checkForNewCardsAlert(normalized);
      setAllOrders(normalized);
      setIsInitialLoading(false);

      // Detectar pings de alerta en tarjetas (shake-card)
      normalized.forEach((o) => {
        if (o.uiPing && String(o.uiPing) !== String(lastPingMemRef.current[o.reqId])) {
          lastPingMemRef.current[o.reqId] = String(o.uiPing);
          setShakingCards((prev) => ({ ...prev, [o.reqId]: true }));
          setTimeout(() => {
            setShakingCards((prev) => ({ ...prev, [o.reqId]: false }));
          }, 1000);
        }
      });
    },
    [checkForNewCardsAlert]
  );

  const loadData = useCallback(async () => {
    try {
      const [ordersRes, returnsRes, newReturnsRes] = await Promise.allSettled([
        getOrdersFeed(),
        getPendingReturnsFeed('CANJE'),
        getNewReturnsHistoryFeed(),
      ]);

      if (ordersRes.status === 'fulfilled' && Array.isArray(ordersRes.value)) {
        onDataReceived(ordersRes.value);
      } else {
        setIsInitialLoading(false);
      }

      if (returnsRes.status === 'fulfilled' && Array.isArray(returnsRes.value)) {
        setPendingReturnsSql(returnsRes.value);
      }

      if (newReturnsRes.status === 'fulfilled' && Array.isArray(newReturnsRes.value)) {
        setNewReturnsSql(newReturnsRes.value);
      }
    } catch (err) {
      console.warn('Load hiccup, retrying automatically...', err);
      setIsInitialLoading(false);
    }
  }, [onDataReceived]);

  const pausePolling = useCallback(() => {
    isPollingPausedRef.current = true;
    lastCardInteractionTimeRef.current = Date.now();
  }, []);

  const resumePolling = useCallback(() => {
    isPollingPausedRef.current = false;
    lastCardInteractionTimeRef.current = Date.now();
  }, []);

  // Reloj en vivo (24hs HH:mm)
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      setClockText(`${hh}:${mm}`);
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  // Permiso de notificaciones e interacción para limpiar alerta de barra de tareas
  useEffect(() => {
    setDocumentTitle('Pañol');
    const handleFirstClick = () => {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
      clearWindowsTaskbarAlert();
    };
    window.addEventListener('focus', clearWindowsTaskbarAlert);
    document.addEventListener('click', handleFirstClick);
    return () => {
      window.removeEventListener('focus', clearWindowsTaskbarAlert);
      document.removeEventListener('click', handleFirstClick);
    };
  }, [clearWindowsTaskbarAlert, setDocumentTitle]);

  // Resize listener para recalcular MAX_VISIBLE y estado del carrusel
  useEffect(() => {
    let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
      resizeDebounceTimer = setTimeout(() => {
        setViewportHeight(window.innerHeight || document.documentElement.clientHeight || 800);
      }, 120);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
    };
  }, []);

  // Carga inicial, Polling cada 5s y suscripción WebSockets
  useEffect(() => {
    getEnvInfo().then((info) => {
      if (info) setEnvInfo(info);
    });

    getPanolStaffList()
      .then((staff) => {
        setPanolStaffList(staff || []);
      })
      .catch((err) => {
        console.error('Error al cargar staff:', err);
      });

    loadData();

    const pollingTimer = setInterval(() => {
      if (
        document.visibilityState === 'visible' &&
        !isPollingPausedRef.current &&
        Object.keys(undoTimersRef.current).length === 0
      ) {
        loadData();
      }
    }, 30000);

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        !isPollingPausedRef.current &&
        Object.keys(undoTimersRef.current).length === 0
      ) {
        loadData();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const socket = getSocket();
    const handleOrdersSync = (incomingOrders: any[]) => {
      if (
        !isPollingPausedRef.current &&
        Object.keys(undoTimersRef.current).length === 0
      ) {
        loadData();
      } else if (Array.isArray(incomingOrders) && incomingOrders.length > 0 && incomingOrders[0]?.items) {
        onDataReceived(incomingOrders);
      }
    };
    const handleEnvInfo = (info: any) => {
      if (info) setEnvInfo(info);
    };

    socket.on('orders_sync', handleOrdersSync);
    socket.on('env_info', handleEnvInfo);

    return () => {
      clearInterval(pollingTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      socket.off('orders_sync', handleOrdersSync);
      socket.off('env_info', handleEnvInfo);
      Object.values(undoIntervalsRef.current).forEach(clearInterval);
      if (titleFlashIntervalRef.current) clearInterval(titleFlashIntervalRef.current);
    };
  }, [loadData, onDataReceived]);

  // === CAROUSEL AUTO SCROLL SYSTEM (5s interval, pause on hover/interaction) ===
  const hasActiveModal = Boolean(
    removeModalData || addItemModalReqId || incompleteModalData
  );

  const isInteractingWithCard = useCallback(() => {
    if (hasActiveModal) return true;

    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) {
      if (
        active.closest('.card') ||
        active.closest('.modal-content') ||
        active.closest('.modal-overlay')
      ) {
        return true;
      }
    }

    if (Object.keys(pendingQtyEditsRef.current).length > 0) return true;
    if (Object.keys(undoTimersRef.current).length > 0) return true;
    if (Date.now() - lastCardInteractionTimeRef.current < 6000) return true;

    return false;
  }, [hasActiveModal]);

  // Filtrado y ordenamiento de tarjetas en vista PEDIDOS (nuevas a la izquierda)
  const filteredOrders = useMemo(() => {
    const statusMode = currentPedidosSubtab === 'COMPLETADOS' ? 'ENTREGADO' : 'ALL';

    const list = allOrders.filter((order) => {
      if (statusMode === 'ALL') {
        return order.status === 'PENDIENTE' || order.status === 'LISTO';
      } else {
        return order.status === 'ENTREGADO' || order.status === 'DEVOLUCION';
      }
    });

    // Nuevas a la izquierda: orden descendente por fecha/hora
    return [...list].sort((a, b) => {
      const tA = new Date(a.timestamp || 0).getTime() || 0;
      const tB = new Date(b.timestamp || 0).getTime() || 0;
      return tB - tA;
    });
  }, [allOrders, currentPedidosSubtab]);

  // Actualizar alineación del tablero (flex-start si desborda, center si entra en pantalla) y auto-scroll cada 5s
  useEffect(() => {
    const view = viewDespachoRef.current;
    const board = boardRef.current;
    if (!view || !board || activeView !== 'despacho') return;

    const isOverflowing = view.scrollWidth > view.clientWidth + 5;
    board.style.justifyContent = isOverflowing ? 'flex-start' : 'center';

    if (!isOverflowing) return;

    const advanceCarousel = () => {
      if (!view || !board || activeView !== 'despacho') return;
      if (isCarouselHoveredRef.current || isInteractingWithCard()) return;

      const maxScroll = Math.max(0, view.scrollWidth - view.clientWidth);
      if (maxScroll <= 5) return;

      const currentScroll = view.scrollLeft;
      const cards = Array.from(board.querySelectorAll('.card')) as HTMLElement[];
      if (cards.length === 0) return;

      if (currentScroll >= maxScroll - 20) {
        view.scrollTo({ left: 0, behavior: 'smooth' });
        return;
      }

      const nextCard = cards.find((c) => c.offsetLeft > currentScroll + 35);
      if (nextCard) {
        const target = Math.min(nextCard.offsetLeft - 20, maxScroll);
        view.scrollTo({ left: target, behavior: 'smooth' });
      } else {
        view.scrollTo({ left: 0, behavior: 'smooth' });
      }
    };

    const intervalId = setInterval(advanceCarousel, 5000);
    return () => clearInterval(intervalId);
  }, [activeView, filteredOrders, viewportHeight, isInteractingWithCard]);

  // Restaurar memoria de scroll interno de cada tarjeta después de cada actualización
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    board.querySelectorAll('.card').forEach((card) => {
      const reqId = card.id ? card.id.replace(/^card-/, '') : null;
      if (
        reqId &&
        cardItemsScrollMemoryRef.current[reqId] &&
        cardItemsScrollMemoryRef.current[reqId] > 0
      ) {
        const itemsContainer = card.querySelector(
          '.card-items-container'
        ) as HTMLElement | null;
        if (itemsContainer) {
          const targetTop = cardItemsScrollMemoryRef.current[reqId];
          itemsContainer.style.scrollBehavior = 'auto';
          itemsContainer.scrollTop = targetTop;
          itemsContainer.style.scrollBehavior = '';
        }
      }
    });
  }, [filteredOrders]);

  // Manejo de rueda del mouse (scroll vertical independiente dentro de .card, scroll horizontal en fondo libre)
  const toggleExpand = useCallback(
    (reqId: string) => {
      lastCardInteractionTimeRef.current = Date.now();
      setExpandedCards((prev) => {
        const next = new Set(prev);
        if (next.has(reqId)) {
          next.delete(reqId);
          delete cardItemsScrollMemoryRef.current[reqId];
          const itemsContainer = document.getElementById(`items-container-${reqId}`);
          if (itemsContainer) itemsContainer.scrollTop = 0;
        } else {
          next.add(reqId);
        }
        return next;
      });
    },
    []
  );

  useEffect(() => {
    const view = viewDespachoRef.current;
    if (!view) return;

    const handleWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      const card = target?.closest ? (target.closest('.card') as HTMLElement | null) : null;
      if (card) {
        lastCardInteractionTimeRef.current = Date.now();
        const itemsContainer = card.querySelector(
          '.card-items-container'
        ) as HTMLElement | null;
        if (itemsContainer) {
          const dropdown = card.querySelector('.card-items-dropdown');
          if (dropdown && dropdown.classList.contains('collapsed') && e.deltaY > 0) {
            const reqIdMatch = card.id.match(/card-(.+)/);
            if (reqIdMatch) {
              toggleExpand(reqIdMatch[1]);
            }
          }

          if (itemsContainer.scrollHeight > itemsContainer.clientHeight) {
            itemsContainer.scrollTop += e.deltaY;
            const reqIdMatch = card.id.match(/card-(.+)/);
            if (reqIdMatch) {
              cardItemsScrollMemoryRef.current[reqIdMatch[1]] = itemsContainer.scrollTop;
            }
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (view.scrollWidth > view.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        view.scrollLeft += e.deltaY;
        lastCardInteractionTimeRef.current = Date.now();
        e.preventDefault();
      }
    };

    view.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      view.removeEventListener('wheel', handleWheel);
    };
  }, [toggleExpand]);

  // === ACCIONES EN TARJETA: SELECCIÓN DE OPERARIO Y 5 SEGUNDOS PARA DESHACER ===
  const onSelectFooterOp = (reqId: string, opId: string) => {
    lastCardInteractionTimeRef.current = Date.now();
    setPendingSelections((prev) => ({ ...prev, [reqId]: opId }));
  };

  const executeMarkReady = useCallback(
    async (reqId: string, panolOpId: string) => {
      setExecutingReadyMap((prev) => ({ ...prev, [reqId]: true }));

      const order = allOrders.find((o) => String(o.reqId) === String(reqId));
      const confirmedItems = order
        ? order.items.map((i) => ({ name: i.name, qty: Number(i.qty) }))
        : undefined;

      try {
        await markOrderAsReady(reqId, panolOpId, confirmedItems);
        setPendingSelections((prev) => {
          const next = { ...prev };
          delete next[reqId];
          return next;
        });
        setPendingQtyEdits((prev) => {
          const next = { ...prev };
          delete next[reqId];
          return next;
        });
        setExecutingReadyMap((prev) => {
          const next = { ...prev };
          delete next[reqId];
          return next;
        });
        await loadData();
        resumePolling();
      } catch (err) {
        console.error('Mark ready error:', err);
        setExecutingReadyMap((prev) => {
          const next = { ...prev };
          delete next[reqId];
          return next;
        });
        resumePolling();
      }
    },
    [allOrders, loadData, resumePolling]
  );

  const startUndoTimer = useCallback(
    (reqId: string, panolOpId: string) => {
      pausePolling();
      if (undoIntervalsRef.current[reqId]) {
        clearInterval(undoIntervalsRef.current[reqId]);
      }

      let secondsLeft = 5;
      setUndoTimers((prev) => ({
        ...prev,
        [reqId]: { panolOpId, secondsLeft: 5 },
      }));

      const intervalId = setInterval(() => {
        secondsLeft -= 1;
        if (secondsLeft > 0) {
          setUndoTimers((prev) => {
            if (!prev[reqId]) return prev;
            return {
              ...prev,
              [reqId]: { ...prev[reqId], secondsLeft },
            };
          });
        } else {
          clearInterval(intervalId);
          delete undoIntervalsRef.current[reqId];
          setUndoTimers((prev) => {
            const next = { ...prev };
            delete next[reqId];
            return next;
          });
          executeMarkReady(reqId, panolOpId);
        }
      }, 1000);

      undoIntervalsRef.current[reqId] = intervalId;
    },
    [executeMarkReady, pausePolling]
  );

  const cancelMarkReady = useCallback(
    (reqId: string) => {
      if (undoIntervalsRef.current[reqId]) {
        clearInterval(undoIntervalsRef.current[reqId]);
        delete undoIntervalsRef.current[reqId];
      }
      setUndoTimers((prev) => {
        const next = { ...prev };
        delete next[reqId];
        return next;
      });
      resumePolling();
    },
    [resumePolling]
  );

  const markReady = (reqId: string) => {
    const panolOpId = pendingSelections[reqId];
    if (!panolOpId) {
      triggerSelectShake(`panol-op-${reqId}`);
      return;
    }
    startUndoTimer(reqId, panolOpId);
  };

  // === EDICIÓN DE CANTIDADES Y ELIMINACIÓN / ADICIÓN DE ÍTEMS ===
  const saveItemQtyDraft = (reqId: string, itemName: string, val: string) => {
    lastCardInteractionTimeRef.current = Date.now();
    const num = Number(val);
    if (isNaN(num) || num < 0) return;
    const key = String(itemName).trim().toLowerCase();

    setPendingQtyEdits((prev) => ({
      ...prev,
      [reqId]: { ...(prev[reqId] || {}), [key]: num },
    }));

    setAllOrders((prev) =>
      prev.map((o) => {
        if (String(o.reqId) !== String(reqId)) return o;
        return {
          ...o,
          items: o.items.map((it) =>
            String(it.name).trim().toLowerCase() === key ? { ...it, qty: num } : it
          ),
        };
      })
    );
  };

  const openRemoveItemModal = (reqId: string, itemName: string) => {
    pausePolling();
    setRemoveModalData({ reqId, itemName });
  };

  const changeItemQty = (reqId: string, itemName: string, delta: number) => {
    lastCardInteractionTimeRef.current = Date.now();
    const order = allOrders.find((o) => String(o.reqId) === String(reqId));
    if (!order) return;
    const key = String(itemName).trim().toLowerCase();
    const item = order.items.find((i) => String(i.name).trim().toLowerCase() === key);
    if (!item) return;

    const newQty = Math.max(0, Number(item.qty) + delta);
    if (newQty === 0) {
      openRemoveItemModal(reqId, itemName);
      return;
    }

    setPendingQtyEdits((prev) => ({
      ...prev,
      [reqId]: { ...(prev[reqId] || {}), [key]: newQty },
    }));

    setAllOrders((prev) =>
      prev.map((o) => {
        if (String(o.reqId) !== String(reqId)) return o;
        return {
          ...o,
          items: o.items.map((it) =>
            String(it.name).trim().toLowerCase() === key ? { ...it, qty: newQty } : it
          ),
        };
      })
    );

    enqueueApiTask((done) => {
      updatePendingItemQty(reqId, itemName, newQty)
        .catch(() => {})
        .finally(done);
    });
  };

  const handleCommitItemQtyInput = (reqId: string, itemName: string, rawVal: string) => {
    const newQty = Number(rawVal);
    if (isNaN(newQty) || newQty < 0) return;
    if (newQty === 0) {
      openRemoveItemModal(reqId, itemName);
      return;
    }
    saveItemQtyDraft(reqId, itemName, String(newQty));
    enqueueApiTask((done) => {
      updatePendingItemQty(reqId, itemName, newQty)
        .catch(() => {})
        .finally(done);
    });
  };

  const confirmRemoveItem = () => {
    if (!removeModalData) return;
    const { reqId, itemName } = removeModalData;
    const key = String(itemName).trim().toLowerCase();
    setRemoveModalData(null);
    resumePolling();

    setPendingQtyEdits((prev) => {
      const next = { ...prev };
      if (next[reqId]) {
        const copy = { ...next[reqId] };
        delete copy[key];
        if (Object.keys(copy).length === 0) {
          delete next[reqId];
        } else {
          next[reqId] = copy;
        }
      }
      return next;
    });

    setAllOrders((prev) => {
      const updated = prev
        .map((o) => {
          if (String(o.reqId) !== String(reqId)) return o;
          const remainingItems = o.items.filter(
            (i) => String(i.name).trim().toLowerCase() !== key
          );
          if (remainingItems.length <= 3) {
            setExpandedCards((exp) => {
              const nextExp = new Set(exp);
              nextExp.delete(reqId);
              return nextExp;
            });
          }
          return { ...o, items: remainingItems };
        })
        .filter((o) => o.items.length > 0);
      return updated;
    });

    enqueueApiTask((done) => {
      removePendingItem(reqId, itemName)
        .catch((err) => console.error('Remove error:', err))
        .finally(done);
    });
  };

  // === MODAL AGREGAR ÍTEM AL PEDIDO ===
  const openAddItemModal = (reqId: string) => {
    pausePolling();
    setAddItemModalReqId(reqId);
    setAddItemSearchQuery('');
    setAddItemSearchResults([]);
    setAddItemSelectedItem(null);
    setAddItemQty(1);
    setTimeout(() => addItemInputRef.current?.focus(), 100);
  };

  const handleSearchItemsForAdd = (query: string) => {
    setAddItemSearchQuery(query);
    setAddItemSelectedItem(null);
    if (addItemSearchTimeoutRef.current) {
      clearTimeout(addItemSearchTimeoutRef.current);
    }
    if (query.trim().length < 2) {
      setAddItemSearchResults([]);
      setIsSearchingInventory(false);
      return;
    }
    setIsSearchingInventory(true);
    addItemSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await getInventoryItems(query.trim());
        setAddItemSearchResults(
          (results || []).map((r) => ({
            name: r.name,
            stock: Number(r.stock) || 0,
            code: r.code || r.item_code || '',
          }))
        );
      } catch (err) {
        console.error('Search error:', err);
        setAddItemSearchResults([]);
      } finally {
        setIsSearchingInventory(false);
      }
    }, 300);
  };

  const selectItemForAdd = (itemName: string, stock: number, code?: string) => {
    setAddItemSelectedItem({ name: itemName, stock, code });
    setAddItemSearchQuery(itemName);
    setAddItemSearchResults([]);
    setAddItemQty(1);
  };

  const confirmAddItem = async () => {
    if (!addItemModalReqId || !addItemSelectedItem) return;
    const reqId = addItemModalReqId;
    const qty = Number(addItemQty) || 0;
    if (qty < 1) {
      alert('Cantidad inválida.');
      return;
    }

    const itemName = addItemSelectedItem.name;
    const stock = addItemSelectedItem.stock || 0;
    const itemCode = addItemSelectedItem.code || '';

    setAddItemModalReqId(null);
    resumePolling();

    setAllOrders((prev) =>
      prev.map((o) => {
        if (String(o.reqId) !== String(reqId)) return o;
        return {
          ...o,
          items: [
            ...o.items,
            {
              name: itemName,
              qty,
              id: itemCode || '---',
              code: itemCode || '---',
              item_code: itemCode || '---',
              loc: 'S/D',
              requiereCanje: false,
              estadoCanje: '',
              panolConfirmacion: '',
              stock,
              status: 'PENDIENTE',
            },
          ],
        };
      })
    );

    setExpandedCards((prev) => {
      const next = new Set(prev);
      next.add(reqId);
      return next;
    });

    try {
      const res = await addItemToPendingOrder(reqId, itemName, qty);
      if (res && res.success === false) {
        alert(res.error || 'Error al agregar ítem.');
      }
      await loadData();
    } catch (err) {
      console.error('Add item error:', err);
      await loadData();
    }
  };

  // === DEVOLUCIÓN REPUESTO ANTERIOR (CANJES) ===
  const returnsBoardCards = useMemo(() => {
    const cardsMap = new Map<
      string,
      {
        reqId: string;
        box: string;
        unitInfo: string;
        opInfo: string;
        otNumber: string;
        panolOpId: string;
        notes: string;
        returnItems: Array<{
          id?: string;
          order_item_id?: string;
          name: string;
          qty: number;
          loc: string;
          returnedQty: number;
          reasonText: string;
          isFaltante: boolean;
          isResolved: boolean;
          isOk: boolean;
          itemTag: string;
        }>;
      }
    >();

    // 1. Extraer desde allOrders (mismo algoritmo que renderReturnsBoard en panol.html)
    allOrders.forEach((o) => {
      const returnItems = o.items.filter((i) => {
        if (i.status === 'DEVOLUCION PENDIENTE' || i.status === 'DEVOLUCION') return false;
        if (i.notesColO && /SOLICITUD DEVOLUCIÓN NUEVA/i.test(i.notesColO)) return false;
        if (i.note && /SOLICITUD DEVOLUCIÓN NUEVA/i.test(i.note)) return false;
        if ((i as any).movement_type === 'DEVOLUCION_NUEVO') return false;
        return i.requiereCanje || (i.estadoCanje && i.estadoCanje !== '');
      });

      const hasPendingItems = returnItems.some((i) => {
        const conf = String(i.panolConfirmacion || '');
        const isAudited = conf.includes('OK') || conf.includes('INCOMPLETO');
        const isDevuelto = i.status === 'DEVUELTO';
        return !isAudited && !isDevuelto;
      });

      if (returnItems.length > 0 && hasPendingItems) {
        const mappedItems = returnItems.map((i, idx) => {
          let canjeJson: any = null;
          if (typeof i.estadoCanje === 'string' && i.estadoCanje.trim().startsWith('{')) {
            try {
              canjeJson = JSON.parse(i.estadoCanje);
            } catch (e) {}
          }

          let returnedQty = Number(i.qty) || 1;
          let reasonText = '';
          if (canjeJson && canjeJson.motivo) {
            reasonText = canjeJson.motivo;
          } else if (i.notesColO) {
            reasonText = i.notesColO.replace(/DEVOLUCIÓN ACEPTADA:\s*/i, '').trim();
          } else if (o.notes) {
            reasonText = String(o.notes).trim();
          }

          if (canjeJson) {
            if (canjeJson.tipo === 'ENTREGO_USADA') {
              returnedQty =
                canjeJson.cant_entregada !== undefined
                  ? Number(canjeJson.cant_entregada)
                  : Number(i.qty) || 1;
            } else if (canjeJson.tipo === 'FALTANTE') {
              returnedQty =
                canjeJson.cant_entregada !== undefined
                  ? Number(canjeJson.cant_entregada)
                  : 0;
            }
          } else {
            const partialMatch = String(i.estadoCanje || '').match(/(\d+)\s*entregada/i);
            if (partialMatch && partialMatch[1]) {
              returnedQty = parseInt(partialMatch[1], 10);
            } else if (
              String(i.estadoCanje || '').startsWith('FALTA:') ||
              i.estadoCanje === 'FALTA'
            ) {
              returnedQty = 0;
            }
          }

          const conf = String(i.panolConfirmacion || '');
          const isResolved = conf.includes('OK') || conf.includes('INCOMPLETO') || i.status === 'DEVUELTO';
          const isOk = conf.includes('OK') || (i.status === 'DEVUELTO' && !conf.includes('INCOMPLETO'));

          return {
            id: i.id,
            order_item_id: (i as any).order_item_id || i.id,
            name: i.name,
            qty: Number(i.qty) || 1,
            loc: i.loc || '',
            returnedQty,
            reasonText,
            isFaltante: Boolean(canjeJson && canjeJson.tipo === 'FALTANTE' && reasonText),
            isResolved,
            isOk,
            itemTag: `${o.reqId}-${idx}`,
          };
        });

        cardsMap.set(o.reqId, {
          reqId: o.reqId,
          box: o.box || '',
          unitInfo: o.unitInfo || '',
          opInfo: o.opInfo || 'MECÁNICO',
          otNumber: o.otNumber || '--',
          panolOpId: o.panolOpId || '',
          notes: o.notes || '',
          returnItems: mappedItems,
        });
      }
    });

    // 2. Complementar con /api/devoluciones de Supabase si no estaban ya en cardsMap
    pendingReturnsSql.forEach((r: any) => {
      // Segregación estricta: sólo canjes / repuestos usados anteriores
      if (r.es_devolucion_nueva || r.tipo_devolucion === 'NUEVO' || r.movement_type === 'DEVOLUCION_NUEVO') return;
      if (r.item_status === 'DEVOLUCION PENDIENTE' || r.item_status === 'DEVOLUCION') return;
      if (r.tipo_devolucion !== 'CANJE' && !r.es_canje && !r.requires_exchange) return;

      const reqId = String(
        r.req_code || (r.order_number ? `REQ-${r.order_number}` : r.order_id || '')
      );
      if (!reqId) return;

      let canjeJson: any = null;
      if (typeof r.exchange_status === 'string' && r.exchange_status.trim().startsWith('{')) {
        try {
          canjeJson = JSON.parse(r.exchange_status);
        } catch (e) {}
      } else if (typeof r.exchange_status === 'object' && r.exchange_status) {
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
          returnedQty =
            canjeJson.cant_entregada !== undefined ? Number(canjeJson.cant_entregada) : origQty;
        } else if (canjeJson.tipo === 'FALTANTE') {
          returnedQty =
            canjeJson.cant_entregada !== undefined ? Number(canjeJson.cant_entregada) : 0;
        }
      } else if (
        r.returned_qty !== undefined &&
        r.returned_qty !== null &&
        r.returned_qty !== ''
      ) {
        returnedQty = Math.round(Number(r.returned_qty));
      }

      const conf = String(r.panol_confirmation || '');
      const isResolved = conf.includes('OK') || conf.includes('INCOMPLETO') || r.item_status === 'DEVUELTO' || r.status === 'DEVUELTO';
      const isOk = conf.includes('OK') || ((r.item_status === 'DEVUELTO' || r.status === 'DEVUELTO') && !conf.includes('INCOMPLETO'));

      if (!cardsMap.has(reqId)) {
        cardsMap.set(reqId, {
          reqId,
          box: r.box_number || '',
          unitInfo: r.box_number ? `[BOX ${r.box_number}]` : r.tractor || '',
          opInfo: r.mechanic_name || 'MECÁNICO',
          otNumber: r.ot_number || '--',
          panolOpId: '',
          notes: '',
          returnItems: [],
        });
      }

      const card = cardsMap.get(reqId)!;
      const itemName = String(r.item_name || 'REPUESTO');
      const alreadyExists = card.returnItems.some(
        (it) => it.name.toLowerCase() === itemName.toLowerCase()
      );
      if (!alreadyExists) {
        card.returnItems.push({
          id: r.id || r.order_item_id,
          order_item_id: r.order_item_id || r.id,
          name: itemName,
          qty: origQty,
          loc: r.location || '',
          returnedQty,
          reasonText,
          isFaltante: Boolean(canjeJson && canjeJson.tipo === 'FALTANTE' && reasonText),
          isResolved,
          isOk,
          itemTag: `${reqId}-${card.returnItems.length}`,
        });
      }
    });

    return Array.from(cardsMap.values())
      .filter((c) => c.returnItems.some((i) => !i.isResolved))
      .sort((a, b) => {
        const orderA = allOrders.find((o) => o.reqId === a.reqId);
        const orderB = allOrders.find((o) => o.reqId === b.reqId);
        const tA = new Date(orderA?.timestamp || 0).getTime() || 0;
        const tB = new Date(orderB?.timestamp || 0).getTime() || 0;
        return tB - tA;
      });
  }, [allOrders, pendingReturnsSql]);

  const handleReturnAuditAction = async (
    reqId: string,
    itemName: string,
    status: 'OK' | 'INCOMPLETO',
    declaredQty: number | null,
    itemTag: string,
    defaultOpId?: string,
    id?: string
  ) => {
    const panolOpId = pendingSelections[`ret_${reqId}`] || defaultOpId || '';
    if (!panolOpId) {
      triggerSelectShake(`ret-op-${reqId}`);
      return;
    }

    setAuditingItemsMap((prev) => ({ ...prev, [itemTag]: true }));

    // Actualización optimista inmediata en la UI
    const auditLabel = `[OP: ${panolOpId}] - ${status}`;
    setAllOrders((prevOrders) =>
      prevOrders.map((ord) => {
        if (ord.reqId !== reqId) return ord;
        return {
          ...ord,
          items: ord.items.map((it) => {
            const matchesId = id && (it.id === id || (it as any).order_item_id === id);
            const matchesName = it.name.trim().toLowerCase() === itemName.trim().toLowerCase();
            if (matchesId || matchesName) {
              return {
                ...it,
                panolConfirmacion: auditLabel,
                status: status === 'OK' ? 'DEVUELTO' : 'EN_CAMBIO',
              };
            }
            return it;
          }),
        };
      })
    );

    setPendingReturnsSql((prevReturns) =>
      prevReturns.filter((r) => {
        const rReq = String(r.req_code || (r.order_number ? `REQ-${r.order_number}` : r.order_id || ''));
        const rName = String(r.item_name || '');
        const matchesReq = rReq === reqId;
        const matchesItem = (id && (r.id === id || r.order_item_id === id)) || rName.trim().toLowerCase() === itemName.trim().toLowerCase();
        return !(matchesReq && matchesItem);
      })
    );

    try {
      await submitReturnAudit(reqId, itemName, status, declaredQty, panolOpId, id);
      await loadData();
    } catch (err) {
      console.error('Audit Error:', err);
      await loadData();
    } finally {
      setAuditingItemsMap((prev) => ({ ...prev, [itemTag]: false }));
    }
  };

  const openIncompletePopup = (
    reqId: string,
    itemName: string,
    originalQty: number,
    declaredByMechanic: number,
    itemTag: string,
    id?: string
  ) => {
    pausePolling();
    setIncompleteModalData({
      reqId,
      itemName,
      originalQty,
      declaredByMechanic,
      itemTag,
      id,
    });
    setIncompleteQtyInput(String(declaredByMechanic));
    setTimeout(() => incompleteInputRef.current?.focus(), 100);
  };

  const confirmIncomplete = () => {
    if (!incompleteModalData) return;
    const declaredQty = Number(incompleteQtyInput);
    if (isNaN(declaredQty) || declaredQty < 0) {
      alert('Cantidad inválida.');
      return;
    }
    const { reqId, itemName, itemTag, id } = incompleteModalData;
    setIncompleteModalData(null);
    resumePolling();
    handleReturnAuditAction(reqId, itemName, 'INCOMPLETO', declaredQty, itemTag, undefined, id);
  };

  // === DEVOLUCIÓN REPUESTO NUEVO (SIN USO) ===
  const { returnsNewCards, pendingNewCount } = useMemo(() => {
    let totalPendingNew = 0;
    const cardsMap = new Map<string, {
      reqId: string;
      box: string;
      unitInfo: string;
      opInfo: string;
      otNumber: string;
      panolOpId: string;
      notes: string;
      eligibleItems: PanolItem[];
    }>();

    const countedItemKeys = new Set<string>();

    const isItemPending = (itStatus?: string, retNotes?: string, movementType?: string) => {
      if (movementType === 'DEVOLUCION_CANJE') return false;
      const s = String(itStatus || '').trim().toUpperCase();
      const n = String(retNotes || '').toUpperCase();
      if (s === 'DEVOLUCION PENDIENTE') return true;
      if (n.includes('SOLICITUD DEVOLUCIÓN NUEVA') && !n.includes('DEVOLUCIÓN ACEPTADA') && s !== 'DEVOLUCION' && s !== 'DEVUELTO') return true;
      return false;
    };

    const addCardItem = (reqId: string, baseCard: any, item: PanolItem) => {
      if (!cardsMap.has(reqId)) {
        cardsMap.set(reqId, {
          reqId,
          box: baseCard.box || '',
          unitInfo: baseCard.unitInfo || '',
          opInfo: baseCard.opInfo || 'MECÁNICO',
          otNumber: baseCard.otNumber || '--',
          panolOpId: baseCard.panolOpId || '',
          notes: baseCard.notes || '',
          eligibleItems: [item],
        });
      } else {
        const c = cardsMap.get(reqId)!;
        if (!c.eligibleItems.some(i => (item.id && i.id === item.id) || i.name === item.name)) {
          c.eligibleItems.push(item);
        }
      }
    };

    // 1. Procesar allOrders
    allOrders.forEach((o) => {
      o.items.forEach((i) => {
        // Ignorar ítems que son puro Canje sin solicitud de devolución nueva
        if (i.requiereCanje && i.status !== 'DEVOLUCION PENDIENTE' && i.status !== 'DEVOLUCION' && !i.notesColO?.includes('SOLICITUD DEVOLUCIÓN NUEVA') && !i.note?.includes('SOLICITUD DEVOLUCIÓN NUEVA')) {
          return;
        }
        if (isItemPending(i.status, i.notesColO || i.note, (i as any).movement_type)) {
          const itemKey = `${o.reqId}_${i.id || i.name}`;
          if (!countedItemKeys.has(itemKey)) {
            countedItemKeys.add(itemKey);
            totalPendingNew++;
          }
        }
      });

      const eligibleItems = o.items.filter((i) => {
        // Ignorar ítems que son puro Canje sin solicitud de devolución nueva
        if (i.requiereCanje && i.status !== 'DEVOLUCION PENDIENTE' && i.status !== 'DEVOLUCION' && !i.notesColO?.includes('SOLICITUD DEVOLUCIÓN NUEVA') && !i.note?.includes('SOLICITUD DEVOLUCIÓN NUEVA')) {
          return false;
        }
        return isItemPending(i.status, i.notesColO || i.note, (i as any).movement_type);
      });

      eligibleItems.forEach((it) => {
        addCardItem(o.reqId, {
          box: o.box || '',
          unitInfo: o.unitInfo || '',
          opInfo: o.opInfo || 'MECÁNICO',
          otNumber: o.otNumber || '--',
          panolOpId: o.panolOpId || '',
          notes: o.notes || '',
        }, it);
      });
    });

    // 2. Procesar pendingReturnsSql (v_devoluciones_pendientes)
    pendingReturnsSql.forEach((r: any) => {
      // Segregación estricta: NUNCA mezclar con Canjes
      if (r.tipo_devolucion === 'CANJE' || r.es_canje || r.movement_type === 'DEVOLUCION_CANJE') return;
      if (r.item_status === 'DEVUELTO') return;

      if (r.es_devolucion_nueva || r.tipo_devolucion === 'NUEVO' || isItemPending(r.item_status, r.return_notes || r.motivo_devolucion, r.movement_type)) {
        const reqId = String(r.req_code || (r.order_number ? `REQ-${r.order_number}` : r.order_id || ''));
        if (!reqId) return;

        const itemKey = `${reqId}_${r.id || r.order_item_id || r.item_name}`;
        if (!countedItemKeys.has(itemKey)) {
          countedItemKeys.add(itemKey);
          totalPendingNew++;
        }

        const itemObj: PanolItem = {
          id: r.id || r.order_item_id || 'S/D',
          name: r.item_name || 'REPUESTO',
          qty: Number(r.cantidad_a_devolver || r.returned_qty || r.requested_qty || 1),
          loc: r.location || 'S/D',
          stock: Number(r.stock_actual || 0),
          status: r.item_status || 'DEVOLUCION PENDIENTE',
          note: r.motivo_devolucion || r.return_notes || '',
          notesColO: r.return_notes || r.motivo_devolucion || '',
        };

        addCardItem(reqId, {
          box: r.box_number || '',
          unitInfo: r.box_number ? `[BOX ${r.box_number}]` : (r.tractor || ''),
          opInfo: r.mechanic_name || 'MECÁNICO',
          otNumber: r.ot_number || '--',
          panolOpId: r.panol_op_code || '',
          notes: r.motivo_devolucion || r.return_notes || '',
        }, itemObj);
      }
    });

    // 3. Procesar newReturnsSql (v_devoluciones_nuevas con histórico y pendientes)
    newReturnsSql.forEach((r: any) => {
      // Segregación estricta: NUNCA mezclar con Canjes
      if (r.tipo_devolucion === 'CANJE' || r.es_canje || r.movement_type === 'DEVOLUCION_CANJE') return;
      if (r.item_status === 'DEVUELTO') return;

      const reqId = String(r.req_code || (r.order_number ? `REQ-${r.order_number}` : r.order_id || ''));
      if (!reqId) return;

      const isPending = isItemPending(r.item_status, r.return_notes || r.motivo_devolucion, r.movement_type);
      if (!isPending) return;

      const itemKey = `${reqId}_${r.id || r.order_item_id || r.item_name}`;
      if (!countedItemKeys.has(itemKey)) {
        countedItemKeys.add(itemKey);
        totalPendingNew++;
      }

      const itemObj: PanolItem = {
        id: r.id || r.order_item_id || 'S/D',
        name: r.item_name || 'REPUESTO',
        qty: Number(r.return_qty || r.delivered_qty || r.requested_qty || 1),
        loc: r.location || 'S/D',
        stock: Number(r.stock_actual || 0),
        status: r.item_status || 'DEVOLUCION PENDIENTE',
        note: r.motivo_devolucion || r.return_notes || '',
        notesColO: r.return_notes || r.motivo_devolucion || '',
      };

      addCardItem(reqId, {
        box: r.box_number || '',
        unitInfo: r.box_number ? `[BOX ${r.box_number}]` : (r.tractor || ''),
        opInfo: r.mechanic_name || 'MECÁNICO',
        otNumber: r.ot_number || '--',
        panolOpId: r.panol_op_code || '',
        notes: r.motivo_devolucion || r.return_notes || '',
      }, itemObj);
    });

    const sortedCards = Array.from(cardsMap.values()).sort((a, b) => {
      const orderA = allOrders.find((o) => o.reqId === a.reqId);
      const orderB = allOrders.find((o) => o.reqId === b.reqId);
      const tA = new Date(orderA?.timestamp || 0).getTime() || 0;
      const tB = new Date(orderB?.timestamp || 0).getTime() || 0;
      return tB - tA;
    });

    return { returnsNewCards: sortedCards, pendingNewCount: totalPendingNew };
  }, [allOrders, pendingReturnsSql, newReturnsSql]);

  const confirmNewReturnRow = async (reqId: string, defaultOpId?: string, id?: string) => {
    const panolOpId = pendingSelections[`newret_${reqId}`] || defaultOpId || '';
    if (!panolOpId) {
      triggerSelectShake(`newret-op-${reqId}`);
      return;
    }

    setReintegratingRowMap((prev) => ({ ...prev, [reqId]: true }));

    // Actualización optimista inmediata en devoluciones de nuevos
    setNewReturnsSql((prev) =>
      prev.map((r) => {
        const rReq = String(r.req_code || (r.order_number ? `REQ-${r.order_number}` : r.order_id || ''));
        if (rReq === reqId && (!id || r.id === id || r.order_item_id === id)) {
          return { ...r, item_status: 'DEVOLUCION', status: 'DEVOLUCION' };
        }
        return r;
      })
    );

    setAllOrders((prevOrders) =>
      prevOrders.map((ord) => {
        if (ord.reqId !== reqId) return ord;
        return {
          ...ord,
          items: ord.items.map((it) => {
            const matchesId = id && (it.id === id || (it as any).order_item_id === id);
            if (matchesId || !id) {
              return {
                ...it,
                status: 'DEVOLUCION',
                notesColO: `DEVOLUCIÓN ACEPTADA: OK [OP: ${panolOpId}]`,
                note: `DEVOLUCIÓN ACEPTADA: OK [OP: ${panolOpId}]`,
              };
            }
            return it;
          }),
        };
      })
    );

    setPendingReturnsSql((prev) =>
      prev.filter((r) => {
        const rReq = String(r.req_code || (r.order_number ? `REQ-${r.order_number}` : r.order_id || ''));
        if (rReq === reqId && (!id || r.id === id || r.order_item_id === id)) {
          return false;
        }
        return true;
      })
    );

    try {
      await confirmNewReturn(reqId, 'ALL', null, panolOpId, id);
      await loadData();
    } catch (err: any) {
      console.error('Error al reintegrar stock:', err);
      alert(
        'Error al reintegrar repuestos a stock: ' +
          (err && err.message ? err.message : String(err))
      );
      await loadData();
    } finally {
      setReintegratingRowMap((prev) => ({ ...prev, [reqId]: false }));
    }
  };

  const handleLogout = (e: React.MouseEvent) => {
    e.preventDefault();
    logout();
    navigate('/login');
  };

  // === RENDERIZADO DE CADA TARJETA DE PEDIDO (FIGMA 778:800) ===
  const renderOrderCard = (o: PanolOrderData) => {
    const isReady = o.status === 'LISTO';
    const isPendiente = o.status === 'PENDIENTE';
    const isDelivered = o.status === 'ENTREGADO';
    const isDevolucion = o.status === 'DEVOLUCION';

    // 1. Hora en formato 24hs estricto (HH:mm)
    let timeStr = '--:--';
    if (o.timestamp) {
      const d = new Date(o.timestamp);
      if (!isNaN(d.getTime())) {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        timeStr = `${hh}:${mm}`;
      } else {
        const m = String(o.timestamp).match(/(\d{1,2}):(\d{2})/);
        if (m) timeStr = `${m[1].padStart(2, '0')}:${m[2]}`;
      }
    }

    const now = Date.now();
    const dateObj = o.timestamp ? new Date(o.timestamp) : new Date(NaN);
    const waitMins = !isNaN(dateObj.getTime())
      ? Math.floor((now - dateObj.getTime()) / 60000)
      : 0;
    const isUrgent = !isReady && waitMins >= 15;

    // 2. Resolver Box / Sector
    const loc = resolveBoxOrSector(o.box, o.opInfo);

    // 3. Resolver Mecánico Solicitante
    const mechanicDisplay = (o.opInfo || 'Sin asignar').replace(/\[.*?\]/g, '').trim();

    // 4. Resolver Tractor y Semi
    const rawTractorPlate =
      o.tractorPlate || (o.unitInfo ? o.unitInfo.split(/[\/+]/)[0].trim() : '--');
    const tractorPlate = formatPlate(rawTractorPlate) || '--';
    const tractorBrand = o.tractorBrand || o.brand || 'TRACTOR';
    const tractorOt = o.otNumber || '--';

    let rawSemiPlate = o.semiPlate || '';
    if (!rawSemiPlate && o.unitInfo && (o.unitInfo.includes('/') || o.unitInfo.includes('+'))) {
      rawSemiPlate = o.unitInfo.split(/[\/+]/)[1]?.trim() || '';
    }
    const hasSemi = Boolean(
      rawSemiPlate && rawSemiPlate !== '-' && rawSemiPlate !== 'S/D'
    );
    const semiPlate = formatPlate(rawSemiPlate);
    const semiBrand = o.semiBrand || 'SEMI';
    const semiOt =
      o.semiOt ||
      (hasSemi && o.otNumber && !isNaN(parseInt(o.otNumber, 10))
        ? String(parseInt(o.otNumber, 10) + 1)
        : '--');

    let cardClass = `card status-${o.status}`;
    if (isUrgent) cardClass += ' urgent';
    if (hasSemi) cardClass += ' has-semi';
    if (shakingCards[o.reqId]) cardClass += ' shake-card';

    const MAX_VISIBLE = getDynamicMaxVisibleItems(o, viewportHeight);
    const isExpanded = expandedCards.has(o.reqId);
    const hasExtraItems = o.items.length > MAX_VISIBLE;
    const remaining = hasExtraItems ? o.items.length - MAX_VISIBLE : 0;

    const initialItems = o.items.slice(0, MAX_VISIBLE);
    const extraItems = o.items.slice(MAX_VISIBLE);

    const renderItemCard = (item: PanolItem, idx: number) => {
      const itemCodeDisplay =
        (item.code && !isUuid(item.code) ? item.code.trim() : null) ||
        (item.item_code && !isUuid(item.item_code) ? item.item_code.trim() : null) ||
        (item.id && !isUuid(item.id) ? item.id.trim() : null) ||
        'S/D';
      const itemLoc = item.loc || 'S/D';
      const itemNote = cleanItemNote(item.note || item.notesColO || '');
      const isItemDevuelto = item.status === 'DEVOLUCION';
      const itemKey = String(item.name).trim().toLowerCase();
      const isModified =
        pendingQtyEdits[o.reqId] && pendingQtyEdits[o.reqId][itemKey] !== undefined;

      return (
        <div className="figma-item-card" key={`${o.reqId}-item-${idx}-${item.name}`}>
          <div className="figma-item-title-row">
            <span className="figma-item-name">
              {item.name}
              {isItemDevuelto && (
                <span
                  style={{
                    fontSize: '0.7rem',
                    color: '#f87171',
                    fontWeight: 800,
                    background: 'rgba(239, 68, 68, 0.15)',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    marginLeft: '6px',
                  }}
                >
                  DEVUELTO
                </span>
              )}
            </span>
          </div>

          <div className="figma-item-controls-row">
            {isPendiente ? (
              <div className="figma-stepper-row">
                <button
                  type="button"
                  className="f-step-btn"
                  onClick={() => changeItemQty(o.reqId, item.name, -1)}
                  title="Reducir"
                >
                  −
                </button>
                <input
                  type="number"
                  className={`f-step-input${isModified ? ' modified' : ''}`}
                  id={`qi-${o.reqId}-${idx}`}
                  value={item.qty}
                  min={1}
                  onChange={(e) => saveItemQtyDraft(o.reqId, item.name, e.target.value)}
                  onBlur={(e) => {
                    handleCommitItemQtyInput(o.reqId, item.name, e.target.value);
                    resumePolling();
                  }}
                  onFocus={pausePolling}
                />
                <button
                  type="button"
                  className="f-step-btn"
                  onClick={() => changeItemQty(o.reqId, item.name, 1)}
                  title="Aumentar"
                >
                  +
                </button>
                <button
                  type="button"
                  className="f-step-del"
                  onClick={() => openRemoveItemModal(o.reqId, item.name)}
                  title="Eliminar ítem"
                >
                  ✕
                </button>
              </div>
            ) : isItemDevuelto ? (
              <span
                className="item-qty"
                style={{
                  background: 'rgba(239, 68, 68, 0.2)',
                  color: '#f87171',
                  textDecoration: 'line-through',
                }}
              >
                x{item.qty}
              </span>
            ) : (
              <span className="item-qty">x{item.qty}</span>
            )}
          </div>

          {itemNote && itemNote.trim() !== '' && (
            <div className="figma-item-note-banner" title="Nota del ítem">
              <span>{itemNote.trim()}</span>
            </div>
          )}

          <div className="figma-item-meta-row">
            <span className="item-code-badge">{itemCodeDisplay}</span>
            <span className="item-location-pill" title={itemLoc}>
              {itemLoc}
            </span>
          </div>
        </div>
      );
    };

    const selectedOpId = pendingSelections[o.reqId] || '';
    const hasSelectedOp = Boolean(selectedOpId);
    const activeUndoTimer = undoTimers[o.reqId];
    const isExecutingReady = Boolean(executingReadyMap[o.reqId]);

    const cardStyle: React.CSSProperties = {};
    if (o.uiColor && o.uiColor !== 'default') {
      cardStyle.borderLeftColor = `var(--${o.uiColor})`;
    }
    if (isExecutingReady) {
      cardStyle.opacity = 0.3;
      cardStyle.pointerEvents = 'none';
    }

    return (
      <div
        key={o.reqId}
        className={cardClass}
        id={`card-${o.reqId}`}
        style={cardStyle}
        onPointerDown={() => {
          lastCardInteractionTimeRef.current = Date.now();
        }}
      >
        {/* 1. Encabezado de Tarjeta (Figma 778:800) */}
        <div className="card-figma-header">
          <div className="card-figma-header-top">
            <div className="card-figma-location">
              {loc.isSector ? (
                <span className="header-location-sector">{loc.value}</span>
              ) : (
                <div className="header-location-box">
                  <span className="box-prefix-light">BOX</span>
                  <span className="box-num-bold">{loc.value}</span>
                </div>
              )}
            </div>
            <div className={`card-figma-time${isUrgent ? ' urgent' : ''}`}>
              {timeStr}
              {isUrgent ? ' ⚠️' : ''}
            </div>
          </div>
          <div className="card-figma-mechanic-row" title="Mecánico Solicitante">
            <span className="figma-mechanic-name">{mechanicDisplay}</span>
          </div>
        </div>

        {/* Separador punteado */}
        <div className="figma-divider-dashed" />

        {/* 2. Bloque Dual Tractor + Semi Centrado */}
        <div className="card-figma-vehicles-center">
          {/* Tractor */}
          <div className="figma-vehicle-subcard">
            <div className="figma-vehicle-top-tags">
              <span className="figma-ot-pill">{tractorOt}</span>
              <span
                className={`figma-brand-pill brand-${tractorBrand
                  .toLowerCase()
                  .replace(/\s+/g, '-')}`}
              >
                {tractorBrand}
              </span>
            </div>
            <div className="plate-mercosur">
              <div className="plate-strip" />
              <div className="plate-code">{tractorPlate}</div>
            </div>
          </div>

          {/* Semi */}
          <div className="figma-vehicle-subcard">
            {hasSemi ? (
              <>
                <div className="figma-vehicle-top-tags">
                  <span className="figma-ot-pill">{semiOt}</span>
                  <span
                    className={`figma-brand-pill brand-${semiBrand
                      .toLowerCase()
                      .replace(/\s+/g, '-')}`}
                  >
                    {semiBrand}
                  </span>
                </div>
                <div className="plate-mercosur">
                  <div className="plate-strip" />
                  <div className="plate-code">{semiPlate}</div>
                </div>
              </>
            ) : (
              <>
                <div className="figma-vehicle-top-tags">
                  <span className="figma-brand-pill" style={{ opacity: 0.5 }}>
                    SOLO TRACTOR
                  </span>
                </div>
                <div
                  className="plate-mercosur"
                  style={{ opacity: 0.35, borderStyle: 'dashed' }}
                >
                  <div className="plate-strip" style={{ background: '#334155' }} />
                  <div
                    className="plate-code"
                    style={{
                      color: '#64748b',
                      fontSize: '0.72rem',
                      padding: '4px 2px',
                    }}
                  >
                    SIN SEMI
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Separador sólido */}
        <div className="figma-divider-solid" />

        {/* 3. Lista de Repuestos */}
        <div
          className="card-items-container"
          id={`items-container-${o.reqId}`}
          onScroll={(e) => {
            lastCardInteractionTimeRef.current = Date.now();
            cardItemsScrollMemoryRef.current[o.reqId] = e.currentTarget.scrollTop;
          }}
        >
          {initialItems.map((item, idx) => renderItemCard(item, idx))}

          {hasExtraItems && (
            <>
              <div
                className={`card-items-dropdown ${
                  isExpanded ? 'expanded' : 'collapsed'
                }`}
                id={`dropdown-${o.reqId}`}
              >
                {extraItems.map((item, idx) =>
                  renderItemCard(item, MAX_VISIBLE + idx)
                )}
              </div>
              <button
                type="button"
                className="btn-figma-ver-mas"
                id={`btn-expand-${o.reqId}`}
                onClick={() => toggleExpand(o.reqId)}
              >
                {isExpanded ? '▲ Ver menos' : `▼ Ver ${remaining} más`}
              </button>
            </>
          )}

          {isPendiente && (
            <button
              type="button"
              className="btn-figma-add-item"
              onClick={() => openAddItemModal(o.reqId)}
            >
              Agregar item +
            </button>
          )}
        </div>

        {/* 4. Pie de Tarjeta / Acciones (incluye instancia 5s para deshacer) */}
        <div className="card-figma-footer">
          {isDelivered ? (
            <div
              className="status-complete"
              style={{
                background: 'rgba(139, 148, 158, 0.12)',
                color: '#8b949e',
              }}
            >
              ✅ ENTREGADO Y CERRADO
            </div>
          ) : isDevolucion ? (
            <div
              className="status-complete"
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#ef4444',
              }}
            >
              ↩️ DEVUELTO A PAÑOL
            </div>
          ) : isReady ? (
            <div className="status-complete">⚡ LISTO PARA ENTREGAR</div>
          ) : activeUndoTimer ? (
            <div className="figma-footer-actions-row" id={`actions-row-${o.reqId}`}>
              <button
                type="button"
                className="btn-undo-ready"
                onClick={() => cancelMarkReady(o.reqId)}
                title="Clic para cancelar y mantener en PENDIENTE"
              >
                <span>✕ CANCELAR LISTO</span>
                <span className="countdown-sec">
                  {activeUndoTimer.secondsLeft}s
                </span>
              </button>
            </div>
          ) : isPendiente ? (
            <div className="figma-footer-actions-row">
              <select
                id={`panol-op-${o.reqId}`}
                className={`figma-footer-select${
                  shakingSelectIds[`panol-op-${o.reqId}`] ? ' shake-error' : ''
                }`}
                value={selectedOpId}
                onChange={(e) => onSelectFooterOp(o.reqId, e.target.value)}
                onFocus={pausePolling}
                onBlur={resumePolling}
              >
                <option value="" disabled>
                  ENTREGADO POR:
                </option>
                {panolStaffList.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                id={`btn-listo-${o.reqId}`}
                className={`btn-figma-listo${!hasSelectedOp ? ' disabled' : ''}`}
                disabled={!hasSelectedOp}
                onClick={() => markReady(o.reqId)}
              >
                LISTO
              </button>
            </div>
          ) : (
            <div
              className="status-complete"
              style={{
                background: 'rgba(139, 148, 158, 0.12)',
                color: '#8b949e',
              }}
            >
              {o.status}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="panol-monitor-root">
      {/* ========================================================================= */}
      {/* CABECERA PRINCIPAL Y SUBMENÚ (FIGMA 793:1751)                             */}
      {/* ========================================================================= */}
      <header
        className="panol-header"
        style={
          activeView !== 'despacho'
            ? { height: 'auto', minHeight: '84px', paddingBottom: '20px' }
            : undefined
        }
      >
        <div className="header-row-top">
          <div className="header-brand">
            <h1>PAÑOL</h1>
            {envInfo && !envInfo.isProduction && (
              <div
                id="panolEnvBadge"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  background: '#052e16',
                  color: '#4ade80',
                  border: '1px solid #14532d',
                }}
              >
                <span id="panolEnvDot" style={{ color: '#22c55e' }}>
                  ●
                </span>
                <span id="panolEnvTitle">
                  LOCAL / PRUEBAS ({envInfo.spreadsheetTitle || 'DB LOCAL'})
                </span>
              </div>
            )}
          </div>

          <div className="top-nav">
            <button
              type="button"
              id="tab-despacho"
              className={`nav-tab${activeView === 'despacho' ? ' active' : ''}`}
              onClick={() => setActiveView('despacho')}
            >
              PEDIDOS
            </button>
            <button
              type="button"
              id="tab-returns"
              className={`nav-tab${activeView === 'returns' ? ' active' : ''}`}
              onClick={() => setActiveView('returns')}
            >
              DEVOLUCIÓN REPUESTO ANTERIOR{' '}
              <span id="returnsCount" className="badge">
                {returnsBoardCards.length}
              </span>
            </button>
            <button
              type="button"
              id="tab-returns-new"
              className={`nav-tab${activeView === 'returns-new' ? ' active' : ''}`}
              onClick={() => setActiveView('returns-new')}
            >
              DEVOLUCIÓN REPUESTO NUEVO{' '}
              <span id="returnsNewCount" className="badge">
                {pendingNewCount}
              </span>
            </button>
          </div>

          <div className="header-right">
            <div id="clock">{clockText}</div>
            <a
              href="/logout"
              onClick={handleLogout}
              title="Cerrar sesión"
              className="btn-header-salir"
            >
              Salir
            </a>
          </div>
        </div>

        {activeView === 'despacho' && (
          <div id="pedidosSubmenu" className="header-row-bottom">
            <div className="submenu-spacer" />
            <div className="submenu-nav">
              <button
                type="button"
                id="subtab-pendientes"
                className={`subtab-btn${
                  currentPedidosSubtab === 'PENDIENTES' ? ' active' : ''
                }`}
                onClick={() => setCurrentPedidosSubtab('PENDIENTES')}
              >
                PENDIENTES
              </button>
              <button
                type="button"
                id="subtab-completados"
                className={`subtab-btn${
                  currentPedidosSubtab === 'COMPLETADOS' ? ' active' : ''
                }`}
                onClick={() => setCurrentPedidosSubtab('COMPLETADOS')}
              >
                COMPLETADOS
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ========================================================================= */}
      {/* VISTA 1: TABLERO DE PEDIDOS (DESPACHO)                                    */}
      {/* ========================================================================= */}
      {activeView === 'despacho' && (
        <main
          id="view-despacho"
          className="panol-main"
          ref={viewDespachoRef}
          onMouseEnter={() => {
            isCarouselHoveredRef.current = true;
          }}
          onMouseLeave={() => {
            isCarouselHoveredRef.current = false;
            lastCardInteractionTimeRef.current = Date.now();
          }}
          onTouchStart={() => {
            isCarouselHoveredRef.current = true;
            lastCardInteractionTimeRef.current = Date.now();
          }}
          onTouchEnd={() => {
            isCarouselHoveredRef.current = false;
            lastCardInteractionTimeRef.current = Date.now();
          }}
        >
          <div id="board" className="grid" ref={boardRef}>
            {isInitialLoading ? (
              <div className="loading">
                <div className="spinner" />
                <div>Cargando pedidos...</div>
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  {currentPedidosSubtab === 'COMPLETADOS' ? '📦' : '✅'}
                </div>
                <div className="empty-title">
                  {currentPedidosSubtab === 'COMPLETADOS'
                    ? 'Sin pedidos completados'
                    : '¡Todo al día!'}
                </div>
                <div className="empty-text">
                  {currentPedidosSubtab === 'COMPLETADOS'
                    ? 'No hay pedidos entregados recientemente'
                    : 'No hay pedidos pendientes'}
                </div>
              </div>
            ) : (
              filteredOrders.map((order) => renderOrderCard(order))
            )}
          </div>
        </main>
      )}

      {/* ========================================================================= */}
      {/* VISTA 2: DEVOLUCIÓN REPUESTO ANTERIOR (CANJES)                            */}
      {/* ========================================================================= */}
      {activeView === 'returns' && (
        <main id="view-returns" className="panol-main">
          <div
            style={{
              fontSize: '1.1rem',
              fontWeight: 800,
              color: 'var(--text-white)',
              marginBottom: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <span>Devolución de repuesto anterior</span>
            <span
              style={{
                fontSize: '0.85rem',
                fontWeight: 600,
                color: 'var(--text-muted)',
              }}
            >
              Compara la cantidad original solicitada contra el estado declarado por el
              mecánico.
            </span>
          </div>

          <div id="returns-board">
            {returnsBoardCards.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">✅</div>
                <div className="empty-title">Sin devoluciones pendientes</div>
                <div className="empty-text">
                  No hay repuestos viejos a auditar en este momento.
                </div>
              </div>
            ) : (
              returnsBoardCards.map((card) => {
                const firstItemLoc = card.returnItems[0]?.loc || '';
                const locObj = formatLocationBox(card.unitInfo, firstItemLoc, card.opInfo, (card as any).box);
                const cleanMechName = String(card.opInfo || 'MECÁNICO')
                  .replace(/\[.*?\]/g, '')
                  .trim();
                const savedOpId =
                  pendingSelections[`ret_${card.reqId}`] || card.panolOpId || '';

                return (
                  <div
                    key={card.reqId}
                    className="card-horizontal"
                    id={`ret-card-${card.reqId}`}
                    style={{
                      marginBottom: '16px',
                      borderRadius: '12px',
                      background: '#161b22',
                      border: '1px solid #30363d',
                      borderLeft: '6px solid #f59e0b',
                      display: 'flex',
                      alignItems: 'stretch',
                    }}
                  >
                    <div
                      className="ch-left"
                      style={{
                        padding: '20px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        borderRight: '1px dashed rgba(255,255,255,0.15)',
                        minWidth: '200px',
                        maxWidth: '220px',
                        flexShrink: 0,
                      }}
                    >
                      {locObj.isSector ? (
                        <span
                          style={{
                            fontSize: '1.4rem',
                            fontWeight: 900,
                            color: 'var(--text-white)',
                            margin: '4px 0 8px 0',
                            lineHeight: 1.1,
                            letterSpacing: '-0.3px',
                            wordBreak: 'break-word',
                          }}
                        >
                          {locObj.value}
                        </span>
                      ) : (
                        <>
                          <span
                            style={{
                              fontSize: '0.8rem',
                              fontWeight: 800,
                              color: '#8B949E',
                              letterSpacing: '0.05em',
                              textTransform: 'uppercase',
                            }}
                          >
                            {locObj.label || 'BOX'}
                          </span>
                          <span
                            style={{
                              fontSize: '1.8rem',
                              fontWeight: 900,
                              color: 'var(--text-white)',
                              margin: '2px 0 6px 0',
                              lineHeight: 1.1,
                            }}
                          >
                            {locObj.value}
                          </span>
                        </>
                      )}
                      <span
                        style={{
                          fontSize: '0.85rem',
                          fontWeight: 700,
                          color: '#58A6FF',
                          fontFamily: 'monospace',
                        }}
                      >
                        OT: {card.otNumber || '--'}
                      </span>
                      <span
                        style={{
                          fontSize: '0.8rem',
                          fontWeight: 800,
                          color: '#8B949E',
                          textTransform: 'uppercase',
                          marginTop: '2px',
                        }}
                      >
                        {cleanMechName}
                      </span>
                    </div>

                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'flex-end',
                          padding: '14px 20px 8px 20px',
                        }}
                      >
                        <div
                          style={{
                            width: '300px',
                            paddingLeft: '20px',
                            boxSizing: 'border-box',
                            flexShrink: 0,
                          }}
                        >
                          <select
                            id={`ret-op-${card.reqId}`}
                            className={`panol-select${
                              shakingSelectIds[`ret-op-${card.reqId}`]
                                ? ' shake-error'
                                : ''
                            }`}
                            value={savedOpId}
                            onChange={(e) =>
                              setPendingSelections((prev) => ({
                                ...prev,
                                [`ret_${card.reqId}`]: e.target.value,
                              }))
                            }
                            onFocus={pausePolling}
                            onBlur={resumePolling}
                            style={{
                              width: '100%',
                              background: '#090d16',
                              border: '1px solid #30363d',
                              borderRadius: '6px',
                              padding: '7px 12px',
                              color: 'white',
                              fontWeight: 700,
                              fontSize: '0.85rem',
                            }}
                          >
                            <option value="" disabled>
                              👤 Revisa Pañolero...
                            </option>
                            {panolStaffList.map((s) => (
                              <option key={s.id} value={String(s.id)}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          flex: 1,
                          justifyContent: 'center',
                          paddingBottom: '8px',
                        }}
                      >
                        {card.returnItems.map((i, idx) => {
                          const isLast = idx === card.returnItems.length - 1;
                          const isAuditing = Boolean(auditingItemsMap[i.itemTag]);
                          const btnOkText = `✓ RECIBÍ ${i.returnedQty}`;
                          const btnOkTooltip = `Confirmar que recibiste exactamente ${i.returnedQty} unidad(es) de las ${i.qty} solicitadas originalmente.`;
                          const btnIncTooltip = `Reportar que NO recibiste las ${i.returnedQty} unidad(es) declaradas por el mecánico.`;

                          return (
                            <div
                              key={i.itemTag}
                              className="ret-row"
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: '10px 20px',
                                minHeight: '54px',
                                borderBottom: !isLast
                                  ? '1px solid rgba(255,255,255,0.06)'
                                  : undefined,
                              }}
                            >
                              <div
                                id={`ret-item-${i.itemTag}`}
                                style={{
                                  flex: 1,
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  paddingRight: '28px',
                                  opacity: i.isResolved || isAuditing ? 0.45 : 1,
                                  filter: i.isResolved ? 'grayscale(0.2)' : undefined,
                                  pointerEvents:
                                    i.isResolved || isAuditing ? 'none' : undefined,
                                }}
                              >
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                  <div
                                    style={{
                                      fontSize: '0.95rem',
                                      fontWeight: 800,
                                      color: '#F0F6FC',
                                      letterSpacing: '-0.2px',
                                    }}
                                  >
                                    • {i.name}{' '}
                                    <span
                                      style={{
                                        color: '#8B949E',
                                        fontWeight: 500,
                                        fontSize: '0.82rem',
                                      }}
                                    >
                                      [Pedido Original: x{i.qty}]
                                    </span>
                                  </div>
                                  {i.isFaltante && (
                                    <div
                                      style={{
                                        fontSize: '0.75rem',
                                        color: '#f59e0b',
                                        marginTop: '3px',
                                        fontWeight: 600,
                                      }}
                                    >
                                      ⚠ Motivo faltante: {i.reasonText}
                                    </div>
                                  )}
                                </div>

                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'baseline',
                                    gap: '8px',
                                    flexShrink: 0,
                                    marginLeft: '20px',
                                  }}
                                >
                                  <span
                                    style={{
                                      color: '#F59E0B',
                                      fontWeight: 700,
                                      fontSize: '0.85rem',
                                    }}
                                  >
                                    entrega:
                                  </span>
                                  <span
                                    style={{
                                      color: '#FFFFFF',
                                      fontSize: '1.6rem',
                                      fontWeight: 900,
                                      minWidth: '24px',
                                      textAlign: 'right',
                                      lineHeight: 1,
                                    }}
                                  >
                                    {i.returnedQty}
                                  </span>
                                </div>
                              </div>

                              <div
                                id={`ret-act-${i.itemTag}`}
                                style={{
                                  width: '300px',
                                  paddingLeft: '20px',
                                  boxSizing: 'border-box',
                                  flexShrink: 0,
                                  borderLeft: '1px solid rgba(255,255,255,0.1)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  opacity: isAuditing ? 0.4 : 1,
                                  pointerEvents: isAuditing ? 'none' : undefined,
                                }}
                              >
                                {i.isResolved ? (
                                  <div
                                    style={{
                                      width: '100%',
                                      textAlign: 'center',
                                      padding: '7px 12px',
                                      fontSize: '0.75rem',
                                      fontWeight: 900,
                                      borderRadius: '6px',
                                      background: i.isOk
                                        ? 'rgba(35, 134, 54, 0.15)'
                                        : 'rgba(217, 119, 6, 0.15)',
                                      color: i.isOk ? '#3FB950' : '#F59E0B',
                                      border: `1px solid ${
                                        i.isOk ? '#238636' : '#D97706'
                                      }`,
                                    }}
                                  >
                                    {i.isOk
                                      ? '✓ AUDITADO OK'
                                      : '⚠ AUDITADO INCOMPLETO'}
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                                    <button
                                      type="button"
                                      className="btn-ch ok"
                                      title={btnOkTooltip}
                                      onClick={() =>
                                        handleReturnAuditAction(
                                          card.reqId,
                                          i.name,
                                          'OK',
                                          null,
                                          i.itemTag,
                                          card.panolOpId,
                                          i.id || i.order_item_id
                                        )
                                      }
                                      style={{
                                        flex: 1,
                                        padding: '8px 10px',
                                        fontSize: '0.75rem',
                                        fontWeight: 900,
                                        background: 'rgba(35, 134, 54, 0.15)',
                                        color: '#3fb950',
                                        border: '1px solid #238636',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        textTransform: 'uppercase',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      {btnOkText}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-ch inc"
                                      title={btnIncTooltip}
                                      onClick={() =>
                                        openIncompletePopup(
                                          card.reqId,
                                          i.name,
                                          i.qty,
                                          i.returnedQty,
                                          i.itemTag,
                                          i.id || i.order_item_id
                                        )
                                      }
                                      style={{
                                        flex: 1,
                                        padding: '8px 10px',
                                        fontSize: '0.75rem',
                                        fontWeight: 900,
                                        background: 'transparent',
                                        color: '#f59e0b',
                                        border: '1px solid #d97706',
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        textTransform: 'uppercase',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      INCOMPLETO
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </main>
      )}

      {/* ========================================================================= */}
      {/* VISTA 3: DEVOLUCIÓN REPUESTO NUEVO (SIN USO)                              */}
      {/* ========================================================================= */}
      {activeView === 'returns-new' && (
        <main id="view-returns-new" className="panol-main">
          <div
            style={{
              fontSize: '1.1rem',
              fontWeight: 800,
              color: 'var(--text-white)',
              marginBottom: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <span>↩️ Devolución de repuesto nuevo (sin uso)</span>
            <span
              style={{
                fontSize: '0.85rem',
                fontWeight: 600,
                color: 'var(--text-muted)',
              }}
            >
              Reintegra aquellos repuestos nuevos entregados que hayan sido solicitados
              para devolución por el mecánico.
            </span>
          </div>

          <div id="returns-new-board">
            {returnsNewCards.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">✅</div>
                <div className="empty-title">Sin devoluciones de nuevos</div>
                <div className="empty-text">
                  No hay repuestos nuevos pendientes en esta sección.
                </div>
              </div>
            ) : (
              returnsNewCards.map((card) => {
                const isPendingSubtab = true;
                const firstItemLoc = card.eligibleItems[0]?.loc || '';
                const locObj = formatLocationBox(
                  card.unitInfo,
                  firstItemLoc,
                  card.opInfo,
                  card.box
                );
                const cleanMechName = String(card.opInfo || 'MECÁNICO')
                  .replace(/\[.*?\]/g, '')
                  .trim();
                const savedOpId =
                  pendingSelections[`newret_${card.reqId}`] || card.panolOpId || '';
                const isReintegrating = Boolean(reintegratingRowMap[card.reqId]);

                return (
                  <div
                    key={card.reqId}
                    className="card-horizontal"
                    id={`newret-card-${card.reqId}`}
                    style={{
                      marginBottom: '16px',
                      borderRadius: '12px',
                      background: '#161b22',
                      border: '1px solid #30363d',
                      borderLeft: '6px solid #3b82f6',
                      display: 'flex',
                      alignItems: 'stretch',
                      opacity: isReintegrating ? 0.7 : 1,
                      pointerEvents: isReintegrating ? 'none' : undefined,
                    }}
                  >
                    <div
                      className="ch-left"
                      style={{
                        padding: '20px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        borderRight: '1px dashed rgba(255,255,255,0.15)',
                        minWidth: '200px',
                        maxWidth: '220px',
                        flexShrink: 0,
                      }}
                    >
                      {locObj.isSector ? (
                        <span
                          style={{
                            fontSize: '1.4rem',
                            fontWeight: 900,
                            color: 'var(--text-white)',
                            margin: '4px 0 8px 0',
                            lineHeight: 1.1,
                            letterSpacing: '-0.3px',
                            wordBreak: 'break-word',
                          }}
                        >
                          {locObj.value}
                        </span>
                      ) : (
                        <>
                          <span
                            style={{
                              fontSize: '0.8rem',
                              fontWeight: 800,
                              color: '#8B949E',
                              letterSpacing: '0.05em',
                              textTransform: 'uppercase',
                            }}
                          >
                            {locObj.label || 'BOX'}
                          </span>
                          <span
                            style={{
                              fontSize: '1.8rem',
                              fontWeight: 900,
                              color: 'var(--text-white)',
                              margin: '2px 0 6px 0',
                              lineHeight: 1.1,
                            }}
                          >
                            {locObj.value}
                          </span>
                        </>
                      )}
                      <span
                        style={{
                          fontSize: '0.85rem',
                          fontWeight: 700,
                          color: '#58A6FF',
                          fontFamily: 'monospace',
                        }}
                      >
                        OT: {card.otNumber || '--'}
                      </span>
                      <span
                        style={{
                          fontSize: '0.8rem',
                          fontWeight: 800,
                          color: '#8B949E',
                          textTransform: 'uppercase',
                          marginTop: '2px',
                        }}
                      >
                        {cleanMechName}
                      </span>
                    </div>

                    <div
                      className="ch-middle"
                      style={{
                        flex: 1,
                        padding: '16px 24px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                      }}
                    >
                      {card.eligibleItems.map((i, idx) => {
                        const isPending =
                          i.status === 'DEVOLUCION PENDIENTE' ||
                          (String(i.notesColO || i.note || '').toUpperCase().includes('SOLICITUD DEVOLUCIÓN NUEVA') &&
                            !String(i.notesColO || i.note || '').toUpperCase().includes('DEVOLUCIÓN ACEPTADA'));
                        let reasonText = '';
                        if (i.notesColO) {
                          reasonText = i.notesColO
                            .replace(/SOLICITUD DEVOLUCIÓN NUEVA PARCIAL:\s*/i, '')
                            .replace(/SOLICITUD DEVOLUCIÓN NUEVA:\s*/i, '')
                            .replace(/DEVOLUCIÓN ACEPTADA:\s*/i, '')
                            .trim();
                        }
                        if (!reasonText && i.note) {
                          reasonText = i.note
                            .replace(/SOLICITUD DEVOLUCIÓN NUEVA PARCIAL:\s*/i, '')
                            .replace(/SOLICITUD DEVOLUCIÓN NUEVA:\s*/i, '')
                            .replace(/DEVOLUCIÓN ACEPTADA:\s*/i, '')
                            .trim();
                        }
                        if (!reasonText && card.notes) {
                          reasonText = String(card.notes).trim();
                        }

                        return (
                          <div
                            key={`${card.reqId}-newret-${idx}`}
                            className="ret-item-row"
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '10px 0',
                              borderTop: idx > 0 ? '1px solid #21262d' : undefined,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '4px',
                              }}
                            >
                              <div
                                style={{
                                  fontSize: '0.95rem',
                                  fontWeight: 800,
                                  color: '#F0F6FC',
                                  letterSpacing: '-0.2px',
                                }}
                              >
                                • {i.name}{' '}
                                <span
                                  style={{
                                    color: '#8B949E',
                                    fontWeight: 500,
                                    fontSize: '0.85rem',
                                  }}
                                >
                                  (Cant. a devolver: x{i.qty})
                                </span>
                              </div>
                              <div
                                style={{
                                  fontSize: '0.75rem',
                                  color: isPending ? '#f59e0b' : '#3fb950',
                                  fontWeight: 700,
                                }}
                              >
                                {isPending
                                  ? '↳ Solicitado para devolución por el mecánico'
                                  : '✓ Reintegrado a stock'}
                              </div>
                            </div>

                            {reasonText && (
                              <div
                                style={{
                                  display: 'flex',
                                  gap: '8px',
                                  alignItems: 'baseline',
                                  maxWidth: '480px',
                                  fontSize: '0.85rem',
                                  lineHeight: 1.4,
                                  marginLeft: 'auto',
                                }}
                              >
                                <span
                                  style={{
                                    color: '#f59e0b',
                                    fontWeight: 800,
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  Motivo:
                                </span>
                                <span style={{ color: '#e6edf3', fontWeight: 600 }}>
                                  {reasonText}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div
                      className="ch-right"
                      style={{
                        width: '260px',
                        minWidth: '260px',
                        padding: '20px',
                        boxSizing: 'border-box',
                        flexShrink: 0,
                        borderLeft: '1px solid rgba(255,255,255,0.1)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        gap: '12px',
                        background: 'rgba(0,0,0,0.15)',
                      }}
                    >
                      <div>
                        <select
                          id={`newret-op-${card.reqId}`}
                          className={`panol-select${
                            shakingSelectIds[`newret-op-${card.reqId}`]
                              ? ' shake-error'
                              : ''
                          }`}
                          value={savedOpId}
                          onChange={(e) =>
                            setPendingSelections((prev) => ({
                              ...prev,
                              [`newret_${card.reqId}`]: e.target.value,
                            }))
                          }
                          onFocus={pausePolling}
                          onBlur={resumePolling}
                          style={{
                            width: '100%',
                            background: '#090d16',
                            border: '1px solid #30363d',
                            borderRadius: '6px',
                            padding: '9px 12px',
                            color: 'white',
                            fontWeight: 700,
                            fontSize: '0.85rem',
                          }}
                        >
                          <option value="" disabled>
                            👤 Revisa Pañolero...
                          </option>
                          {panolStaffList.map((s) => (
                            <option key={s.id} value={String(s.id)}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div id={`act-newret-box-${card.reqId}`}>
                        {isPendingSubtab ? (
                          <button
                            type="button"
                            className="btn-ch ok"
                            id={`act-newret-btn-${card.reqId}`}
                            disabled={isReintegrating}
                            onClick={() =>
                              confirmNewReturnRow(
                                card.reqId,
                                card.panolOpId,
                                card.eligibleItems.length === 1 ? card.eligibleItems[0].id : undefined
                              )
                            }
                            style={{
                              width: '100%',
                              padding: '12px 14px',
                              fontSize: '0.8rem',
                              fontWeight: 900,
                              background: 'rgba(35, 134, 54, 0.2)',
                              color: '#3fb950',
                              border: '1px solid #238636',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              textTransform: 'uppercase',
                              letterSpacing: '0.3px',
                              transition: '0.2s',
                              opacity: isReintegrating ? 0.6 : 1,
                            }}
                          >
                            {isReintegrating
                              ? '⏳ REINTEGRANDO...'
                              : '✓ REINTEGRAR A STOCK'}
                          </button>
                        ) : (
                          <div
                            style={{
                              width: '100%',
                              textAlign: 'center',
                              padding: '10px 12px',
                              fontSize: '0.75rem',
                              fontWeight: 900,
                              borderRadius: '6px',
                              background: 'rgba(35, 134, 54, 0.15)',
                              color: '#3FB950',
                              border: '1px solid #238636',
                            }}
                          >
                            ✓ REINTEGRADO A STOCK
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </main>
      )}

      {/* ========================================================================= */}
      {/* MODALES PAÑOL (#panolModal)                                               */}
      {/* ========================================================================= */}

      {/* 1. Modal Eliminar Ítem */}
      <div
        className={`modal-overlay${removeModalData ? ' active' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setRemoveModalData(null);
            resumePolling();
          }
        }}
      >
        {removeModalData && (
          <div className="modal-content">
            <div className="modal-title">⚠️ Eliminar Ítem</div>
            <div className="modal-body">
              <div className="modal-info">
                ¿Seguro que querés eliminar{' '}
                <strong>{removeModalData.itemName}</strong> del pedido?
                <br />
                La cantidad se devolverá al stock.
              </div>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn cancel"
                onClick={() => {
                  setRemoveModalData(null);
                  resumePolling();
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="modal-btn danger"
                onClick={confirmRemoveItem}
              >
                Sí, Eliminar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. Modal Agregar Ítem al Pedido */}
      <div
        className={`modal-overlay${addItemModalReqId ? ' active' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setAddItemModalReqId(null);
            resumePolling();
          }
        }}
      >
        {addItemModalReqId && (
          <div className="modal-content">
            <div className="modal-title">＋ Agregar Ítem al Pedido</div>
            <div className="modal-body">
              <label>Buscar repuesto</label>
              <input
                ref={addItemInputRef}
                type="text"
                id="addItemSearchInput"
                placeholder="Nombre del repuesto..."
                value={addItemSearchQuery}
                onChange={(e) => handleSearchItemsForAdd(e.target.value)}
                autoComplete="off"
              />
              <div id="addItemResults" className="search-results">
                {isSearchingInventory ? (
                  <div
                    style={{
                      padding: '12px',
                      color: 'var(--text-muted)',
                      fontSize: '0.85rem',
                    }}
                  >
                    Buscando...
                  </div>
                ) : addItemSearchQuery.trim().length >= 2 &&
                  !addItemSelectedItem &&
                  addItemSearchResults.length === 0 ? (
                  <div
                    style={{
                      padding: '12px',
                      color: 'var(--text-muted)',
                      fontSize: '0.85rem',
                    }}
                  >
                    Sin resultados.
                  </div>
                ) : (
                  addItemSearchResults.map((r, i) => (
                    <div
                      key={`${r.name}-${i}`}
                      className="search-result-item"
                      onClick={() => selectItemForAdd(r.name, r.stock, r.code)}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span className="sr-name">{r.name}</span>
                        {r.code && (
                          <span style={{ fontSize: '0.72rem', color: '#58a6ff', fontFamily: 'monospace' }}>
                            {r.code}
                          </span>
                        )}
                      </div>
                      <span className="sr-stock">📦 Stock: {r.stock || 0}</span>
                    </div>
                  ))
                )}
              </div>

              {addItemSelectedItem && (
                <div id="addItemConfirmRow">
                  <div className="sr-add-row">
                    <span className="sr-selected-name">
                      ✓ {addItemSelectedItem.name}
                    </span>
                    <span
                      style={{
                        fontSize: '0.8rem',
                        color: 'var(--text-muted)',
                        fontWeight: 700,
                      }}
                    >
                      📦 {addItemSelectedItem.stock}
                    </span>
                    <label style={{ margin: 0, fontSize: '0.75rem' }}>QTY:</label>
                    <input
                      type="number"
                      id="addItemQtyInput"
                      value={addItemQty}
                      min={1}
                      onChange={(e) =>
                        setAddItemQty(Math.max(1, parseInt(e.target.value, 10) || 1))
                      }
                      className="qty-input"
                      style={{ width: '55px' }}
                      onFocus={pausePolling}
                      onBlur={resumePolling}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn cancel"
                onClick={() => {
                  setAddItemModalReqId(null);
                  resumePolling();
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="modal-btn primary"
                id="btnConfirmAddItem"
                disabled={!addItemSelectedItem}
                onClick={confirmAddItem}
              >
                Agregar al Pedido
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. Modal Declaración de Devolución Incompleta */}
      <div
        className={`modal-overlay${incompleteModalData ? ' active' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setIncompleteModalData(null);
            resumePolling();
          }
        }}
      >
        {incompleteModalData && (
          <div className="modal-content">
            <div className="modal-title">
              ⚠️ Declaración de Devolución Incompleta
            </div>
            <div className="modal-body">
              <div className="modal-info">
                <strong>{incompleteModalData.itemName}</strong>
                <br />
                El mecánico declaró:{' '}
                <strong>{incompleteModalData.declaredByMechanic}</strong> de{' '}
                <strong>{incompleteModalData.originalQty}</strong> unidad(es)
              </div>
              <label>Cantidad efectivamente recibida</label>
              <input
                ref={incompleteInputRef}
                type="number"
                id="incompleteQtyInput"
                value={incompleteQtyInput}
                min={0}
                max={incompleteModalData.originalQty}
                onChange={(e) => setIncompleteQtyInput(e.target.value)}
                onFocus={pausePolling}
                onBlur={resumePolling}
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn cancel"
                onClick={() => {
                  setIncompleteModalData(null);
                  resumePolling();
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="modal-btn danger"
                onClick={confirmIncomplete}
              >
                Confirmar Incompleto
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
