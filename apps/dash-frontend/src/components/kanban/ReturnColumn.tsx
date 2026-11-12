import React, { useMemo, useState, useEffect } from 'react';
import { RetornoItem, FlotaItem } from '../../types/dash';
import { PatenteMercosur } from '../common/PatenteMercosur';
import { DriverNameBadge } from '../common/DriverNameBadge';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { useDashStore } from '../../store/useDashStore';

interface ReturnColumnProps {
  retornos: RetornoItem[];
  flota?: FlotaItem[];
  flexWeight: number;
}

const renderInsigniaEstado = (code?: string, isHighlighted = false) => {
  const raw = String(code || '-').trim().toUpperCase();

  const borderClass = isHighlighted
    ? 'border-2 border-dashed border-amber-400 dark:border-amber-400'
    : 'border-2 border-transparent';

  if (!raw || raw === '-' || raw === '0') {
    return (
      <div
        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl border-2 border-dashed ${
          isHighlighted
            ? 'border-amber-400 dark:border-amber-400 text-amber-500 dark:text-amber-400'
            : 'border-slate-400 dark:border-slate-600 text-slate-700 dark:text-slate-300'
        } flex items-center justify-center font-black text-xs select-none transition-colors duration-150`}
        title="Sin Estado"
      >
        -
      </div>
    );
  }

  let trackingClass = 'tracking-normal';
  if (raw.length >= 3) trackingClass = 'tracking-tighter';
  else if (raw.length === 2) trackingClass = 'tracking-tight';

  // Verde: Franco (F / FSF)
  if (raw === 'F' || raw === 'FSF' || raw.includes('FRANCO')) {
    return (
      <div
        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-[#22C55E] text-white flex items-center justify-center font-black text-xs shadow-xs select-none transition-colors duration-150 ${borderClass} ${trackingClass}`}
        title={`Franco: ${raw}`}
      >
        {raw}
      </div>
    );
  }

  // Amarillo: Viaje (VSF / V)
  if (raw === 'VSF' || raw === 'V' || raw.includes('VIAJE')) {
    return (
      <div
        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-[#EAB308] text-slate-950 flex items-center justify-center font-black text-xs shadow-xs select-none transition-colors duration-150 ${borderClass} ${trackingClass}`}
        title={`Viaje: ${raw}`}
      >
        {raw}
      </div>
    );
  }

  // Rojo: Servicio / Ausente (S / A)
  if (raw === 'S' || raw === 'A' || raw.includes('SERVICIO') || raw.includes('AUSENTE')) {
    return (
      <div
        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-[#EF4444] text-white flex items-center justify-center font-black text-xs shadow-xs select-none transition-colors duration-150 ${borderClass} ${trackingClass}`}
        title={`Servicio: ${raw}`}
      >
        {raw}
      </div>
    );
  }

  // Índigo: otros (ej. números de rotación 1, 2, códigos especiales)
  return (
    <div
      className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black text-xs shadow-xs select-none transition-colors duration-150 ${borderClass} ${trackingClass}`}
      title={`Estado: ${raw}`}
    >
      {raw}
    </div>
  );
};

export const ReturnColumn: React.FC<ReturnColumnProps> = ({
  retornos,
  flexWeight
}) => {
  const { modoCartelera } = useDashStore();
  // Modo cartelera en 'ver todos' predeterminado; en modo normal permite alternar
  const [filtroDia, setFiltroDia] = useState<'TODOS' | 'AYER' | 'HOY' | 'MANANA'>('TODOS');

  // Asegurar que al entrar a modo cartelera se restablezca siempre a 'TODOS'
  useEffect(() => {
    if (modoCartelera) {
      setFiltroDia('TODOS');
    }
  }, [modoCartelera]);

  const filtroEfectivo = modoCartelera ? 'TODOS' : filtroDia;

  // Proyección ligera y directa: no procesa la tabla completa de flota en memoria
  const { volvieronAyer, vuelvenHoy, vuelvenManana } = useMemo(() => {
    let ayer: RetornoItem[] = [];
    let hoy: RetornoItem[] = [];
    let manana: RetornoItem[] = [];

    if (retornos && retornos.length > 0) {
      ayer = retornos.filter(
        (r) => (r?.retorna_cuando || '').toUpperCase() === 'AYER'
      );
      hoy = retornos.filter(
        (r) => (r?.retorna_cuando || '').toUpperCase() === 'HOY'
      );
      manana = retornos.filter(
        (r) =>
          (r?.retorna_cuando || '').toUpperCase() === 'MANANA' ||
          (r?.retorna_cuando || '').toUpperCase() === 'MAÑANA'
      );
    }

    return { volvieronAyer: ayer, vuelvenHoy: hoy, vuelvenManana: manana };
  }, [retornos]);

  // Autoscroll para modo cartelera (TV)
  useAutoScroll('carrusel-cat-vuelve', [volvieronAyer.length, vuelvenHoy.length, vuelvenManana.length]);

  // Manejo de interacción de selección en modo edición (deshabilitado en modo cartelera)
  const handleToggleDia = (dia: 'AYER' | 'HOY' | 'MANANA') => {
    if (modoCartelera) return;
    setFiltroDia((prev) => (prev === dia ? 'TODOS' : dia));
  };

  // Ancho óptimo y fijo para el área de copia (DriverNameBadge):
  const copyAreaWidth = useMemo(() => {
    let maxLen = 0;
    const todos = [...volvieronAyer, ...vuelvenHoy, ...vuelvenManana];
    for (const item of todos) {
      const name = (item.nom || item.nombre || '').trim();
      if (name.length > maxLen) {
        maxLen = name.length;
      }
    }
    if (maxLen === 0) return '260px';

    // Estimación exacta con canvas en navegador para Plus Jakarta Sans / Inter
    let measuredWidth = 0;
    if (typeof document !== 'undefined') {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.font = '900 12px "Plus Jakarta Sans", "Inter", sans-serif';
          for (const item of todos) {
            const name = (item.nom || item.nombre || '').trim().toUpperCase();
            const w = ctx.measureText(name).width;
            if (w > measuredWidth) measuredWidth = w;
          }
        }
      } catch {
        // Fallback si canvas no está disponible
      }
    }

    // Margen de respiración: padding (16px) + gap (6px) + icon (10px) + margen (18px) = 50px
    const pxFinal = measuredWidth > 0 
      ? Math.ceil(measuredWidth + 50) 
      : Math.ceil(maxLen * 8.2) + 48;

    return `${Math.max(200, pxFinal)}px`;
  }, [volvieronAyer, vuelvenHoy, vuelvenManana]);

  if (volvieronAyer.length === 0 && vuelvenHoy.length === 0 && vuelvenManana.length === 0) {
    return null;
  }

  // Visibilidad de subsecciones
  const mostrarAyer = filtroEfectivo === 'TODOS' || filtroEfectivo === 'AYER';
  const mostrarHoy = filtroEfectivo === 'TODOS' || filtroEfectivo === 'HOY';
  const mostrarManana = filtroEfectivo === 'TODOS' || filtroEfectivo === 'MANANA';

  return (
    <section
      data-cat="VUELVE"
      style={{ flex: `${flexWeight} 1 0%`, minWidth: '160px' }}
      className="resizable-column flex-1 border-2 border-dashed border-amber-400 rounded-2xl p-3 bg-transparent flex flex-col h-full min-h-0 overflow-hidden transition-all duration-100 relative"
    >
      {/* Título */}
      <div className="w-full mb-2 shrink-0 flex items-center justify-between pb-1 border-b border-slate-200/40 dark:border-slate-800/40">
        <h2 className="text-[11px] font-black uppercase tracking-widest text-amber-500 dark:text-amber-400 text-center flex-1 select-none truncate">
          VUELVE
        </h2>
        {/* Enlace Ver todos disponible solo en modo edición interactivo */}
        {!modoCartelera && filtroEfectivo !== 'TODOS' && (
          <button
            type="button"
            onClick={() => setFiltroDia('TODOS')}
            className="text-[8px] font-bold uppercase tracking-wider text-slate-400 hover:text-amber-500 px-1 py-0.5 rounded transition-colors cursor-pointer"
            title="Mostrar todos los días"
          >
            Ver todos
          </button>
        )}
      </div>

      {/* Encabezado Fijo de Columnas:
          - Modo Cartelera: estático (solo lectura)
          - Modo Edición: botones interactivos de filtrado y navegación */}
      <div className="flex items-center justify-between px-2 py-1 mb-1 text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 border-b border-slate-200/50 dark:border-slate-800/50 shrink-0 select-none">
        <span className="flex-1 truncate pr-1">Conductor</span>

        {modoCartelera ? (
          <div className="flex items-center gap-1.5 shrink-0 text-center pointer-events-none">
            <span className="w-7 sm:w-8 py-0.5 text-[9px] uppercase text-slate-400 dark:text-slate-500 font-medium">
              Ayer
            </span>
            <span className="w-7 sm:w-8 py-0.5 text-[9px] uppercase text-amber-500 dark:text-amber-400 font-extrabold">
              Hoy
            </span>
            <span className="w-7 sm:w-8 py-0.5 text-[9px] uppercase text-slate-400 dark:text-slate-500 font-medium">
              Mañana
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 shrink-0 text-center">
            {/* Botón Ayer */}
            <button
              type="button"
              onClick={() => handleToggleDia('AYER')}
              title={filtroEfectivo === 'AYER' ? 'Filtro Ayer activo (clic para ver todos)' : 'Filtrar por Ayer'}
              className={`w-7 sm:w-8 py-0.5 rounded text-[9px] uppercase transition-all cursor-pointer ${
                filtroEfectivo === 'AYER'
                  ? 'text-amber-500 dark:text-amber-400 font-extrabold bg-amber-500/15 dark:bg-amber-400/15'
                  : 'text-slate-400 dark:text-slate-500 font-medium hover:bg-slate-200/60 dark:hover:bg-slate-700/60 hover:text-amber-500 dark:hover:text-amber-400'
              }`}
            >
              Ayer
            </button>

            {/* Botón Hoy */}
            <button
              type="button"
              onClick={() => handleToggleDia('HOY')}
              title={filtroEfectivo === 'HOY' ? 'Filtro Hoy activo (clic para ver todos)' : 'Filtrar por Hoy'}
              className={`w-7 sm:w-8 py-0.5 rounded text-[9px] uppercase transition-all cursor-pointer ${
                filtroEfectivo === 'HOY'
                  ? 'text-amber-500 dark:text-amber-400 font-extrabold bg-amber-500/15 dark:bg-amber-400/15'
                  : filtroEfectivo === 'TODOS'
                    ? 'text-amber-500 dark:text-amber-400 font-extrabold'
                    : 'text-slate-400 dark:text-slate-500 font-medium hover:bg-slate-200/60 dark:hover:bg-slate-700/60 hover:text-amber-500 dark:hover:text-amber-400'
              }`}
            >
              Hoy
            </button>

            {/* Botón Mañana */}
            <button
              type="button"
              onClick={() => handleToggleDia('MANANA')}
              title={filtroEfectivo === 'MANANA' ? 'Filtro Mañana activo (clic para ver todos)' : 'Filtrar por Mañana'}
              className={`w-7 sm:w-8 py-0.5 rounded text-[9px] uppercase transition-all cursor-pointer ${
                filtroEfectivo === 'MANANA'
                  ? 'text-amber-500 dark:text-amber-400 font-extrabold bg-amber-500/15 dark:bg-amber-400/15'
                  : 'text-slate-400 dark:text-slate-500 font-medium hover:bg-slate-200/60 dark:hover:bg-slate-700/60 hover:text-amber-500 dark:hover:text-amber-400'
              }`}
            >
              Mañana
            </button>
          </div>
        )}
      </div>

      {/* Lista scrolleable con lógica de días:
          - En VOLVIERON AYER: se resalta la columna Ayer
          - En VUELVEN HOY: se resalta la columna Hoy
          - En VUELVEN MAÑANA: se resalta la columna Mañana */}
      <div
        id="carrusel-cat-vuelve"
        className="flex flex-col gap-2.5 overflow-y-auto custom-scrollbar pr-1 pb-2 flex-1 min-h-0"
      >
        {/* SUBSECCIÓN 1: VOLVIERON AYER */}
        {mostrarAyer && volvieronAyer.length > 0 && (
          <>
            <div className="flex items-center justify-between px-2 py-0.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-[9px] font-black uppercase text-amber-500 dark:text-amber-400 tracking-wider shrink-0 select-none">
              <span>VOLVIERON AYER</span>
              <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 text-[8px] font-black">
                {volvieronAyer.length}
              </span>
            </div>

            {volvieronAyer.map((ch, idx) => (
              <article
                key={`ayer-${ch.nom || ch.nombre}-${idx}`}
                className="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60 gap-2 shrink-0 shadow-xs"
              >
                <div
                  className="flex flex-col truncate shrink-0 gap-1"
                  style={{ width: copyAreaWidth, maxWidth: 'calc(100% - 100px)' }}
                >
                  <DriverNameBadge
                    nombre={ch.nom || ch.nombre}
                    className="w-full"
                  />
                  {ch.tractor && (
                    <div className="flex items-center">
                      <PatenteMercosur patente={ch.tractor} />
                    </div>
                  )}
                </div>
                {/* Lógica de días: en la subsección Ayer, se destaca con stroke dashed amarillo el día Ayer */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {renderInsigniaEstado(ch.codigo_ayer, true)}
                  {renderInsigniaEstado(ch.codigo_hoy, false)}
                  {renderInsigniaEstado(ch.codigo_manana, false)}
                </div>
              </article>
            ))}
          </>
        )}

        {/* SUBSECCIÓN 2: VUELVEN HOY */}
        {mostrarHoy && vuelvenHoy.length > 0 && (
          <>
            <div className={`flex items-center justify-between px-2 py-0.5 ${mostrarAyer && volvieronAyer.length > 0 ? 'mt-2' : ''} bg-amber-500/10 border border-amber-500/30 rounded-lg text-[9px] font-black uppercase text-amber-500 dark:text-amber-400 tracking-wider shrink-0 select-none`}>
              <span>VUELVEN HOY</span>
              <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 text-[8px] font-black">
                {vuelvenHoy.length}
              </span>
            </div>

            {vuelvenHoy.map((ch, idx) => (
              <article
                key={`hoy-${ch.nom || ch.nombre}-${idx}`}
                className="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60 gap-2 shrink-0 shadow-xs"
              >
                <div
                  className="flex flex-col truncate shrink-0 gap-1"
                  style={{ width: copyAreaWidth, maxWidth: 'calc(100% - 100px)' }}
                >
                  <DriverNameBadge
                    nombre={ch.nom || ch.nombre}
                    className="w-full"
                  />
                  {ch.tractor && (
                    <div className="flex items-center">
                      <PatenteMercosur patente={ch.tractor} />
                    </div>
                  )}
                </div>
                {/* Lógica de días: en la subsección Hoy, se destaca con stroke dashed amarillo el día Hoy */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {renderInsigniaEstado(ch.codigo_ayer, false)}
                  {renderInsigniaEstado(ch.codigo_hoy, true)}
                  {renderInsigniaEstado(ch.codigo_manana, false)}
                </div>
              </article>
            ))}
          </>
        )}

        {/* SUBSECCIÓN 3: VUELVEN MAÑANA */}
        {mostrarManana && vuelvenManana.length > 0 && (
          <>
            <div className={`flex items-center justify-between px-2 py-0.5 ${(mostrarAyer && volvieronAyer.length > 0) || (mostrarHoy && vuelvenHoy.length > 0) ? 'mt-2' : ''} bg-amber-500/10 border border-amber-500/30 rounded-lg text-[9px] font-black uppercase text-amber-500 dark:text-amber-400 tracking-wider shrink-0 select-none`}>
              <span>VUELVEN MAÑANA</span>
              <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 text-[8px] font-black">
                {vuelvenManana.length}
              </span>
            </div>

            {vuelvenManana.map((ch, idx) => (
              <article
                key={`manana-${ch.nom || ch.nombre}-${idx}`}
                className="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60 gap-2 shrink-0 shadow-xs"
              >
                <div
                  className="flex flex-col truncate shrink-0 gap-1"
                  style={{ width: copyAreaWidth, maxWidth: 'calc(100% - 100px)' }}
                >
                  <DriverNameBadge
                    nombre={ch.nom || ch.nombre}
                    className="w-full"
                  />
                  {ch.tractor && (
                    <div className="flex items-center">
                      <PatenteMercosur patente={ch.tractor} />
                    </div>
                  )}
                </div>
                {/* Lógica de días: en la subsección Mañana, se destaca con stroke dashed amarillo el día Mañana */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {renderInsigniaEstado(ch.codigo_ayer, false)}
                  {renderInsigniaEstado(ch.codigo_hoy, false)}
                  {renderInsigniaEstado(ch.codigo_manana, true)}
                </div>
              </article>
            ))}
          </>
        )}

        {/* Mensaje si el filtro seleccionado no tiene elementos */}
        {filtroEfectivo === 'AYER' && volvieronAyer.length === 0 && (
          <div className="text-center py-6 text-[10px] text-slate-400 font-semibold select-none">
            No hay conductores que hayan vuelto ayer
          </div>
        )}
        {filtroEfectivo === 'HOY' && vuelvenHoy.length === 0 && (
          <div className="text-center py-6 text-[10px] text-slate-400 font-semibold select-none">
            No hay conductores que vuelvan hoy
          </div>
        )}
        {filtroEfectivo === 'MANANA' && vuelvenManana.length === 0 && (
          <div className="text-center py-6 text-[10px] text-slate-400 font-semibold select-none">
            No hay conductores que vuelvan mañana
          </div>
        )}
      </div>
    </section>
  );
};
