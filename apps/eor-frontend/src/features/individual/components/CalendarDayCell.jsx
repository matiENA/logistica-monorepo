import React from 'react';

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
    if (!val) return 'status-default';
    const v = val.trim().toUpperCase();

    if (v === 'FSF' || v.startsWith('FSF')) return 'status-fsf';
    if (v === 'F' || v.startsWith('F')) return 'status-franco';
    if (v === 'V' || v.startsWith('V')) return 'status-vacaciones';
    if (v === 'IND' || v.startsWith('IND')) return 'status-ind';
    if (['E', 'ART', 'S', 'A', 'MED'].some((k) => v.includes(k))) return 'status-ausencia';

    // Activo / Operativo ('O', 'OPERATIVO', 'ACTIVO')
    if (v === 'O' || v.startsWith('O') || v === 'ACTIVO') return 'status-activo';

    // Si es un número operativo consecutivo (1..35)
    const num = parseInt(v, 10);
    if (!isNaN(num)) {
      if (num >= 22) return 'fatiga-crit';
      if (num >= 18) return 'fatiga-warn';
      return 'fatiga-normal';
    }

    return 'status-default';
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
