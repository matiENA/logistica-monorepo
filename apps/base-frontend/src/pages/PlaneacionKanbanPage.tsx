import React, { useCallback, useMemo, useState } from 'react';
import { ArrowUpDown, CheckCircle2, LogOut, Plus, RefreshCw, Search } from 'lucide-react';
import { usePlaneacionKanban } from '../hooks/usePlaneacionKanban';
import { AutoScrollColumn } from '../components/common/AutoScrollColumn';
import { UnitPlaneacionCard } from '../components/kanban/UnitPlaneacionCard';
import { UnitPlaneacionDeployedModal } from '../components/kanban/UnitPlaneacionDeployedModal';
import { NewIngresoModal } from '../components/kanban/NewIngresoModal';
import {
  actualizarHold,
  actualizarProceso,
  crearHold,
  eliminarHold,
} from '../services/planeacionApi';
import type { PlaneacionCard, PlaneacionCatalog } from '../types/planeacion';

export const PlaneacionKanbanPage: React.FC = () => {
  const {
    sortDirection,
    setSortDirection,
    searchQuery,
    setSearchQuery,
    selectedProcesoId,
    setSelectedProcesoId,
    selectedCard,
    columns,
    activosCount,
    catalog,
    isLoading,
    isFetching,
    refresh,
    optimisticMoveFinalizadoToHold,
    optimisticCloneActiveToHold,
    optimisticCloneHoldToZone,
    optimisticRemoveCard,
    optimisticUpdateUsuarios,
    rollbackBoard,
  } = usePlaneacionKanban();

  const [hoveredColId, setHoveredColId] = useState<string | null>(null);
  const [dragOverZoneId, setDragOverZoneId] = useState<string | null>(null);
  const [dragOverPreasignadoZoneId, setDragOverPreasignadoZoneId] = useState<string | null>(null);
  const [isDragOverEgreso, setIsDragOverEgreso] = useState(false);
  const [isNewIngresoOpen, setIsNewIngresoOpen] = useState(false);
  const [openAssignCardId, setOpenAssignCardId] = useState<string | null>(null);

  const usuariosByZone = useMemo(() => {
    const map = new Map<string, PlaneacionCatalog['usuarios']>();
    for (const u of catalog.usuarios || []) {
      if (u.rol === 'coordinacion' || !u.zone_id) continue;
      const list = map.get(u.zone_id);
      if (list) list.push(u);
      else map.set(u.zone_id, [u]);
    }
    return map;
  }, [catalog.usuarios]);

  const handleAssignUsuarios = useCallback(
    async (card: PlaneacionCard, nextUserIds: string[]) => {
      const isHold = Boolean(card.hold_id || card.etapa_ciclo === 'PLANIFICADO_HOLD');
      const targetId = isHold ? card.hold_id || card.proceso_id : card.proceso_id;
      const nextUserNames = nextUserIds.map(
        (uid) =>
          (catalog.usuarios || []).find((u) => u.id === uid)?.nombre_usuario || 'Operario'
      );

      const previousSnapshot = optimisticUpdateUsuarios(
        targetId,
        isHold,
        nextUserIds,
        nextUserNames
      );

      try {
        if (isHold) {
          await actualizarHold(targetId, { usuariosIds: nextUserIds });
        } else {
          await actualizarProceso(targetId, { usuariosIds: nextUserIds });
        }
      } catch (err) {
        rollbackBoard(previousSnapshot);
        throw err;
      }
    },
    [catalog.usuarios, optimisticUpdateUsuarios, rollbackBoard]
  );

  const renderUnitCard = (card: PlaneacionCard) => (
    <UnitPlaneacionCard
      key={card.proceso_id}
      card={card}
      zoneUsuarios={usuariosByZone.get(card.zone_id) || []}
      onAssignUsuarios={handleAssignUsuarios}
      onAssignOpenChange={(isOpen) =>
        setOpenAssignCardId((prev) =>
          isOpen ? card.proceso_id : prev === card.proceso_id ? null : prev
        )
      }
      onClick={(c) => setSelectedProcesoId(c.proceso_id)}
      onNoteAdded={refresh}
    />
  );

  const extractDragPayload = (e: React.DragEvent) => {
    try {
      const raw =
        e.dataTransfer?.getData('application/json') ||
        e.dataTransfer?.getData('text/plain') ||
        '';
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore parse errors
    }
    return ((window as unknown as Record<string, unknown>).__COORD_DRAG_PAYLOAD as Record<string, unknown>) || null;
  };

  // Manejo de Drag & Drop a Zonas / Boxes (Optimistic UI 0 ms, sin blink ni toasts)
  const handleDropOnZone = async (zoneId: string, e: React.DragEvent, isPreasignadoSection = false) => {
    e.preventDefault();
    setDragOverZoneId(null);
    setDragOverPreasignadoZoneId(null);
    try {
      const data = extractDragPayload(e) as Record<string, any> | null;
      (window as unknown as Record<string, unknown>).__COORD_DRAG_PAYLOAD = null;
      if (!data) return;

      // Multi-PREASIGNADO: arrastrar un PREASIGNADO a otra zona desprende un nuevo PREASIGNADO sin ocultar el origen
      if (data.type === 'CARD_HOLD' && data.holdId) {
        if (data.zoneId === zoneId) return;
        const previousSnapshot = optimisticCloneHoldToZone(data.holdId, zoneId);

        try {
          await crearHold({
            zoneId,
            boxId: null,
            unidadId: data.unidadId || null,
            tractorId: data.tractorId || null,
            semiId: data.semiId || null,
            procesoOrigenId: data.holdId,
          });
        } catch (err) {
          console.error('Error al desprender preasignación:', err);
          rollbackBoard(previousSnapshot);
        }
        return;
      }

      if (data.type === 'CARD_PROCESO' && data.procesoId) {
        // Caso 1 · Desde FINALIZÓ: sale de su columna del Kanban y pasa a la nueva zona en PREASIGNADO con su última ubicación
        if (data.salidaAt) {
          const previousSnapshot = optimisticMoveFinalizadoToHold(data.procesoId, zoneId);

          try {
            await actualizarProceso(data.procesoId, {
              zoneId,
              action: 'REINTEGRAR_A_PREASIGNADO',
            });
          } catch (err) {
            console.error('Error al trasladar unidad a preasignado:', err);
            rollbackBoard(previousSnapshot);
          }
          return;
        }

        // Caso 2A · Desde otra instancia soltada sobre PREASIGNADO de su misma zona: revertir a hold
        if (data.zoneId === zoneId) {
          if (!isPreasignadoSection) return;
          try {
            await actualizarProceso(data.procesoId, {
              action: 'REVERTIR_A_HOLD',
            });
            refresh();
          } catch (err) {
            console.error('Error al revertir unidad a preasignado:', err);
          }
          return;
        }

        // Caso 2B · Desde otra instancia (TRABAJANDO / ESPERANDO A SER INGRESADO A BOX) hacia otra zona: mantiene carta activa y desprende PREASIGNADO amarillo
        const previousSnapshot = optimisticCloneActiveToHold(data.procesoId, zoneId);

        try {
          await crearHold({
            zoneId,
            boxId: null,
            unidadId: data.unidadId || null,
            tractorId: data.tractorId || null,
            semiId: data.semiId || null,
            procesoOrigenId: data.procesoId,
          });
        } catch (err) {
          console.error('Error al preasignar unidad activa:', err);
          rollbackBoard(previousSnapshot);
        }
        return;
      }
    } catch (err) {
      console.error('Error al procesar asignación por arrastre:', err);
    }
  };

  // Manejo de Drop en Egreso / Salida (Optimistic UI 0 ms, eliminación protegida por jerarquía user_coordinacion)
  const handleDropOnEgreso = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverEgreso(false);
    try {
      const data = extractDragPayload(e) as Record<string, any> | null;
      (window as unknown as Record<string, unknown>).__COORD_DRAG_PAYLOAD = null;
      if (!data) return;

      if (data.type === 'CARD_HOLD' && data.holdId) {
        const previousSnapshot = optimisticRemoveCard(data.holdId, true);

        try {
          await eliminarHold(data.holdId);
        } catch (err) {
          console.error('Error al eliminar preasignación:', err);
          rollbackBoard(previousSnapshot);
        }
        return;
      }

      if (data.type === 'CARD_PROCESO' && data.procesoId) {
        const previousSnapshot = optimisticRemoveCard(data.procesoId, false);

        try {
          await actualizarProceso(data.procesoId, { action: 'ARCHIVAR' });
        } catch (err) {
          console.error('Error al archivar por egreso:', err);
          rollbackBoard(previousSnapshot);
        }
        return;
      }
    } catch (err) {
      console.error('Error al dar egreso:', err);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col select-none bg-[#EDEDED] text-zinc-950 font-sans">
      {/* Header Coordinación · UI Design System compliant */}
      <header className="w-full px-4 md:px-6 py-2.5 flex items-center justify-between min-h-[48px] shrink-0 bg-[#EDEDED] border-b border-zinc-300/80">
        {/* Controles Izquierda: Buscador + Refresh + Contador */}
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Patente, box o zona..."
              aria-label="Buscar unidad por patente, box o zona"
              className="h-8 pl-8 pr-3 bg-white border border-zinc-300 rounded-full text-xs text-zinc-900 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-800 focus-visible:ring-offset-1 w-56 md:w-64 transition-all shadow-2xs"
            />
          </div>

          <button
            type="button"
            onClick={refresh}
            title="Actualizar tablero"
            aria-label="Actualizar tablero"
            className="w-8 h-8 rounded-full bg-white border border-zinc-300 flex items-center justify-center text-zinc-700 hover:text-zinc-950 hover:border-zinc-500 transition-colors cursor-pointer shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-800"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </button>

          <span
            className="hidden sm:inline-flex items-center text-[11px] font-mono font-bold px-2.5 py-1 rounded-full bg-white border border-zinc-300 text-zinc-700 shadow-2xs select-none"
            title="Unidades activas en planta"
          >
            {activosCount} activas
          </span>
        </div>

        {/* Controles Derecha: Primary CTA (+ Ingresar Unidad) + Sort + Status */}
        <div className="flex items-center gap-2">
          {/* Primary Action Button (btn-sm, height 32px, WCAG compliant) */}
          <button
            type="button"
            onClick={() => setIsNewIngresoOpen(true)}
            className="h-8 inline-flex items-center gap-1.5 px-3 rounded-full bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Ingresar Unidad</span>
          </button>

          {/* Sort Button (btn-sm icon, height 32px) */}
          <button
            type="button"
            onClick={() => setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
            title={`Ordenar por llegada (${sortDirection === 'desc' ? 'Más reciente' : 'Más antiguo'})`}
            aria-label={`Ordenar por llegada (${sortDirection === 'desc' ? 'Más reciente' : 'Más antiguo'})`}
            className="w-8 h-8 rounded-full bg-white border border-zinc-300 hover:border-zinc-500 text-zinc-700 hover:text-zinc-950 flex items-center justify-center cursor-pointer shadow-2xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-800"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
          </button>

          {/* Channel Tag / Status Badge */}
          <div
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full bg-white border border-zinc-300 text-[11px] font-mono font-bold text-zinc-800 shadow-2xs select-none"
            title="Canal activo de coordinación"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>#coordinacion</span>
          </div>
        </div>
      </header>

      {/* Tablero Kanban por Zonas */}
      <main className="flex-1 min-h-0 w-full px-3 md:px-6 py-2.5 flex flex-col overflow-x-auto overflow-y-hidden">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-zinc-700">
              <RefreshCw className="w-7 h-7 animate-spin text-zinc-950" />
              <span className="text-sm font-bold">Cargando tablero de planeación...</span>
            </div>
          </div>
        ) : columns.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 gap-2">
            <span className="text-sm font-bold">Sin zonas configuradas en base.zones</span>
            <span className="text-xs">Agregá zonas y boxes para visualizar columnas.</span>
          </div>
        ) : (
          <div
            className="grid flex-1 min-h-0 h-full gap-0 min-w-max"
            style={{
              gridTemplateColumns: `repeat(${columns.length}, minmax(260px, 1fr)) minmax(180px, 220px)`,
            }}
          >
            {columns.map((col) => {
              const isDragOver = dragOverZoneId === col.id;
              const salidaCards = col.cards.filter(
                (c) => !c.hold_id && c.etapa_ciclo !== 'PLANIFICADO_HOLD' && Boolean(c.salida_at)
              );
              const inicioCards = col.cards.filter(
                (c) =>
                  !c.hold_id &&
                  c.etapa_ciclo !== 'PLANIFICADO_HOLD' &&
                  Boolean(c.inicio_at && !c.salida_at)
              );
              const reservadoCards = col.cards.filter(
                (c) =>
                  !c.hold_id &&
                  c.etapa_ciclo !== 'PLANIFICADO_HOLD' &&
                  Boolean(c.llegada_at && !c.inicio_at && !c.salida_at)
              );
              const preasignadoCards = col.cards.filter((c) =>
                Boolean(c.hold_id || c.etapa_ciclo === 'PLANIFICADO_HOLD')
              );

              return (
                <section
                  key={col.id}
                  onMouseEnter={() => setHoveredColId(col.id)}
                  onMouseLeave={() => setHoveredColId(null)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverZoneId !== col.id) setDragOverZoneId(col.id);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      if (dragOverZoneId === col.id) setDragOverZoneId(null);
                    }
                  }}
                  onDrop={(e) => handleDropOnZone(col.id, e)}
                  className={`h-full flex flex-col min-h-0 px-2.5 pt-1.5 pb-2 border-r-[3px] border-dashed border-amber-400 transition-colors ${
                    isDragOver ? 'bg-emerald-50/70 border-emerald-500' : ''
                  }`}
                >
                  <div className="mb-2 px-1 flex items-center justify-between gap-2 h-[38px] shrink-0">
                    <h2 className="text-[15px] xl:text-[17px] font-extrabold tracking-tight text-zinc-950 lowercase font-mono truncate">
                      {col.title}
                    </h2>
                    <span className="text-xs font-mono font-bold text-zinc-700 bg-white border border-zinc-300 rounded-full px-2 py-0.5 shrink-0 shadow-2xs">
                      {col.cards.length}
                    </span>
                  </div>

                  <AutoScrollColumn
                    itemsCount={col.cards.length}
                    isHovered={hoveredColId === col.id}
                    isPaused={selectedProcesoId !== null || openAssignCardId !== null}
                    ariaLabel={`Zona ${col.title}`}
                    className="flex flex-col gap-2.5 pr-0.5"
                  >
                    {/* 1. TOPE: salida_at / FINALIZÓ */}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between px-1 text-[10px] font-mono font-bold tracking-wider uppercase text-zinc-950 opacity-40 select-none">
                        <span>FINALIZÓ</span>
                        <span className="tabular-nums font-semibold">{salidaCards.length}</span>
                      </div>
                      {salidaCards.length === 0 ? (
                        <div className="py-1 px-2 text-center text-[10px] font-mono text-zinc-400 opacity-40 italic select-none">
                          sin unidades
                        </div>
                      ) : (
                        salidaCards.map(renderUnitCard)
                      )}
                    </div>

                    {/* DIVIDER */}
                    <div className="border-t border-zinc-300 opacity-40 my-0.5" />

                    {/* 2. MEDIO: inicio_at / TRABAJANDO */}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between px-1 text-[10px] font-mono font-bold tracking-wider uppercase text-zinc-950 opacity-40 select-none">
                        <span>TRABAJANDO</span>
                        <span className="tabular-nums font-semibold">{inicioCards.length}</span>
                      </div>
                      {inicioCards.length === 0 ? (
                        <div className="py-1 px-2 text-center text-[10px] font-mono text-zinc-400 opacity-40 italic select-none">
                          sin unidades
                        </div>
                      ) : (
                        inicioCards.map(renderUnitCard)
                      )}
                    </div>

                    {/* DIVIDER */}
                    <div className="border-t border-zinc-300 opacity-40 my-0.5" />

                    {/* 3. SUBDIVIDER RESERVADO: procesos.llegada_at / ESPERANDO A SER INGRESADO A BOX */}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-1 px-1 text-[10px] font-mono font-bold tracking-wider uppercase text-zinc-950 opacity-40 select-none">
                        <span className="truncate" title="Reservado (procesos.llegada_at) · Esperando a ser ingresado a Box">
                          ESPERANDO A SER INGRESADO A BOX
                        </span>
                        <span className="tabular-nums font-semibold shrink-0">{reservadoCards.length}</span>
                      </div>
                      {reservadoCards.length === 0 ? (
                        <div className="py-1 px-2 text-center text-[10px] font-mono text-zinc-400 opacity-40 italic select-none">
                          sin unidades
                        </div>
                      ) : (
                        reservadoCards.map(renderUnitCard)
                      )}
                    </div>

                    {/* DIVIDER */}
                    <div className="border-t border-zinc-300 opacity-40 my-0.5" />

                    {/* 4. FONDO: procesos_hold / PREASIGNADO */}
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'move';
                        if (dragOverPreasignadoZoneId !== col.id) setDragOverPreasignadoZoneId(col.id);
                      }}
                      onDragLeave={(e) => {
                        e.stopPropagation();
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                          if (dragOverPreasignadoZoneId === col.id) setDragOverPreasignadoZoneId(null);
                        }
                      }}
                      onDrop={(e) => {
                        e.stopPropagation();
                        handleDropOnZone(col.id, e, true);
                      }}
                      className={`flex flex-col gap-2 p-1.5 rounded-lg transition-all ${
                        dragOverPreasignadoZoneId === col.id
                          ? 'bg-amber-100/70 border-2 border-dashed border-amber-500 ring-2 ring-amber-400/40'
                          : ''
                      }`}
                    >
                      <div className="flex items-center justify-between px-1 text-[10px] font-mono font-bold tracking-wider uppercase text-zinc-950 opacity-40 select-none">
                        <span>PREASIGNADO</span>
                        <span className="tabular-nums font-semibold">{preasignadoCards.length}</span>
                      </div>
                      {preasignadoCards.length === 0 ? (
                        <div className="py-1 px-2 text-center text-[10px] font-mono text-zinc-400 opacity-40 italic select-none">
                          sin unidades
                        </div>
                      ) : (
                        preasignadoCards.map(renderUnitCard)
                      )}
                    </div>
                  </AutoScrollColumn>
                </section>
              );
            })}

            {/* Columna / Drop Zone para Dar Egreso y Terminar Proceso */}
            <section
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setIsDragOverEgreso(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setIsDragOverEgreso(false);
                }
              }}
              onDrop={handleDropOnEgreso}
              className={`h-full flex flex-col min-h-0 px-3 pt-2 pb-2 rounded-lg border-2 border-dashed transition-all ${
                isDragOverEgreso
                  ? 'border-rose-500 bg-rose-50 text-rose-950 scale-[1.01]'
                  : 'border-zinc-300/80 bg-zinc-200/50 text-zinc-600'
              }`}
            >
              <div className="mb-2 px-1 flex items-center justify-between gap-2 h-[38px] shrink-0">
                <div className="flex items-center gap-1.5 font-mono text-[13px] font-black uppercase text-zinc-800">
                  <LogOut className="w-4 h-4 text-zinc-600" />
                  <span>Egreso Planta</span>
                </div>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center p-4 text-center border border-zinc-300/60 rounded-lg bg-white/70">
                <CheckCircle2 className="w-8 h-8 text-zinc-400 mb-2" />
                <span className="text-xs font-bold text-zinc-800 uppercase tracking-wide">
                  Zona de Salida / Egreso
                </span>
                <p className="text-[11px] text-zinc-500 mt-1 leading-snug">
                  Arrastrá aquí una unidad para dar egreso definitivo de planta (archivado a procesos_cold).
                </p>
                <div className="mt-3 text-[10px] text-zinc-400 font-mono">
                  Liberación en PostgreSQL con salida_at
                </div>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Modal Deployed */}
      <UnitPlaneacionDeployedModal
        card={selectedCard}
        catalog={catalog}
        onClose={() => setSelectedProcesoId(null)}
        onUpdated={refresh}
        onAssignUsuarios={handleAssignUsuarios}
      />

      {/* Modal Nuevo Ingreso a Box directo */}
      <NewIngresoModal
        open={isNewIngresoOpen}
        catalog={catalog}
        onClose={() => setIsNewIngresoOpen(false)}
        onCreated={refresh}
      />
    </div>
  );
};
