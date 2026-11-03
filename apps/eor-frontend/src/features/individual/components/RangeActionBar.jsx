import React, { useEffect } from 'react';
import { CalendarRange, X, Route } from 'lucide-react';

export const RangeActionBar = ({
  selectedRange,
  rangeKm = 0,
  tripsCount = 0,
  onClear,
  onAssignStatus,
  isPending = false,
}) => {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClear();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClear]);

  if (!selectedRange || !selectedRange.startIso || !selectedRange.endIso) return null;

  const { startIso, endIso } = selectedRange;
  const minIso = startIso <= endIso ? startIso : endIso;
  const maxIso = startIso <= endIso ? endIso : startIso;

  const d1 = new Date(minIso + 'T12:00:00');
  const d2 = new Date(maxIso + 'T12:00:00');
  const diffTime = Math.abs(d2 - d1);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

  const formatShort = (iso) => {
    const parts = iso.split('-');
    return `${parts[2]}/${parts[1]}`;
  };

  return (
    <div className="range-action-bar-floating">
      {/* 1. Información de Fechas y KMs en Rango */}
      <div className="range-info-text">
        <CalendarRange size={18} style={{ color: 'var(--primary)', flexShrink: 0 }} />
        <span>
          {diffDays} {diffDays === 1 ? 'día seleccionado' : 'días seleccionados'} ({formatShort(minIso)}{diffDays > 1 ? ` al ${formatShort(maxIso)}` : ''})
        </span>

        {/* Píldora de Kilómetros en Rango */}
        <div className="range-km-pill" title="Kilómetros acumulados en el rango seleccionado">
          <Route size={14} style={{ color: 'currentColor', flexShrink: 0 }} />
          <span>
            <strong>{rangeKm.toLocaleString('es-AR')}</strong> km en rango
          </span>
          {tripsCount > 0 && (
            <span className="range-trips-sub">
              ({tripsCount} {tripsCount === 1 ? 'viaje' : 'viajes'})
            </span>
          )}
        </div>
      </div>

      {/* 2. Controles de Asignación con Optimistic UI */}
      <div className="range-actions-btns">
        {/* Botones Presets Rápidos */}
        <button
          type="button"
          onClick={() => onAssignStatus('ACTIVO')}
          disabled={isPending}
          className="btn-range-action btn-range-activo"
          title="Asignar Día Activo (correlativo numérico continuo 1..35)"
        >
          Día Activo
        </button>

        <button
          type="button"
          onClick={() => onAssignStatus('F')}
          disabled={isPending}
          className="btn-range-action btn-range-franco"
          title="Asignar Franco (F) en este rango"
        >
          Franco (F)
        </button>

        <button
          type="button"
          onClick={() => onAssignStatus('FSF')}
          disabled={isPending}
          className="btn-range-action btn-range-fsf"
          title="Asignar Franco Sin Firmar (FSF) en este rango"
        >
          Franco (FSF)
        </button>

        <button
          type="button"
          onClick={() => onAssignStatus('V')}
          disabled={isPending}
          className="btn-range-action btn-range-vacaciones"
          title="Asignar Vacaciones (V) en este rango"
        >
          Vacaciones (V)
        </button>

        <button
          type="button"
          onClick={() => onAssignStatus('E')}
          disabled={isPending}
          className="btn-range-action btn-range-licencia"
          title="Asignar Licencia Médica / Ausencia (E)"
        >
          Licencia (E)
        </button>

        <button
          type="button"
          onClick={() => onAssignStatus('-')}
          disabled={isPending}
          className="btn-range-action btn-range-limpiar"
          title="Limpiar asignación del rango (-)"
        >
          Limpiar (-)
        </button>

        <button
          type="button"
          onClick={onClear}
          className="btn-range-action btn-range-clear"
          title="Deseleccionar rango (<Esc>)"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};
