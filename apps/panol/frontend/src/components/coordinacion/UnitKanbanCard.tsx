import React from 'react';
import { User, MapPin } from 'lucide-react';
import { CoordKanbanCard } from '../../services/coordinacionApi';

interface UnitKanbanCardProps {
  card: CoordKanbanCard;
  onClick: (card: CoordKanbanCard) => void;
  mode?: 'progreso' | 'terminados';
}

/**
 * Formatea una fecha en formato hispano dd/mm (sin año)
 */
export function formatHispanicDate(value: string | null | undefined): string {
  if (!value || !String(value).trim()) return '—';
  const raw = String(value).trim();
  const pre = raw.match(/^(\d{2}\/\d{2})/);
  if (pre) return pre[1];
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

/**
 * Formatea el porcentaje: en modo terminados agrega cero a la izquierda para cifras de un dígito (00%, 01%)
 */
export function formatPercentageDisplay(value: number, mode?: 'progreso' | 'terminados'): string {
  const rounded = Math.round(value);
  if (mode === 'terminados' && rounded >= 0 && rounded < 10) {
    return `0${rounded}%`;
  }
  return `${rounded}%`;
}

/**
 * Prioriza la ubicación asignada a la tarea/box donde se trabajó la unidad,
 * con fallback a los default_boxes del operario para saber dónde está en base.
 */
export function formatUnitLocation(
  taskUbicacion?: string | null,
  workerBoxes?: string[] | null
): string {
  if (taskUbicacion && taskUbicacion.trim()) {
    const clean = taskUbicacion.trim();
    return /^\d+$/.test(clean) ? `Box ${clean}` : clean;
  }
  if (Array.isArray(workerBoxes) && workerBoxes.length > 0) {
    const clean = workerBoxes.map((b) => String(b || '').trim()).filter(Boolean);
    if (clean.length > 0) {
      return clean.map((b) => (/^\d+$/.test(b) ? `Box ${b}` : b)).join(' · ');
    }
  }
  return '—';
}

/**
 * Formatea una patente argentina agregando espacios legibles (ej. AD337AV -> AD 337 AV, LEM785 -> LEM 785)
 */
export function formatPlateDisplay(raw: string): string {
  const clean = (raw || '').replace(/[\s-]/g, '').toUpperCase();
  if (!clean) return '---';
  const mercosur = clean.match(/^([A-Z]{2})(\d{3})([A-Z]{2})$/);
  if (mercosur) {
    return `${mercosur[1]} ${mercosur[2]} ${mercosur[3]}`;
  }
  const nacional = clean.match(/^([A-Z]{3})(\d{3})$/);
  if (nacional) {
    return `${nacional[1]} ${nacional[2]}`;
  }
  return clean;
}

const PlateWithOtBadge: React.FC<{
  plate: string;
  ot: string;
  label: string;
}> = ({ plate, ot, label }) => {
  const hasPlate = Boolean(plate && plate.trim() !== '');
  const formattedPlate = hasPlate ? formatPlateDisplay(plate) : '---';
  const displayOt = ot && ot.trim() !== '' ? ot.trim() : '--';

  return (
    <div className="flex flex-col items-center w-[112px]" title={`${label}: ${formattedPlate} (OT ${displayOt})`}>
      {/* Pill superior con número de OT */}
      <div className="z-10 -mb-[5px] bg-white border border-zinc-800 rounded-[4px] px-2.5 py-[1px] text-[10px] leading-tight font-semibold text-zinc-900 shadow-xs min-w-[54px] text-center">
        {displayOt}
      </div>

      {/* Chapa patente con franja azul superior */}
      <div className="w-full bg-white border-[1.5px] border-zinc-800 rounded-[5px] overflow-hidden shadow-xs">
        <div className="w-full h-[5px] bg-[#0046B8]" />
        <div
          className={`w-full text-center py-1 px-1 text-[13px] leading-tight font-extrabold tracking-tight whitespace-nowrap ${
            hasPlate ? 'text-zinc-950' : 'text-zinc-500'
          }`}
          style={{ fontFamily: '"FE-Font", "FE-FONT", "Inter", sans-serif' }}
        >
          {formattedPlate}
        </div>
      </div>
    </div>
  );
};

export const UnitKanbanCard: React.FC<UnitKanbanCardProps> = ({
  card,
  onClick,
  mode = 'progreso',
}) => {
  const operarioLabel = card.worker_name && card.worker_name.trim() !== ''
    ? card.worker_name
    : 'Sin asignar';

  const ubicacionLabel = formatUnitLocation(
    card.active_task_ubicacion,
    card.worker_default_boxes
  );

  const fechaUltima = formatHispanicDate(card.active_termino || card.close_date);

  return (
    <div
      onClick={() => onClick(card)}
      role="button"
      tabIndex={0}
      aria-label={`Unidad ${card.n_ute ? '#' + card.n_ute + ' ' : ''}con Tractor ${card.tractor_plate || 'sin patente'} y Semi ${card.semi_plate || 'sin patente'}, avance ${Math.round(card.combined_avg)} por ciento. Clic para ver tareas.`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(card);
        }
      }}
      className="group bg-white rounded-[6px] border border-zinc-300/90 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-md hover:border-zinc-500 transform transition-all duration-200 ease-out hover:-translate-y-0.5 active:scale-[0.985] active:translate-y-0 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 focus-visible:outline-hidden p-2.5 cursor-pointer select-none flex items-center justify-between gap-2.5 motion-reduce:transform-none motion-reduce:transition-none"
    >
      {/* Columna Izquierda: Par de Patentes (Tractor arriba, Semi abajo) */}
      <div className="flex flex-col gap-1.5 shrink-0">
        <PlateWithOtBadge
          plate={card.tractor_plate}
          ot={card.tractor_ot}
          label="Tractor"
        />
        <PlateWithOtBadge
          plate={card.semi_plate}
          ot={card.semi_ot}
          label="Semi"
        />
      </div>

      {/* Columna Derecha: Porcentaje + (Fecha en terminados) + Operario + Ubicación */}
      <div className="flex flex-col justify-between items-start min-w-0 flex-1 self-stretch py-0.5">
        <div className="w-full text-left">
          <span className="text-[28px] leading-none font-black tracking-tight text-zinc-950 font-mono">
            {formatPercentageDisplay(card.combined_avg, mode)}
          </span>
        </div>

        <div className="flex flex-col gap-0.5 w-full min-w-0 mt-auto pt-1">
          {mode === 'terminados' && (
            <div
              className="text-[11px] font-semibold text-zinc-600 leading-tight mb-0.5"
              title={`Fecha última: ${fechaUltima}`}
            >
              {fechaUltima}
            </div>
          )}

          <div
            className="flex items-center gap-1 text-[10px] leading-tight text-zinc-800 font-medium truncate"
            title={`Operario: ${operarioLabel}`}
          >
            <User className="w-3 h-3 shrink-0 text-zinc-900 fill-zinc-900" />
            <span className="truncate">{operarioLabel}</span>
          </div>

          <div
            className="flex items-center gap-1 text-[10px] leading-tight text-zinc-800 font-medium truncate"
            title={`Ubicación en base: ${ubicacionLabel}`}
          >
            <MapPin className="w-3 h-3 shrink-0 text-zinc-900" />
            <span className="truncate">{ubicacionLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
