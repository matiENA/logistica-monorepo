import React, { useState, useEffect } from 'react';
import { TimelineGroup, HistoricalNode, StaffUser } from '../../types';
import { getUnitTimelineTasks, updateTaskExecution } from '../../services/tallerApi';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';

interface WorkOrderTimelineProps {
  tractorPlate: string;
  tractorOt: string;
  semiPlate: string;
  semiOt: string;
  currentUser: StaffUser | null;
  activeBox: string;
  onTasksUpdated?: () => void;
}

export const WorkOrderTimeline: React.FC<WorkOrderTimelineProps> = ({
  tractorPlate,
  tractorOt,
  semiPlate,
  semiOt,
  currentUser,
  activeBox,
  onTasksUpdated,
}) => {
  const [timelineGroups, setTimelineGroups] = useState<TimelineGroup[]>([]);
  const [historicalNodes, setHistoricalNodes] = useState<HistoricalNode[]>([]);
  const [progressPercentage, setProgressPercentage] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [expandedHistIndex, setExpandedHistIndex] = useState<number | null>(null);

  // Cargar tareas al cambiar de unidad u OT
  useEffect(() => {
    fetchTimeline();
  }, [tractorPlate, tractorOt, semiPlate, semiOt]);

  const fetchTimeline = async () => {
    if (!tractorPlate && !tractorOt && !semiPlate && !semiOt) {
      setTimelineGroups([]);
      setHistoricalNodes([]);
      setProgressPercentage(0);
      return;
    }

    setIsLoading(true);
    try {
      const res = await getUnitTimelineTasks({
        tractorPlate,
        tractorOt,
        semiPlate,
        semiOt,
      });

      if (res && res.success) {
        setTimelineGroups(res.timelineGroups || []);
        setHistoricalNodes(res.historicalNodes || []);
        if (res.progress !== undefined) {
          setProgressPercentage(res.progress);
        } else {
          calculateProgress(res.timelineGroups || []);
        }
      } else {
        setTimelineGroups([]);
        setHistoricalNodes([]);
        setProgressPercentage(0);
      }
    } catch (err: any) {
      console.error('Error fetching unit timeline:', err);
      toast.error('Error al cargar tareas de la orden de trabajo.');
    } finally {
      setIsLoading(false);
    }
  };

  const calculateProgress = (groups: TimelineGroup[]) => {
    const allTasks = groups.flatMap((g) => g.tasks);
    if (allTasks.length === 0) {
      setProgressPercentage(0);
      return;
    }
    const finishedCount = allTasks.filter(
      (t) => t.isTerminado || t.estado === 'TERMINADO' || t.estado === 'COMPLETADA'
    ).length;
    const pct = Math.round((finishedCount / allTasks.length) * 100);
    setProgressPercentage(pct);
  };

  // Botón "Empecé"
  const handleEmpece = async (taskId: string, otNum: string, taskDesc: string) => {
    const now = new Date();
    const d = String(now.getDate()).padStart(2, '0');
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const nowStr = `${d}/${m} ${hh}:${mm}`;

    setTimelineGroups((prev) =>
      prev.map((group) => ({
        ...group,
        tasks: group.tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                isEmpezado: true,
                estado: 'EN_CURSO' as const,
                empezo: nowStr,
                operario: currentUser?.name || 'Operario',
              }
            : task
        ),
      }))
    );

    toast.info(`Tarea iniciada: ${taskDesc}`);

    try {
      await updateTaskExecution({
        taskId,
        estado: 'EN_CURSO',
        empezo: nowStr,
        operario: currentUser?.name || 'Operario',
        ubicacion: activeBox ? `Box ${activeBox}` : '',
        otNumber: otNum,
        plate: tractorPlate || semiPlate,
      });

      if (onTasksUpdated) onTasksUpdated();
    } catch (err: any) {
      console.error('Error al actualizar inicio de tarea:', err);
      toast.error('Error al sincronizar inicio de tarea.');
      fetchTimeline();
    }
  };

  // Botón "Terminé"
  const handleTermine = async (taskId: string, otNum: string, taskDesc: string) => {
    const now = new Date();
    const d = String(now.getDate()).padStart(2, '0');
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const nowStr = `${d}/${m} ${hh}:${mm}`;

    setTimelineGroups((prev) => {
      const updated: TimelineGroup[] = prev.map((group) => ({
        ...group,
        tasks: group.tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                isTerminado: true,
                estado: 'COMPLETADA' as const,
                termino: nowStr,
              }
            : task
        ),
      }));
      calculateProgress(updated);
      return updated;
    });

    toast.success(`Tarea finalizada: ${taskDesc}`);

    try {
      await updateTaskExecution({
        taskId,
        estado: 'COMPLETADA',
        termino: nowStr,
        operario: currentUser?.name || 'Operario',
        ubicacion: activeBox ? `Box ${activeBox}` : '',
        otNumber: otNum,
        plate: tractorPlate || semiPlate,
      });

      if (onTasksUpdated) onTasksUpdated();
    } catch (err: any) {
      console.error('Error al actualizar finalización de tarea:', err);
      toast.error('Error al sincronizar finalización de tarea.');
      fetchTimeline();
    }
  };

  const hasTasks = timelineGroups.length > 0 && timelineGroups.some((g) => g.tasks.length > 0);
  const hasHistorical = historicalNodes.length > 0;

  return (
    <div className="bg-[#111622] border border-[#1E2530] rounded-xl p-2.5 shadow-sm flex flex-col flex-1 h-full overflow-hidden min-h-0">
      {/* ========================================================================= */}
      {/* CABECERA (Solo texto: ORDEN DE TRABAJO & TAREAS + PROGRESO)              */}
      {/* ========================================================================= */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#1E2530] shrink-0">
        <span className="text-xs font-black tracking-wide text-zinc-200 uppercase">
          ORDEN DE TRABAJO & TAREAS
        </span>

        <div className="flex items-center gap-2">
          {hasTasks && (
            <div className="flex items-center gap-1.5">
              <div className="w-20 h-1.5 bg-[#161D2A] rounded-full overflow-hidden border border-[#202938]">
                <div
                  className="h-full bg-[#10B981] transition-all duration-500 rounded-full"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
              <span className="text-[10px] font-mono font-bold text-[#10B981]">
                {progressPercentage}%
              </span>
            </div>
          )}

          <button
            onClick={fetchTimeline}
            disabled={isLoading}
            className="p-1 bg-[#161D2A] hover:bg-[#202938] border border-[#202938] rounded text-zinc-400 hover:text-white transition-colors"
            title="Actualizar tareas de la orden"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin text-[#10B981]' : ''}`} />
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* CUERPO CON SCROLL INTERNO PARA ENCAJAR EN PANTALLA                       */}
      {/* ========================================================================= */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-3">
        {isLoading && timelineGroups.length === 0 && (
          <div className="text-center py-10 text-zinc-500 text-xs">
            Cargando tareas operativas de la orden...
          </div>
        )}

        {!isLoading && !hasTasks && !hasHistorical && (
          <div className="text-center py-8 text-zinc-500 text-xs border border-dashed border-[#1E2530] rounded-lg p-4">
            <span className="font-bold text-zinc-400 block mb-0.5">
              No hay tareas registradas para esta unidad.
            </span>
            <span className="text-[10px] text-zinc-600">
              Verifica el número de OT ingresado arriba.
            </span>
          </div>
        )}

        {/* 1. CLUSTERS DE LA ORDEN ACTUAL */}
        {timelineGroups.map((group, groupIdx) => {
          const isPrimary = groupIdx === 0;

          return (
            <div key={`group-${groupIdx}`} className="flex flex-col">
              {/* Encabezado del Nodo de OT (Solo texto) */}
              <div className="flex items-center gap-2 py-1 sticky top-0 bg-[#111622]/95 backdrop-blur-sm z-10">
                <span className="text-xs font-black font-mono text-white tracking-wider">
                  OT {group.ot}
                </span>
                {group.date && (
                  <span className="text-[11px] font-mono font-medium text-zinc-400">
                    · {group.date}
                  </span>
                )}
                {isPrimary && (
                  <span className="px-1.5 py-0.2 rounded bg-[#10B981]/15 border border-[#10B981]/30 text-[#10B981] text-[9px] font-black uppercase">
                    EN CURSO
                  </span>
                )}
              </div>

              {/* Espina dorsal vertical para las tareas */}
              <div className="border-l-2 border-dashed border-[#10B981] ml-2 pl-3 py-1 space-y-2">
                {group.tasks.map((task) => {
                  const isDone = Boolean(
                    task.isTerminado ||
                    task.estado === 'TERMINADO' ||
                    task.estado === 'COMPLETADA'
                  );
                  const isEmpezado = Boolean(
                    !isDone &&
                    (task.isEmpezado ||
                      task.estado === 'EN_CURSO' ||
                      (task.empezo && task.empezo.trim() !== ''))
                  );

                  return (
                    <div
                      key={task.id}
                      className={`p-2 rounded-lg border transition-all flex items-center justify-between gap-2 ${
                        isDone
                          ? 'bg-[#0B0F15]/70 border-[#1A2230]'
                          : isEmpezado
                          ? 'bg-[#0E1520] border-[#10B981]/40 shadow-sm'
                          : 'bg-[#0B0F15] border-[#1E2530] hover:border-zinc-700'
                      }`}
                    >
                      {/* Descripción de Tarea + Rubro (Solo texto) */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="px-1.5 py-0.2 rounded bg-[#161D2A] border border-[#202938] text-[9px] font-black text-white uppercase">
                            {task.rubro || 'GENERAL'}
                          </span>

                          {isDone && (
                            <span className="text-[9px] font-bold text-zinc-500">
                              Terminado {task.termino ? `(${task.termino})` : ''}
                            </span>
                          )}

                          {isEmpezado && (
                            <span className="text-[9px] font-bold text-[#34D399] animate-pulse">
                              En curso {task.empezo ? `(${task.empezo})` : ''}
                            </span>
                          )}
                        </div>

                        <p
                          className={`text-xs mt-0.5 leading-tight truncate ${
                            isDone ? 'line-through text-zinc-500' : 'text-zinc-200 font-medium'
                          }`}
                        >
                          {task.desc || task.descripcion}
                        </p>
                      </div>

                      {/* Botones de Acción (Solo texto) */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() =>
                            handleEmpece(task.id, group.ot, task.desc || task.descripcion || '')
                          }
                          disabled={isDone || isEmpezado}
                          className={`px-2.5 py-1 rounded text-[11px] font-black transition-all ${
                            isEmpezado
                              ? 'bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/40 cursor-default'
                              : isDone
                              ? 'bg-[#161D2A] text-zinc-600 border border-[#202938] cursor-not-allowed opacity-50'
                              : 'bg-[#00A86B] hover:bg-[#009E60] text-white shadow-sm cursor-pointer'
                          }`}
                        >
                          Empecé
                        </button>

                        <button
                          onClick={() =>
                            handleTermine(task.id, group.ot, task.desc || task.descripcion || '')
                          }
                          disabled={!isEmpezado || isDone}
                          className={`px-2.5 py-1 rounded text-[11px] font-black transition-all ${
                            isDone
                              ? 'bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/30 cursor-default'
                              : isEmpezado
                              ? 'bg-[#059669] hover:bg-[#10B981] text-white shadow-md cursor-pointer animate-pulse'
                              : 'bg-[#161D2A] text-zinc-600 border border-[#202938] cursor-not-allowed opacity-50'
                          }`}
                        >
                          Terminé
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* 2. HISTORIAL DE ÓRDENES PREVIAS */}
        {hasHistorical && (
          <div className="pt-1.5">
            <span className="text-[9px] font-black text-zinc-500 uppercase tracking-wider block mb-1">
              HISTORIAL DE INTERVENCIONES PREVIAS
            </span>

            <div className="space-y-1.5">
              {historicalNodes.map((hist, histIdx) => {
                const isExpanded = expandedHistIndex === histIdx;
                const otsLabel =
                  hist.ots && hist.ots.length > 0
                    ? hist.ots.join(' ')
                    : hist.ot || 'OT ANTERIOR';

                return (
                  <div
                    key={`hist-${histIdx}`}
                    className="border border-[#1E2530] rounded-lg overflow-hidden bg-[#0B0F15]"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedHistIndex(isExpanded ? null : histIdx)}
                      className="w-full px-2.5 py-1.5 flex items-center justify-between text-left hover:bg-[#111622] transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-black font-mono text-zinc-200">
                          {otsLabel}
                        </span>
                        {hist.date && (
                          <span className="text-[10px] font-mono text-zinc-400">
                            · {hist.date}
                          </span>
                        )}
                        <span className="text-[9px] text-zinc-500">
                          ({hist.tasks?.length || 0} tareas)
                        </span>
                      </div>

                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="px-2.5 pb-2 pt-1 border-t border-[#1E2530] bg-[#070A0F]/60 space-y-1">
                        {hist.tasks && hist.tasks.length > 0 ? (
                          hist.tasks.map((ht, htIdx) => (
                            <div
                              key={htIdx}
                              className="text-xs py-1 px-2 rounded bg-[#111622]/80 border border-[#1E2530] flex items-center gap-1.5"
                            >
                              <span className="font-extrabold text-zinc-300 uppercase text-[9px]">
                                {ht.rubro || 'GENERAL'}:
                              </span>
                              <span className="text-zinc-400 text-[11px] truncate">
                                {ht.desc || ht.descripcion}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="text-[10px] text-zinc-500 italic py-0.5">
                            Sin detalle de tareas registradas.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
