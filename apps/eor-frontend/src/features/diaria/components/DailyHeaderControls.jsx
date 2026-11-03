import React from 'react';
import { Search } from 'lucide-react';

export const DailyHeaderControls = ({
  filters,
  onChangeFilter,
  totalCount,
}) => {
  const servicios = ['TODOS', 'METANOL', 'LIVIANO', 'CAMPO', 'GLP', 'YPF', 'ABASTECEDORES'];

  return (
    <div className="daily-controls-bar">
      {/* 1. Buscador Reactivo (Fecha Wipe: inicia al frente sin selector manual) */}
      <div className="filter-search-box" style={{ maxWidth: '380px', flex: 1 }}>
        <Search size={15} className="filter-search-icon" />
        <input
          type="text"
          placeholder="Buscar chofer, tractor, semi, UTE..."
          value={filters.search}
          onChange={(e) => onChangeFilter('search', e.target.value)}
          className="filter-search-input"
        />
      </div>

      {/* 2. Selector de Servicio */}
      <div className="select-service-wrapper">
        <select
          value={filters.servicio}
          onChange={(e) => onChangeFilter('servicio', e.target.value)}
          className="select-service-input"
        >
          {servicios.map((s) => (
            <option key={s} value={s}>
              {s === 'TODOS' ? 'Todos los Servicios' : s}
            </option>
          ))}
        </select>
      </div>

      {/* 3. Contador de Choferes */}
      <div className="daily-count-badge">
        <span>{totalCount} Conductores</span>
      </div>
    </div>
  );
};
