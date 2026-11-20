import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronUp,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  Layers,
  LogOut,
  MapPin,
  Play,
  ShieldCheck,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  TallerUnitCard,
  type TallerCardItem,
  type TallerColumnId,
} from '../components/taller/TallerUnitCard';
import {
  ZoneBoxMatrixContainer,
  type ZoneDropTarget,
} from '../components/common/ZoneBoxMatrixContainer';
import {
  activarHoldProceso,
  actualizarHold,
  actualizarProceso,
  clearTallerUser,
  fetchTallerBoard,
  getSavedTallerUser,
  loginUsuarioTaller,
  subscribePlaneacionSocket,
  verificarAccesoTaller,
} from '../services/planeacionApi';
import type {
  BoardResponse,
  EstadoBox,
  PlaneacionCard,
  PlaneacionHold,
  UsuarioTallerSession,
} from '../types/planeacion';

interface DragPayload {
  id: string;
  sourceCol: TallerColumnId;
  sourceBoxId?: string | null;
  sourceEstado?: EstadoBox | null;
}

interface DropTarget {
  col: TallerColumnId;
  boxId?: string | null;
  estado?: EstadoBox;
}

const HOLD_CONFIG = {
  id: 'HOLD' as const,
  title: 'PENDIENTE',
  borderIdle: 'border-amber-500/30 bg-[#0A0E15]/80',
  borderOver: 'border-amber-400 bg-amber-500/10',
  countClass: 'text-amber-300',
  dropHint: 'Soltar para devolver a pendiente',
};

const OPERATIONAL_COLUMNS: Array<{
  id: TallerColumnId;
  title: string;
  colSpanClass: string;
  borderIdle: string;
  borderOver: string;
  countClass: string;
  dropHint: string;
}> = [
  {
    id: 'LLEGADA',
    title: 'RESERVADO',
    colSpanClass: 'lg:col-span-2',
    borderIdle: 'border-blue-500/30 bg-[#0A0E15]/80',
    borderOver: 'border-blue-400 bg-blue-500/10',
    countClass: 'text-blue-300',
    dropHint: 'Soltar para pasar a reservado',
  },
  {
    id: 'INICIO',
    title: 'TRABAJANDO',
    colSpanClass: 'lg:col-span-5',
    borderIdle: 'border-emerald-500/30 bg-[#0A0E15]/80',
    borderOver: 'border-emerald-400 bg-emerald-500/10',
    countClass: 'text-emerald-300',
    dropHint: 'Soltar en un box (Adentro / Afuera)',
  },
  {
    id: 'SALIDA',
    title: 'TERMINADO',
    colSpanClass: 'lg:col-span-2',
    borderIdle: 'border-zinc-700/60 bg-[#0A0E15]/80',
    borderOver: 'border-emerald-400 bg-emerald-500/10',
    countClass: 'text-zinc-300',
    dropHint: 'Soltar para registrar terminado',
  },
];

function playNotificationTone() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // Silencioso si la política del navegador restringe audio previo a interacción
  }
}

function canDropTarget(source: DragPayload, target: DropTarget): boolean {
  if (source.sourceCol === 'HOLD' && target.col === 'SALIDA') return false;
  if (source.sourceCol === 'SALIDA' && target.col === 'HOLD') return false;
  if (source.sourceCol === 'INICIO' && target.col === 'INICIO') {
    if (!target.estado) return false;
    const srcEstado: EstadoBox = source.sourceEstado === 'afuera' ? 'afuera' : 'adentro';
    const srcBox = source.sourceBoxId || null;
    const dstBox = target.boxId ?? srcBox;
    return srcBox !== dstBox || srcEstado !== target.estado;
  }
  if (source.sourceCol === target.col) return false;
  return true;
}

