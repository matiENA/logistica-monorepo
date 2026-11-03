import React, { useState, useEffect, useRef } from 'react';
import { HoldUnit } from '../../types';
import { LicensePlate } from '../common/LicensePlate';
import { findUnitOrOt } from '../../services/tallerApi';
import { toast } from 'sonner';
import { Plus, X, Search, Truck, Layers } from 'lucide-react';

interface UnitHoldsManagerProps {
  holdUnits: HoldUnit[];
  selectedHoldIndex: number;
  onSelectHold: (index: number) => void;
  onAddHold: (unit: HoldUnit) => void;
  onRemoveHold: (index: number) => void;
  fleetData: {
    tractores: string[];
    semis: string[];
    pairs?: any[];
  };
}

export const UnitHoldsManager: React.FC<UnitHoldsManagerProps> = ({
  holdUnits,
  selectedHoldIndex,
  onSelectHold,
  onAddHold,
  onRemoveHold,
  fleetData,
}) => {
  // Estados de los 4 inputs
  const [tractorPlate, setTractorPlate] = useState('');
  const [tractorOt, setTractorOt] = useState('');
  const [semiPlate, setSemiPlate] = useState('');
  const [semiOt, setSemiOt] = useState('');

  // Sugerencias autocompletadas
  const [activePopover, setActivePopover] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ val: string; primary: string; secondary?: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Cerrar popover al hacer clic afuera
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setActivePopover(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Búsqueda bidireccional automática
  const triggerBidirectionalSearch = async (val: string, type: 'TRACTOR' | 'OT' | 'SEMI' | 'SEMI_OT') => {
    if (!val || val.trim().length < 2 || isSearching) return;
    setIsSearching(true);
    try {
      const res = await findUnitOrOt(val.trim().toUpperCase(), type);
      if (res && res.success) {
        if (res.unit) setTractorPlate(res.unit.toUpperCase());
        if (res.ot) setTractorOt(String(res.ot));
        if (res.semi) setSemiPlate(res.semi.toUpperCase());
        if (res.semiOt) setSemiOt(String(res.semiOt));
        toast.info(`Búsqueda bidireccional: Unidad vinculada`);
      }
    } catch (err) {
      console.warn('Error en búsqueda bidireccional:', err);
    } finally {
      setIsSearching(false);
    }
  };

  // Filtrar sugerencias
  const handleInputChange = (
    val: string,
    field: 'tractorPlate' | 'tractorOt' | 'semiPlate' | 'semiOt',
    type: 'TRACTOR' | 'OT' | 'SEMI' | 'SEMI_OT'
  ) => {
    const q = val.trim().toUpperCase();
    if (field === 'tractorPlate') setTractorPlate(val.toUpperCase());
    if (field === 'tractorOt') setTractorOt(val);
    if (field === 'semiPlate') setSemiPlate(val.toUpperCase());
    if (field === 'semiOt') setSemiOt(val);

    if (q.length < 2) {
      setActivePopover(null);
      setSuggestions([]);
      return;
    }

    const qNorm = q.replace(/[\s\-_.]/g, '');
    const pairs = fleetData.pairs || [];
    const list: { val: string; primary: string; secondary?: string }[] = [];
    const seen = new Set<string>();

    if (type === 'TRACTOR') {
      pairs.forEach((p) => {
        const t = (p.tractor || '').toUpperCase();
        if (t.replace(/[\s\-_.]/g, '').includes(qNorm) && !seen.has(t)) {
          seen.add(t);
          list.push({
            val: t,
            primary: t,
            secondary: (p.tractorOt ? `OT: ${p.tractorOt}` : '') + (p.semi ? ` · Semi: ${p.semi}` : ''),
          });
        }
      });
      fleetData.tractores.forEach((t) => {
        const tUpper = String(t).toUpperCase();
        if (tUpper.replace(/[\s\-_.]/g, '').includes(qNorm) && !seen.has(tUpper)) {
          seen.add(tUpper);
          list.push({ val: tUpper, primary: tUpper, secondary: 'Tractor' });
        }
      });
    } else if (type === 'OT') {
      pairs.forEach((p) => {
        const tot = String(p.tractorOt || '').trim();
        if (tot && tot.includes(qNorm) && !seen.has(tot)) {
          seen.add(tot);
          list.push({
            val: tot,
            primary: `OT ${tot}`,
            secondary: (p.tractor ? `Tractor: ${p.tractor}` : '') + (p.semi ? ` · Semi: ${p.semi}` : ''),
          });
        }
      });
    } else if (type === 'SEMI') {
      pairs.forEach((p) => {
        const s = (p.semi || '').toUpperCase();
        if (s.replace(/[\s\-_.]/g, '').includes(qNorm) && !seen.has(s)) {
          seen.add(s);
          list.push({
            val: s,
            primary: s,
            secondary: (p.semiOt ? `OT: ${p.semiOt}` : '') + (p.tractor ? ` · Tractor: ${p.tractor}` : ''),
          });
        }
      });
      fleetData.semis.forEach((s) => {
        const sUpper = String(s).toUpperCase();
        if (sUpper.replace(/[\s\-_.]/g, '').includes(qNorm) && !seen.has(sUpper)) {
          seen.add(sUpper);
          list.push({ val: sUpper, primary: sUpper, secondary: 'Semi' });
        }
      });
    } else if (type === 'SEMI_OT') {
      pairs.forEach((p) => {
        const sot = String(p.semiOt || '').trim();
        if (sot && sot.includes(qNorm) && !seen.has(sot)) {
          seen.add(sot);
          list.push({
            val: sot,
            primary: `OT ${sot}`,
            secondary: (p.semi ? `Semi: ${p.semi}` : '') + (p.tractor ? ` · Tractor: ${p.tractor}` : ''),
          });
        }
      });
    }

    setSuggestions(list.slice(0, 8));
    setActivePopover(field);
  };

  const handleSelectSuggestion = (
    val: string,
    field: 'tractorPlate' | 'tractorOt' | 'semiPlate' | 'semiOt',
    type: 'TRACTOR' | 'OT' | 'SEMI' | 'SEMI_OT'
  ) => {
    if (field === 'tractorPlate') setTractorPlate(val);
    if (field === 'tractorOt') setTractorOt(val);
    if (field === 'semiPlate') setSemiPlate(val);
    if (field === 'semiOt') setSemiOt(val);

    setActivePopover(null);
    triggerBidirectionalSearch(val, type);
  };

  // Agregar unidad al Hold
  const handleAddUnit = () => {
    const tp = tractorPlate.trim().toUpperCase();
    const tot = tractorOt.trim();
    const sp = semiPlate.trim().toUpperCase();
    const sot = semiOt.trim();

    if (!tp && !tot && !sp && !sot) {
      toast.warning('Ingresa al menos una patente o número de OT para cargar la unidad.');
      return;
    }

    const newUnit: HoldUnit = {
      tractorPlate: tp,
      tractorOt: tot,
      semiPlate: sp,
      semiOt: sot,
      addedAt: new Date().toISOString(),
    };

    onAddHold(newUnit);

    // Limpiar inputs
    setTractorPlate('');
    setTractorOt('');
    setSemiPlate('');
    setSemiOt('');
    setActivePopover(null);
    toast.success('Unidad agregada al taller.');
  };

  return (
    <div className="flex flex-col gap-3" ref={containerRef}>
      {/* ========================================================================= */}
      {/* BARRA SUPERIOR DE ENTRADAS: TRACTOR, OT, SEMI, OT + BOTÓN AGREGAR         */}
      {/* ========================================================================= */}
      <div className="bg-[#111622] border border-[#1E2530] rounded-xl p-3 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Truck className="w-4 h-4 text-[#388BFD]" />
            <span className="text-xs font-black tracking-wide text-zinc-300 uppercase">
              CARGA Y VINCULACIÓN DE UNIDAD
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              if (tractorPlate) triggerBidirectionalSearch(tractorPlate, 'TRACTOR');
              else if (tractorOt) triggerBidirectionalSearch(tractorOt, 'OT');
              else if (semiPlate) triggerBidirectionalSearch(semiPlate, 'SEMI');
              else if (semiOt) triggerBidirectionalSearch(semiOt, 'SEMI_OT');
              else toast.info('Ingresa una patente u OT para buscar');
            }}
            className="text-[11px] font-black text-[#388BFD] hover:underline uppercase flex items-center gap-1 cursor-pointer"
          >
            <Search className="w-3 h-3" />
            <span>BÚSQUEDA BIDIRECCIONAL</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 relative">
          {/* 1. Patente Tractor */}
          <div className="relative">
            <label className="text-[9px] font-extrabold text-zinc-500 uppercase block mb-1">
              PATENTE TRACTOR
            </label>
            <input
              type="text"
              placeholder="EJ: AD217WU"
              value={tractorPlate}
              onChange={(e) => handleInputChange(e.target.value, 'tractorPlate', 'TRACTOR')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') triggerBidirectionalSearch(tractorPlate, 'TRACTOR');
              }}
              className="w-full bg-[#0B0F15] border border-[#202938] focus:border-[#388BFD] rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-white outline-none uppercase placeholder-zinc-600"
            />
            {activePopover === 'tractorPlate' && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-[#161D2A] border border-[#202938] rounded-lg shadow-2xl z-30 max-h-48 overflow-y-auto">
                {suggestions.map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectSuggestion(s.val, 'tractorPlate', 'TRACTOR');
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[#202938] transition-colors border-b border-[#202938]/50 last:border-0"
                  >
                    <div className="text-xs font-bold text-white font-mono">{s.primary}</div>
                    {s.secondary && <div className="text-[10px] text-zinc-400">{s.secondary}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 2. OT Tractor */}
          <div className="relative">
            <label className="text-[9px] font-extrabold text-zinc-500 uppercase block mb-1">
              OT TRACTOR
            </label>
            <input
              type="text"
              placeholder="EJ: 10169"
              value={tractorOt}
              onChange={(e) => handleInputChange(e.target.value, 'tractorOt', 'OT')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') triggerBidirectionalSearch(tractorOt, 'OT');
              }}
              className="w-full bg-[#0B0F15] border border-[#202938] focus:border-[#388BFD] rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-white outline-none uppercase placeholder-zinc-600"
            />
            {activePopover === 'tractorOt' && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-[#161D2A] border border-[#202938] rounded-lg shadow-2xl z-30 max-h-48 overflow-y-auto">
                {suggestions.map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectSuggestion(s.val, 'tractorOt', 'OT');
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[#202938] transition-colors border-b border-[#202938]/50 last:border-0"
                  >
                    <div className="text-xs font-bold text-white font-mono">{s.primary}</div>
                    {s.secondary && <div className="text-[10px] text-zinc-400">{s.secondary}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 3. Patente Semi */}
          <div className="relative">
            <label className="text-[9px] font-extrabold text-zinc-500 uppercase block mb-1">
              PATENTE SEMI
            </label>
            <input
              type="text"
              placeholder="EJ: LEM786"
              value={semiPlate}
              onChange={(e) => handleInputChange(e.target.value, 'semiPlate', 'SEMI')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') triggerBidirectionalSearch(semiPlate, 'SEMI');
              }}
              className="w-full bg-[#0B0F15] border border-[#202938] focus:border-[#10B981] rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-white outline-none uppercase placeholder-zinc-600"
            />
            {activePopover === 'semiPlate' && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-[#161D2A] border border-[#202938] rounded-lg shadow-2xl z-30 max-h-48 overflow-y-auto">
                {suggestions.map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectSuggestion(s.val, 'semiPlate', 'SEMI');
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[#202938] transition-colors border-b border-[#202938]/50 last:border-0"
                  >
                    <div className="text-xs font-bold text-white font-mono">{s.primary}</div>
                    {s.secondary && <div className="text-[10px] text-zinc-400">{s.secondary}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 4. OT Semi + Botón Cargar */}
          <div className="relative flex items-end gap-2">
            <div className="flex-1">
              <label className="text-[9px] font-extrabold text-zinc-500 uppercase block mb-1">
                OT SEMI
              </label>
              <input
                type="text"
                placeholder="EJ: 10170"
                value={semiOt}
                onChange={(e) => handleInputChange(e.target.value, 'semiOt', 'SEMI_OT')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') triggerBidirectionalSearch(semiOt, 'SEMI_OT');
                }}
                className="w-full bg-[#0B0F15] border border-[#202938] focus:border-[#10B981] rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-white outline-none uppercase placeholder-zinc-600"
              />
            </div>

            <button
              type="button"
              onClick={handleAddUnit}
              className="h-[34px] px-3.5 bg-[#059669] hover:bg-[#10B981] text-white rounded-lg font-black text-xs transition-colors flex items-center justify-center shrink-0 shadow-sm shadow-emerald-900/30"
              title="Agregar unidad al Taller"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
            </button>

            {activePopover === 'semiOt' && suggestions.length > 0 && (
              <div className="absolute left-0 right-10 top-full mt-1 bg-[#161D2A] border border-[#202938] rounded-lg shadow-2xl z-30 max-h-48 overflow-y-auto">
                {suggestions.map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectSuggestion(s.val, 'semiOt', 'SEMI_OT');
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[#202938] transition-colors border-b border-[#202938]/50 last:border-0"
                  >
                    <div className="text-xs font-bold text-white font-mono">{s.primary}</div>
                    {s.secondary && <div className="text-[10px] text-zinc-400">{s.secondary}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* LISTA DE TARJETAS DE UNIDADES EN TALLER (HOLD UNITS)                      */}
      {/* ========================================================================= */}
      <div className="bg-[#111622] border border-[#1E2530] rounded-xl p-3 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-emerald-500" />
            <span className="text-xs font-black tracking-wide text-zinc-300 uppercase">
              UNIDADES EN TALLER ({holdUnits.length})
            </span>
          </div>

          <span className="text-[10px] text-zinc-500 font-bold uppercase">
            Clic en una tarjeta para ver tareas o pedir repuestos
          </span>
        </div>

        {holdUnits.length === 0 ? (
          <div className="text-center py-6 text-zinc-500 text-xs border border-dashed border-[#1E2530] rounded-xl">
            Sin unidades en curso. Ingresa patente u OT arriba para cargar una unidad.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {holdUnits.map((unit, idx) => {
              const isSelected = idx === selectedHoldIndex;

              return (
                <div
                  key={idx}
                  onClick={() => onSelectHold(idx)}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                    isSelected
                      ? 'bg-[#0E1520] border-[#388BFD] shadow-[0_0_12px_rgba(56,139,253,0.2)]'
                      : 'bg-[#0B0F15] border-[#1E2530] hover:border-zinc-700'
                  }`}
                >
                  {/* Fila superior: Badges de OT + Botón Eliminar */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-mono text-[10px] font-black">
                      <span className="px-2 py-0.5 rounded bg-[#161D2A] text-zinc-300 border border-[#202938]">
                        OT: {unit.tractorOt || '---'}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[#161D2A] text-zinc-300 border border-[#202938]">
                        SEMI: {unit.semiOt || '---'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveHold(idx);
                      }}
                      className="text-zinc-500 hover:text-red-400 p-1 rounded hover:bg-[#161D2A] transition-colors"
                      title="Quitar unidad de Taller"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Fila inferior: Chapas Patentes Mercosur */}
                  <div className="flex items-center justify-around gap-2 pt-1 border-t border-[#1E2530]/60">
                    <div className="flex flex-col items-center">
                      <span className="text-[8px] font-extrabold text-[#388BFD] uppercase tracking-wider mb-0.5">
                        TRACTOR
                      </span>
                      <LicensePlate
                        plate={unit.tractorPlate}
                        type="TRACTOR"
                        size="sm"
                        showOtBadge={false}
                      />
                    </div>

                    <div className="flex flex-col items-center">
                      <span className="text-[8px] font-extrabold text-[#10B981] uppercase tracking-wider mb-0.5">
                        SEMI
                      </span>
                      <LicensePlate
                        plate={unit.semiPlate}
                        type="SEMI"
                        size="sm"
                        showOtBadge={false}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
