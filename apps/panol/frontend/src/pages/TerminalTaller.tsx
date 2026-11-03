import React, { useState, useEffect, useMemo } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useCartStore } from '../stores/cartStore';
import {
  getItemCatalog,
  getFleetSearchCatalog,
  submitBatchOrder,
  getOrdersFeed,
  findUnitOrOt,
  getOperarioHoldUnits,
  addOperarioHoldUnit,
  removeOperarioHoldUnit,
  requestOrderReturn,
} from '../services/tallerApi';
import { getSocket } from '../services/socket';
import { supabase } from '../services/supabaseClient';
import { CatalogItem, PanolOrder, HoldUnit } from '../types';
import { parseCanjeStatus, formatCanjeBadge } from '../utils/canjeHelper';
import { toast } from 'sonner';
import {
  Search,
  RefreshCw,
  Edit3,
  X,
  Plus,
  Minus,
  Check,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { WorkOrderTimeline } from '../components/taller/WorkOrderTimeline';
import { LicensePlate } from '../components/common/LicensePlate';
import { resolveBoxOrSector } from './MonitorPanol';

export const cleanTallerItemNote = (note?: string): string => {
  if (!note) return '';
  return String(note)
    .replace(/devoluci[oó]n[^|]*(\|)?\s*/gi, '')
    .replace(/\[op:[^\]]*\]\s*(-)?\s*(ok|incompleto)?(\|)?\s*/gi, '')
    .replace(/despacho listo:[^|]*(\|)?\s*/gi, '')
    .trim();
};

