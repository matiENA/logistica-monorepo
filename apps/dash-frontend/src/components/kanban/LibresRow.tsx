import React, { useState, useRef, useEffect } from 'react';
import { Check, X } from 'lucide-react';
import { Novedad, FlotaItem, Usuario } from '../../types/dash';
import { useDashStore } from '../../store/useDashStore';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { QuickAddLibre } from './QuickAddLibre';
import { NoveltyCard } from './NoveltyCard';

interface LibresRowProps {
  novedadesLibres: Novedad[];
  flota: FlotaItem[];
  usuarios: Usuario[];
  onResolver: (id: number | string, nuevoServicio?: string) => void;
  onEditar?: (novedad: Novedad) => void;
  onCambiarTerminal?: (id: number | string, terminal: string, terminal_id?: string | null) => void;
  onCambiarServicio?: (id: number | string, servicio: string) => void;
  onAgregarMencion?: (id: number | string, usuario: string) => void;
  onQuitarMencion?: (id: number | string, usuario: string) => void;
  onRecargar: () => void;
}

const CONFIG_TERMINALES: Record<string, { bg: string; text: string }> = {
  'DOCK SUD': { bg: '#DD7E6B', text: '#000000' },
  'TVM': { bg: '#38BDF8', text: '#000000' },
  'TPH': { bg: '#FBBF24', text: '#000000' },
  'TLC': { bg: '#A78BFA', text: '#000000' }
};

export const LibresRow: React.FC<LibresRowProps> = ({
  novedadesLibres,
  flota,
  usuarios,
  onResolver,
  onEditar,
  onCambiarTerminal,
  onCambiarServicio,
  onAgregarMencion,
  onQuitarMencion,
  onRecargar
}) => {
  const { modoCartelera, terminales } = useDashStore();
  const rowContainerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [terminalMenu, setTerminalMenu] = useState<{
    novedad: Novedad;
    top: number;
    left: number;
  } | null>(null);

  // Autoscroll para modo cartelera (TV)
  useAutoScroll('carrusel-cat-libres', [novedadesLibres.length]);

  // Cerrar menú al hacer clic fuera del dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setTerminalMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleOpenTerminalMenu = (novedad: Novedad, buttonEl: HTMLElement) => {
    if (modoCartelera) return;
    if (terminalMenu?.novedad.id === novedad.id) {
      setTerminalMenu(null);
      return;
    }

    if (!rowContainerRef.current) return;
    const containerRect = rowContainerRef.current.getBoundingClientRect();
    const btnRect = buttonEl.getBoundingClientRect();

    // Posicionamiento absoluto bajo el botón dentro del contenedor libre de overflow-x
    const top = btnRect.bottom - containerRect.top + 4;
    const left = Math.max(8, Math.min(btnRect.left - containerRect.left, containerRect.width - 170));

    setTerminalMenu({
      novedad,
      top,
      left
    });
  };

  const listaTerminales = terminales && terminales.length > 0
    ? terminales
    : Object.keys(CONFIG_TERMINALES).map((t) => ({
        id: '',
        codigo: t,
        nombre: t,
        color_bg: CONFIG_TERMINALES[t].bg,
        color_text: CONFIG_TERMINALES[t].text
      }));

  return (
    <section className="w-full mb-3 shrink-0">
      {/* Contenedor principal sin clipping vertical: renderización de terminales dentro de class="flex items-center gap-3 w-full" */}
      <div ref={rowContainerRef} className="flex items-center gap-3 w-full relative">
        {/* Botón Quick Add Libre */}
        <QuickAddLibre flota={flota} onNovedadPublicada={onRecargar} />

        {/* Carrusel Horizontal de Tarjetas Libres */}
        <div
          id="carrusel-cat-libres"
          className="flex gap-3 overflow-x-auto pb-2 pt-1 custom-scrollbar items-center w-full flex-1 min-h-[90px]"
          onScroll={() => setTerminalMenu(null)}
        >
          {novedadesLibres.length === 0 ? (
            <div className="px-4 py-3 rounded-xl border border-dashed border-cyan-400/50 text-cyan-600 dark:text-cyan-400 text-xs font-bold uppercase tracking-wider select-none">
              Sin unidades libres actualmente
            </div>
          ) : (
            novedadesLibres.map((nov) => (
              <NoveltyCard
                key={nov.id}
                novedad={nov}
                usuarios={usuarios}
                onResolver={onResolver}
                onEditar={onEditar}
                onCambiarTerminal={onCambiarTerminal}
                onCambiarServicio={onCambiarServicio}
                onAgregarMencion={onAgregarMencion}
                onQuitarMencion={onQuitarMencion}
                onRequestTerminalMenu={handleOpenTerminalMenu}
              />
            ))
          )}
        </div>

        {/* Dropdown de Terminales Renderizado al Nivel del Contenedor Principal (Sin Clipping) */}
        {terminalMenu && !modoCartelera && (
          <div
            ref={dropdownRef}
            style={{
              top: `${terminalMenu.top}px`,
              left: `${terminalMenu.left}px`
            }}
            className="absolute z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-1.5 flex flex-col gap-1 w-40 max-h-60 overflow-y-auto custom-scrollbar animate-in fade-in duration-100"
          >
            <div className="px-2 py-1 text-[9px] font-black uppercase text-slate-400 border-b border-slate-100 dark:border-slate-800 tracking-wider">
              Terminal Operativa
            </div>
            {listaTerminales.map((t) => {
              const c = {
                bg: t.color_bg || CONFIG_TERMINALES[t.codigo]?.bg || '#475569',
                text: t.color_text || CONFIG_TERMINALES[t.codigo]?.text || '#FFFFFF'
              };
              const esActivo = (terminalMenu.novedad.terminal || '').toUpperCase() === t.codigo.toUpperCase();

              return (
                <button
                  key={t.codigo}
                  type="button"
                  onClick={() => {
                    setTerminalMenu(null);
                    onCambiarTerminal?.(terminalMenu.novedad.id, t.codigo, t.id || null);
                  }}
                  className={`px-2 py-1.5 rounded text-[10px] font-black uppercase text-left transition-transform active:scale-95 cursor-pointer hover:opacity-90 flex items-center justify-between ${
                    esActivo ? 'ring-2 ring-cyan-500' : ''
                  }`}
                  style={{ backgroundColor: c.bg, color: c.text }}
                >
                  <span>{t.codigo}</span>
                  {esActivo && <Check className="w-3 h-3 stroke-[2.5]" />}
                </button>
              );
            })}
            {terminalMenu.novedad.terminal && (
              <button
                type="button"
                onClick={() => {
                  setTerminalMenu(null);
                  onCambiarTerminal?.(terminalMenu.novedad.id, '', null);
                }}
                className="mt-1 px-2 py-1 rounded text-[9px] font-black uppercase bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-rose-500 hover:text-white transition-colors cursor-pointer flex items-center justify-center gap-1"
              >
                <X className="w-2.5 h-2.5 stroke-[2.5]" />
                <span>Quitar terminal</span>
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
