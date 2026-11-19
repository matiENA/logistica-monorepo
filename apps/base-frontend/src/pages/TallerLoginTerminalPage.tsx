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
  User,
} from 'lucide-react';
import {
  TallerUnitCard,
  type TallerCardItem,
  type TallerColumnId,
} from '../components/taller/TallerUnitCard';
import {
  activarHoldProceso,
  actualizarProceso,
  clearTallerUser,
  fetchTallerBoard,
  getSavedTallerUser,
  loginUsuarioTaller,
  subscribePlaneacionSocket,
  verificarAccesoTaller,
} from '../services/planeacionApi';
import type { BoardResponse, PlaneacionCard, PlaneacionHold, UsuarioTallerSession } from '../types/planeacion';

interface DragPayload {
  id: string;
  sourceCol: TallerColumnId;
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
  borderIdle: string;
  borderOver: string;
  countClass: string;
  dropHint: string;
}> = [
  {
    id: 'LLEGADA',
    title: 'RESERVADO EN BOX',
    borderIdle: 'border-blue-500/30 bg-[#0A0E15]/80',
    borderOver: 'border-blue-400 bg-blue-500/10',
    countClass: 'text-blue-300',
    dropHint: 'Soltar para registrar llegada_at',
  },
  {
    id: 'INICIO',
    title: 'TRABAJANDO',
    borderIdle: 'border-emerald-500/30 bg-[#0A0E15]/80',
    borderOver: 'border-emerald-400 bg-emerald-500/10',
    countClass: 'text-emerald-300',
    dropHint: 'Soltar para registrar inicio_at',
  },
  {
    id: 'SALIDA',
    title: 'TERMINADO',
    borderIdle: 'border-zinc-700/60 bg-[#0A0E15]/80',
    borderOver: 'border-emerald-400 bg-emerald-500/10',
    countClass: 'text-zinc-300',
    dropHint: 'Soltar para registrar salida_at',
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

function canDropColumn(sourceCol: TallerColumnId, targetCol: TallerColumnId): boolean {
  if (sourceCol === targetCol) return false;
  if (sourceCol === 'HOLD' && targetCol === 'SALIDA') return false;
  if (sourceCol === 'SALIDA' && targetCol === 'HOLD') return false;
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
  const [dragOverCol, setDragOverCol] = useState<TallerColumnId | null>(null);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const [isHoldHovered, setIsHoldHovered] = useState(false);

  const refreshBoard = useCallback(async () => {
    try {
      const snap = await fetchTallerBoard();
      setBoard(snap);
    } catch (err) {
      console.error('Error sincronizando tablero de taller:', err);
    }
  }, []);

  // Verificación estricta de sesión y suscripción Socket.IO (0 polling agresivo)
  useEffect(() => {
    if (!user) return;
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
      active = false;
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
  };

  // Normalizar cards por columna filtrando por el Box / Zona del operario conectado
  const columnsData = useMemo(() => {
    const holdsRaw = board?.holds || [];
    const activosRaw = board?.activos || [];

    const filteredHolds = holdsRaw.filter((h) => {
      if (!user) return false;
      if (user.box_id && h.box_id) return h.box_id === user.box_id;
      if (user.zone_id) return h.zone_id === user.zone_id;
      return true;
    });

    const filteredActivos = activosRaw.filter((c) => {
      if (!user) return false;
      if (user.box_id) return c.box_id === user.box_id;
      if (user.zone_id) return c.zone_id === user.zone_id;
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
        zone_id: h.zone_id,
        zone_name: h.zone_name,
        orden: h.orden,
        nota_planificacion: h.nota_planificacion,
        notes: h.notes,
        notes_count: h.notes?.length || (h.nota_planificacion ? 1 : 0),
        usuarios_nombres: h.usuarios_nombres,
        salida_previa_at: h.salida_previa_at,
        salida_origen_box: h.salida_origen_box,
        salida_origen_zone: h.salida_origen_zone,
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
        zone_id: c.zone_id,
        zone_name: c.zone_name,
        llegada_at: c.llegada_at,
        inicio_at: c.inicio_at,
        salida_at: c.salida_at,
        usuarios_nombres: c.usuarios_nombres,
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
  }, [board, user]);

  const setItemBusy = (id: string, value: boolean) => {
    setBusyIds((prev) => {
      if (value) return { ...prev, [id]: true };
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  // Lógica unificada de transición Drag & Drop (Optimistic UI 0 ms + Atómica)
  const executeTransition = async (item: TallerCardItem, targetCol: TallerColumnId) => {
    if (!user || !canDropColumn(item.col, targetCol) || busyIds[item.id]) return;

    const prevBoard = board;
    const nowIso = new Date().toISOString();
    const targetBoxId = user.box_id || item.box_id || null;

    setItemBusy(item.id, true);
    try {
      // 1. HOLD -> LLEGADA / INICIO
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
          box_name: user.box_name || item.box_name || 'Box',
          zone_id: user.zone_id || item.zone_id || '',
          zone_name: user.zone_name || item.zone_name || 'Zona',
          estado_proceso: iniciarInmediato ? 'EN_PROCESO' : 'EN_ESPERA',
          llegada_at: nowIso,
          inicio_at: iniciarInmediato ? nowIso : null,
          salida_at: null,
          usuarios_ids: [user.id],
          usuarios_nombres: [user.nombre_usuario],
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
          const res = await activarHoldProceso(item.id, targetBoxId, iniciarInmediato);
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
                      }
                    : a
                ),
              };
            });
          }
        } catch (err) {
          console.error('Error activando hold:', err);
          setBoard(prevBoard);
        }
        return;
      }

      // 2. LLEGADA -> INICIO
      if (item.col === 'LLEGADA' && targetCol === 'INICIO') {
        const currentProceso = board?.activos.find((a) => a.proceso_id === item.id);
        const nextUsers = currentProceso
          ? Array.from(new Set([...currentProceso.usuarios_ids, user.id]))
          : [user.id];
        const nextUserNames = currentProceso
          ? Array.from(new Set([...currentProceso.usuarios_nombres, user.nombre_usuario]))
          : [user.nombre_usuario];

        setBoard((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            activos: (prev.activos || []).map((a) =>
              a.proceso_id === item.id
                ? {
                    ...a,
                    inicio_at: nowIso,
                    estado_proceso: 'EN_PROCESO',
                    usuarios_ids: nextUsers,
                    usuarios_nombres: nextUserNames,
                  }
                : a
            ),
          };
        });

        try {
          await actualizarProceso(item.id, { action: 'INICIAR', usuariosIds: nextUsers });
        } catch (err) {
          console.error('Error iniciando tarea:', err);
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
                ? { ...a, inicio_at: null, salida_at: null, estado_proceso: 'EN_ESPERA' }
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
            box_id: targetBoxId || sourceCard.box_id,
            box_name: user.box_name || sourceCard.box_name,
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
          });
        } catch (err) {
          console.error('Error reabriendo proceso:', err);
          setBoard(prevBoard);
        }
      }
    } finally {
      setItemBusy(item.id, false);
    }
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, item: TallerCardItem) => {
    const payload: DragPayload = { id: item.id, sourceCol: item.col };
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
    setDragging(payload);
  };

  const handleDragEnd = () => {
    setDragging(null);
    setDragOverCol(null);
  };

  const handleColumnDragOver = (e: React.DragEvent<HTMLElement>, colId: TallerColumnId) => {
    if (!dragging || !canDropColumn(dragging.sourceCol, colId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverCol !== colId) {
      setDragOverCol(colId);
    }
  };

  const handleColumnDrop = async (e: React.DragEvent<HTMLElement>, targetCol: TallerColumnId) => {
    e.preventDefault();
    setDragOverCol(null);

    let payload = dragging;
    if (!payload) {
      try {
        payload = JSON.parse(e.dataTransfer.getData('application/json')) as DragPayload;
      } catch {
        payload = null;
      }
    }
    setDragging(null);

    if (!payload || !canDropColumn(payload.sourceCol, targetCol)) return;

    const sourceList = columnsData[payload.sourceCol];
    const item = sourceList.find((x) => x.id === payload.id);
    if (!item) return;

    await executeTransition(item, targetCol);
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

  const zonaLoc = [user.zone_name, user.box_name].filter(Boolean).join(' · ') || 'Sin asignar';

  // ============================================================================
  // 2. DESKTOP: NAVBAR (Usuario, Zona Loc, Salir) + 4 DASHED CONTAINERS
  // ============================================================================
  return (
    <div className="h-screen w-full bg-[#070A0F] text-[#F3F4F6] flex flex-col overflow-hidden select-none">
      {/* Navbar minimalista: Usuario, Zona Loc y Salir */}
      <nav className="h-12 bg-[#0B0F17] border-b border-[#1E2530] px-5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs">
            <User size={16} strokeWidth={2} aria-hidden="true" focusable="false" className="text-[#10B981]" />
            <span className="text-zinc-400 font-bold uppercase text-[10px]">USUARIO:</span>
            <span className="font-bold text-white">{user.nombre_usuario}</span>
          </div>

          <div className="h-4 w-[1px] bg-[#1E2530]" />

          <div className="flex items-center gap-2 text-xs">
            <MapPin size={16} strokeWidth={2} aria-hidden="true" focusable="false" className="text-[#10B981]" />
            <span className="text-zinc-400 font-bold uppercase text-[10px]">ZONA / LOC:</span>
            <span className="font-bold text-[#10B981]">{zonaLoc}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          className="h-8 px-3 rounded-md bg-transparent hover:bg-red-950/50 border border-[#263042] hover:border-red-500/50 text-zinc-200 hover:text-red-300 text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-[#10B981] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F17]"
        >
          <LogOut size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
          <span>Salir</span>
        </button>
      </nav>

      {/* Body: 3 Columnas Operativas Arriba + Dock Horizontal HOLD Abajo */}
      <main className="flex-1 min-h-0 p-4 flex flex-col gap-3 overflow-hidden">
        {/* Grid Superior: 3 Columnas Operativas (LLEGADA, INICIO, SALIDA) */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-3 gap-4 overflow-hidden">
          {OPERATIONAL_COLUMNS.map((col) => {
            const items = columnsData[col.id];
            const isOver =
              dragOverCol === col.id &&
              dragging !== null &&
              canDropColumn(dragging.sourceCol, col.id);

            return (
              <section
                key={col.id}
                onDragOver={(e) => handleColumnDragOver(e, col.id)}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    if (dragOverCol === col.id) setDragOverCol(null);
                  }
                }}
                onDrop={(e) => handleColumnDrop(e, col.id)}
                className={`h-full min-h-0 rounded-2xl border-2 border-dashed p-3.5 flex flex-col transition-colors ${
                  isOver ? col.borderOver : col.borderIdle
                }`}
              >
                {/* Header de Contenedor */}
                <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-[#1A2232] shrink-0">
                  <h2 className="font-helvetica font-bold text-sm tracking-wide text-white uppercase truncate">
                    {col.title}
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
          const isOverHold =
            dragOverCol === 'HOLD' &&
            dragging !== null &&
            canDropColumn(dragging.sourceCol, 'HOLD');
          const isHoldExpanded =
            isHoldHovered || isOverHold || dragging?.sourceCol === 'HOLD';

          return (
            <section
              onMouseEnter={() => setIsHoldHovered(true)}
              onMouseLeave={() => setIsHoldHovered(false)}
              onDragOver={(e) => handleColumnDragOver(e, 'HOLD')}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  if (dragOverCol === 'HOLD') setDragOverCol(null);
                }
              }}
              onDrop={(e) => handleColumnDrop(e, 'HOLD')}
              className={`w-full shrink-0 rounded-2xl border-2 border-dashed transition-all duration-300 ease-out flex flex-col overflow-hidden ${
                isHoldExpanded ? 'h-[232px]' : 'h-[132px]'
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
