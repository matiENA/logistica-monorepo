import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search, ArrowUpDown } from 'lucide-react';
import {
  CoordKanbanCard,
  StaffMember,
  fetchCoordStaffList,
  fetchKanbanProgreso,
  fetchKanbanTerminados,
  subscribeCoordinacionRealtime,
} from '../services/coordinacionApi';
import {
  SECTOR_COLUMNS,
  SectorColumnId,
  resolveSectorColumn,
} from '../config/sectorGroups';
import { UnitKanbanCard } from '../components/coordinacion/UnitKanbanCard';
import { UnitTasksModal } from '../components/coordinacion/UnitTasksModal';
import { AutoScrollSectorColumn } from '../components/coordinacion/AutoScrollSectorColumn';

type TabMode = 'progreso' | 'terminados';
type SortDirection = 'desc' | 'asc';

export const MonitorCoordinacion: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabMode>('progreso');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [progresoCards, setProgresoCards] = useState<CoordKanbanCard[]>([]);
  const [terminadosCards, setTerminadosCards] = useState<CoordKanbanCard[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [hoveredSectorId, setHoveredSectorId] = useState<string | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);

  // Título de la pestaña de navegación: Coordinación a secas
  useEffect(() => {
    document.title = 'Coordinación';
    try {
      if (window.top && window.top !== window) {
        window.top.document.title = 'Coordinación';
      }
    } catch (e) {}
  }, []);

  const loadBoardData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setIsRefreshing(true);

    try {
      const [prog, term] = await Promise.all([
        fetchKanbanProgreso(),
        fetchKanbanTerminados(),
      ]);
      setProgresoCards(prog);
      setTerminadosCards(term);
    } catch (err) {
      console.error('[MonitorCoordinacion] Error cargando tablero:', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadBoardData(false);
    fetchCoordStaffList().then(setStaffList);

    const unsubscribe = subscribeCoordinacionRealtime(() => {
      loadBoardData(true);
    });

    return () => {
      unsubscribe();
    };
  }, [loadBoardData]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setIsSortMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeSourceCards = activeTab === 'progreso' ? progresoCards : terminadosCards;

  const filteredCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeSourceCards;
    return activeSourceCards.filter(
      (c) =>
        c.tractor_plate.toLowerCase().includes(q) ||
        c.semi_plate.toLowerCase().includes(q) ||
        c.tractor_ot.toLowerCase().includes(q) ||
        c.semi_ot.toLowerCase().includes(q) ||
        c.worker_name.toLowerCase().includes(q) ||
        (c.n_ute && c.n_ute.toLowerCase().includes(q))
    );
  }, [activeSourceCards, searchQuery]);

  const cardsByColumn = useMemo(() => {
    if (activeTab !== 'progreso') {
      return {
        INACTIVOS: [],
        SERVICIOS: [],
        ENA: [],
        MOTORES: [],
        VTV_MASS: [],
        TALLER: [],
      };
    }

    const map: Record<SectorColumnId, CoordKanbanCard[]> = {
      INACTIVOS: [],
      SERVICIOS: [],
      ENA: [],
      MOTORES: [],
      VTV_MASS: [],
      TALLER: [],
    };

    for (const card of filteredCards) {
      const colId = resolveSectorColumn({
        hasActiveTask: card.has_active_task,
        workerRole: card.worker_role,
        taskSector: card.active_task_sector,
      });
      map[colId].push(card);
    }

    for (const colId of Object.keys(map) as SectorColumnId[]) {
      map[colId].sort((a, b) => {
        const diff =
          sortDirection === 'desc'
            ? b.combined_avg - a.combined_avg
            : a.combined_avg - b.combined_avg;
        if (diff !== 0) return diff;
        return (a.tractor_ot || a.semi_ot).localeCompare(b.tractor_ot || b.semi_ot);
      });
    }

    return map;
  }, [filteredCards, activeTab, sortDirection]);

  // Auditoría en TERMINADOS: Separación 100% vs incompleto
  const { sortedCards100, sortedCardsIncomplete } = useMemo(() => {
    if (activeTab !== 'terminados') {
      return { sortedCards100: [], sortedCardsIncomplete: [] };
    }

    const c100: CoordKanbanCard[] = [];
    const cInc: CoordKanbanCard[] = [];

    for (const card of filteredCards) {
      if (Math.round(card.combined_avg) === 100) {
        c100.push(card);
      } else {
        cInc.push(card);
      }
    }

    // Incompletos: ordenados por porcentaje y fecha
    cInc.sort((a, b) => {
      const diff =
        sortDirection === 'desc'
          ? b.combined_avg - a.combined_avg
          : a.combined_avg - b.combined_avg;
      if (diff !== 0) return diff;
      const dateA = a.active_termino || a.close_date || '';
      const dateB = b.active_termino || b.close_date || '';
      return dateB.localeCompare(dateA);
    });

    // 100%: ordenados por fecha y OT
    c100.sort((a, b) => {
      const dateA = a.active_termino || a.close_date || '';
      const dateB = b.active_termino || b.close_date || '';
      const dateDiff =
        sortDirection === 'desc'
          ? dateB.localeCompare(dateA)
          : dateA.localeCompare(dateB);
      if (dateDiff !== 0) return dateDiff;
      return (a.tractor_ot || a.semi_ot).localeCompare(b.tractor_ot || b.semi_ot);
    });

    return { sortedCards100: c100, sortedCardsIncomplete: cInc };
  }, [filteredCards, activeTab, sortDirection]);

  const selectedCard = useMemo(
    () => activeSourceCards.find((c) => c.card_id === selectedCardId) || null,
    [activeSourceCards, selectedCardId]
  );

  return (
    <div className="h-screen w-full bg-[#EDEDED] text-zinc-950 flex flex-col font-sans select-none overflow-hidden">
      {/* BARRA SUPERIOR: TABS (PROGRESO / TERMINADOS) + BUSCADOR + BOTÓN ORDENAMIENTO */}
      <header className="w-full px-4 md:px-8 pt-6 pb-3 flex flex-col gap-3 shrink-0">
        <div className="relative flex items-center justify-center min-h-[44px]">
          {/* Buscador rápido a la izquierda */}
          <div className="hidden md:flex items-center gap-2 absolute left-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-600 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Patente, OT u operario..."
                aria-label="Buscar unidad por patente, orden de trabajo u operario"
                className="pl-8 pr-3 py-1.5 bg-white/90 border border-zinc-300 rounded-full text-xs text-zinc-900 placeholder:text-zinc-500 focus:outline-hidden focus:border-zinc-800 focus:ring-2 focus:ring-zinc-900/10 w-52 transition-all"
              />
            </div>
            <button
              type="button"
              onClick={() => loadBoardData(true)}
              title="Actualizar desde Supabase"
              aria-label="Actualizar tablero de coordinación"
              className="w-8 h-8 rounded-full bg-white border border-zinc-300 flex items-center justify-center text-zinc-700 hover:text-zinc-950 hover:border-zinc-600 focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:outline-hidden transition-all active:scale-95 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Tabs centrales: PROGRESO / TERMINADOS */}
          <nav role="tablist" aria-label="Modo de vista del tablero" className="flex items-center gap-8 md:gap-12">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'progreso'}
              aria-controls="panel-kanban"
              onClick={() => {
                setActiveTab('progreso');
                setSelectedCardId(null);
              }}
              className={`text-xl md:text-[26px] tracking-[0.14em] uppercase transition-all duration-200 cursor-pointer rounded-lg px-2 py-1 focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:outline-hidden ${
                activeTab === 'progreso'
                  ? 'font-extrabold text-zinc-950 scale-100'
                  : 'font-semibold text-zinc-600 hover:text-zinc-950 hover:opacity-100'
              }`}
            >
              PROGRESO
              <span className="ml-1.5 text-xs align-super font-bold opacity-80">
                ({progresoCards.length})
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'terminados'}
              aria-controls="panel-kanban"
              onClick={() => {
                setActiveTab('terminados');
                setSelectedCardId(null);
              }}
              className={`text-xl md:text-[26px] tracking-[0.14em] uppercase transition-all duration-200 cursor-pointer rounded-lg px-2 py-1 focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:outline-hidden ${
                activeTab === 'terminados'
                  ? 'font-extrabold text-zinc-950 scale-100'
                  : 'font-semibold text-zinc-600 hover:text-zinc-950 hover:opacity-100'
              }`}
            >
              TERMINADOS
              <span className="ml-1.5 text-xs align-super font-bold opacity-80">
                ({terminadosCards.length})
              </span>
            </button>
          </nav>

          {/* Botón arriba a la derecha: Filtro de ordenamiento por porcentaje */}
          <div className="absolute right-0 flex items-center gap-2" ref={sortMenuRef}>
            <button
              type="button"
              onClick={() => setIsSortMenuOpen((prev) => !prev)}
              aria-expanded={isSortMenuOpen}
              aria-haspopup="menu"
              aria-label={`Ordenar por porcentaje (actualmente: ${sortDirection === 'desc' ? 'Mayor a menor' : 'Menor a mayor'})`}
              title={`Ordenar por porcentaje (${
                sortDirection === 'desc' ? 'Mayor a menor' : 'Menor a mayor'
              })`}
              className="w-8 h-8 rounded-full bg-white shadow-xs border border-zinc-300 hover:border-zinc-600 flex items-center justify-center transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:outline-hidden active:scale-95"
            >
              <ArrowUpDown className="w-3.5 h-3.5 text-zinc-900" />
            </button>

            {isSortMenuOpen && (
              <div
                role="menu"
                aria-label="Opciones de ordenamiento"
                className="absolute right-0 top-10 z-40 w-60 bg-white border border-zinc-900 rounded-xl shadow-xl p-1.5 flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-100"
              >
                <div className="px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">
                  Ordenar Cards por % Completado
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSortDirection('desc');
                    setIsSortMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold flex items-center justify-between transition-colors focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:outline-hidden ${
                    sortDirection === 'desc'
                      ? 'bg-zinc-950 text-white'
                      : 'text-zinc-800 hover:bg-zinc-100'
                  }`}
                >
                  <span>Mayor a menor (100% → 0%)</span>
                  <span>▼</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSortDirection('asc');
                    setIsSortMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold flex items-center justify-between transition-colors focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:outline-hidden ${
                    sortDirection === 'asc'
                      ? 'bg-zinc-950 text-white'
                      : 'text-zinc-800 hover:bg-zinc-100'
                  }`}
                >
                  <span>Menor a mayor (0% → 100%)</span>
                  <span>▲</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* TABLERO KANBAN DE 6 COLUMNAS (FASE 1) */}
      <main id="panel-kanban" tabIndex={-1} className="flex-1 min-h-0 w-full px-3 md:px-6 pb-3 flex flex-col focus:outline-hidden">
        {loading ? (
          <div className="flex-1 flex items-center justify-center py-24">
            <div className="flex flex-col items-center gap-3 text-zinc-700">
              <RefreshCw className="w-7 h-7 animate-spin text-zinc-950" />
              <span className="text-sm font-bold">Cargando tablero de coordinación...</span>
            </div>
          </div>
        ) : activeTab === 'progreso' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 flex-1 min-h-0 h-full">
            {SECTOR_COLUMNS.map((col, idx) => {
              const colCards = cardsByColumn[col.id] || [];
              const isLast = idx === SECTOR_COLUMNS.length - 1;

              return (
                <section
                  key={col.id}
                  aria-labelledby={`col-header-${col.id}`}
                  onMouseEnter={() => setHoveredSectorId(col.id)}
                  onMouseLeave={() => setHoveredSectorId(null)}
                  className={`h-full flex flex-col min-h-0 px-2.5 pt-2 pb-2 ${
                    !isLast
                      ? 'xl:border-r-[3px] xl:border-dashed xl:border-amber-400 border-b xl:border-b-0 border-zinc-300/80'
                      : ''
                  }`}
                >
                  {/* Header de Columna: Zonas en la misma fila con altura consistente y sin quiebres */}
                  <div className="mb-3 px-1 flex items-start justify-between gap-2 h-[50px] shrink-0">
                    <div className="flex flex-col min-w-0 pr-1">
                      <h2
                        id={`col-header-${col.id}`}
                        className="text-[15px] xl:text-[17px] 2xl:text-[18px] leading-tight font-extrabold tracking-tight text-zinc-950 lowercase whitespace-nowrap overflow-hidden text-ellipsis"
                        style={{ fontFamily: '"JetBrains Mono", "Share Tech Mono", monospace' }}
                        title={col.title}
                      >
                        {col.title}
                      </h2>
                      {col.subtitle && (
                        <span
                          className="text-[9px] font-bold uppercase tracking-wider text-zinc-600 mt-1 whitespace-nowrap overflow-hidden text-ellipsis"
                          title={col.subtitle}
                        >
                          {col.subtitle}
                        </span>
                      )}
                    </div>
                    <span
                      aria-label={`${colCards.length} unidades`}
                      className="text-xs font-mono font-bold text-zinc-700 bg-white border border-zinc-300 rounded-full px-2 py-0.5 shrink-0 shadow-2xs"
                    >
                      {colCards.length}
                    </span>
                  </div>

                  {/* Lista de Cards con Auto-scroll independiente por sector y scroll manual sin barra */}
                  <AutoScrollSectorColumn
                    itemsCount={colCards.length}
                    isSectorHovered={hoveredSectorId === col.id}
                    isExternalPaused={selectedCardId !== null}
                    ariaLabel={`Sector ${col.title}`}
                    className="flex flex-col gap-3 pr-0.5"
                  >
                    {colCards.map((card) => (
                      <UnitKanbanCard
                        key={card.card_id}
                        card={card}
                        mode="progreso"
                        onClick={(c) => setSelectedCardId(c.card_id)}
                      />
                    ))}
                  </AutoScrollSectorColumn>
                </section>
              );
            })}
          </div>
        ) : (
          /* TABLERO DE AUDITORÍA TERMINADOS: 100% vs INCOMPLETO (SIN CABECERAS DE SECTOR NI 6 COLUMNAS) */
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row h-full w-full">
            {/* SECCIÓN 100% */}
            <section
              aria-labelledby="section-100-title"
              onMouseEnter={() => setHoveredSectorId('terminados-100')}
              onMouseLeave={() => setHoveredSectorId(null)}
              className="flex-1 h-full min-h-0 flex flex-col px-3 md:px-5 pt-2 pb-2 lg:border-r-[3px] lg:border-dashed lg:border-amber-400 border-b lg:border-b-0 border-zinc-300/80"
            >
              <div className="mb-3 px-1 flex items-start justify-between gap-2 h-[50px] shrink-0">
                <div className="flex items-baseline gap-2">
                  <h2
                    id="section-100-title"
                    className="text-[26px] md:text-[30px] leading-tight font-extrabold tracking-tight text-zinc-950"
                    style={{ fontFamily: '"JetBrains Mono", "Share Tech Mono", monospace' }}
                  >
                    100%
                  </h2>
                </div>
                <span
                  aria-label={`${sortedCards100.length} unidades 100% completadas`}
                  className="text-xs font-mono font-bold text-zinc-700 bg-white border border-zinc-300 rounded-full px-2.5 py-0.5 shrink-0 shadow-2xs"
                >
                  {sortedCards100.length}
                </span>
              </div>

              <AutoScrollSectorColumn
                itemsCount={sortedCards100.length}
                isSectorHovered={hoveredSectorId === 'terminados-100'}
                isExternalPaused={selectedCardId !== null}
                ariaLabel="Unidades 100% completadas"
                className="flex-1 min-h-0"
              >
                {sortedCards100.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-xs text-zinc-600 font-medium py-12">
                    Sin unidades 100% completadas en los últimos 7 días
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3 pr-1 pb-2">
                    {sortedCards100.map((card) => (
                      <UnitKanbanCard
                        key={card.card_id}
                        card={card}
                        mode="terminados"
                        onClick={(c) => setSelectedCardId(c.card_id)}
                      />
                    ))}
                  </div>
                )}
              </AutoScrollSectorColumn>
            </section>

            {/* SECCIÓN INCOMPLETO */}
            <section
              aria-labelledby="section-incomplete-title"
              onMouseEnter={() => setHoveredSectorId('terminados-incomplete')}
              onMouseLeave={() => setHoveredSectorId(null)}
              className="flex-1 h-full min-h-0 flex flex-col px-3 md:px-5 pt-2 pb-2 lg:pl-6"
            >
              <div className="mb-3 px-1 flex items-start justify-between gap-2 h-[50px] shrink-0">
                <div className="flex items-baseline gap-2">
                  <h2
                    id="section-incomplete-title"
                    className="text-[26px] md:text-[30px] leading-tight font-extrabold tracking-tight text-zinc-950 lowercase"
                    style={{ fontFamily: '"JetBrains Mono", "Share Tech Mono", monospace' }}
                  >
                    incompleto
                  </h2>
                </div>
                <span
                  aria-label={`${sortedCardsIncomplete.length} unidades incompletas`}
                  className="text-xs font-mono font-bold text-zinc-700 bg-white border border-zinc-300 rounded-full px-2.5 py-0.5 shrink-0 shadow-2xs"
                >
                  {sortedCardsIncomplete.length}
                </span>
              </div>

              <AutoScrollSectorColumn
                itemsCount={sortedCardsIncomplete.length}
                isSectorHovered={hoveredSectorId === 'terminados-incomplete'}
                isExternalPaused={selectedCardId !== null}
                ariaLabel="Unidades incompletas"
                className="flex-1 min-h-0"
              >
                {sortedCardsIncomplete.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-xs text-zinc-600 font-medium py-12">
                    Sin unidades incompletas registradas
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3 pr-1 pb-2">
                    {sortedCardsIncomplete.map((card) => (
                      <UnitKanbanCard
                        key={card.card_id}
                        card={card}
                        mode="terminados"
                        onClick={(c) => setSelectedCardId(c.card_id)}
                      />
                    ))}
                  </div>
                )}
              </AutoScrollSectorColumn>
            </section>
          </div>
        )}
      </main>

      {/* MODAL DESPLEGABLE DE TAREAS (TRACTOR + SEMI) */}
      <UnitTasksModal
        card={selectedCard}
        mode={activeTab}
        staffList={staffList}
        onClose={() => setSelectedCardId(null)}
        onTaskUpdated={() => loadBoardData(true)}
      />
    </div>
  );
};

export default MonitorCoordinacion;
