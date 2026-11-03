import React from 'react';
import { Search, Filter, X, ShieldAlert, Truck } from 'lucide-react';

export const FiltersSidebar = ({ filters, onFilterChange, onResetFilters }) => {
  const servicios = ['TODOS', 'METANOL', 'LIVIANO', 'CAMPO', 'GLP', 'YPF', 'GRALES.'];

  const estadosGrid = [
    // Fila 1: Descansos y Trabajo
    { id: 'F', label: 'F', title: 'Francos (F)' },
    { id: 'FSF', label: 'FSF', title: 'Franco Sin Franco' },
    { id: 'V', label: 'V', title: 'Vacaciones (V)' },
    { id: 'VSF', label: 'VSF', title: 'Vacaciones Sin Franco' },
    { id: 'ACT', label: 'ACT', title: 'Activos (Trabajando)' },
    // Fila 2: Novedades / Ausencias
    { id: 'E', label: 'E', title: 'Enfermedad' },
    { id: 'ART', label: 'ART', title: 'Accidente Laboral / ART' },
    { id: 'IND', label: 'IND', title: 'Indispuesto' },
    { id: 'S', label: 'S', title: 'Suspensión' },
    { id: 'A', label: 'A', title: 'Ausente' },
  ];

  const alertas = [
    { id: 'TODAS', label: 'Sin filtro de alerta' },
    { id: 'DOCS_VENCIDOS', label: '🔴 Documentación Chofer Vencida' },
    { id: 'DOCS_POR_VENCER', label: '🟡 Docs Chofer por Vencer (1 mes)' },
    { id: 'UNIDAD_VENCIDA', label: '🚚 Unidad (VTV/MASS) Vencida' },
    { id: 'UNIDAD_POR_VENCER', label: '🟡 Unidad por Vencer (1 mes)' },
    { id: 'CUALQUIER_ALERTA', label: '⚠️ Cualquier Alerta Activa' },
  ];

  return (
    <div className="filters-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Cabecera de Filtros */}
      <div className="filters-header">
        <h3 className="filters-heading">
          <Filter size={16} />
          <span>Filtros Operativos</span>
        </h3>
        <button
          onClick={onResetFilters}
          className="btn-clear-filters"
          title="Restablecer todos los filtros"
        >
          Limpiar
        </button>
      </div>

      {/* Buscador de Chofer, Tractor, Semi o UTE */}
      <div className="filter-search-box">
        <Search size={15} className="filter-search-icon" />
        <input
          type="text"
          className="filter-search-input"
          placeholder="Buscar chofer, tractor, semi, UTE..."
          value={filters.search || ''}
          onChange={(e) => onFilterChange('search', e.target.value)}
        />
        {filters.search && (
          <button
            onClick={() => onFilterChange('search', '')}
            style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Filtro Principal: Personal que Retorna */}
      <div className="filter-section">
        <button
          type="button"
          onClick={() => onFilterChange('retornan', !filters.retornan)}
          className={`filter-chip-btn btn-filter-retorno ${filters.retornan ? 'active' : ''}`}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.6rem 0.85rem',
            fontWeight: 800,
            fontSize: '0.8rem',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          title="Mostrar únicamente choferes con retorno programado o que retornan hoy"
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span>🔄</span>
            <span>Personal que Retorna</span>
          </span>
          {filters.retornan && <span style={{ fontSize: '0.75rem' }}>✓</span>}
        </button>
      </div>

      {/* Filtro por Estado Operativo del Día (Grilla 5x2) */}
      <div className="filter-section">
        <span className="filter-label">Estado del Día</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
          {/* Botón Principal: Todos los Estados */}
          <button
            type="button"
            onClick={() => onFilterChange('estado', 'TODOS')}
            className={`filter-chip-btn ${(filters.estado || 'TODOS') === 'TODOS' ? 'active' : ''}`}
            style={{ width: '100%', textAlign: 'left', padding: '0.55rem 0.75rem', borderRadius: 'var(--radius-sm)' }}
          >
            Todos los estados
          </button>

          {/* Micro-Grilla 5x2 de Estados */}
          <div className="filter-states-grid-5x2">
            {estadosGrid.map((st) => {
              const isSelected = filters.estado === st.id;
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => onFilterChange('estado', isSelected ? 'TODOS' : st.id)}
                  className={`filter-state-chip chip-${st.id} ${isSelected ? 'active' : ''}`}
                  title={st.title}
                >
                  {st.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Filtro por Alertas de Vencimiento */}
      <div className="filter-section">
        <span className="filter-label">Alertas de Vencimiento</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {alertas.map((al) => {
            const isSelected = (filters.alerta || 'TODAS') === al.id;
            return (
              <button
                key={al.id}
                onClick={() => onFilterChange('alerta', al.id)}
                className={`filter-chip-btn ${isSelected ? 'active' : ''}`}
                style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)' }}
              >
                {al.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filtro por Servicio */}
      <div className="filter-section">
        <span className="filter-label">Servicio</span>
        <div className="filter-chips-grid">
          {servicios.map((srv) => {
            const isSelected = (filters.servicio || 'TODOS') === srv;
            return (
              <button
                key={srv}
                onClick={() => onFilterChange('servicio', srv)}
                className={`filter-chip-btn ${isSelected ? 'active' : ''}`}
              >
                {srv}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
