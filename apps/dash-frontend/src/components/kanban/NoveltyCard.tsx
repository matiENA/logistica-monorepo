import React, { useState, useRef, useEffect } from 'react';
import { Pencil, Clock, Check, X, User } from 'lucide-react';
import { Novedad, Usuario } from '../../types/dash';
import { useDashStore } from '../../store/useDashStore';
import { PatenteMercosur } from '../common/PatenteMercosur';
import { DriverNameBadge } from '../common/DriverNameBadge';

interface NoveltyCardProps {
  novedad: Novedad;
  usuarios: Usuario[];
  onResolver: (id: number | string, nuevoServicio?: string) => void;
  onEditar?: (novedad: Novedad) => void;
  onCambiarTerminal?: (id: number | string, terminal: string, terminal_id?: string | null) => void;
  onCambiarServicio?: (id: number | string, servicio: string) => void;
  onAgregarMencion?: (id: number | string, usuario: string) => void;
  onQuitarMencion?: (id: number | string, usuario: string) => void;
  onRequestTerminalMenu?: (novedad: Novedad, anchorElement: HTMLElement) => void;
}

const CONFIG_TERMINALES: Record<string, { bg: string; text: string }> = {
  'DOCK SUD': { bg: '#DD7E6B', text: '#000000' },
  'TVM': { bg: '#38BDF8', text: '#000000' },
  'TPH': { bg: '#FBBF24', text: '#000000' },
  'TLC': { bg: '#A78BFA', text: '#000000' }
};

const CONFIG_SERVICIOS: Record<string, { bg: string; text: string }> = {
  'LIVIANO': { bg: '#06B6D4', text: '#FFFFFF' },
  'LIV': { bg: '#06B6D4', text: '#FFFFFF' },
  'LIV.': { bg: '#06B6D4', text: '#FFFFFF' },
  'METANOL': { bg: '#EC4899', text: '#FFFFFF' },
  'MET': { bg: '#EC4899', text: '#FFFFFF' },
  'ABAST': { bg: '#F59E0B', text: '#FFFFFF' },
  'GLP': { bg: '#8B5CF6', text: '#FFFFFF' },
  'CAMPO': { bg: '#10B981', text: '#FFFFFF' },
  'GRALES': { bg: '#3B82F6', text: '#FFFFFF' },
  'GRALES.': { bg: '#3B82F6', text: '#FFFFFF' },
  'PASIVO EN BASE': { bg: '#64748B', text: '#FFFFFF' },
  'SOCIO': { bg: '#6366F1', text: '#FFFFFF' },
  'TDS': { bg: '#10B981', text: '#FFFFFF' },
  'CM': { bg: '#3B82F6', text: '#FFFFFF' },
  'PP': { bg: '#8B5CF6', text: '#FFFFFF' },
  'EURO': { bg: '#F59E0B', text: '#FFFFFF' }
};

const obtenerColorServicio = (srvRaw?: string | null): { bg: string; text: string } => {
  const srv = (srvRaw || '').trim().toUpperCase();
  if (CONFIG_SERVICIOS[srv]) return CONFIG_SERVICIOS[srv];
  if (srv.includes('LIV')) return CONFIG_SERVICIOS['LIVIANO'];
  if (srv.includes('MET')) return CONFIG_SERVICIOS['METANOL'];
  if (srv.includes('GLP')) return CONFIG_SERVICIOS['GLP'];
  if (srv.includes('ABAST')) return CONFIG_SERVICIOS['ABAST'];
  if (srv.includes('CAMP')) return CONFIG_SERVICIOS['CAMPO'];
  if (srv.includes('GRAL')) return CONFIG_SERVICIOS['GRALES'];
  if (srv.includes('PASIV')) return CONFIG_SERVICIOS['PASIVO EN BASE'];
  return { bg: '#475569', text: '#FFFFFF' };
};