export const TallerLoginTerminalPage: React.FC = () => {
  const [user, setUser] = useState<UsuarioTallerSession | null>(() => getSavedTallerUser());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<DropTarget | null>(null);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const [isHoldHovered, setIsHoldHovered] = useState(false);
  const [openHoldAssignId, setOpenHoldAssignId] = useState<string | null>(null);
  const [filterBoxId, setFilterBoxId] = useState<string>('ALL');
  const [filterOperarioId, setFilterOperarioId] = useState<string>('ALL');

  const isEncargado = user?.rol === 'encargado_zona';

  const activeZoneLabel = useMemo(() => {
    const fromMap =
      board?.taller_zone_map?.etapa_labels?.trabajando || board?.taller_zone_map?.zone_name;
    const fromCatalog = user?.zone_id
      ? board?.catalog?.zones?.find((z) => z.id === user.zone_id)?.zone_name
      : null;
    return (fromMap || fromCatalog || user?.zone_name || 'ZONA').toUpperCase();
  }, [board?.taller_zone_map, board?.catalog?.zones, user?.zone_id, user?.zone_name]);

  const sectorBoxes = useMemo(() => {
    const mapBoxes = board?.taller_zone_map?.boxes;
    if (mapBoxes && mapBoxes.length > 0 && board?.taller_zone_map) {
      return mapBoxes
        .map((b) => ({
          id: b.box_id,
          box_name: b.box_name,
          zone_id: board.taller_zone_map!.zone_id,
          zone_name: board.taller_zone_map!.zone_name,
        }))
        .sort((a, b) =>
          a.box_name.localeCompare(b.box_name, 'es', { numeric: true, sensitivity: 'base' })
        );
    }
    const all = board?.catalog?.boxes || [];
    const filtered = user?.zone_id ? all.filter((b) => b.zone_id === user.zone_id) : all;
    return [...filtered].sort((a, b) =>
      a.box_name.localeCompare(b.box_name, 'es', { numeric: true, sensitivity: 'base' })
    );
  }, [board?.taller_zone_map, board?.catalog?.boxes, user?.zone_id]);

  const sectorUsuarios = useMemo(() => {
    const all = board?.catalog?.usuarios || [];
    return all
      .filter((u) => {
        if (u.rol === 'coordinacion') return false;
        if (user?.zone_id) return u.zone_id === user.zone_id;
        return true;
      })
      .sort((a, b) =>
        a.nombre_usuario.localeCompare(b.nombre_usuario, 'es', { sensitivity: 'base' })
      );
  }, [board?.catalog?.usuarios, user?.zone_id]);

  const refreshBoard = useCallback(async () => {
    try {
      const zoneParam = user?.zone_id ? user.zone_id : undefined;
      const snap = await fetchTallerBoard(zoneParam);
      setBoard(snap);
    } catch (err) {
      console.error('Error sincronizando tablero de taller:', err);
    }
  }, [user?.zone_id]);

  // Verificación estricta de sesión (1 vez por user.id)
  useEffect(() => {
    if (!user?.id) return;
    let active = true;

    verificarAccesoTaller(user.id).then((res) => {
      if (!active) return;
      if (!res.authorized || !res.user) {
        setUser(null);
        setAuthError(res.error || 'Sesión expirada o usuario no habilitado.');
      } else {
        setUser(res.user);
      }
    });

    return () => {
      active = false;
    };
  }, [user?.id]);

  // Suscripción Socket.IO y carga inicial / por rol-zona (0 polling agresivo)
  useEffect(() => {
    if (!user?.id) return;
    refreshBoard();
    const unsub = subscribePlaneacionSocket(
      () => {
        refreshBoard();
      },
      () => {
        playNotificationTone();
      }
    );

    return () => {
      unsub();
    };
  }, [user?.id, refreshBoard]);

  // Reloj local en memoria para actualizar duraciones sin peticiones de red
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUser = username.trim();
    if (!cleanUser || !password) {
      setAuthError('Ingresá tu usuario y contraseña.');
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await loginUsuarioTaller({
        nombre_usuario: cleanUser,
        password,
      });
      if (res.authenticated && res.user) {
        setUser(res.user);
      } else {
        setAuthError(res.error || 'Credenciales inválidas.');
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Error al iniciar sesión.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    clearTallerUser();
    setUser(null);
    setPassword('');
    setAuthError(null);
    setFilterBoxId('ALL');
    setFilterOperarioId('ALL');
  };

  // Normalizar cards por columna: vista relacional por zone_id (boxes contenidos); filtros adicionales para encargado_zona
  const columnsData = useMemo(() => {
    const holdsRaw = board?.holds || [];
    const activosRaw = board?.activos || [];

    const filteredHolds = holdsRaw.filter((h) => {
      if (!user) return false;
      if (user.zone_id && h.zone_id !== user.zone_id) return false;
      if (isEncargado) {
        if (filterBoxId !== 'ALL' && h.box_id !== filterBoxId) return false;
        if (filterOperarioId !== 'ALL' && !(h.usuarios_ids || []).includes(filterOperarioId)) return false;
      }
      return true;
    });

    const filteredActivos = activosRaw.filter((c) => {
      if (!user) return false;
      if (user.zone_id && c.zone_id !== user.zone_id) return false;
      if (isEncargado) {
        if (filterBoxId !== 'ALL' && c.box_id !== filterBoxId) return false;
        if (filterOperarioId !== 'ALL' && !(c.usuarios_ids || []).includes(filterOperarioId)) return false;
      }
      return true;
    });

    const seenHoldIds = new Set<string>();
    const colHold: TallerCardItem[] = [];
    for (const h of filteredHolds) {
      if (seenHoldIds.has(h.hold_id)) continue;
      seenHoldIds.add(h.hold_id);
      colHold.push({
        col: 'HOLD',
        id: h.hold_id,
        unidad_id: h.unidad_id,
        tractor_id: h.tractor_id,
        semi_id: h.semi_id,
        n_ute: h.n_ute,
        tractor_plate: h.tractor_plate,
        semi_plate: h.semi_plate,
        box_id: h.box_id,
        box_name: h.box_name,
        estado: h.estado ?? null,
        zone_id: h.zone_id,
        zone_name: h.zone_name,
        orden: h.orden,
        nota_planificacion: h.nota_planificacion,
        notes: h.notes,
        notes_count: h.notes?.length || (h.nota_planificacion ? 1 : 0),
        usuarios_ids: h.usuarios_ids || [],
        usuarios_nombres: h.usuarios_nombres,
        encargado_id: h.encargado_id ?? null,
        encargado_nombre: h.encargado_nombre ?? null,
        encargado_at: h.encargado_at ?? null,
        salida_previa_at: h.salida_previa_at,
        salida_origen_box: h.salida_origen_box,
        salida_origen_zone: h.salida_origen_zone,
        ubicacion_actual_box: h.ubicacion_actual_box,
        ubicacion_actual_zone: h.ubicacion_actual_zone,
        ultima_tarea: h.ultima_tarea,
        ultima_tarea_usuario: h.ultima_tarea_usuario,
        ultima_tarea_at: h.ultima_tarea_at,
      });
    }

    const colLlegada: TallerCardItem[] = [];
    const colInicio: TallerCardItem[] = [];
    const colSalida: TallerCardItem[] = [];
    const seenActivoIds = new Set<string>();

    // 4 · TERMINADO proviene 100% de board.activos (Hot RAM C1) respetando:
    // queda allí únicamente si la unidad no tiene PREASIGNADO ni estadía activa, máx 1 card.
    for (const c of filteredActivos) {
      if (seenActivoIds.has(c.proceso_id)) continue;
      seenActivoIds.add(c.proceso_id);

      const targetCol: TallerColumnId = c.salida_at
        ? 'SALIDA'
        : c.inicio_at
        ? 'INICIO'
        : 'LLEGADA';

      const mapped: TallerCardItem = {
        col: targetCol,
        id: c.proceso_id,
        unidad_id: c.unidad_id,
        tractor_id: c.tractor_id,
        semi_id: c.semi_id,
        n_ute: c.n_ute,
        tractor_plate: c.tractor_plate,
        semi_plate: c.semi_plate,
        box_id: c.box_id,
        box_name: c.box_name,
        estado: c.estado ?? null,
        zone_id: c.zone_id,
        zone_name: c.zone_name,
        llegada_at: c.llegada_at,
        inicio_at: c.inicio_at,
        salida_at: c.salida_at,
        usuarios_ids: c.usuarios_ids || [],
        usuarios_nombres: c.usuarios_nombres,
        encargado_id: c.encargado_id ?? null,
        encargado_nombre: c.encargado_nombre ?? null,
        encargado_at: c.encargado_at ?? null,
        notes: c.notes,
        notes_count: c.notes.length,
      };
      if (targetCol === 'SALIDA') {
        colSalida.push(mapped);
      } else if (targetCol === 'INICIO') {
        colInicio.push(mapped);
      } else {
        colLlegada.push(mapped);
      }
    }

    colSalida.sort((a, b) => {
      const tA = a.salida_at ? new Date(a.salida_at).getTime() : 0;
      const tB = b.salida_at ? new Date(b.salida_at).getTime() : 0;
      return tB - tA;
    });

    return {
      HOLD: colHold,
      LLEGADA: colLlegada,
      INICIO: colInicio,
      SALIDA: colSalida,
    };
  }, [board, user, isEncargado, filterBoxId, filterOperarioId]);

  // Mapeo relacional de los boxes contenidos en la zona (cada box dividido en ADENTRO / AFUERA)
  const zoneBoxSlots = useMemo(() => {
    const visibleBoxes =
      isEncargado && filterBoxId !== 'ALL'
        ? sectorBoxes.filter((b) => b.id === filterBoxId)
        : sectorBoxes;

    const assignedBoxIds = new Set(visibleBoxes.map((b) => b.id));
    const slots: Array<{
      boxId: string | null;
      boxName: string;
      adentro: TallerCardItem[];
      afuera: TallerCardItem[];
    }> = visibleBoxes.map((b) => {
      const boxItems = columnsData.INICIO.filter((item) => item.box_id === b.id);
      return {
        boxId: b.id,
        boxName: b.box_name,
        adentro: boxItems.filter((item) => item.estado !== 'afuera'),
        afuera: boxItems.filter((item) => item.estado === 'afuera'),
      };
    });

    const unmappedItems = columnsData.INICIO.filter(
      (item) => !item.box_id || !assignedBoxIds.has(item.box_id)
    );
    if (slots.length === 0 || unmappedItems.length > 0) {
      slots.push({
        boxId: null,
        boxName: slots.length === 0 ? activeZoneLabel : 'SIN BOX',
        adentro: unmappedItems.filter((item) => item.estado !== 'afuera'),
        afuera: unmappedItems.filter((item) => item.estado === 'afuera'),
      });
    }

    return slots;
  }, [sectorBoxes, columnsData.INICIO, isEncargado, filterBoxId, activeZoneLabel]);

  const setItemBusy = (id: string, value: boolean) => {
    setBusyIds((prev) => {
      if (value) return { ...prev, [id]: true };
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const handleAssignProceso = async (
    item: TallerCardItem,
    payload: { usuariosIds?: string[]; boxId?: string | null }
  ) => {
    if (!user || !isEncargado) return;
    const prevBoard = board;
    const nowIso = new Date().toISOString();
    const hasUsuariosPatch = payload.usuariosIds !== undefined;
    const hasBoxPatch = payload.boxId !== undefined;
    const nextBoxId = hasBoxPatch ? payload.boxId : item.box_id;
    const nextBoxName = hasBoxPatch
      ? nextBoxId
        ? sectorBoxes.find((b) => b.id === nextBoxId)?.box_name || ''
        : ''
      : item.box_name;
    const nextUserIds = hasUsuariosPatch ? payload.usuariosIds! : item.usuarios_ids || [];
    const nextUserNames = hasUsuariosPatch
      ? nextUserIds.map(
          (uid) => sectorUsuarios.find((u) => u.id === uid)?.nombre_usuario || 'Operario'
        )
      : item.usuarios_nombres;

    setBoard((prev) => {
      if (!prev) return prev;
      if (item.col === 'HOLD') {
        return {
          ...prev,
          holds: (prev.holds || []).map((h) =>
            h.hold_id === item.id
              ? {
                  ...h,
                  ...(hasBoxPatch ? { box_id: nextBoxId || null, box_name: nextBoxName } : {}),
                  ...(hasUsuariosPatch
                    ? { usuarios_ids: nextUserIds, usuarios_nombres: nextUserNames }
                    : {}),
                  encargado_id: user.id,
                  encargado_nombre: user.nombre_usuario,
                  encargado_at: nowIso,
                }
              : h
          ),
        };
      }
      return {
        ...prev,
        activos: (prev.activos || []).map((a) =>
          a.proceso_id === item.id
            ? {
                ...a,
                ...(hasBoxPatch
                  ? { box_id: nextBoxId || a.box_id, box_name: nextBoxName || a.box_name }
                  : {}),
                ...(hasUsuariosPatch
                  ? { usuarios_ids: nextUserIds, usuarios_nombres: nextUserNames }
                  : {}),
                encargado_id: user.id,
                encargado_nombre: user.nombre_usuario,
                encargado_at: nowIso,
              }
            : a
        ),
      };
    });

    try {
      if (item.col === 'HOLD') {
        await actualizarHold(item.id, {
          ...(hasBoxPatch ? { boxId: payload.boxId ?? null } : {}),
          ...(hasUsuariosPatch ? { usuariosIds: payload.usuariosIds } : {}),
        });
      } else {
        await actualizarProceso(item.id, {
          ...(hasBoxPatch && payload.boxId ? { boxId: payload.boxId } : {}),
          ...(hasUsuariosPatch ? { usuariosIds: payload.usuariosIds } : {}),
        });
      }
      await refreshBoard();
    } catch (err) {
      console.error('Error actualizando asignación:', err);
      setBoard(prevBoard);
      throw err;
    }
  };

  // Lógica unificada de transición Drag & Drop (Optimistic UI 0 ms + Atómica)
  const executeTransition = async (
    item: TallerCardItem,
    targetCol: TallerColumnId,
    targetOptions?: { boxId?: string | null; estado?: EstadoBox }
  ) => {
    const sourcePayload: DragPayload = {
      id: item.id,
      sourceCol: item.col,
      sourceBoxId: item.box_id,
      sourceEstado: item.estado ?? null,
    };
    const dropTarget: DropTarget = {
      col: targetCol,
      boxId: targetOptions?.boxId,
      estado: targetOptions?.estado,
    };
    if (!user || !canDropTarget(sourcePayload, dropTarget) || busyIds[item.id]) return;

    const prevBoard = board;
    const nowIso = new Date().toISOString();
    const operarioAutoBoxId = !isEncargado && user.box_id ? user.box_id : null;
    const explicitBoxId =
      targetCol === 'INICIO' && operarioAutoBoxId
        ? operarioAutoBoxId
        : targetOptions?.boxId ?? null;
    const targetBoxId =
      explicitBoxId ||
      (isEncargado
        ? item.box_id ||
          user.box_id ||
          (filterBoxId !== 'ALL' ? filterBoxId : null) ||
          sectorBoxes[0]?.id ||
          null
        : user.box_id || item.box_id || sectorBoxes[0]?.id || null);
    const targetBoxName =
      (targetBoxId && sectorBoxes.find((b) => b.id === targetBoxId)?.box_name) ||
      item.box_name ||
      user.box_name ||
      'Box';
    const targetEstado: EstadoBox | undefined =
      targetCol === 'INICIO' ? targetOptions?.estado ?? 'adentro' : undefined;

    if (item.col === 'HOLD' && (targetCol === 'LLEGADA' || targetCol === 'INICIO') && !targetBoxId) {
      toast.error('Asigná un box antes de ingresar la unidad desde Pendiente.');
      return;
    }

    setItemBusy(item.id, true);
    try {
      // 1. HOLD -> LLEGADA / INICIO (boxId + estado adentro/afuera)
      if (item.col === 'HOLD' && (targetCol === 'LLEGADA' || targetCol === 'INICIO')) {
        const iniciarInmediato = targetCol === 'INICIO';
        const tempId = item.id;
        const optimisticCard: PlaneacionCard = {
          proceso_id: tempId,
          unidad_id: item.unidad_id,
          n_ute: item.n_ute,
          tractor_id: item.tractor_id,
          tractor_plate: item.tractor_plate,
          semi_id: item.semi_id,
          semi_plate: item.semi_plate,
          modalidad_tracking: 'EQUIPO_ACOPLADO',
          box_id: targetBoxId || '',
          box_name: targetBoxName,
          estado: iniciarInmediato ? targetEstado ?? 'adentro' : null,
          zone_id: user.zone_id || item.zone_id || '',
          zone_name: user.zone_name || item.zone_name || 'Zona',
          estado_proceso: iniciarInmediato ? 'EN_PROCESO' : 'EN_ESPERA',
          llegada_at: nowIso,
          inicio_at: iniciarInmediato ? nowIso : null,
          salida_at: null,
          usuarios_ids: item.usuarios_ids && item.usuarios_ids.length > 0 ? item.usuarios_ids : [user.id],
          usuarios_nombres:
            item.usuarios_nombres && item.usuarios_nombres.length > 0
              ? item.usuarios_nombres
              : [user.nombre_usuario],
          notes: item.notes && item.notes.length > 0 ? item.notes : [],
          salida_previa_at: item.salida_previa_at,
          salida_origen_box: item.salida_origen_box,
        };

        setBoard((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            holds: (prev.holds || []).filter((h) => h.hold_id !== item.id),
            activos: [optimisticCard, ...(prev.activos || [])],
          };
        });

        try {
          const res = await activarHoldProceso(
            item.id,
            targetBoxId,
            iniciarInmediato,
            iniciarInmediato ? targetEstado ?? 'adentro' : null
          );
          const realId = res?.proceso?.id ? String(res.proceso.id) : null;
          if (realId) {
            setBoard((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                activos: (prev.activos || []).map((a) =>
                  a.proceso_id === tempId
                    ? {
                        ...a,
                        proceso_id: realId,
                        llegada_at: res.proceso.llegada_at || a.llegada_at,
                        inicio_at: res.proceso.inicio_at ?? a.inicio_at,
                        estado: res.proceso.estado ?? a.estado,
                      }
                    : a
                ),
              };
            });
          }
        } catch (err) {
          console.error('Error activando hold:', err);
          toast.error(err instanceof Error ? err.message : 'Error activando unidad');
          setBoard(prevBoard);
        }
        return;
      }

      // 2. LLEGADA -> INICIO (boxId + estado adentro/afuera)
      if (item.col === 'LLEGADA' && targetCol === 'INICIO') {
        const currentProceso = board?.activos.find((a) => a.proceso_id === item.id);
        const nextUsers = currentProceso
          ? Array.from(new Set([...currentProceso.usuarios_ids, user.id]))
          : [user.id];
        const nextUserNames = currentProceso
          ? Array.from(new Set([...currentProceso.usuarios_nombres, user.nombre_usuario]))
          : [user.nombre_usuario];
        const shouldPatchBox = Boolean(explicitBoxId && explicitBoxId !== item.box_id);

        setBoard((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            activos: (prev.activos || []).map((a) =>
              a.proceso_id === item.id
                ? {
                    ...a,
                    ...(shouldPatchBox
                      ? { box_id: targetBoxId || a.box_id, box_name: targetBoxName }
                      : {}),
                    inicio_at: nowIso,
                    estado_proceso: 'EN_PROCESO',
                    estado: targetEstado ?? 'adentro',
                    usuarios_ids: nextUsers,
                    usuarios_nombres: nextUserNames,
                  }
                : a
            ),
          };
        });

        try {
          await actualizarProceso(item.id, {
            action: 'INICIAR',
            ...(shouldPatchBox && targetBoxId ? { boxId: targetBoxId } : {}),
            estado: targetEstado ?? 'adentro',
            usuariosIds: nextUsers,
          });
        } catch (err) {
          console.error('Error iniciando tarea:', err);
          toast.error(err instanceof Error ? err.message : 'Error iniciando tarea');
          setBoard(prevBoard);
        }
        return;
      }

      // 2b. INICIO -> INICIO (cambio de estado adentro <-> afuera y/o transferencia de box)
      if (item.col === 'INICIO' && targetCol === 'INICIO') {
        const nextEstado: EstadoBox = targetEstado ?? 'adentro';
        const nextBoxId = explicitBoxId || item.box_id;
        const boxChanged = Boolean(nextBoxId && nextBoxId !== item.box_id);

        setBoard((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            activos: (prev.activos || []).map((a) =>
              a.proceso_id === item.id
                ? {
                    ...a,
                    ...(boxChanged && nextBoxId
                      ? { box_id: nextBoxId, box_name: targetBoxName }
                      : {}),
                    estado: nextEstado,
                  }
                : a
            ),
          };
        });

        try {
          await actualizarProceso(item.id, {
            ...(boxChanged && nextBoxId ? { boxId: nextBoxId } : {}),
            estado: nextEstado,
          });
        } catch (err) {
          console.error('Error actualizando posición en box:', err);
          toast.error(
            err instanceof Error ? err.message : 'No se pudo actualizar la posición en el box'
          );
          setBoard(prevBoard);
        }
        return;
      }

      // 3. INICIO -> LLEGADA (Deshacer inicio preservando llegada_zona_at original)
      if (item.col === 'INICIO' && targetCol === 'LLEGADA') {
        setBoard((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            activos: (prev.activos || []).map((a) =>
              a.proceso_id === item.id
                ? { ...a, inicio_at: null, salida_at: null, estado: null, estado_proceso: 'EN_ESPERA' }
                : a
            ),
          };
        });

        try {
          await actualizarProceso(item.id, { action: 'DESHACER_INICIO' });
        } catch (err) {
          console.error('Error deshaciendo inicio:', err);
          setBoard(prevBoard);
        }
        return;
      }

      // 4. LLEGADA / INICIO -> HOLD (Revertir in-place preservando todas las notas)
      if ((item.col === 'LLEGADA' || item.col === 'INICIO') && targetCol === 'HOLD') {
        const tempHoldId = item.id;
        const restoredHold: PlaneacionHold = {
          hold_id: tempHoldId,
          unidad_id: item.unidad_id,
          n_ute: item.n_ute,
          tractor_id: item.tractor_id,
          tractor_plate: item.tractor_plate,
          semi_id: item.semi_id,
          semi_plate: item.semi_plate,
          modalidad_tracking: 'EQUIPO_ACOPLADO',
          zone_id: user.zone_id || item.zone_id || '',
          zone_name: user.zone_name || item.zone_name || 'Zona',
          box_id: targetBoxId,
          box_name: user.box_name || item.box_name || '',
          estado: null,
          orden: 1.0,
          usuarios_ids: [],
          usuarios_nombres: item.usuarios_nombres || [],
          nota_planificacion: null,
          notes: item.notes || [],
          proceso_origen_id: item.id,
          created_at: nowIso,
          updated_at: nowIso,
        };

        setBoard((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            activos: (prev.activos || []).filter((a) => a.proceso_id !== item.id),
            holds: [restoredHold, ...(prev.holds || [])],
          };
        });

        try {
          const res = await actualizarProceso(item.id, { action: 'REVERTIR_A_HOLD' });
          const realHoldId = res?.proceso?.revertedToHold?.id
            ? String(res.proceso.revertedToHold.id)
            : null;
          if (realHoldId) {
            setBoard((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                holds: (prev.holds || []).map((h) =>
                  h.hold_id === tempHoldId ? { ...h, hold_id: realHoldId } : h
                ),
              };
            });
          }
        } catch (err) {
          console.error('Error revirtiendo a hold:', err);
          setBoard(prevBoard);
        }
        return;
      }

      // 5. LLEGADA / INICIO -> SALIDA
      // Regla: queda en TERMINADO únicamente si NO tiene PREASIGNADO abierto para este activo.
      if ((item.col === 'LLEGADA' || item.col === 'INICIO') && targetCol === 'SALIDA') {
        setBoard((prev) => {
          if (!prev) return prev;
          const hasPreasignacion = (prev.holds || []).some(
            (h) =>
              (item.unidad_id && h.unidad_id === item.unidad_id) ||
              (item.tractor_id && h.tractor_id === item.tractor_id) ||
              (item.semi_id && h.semi_id === item.semi_id)
          );
          return {
            ...prev,
            activos: hasPreasignacion
              ? (prev.activos || []).filter((a) => a.proceso_id !== item.id)
              : (prev.activos || []).map((a) =>
                  a.proceso_id === item.id
                    ? { ...a, salida_at: nowIso, estado_proceso: 'FINALIZADO' }
                    : a
                ),
          };
        });

        try {
          await actualizarProceso(item.id, { action: 'FINALIZAR' });
        } catch (err) {
          console.error('Error finalizando salida:', err);
          setBoard(prevBoard);
        }
        return;
      }

      // 6. SALIDA -> INICIO / LLEGADA (1 sola llamada atómica REABRIR sobre el proceso de board.activos)
      if (item.col === 'SALIDA' && (targetCol === 'INICIO' || targetCol === 'LLEGADA')) {
        const sourceCard = board?.activos.find((a) => a.proceso_id === item.id);

        if (sourceCard) {
          const optimisticReopened: PlaneacionCard = {
            ...sourceCard,
            salida_at: null,
            inicio_at: targetCol === 'INICIO' ? sourceCard.inicio_at || nowIso : null,
            estado_proceso: targetCol === 'INICIO' ? 'EN_PROCESO' : 'EN_ESPERA',
            estado: targetCol === 'INICIO' ? targetEstado ?? 'adentro' : null,
            box_id: targetBoxId || sourceCard.box_id,
            box_name: targetBoxName || sourceCard.box_name,
          };

          setBoard((prev) => {
            if (!prev) return prev;
            const exists = (prev.activos || []).some((a) => a.proceso_id === item.id);
            return {
              ...prev,
              activos: exists
                ? (prev.activos || []).map((a) =>
                    a.proceso_id === item.id ? optimisticReopened : a
                  )
                : [optimisticReopened, ...(prev.activos || [])],
            };
          });
        }

        try {
          await actualizarProceso(item.id, {
            action: 'REABRIR',
            targetEstado: targetCol,
            boxId: targetBoxId || undefined,
            ...(targetCol === 'INICIO' ? { estado: targetEstado ?? 'adentro' } : {}),
          });
        } catch (err) {
          console.error('Error reabriendo proceso:', err);
          toast.error(err instanceof Error ? err.message : 'Error reabriendo proceso');
          setBoard(prevBoard);
        }
      }
    } finally {
      setItemBusy(item.id, false);
    }
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, item: TallerCardItem) => {
    const payload: DragPayload = {
      id: item.id,
      sourceCol: item.col,
      sourceBoxId: item.box_id,
      sourceEstado: item.estado ?? null,
    };
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
    setDragging(payload);
  };

  const handleDragEnd = () => {
    setDragging(null);
    setDragOverTarget(null);
  };

  const handleTargetDragOver = (e: React.DragEvent<HTMLElement>, target: DropTarget) => {
    if (!dragging || !canDropTarget(dragging, target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (
      dragOverTarget?.col !== target.col ||
      dragOverTarget?.boxId !== target.boxId ||
      dragOverTarget?.estado !== target.estado
    ) {
      setDragOverTarget(target);
    }
  };

  const handleTargetDrop = async (e: React.DragEvent<HTMLElement>, target: DropTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);

    let payload = dragging;
    if (!payload) {
      try {
        payload = JSON.parse(e.dataTransfer.getData('application/json')) as DragPayload;
      } catch {
        payload = null;
      }
    }
    setDragging(null);

    if (!payload || !canDropTarget(payload, target)) return;

    const sourceList = columnsData[payload.sourceCol];
    const item = sourceList.find((x) => x.id === payload.id);
    if (!item) return;

    await executeTransition(item, target.col, {
      boxId: target.boxId,
      estado: target.estado,
    });
  };

  // ============================================================================
  // 1. UI LOGIN (Delimitado a base.usuarios_taller)
  // ============================================================================
  if (!user) {
    return (
      <div className="min-h-screen w-full bg-[#070A0F] text-[#F3F4F6] flex items-center justify-center p-4 select-none">
        <div className="w-full max-w-[380px] bg-[#0E131E] border border-[#1E2530] rounded-2xl p-7 shadow-2xl">
          <div className="text-center mb-6">
            <div className="w-12 h-12 bg-[#10B981]/10 border border-[#10B981]/30 rounded-xl inline-flex items-center justify-center mb-3 text-[#10B981]">
              <KeyRound size={24} strokeWidth={2} aria-hidden="true" focusable="false" />
            </div>
            <h1 className="text-lg font-black tracking-wider text-white uppercase font-numeric">
              TALLER · ACCESO
            </h1>
          </div>

          {authError && (
            <div className="mb-4 p-3 bg-red-950/40 border border-red-500/30 rounded-xl flex items-center gap-2 text-xs text-red-300">
              <AlertCircle size={16} strokeWidth={2} aria-hidden="true" focusable="false" className="shrink-0 text-red-400" />
              <span className="leading-tight">{authError}</span>
            </div>
          )}

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="taller-username"
                className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5 font-numeric"
              >
                USUARIO
              </label>
              <input
                id="taller-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="USUARIO"
                autoFocus
                autoComplete="username"
                className="w-full h-12 px-4 bg-[#141A26] border border-[#1E2530] rounded-lg text-white text-sm font-numeric font-semibold tracking-wide outline-none focus:border-[#10B981] focus-visible:ring-2 focus-visible:ring-[#10B981] transition-colors placeholder:text-zinc-500"
              />
            </div>

            <div>
              <label
                htmlFor="taller-password"
                className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5 font-numeric"
              >
                CONTRASEÑA
              </label>
              <div className="relative">
                <input
                  id="taller-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full h-12 px-4 pr-11 bg-[#141A26] border border-[#1E2530] rounded-lg text-white text-sm font-numeric font-semibold tracking-widest outline-none focus:border-[#10B981] focus-visible:ring-2 focus-visible:ring-[#10B981] transition-colors placeholder:text-zinc-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="w-8 h-8 inline-flex items-center justify-center rounded-md absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]"
                  aria-label="Mostrar u ocultar contraseña"
                >
                  {showPassword ? (
                    <EyeOff size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
                  ) : (
                    <Eye size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={authLoading || !username.trim() || !password}
              className="w-full h-12 px-6 bg-[#00A86B] hover:bg-[#009E60] active:scale-[0.98] disabled:opacity-50 text-white font-bold text-sm tracking-wider uppercase rounded-lg border border-transparent transition-all flex items-center justify-center gap-2.5 cursor-pointer disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-[#10B981] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0E131E]"
            >
              {authLoading ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>VERIFICANDO...</span>
                </>
              ) : (
                <>
                  <span>INGRESAR</span>
                  <ArrowRight size={20} strokeWidth={2} aria-hidden="true" focusable="false" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const zonaLabelNav = user.zone_name || activeZoneLabel || 'Sin asignar';

  // Auto-ubicación por UUID del usuario (/db-render-arch + /ui-design-system):
  // Para operario con box_id, cualquier drop en ADENTRO o AFUERA de <ZONE_NAME> se dirige
  // automáticamente a su propio box sin exigir apuntar a una columna específica.
  const resolveZoneDropTarget = (slotBoxId: string | null, estado: EstadoBox): DropTarget => ({
    col: 'INICIO',
    boxId: !isEncargado && user.box_id ? user.box_id : slotBoxId,
    estado,
  });

  // ============================================================================
  // 2. DESKTOP: NAVBAR (Usuario, Zona, Filtros Encargado, Salir) + 4 DASHED CONTAINERS
  // ============================================================================
  return (
    <div className="h-screen w-full bg-[#070A0F] text-[#F3F4F6] flex flex-col overflow-hidden select-none">
      {/* Navbar minimalista: Usuario, Rol Badge, Zona (sin box), Filtros y Salir */}
      <nav className="h-12 bg-[#0B0F17] border-b border-[#1E2530] px-5 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-2 text-xs shrink-0">
            <User size={16} strokeWidth={2} aria-hidden="true" focusable="false" className="text-[#10B981]" />
            <span className="text-zinc-400 font-bold uppercase text-[10px]">USUARIO:</span>
            <span className="font-bold text-white">{user.nombre_usuario}</span>
            {isEncargado && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-bold text-[10px] tracking-wider uppercase">
                <ShieldCheck size={12} strokeWidth={2} aria-hidden="true" focusable="false" />
                <span>ENCARGADO</span>
              </span>
            )}
          </div>

          <div className="h-4 w-[1px] bg-[#1E2530] shrink-0" />

          <div className="flex items-center gap-2 text-xs shrink-0">
            <MapPin size={16} strokeWidth={2} aria-hidden="true" focusable="false" className="text-[#10B981]" />
            <span className="text-zinc-400 font-bold uppercase text-[10px]">ZONA:</span>
            <span className="font-bold text-[#10B981]">{zonaLabelNav}</span>
          </div>

          {isEncargado && (
            <>
              <div className="h-4 w-[1px] bg-[#1E2530] hidden md:block shrink-0" />
              <div className="hidden md:flex items-center gap-2">
                <select
                  value={filterBoxId}
                  onChange={(e) => setFilterBoxId(e.target.value)}
                  aria-label="Filtrar por Box de la zona"
                  className="h-8 px-2.5 bg-[#141A26] border border-[#263042] rounded-md text-xs text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-[#10B981] cursor-pointer"
                >
                  <option value="ALL">Todos los Boxes</option>
                  {sectorBoxes.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.box_name}
                    </option>
                  ))}
                </select>

                <select
                  value={filterOperarioId}
                  onChange={(e) => setFilterOperarioId(e.target.value)}
                  aria-label="Filtrar por Operario de la zona"
                  className="h-8 px-2.5 bg-[#141A26] border border-[#263042] rounded-md text-xs text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-[#10B981] cursor-pointer"
                >
                  <option value="ALL">Todos los Operarios</option>
                  {sectorUsuarios.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre_usuario}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={handleLogout}
          className="h-8 px-3 rounded-md bg-transparent hover:bg-red-950/50 border border-[#263042] hover:border-red-500/50 text-zinc-200 hover:text-red-300 text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-[#10B981] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F17] shrink-0"
        >
          <LogOut size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
          <span>Salir</span>
        </button>
      </nav>

      {/* Body: 3 Columnas Operativas Arriba + Dock Horizontal HOLD Abajo */}
      <main className="flex-1 min-h-0 p-4 flex flex-col gap-3 overflow-hidden">
        {/* Grid Superior: 3 Columnas Operativas (RESERVADO: 2, <ZONA>: 5, TERMINADO: 2) */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-9 gap-4 overflow-hidden">
          {OPERATIONAL_COLUMNS.map((col) => {
            const items = columnsData[col.id];
            const isZoneMatrix = col.id === 'INICIO';
            const columnTitle = isZoneMatrix ? activeZoneLabel : col.title;

            if (isZoneMatrix) {
              return (
                <ZoneBoxMatrixContainer
                  key={col.id}
                  zoneLabel={columnTitle}
                  totalCount={items.length}
                  slots={zoneBoxSlots}
                  colSpanClass={col.colSpanClass}
                  borderIdle={col.borderIdle}
                  borderOver={col.borderOver}
                  countClass={col.countClass}
                  defaultDropBoxId={
                    !isEncargado && user.box_id
                      ? user.box_id
                      : zoneBoxSlots[0]?.boxId ?? null
                  }
                  nowMs={nowMs}
                  busyIds={busyIds}
                  canManageAssignment={isEncargado}
                  sectorBoxes={sectorBoxes}
                  sectorUsuarios={sectorUsuarios}
                  isDragging={dragging !== null}
                  dragOverTarget={dragOverTarget}
                  canDropOnTarget={(target: ZoneDropTarget) =>
                    dragging !== null && canDropTarget(dragging, target)
                  }
                  resolveDropTarget={resolveZoneDropTarget}
                  onTargetDragOver={handleTargetDragOver}
                  onTargetDrop={handleTargetDrop}
                  onClearDragOver={() => setDragOverTarget(null)}
                  onAssign={handleAssignProceso}
                  onNoteAdded={refreshBoard}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                />
              );
            }

            const colTarget: DropTarget = { col: col.id };
            const isOver =
              dragOverTarget?.col === col.id &&
              dragging !== null &&
              canDropTarget(dragging, colTarget);

            return (
              <section
                key={col.id}
                onDragOver={(e) => handleTargetDragOver(e, colTarget)}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    if (dragOverTarget?.col === col.id) setDragOverTarget(null);
                  }
                }}
                onDrop={(e) => handleTargetDrop(e, colTarget)}
                className={`h-full min-h-0 min-w-0 rounded-2xl border-2 border-dashed p-3.5 flex flex-col transition-colors ${col.colSpanClass} ${
                  isOver ? col.borderOver : col.borderIdle
                }`}
              >
                {/* Header de Contenedor */}
                <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-[#1A2232] shrink-0">
                  <h2 className="font-helvetica font-bold text-sm tracking-wide text-white uppercase truncate">
                    {columnTitle}
                  </h2>

                  <span
                    className={`font-numeric tabular-nums text-xs font-semibold shrink-0 ${col.countClass}`}
                  >
                    {items.length}
                  </span>
                </div>

                {/* Drop Hint cuando se arrastra una card sobre otro contenedor */}
                {isOver && (
                  <div className="mb-3 px-3 py-2 rounded-xl border border-dashed border-white/30 bg-white/5 text-[11px] font-semibold text-center text-white shrink-0">
                    {col.dropHint}
                  </div>
                )}

                {/* Lista de Cards */}
                <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1 no-scrollbar">
                  {items.length === 0 ? (
                    <div className="h-full min-h-[160px] flex flex-col items-center justify-center text-center px-4 text-zinc-400 text-xs">
                      <span>Sin unidades</span>
                      <span className="text-[11px] text-zinc-400/80 mt-1">
                        Arrastrá una card aquí
                      </span>
                    </div>
                  ) : (
                    items.map((item) => (
                      <TallerUnitCard
                        key={item.id}
                        item={item}
                        nowMs={nowMs}
                        isBusy={Boolean(busyIds[item.id])}
                        canManageAssignment={isEncargado}
                        sectorBoxes={sectorBoxes}
                        sectorUsuarios={sectorUsuarios}
                        onAssign={handleAssignProceso}
                        onNoteAdded={refreshBoard}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>

        {/* Dock Inferior Horizontal: 1 · HOLD (col-span-full, peeking patentes en reposo, expandible al hover) */}
        {(() => {
          const holdItems = columnsData.HOLD;
          const holdTarget: DropTarget = { col: 'HOLD' };
          const isOverHold =
            dragOverTarget?.col === 'HOLD' &&
            dragging !== null &&
            canDropTarget(dragging, holdTarget);
          const isHoldExpanded =
            isHoldHovered ||
            isOverHold ||
            dragging?.sourceCol === 'HOLD' ||
            openHoldAssignId !== null;

          return (
            <section
              onMouseEnter={() => setIsHoldHovered(true)}
              onMouseLeave={() => setIsHoldHovered(false)}
              onDragOver={(e) => handleTargetDragOver(e, holdTarget)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  if (dragOverTarget?.col === 'HOLD') setDragOverTarget(null);
                }
              }}
              onDrop={(e) => handleTargetDrop(e, holdTarget)}
              className={`w-full shrink-0 rounded-2xl border-2 border-dashed transition-all duration-300 ease-out flex flex-col overflow-hidden ${
                isHoldExpanded ? 'h-[240px]' : 'h-[148px]'
              } ${isOverHold ? HOLD_CONFIG.borderOver : HOLD_CONFIG.borderIdle}`}
            >
              {/* Header con indicativo de hover */}
              <div
                onClick={() => setIsHoldHovered((prev) => !prev)}
                className="h-8 px-4 flex items-center justify-between border-b border-[#1A2232] bg-[#0A0E15]/95 shrink-0 cursor-pointer select-none"
              >
                <h2 className="font-helvetica font-bold text-sm tracking-wide text-white uppercase truncate">
                  {HOLD_CONFIG.title}
                </h2>

                <span
                  className={`font-numeric tabular-nums text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 ${HOLD_CONFIG.countClass}`}
                >
                  {holdItems.length}
                </span>
              </div>

              {/* Drop hint al arrastrar sobre HOLD */}
              {isOverHold && (
                <div className="mx-3 mt-2 px-3 py-1.5 rounded-lg border border-dashed border-amber-400/40 bg-amber-500/10 text-[11px] font-semibold text-center text-amber-200 shrink-0">
                  {HOLD_CONFIG.dropHint}
                </div>
              )}

              {/* Lista Horizontal de Cards Independientes */}
              <div className="flex-1 min-h-0 px-3 py-2 flex flex-row items-center gap-3 overflow-x-auto overflow-y-hidden no-scrollbar">
                {holdItems.length === 0 ? (
                  <div className="w-full h-full flex items-center justify-center text-zinc-400 text-xs">
                    <span>Sin unidades preasignadas en HOLD</span>
                  </div>
                ) : (
                  holdItems.map((item) => (
                    <TallerUnitCard
                      key={item.id}
                      item={item}
                      layout="horizontal"
                      isHoldExpanded={isHoldExpanded}
                      nowMs={nowMs}
                      isBusy={Boolean(busyIds[item.id])}
                      canManageAssignment={isEncargado}
                      sectorBoxes={sectorBoxes}
                      sectorUsuarios={sectorUsuarios}
                      onAssign={handleAssignProceso}
                      onAssignOpenChange={(isOpen) =>
                        setOpenHoldAssignId((prev) =>
                          isOpen ? item.id : prev === item.id ? null : prev
                        )
                      }
                      onNoteAdded={refreshBoard}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })()}
      </main>
    </div>
  );
};
