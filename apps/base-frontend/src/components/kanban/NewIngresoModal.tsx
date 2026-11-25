import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { CatalogUnitItem } from '../../hooks/usePlaneacionKanban';
import { normalizePlateKey } from '../../hooks/usePlaneacionKanban';
import { UnitLicensePlate } from '../common/UnitLicensePlate';

export interface OriginRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface NewIngresoModalProps {
  open: boolean;
  availableUnits: CatalogUnitItem[];
  onClose: () => void;
  onSelectUnit: (unit: CatalogUnitItem, originRect: OriginRect) => void;
}

export const NewIngresoModal: React.FC<NewIngresoModalProps> = ({
  open,
  availableUnits,
  onClose,
  onSelectUnit,
}) => {
  const [plateSearch, setPlateSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setPlateSearch('');
      return;
    }
    const raf = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const filteredUnits = useMemo(() => {
    const qRaw = plateSearch.trim().toLowerCase();
    const qNorm = normalizePlateKey(plateSearch);
    if (!qRaw) return availableUnits;
    return availableUnits.filter((u) => {
      const trNorm = normalizePlateKey(u.tractor_plate);
      const smNorm = normalizePlateKey(u.semi_plate);
      return (
        (qNorm && (trNorm.includes(qNorm) || smNorm.includes(qNorm))) ||
        u.tractor_plate.toLowerCase().includes(qRaw) ||
        u.semi_plate.toLowerCase().includes(qRaw) ||
        u.n_ute.toLowerCase().includes(qRaw)
      );
    });
  }, [availableUnits, plateSearch]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Seleccionar patentes para incorporar al circuito"
      className="fixed inset-0 z-50 bg-[#EDEDED]/70 backdrop-blur-[3px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[316px] border-2 border-dashed border-zinc-500/80 bg-[#EDEDED]/95 backdrop-blur-md rounded-2xl p-3 flex flex-col gap-3 shadow-lg"
      >
        {/* Buscador minimalista + Cierre */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search
              size={16}
              strokeWidth={2}
              aria-hidden="true"
              focusable="false"
              className="text-zinc-600 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={plateSearch}
              onChange={(e) => setPlateSearch(e.target.value)}
              placeholder="Buscar patente..."
              aria-label="Filtrar patentes disponibles"
              className="w-full h-8 pl-8 pr-3 bg-white/85 border border-zinc-400 rounded-full text-xs font-mono text-zinc-950 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1"
            />
          </div>

          <span
            className="h-8 px-2.5 inline-flex items-center justify-center rounded-full border border-dashed border-zinc-400 text-[11px] font-numeric font-bold text-zinc-700 tabular-nums shrink-0 select-none"
            title="Conjuntos disponibles"
          >
            {filteredUnits.length}
          </span>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar selector de patentes"
            title="Cerrar"
            className="w-8 h-8 rounded-full border border-transparent hover:border-zinc-400 hover:bg-zinc-300/50 text-zinc-700 hover:text-zinc-950 inline-flex items-center justify-center transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            <X size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
          </button>
        </div>

        {/* Scroll en 2 columnas: solo patentes, sin contenedores sólidos */}
        <div
          className="max-h-[58vh] overflow-y-auto px-1 py-1 no-scrollbar"
          aria-label="Patentes disponibles para ingresar al circuito"
        >
          {filteredUnits.length === 0 ? (
            <div className="py-10 text-center text-xs font-mono text-zinc-600 select-none">
              {availableUnits.length === 0
                ? 'Todas las unidades están en circuito'
                : 'Sin patentes coincidentes'}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 justify-items-center items-center">
              {filteredUnits.map((u) => {
                const labelText = [u.tractor_plate, u.semi_plate].filter(Boolean).join(' / ');
                return (
                  <button
                    key={u.unidad_id}
                    type="button"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      onSelectUnit(u, {
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height,
                      });
                    }}
                    aria-label={`Incorporar patentes ${labelText} al circuito`}
                    className="group p-1 rounded-lg bg-transparent border-0 flex flex-col items-center gap-[3px] cursor-pointer transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-[1.05] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 focus-visible:ring-offset-[#EDEDED]"
                  >
                    {u.tractor_plate && (
                      <UnitLicensePlate plate={u.tractor_plate} label="Tractor" size="sm" />
                    )}
                    {u.semi_plate && (
                      <UnitLicensePlate plate={u.semi_plate} label="Semi" size="sm" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