export const NoveltyCard: React.FC<NoveltyCardProps> = ({
  novedad,
  usuarios,
  onResolver,
  onEditar,
  onCambiarTerminal,
  onCambiarServicio,
  onAgregarMencion,
  onQuitarMencion,
  onRequestTerminalMenu
}) => {
  const { modoCartelera, setActiveDragCardId, terminales, servicios } = useDashStore();
  const [fadingOut, setFadingOut] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);

  // Dropdowns contextuales
  const [dropTerminalAbierto, setDropTerminalAbierto] = useState(false);
  const [dropServicioAbierto, setDropServicioAbierto] = useState(false);
  const [dropMencionAbierto, setDropMencionAbierto] = useState(false);
  const [textoMencion, setTextoMencion] = useState('');

  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setIsPinned(false);
        setDropTerminalAbierto(false);
        setDropServicioAbierto(false);
        setDropMencionAbierto(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleCardClick = (e: React.MouseEvent) => {
    if (modoCartelera) return;
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('input') ||
      target.closest('.btn-mention-remove') ||
      target.closest('.mention-input-wrapper')
    ) {
      return;
    }
    setIsPinned((prev) => !prev);
  };

  const handleResolverClick = () => {
    if (modoCartelera || novedad.resuelto) return;
    setFadingOut(true);
    setTimeout(() => {
      onResolver(novedad.id);
    }, 150);
  };

  const extraerDigitosPatente = (patenteRaw?: string | null): string => {
    if (!patenteRaw) return '';
    const digits = patenteRaw.replace(/\D/g, '');
    if (digits.length >= 3) return digits.slice(-3);
    return digits;
  };

  const displayUte =
    novedad.n_ute && novedad.n_ute.trim() !== '' && novedad.n_ute.trim() !== 'S/D'
      ? novedad.n_ute.trim()
      : extraerDigitosPatente(novedad.tractor) || 'S/D';

  // Formateo de timestamps: "HH:mm dd/mm" (hora y solo dd/mm sin aa/yy)
  const formatearFecha = (ts?: string, id?: string | number) => {
    let d = ts ? new Date(ts) : null;
    if (!d || isNaN(d.getTime())) {
      if (id && !isNaN(Number(id)) && Number(id) > 1000000000000) {
        d = new Date(Number(id));
      } else {
        return '';
      }
    }
    try {
      const options: Intl.DateTimeFormatOptions = {
        timeZone: 'America/Argentina/Buenos_Aires',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      };
      const formatter = new Intl.DateTimeFormat('es-AR', options);
      const parts = formatter.formatToParts(d);
      const day = (parts.find((p) => p.type === 'day')?.value || '').padStart(2, '0');
      const month = (parts.find((p) => p.type === 'month')?.value || '').padStart(2, '0');
      const hour = (parts.find((p) => p.type === 'hour')?.value || '').padStart(2, '0');
      const minute = (parts.find((p) => p.type === 'minute')?.value || '').padStart(2, '0');
      return `${hour}:${minute} ${day}/${month}`;
    } catch {
      return '';
    }
  };

  // Formateo de fecha objetivo: "dd/mm" sin año (sin aa/yy)
  const formatearFechaObjetivo = (fechaRaw?: string | null) => {
    if (!fechaRaw) return '';
    const clean = String(fechaRaw).split('T')[0].trim();
    const parts = clean.split('-');
    if (parts.length === 3) {
      const dia = parts[2].padStart(2, '0');
      const mes = parts[1].padStart(2, '0');
      return `${dia}/${mes}`;
    }
    return clean;
  };

  const usuariosFiltrados = (usuarios || [])
    .map((u) => (typeof u === 'string' ? u : u?.usuario || '').trim().toUpperCase())
    .filter(
      (u) =>
        u.length > 0 &&
        u.includes((textoMencion || '').toUpperCase()) &&
        !(novedad.menciones || []).includes(u)
    )
    .slice(0, 5);

  const esLibre = novedad.tipo_novedad === 'LIBRES';
  const srvCfg = obtenerColorServicio(novedad.srv || novedad.servicio);
  const listaOpcionesServicios = servicios && servicios.length > 0
    ? Array.from(new Set(servicios.map((s) => (s?.denominacion || '').trim().toUpperCase()).filter(Boolean)))
    : ['LIVIANO', 'METANOL', 'ABAST', 'GLP', 'CAMPO', 'GRALES', 'PASIVO EN BASE'];

  // ==========================================
  // RENDER: TARJETA TIPO "LIBRES" (CYAN #00FFFF)
  // Despliegue Horizontal Smooth: Colapsado (Figma 1076:876) vs Expandido (Figma 1072:690)
  // ==========================================
  if (esLibre) {
    const tieneDetalle = Boolean(novedad.detalle && novedad.detalle.trim().length > 0);
    const termItem = (terminales || []).find(
      (t) =>
        (novedad.terminal_id && t.id === novedad.terminal_id) ||
        (t.codigo && t.codigo.toUpperCase() === (novedad.terminal || '').toUpperCase())
    );
    const termColor = termItem
      ? {
          bg: termItem.color_bg || CONFIG_TERMINALES[termItem.codigo]?.bg || '#DD7E6B',
          text: termItem.color_text || CONFIG_TERMINALES[termItem.codigo]?.text || '#000000'
        }
      : CONFIG_TERMINALES[(novedad.terminal || '').toUpperCase().trim()];

    const isExpanded =
      !modoCartelera &&
      (isHovered || isPinned || dropTerminalAbierto || dropServicioAbierto || dropMencionAbierto);

    return (
      <article
        ref={cardRef}
        id={`card-${novedad.id}`}
        draggable={!modoCartelera}
        onDragStart={(e) => {
          if (modoCartelera) return;
          e.dataTransfer.setData('text/plain', String(novedad.id));
          e.dataTransfer.effectAllowed = 'move';
          setTimeout(() => {
            setActiveDragCardId(novedad.id);
          }, 30);
        }}
        onMouseEnter={() => !modoCartelera && setIsHovered(true)}
        onMouseLeave={() => !modoCartelera && setIsHovered(false)}
        onClick={handleCardClick}
        onKeyDown={(e) => {
          if (modoCartelera) return;
          if (e.key === 'Enter' || e.key === ' ') {
            const target = e.target as HTMLElement;
            if (target === cardRef.current) {
              e.preventDefault();
              setIsPinned((prev) => !prev);
            }
          }
        }}
        tabIndex={modoCartelera ? -1 : 0}
        role="button"
        aria-expanded={isExpanded}
        aria-label={`Unidad libre UTE ${displayUte}, ${novedad.nom || 'sin conductor asignado'}, servicio ${novedad.srv || novedad.servicio || 'sin asignar'}`}
        className={`rounded-xl relative transition-[width,min-width,max-width,box-shadow] duration-300 ease-in-out motion-reduce:transition-none shrink-0 flex items-center bg-[#00FFFF] border-0 select-none shadow-sm hover:shadow-md focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:outline-hidden ${
          modoCartelera ? 'cursor-default' : 'cursor-pointer active:cursor-grabbing'
        } ${
          isExpanded
            ? 'w-[428px] min-w-[428px] max-w-[440px] p-2.5 gap-2.5'
            : 'w-[124px] min-w-[124px] max-w-[124px] p-2 justify-center'
        } ${tieneDetalle && isExpanded ? 'min-h-[86px] h-auto' : 'h-[86px] min-h-[86px]'} ${
          fadingOut ? 'fade-out' : ''
        }`}
      >
        {/* Columna Izquierda: UTE (sin recuadro; aumento de 2px en hover/click de 46px a 48px) */}
        <div
          className={`transition-all duration-300 ease-in-out motion-reduce:transition-none flex items-center justify-center shrink-0 ${
            isExpanded ? 'px-1 bg-transparent' : 'w-full h-full'
          }`}
        >
          <span
            className={`font-black text-black leading-none tracking-tight select-none transition-all duration-300 motion-reduce:transition-none ${
              isExpanded ? 'text-[48px]' : 'text-[46px]'
            }`}
          >
            {displayUte}
          </span>
        </div>

        {/* Columna Derecha: Contenido completo con fade & slide horizontal */}
        <div
          className={`transition-all duration-200 ease-out motion-reduce:transition-none flex flex-col justify-between ${
            isExpanded
              ? 'flex-1 min-w-[310px] opacity-100 translate-x-0 pointer-events-auto delay-75'
              : 'w-0 max-w-0 opacity-0 -translate-x-2 pointer-events-none overflow-hidden'
          } ${tieneDetalle ? 'py-0.5' : 'h-[74px]'}`}
        >
          {/* Fila 1: Conductor + Botones de Acción */}
          <div className="flex items-center justify-between w-full -mt-0.5 mb-1">
            <div className="flex-1 pr-1 truncate min-w-0">
              <DriverNameBadge
                nombre={novedad.nom}
                className="bg-transparent border-black/30 text-black hover:bg-black/10 hover:border-black/50"
                textClassName="text-[13px] font-extrabold"
              />
            </div>

            {!modoCartelera && (
              <div className="flex items-center gap-1 shrink-0 -mt-1 -mr-1">
                {onEditar && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditar(novedad);
                    }}
                    className="btn-card-edit w-7 h-7 rounded-lg shrink-0 transition-all flex items-center justify-center text-black hover:bg-black/15 focus-visible:ring-2 focus-visible:ring-black focus-visible:outline-hidden cursor-pointer active:scale-95 text-xs font-bold"
                    title="Editar detalle"
                    aria-label="Editar detalle"
                  >
                    <Pencil className="w-3.5 h-3.5 stroke-[2.2]" />
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleResolverClick();
                  }}
                  disabled={novedad.resuelto}
                  className={`btn-card-resolve w-7 h-7 rounded-lg shrink-0 transition-all flex items-center justify-center text-black hover:bg-black/15 focus-visible:ring-2 focus-visible:ring-black focus-visible:outline-hidden text-xs font-bold ${
                    novedad.resuelto ? 'cursor-default opacity-50' : 'cursor-pointer active:scale-95'
                  }`}
                  title={novedad.resuelto ? 'Ocupado' : 'Asignar / Ocupar'}
                  aria-label={novedad.resuelto ? 'Unidad ocupada' : 'Asignar o marcar ocupada'}
                >
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                </button>
              </div>
            )}
          </div>

          {/* Fila 2: Badges operativos (Servicio, PatenteMercosur, Cisternado, Terminal) */}
          <div className="flex items-center gap-1 sm:gap-1.5 flex-nowrap w-max text-xs">
            {/* Servicio Chofer Real */}
            <span
              className="px-2 py-0.5 rounded text-[9px] font-black tracking-widest uppercase shrink-0 shadow-xs"
              style={{ backgroundColor: srvCfg.bg, color: srvCfg.text }}
              title={`Servicio: ${novedad.srv || novedad.servicio || 'S/A'}`}
            >
              {novedad.srv || novedad.servicio || 'S/A'}
            </span>

            {/* Tractor Patente Mercosur */}
            <PatenteMercosur patente={novedad.tractor} />

            {/* Cisternado (Aclaración: No quitar) */}
            {novedad.cisternado && (
              <span className="text-[11px] font-black text-black tracking-tight select-all shrink-0">
                {novedad.cisternado}
              </span>
            )}

            {/* Selector Terminal (Exclusivo Libres) */}
            <div className="relative">
              {novedad.terminal ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (modoCartelera) return;
                    if (onRequestTerminalMenu) {
                      onRequestTerminalMenu(novedad, e.currentTarget);
                    } else {
                      setDropTerminalAbierto(!dropTerminalAbierto);
                    }
                  }}
                  className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wide transition-transform active:scale-95 cursor-pointer flex items-center gap-1 shadow-xs shrink-0 whitespace-nowrap focus-visible:ring-2 focus-visible:ring-black focus-visible:outline-hidden"
                  style={{ backgroundColor: termColor?.bg || '#DD7E6B', color: termColor?.text || '#000000' }}
                  title="Cambiar terminal asignada"
                  aria-label={`Terminal asignada: ${novedad.terminal}. Clic para cambiar.`}
                >
                  {novedad.terminal}
                </button>
              ) : (
                !modoCartelera && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onRequestTerminalMenu) {
                        onRequestTerminalMenu(novedad, e.currentTarget);
                      } else {
                        setDropTerminalAbierto(!dropTerminalAbierto);
                      }
                    }}
                    className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wide bg-black/15 text-black hover:bg-black/25 focus-visible:ring-2 focus-visible:ring-black focus-visible:outline-hidden transition-all flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap"
                    title="Asignar terminal a unidad libre"
                    aria-label="Asignar terminal operativa a unidad libre"
                  >
                    + TERMINAL
                  </button>
                )
              )}

              {!onRequestTerminalMenu && dropTerminalAbierto && !modoCartelera && (
                <div className="absolute left-0 bottom-full mb-1 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-1.5 flex flex-col gap-1 w-36 max-h-56 overflow-y-auto custom-scrollbar animate-in fade-in duration-100">
                  {(terminales && terminales.length > 0
                    ? terminales
                    : Object.keys(CONFIG_TERMINALES).map((t) => ({
                        id: '',
                        codigo: t,
                        nombre: t,
                        color_bg: CONFIG_TERMINALES[t].bg,
                        color_text: CONFIG_TERMINALES[t].text
                      }))
                  ).map((t) => {
                    const c = {
                      bg: t.color_bg || CONFIG_TERMINALES[t.codigo]?.bg || '#475569',
                      text: t.color_text || CONFIG_TERMINALES[t.codigo]?.text || '#FFFFFF'
                    };
                    return (
                      <button
                        key={t.codigo}
                        type="button"
                        onClick={() => {
                          setDropTerminalAbierto(false);
                          onCambiarTerminal?.(novedad.id, t.codigo, t.id || null);
                        }}
                        className="px-2 py-1 rounded text-[9px] font-black uppercase text-left transition-transform active:scale-95 cursor-pointer hover:opacity-90 focus-visible:ring-2 focus-visible:ring-black focus-visible:outline-hidden"
                        style={{ backgroundColor: c.bg, color: c.text }}
                      >
                        {t.codigo}
                      </button>
                    );
                  })}
                  {novedad.terminal && (
                    <button
                      type="button"
                      onClick={() => {
                        setDropTerminalAbierto(false);
                        onCambiarTerminal?.(novedad.id, '', null);
                      }}
                      className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-slate-200 text-slate-700 hover:bg-rose-500 hover:text-white transition-colors inline-flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-black focus-visible:outline-hidden"
                    >
                      <X className="w-2.5 h-2.5 stroke-[2.5]" /> Quitar
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Detalle (si existe) */}
          {tieneDetalle && (
            <div className="mt-1 bg-black/10 rounded-lg p-2 overflow-y-auto custom-scrollbar max-h-20 border border-black/10">
              <p className="text-black text-[11px] font-extrabold font-zilla leading-tight whitespace-pre-line break-words">
                {novedad.detalle}
              </p>
            </div>
          )}

          {/* Fila 3 / Footer: Creador, Menciones, Timestamp */}
          <div className="flex items-center gap-1.5 text-[10px] font-black text-black uppercase mt-1">
            <span className="flex items-center gap-1 shrink-0">
              <User className="w-3 h-3 text-black stroke-[2.4]" aria-hidden="true" />
              <span className="truncate max-w-[80px] font-black">{novedad.creador || novedad.usuario || 'OPERADOR'}</span>
            </span>

            {/* Menciones inline */}
            {!modoCartelera && (
              <div className="relative inline-block mention-input-wrapper shrink-0" onClick={(e) => e.stopPropagation()}>
                <input
                  type="text"
                  value={textoMencion}
                  onChange={(e) => {
                    setTextoMencion(e.target.value);
                    setDropMencionAbierto(true);
                  }}
                  onFocus={() => setDropMencionAbierto(true)}
                  placeholder="@"
                  aria-label="Mencionar usuario con @"
                  className="bg-black/15 border border-black/20 rounded px-1.5 py-0.5 text-[10px] font-bold text-black w-12 outline-hidden focus-visible:ring-2 focus-visible:ring-black focus:w-16 transition-all placeholder:text-black/70"
                />

                {dropMencionAbierto && usuariosFiltrados.length > 0 && (
                  <div className="absolute z-50 bottom-full left-0 mb-1 bg-white border border-slate-200 rounded-lg shadow-2xl max-h-32 overflow-y-auto w-36 p-1">
                    {usuariosFiltrados.map((u) => (
                      <div
                        key={u}
                        onClick={() => {
                          onAgregarMencion?.(novedad.id, u);
                          setTextoMencion('');
                          setDropMencionAbierto(false);
                        }}
                        className="px-2 py-1 text-xs font-black text-slate-800 hover:bg-indigo-50 rounded cursor-pointer uppercase"
                      >
                        @{u}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Badges de menciones activas */}
            {(novedad.menciones || []).map((m) => (
              <span
                key={m}
                className="bg-black/25 text-black px-1.5 py-0.5 rounded font-black uppercase flex items-center gap-1 shrink-0 text-[9px]"
              >
                @{m}
                {!modoCartelera && onQuitarMencion && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onQuitarMencion(novedad.id, m);
                    }}
                    className="btn-mention-remove ml-0.5 hover:text-red-800 transition-colors cursor-pointer inline-flex items-center focus-visible:ring-1 focus-visible:ring-black"
                    title="Quitar mención"
                    aria-label={`Quitar mención de ${m}`}
                  >
                    <X className="w-2.5 h-2.5 stroke-[2.5]" />
                  </button>
                )}
              </span>
            ))}

            <span className="text-black/90 font-extrabold tracking-wide ml-auto flex items-center gap-1 shrink-0 whitespace-nowrap">
              <Clock className="w-3 h-3 text-black stroke-[2.4]" aria-hidden="true" />
              {formatearFecha(novedad.timestamp || novedad.creado_el, novedad.id)}
            </span>
          </div>
        </div>
      </article>
    );
  }

  // ==========================================
  // RENDER: TARJETAS KANBAN ESTÁNDAR
  // ==========================================
  let cfg = {
    bg: 'bg-slate-50/50 dark:bg-slate-900/40',
    text: 'text-slate-700 dark:text-slate-300',
    border: 'border-slate-200/50 dark:border-slate-700/50'
  };
  if (novedad.tipo_novedad === 'BAJA_DIAGRAMA')
    cfg = { bg: 'bg-red-50/50 dark:bg-red-950/20', text: 'text-red-600 dark:text-red-500', border: 'border-red-200/50 dark:border-red-900/30' };
  if (novedad.tipo_novedad === 'CERTIFICACION_UNIDAD')
    cfg = { bg: 'bg-orange-50/50 dark:bg-orange-950/20', text: 'text-orange-600 dark:text-orange-500', border: 'border-orange-200/50 dark:border-orange-900/30' };
  if (novedad.tipo_novedad === 'EXAMEN_CHOFER')
    cfg = { bg: 'bg-emerald-50/50 dark:emerald-950/20', text: 'text-emerald-600 dark:text-emerald-500', border: 'border-emerald-200/50 dark:border-emerald-900/30' };
  if (novedad.tipo_novedad === 'REPARACION')
    cfg = { bg: 'bg-indigo-50/50 dark:bg-indigo-950/20', text: 'text-indigo-600 dark:text-indigo-500', border: 'border-indigo-200/50 dark:border-indigo-900/30' };
  if (novedad.tipo_novedad === 'ESTADO_DEMORA')
    cfg = { bg: 'bg-[#D28976]/10 dark:bg-[#D28976]/20', text: 'text-[#D28976]', border: 'border-[#D28976]/30' };

  return (
    <article
      ref={cardRef}
      id={`card-${novedad.id}`}
      className={`rounded-xl border p-4 relative transition-all duration-300 w-full flex flex-col shrink-0 select-none ${
        novedad.resuelto
          ? 'bg-emerald-50/20 dark:bg-emerald-950/10 border-emerald-200/50 dark:border-emerald-900/30 opacity-75'
          : 'bg-white dark:bg-[#0f172a] border-slate-200 dark:border-slate-800/80 shadow-none hover:border-slate-300 dark:hover:border-slate-700'
      } ${fadingOut ? 'fade-out' : ''}`}
    >
      <div className="flex flex-col w-full mb-2">
        {/* Header: Conductor y Acciones */}
        <div className="flex items-start justify-between w-full -mt-1 mb-1">
          <h3
            className={`font-extrabold ${
              novedad.resuelto
                ? 'text-emerald-900 dark:text-emerald-400'
                : 'text-slate-900 dark:text-white'
            } text-sm sm:text-base leading-tight uppercase truncate flex-1 pr-2 tracking-tight`}
          >
            {novedad.nom || 'SIN CONDUCTOR'}
          </h3>

          {!modoCartelera && (
            <div className="flex items-center gap-1.5 shrink-0 -mt-1 -mr-1">
              <button
                onClick={handleResolverClick}
                disabled={novedad.resuelto}
                className={`btn-card-resolve w-7 h-7 rounded-lg border border-transparent shrink-0 transition-all flex items-center justify-center ${
                  novedad.resuelto
                    ? 'bg-emerald-500/20 text-emerald-500 cursor-default'
                    : 'bg-slate-100 dark:bg-slate-800 hover:bg-emerald-500 hover:text-white text-slate-400 dark:text-slate-500 cursor-pointer active:scale-95'
                }`}
                title={novedad.resuelto ? 'Resuelto' : 'Marcar como resuelto'}
              >
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              </button>

              {onEditar && (
                <button
                  onClick={() => onEditar(novedad)}
                  className="btn-card-edit w-7 h-7 rounded-lg border border-transparent shrink-0 transition-all flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:text-indigo-500 dark:hover:text-indigo-400 text-slate-400 dark:text-slate-500 cursor-pointer active:scale-95 text-xs"
                  title="Editar detalle"
                >
                  <Pencil className="w-3.5 h-3.5 stroke-[2]" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Badges operativos (Servicio, UTE, Tractor, Fecha Objetivo) */}
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          {/* Dropdown Servicio */}
          <div className="relative">
            <button
              type="button"
              onClick={() => !modoCartelera && setDropServicioAbierto(!dropServicioAbierto)}
              className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wide transition-transform active:scale-95 cursor-pointer flex items-center gap-1 shadow-xs"
              style={{ backgroundColor: srvCfg.bg, color: srvCfg.text }}
              title="Cambiar Servicio de Chofer"
            >
              {novedad.srv && novedad.srv !== 'S/A' ? novedad.srv : 'S/A'}
            </button>

            {dropServicioAbierto && !modoCartelera && (
              <div className="absolute left-0 bottom-full mb-1 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-1.5 flex flex-col gap-1 w-36 max-h-56 overflow-y-auto custom-scrollbar animate-in fade-in duration-100">
                <div className="px-2 py-1 text-[8px] font-black uppercase text-slate-400 border-b border-slate-100 dark:border-slate-800 tracking-wider">
                  Servicio Chofer
                </div>
                {listaOpcionesServicios.map((s) => {
                  const c = obtenerColorServicio(s);
                  const esActivo = (novedad.srv || '').toUpperCase() === s.toUpperCase();
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setDropServicioAbierto(false);
                        onCambiarServicio?.(novedad.id, s);
                      }}
                      className={`px-2 py-1 rounded text-[9px] font-black uppercase text-left cursor-pointer transition-transform active:scale-95 flex items-center justify-between ${
                        esActivo ? 'ring-2 ring-cyan-500' : ''
                      }`}
                      style={{ backgroundColor: c.bg, color: c.text }}
                    >
                      <span>{s}</span>
                      {esActivo && <Check className="w-2.5 h-2.5 stroke-[2.5]" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* UTE */}
          {novedad.n_ute && novedad.n_ute !== 'S/D' && (
            <span className="border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0.5 text-[9px] font-black text-slate-700 dark:text-slate-300 uppercase">
              {novedad.n_ute}
            </span>
          )}

          {/* Tractor Patente Mercosur */}
          <PatenteMercosur patente={novedad.tractor} />

          {/* Fecha Objetivo */}
          {novedad.fecha_objetivo && (
            <span
              className={`px-1.5 py-0.5 text-[9px] font-black ${cfg.text} whitespace-nowrap rounded border ${cfg.border} inline-flex items-center`}
              title={`Fecha Objetivo: ${formatearFechaObjetivo(novedad.fecha_objetivo)}`}
            >
              {formatearFechaObjetivo(novedad.fecha_objetivo)}
            </span>
          )}
        </div>
      </div>

      {/* Detalle */}
      {novedad.detalle && novedad.detalle.trim() && (
        <div className={`${cfg.bg} border ${cfg.border} rounded-lg p-3 mb-3`}>
          <p
            className={`${cfg.text} text-xs font-semibold font-zilla leading-relaxed whitespace-pre-wrap break-words`}
          >
            {novedad.detalle}
          </p>
        </div>
      )}

      {/* Footer: Creador, Menciones, Timestamp */}
      <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-bold text-slate-400 dark:text-slate-500 mt-auto">
        <span className="uppercase flex items-center gap-1 shrink-0" title="Creador">
          <User className="w-2.5 h-2.5 shrink-0 opacity-70 stroke-[2.2]" /> {novedad.creador || novedad.usuario || 'Anónimo'}
        </span>

        {/* Input Menciones Inline */}
        {!modoCartelera && (
          <div className="relative inline-block mention-input-wrapper">
            <input
              type="text"
              value={textoMencion}
              onChange={(e) => {
                setTextoMencion(e.target.value);
                setDropMencionAbierto(true);
              }}
              onFocus={() => setDropMencionAbierto(true)}
              placeholder="@"
              className="bg-transparent border border-dashed border-slate-300 dark:border-slate-700 rounded px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:text-slate-300 w-16 outline-none focus:border-indigo-400 focus:w-24 transition-all placeholder:text-slate-400"
            />

            {dropMencionAbierto && usuariosFiltrados.length > 0 && (
              <div className="absolute z-50 bottom-full left-0 mb-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xl max-h-32 overflow-y-auto w-36 p-1">
                {usuariosFiltrados.map((u) => (
                  <div
                    key={u}
                    onClick={() => {
                      onAgregarMencion?.(novedad.id, u);
                      setTextoMencion('');
                      setDropMencionAbierto(false);
                    }}
                    className="px-2 py-1 text-xs font-black text-slate-800 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-slate-800 rounded cursor-pointer uppercase"
                  >
                    @{u}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Menciones Activas */}
        {(novedad.menciones || []).map((m) => (
          <span
            key={m}
            className="bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-md font-black uppercase flex items-center gap-1"
          >
            @{m}
            {!modoCartelera && onQuitarMencion && (
              <button
                onClick={() => onQuitarMencion(novedad.id, m)}
                className="btn-mention-remove ml-1 hover:text-rose-500 transition-colors cursor-pointer inline-flex items-center"
                title="Quitar mención"
              >
                <X className="w-2.5 h-2.5 stroke-[2.5]" />
              </button>
            )}
          </span>
        ))}

        <span className="shrink-0 flex items-center gap-1 tracking-wider ml-auto">
          <Clock className="w-3 h-3 shrink-0 text-slate-400 dark:text-slate-500 stroke-[2]" />
          {formatearFecha(novedad.timestamp || novedad.creado_el, novedad.id)}
        </span>
      </div>
    </article>
  );
};