export const TerminalTaller: React.FC = () => {
  const { user, activeBox, logout } = useAuthStore();
  const { items: cartItems, addItem, removeItem, updateQuantity, setQuantity, clearCart } = useCartStore();
  const navigate = useNavigate();

  // Pestaña principal: ORDENES (Unidad, Tareas & Catálogo) vs PEDIDOS (Monitor)
  const [activeMainTab, setActiveMainTab] = useState<'ordenes' | 'pedidos'>('ordenes');

  // Clave de caché aislada e independiente para las retenciones del puesto de cada operario
  const getHoldsCacheKey = (opCodeOrId?: string) => {
    const clean = String(opCodeOrId || '').trim();
    return clean ? `panol_cached_holds_${clean}` : null;
  };

  // Unidades en Bahía / Puesto de Taller (Estrictamente delimitado por panol.staff_holds para el operario activo)
  const [holdUnits, setHoldUnits] = useState<HoldUnit[]>(() => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('panol_cached_holds');
        localStorage.removeItem('mechanic_op');
      }
      const key = getHoldsCacheKey(user?.op_code || user?.id);
      if (!key || typeof window === 'undefined') return [];
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [selectedHoldIndex, setSelectedHoldIndex] = useState<number>(() => (holdUnits.length > 0 ? 0 : -1));

  // Título de la pestaña de navegación: Taller a secas
  useEffect(() => {
    document.title = 'Taller';
    try {
      if (window.top && window.top !== window) {
        window.top.document.title = 'Taller';
      }
    } catch (e) {}
  }, []);

  // Sincronizar holds en localStorage de forma aislada por operario para persistencia ante Ctrl+R / F5
  useEffect(() => {
    const key = getHoldsCacheKey(user?.op_code || user?.id);
    if (!key || typeof window === 'undefined') return;
    try {
      if (holdUnits.length > 0) {
        localStorage.setItem(key, JSON.stringify(holdUnits));
      } else {
        localStorage.removeItem(key);
      }
    } catch (e) {}
  }, [holdUnits, user?.op_code, user?.id]);

  // Inputs de carga limpios (sin valores precargados)
  const [inputTractorPlate, setInputTractorPlate] = useState('');
  const [inputTractorOt, setInputTractorOt] = useState('');
  const [inputSemiPlate, setInputSemiPlate] = useState('');
  const [inputSemiOt, setInputSemiOt] = useState('');

  // Resizers de pantalla (Vertical entre columnas, Horizontal entre catálogo y pedido)
  const [leftColWidthPct, setLeftColWidthPct] = useState<number>(50);
  const [isDraggingV, setIsDraggingV] = useState(false);
  const [catalogHeightPct, setCatalogHeightPct] = useState<number>(55);
  const [isDraggingH, setIsDraggingH] = useState(false);

  // Modal para Devolución de Repuesto (Mecánicos)
  const [returnModalData, setReturnModalData] = useState<{
    order: any;
    selectedItemId?: string;
    selectedItemName: string;
    maxQty: number;
    returnQty: number;
    reason: string;
  } | null>(null);

  // Unidad activa seleccionada
  const activeUnit = useMemo(() => {
    if (holdUnits.length === 0 || selectedHoldIndex < 0 || selectedHoldIndex >= holdUnits.length) {
      return null;
    }
    return holdUnits[selectedHoldIndex];
  }, [holdUnits, selectedHoldIndex]);

  // Destino del pedido: TRACTOR o SEMI
  const [orderTarget, setOrderTarget] = useState<'TRACTOR' | 'SEMI'>('TRACTOR');

  // Catálogos
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [fleetPlates, setFleetPlates] = useState<{ tractores: string[]; semis: string[] }>({
    tractores: [],
    semis: [],
  });
  const [fleetPairs, setFleetPairs] = useState<any[]>([]);

  // Filtros del catálogo
  const [selectedCategory, setSelectedCategory] = useState('ELECTRICO');
  const [searchQuery, setSearchQuery] = useState('');

  // Pedidos
  const [orders, setOrders] = useState<PanolOrder[]>([]);
  const [ordersFilter, setOrdersFilter] = useState<'ACTIVOS' | 'HISTORIAL'>('ACTIVOS');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSearchingPair, setIsSearchingPair] = useState(false);

  // Modal para Declaración de Canje / Repuesto Usado
  interface CanjeDeclaration {
    itemId: string;
    itemName: string;
    qty: number;
    tipo: 'ENTREGO_USADA' | 'FALTANTE';
    missingQty: number;
    motivo: string;
  }
  const [showCanjeModal, setShowCanjeModal] = useState(false);
  const [canjeDeclarations, setCanjeDeclarations] = useState<CanjeDeclaration[]>([]);

  // Modal para editar notas de ítem del carrito
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemNoteText, setItemNoteText] = useState('');
  const [itemNotesMap, setItemNotesMap] = useState<Record<string, string>>({});

  // Delimitación de pedidos: pedidos propios del operario conectado
  const myOrders = useMemo(() => {
    const currentOpCode = String(user?.op_code || user?.id || '').trim();
    const currentName = String(user?.name || '').trim().toLowerCase();
    const curStaffId = String(user?.id || '').trim();

    return orders.filter((o: any) => {
      // 1. Filtrar por estado (ACTIVOS vs HISTORIAL)
      const isActiveStatus = ['PENDIENTE', 'PREPARANDO', 'LISTO', 'DEVOLUCION PENDIENTE', 'DEVOLUCION_PENDIENTE'].includes(o.status);
      const isHistStatus = ['ENTREGADO', 'DEVUELTO', 'DEVOLUCION', 'CANCELADO'].includes(o.status);

      if (ordersFilter === 'ACTIVOS' && !isActiveStatus) return false;
      if (ordersFilter === 'HISTORIAL' && !isHistStatus) return false;

      // 2. Filtrar por operario conectado
      const oOp = String(o.opId || o.mechanic_op_code || '').trim();
      const oStaffId = String(o.mechanic_id || '').trim();
      const oName = String(o.opInfo || o.mechanic_name || '').trim().toLowerCase();

      const isMine =
        !currentOpCode ||
        (curStaffId && oStaffId === curStaffId) ||
        (currentOpCode && oOp === currentOpCode) ||
        (currentName && oName.includes(currentName));
      return isMine;
    });
  }, [orders, user, ordersFilter]);

  // Cantidad de pedidos activos del mecánico conectado
  const myActiveOrdersCount = useMemo(() => {
    const currentOpCode = String(user?.op_code || user?.id || '').trim();
    const currentName = String(user?.name || '').trim().toLowerCase();
    const curStaffId = String(user?.id || '').trim();

    return orders.filter((o: any) => {
      const oOp = String(o.opId || o.mechanic_op_code || '').trim();
      const oStaffId = String(o.mechanic_id || '').trim();
      const oName = String(o.opInfo || o.mechanic_name || '').trim().toLowerCase();
      const isMine =
        !currentOpCode ||
        (curStaffId && oStaffId === curStaffId) ||
        (currentOpCode && oOp === currentOpCode) ||
        (currentName && oName.includes(currentName));
      return isMine && ['PENDIENTE', 'PREPARANDO', 'LISTO', 'DEVOLUCION PENDIENTE', 'DEVOLUCION_PENDIENTE'].includes(o.status);
    }).length;
  }, [orders, user]);

  // Listeners para resizer vertical (entre mitad izquierda y mitad derecha)
  useEffect(() => {
    if (!isDraggingV) return;
    const handleMove = (e: MouseEvent) => {
      const totalWidth = window.innerWidth;
      const minPct = Math.max(35, (560 / totalWidth) * 100);
      const maxPct = Math.min(75, 100 - (340 / totalWidth) * 100);
      const pct = Math.min(maxPct, Math.max(minPct, (e.clientX / totalWidth) * 100));
      setLeftColWidthPct(pct);
    };
    const handleUp = () => setIsDraggingV(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDraggingV]);

  // Listeners para resizer horizontal (entre catálogo y carrito)
  useEffect(() => {
    if (!isDraggingH) return;
    const handleMove = (e: MouseEvent) => {
      const containerTop = 52;
      const totalH = window.innerHeight - containerTop - 16;
      const currentY = e.clientY - containerTop;
      const pct = Math.min(80, Math.max(20, (currentY / totalH) * 100));
      setCatalogHeightPct(pct);
    };
    const handleUp = () => setIsDraggingH(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDraggingH]);

  // Carga inicial y listeners reactivos
  useEffect(() => {
    // Si cambia el usuario conectado, resetear inmediatamente las unidades al nuevo operario
    const userKey = getHoldsCacheKey(user?.op_code || user?.id);
    let initialUserHolds: HoldUnit[] = [];
    if (userKey && typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(userKey);
        if (saved) initialUserHolds = JSON.parse(saved);
      } catch (e) {}
    }
    setHoldUnits(initialUserHolds);
    setSelectedHoldIndex(initialUserHolds.length > 0 ? 0 : -1);
    if (initialUserHolds.length > 0) {
      setInputTractorPlate(initialUserHolds[0].tractorPlate || '');
      setInputTractorOt(initialUserHolds[0].tractorOt || '');
      setInputSemiPlate(initialUserHolds[0].semiPlate || '');
      setInputSemiOt(initialUserHolds[0].semiOt || '');
    } else {
      setInputTractorPlate('');
      setInputTractorOt('');
      setInputSemiPlate('');
      setInputSemiOt('');
    }

    loadData();

    const socket = getSocket();
    const handleOrdersSync = (newOrders: any[]) => {
      if (Array.isArray(newOrders)) {
        setOrders(newOrders);
      }
    };

    const handleFleetCatalogSync = () => {
      getFleetSearchCatalog().then((fleet) => {
        if (fleet && Array.isArray(fleet.pairs)) {
          setFleetPlates({ tractores: fleet.tractores || [], semis: fleet.semis || [] });
          setFleetPairs(fleet.pairs || []);
        }
      });
    };

    const handleHoldSync = (data: { opId?: string; units?: any[] }) => {
      const myOp = String(user?.op_code || user?.id || '').trim();
      if (!myOp) return;
      if (data?.opId) {
        const clean1 = String(data.opId).trim();
        const clean2 = myOp;
        const match =
          clean1 === clean2 ||
          clean1 === clean2 + clean2 ||
          clean2 === clean1 + clean1 ||
          parseInt(clean1, 10) === parseInt(clean2, 10);
        if (!match) return;
      }
      getOperarioHoldUnits(myOp).then((holds) => {
        if (Array.isArray(holds)) {
          setHoldUnits(holds);
          const key = getHoldsCacheKey(myOp);
          if (holds.length > 0) {
            if (key) {
              try { localStorage.setItem(key, JSON.stringify(holds)); } catch (e) {}
            }
            setSelectedHoldIndex((prev) => (prev < 0 || prev >= holds.length ? 0 : prev));
          } else {
            if (key) {
              try { localStorage.removeItem(key); } catch (e) {}
            }
            setSelectedHoldIndex(-1);
          }
        }
      });
    };

    socket.on('orders_sync', handleOrdersSync);
    socket.on('taller_hold_updated', handleHoldSync);
    socket.on('ot_updated', handleFleetCatalogSync);
    socket.on('fleet_catalog_updated', handleFleetCatalogSync);

    // 🐘 Suscripción Reactiva en tiempo real (Supabase Realtime)
    const realtimeChannel = supabase
      .channel('terminal-taller-fleet-ots')
      .on('postgres_changes', { event: '*', schema: 'panol', table: 'unit_work_orders' }, () => {
        handleFleetCatalogSync();
      })
      .on('postgres_changes', { event: '*', schema: 'panol', table: 'work_orders' }, () => {
        handleFleetCatalogSync();
      })
      .on('postgres_changes', { event: '*', schema: 'panol', table: 'staff_holds' }, (payload) => {
        const myStaffId = user?.id;
        const myOp = String(user?.op_code || user?.id || '').trim();
        if (!myOp) return;
        const changedStaffId = (payload.new as any)?.staff_id || (payload.old as any)?.staff_id;
        if (!changedStaffId || changedStaffId === myStaffId) {
          getOperarioHoldUnits(myOp).then((holds) => {
            if (Array.isArray(holds)) {
              setHoldUnits(holds);
              const key = getHoldsCacheKey(myOp);
              if (holds.length > 0) {
                if (key) {
                  try { localStorage.setItem(key, JSON.stringify(holds)); } catch (e) {}
                }
                setSelectedHoldIndex((prev) => (prev < 0 || prev >= holds.length ? 0 : prev));
              } else {
                if (key) {
                  try { localStorage.removeItem(key); } catch (e) {}
                }
                setSelectedHoldIndex(-1);
              }
            }
          });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'panol', table: 'work_order_tasks' }, (payload) => {
        const myStaffId = user?.id;
        const myOp = String(user?.op_code || user?.id || '').trim();
        if (!myOp) return;
        const workerId = (payload.new as any)?.worker_id || (payload.old as any)?.worker_id;
        if (!workerId || workerId === myStaffId) {
          getOperarioHoldUnits(myOp).then((holds) => {
            if (Array.isArray(holds)) {
              setHoldUnits(holds);
              const key = getHoldsCacheKey(myOp);
              if (holds.length > 0 && key) {
                try { localStorage.setItem(key, JSON.stringify(holds)); } catch (e) {}
              }
            }
          });
        }
      })
      .subscribe();

    return () => {
      socket.off('orders_sync', handleOrdersSync);
      socket.off('taller_hold_updated', handleHoldSync);
      socket.off('ot_updated', handleFleetCatalogSync);
      socket.off('fleet_catalog_updated', handleFleetCatalogSync);
      supabase.removeChannel(realtimeChannel);
    };
  }, [user]);

  const loadData = async () => {
    try {
      const opCode = String(user?.op_code || user?.id || '').trim();
      const [cat, fleet, ords, holds] = await Promise.all([
        getItemCatalog(),
        getFleetSearchCatalog(),
        getOrdersFeed(),
        opCode ? getOperarioHoldUnits(opCode) : Promise.resolve([]),
      ]);

      if (cat.length > 0) {
        setCatalogItems(cat);
      } else {
        setCatalogItems([
          { id: 'c-1', code: 'E-01', description: 'Alternador, IVECO 330/360 Reparado', category: 'ELECTRICO', stock: 4, unit: 'UN', requires_exchange: true },
          { id: 'c-2', code: 'E-02', description: 'ARO DE GOMA DE RULEMAN GRANDE G1521 DIPRA', category: 'ELECTRICO', stock: 12, unit: 'UN', requires_exchange: false },
          { id: 'c-3', code: 'E-03', description: 'AUTOMATICO AUXILIAR 24V ZM', category: 'ELECTRICO', stock: 6, unit: 'UN', requires_exchange: true },
        ]);
      }

      setFleetPlates({ tractores: fleet.tractores, semis: fleet.semis });
      setFleetPairs(fleet.pairs || []);
      setOrders(ords);

      // Cargar unidades en puesto reales desde Supabase (delimitado por panol.staff_holds para este operario)
      const key = getHoldsCacheKey(opCode);
      if (Array.isArray(holds)) {
        setHoldUnits(holds);
        if (holds.length > 0) {
          if (key) {
            try { localStorage.setItem(key, JSON.stringify(holds)); } catch (e) {}
          }
          setSelectedHoldIndex((prev) => (prev >= 0 && prev < holds.length ? prev : 0));
          setInputTractorPlate(holds[0].tractorPlate || '');
          setInputTractorOt(holds[0].tractorOt || '');
          setInputSemiPlate(holds[0].semiPlate || '');
          setInputSemiOt(holds[0].semiOt || '');
        } else {
          // Si el operario no tiene unidades retenidas en staff_holds, limpiar la sección y su caché
          if (key) {
            try { localStorage.removeItem(key); } catch (e) {}
          }
          setSelectedHoldIndex(-1);
          setInputTractorPlate('');
          setInputTractorOt('');
          setInputSemiPlate('');
          setInputSemiOt('');
        }
      }
    } catch (err) {
      console.error('Error loading taller data:', err);
    }
  };

  // Agregar unidad al puesto (Persistencia en Supabase panol.staff_holds)
  const handleAddUnitToHold = async () => {
    const tp = inputTractorPlate.trim().toUpperCase();
    const tot = inputTractorOt.trim();
    const sp = inputSemiPlate.trim().toUpperCase();
    const sot = inputSemiOt.trim();

    if (!tp && !tot && !sp && !sot) {
      toast.warning('Ingresa al menos una patente o número de OT para cargar la unidad.');
      return;
    }

    // Poka-Yoke: Evitar cargar un conjunto de patentes repetido en el puesto
    const cleanTp = tp.replace(/[\s\-_.]/g, '');
    const cleanSp = sp.replace(/[\s\-_.]/g, '');
    const isDuplicate = holdUnits.some((u) => {
      const uTp = (u.tractorPlate || '').replace(/[\s\-_.]/g, '');
      const uSp = (u.semiPlate || '').replace(/[\s\-_.]/g, '');
      return (cleanTp && uTp && cleanTp === uTp) || (cleanSp && uSp && cleanSp === uSp);
    });

    if (isDuplicate) {
      toast.warning('⚠️ Esta unidad (o patente) ya se encuentra cargada en el puesto de trabajo.');
      return;
    }

    const opCode = String(user?.op_code || user?.id || '').trim();
    if (!opCode) {
      toast.warning('No se pudo identificar al operario para cargar la unidad en puesto.');
      return;
    }
    const saved = await addOperarioHoldUnit({
      opCode,
      tractorPlate: tp,
      tractorOt: tot,
      semiPlate: sp,
      semiOt: sot,
      brand: activeUnit?.brand || 'TRACTOR',
      brandSemi: activeUnit?.brandSemi || 'SEMI',
    });

    const newUnit: HoldUnit = {
      id: saved?.id,
      tractorWorkOrderId: saved?.tractorWorkOrderId,
      semiWorkOrderId: saved?.semiWorkOrderId,
      tractorPlate: tp,
      tractorOt: tot,
      semiPlate: sp,
      semiOt: sot,
      brand: activeUnit?.brand || 'TRACTOR',
      brandSemi: activeUnit?.brandSemi || 'SEMI',
      addedAt: new Date().toISOString(),
    };

    const updated = [newUnit, ...holdUnits];
    setHoldUnits(updated);
    const key = getHoldsCacheKey(opCode);
    if (key) {
      try { localStorage.setItem(key, JSON.stringify(updated)); } catch (e) {}
    }
    setSelectedHoldIndex(0);
    // Limpiar campos de carga para el siguiente ingreso
    setInputTractorPlate('');
    setInputTractorOt('');
    setInputSemiPlate('');
    setInputSemiOt('');
    toast.success('Unidad agregada al puesto de trabajo.');
  };

  // Remover unidad del puesto
  const handleRemoveUnitFromHold = async (idx: number) => {
    const unitToRemove = holdUnits[idx];
    if (unitToRemove?.id) {
      await removeOperarioHoldUnit(unitToRemove.id);
    }
    const updated = holdUnits.filter((_, i) => i !== idx);
    setHoldUnits(updated);
    const key = getHoldsCacheKey(user?.op_code || user?.id);
    if (key) {
      try {
        if (updated.length > 0) {
          localStorage.setItem(key, JSON.stringify(updated));
        } else {
          localStorage.removeItem(key);
        }
      } catch (e) {}
    }
    if (updated.length === 0) {
      setSelectedHoldIndex(-1);
      setInputTractorPlate('');
      setInputTractorOt('');
      setInputSemiPlate('');
      setInputSemiOt('');
    } else if (selectedHoldIndex >= idx) {
      setSelectedHoldIndex(Math.max(0, selectedHoldIndex - 1));
    }
    toast.info('Unidad removida del puesto.');
  };

  // Búsqueda bidireccional
  const handleBidirectionalSearch = async (val?: string, type: 'TRACTOR' | 'OT' | 'SEMI' | 'SEMI_OT' = 'TRACTOR') => {
    const q = val || inputTractorPlate || inputTractorOt || inputSemiPlate || inputSemiOt;
    if (!q || isSearchingPair) return;

    setIsSearchingPair(true);
    try {
      const res = await findUnitOrOt(q.trim().toUpperCase(), type);
      if (res && res.success) {
        if (res.unit) setInputTractorPlate(res.unit.toUpperCase());
        else setInputTractorPlate('');
        if (res.ot) setInputTractorOt(String(res.ot));
        else setInputTractorOt('');
        if (res.semi) setInputSemiPlate(res.semi.toUpperCase());
        else setInputSemiPlate('');
        if (res.semiOt) setInputSemiOt(String(res.semiOt));
        else setInputSemiOt('');
        toast.info('Búsqueda bidireccional vinculada con éxito.');
      } else {
        toast.warning('No se encontraron coincidencias para la unidad.');
      }
    } catch (err) {
      console.warn('Error en búsqueda bidireccional:', err);
    } finally {
      setIsSearchingPair(false);
    }
  };

  // Categorías
  const categories = useMemo(() => {
    const set = new Set(catalogItems.map((i) => i.category).filter(Boolean));
    return Array.from(set).sort();
  }, [catalogItems]);

  // Ítems filtrados
  const filteredCatalog = useMemo(() => {
    return catalogItems.filter((i) => {
      const matchesCat = !selectedCategory || i.category.toUpperCase() === selectedCategory.toUpperCase();
      const matchesSearch =
        !searchQuery ||
        i.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.code.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCat && matchesSearch;
    });
  }, [catalogItems, selectedCategory, searchQuery]);

  // Total de unidades de repuestos en el carrito
  const totalCartCount = useMemo(() => {
    return cartItems.reduce((acc, curr) => acc + curr.quantity, 0);
  }, [cartItems]);

  // Autocompletado cuádruple reactivo y limpio
  const handlePlateOrOtChange = (val: string, field: 'TRACTOR' | 'OT_TR' | 'SEMI' | 'OT_SEMI') => {
    // 1. Si borra el input (vacío), limpiar los 4 campos inmediatamente
    if (!val || !val.trim()) {
      setInputTractorPlate('');
      setInputTractorOt('');
      setInputSemiPlate('');
      setInputSemiOt('');
      return;
    }

    const clean = val.trim().toUpperCase().replace(/[\s\-_.]/g, '');

    if (field === 'TRACTOR') {
      setInputTractorPlate(val.toUpperCase());
      // Al sobreescribir, limpiar los otros 3 campos para dar lugar al nuevo conjunto
      setInputTractorOt('');
      setInputSemiPlate('');
      setInputSemiOt('');

      if (clean) {
        const match = fleetPairs.find(
          (p) => p.tractor && p.tractor.toUpperCase().replace(/[\s\-_.]/g, '') === clean
        );
        if (match) {
          setInputTractorOt(match.tractorOt ? String(match.tractorOt) : '');
          if (match.semi) {
            setInputSemiPlate(match.semi.toUpperCase());
            setInputSemiOt(match.semiOt ? String(match.semiOt) : '');
          } else {
            setInputSemiPlate('');
            setInputSemiOt('');
          }
        }
      }
    } else if (field === 'SEMI') {
      setInputSemiPlate(val.toUpperCase());
      // Al sobreescribir, limpiar los otros 3 campos
      setInputTractorPlate('');
      setInputTractorOt('');
      setInputSemiOt('');

      if (clean) {
        const match = fleetPairs.find(
          (p) => p.semi && p.semi.toUpperCase().replace(/[\s\-_.]/g, '') === clean
        );
        if (match) {
          setInputSemiOt(match.semiOt ? String(match.semiOt) : '');
          if (match.tractor) {
            setInputTractorPlate(match.tractor.toUpperCase());
            setInputTractorOt(match.tractorOt ? String(match.tractorOt) : '');
          } else {
            setInputTractorPlate('');
            setInputTractorOt('');
          }
        }
      }
    } else if (field === 'OT_TR') {
      setInputTractorOt(val);
      // Al sobreescribir, limpiar los otros 3 campos
      setInputTractorPlate('');
      setInputSemiPlate('');
      setInputSemiOt('');

      const cleanOt = val.trim();
      if (cleanOt.length >= 4) {
        const match = fleetPairs.find(
          (p) =>
            p.tractorOt &&
            (String(p.tractorOt).trim() === cleanOt ||
              (cleanOt.length >= 4 && String(p.tractorOt).trim().startsWith(cleanOt)))
        );
        if (match) {
          if (match.tractor) setInputTractorPlate(match.tractor.toUpperCase());
          if (match.semi) {
            setInputSemiPlate(match.semi.toUpperCase());
            setInputSemiOt(match.semiOt ? String(match.semiOt) : '');
          } else {
            setInputSemiPlate('');
            setInputSemiOt('');
          }
        }
      }
    } else if (field === 'OT_SEMI') {
      setInputSemiOt(val);
      // Al sobreescribir, limpiar los otros 3 campos
      setInputTractorPlate('');
      setInputTractorOt('');
      setInputSemiPlate('');

      const cleanOt = val.trim();
      if (cleanOt.length >= 4) {
        const match = fleetPairs.find(
          (p) =>
            p.semiOt &&
            (String(p.semiOt).trim() === cleanOt ||
              (cleanOt.length >= 4 && String(p.semiOt).trim().startsWith(cleanOt)))
        );
        if (match) {
          if (match.semi) setInputSemiPlate(match.semi.toUpperCase());
          if (match.tractor) {
            setInputTractorPlate(match.tractor.toUpperCase());
            setInputTractorOt(match.tractorOt ? String(match.tractorOt) : '');
          } else {
            setInputTractorPlate('');
            setInputTractorOt('');
          }
        }
      }
    }
  };

  // Confirmar y despachar pedido al Pañol (con verificación de protocolo de canje)
  const handleConfirmOrder = async (overriddenCanjes?: Record<string, string>) => {
    if (cartItems.length === 0) return;

    // Validación obligatoria legacy: NO permitir solicitudes sin Tractor ni OT
    const effectiveTractorPlate = (activeUnit?.tractorPlate || inputTractorPlate || '').trim().toUpperCase();
    const effectiveTractorOt = (activeUnit?.tractorOt || inputTractorOt || '').trim();
    const effectiveSemiPlate = (activeUnit?.semiPlate || inputSemiPlate || '').trim().toUpperCase();
    const effectiveSemiOt = (activeUnit?.semiOt || inputSemiOt || '').trim();

    if (!effectiveTractorPlate || !effectiveTractorOt) {
      toast.error('⚠️ ATENCIÓN: Por protocolo de taller se requiere ingresar Patente de Tractor y número de OT antes de confirmar el pedido.');
      return;
    }

    // Verificar si hay repuestos que requieran canje y no han sido declarados aún
    const exchangeItems = cartItems.filter((ci) => ci.item.requires_exchange);
    if (!overriddenCanjes && exchangeItems.length > 0) {
      setCanjeDeclarations(
        exchangeItems.map((ci) => ({
          itemId: ci.item.id,
          itemName: ci.item.description,
          qty: ci.quantity,
          tipo: 'ENTREGO_USADA',
          missingQty: ci.quantity,
          motivo: '',
        }))
      );
      setShowCanjeModal(true);
      return;
    }

    setIsSubmitting(true);
    try {
      const effectiveBox = (activeBox && activeBox.toLowerCase() !== 'prueba')
        ? activeBox
        : (user?.default_boxes && user.default_boxes[0] ? user.default_boxes[0] : '01');

      await submitBatchOrder({
        opId: user?.op_code || '150150',
        mechanicId: user?.id,
        mechanicName: user?.name || 'MECÁNICO',
        box: effectiveBox,
        tractorPlate: effectiveTractorPlate,
        otNumber: effectiveTractorOt,
        semiPlate: effectiveSemiPlate,
        semiOt: effectiveSemiOt,
        unitId: effectiveSemiPlate ? `${effectiveTractorPlate} / ${effectiveSemiPlate}` : effectiveTractorPlate,
        targetType: orderTarget,
        items: cartItems.map((ci) => {
          const customNote = itemNotesMap[ci.item.description] || '';
          const canjeStatus = overriddenCanjes ? overriddenCanjes[ci.item.id] : undefined;
          return {
            code: ci.item.code,
            name: ci.item.description,
            qty: ci.quantity,
            canje: ci.item.requires_exchange,
            canjeStatus,
            notes: customNote,
          };
        }),
      });

      toast.success('Pedido confirmado y enviado al Pañol con éxito.');
      clearCart();
      setShowCanjeModal(false);
      loadData();
    } catch (err: any) {
      toast.error('Error al confirmar pedido: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Confirmar Declaración de Canje desde el Modal
  const handleConfirmCanjeModal = () => {
    // Validar motivos de piezas faltantes
    for (const d of canjeDeclarations) {
      if (d.tipo === 'FALTANTE' && !d.motivo.trim()) {
        toast.warning(`Debes especificar el motivo de la pieza faltante para: ${d.itemName}`);
        return;
      }
    }

    const canjesMap: Record<string, string> = {};
    for (const d of canjeDeclarations) {
      const delivered = d.tipo === 'ENTREGO_USADA' ? d.qty : Math.max(0, d.qty - d.missingQty);
      canjesMap[d.itemId] = JSON.stringify({
        canje: true,
        tipo: d.tipo,
        cant_pedida: d.qty,
        cant_entregada: delivered,
        cant_faltante: d.tipo === 'FALTANTE' ? d.missingQty : 0,
        motivo: d.motivo.trim(),
      });
    }

    handleConfirmOrder(canjesMap);
  };

  const saveItemNote = () => {
    if (editingItemId) {
      setItemNotesMap((prev) => ({ ...prev, [editingItemId]: itemNoteText }));
      setEditingItemId(null);
      setItemNoteText('');
      toast.success('Nota guardada.');
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="h-screen max-h-screen bg-[#070A0F] text-[#F3F4F6] flex flex-col font-sans select-none overflow-hidden">
      {/* ========================================================================= */}
      {/* 1. TOPBAR HEADER                                                          */}
      {/* ========================================================================= */}
      <header className="h-[44px] bg-[#0B0F15] border-b border-[#1E2530] px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-sm font-black tracking-wider text-white">
            TALLER
          </span>

          <div className="w-[1px] h-4 bg-[#1E2530]" />

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 font-extrabold uppercase">
              OPERARIO CONECTADO:
            </span>
            <span className="text-xs font-bold text-[#388BFD]">
              {user?.name || 'prueba'}
            </span>
          </div>

          <div className="w-[1px] h-4 bg-[#1E2530]" />

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveMainTab('ordenes')}
              className={`px-3 py-1 rounded text-xs font-black transition-colors ${
                activeMainTab === 'ordenes'
                  ? 'bg-[#2563EB] text-white'
                  : 'bg-[#111622] text-zinc-400 hover:text-white border border-[#202938]'
              }`}
            >
              ORDENES
            </button>
            <button
              onClick={() => setActiveMainTab('pedidos')}
              className={`px-3 py-1 rounded text-xs font-black transition-colors ${
                activeMainTab === 'pedidos'
                  ? 'bg-[#2563EB] text-white'
                  : 'bg-[#111622] text-zinc-400 hover:text-white border border-[#202938]'
              }`}
            >
              PEDIDOS ({myActiveOrdersCount})
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-[#161D2A] border border-[#202938] text-white text-[11px] font-bold">
            Box {activeBox || 'prueba'}
          </span>

          <button
            onClick={handleLogout}
            className="px-3 py-1 rounded text-xs font-bold text-zinc-300 hover:text-white bg-[#111622] border border-[#202938] hover:border-zinc-500 transition-colors"
          >
            Salir
          </button>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. CONTENIDO PRINCIPAL SEGÚN PESTAÑA                                      */}
      {/* ========================================================================= */}
      {activeMainTab === 'ordenes' ? (
        <main className="flex-1 p-2 flex flex-col lg:flex-row gap-0 h-[calc(100vh-44px)] overflow-hidden select-none">
          {/* ===================================================================== */}
          {/* MITAD IZQUIERDA: INPUTS + UNIDADES EN TALLER + TIMELINE DE TAREAS     */}
          {/* ===================================================================== */}
          <div
            className="flex flex-col gap-2 h-full overflow-hidden"
            style={{ width: `${leftColWidthPct}%`, minWidth: '560px' }}
          >
            {/* BARRA SUPERIOR DE ENTRADAS (TRACTOR, SEMI + AGREGAR A PUESTO) */}
            <div className="bg-[#111622] border border-[#1E2530] rounded-xl p-2.5 shadow-sm shrink-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-black tracking-wide text-zinc-300 uppercase">
                  UNIDAD & ORDEN DE TRABAJO
                </span>
                <button
                  type="button"
                  onClick={() => handleBidirectionalSearch()}
                  disabled={isSearchingPair}
                  className="text-[10px] font-bold text-[#388BFD] hover:underline uppercase disabled:opacity-50"
                >
                  {isSearchingPair ? 'BUSCANDO...' : 'BÚSQUEDA BIDIRECCIONAL'}
                </button>
              </div>

              <div className="grid grid-cols-12 gap-1.5 items-end">
                {/* Tractor */}
                <div className="col-span-5 bg-[#0B0F15] border-l-4 border-[#388BFD] border-y border-r border-[#1E2530] rounded p-1.5 flex gap-1.5">
                  <div className="flex-1">
                    <label className="text-[8px] font-bold text-zinc-500 uppercase block">PATENTE TR</label>
                    <input
                      type="text"
                      list="tractorPlates"
                      value={inputTractorPlate}
                      onChange={(e) => handlePlateOrOtChange(e.target.value, 'TRACTOR')}
                      className="w-full bg-[#161D2A] border border-[#202938] rounded px-1.5 py-0.5 text-xs font-mono font-bold text-white uppercase outline-none"
                    />
                    <datalist id="tractorPlates">
                      {fleetPlates.tractores.map((p) => (
                        <option key={p} value={p} />
                      ))}
                    </datalist>
                  </div>
                  <div className="w-16">
                    <label className="text-[8px] font-bold text-zinc-500 uppercase block">OT TR</label>
                    <input
                      type="text"
                      value={inputTractorOt}
                      onChange={(e) => handlePlateOrOtChange(e.target.value, 'OT_TR')}
                      className="w-full bg-[#161D2A] border border-[#202938] rounded px-1.5 py-0.5 text-xs font-mono font-bold text-white outline-none"
                    />
                  </div>
                </div>

                {/* Semi */}
                <div className="col-span-5 bg-[#0B0F15] border-l-4 border-[#10B981] border-y border-r border-[#1E2530] rounded p-1.5 flex gap-1.5">
                  <div className="flex-1">
                    <label className="text-[8px] font-bold text-zinc-500 uppercase block">PATENTE SEMI</label>
                    <input
                      type="text"
                      list="semiPlates"
                      value={inputSemiPlate}
                      onChange={(e) => handlePlateOrOtChange(e.target.value, 'SEMI')}
                      className="w-full bg-[#161D2A] border border-[#202938] rounded px-1.5 py-0.5 text-xs font-mono font-bold text-white uppercase outline-none"
                    />
                    <datalist id="semiPlates">
                      {fleetPlates.semis.map((p) => (
                        <option key={p} value={p} />
                      ))}
                    </datalist>
                  </div>
                  <div className="w-16">
                    <label className="text-[8px] font-bold text-zinc-500 uppercase block">OT SEMI</label>
                    <input
                      type="text"
                      value={inputSemiOt}
                      onChange={(e) => handlePlateOrOtChange(e.target.value, 'OT_SEMI')}
                      className="w-full bg-[#161D2A] border border-[#202938] rounded px-1.5 py-0.5 text-xs font-mono font-bold text-white outline-none"
                    />
                  </div>
                </div>

                {/* Botón Cargar al puesto */}
                <div className="col-span-2">
                  <button
                    type="button"
                    onClick={handleAddUnitToHold}
                    className="w-full h-[32px] bg-[#059669] hover:bg-[#10B981] text-white rounded font-bold text-xs flex items-center justify-center transition-colors"
                    title="Agregar unidad al taller"
                  >
                    <Plus className="w-4 h-4 stroke-[3]" />
                  </button>
                </div>
              </div>
            </div>

            {/* SPLIT: UNIDADES EN PUESTO (IZQ - FIJA) Y TIMELINE DE TAREAS (DER - FLUIDA) */}
            <div className="flex-1 flex flex-row gap-2 overflow-hidden min-h-0">
              {/* COLUMNA 1: UNIDADES EN TALLER (HOLD UNITS / SECCIÓN PATENTES - FIJA, INDEPENDIENTE DEL RESIZE) */}
              <div className="w-[235px] xl:w-[245px] shrink-0 bg-[#111622] border border-[#1E2530] rounded-xl p-2 flex flex-col overflow-hidden">
                <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-[#1E2530] shrink-0">
                  <span className="text-[10px] font-black text-zinc-400 uppercase">
                    UNIDADES EN PUESTO ({holdUnits.length})
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {holdUnits.length === 0 ? (
                    <div className="text-center py-6 text-zinc-500 text-[11px] border border-dashed border-[#1E2530] rounded p-2">
                      Sin unidades cargadas. Ingresa patente u OT arriba para cargar.
                    </div>
                  ) : (
                    holdUnits.map((u, idx) => {
                      const isSelected = idx === selectedHoldIndex;
                      const isCoord = Boolean(
                        u.isCoordAssigned ||
                        u.hasCoordTasks ||
                        u.tractorHasCoordTasks ||
                        u.semiHasCoordTasks ||
                        (u.source === 'COORDINACION' && !u.reviewedAt)
                      );
                      return (
                        <div
                          key={idx}
                          onClick={() => {
                            setSelectedHoldIndex(idx);
                            setInputTractorPlate(u.tractorPlate);
                            setInputTractorOt(u.tractorOt);
                            setInputSemiPlate(u.semiPlate);
                            setInputSemiOt(u.semiOt);
                          }}
                          className={`p-2 rounded-lg border transition-all cursor-pointer flex flex-col gap-1.5 overflow-hidden ${
                            isSelected
                              ? isCoord
                                ? 'bg-[#1C1708] border-amber-400 shadow-sm ring-1 ring-amber-400/40'
                                : 'bg-[#0E1520] border-[#388BFD] shadow-sm'
                              : isCoord
                              ? 'bg-[#141006] border-amber-500/40 hover:border-amber-400'
                              : 'bg-[#0B0F15] border-[#1E2530] hover:border-zinc-700'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1 font-mono text-[9px] font-black">
                              {/* Badge OT Tractor: resaltado en amarillo si tiene tareas preasignadas */}
                              <span
                                className={`px-1.5 py-0.2 rounded border transition-colors ${
                                  u.tractorHasCoordTasks
                                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-xs'
                                    : 'bg-[#161D2A] text-zinc-300 border-[#202938]'
                                }`}
                                title={u.tractorHasCoordTasks ? 'OT de tractor con tareas preasignadas por Coordinación' : undefined}
                              >
                                OT {u.tractorOt || '---'}
                              </span>

                              {/* Badge OT Semi: resaltado en amarillo si tiene tareas preasignadas */}
                              <span
                                className={`px-1.5 py-0.2 rounded border transition-colors ${
                                  u.semiHasCoordTasks
                                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-xs'
                                    : 'bg-[#161D2A] text-zinc-300 border-[#202938]'
                                }`}
                                title={u.semiHasCoordTasks ? 'OT de semi con tareas preasignadas por Coordinación' : undefined}
                              >
                                {u.semiOt ? `SEMI ${u.semiOt}` : '---'}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveUnitFromHold(idx);
                              }}
                              className="text-zinc-500 hover:text-red-400 p-0.5"
                              title="Quitar unidad"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-[#1E2530]/60 items-center justify-items-center overflow-hidden">
                            <LicensePlate
                              plate={u.tractorPlate}
                              type="TRACTOR"
                              size="sm"
                              showOtBadge={false}
                              className="w-full justify-center"
                            />
                            <LicensePlate
                              plate={u.semiPlate}
                              type="SEMI"
                              size="sm"
                              showOtBadge={false}
                              className="w-full justify-center"
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* COLUMNA 2: TIMELINE DE TAREAS */}
              <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                <WorkOrderTimeline
                  tractorPlate={activeUnit?.tractorPlate || inputTractorPlate}
                  tractorOt={activeUnit?.tractorOt || inputTractorOt}
                  semiPlate={activeUnit?.semiPlate || inputSemiPlate}
                  semiOt={activeUnit?.semiOt || inputSemiOt}
                  currentUser={user}
                  activeBox={activeBox || 'prueba'}
                  onTasksUpdated={loadData}
                />
              </div>
            </div>
          </div>

          {/* ===================================================================== */}
          {/* RESIZER VERTICAL ENTRE MITAD IZQUIERDA Y MITAD DERECHA                */}
          {/* ===================================================================== */}
          <div
            onMouseDown={() => setIsDraggingV(true)}
            onDoubleClick={() => setLeftColWidthPct(50)}
            className={`hidden lg:flex w-2 items-center justify-center cursor-col-resize select-none shrink-0 transition-colors z-10 ${
              isDraggingV ? 'bg-[#388BFD]/30' : 'hover:bg-[#388BFD]/20'
            }`}
            title="Arrastra para redimensionar columnas | Doble clic para restablecer (50%)"
          >
            <div
              className={`w-1 h-10 rounded-full transition-all ${
                isDraggingV ? 'bg-[#388BFD] scale-y-125' : 'bg-[#1E2530] hover:bg-[#388BFD]'
              }`}
            />
          </div>

          {/* ===================================================================== */}
          {/* MITAD DERECHA: CATÁLOGO DE REPUESTOS + LISTA PARA ENVIAR (CARRITO)    */}
          {/* ===================================================================== */}
          <div
            className="flex-1 flex flex-col h-full overflow-hidden"
            style={{ width: `${100 - leftColWidthPct}%`, minWidth: '340px' }}
          >
            {/* Card: CATÁLOGO DE REPUESTOS */}
            <div
              className="bg-[#111622] border border-[#1E2530] rounded-xl p-2.5 shadow-sm flex flex-col overflow-hidden min-h-[160px]"
              style={{ height: `${catalogHeightPct}%` }}
            >
              <div className="flex items-center justify-between mb-1.5 shrink-0">
                <span className="text-xs font-black tracking-wide text-amber-400 uppercase">
                  CATÁLOGO DE REPUESTOS
                </span>

                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-500 font-extrabold uppercase">
                    Pidiendo para:
                  </span>
                  <button
                    type="button"
                    onClick={() => setOrderTarget('TRACTOR')}
                    className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold transition-all ${
                      orderTarget === 'TRACTOR'
                        ? 'bg-[#388BFD] text-white'
                        : 'bg-[#161D2A] text-zinc-400 border border-[#202938]'
                    }`}
                  >
                    {activeUnit?.tractorPlate || inputTractorPlate || 'TRACTOR'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderTarget('SEMI')}
                    className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold transition-all ${
                      orderTarget === 'SEMI'
                        ? 'bg-[#10B981] text-white'
                        : 'bg-[#161D2A] text-zinc-400 border border-[#202938]'
                    }`}
                  >
                    {activeUnit?.semiPlate || inputSemiPlate || 'SEMI'}
                  </button>
                </div>
              </div>

              <div className="flex gap-1.5 mb-2 shrink-0">
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="bg-[#0B0F15] border border-[#202938] rounded px-2 py-1 text-xs font-bold text-white outline-none focus:border-[#388BFD] min-w-[120px]"
                >
                  <option value="">TODOS LOS RUBROS</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>

                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Escribe el nombre del repuesto..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-2.5 py-1 bg-[#0B0F15] border border-[#202938] rounded text-xs text-white placeholder-zinc-500 outline-none focus:border-[#388BFD]"
                  />
                </div>
              </div>

              <div className="space-y-1.5 flex-1 overflow-y-auto pr-1">
                {filteredCatalog.map((item) => (
                  <div
                    key={item.id}
                    className="p-1.5 px-2 bg-[#0B0F15] border border-[#1A2230] hover:border-[#388BFD]/40 rounded-lg flex items-center justify-between gap-2 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h4 className="text-xs font-bold text-white truncate">
                          {item.description}
                        </h4>
                        {item.requires_exchange && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-black text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/60 shrink-0">
                            ♻️ CANJE OBLIGATORIO
                          </span>
                        )}
                      </div>
                      <span className="text-[9px] font-extrabold text-zinc-500 uppercase block mt-0.5">
                        RUBRO: {item.category}
                      </span>
                    </div>

                    <button
                      onClick={() => {
                        addItem(item);
                        toast.success(`+1 ${item.description}`);
                      }}
                      className="px-2.5 py-1 bg-[#059669] hover:bg-[#10B981] text-white font-bold text-[11px] rounded transition-colors shrink-0"
                    >
                      + Agregar
                    </button>
                  </div>
                ))}

                {filteredCatalog.length === 0 && (
                  <div className="text-center py-6 text-zinc-500 text-xs">
                    No se encontraron repuestos con los filtros seleccionados.
                  </div>
                )}
              </div>
            </div>

            {/* RESIZER HORIZONTAL ENTRE CATÁLOGO Y CARRITO */}
            <div
              onMouseDown={() => setIsDraggingH(true)}
              onDoubleClick={() => setCatalogHeightPct(55)}
              className={`h-2.5 flex items-center justify-center cursor-row-resize select-none shrink-0 my-0.5 transition-colors z-10 ${
                isDraggingH ? 'bg-[#388BFD]/30' : 'hover:bg-[#388BFD]/20'
              }`}
              title="Arrastra para redimensionar catálogo/pedido | Doble clic para restablecer (55%)"
            >
              <div
                className={`h-1 w-12 rounded-full transition-all ${
                  isDraggingH ? 'bg-[#388BFD] scale-x-125' : 'bg-[#1E2530] hover:bg-[#388BFD]'
                }`}
              />
            </div>

            {/* Card: LISTA PARA ENVIAR (CARRITO) */}
            <div
              className="bg-[#111622] border border-[#1E2530] rounded-xl p-2.5 shadow-sm flex flex-col overflow-hidden min-h-[160px]"
              style={{ height: `calc(${100 - catalogHeightPct}% - 10px)` }}
            >
              <div className="flex items-center justify-between mb-1.5 shrink-0">
                <span className="text-xs font-black tracking-wide text-zinc-200 uppercase">
                  LISTA PARA ENVIAR
                </span>

                <span className="px-2 py-0.5 rounded-full bg-[#2563EB] text-white text-[10px] font-extrabold">
                  {totalCartCount} ÍTEMS
                </span>
              </div>

              <div className="space-y-1.5 flex-1 overflow-y-auto pr-1 mb-2">
                {cartItems.map((ci) => {
                  const note = itemNotesMap[ci.item.description] || '';
                  return (
                    <div
                      key={ci.item.id}
                      className="p-1.5 px-2 bg-[#0B0F15] border border-[#1A2230] rounded-lg flex items-center justify-between gap-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-white truncate">
                            {ci.item.description}
                          </span>
                          <button
                            onClick={() => {
                              setEditingItemId(ci.item.description);
                              setItemNoteText(note);
                            }}
                            className="text-zinc-400 hover:text-white p-0.5"
                            title="Editar nota"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                        </div>

                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className="text-[9px] font-extrabold text-[#388BFD] uppercase">
                            {orderTarget}
                          </span>
                          {ci.item.requires_exchange && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-950/70 border border-amber-600/50 text-amber-400 text-[9px] font-black">
                              ♻️ REQUIERE USADA
                            </span>
                          )}
                          {note && (
                            <span className="px-1.5 py-0.2 rounded bg-[#D97706] text-black text-[9px] font-bold">
                              {note}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => updateQuantity(ci.item.id, -1)}
                          className="w-6 h-6 bg-[#161D2A] hover:bg-[#202938] rounded border border-[#202938] text-white font-bold text-xs flex items-center justify-center transition-colors"
                        >
                          <Minus className="w-3 h-3" />
                        </button>

                        <input
                          type="number"
                          min="1"
                          value={ci.quantity}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val) && val >= 1) {
                              setQuantity(ci.item.id, val);
                            }
                          }}
                          className="font-mono font-bold text-white text-xs w-10 text-center bg-[#161D2A] border border-[#202938] rounded py-0.5 outline-none focus:border-[#388BFD]"
                        />

                        <button
                          type="button"
                          onClick={() => updateQuantity(ci.item.id, 1)}
                          className="w-6 h-6 bg-[#161D2A] hover:bg-[#202938] rounded border border-[#202938] text-white font-bold text-xs flex items-center justify-center transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                        </button>

                        <button
                          type="button"
                          onClick={() => removeItem(ci.item.id)}
                          className="w-6 h-6 bg-[#161D2A] hover:bg-red-950/40 rounded border border-[#202938] hover:border-red-500/50 text-red-500 font-bold flex items-center justify-center transition-colors ml-0.5"
                          title="Eliminar ítem"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {cartItems.length === 0 && (
                  <div className="text-center py-6 text-zinc-500 text-xs">
                    La lista está vacía. Seleccioná repuestos en el catálogo.
                  </div>
                )}
              </div>

              <button
                onClick={() => handleConfirmOrder()}
                disabled={cartItems.length === 0 || isSubmitting}
                className="w-full py-2 bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white font-black text-xs tracking-wider rounded-lg shadow-md transition-all shrink-0"
              >
                {isSubmitting ? 'ENVIANDO AL PAÑOL...' : `CONFIRMAR PEDIDO (${totalCartCount} ÍTEMS)`}
              </button>
            </div>
          </div>
        </main>
      ) : (
        /* PESTAÑA PEDIDOS (MONITOR DE PEDIDOS AL PAÑOL) */
        <main className="flex-1 p-3 overflow-hidden flex flex-col h-[calc(100vh-44px)]">
          <div className="bg-[#111622] border border-[#1E2530] rounded-xl p-3 shadow-sm flex flex-col flex-1 overflow-hidden">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#1E2530] shrink-0 gap-2 flex-wrap">
              <span className="text-xs font-black tracking-wide text-zinc-200 uppercase">
                MONITOR DE PEDIDOS AL PAÑOL
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOrdersFilter('ACTIVOS')}
                  className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
                    ordersFilter === 'ACTIVOS'
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-[#161D2A] text-zinc-400 hover:text-white'
                  }`}
                >
                  ACTIVOS
                </button>

                <button
                  onClick={() => setOrdersFilter('HISTORIAL')}
                  className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
                    ordersFilter === 'HISTORIAL'
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-[#161D2A] text-zinc-400 hover:text-white'
                  }`}
                >
                  HISTORIAL
                </button>

                <button
                  onClick={loadData}
                  className="p-1 bg-[#161D2A] hover:bg-[#202938] border border-[#202938] rounded text-zinc-400 hover:text-white transition-colors"
                  title="Actualizar pedidos"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="space-y-3 flex-1 overflow-y-auto pr-1">
              {myOrders.length === 0 ? (
                <div className="text-center py-12 text-zinc-500 text-xs">
                  No tienes pedidos registrados en esta sección ({ordersFilter.toLowerCase()}).
                </div>
              ) : (
                myOrders.map((o: any) => {
                  const reqCode = o.req_code || o.reqId || o.orderId || o.id;
                  const timeFormatted = o.timestamp || o.created_at
                    ? new Date(o.timestamp || o.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : (o.time || '');
                  const dateFormatted = o.timestamp || o.created_at
                    ? new Date(o.timestamp || o.created_at).toLocaleDateString([], { day: '2-digit', month: '2-digit' })
                    : (o.date || '');

                  const isReady = o.status === 'LISTO';
                  const isDelivered = o.status === 'ENTREGADO';
                  const isDevolucionPending = o.status === 'DEVOLUCION PENDIENTE' || o.status === 'DEVOLUCION_PENDIENTE';
                  const isDevuelto = o.status === 'DEVUELTO' || o.status === 'DEVOLUCION';

                  const returnableItems = (o.items || []).filter(
                    (it: any) => it.status === 'ENTREGADO' || it.status === 'LISTO' || !it.status || o.status === 'ENTREGADO' || o.status === 'LISTO'
                  );
                  const canReturn = (isDelivered || isReady || returnableItems.length > 0) && !isDevolucionPending && !isDevuelto;

                  const trPlate = o.tractorPlate || o.tractor_plate || o.tractor;
                  const trOt = o.otNumber || o.ot_number || o.ot;
                  const smPlate = o.semiPlate || o.semi_plate || o.semi;
                  const smOt = o.semiOt || o.semi_ot;

                  return (
                    <div
                      key={reqCode}
                      className={`p-3 bg-[#0B0F15] border rounded-xl flex flex-col gap-2.5 transition-all ${
                        isReady
                          ? 'border-emerald-500/60 bg-emerald-950/10 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                          : isDevolucionPending
                          ? 'border-purple-500/60 bg-purple-950/10'
                          : isDelivered
                          ? 'border-[#1E2530] opacity-90'
                          : 'border-[#1E2530] hover:border-[#2A3649]'
                      }`}
                    >
                      {/* Cabecera del pedido: Box/Sector, Hora y Estado */}
                      <div className="flex items-center justify-between pb-2 border-b border-[#1A2230]">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-black bg-[#161D2A] border border-[#202938] text-zinc-300">
                            {resolveBoxOrSector(o.box_number || o.box).label}
                          </span>
                          <span className="text-[11px] font-medium text-zinc-500">
                            {dateFormatted} {timeFormatted}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2.5 py-0.5 rounded text-[10px] font-black flex items-center gap-1 uppercase ${
                              isReady
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-600 animate-pulse'
                                : isDelivered
                                ? 'bg-zinc-900 text-zinc-400 border border-zinc-700'
                                : isDevolucionPending
                                ? 'bg-purple-950 text-purple-300 border border-purple-600'
                                : isDevuelto
                                ? 'bg-amber-950 text-amber-400 border border-amber-600'
                                : 'bg-blue-950 text-blue-400 border border-blue-600'
                            }`}
                          >
                            {isReady && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />}
                            {isDevolucionPending ? '↩️ DEVOLUCIÓN PENDIENTE' : isDevuelto ? '📥 DEVUELTO' : o.status}
                          </span>

                          {canReturn && (
                            <button
                              type="button"
                              onClick={() => {
                                const first = returnableItems[0] || (o.items && o.items[0]);
                                setReturnModalData({
                                  order: o,
                                  selectedItemId: first?.id || first?.order_item_id || '',
                                  selectedItemName: first?.name || '',
                                  maxQty: first?.qty || 1,
                                  returnQty: first?.qty || 1,
                                  reason: '',
                                });
                              }}
                              className="px-2.5 py-1 bg-purple-950/70 hover:bg-purple-900 border border-purple-500/70 text-purple-200 text-xs font-bold rounded flex items-center gap-1 transition-all"
                              title="Solicitar devolución de repuesto al Pañol"
                            >
                              <span>↩️</span>
                              <span>Devolver</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Fila de Unidades y OTs asignadas */}
                      {(trPlate || smPlate) && (
                        <div className="flex items-center gap-3 text-xs bg-[#070A0F] p-2 rounded-lg border border-[#161D2A]">
                          {trPlate && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] font-black text-zinc-500 uppercase">TR:</span>
                              <LicensePlate plate={trPlate} />
                              {trOt && (
                                <span className="font-mono text-[10px] text-zinc-300 bg-[#161D2A] px-1.5 py-0.5 rounded border border-[#202938]">
                                  OT {trOt}
                                </span>
                              )}
                            </div>
                          )}

                          {smPlate && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] font-black text-zinc-500 uppercase">SEMI:</span>
                              <LicensePlate plate={smPlate} />
                              {smOt && (
                                <span className="font-mono text-[10px] text-zinc-300 bg-[#161D2A] px-1.5 py-0.5 rounded border border-[#202938]">
                                  OT {smOt}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Lista detallada de repuestos */}
                      <div className="space-y-1.5 pt-1">
                        {(o.items || []).map((it: any, itIdx: number) => {
                          const canjeParsed = parseCanjeStatus(it.canjeStatus || it.exchange_status || (it.requiereCanje ? 'true' : null), it.qty || it.quantity || 1);
                          const canjeBadge = canjeParsed ? formatCanjeBadge(canjeParsed) : null;

                          return (
                            <div
                              key={itIdx}
                              className="flex items-center justify-between text-xs bg-[#0F141E] p-2 rounded-md border border-[#1E2530]"
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                                <span className="font-mono font-bold text-white text-xs bg-[#1A2230] px-1.5 py-0.5 rounded shrink-0">
                                  {it.qty || it.quantity || 1}x
                                </span>
                                <span className="font-bold text-white text-xs truncate">
                                  {it.name || it.description}
                                </span>
                                {it.code && (
                                  <span className="font-mono text-[10px] text-zinc-400 bg-[#0B0F15] px-1.5 py-0.5 rounded border border-zinc-800 shrink-0">
                                    {it.code}
                                  </span>
                                )}
                                {it.loc && it.loc !== 'S/D' && (
                                  <span className="font-mono text-[10px] text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/60 shrink-0">
                                    📍 {it.loc}
                                  </span>
                                )}
                                {cleanTallerItemNote(it.note) && (
                                  <span className="text-[10px] text-amber-300 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-800/60 shrink-0">
                                    📝 {cleanTallerItemNote(it.note)}
                                  </span>
                                )}
                                {canjeBadge && (
                                  <span className={`text-[10px] ${canjeBadge.bgClass} ${canjeBadge.textClass} px-1.5 py-0.5 rounded border ${canjeBadge.borderClass} font-bold shrink-0 flex items-center gap-1`}>
                                    <span>{canjeBadge.icon}</span>
                                    <span>{canjeBadge.text}</span>
                                  </span>
                                )}
                                {it.returned_qty > 0 && (
                                  <span className="text-[10px] text-purple-300 bg-purple-950/60 px-1.5 py-0.5 rounded border border-purple-800/60 font-bold shrink-0">
                                    ↩️ Devuelto: {it.returned_qty}
                                  </span>
                                )}
                              </div>

                              {it.status && (
                                <span className="text-[10px] font-bold text-zinc-400 uppercase shrink-0 ml-2">
                                  {it.status}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </main>
      )}

      {/* Modal para Declaración de Canje */}
      {showCanjeModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#111622] border border-[#202938] rounded-xl p-5 max-w-lg w-full space-y-4 shadow-2xl">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-white flex items-center gap-2">
                  <span>♻️</span>
                  <span>Declaración de Canje</span>
                </h3>
                <button
                  onClick={() => setShowCanjeModal(false)}
                  className="text-zinc-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                Los siguientes repuestos requieren por protocolo la entrega de la pieza averiada a Pañol:
              </p>
            </div>

            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {canjeDeclarations.map((d, idx) => (
                <div
                  key={d.itemId}
                  className="bg-[#0B0F15] border border-[#D97706]/70 rounded-lg p-3 space-y-2.5 text-xs text-left"
                >
                  <div className="font-extrabold text-white text-xs">
                    🔸 {d.itemName} <span className="text-zinc-400 font-medium">(Cant: {d.qty})</span>
                  </div>

                  <div className="flex gap-4">
                    <label className="cursor-pointer flex items-center gap-1.5 text-zinc-200 text-xs">
                      <input
                        type="radio"
                        name={`canje_${idx}`}
                        value="ENTREGO_USADA"
                        checked={d.tipo === 'ENTREGO_USADA'}
                        onChange={() => {
                          setCanjeDeclarations((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, tipo: 'ENTREGO_USADA' } : item
                            )
                          );
                        }}
                        className="accent-[#388BFD]"
                      />
                      <span>Entrego usada/s</span>
                    </label>

                    <label className="cursor-pointer flex items-center gap-1.5 text-red-400 font-bold text-xs">
                      <input
                        type="radio"
                        name={`canje_${idx}`}
                        value="FALTANTE"
                        checked={d.tipo === 'FALTANTE'}
                        onChange={() => {
                          setCanjeDeclarations((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, tipo: 'FALTANTE' } : item
                            )
                          );
                        }}
                        className="accent-red-500"
                      />
                      <span>Faltante</span>
                    </label>
                  </div>

                  {d.tipo === 'FALTANTE' && (
                    <div className="pt-2 border-t border-zinc-800 space-y-2">
                      <div className="flex items-center gap-2 text-xs text-zinc-300">
                        <span>Indicar cantidad faltante:</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setCanjeDeclarations((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? { ...item, missingQty: Math.max(1, item.missingQty - 1) }
                                    : item
                                )
                              );
                            }}
                            className="w-6 h-6 bg-[#161D2A] border border-zinc-700 rounded text-white font-bold flex items-center justify-center hover:bg-zinc-700"
                          >
                            -
                          </button>
                          <span className="w-9 h-6 bg-[#0B0F15] border border-[#388BFD] rounded text-white font-bold text-center flex items-center justify-center text-xs">
                            {d.missingQty}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setCanjeDeclarations((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? { ...item, missingQty: Math.min(d.qty, item.missingQty + 1) }
                                    : item
                                )
                              );
                            }}
                            className="w-6 h-6 bg-[#161D2A] border border-zinc-700 rounded text-white font-bold flex items-center justify-center hover:bg-zinc-700"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      <div className="text-[11px] font-bold text-amber-400 bg-amber-950/40 p-2 rounded border border-amber-800/40 flex items-center justify-between">
                        <span>♻️ Entregadas: {Math.max(0, d.qty - d.missingQty)} de {d.qty}</span>
                        <span>⚠️ Faltantes: {d.missingQty}</span>
                      </div>

                      <input
                        type="text"
                        value={d.motivo}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCanjeDeclarations((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, motivo: val } : item
                            )
                          );
                        }}
                        placeholder="Motivo de la pieza faltante (obligatorio)..."
                        className="w-full bg-[#0B0F15] border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#D97706]"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#1E2530]">
              <button
                type="button"
                onClick={() => setShowCanjeModal(false)}
                className="px-3 py-1.5 rounded text-xs font-bold text-zinc-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmCanjeModal}
                disabled={isSubmitting}
                className="px-4 py-1.5 bg-[#D97706] hover:bg-[#B45309] text-black font-black text-xs rounded transition-colors uppercase disabled:opacity-50"
              >
                {isSubmitting ? 'Enviando...' : 'CONFIRMAR PEDIDO'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal para Editar Nota de Ítem */}
      {editingItemId && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#111622] border border-[#202938] rounded-xl p-4 max-w-sm w-full space-y-3 shadow-2xl">
            <div>
              <h3 className="text-xs font-bold text-white">Editar Nota / Especificación</h3>
              <p className="text-[11px] text-zinc-400 mt-0.5 truncate">{editingItemId}</p>
            </div>

            <input
              type="text"
              value={itemNoteText}
              onChange={(e) => setItemNoteText(e.target.value)}
              placeholder="Ej. es solo 90, marca específica..."
              className="w-full bg-[#0B0F15] border border-[#202938] rounded-lg p-2 text-xs text-white outline-none focus:border-[#388BFD]"
              autoFocus
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditingItemId(null)}
                className="px-3 py-1 rounded text-xs font-bold text-zinc-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                onClick={saveItemNote}
                className="px-3.5 py-1 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-bold rounded flex items-center gap-1"
              >
                <Check className="w-3 h-3" />
                <span>Guardar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal para Devolución de Repuesto (Mecánicos) */}
      {returnModalData && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#111622] border border-[#202938] rounded-xl p-5 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-[#1E2530]">
              <h3 className="text-sm font-black text-white flex items-center gap-2">
                <span>↩️</span>
                <span>Devolución de Repuesto</span>
              </h3>
              <button
                onClick={() => setReturnModalData(null)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                  1. ¿Qué repuesto deseas devolver?
                </label>
                <select
                  value={returnModalData.selectedItemName}
                  onChange={(e) => {
                    const selName = e.target.value;
                    const it = (returnModalData.order?.items || []).find((i: any) => i.name === selName);
                    const max = it?.qty || 1;
                    setReturnModalData({
                      ...returnModalData,
                      selectedItemId: it?.id || it?.order_item_id || '',
                      selectedItemName: selName,
                      maxQty: max,
                      returnQty: max,
                    });
                  }}
                  className="w-full bg-[#0B0F15] border border-[#202938] rounded-lg p-2 text-xs font-bold text-white outline-none focus:border-[#388BFD]"
                >
                  {(returnModalData.order?.items || []).map((it: any, idx: number) => (
                    <option key={idx} value={it.name}>
                      {it.name} (Máx: {it.qty || 1})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                  2. ¿Cuántas unidades devuelves?
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max={returnModalData.maxQty}
                    value={returnModalData.returnQty}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) {
                        setReturnModalData({
                          ...returnModalData,
                          returnQty: Math.max(1, Math.min(returnModalData.maxQty, val)),
                        });
                      }
                    }}
                    className="w-20 bg-[#0B0F15] border border-[#202938] rounded-lg p-2 text-xs font-mono font-bold text-white text-center outline-none focus:border-[#388BFD]"
                  />
                  <span className="text-[11px] text-zinc-500 font-medium">
                    de {returnModalData.maxQty} entregadas
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase mb-1">
                  3. Motivo de la devolución (Opcional):
                </label>
                <input
                  type="text"
                  value={returnModalData.reason}
                  onChange={(e) =>
                    setReturnModalData({
                      ...returnModalData,
                      reason: e.target.value,
                    })
                  }
                  placeholder="Ej. Pieza equivocada, sobrante, defecto..."
                  className="w-full bg-[#0B0F15] border border-[#202938] rounded-lg p-2 text-xs text-white outline-none focus:border-[#388BFD]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-[#1E2530]">
              <button
                type="button"
                onClick={() => setReturnModalData(null)}
                className="px-3 py-1.5 rounded text-xs font-bold text-zinc-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!returnModalData) return;
                  const reqId =
                    returnModalData.order?.req_code ||
                    returnModalData.order?.reqId ||
                    returnModalData.order?.id;
                  const ok = await requestOrderReturn({
                    id: returnModalData.selectedItemId,
                    reqId,
                    itemName: returnModalData.selectedItemName,
                    returnQty: returnModalData.returnQty,
                    reason: returnModalData.reason,
                    opId: user?.op_code || user?.id,
                  });
                  if (ok) {
                    toast.success('Solicitud de devolución enviada al Pañol.');
                    setReturnModalData(null);
                    loadData();
                  } else {
                    toast.error('Error al registrar solicitud de devolución.');
                  }
                }}
                className="px-4 py-1.5 bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-bold text-xs rounded transition-colors"
              >
                Confirmar Devolución
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
