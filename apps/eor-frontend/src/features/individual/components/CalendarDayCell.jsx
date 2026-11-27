import React from 'react';
import { getNovedadCode } from '@/utils/diagramaUtils';

export const CalendarDayCell = ({
  dayNum,
  isoStr,
  rawStatus,
  isSelected,
  isToday,
  hasKm,
  km = 0,
  hr = '',
  kmTooltip,
  onClick,
}) => {
  const getStatusClass = (val) => {
    const code = getNovedadCode(val);
    if (code === 'act' && val) {
      const num = parseInt(String(val).trim(), 10);
      if (!isNaN(num)) {
        if (num >= 22) return 'novedad-act fatiga-crit';
        if (num >= 18) return 'novedad-act fatiga-warn';
      }
    }
    return `novedad-${code}`;
  };

  const statusClass = getStatusClass(rawStatus);

  return (
    <div
      onClick={(e) => onClick(isoStr, e)}
      className={`calendar-day-cell ${statusClass} ${isSelected ? 'selected' : ''}`}
      style={{
        boxShadow: isToday ? '0 0 0 2px var(--primary)' : undefined,
      }}
      title={kmTooltip ? `Fecha: ${isoStr} | Estado: ${rawStatus || 'Sin registro'} | Viaje: ${kmTooltip}` : `Fecha: ${isoStr} | Estado: ${rawStatus || 'Sin registro'}`}
    >
      {/* Número de día en la esquina superior izquierda */}
      <span className="day-corner-number">{dayNum}</span>

      {/* Valor operativo central (1..35, F, V, etc.) */}
      <span className="day-status-value">
        {rawStatus || ''}
      </span>

      {/* Indicador de Kilómetros / Viaje: Dot sutil */}
      {hasKm && <span className="day-dot-km" title={kmTooltip || "Tiene viajes registrados en esta fecha"} />}
    </div>
  );
};
