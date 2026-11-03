import React, { useState } from 'react';
import { DailyHeaderControls } from './components/DailyHeaderControls';
import { DailyDriversFeed } from './components/DailyDriversFeed';
import { useDailyDrivers } from './hooks/useDailyDrivers';
import { FiltersSidebar } from './FiltersSidebar';
import { X, Calendar } from 'lucide-react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';

export const DailyDashboard = ({ isMobileFiltersOpen, onCloseMobileFilters, onNavigateToIndividual }) => {
  // Fecha de contexto: resuelta automáticamente en huso horario de Buenos Aires (Fecha Wipe)
  const [fechaContexto] = useState(() => {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  });

  const [filters, setFilters] = useState({
    search: '',
    estado: 'TODOS',
    servicio: 'TODOS',
    alerta: 'TODAS',
    retornan: false,
  });

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleResetFilters = () => {
    setFilters({
      search: '',
      estado: 'TODOS',
      servicio: 'TODOS',
      alerta: 'TODAS',
      retornan: false,
    });
  };

  const { data } = useDailyDrivers(filters, fechaContexto);
  const totalCount = data?.pages?.[0]?.totalCount ?? '...';

  return (
    <div className="daily-dashboard-wrapper">
      {/* 1. BARRA SUPERIOR DE CONTROLES (Fecha Wipe) */}
      <DailyHeaderControls
        filters={filters}
        onChangeFilter={handleFilterChange}
        totalCount={totalCount}
      />

      {/* 2. GRID PRINCIPAL: FEED DE CONDUCTORES + PANEL LATERAL DE FILTROS */}
      <div className="wireframe-container" style={{ marginTop: '1rem' }}>
        {/* Columna Principal: Grilla / Feed de Tarjetas de Choferes */}
        <section className="cards-column">
          <DailyDriversFeed
            fechaContexto={fechaContexto}
            filters={filters}
            onSelectDriver={onNavigateToIndividual}
          />
        </section>

        {/* Columna Lateral de Filtros Operativos (Escritorio) */}
        <aside className="filters-column desktop-only">
          <FiltersSidebar
            filters={filters}
            onFilterChange={handleFilterChange}
            onResetFilters={handleResetFilters}
          />
        </aside>

        {/* Drawer Móvil para Filtros (Headless UI Dialog) */}
        <Transition show={isMobileFiltersOpen}>
          <Dialog onClose={onCloseMobileFilters} style={{ position: 'relative', zIndex: 100 }}>
            <TransitionChild
              enter="ease-out duration-250"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="drawer-backdrop" />
            </TransitionChild>

            <TransitionChild
              enter="transform transition ease-out duration-300"
              enterFrom="translate-x-full"
              enterTo="translate-x-0"
              leave="transform transition ease-in duration-200"
              leaveFrom="translate-x-0"
              leaveTo="translate-x-full"
            >
              <DialogPanel className="drawer-panel">
                <div className="drawer-header">
                  <DialogTitle className="drawer-title">Filtros Operativos</DialogTitle>
                  <button onClick={onCloseMobileFilters} className="btn-icon-square" style={{ width: '32px', height: '32px' }}>
                    <X size={16} />
                  </button>
                </div>

                <div style={{ padding: '1rem' }}>
                  <FiltersSidebar
                    filters={filters}
                    onFilterChange={handleFilterChange}
                    onResetFilters={handleResetFilters}
                  />
                </div>
              </DialogPanel>
            </TransitionChild>
          </Dialog>
        </Transition>
      </div>
    </div>
  );
};
