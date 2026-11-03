import React, { useMemo } from 'react';
import { RetornoItem, FlotaItem } from '../../types/dash';
import { PatenteMercosur } from '../common/PatenteMercosur';
import { useAutoScroll } from '../../hooks/useAutoScroll';

interface ReturnColumnProps {
  retornos: RetornoItem[];
  flota: FlotaItem[];
  flexWeight: number;
}

const renderInsigniaEstado = (code?: string) => {
  const raw = String(code || '-').trim().toUpperCase();

  if (!raw || raw === '-' || raw === '0') {
    return (
      <div
        className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl border-2 border-dashed border-slate-400 dark:border-slate-600 flex items-center justify-center text-slate-700 dark:text-slate-300 font-black text-xs select-none"
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
        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-[#22C55E] text-white flex items-center justify-center font-black text-xs shadow-xs select-none ${trackingClass}`}
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
        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-[#EAB308] text-slate-950 flex items-center justify-center font-black text-xs shadow-xs select-none ${trackingClass}`}
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
        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-[#EF4444] text-white flex items-center justify-center font-black text-xs shadow-xs select-none ${trackingClass}`}
        title={`Servicio: ${raw}`}
      >
        {raw}
      </div>
    );
  }

  // Índigo: otros
  return (
    <div
      className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black text-xs shadow-xs select-none ${trackingClass}`}
      title={`Estado: ${raw}`}
    >
      {raw}
    </div>
  );
};

export const ReturnColumn: React.FC<ReturnColumnProps> = ({
  retornos,
  flota,
  flexWeight
}) => {
  const { vuelvenHoy, vuelvenManana } = useMemo(() => {
    let hoy: RetornoItem[] = [];
    let manana: RetornoItem[] = [];

    if (retornos && retornos.length > 0) {
      const mapaTractor: Record<string, string> = {};
      flota.forEach((f) => {
        if (f.nom && f.tractor) {
          mapaTractor[f.nom.trim().toUpperCase()] = f.tractor;
        }
      });

      const enriquecer = (r: RetornoItem): RetornoItem => ({
        ...r,
        tractor: r.tractor || mapaTractor[(r.nom || '').trim().toUpperCase()] || ''
      });

      hoy = retornos
        .filter((r) => (r.retorna_cuando || '').toUpperCase() === 'HOY')
        .map(enriquecer);
      manana = retornos
        .filter(
          (r) =>
            (r.retorna_cuando || '').toUpperCase() === 'MANANA' ||
            (r.retorna_cuando || '').toUpperCase() === 'MAÑANA'
        )
        .map(enriquecer);
    } else {
      // Fallback si no hay retornos cargados aún
      flota.forEach((ch) => {
        if (ch.dias) {
          hoy.push({
            nom: ch.nom,
            tractor: ch.tractor,
            codigo_ayer: '-',
            codigo_hoy: '-',
            codigo_manana: '-'
          });
        }
      });
    }

    return { vuelvenHoy: hoy, vuelvenManana: manana };
  }, [retornos, flota]);

  // Autoscroll para modo cartelera (TV)
  useAutoScroll('carrusel-cat-vuelve', [vuelvenHoy.length, vuelvenManana.length]);

  if (vuelvenHoy.length === 0 && vuelvenManana.length === 0) {
    return null;
  }

  return (
    <section
      data-cat="VUELVE"
      style={{ flex: `${flexWeight} 1 0%`, minWidth: '160px' }}
      className="resizable-column flex-1 border-2 border-dashed border-amber-400 rounded-2xl p-3 bg-transparent flex flex-col h-full min-h-0 overflow-hidden transition-all duration-100 relative"
    >
      {/* Título */}
      <div className="w-full mb-2 shrink-0 flex items-center justify-center pb-1 border-b border-slate-200/40 dark:border-slate-800/40">
        <h2 className="text-[11px] font-black uppercase tracking-widest text-amber-500 dark:text-amber-400 text-center flex-1 select-none truncate">
          VUELVE
        </h2>
      </div>

      {/* Encabezado Fijo de Columnas */}
      <div className="flex items-center justify-between px-2 py-1 mb-1 text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 border-b border-slate-200/50 dark:border-slate-800/50 shrink-0">
        <span className="flex-1 truncate pr-1">Conductor</span>
        <div className="flex items-center gap-1.5 shrink-0 text-center">
          <span className="w-7 sm:w-8">Ayer</span>
          <span className="w-7 sm:w-8 text-amber-500 dark:text-amber-400 font-extrabold">
            Hoy
          </span>
          <span className="w-7 sm:w-8">Mañana</span>
        </div>
      </div>

      {/* Lista scrolleable */}
      <div
        id="carrusel-cat-vuelve"
        className="flex flex-col gap-2.5 overflow-y-auto custom-scrollbar pr-1 pb-2 flex-1 min-h-0"
      >
        {/* SUBSECCIÓN 1: VUELVEN HOY */}
        {vuelvenHoy.length > 0 && (
          <>
            <div className="flex items-center justify-between px-2 py-0.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-[9px] font-black uppercase text-amber-500 dark:text-amber-400 tracking-wider shrink-0 select-none">
              <span>HOY</span>
              <span className="px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 text-[8px] font-black">
                {vuelvenHoy.length}
              </span>
            </div>

            {vuelvenHoy.map((ch, idx) => (
              <article
                key={`hoy-${ch.nom}-${idx}`}
                className="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60 gap-2 shrink-0 shadow-xs"
              >
                <div className="flex flex-col truncate flex-1 min-w-0 pr-1">
                  <span className="font-black text-xs text-slate-900 dark:text-slate-100 truncate uppercase">
                    {ch.nom}
                  </span>
                  {ch.tractor && (
                    <div className="mt-0.5">
                      <PatenteMercosur patente={ch.tractor} />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {renderInsigniaEstado(ch.codigo_ayer)}
                  {renderInsigniaEstado(ch.codigo_hoy)}
                  {renderInsigniaEstado(ch.codigo_manana)}
                </div>
              </article>
            ))}
          </>
        )}

        {/* SUBSECCIÓN 2: VUELVEN MAÑANA */}
        {vuelvenManana.length > 0 && (
          <>
            <div className="flex items-center justify-between px-2 py-0.5 mt-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-[9px] font-black uppercase text-cyan-500 dark:text-cyan-400 tracking-wider shrink-0 select-none">
              <span>MAÑANA</span>
              <span className="px-1.5 py-0.2 rounded-full bg-cyan-400 text-slate-950 text-[8px] font-black">
                {vuelvenManana.length}
              </span>
            </div>

            {vuelvenManana.map((ch, idx) => (
              <article
                key={`manana-${ch.nom}-${idx}`}
                className="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60 gap-2 shrink-0 shadow-xs"
              >
                <div className="flex flex-col truncate flex-1 min-w-0 pr-1">
                  <span className="font-black text-xs text-slate-900 dark:text-slate-100 truncate uppercase">
                    {ch.nom}
                  </span>
                  {ch.tractor && (
                    <div className="mt-0.5">
                      <PatenteMercosur patente={ch.tractor} />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {renderInsigniaEstado(ch.codigo_ayer)}
                  {renderInsigniaEstado(ch.codigo_hoy)}
                  {renderInsigniaEstado(ch.codigo_manana)}
                </div>
              </article>
            ))}
          </>
        )}
      </div>
    </section>
  );
};
