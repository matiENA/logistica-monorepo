import React, { useState, useEffect } from 'react';
import { X, ArrowLeft, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { FlotaItem, Novedad, TipoNovedadItem } from '../../types/dash';
import { api } from '../../services/api';
import { useDashStore } from '../../store/useDashStore';
import { formatearPatente, PatenteMercosur } from '../common/PatenteMercosur';

interface NoveltyModalProps {
  abierto: boolean;
  flota: FlotaItem[];
  novedadEnEdicion: Novedad | null;
  onCerrar: () => void;
  onGuardadoExitoso: () => void;
}

const CONFIG_CLASIFICACIONES_FALLBACK: Record<
  string,
  { titulo: string; bg: string; text: string; bgHex: string; textHex: string }
> = {
  LIBRES: { titulo: 'Libres', bg: 'bg-[#00FFFF]', text: 'text-slate-950', bgHex: '#00FFFF', textHex: '#020617' },
  CERTIFICACION_UNIDAD: { titulo: 'Certificación de unidad', bg: 'bg-[#FFAE42]', text: 'text-slate-950', bgHex: '#FFAE42', textHex: '#020617' },
  REPARACION: { titulo: 'Reparaciones requeridas', bg: 'bg-[#6366F1]', text: 'text-white', bgHex: '#6366F1', textHex: '#FFFFFF' },
  BAJA_DIAGRAMA: { titulo: 'Baja / Término de diagrama', bg: 'bg-[#EF4444]', text: 'text-white', bgHex: '#EF4444', textHex: '#FFFFFF' },
  ESTADO_DEMORA: { titulo: 'Estado / Demora', bg: 'bg-[#D28976]', text: 'text-white', bgHex: '#D28976', textHex: '#FFFFFF' },
  EXAMEN_CHOFER: { titulo: 'Exámenes / Vencimientos', bg: 'bg-[#10B981]', text: 'text-white', bgHex: '#10B981', textHex: '#FFFFFF' }
};

export const NoveltyModal: React.FC<NoveltyModalProps> = ({
  abierto,
  flota,
  novedadEnEdicion,
  onCerrar,
  onGuardadoExitoso
}) => {
  const { sesion, terminales: terminalesCatalogo, tiposNovedad } = useDashStore();
  const [paso, setPaso] = useState<1 | 2>(1);

  // Form Fields
  const [tipo, setTipo] = useState<string>('LIBRES');
  const [tipoId, setTipoId] = useState<string | null>(null);
  const [nom, setNom] = useState('');
  const [tractor, setTractor] = useState('');
  const [choferId, setChoferId] = useState<string | null>(null);
  const [unidadId, setUnidadId] = useState<string | null>(null);
  const [srv, setSrv] = useState('S/A');
  const [nUte, setNUte] = useState('S/D');
  const [terminal, setTerminal] = useState('');
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [fechaObjetivo, setFechaObjetivo] = useState<string | null>(null);
  const [detalle, setDetalle] = useState('');
  const [checkVtv, setCheckVtv] = useState(false);
  const [checkMass, setCheckMass] = useState(false);

  // Calendar State
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());

  // Autocomplete Flota
  const [filtroChofer, setFiltroChofer] = useState('');
  const [mostrarDropFlota, setMostrarDropFlota] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (novedadEnEdicion) {
      setPaso(2);
      setTipo(novedadEnEdicion.tipo_novedad || 'LIBRES');
      setTipoId(novedadEnEdicion.tipo_novedad_id || null);
      setNom(novedadEnEdicion.nom || '');
      setTractor(novedadEnEdicion.tractor || '');
      setChoferId(novedadEnEdicion.chofer_id || null);
      setUnidadId(novedadEnEdicion.unidad_id || null);
      setSrv(novedadEnEdicion.srv || novedadEnEdicion.servicio || 'S/A');
      setNUte(novedadEnEdicion.n_ute || 'S/D');
      if (novedadEnEdicion.tipo_novedad === 'LIBRES') {
        setTerminal(novedadEnEdicion.terminal || '');
        setTerminalId(novedadEnEdicion.terminal_id || null);
      } else {
        setTerminal('');
        setTerminalId(null);
      }
      setFechaObjetivo(novedadEnEdicion.fecha_objetivo || null);
      setDetalle(novedadEnEdicion.detalle || '');

      if (novedadEnEdicion.fecha_objetivo) {
        const parts = novedadEnEdicion.fecha_objetivo.split('-');
        if (parts.length === 3) {
          setCalendarMonth(new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1));
        }
      }
    } else {
      setPaso(1);
      setTipo('LIBRES');
      const tipoLibre = tiposNovedad?.find(t => t.codigo === 'LIBRES');
      setTipoId(tipoLibre?.id || null);
      setNom('');
      setTractor('');
      setChoferId(null);
      setUnidadId(null);
      setSrv('S/A');
      setNUte('S/D');
      setTerminal('');
      setTerminalId(null);
      setFechaObjetivo(null);
      setDetalle('');
      setCheckVtv(false);
      setCheckMass(false);
      setCalendarMonth(new Date());
    }
  }, [novedadEnEdicion, abierto, tiposNovedad]);

  if (!abierto) return null;

  const listaTipos: TipoNovedadItem[] = (tiposNovedad && tiposNovedad.length > 0)
    ? tiposNovedad
    : Object.keys(CONFIG_CLASIFICACIONES_FALLBACK).map(catKey => {
        const c = CONFIG_CLASIFICACIONES_FALLBACK[catKey];
        return {
          id: '',
          codigo: catKey,
          titulo: c.titulo,
          bg_color: c.bgHex,
          text_color: c.textHex,
          requiere_fecha_objetivo: catKey === 'BAJA_DIAGRAMA' || catKey === 'CERTIFICACION_UNIDAD' || catKey === 'EXAMEN_CHOFER',
          imprime_nota_movimientos: catKey === 'BAJA_DIAGRAMA',
          activo: true,
          orden: 0
        };
      });

  const tipoItemActual = listaTipos.find(t => t.codigo === tipo) || {
    id: '',
    codigo: tipo,
    titulo: 'Reportar Novedad',
    bg_color: '#6366F1',
    text_color: '#FFFFFF',
    requiere_fecha_objetivo: false,
    imprime_nota_movimientos: false,
    activo: true,
    orden: 0
  };

  const seleccionarClasificacion = (tipoItem: TipoNovedadItem | { codigo: string; id?: string }) => {
    setTipo(tipoItem.codigo);
    setTipoId(tipoItem.id || null);
    if (tipoItem.codigo !== 'LIBRES') {
      setTerminal('');
      setTerminalId(null);
    }
    setPaso(2);
  };

  const seleccionarChofer = (item: FlotaItem) => {
    setNom(item.nom || '');
    setTractor(formatearPatente(item.tractor));
    setChoferId(item.chofer_id || null);
    setUnidadId(item.unidad_id || null);
    setSrv(item.srv || item.srv_chofer || 'S/A');
    setNUte(item.n_ute || 'S/D');
    setMostrarDropFlota(false);
    setFiltroChofer('');
  };

  const flotaFiltrada = flota
    .filter((f) => {
      const q = filtroChofer.toLowerCase().trim();
      if (!q) return true;
      return (
        (f.nom && f.nom.toLowerCase().includes(q)) ||
        (f.tractor && f.tractor.toLowerCase().includes(q))
      );
    })
    .slice(0, 20);

  // Lógica de Calendario Desplegado
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const nombresMeses = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  let firstDay = new Date(year, month, 1).getDay();
  firstDay = firstDay === 0 ? 6 : firstDay - 1; // 0=Lun ... 6=Dom
  const totalDays = new Date(year, month + 1, 0).getDate();

  const hoyDate = new Date();
  const hoyISO = `${hoyDate.getFullYear()}-${String(hoyDate.getMonth() + 1).padStart(2, '0')}-${String(hoyDate.getDate()).padStart(2, '0')}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);

    let detalleFinal = detalle.trim();
    if (tipo === 'CERTIFICACION_UNIDAD') {
      const checks = [];
      if (checkVtv) checks.push('VTV');
      if (checkMass) checks.push('MASS');
      if (checks.length > 0) {
        detalleFinal = `[${checks.join(' / ')}]\n\n${detalleFinal}`.trim();
      }
    }

    const esLibre = tipo === 'LIBRES';
    let finalTipoId = tipoId;
    if (!finalTipoId && tiposNovedad && tiposNovedad.length > 0) {
      const match = tiposNovedad.find(t => t.codigo === tipo);
      if (match) finalTipoId = match.id;
    }

    const payload = {
      chofer_id: choferId,
      unidad_id: unidadId,
      terminal_id: esLibre ? terminalId : null,
      nom: nom.trim().toUpperCase(),
      tractor: tractor.trim().toUpperCase(),
      srv,
      n_ute: nUte,
      tipo_novedad: tipo,
      tipo_novedad_id: finalTipoId || null,
      tipo_novedad_titulo: tipoItemActual.titulo,
      terminal: esLibre ? terminal : '',
      fecha_objetivo: fechaObjetivo && fechaObjetivo.trim() !== '' ? fechaObjetivo.trim() : null,
      detalle: detalleFinal,
      creado_por_id: sesion?.id || null,
      creador: sesion?.usuario || 'OPERADOR'
    };

    try {
      if (novedadEnEdicion) {
        await api.despacharNovedad({
          action: 'editar',
          id_novedad: novedadEnEdicion.id,
          payload
        });
      } else {
        await api.despacharNovedad({
          action: 'nueva',
          payload
        });
      }
      onGuardadoExitoso();
      onCerrar();
    } catch (err: any) {
      alert(`Error al guardar novedad: ${err.message}`);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-[100] flex flex-col justify-end md:justify-center items-center p-0 md:p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 w-full md:w-[520px] rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[92vh] flex flex-col border border-slate-200/80 dark:border-slate-800/80 overflow-hidden">
        {/* PASO 1: SELECCIÓN DE CLASIFICACIÓN */}
        {paso === 1 && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex justify-between items-center p-5 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <div>
                <h2 className="text-xl font-black text-slate-900 dark:text-white">
                  Reportar novedad
                </h2>
                <p className="text-xs font-bold text-slate-400 dark:text-slate-500 mt-0.5">
                  Seleccione la clasificación principal para comenzar.
                </p>
              </div>
              <button
                type="button"
                onClick={onCerrar}
                className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-xl transition-colors cursor-pointer flex items-center justify-center"
              >
                <X className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>

            <div className="p-5 grid grid-cols-2 gap-3.5 overflow-y-auto custom-scrollbar max-h-[70vh]">
              {listaTipos.map((c) => {
                const bgStyle = c.bg_color?.startsWith('#')
                  ? { backgroundColor: c.bg_color, color: c.text_color || '#FFFFFF' }
                  : undefined;
                return (
                  <button
                    key={c.codigo}
                    type="button"
                    onClick={() => seleccionarClasificacion(c)}
                    style={bgStyle}
                    className="h-20 rounded-2xl font-black p-4 flex items-center justify-start transition-all hover:scale-[1.02] active:scale-[0.98] shadow-sm cursor-pointer text-left bg-indigo-600 text-white"
                  >
                    <span className="text-sm font-black leading-tight">
                      {c.titulo}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* PASO 2: FORMULARIO DE NOVEDAD */}
        {paso === 2 && (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Header Adaptativo */}
            <div
              style={
                tipoItemActual.bg_color?.startsWith('#')
                  ? { backgroundColor: tipoItemActual.bg_color, color: tipoItemActual.text_color || '#FFFFFF' }
                  : undefined
              }
              className="flex justify-between items-center p-4 transition-colors duration-300 shrink-0 bg-indigo-600 text-white"
            >
              {!novedadEnEdicion && (
                <button
                  type="button"
                  onClick={() => setPaso(1)}
                  className="p-1.5 hover:bg-black/10 rounded-xl transition-colors flex items-center gap-1.5 font-extrabold text-xs cursor-pointer"
                  title="Volver a clasificaciones"
                >
                  <ArrowLeft className="w-4 h-4 stroke-[2.5]" />
                  <span>Volver</span>
                </button>
              )}
              <h2 className="text-sm font-black uppercase tracking-wide text-center truncate mx-2 flex-1">
                {novedadEnEdicion ? `EDITAR: ${nom || 'NOVEDAD'}` : tipoItemActual.titulo}
              </h2>
              <button
                type="button"
                onClick={onCerrar}
                className="p-1.5 hover:bg-black/10 rounded-xl transition-colors font-bold cursor-pointer flex items-center justify-center"
              >
                <X className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>

            {/* Formulario */}
            <form
              onSubmit={handleSubmit}
              className="p-5 flex-1 overflow-y-auto flex flex-col gap-4 custom-scrollbar"
            >
              {/* Autocomplete Chofer / Unidad */}
              <div className="relative">
                <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5 block">
                  Buscar Conductor / Patente
                </label>
                <input
                  type="text"
                  value={nom || filtroChofer}
                  onChange={(e) => {
                    setNom(e.target.value);
                    setFiltroChofer(e.target.value);
                    setMostrarDropFlota(true);
                  }}
                  onFocus={() => setMostrarDropFlota(true)}
                  placeholder="Escriba nombre o tractor..."
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-sm font-bold text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none uppercase shadow-sm"
                  required
                />

                {mostrarDropFlota && flotaFiltrada.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl max-h-56 overflow-y-auto custom-scrollbar">
                    {flotaFiltrada.map((item) => (
                      <div
                        key={`${item.nom}-${item.tractor}`}
                        onClick={() => seleccionarChofer(item)}
                        className="p-2.5 border-b border-slate-100 dark:border-slate-800 hover:bg-indigo-50 dark:hover:bg-slate-800/80 cursor-pointer flex justify-between items-center text-xs"
                      >
                        <div>
                          <span className="font-extrabold text-slate-800 dark:text-slate-200 uppercase">
                            {item.nom}
                          </span>
                          <span className="text-[10px] text-slate-400 block">
                            UTE: {item.n_ute || 'S/D'}
                          </span>
                        </div>
                        <div className="flex flex-col items-end shrink-0 gap-1 ml-2">
                          <PatenteMercosur patente={item.tractor} />
                          <span className="text-[9px] block text-slate-400 dark:text-slate-500 uppercase font-bold">
                            {item.srv || item.srv_chofer || 'S/A'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Grid: Tractor y Servicio */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5 block">
                    Tractor
                  </label>
                  <input
                    type="text"
                    value={tractor}
                    onChange={(e) => setTractor(e.target.value)}
                    placeholder="Dominio"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-sm font-bold text-slate-800 dark:text-slate-200 uppercase outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5 block">
                    Servicio
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={srv}
                    className="w-full bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-sm font-black text-slate-700 dark:text-slate-300 outline-none text-center uppercase cursor-default opacity-90 select-none shadow-inner"
                  />
                </div>
              </div>

              {/* Selección de Terminal (Radio Buttons) — Exclusivo para LIBRES */}
              {tipo === 'LIBRES' && (
                <div className="flex flex-col gap-1.5 py-1">
                  <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block">
                    Terminal
                  </label>
                  <div className="flex items-center gap-4 flex-wrap">
                    {(terminalesCatalogo && terminalesCatalogo.length > 0
                      ? terminalesCatalogo.map(t => ({ id: t.id, codigo: t.codigo }))
                      : [
                          { id: '', codigo: 'DOCK SUD' },
                          { id: '', codigo: 'TVM' },
                          { id: '', codigo: 'TPH' },
                          { id: '', codigo: 'TLC' }
                        ]
                    ).map((t) => {
                      const seleccionado = (terminalId && t.id && terminalId === t.id) || terminal === t.codigo;
                      return (
                        <label
                          key={t.codigo}
                          onClick={() => {
                            if (seleccionado) {
                              setTerminal('');
                              setTerminalId(null);
                            } else {
                              setTerminal(t.codigo);
                              setTerminalId(t.id || null);
                            }
                          }}
                          className="flex items-center gap-2 cursor-pointer group select-none"
                        >
                          <div
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all bg-white dark:bg-slate-900 ${
                              seleccionado
                                ? 'border-indigo-600 dark:border-indigo-400'
                                : 'border-slate-400 dark:border-slate-600 group-hover:border-indigo-500'
                            }`}
                          >
                            {seleccionado && (
                              <div className="w-2.5 h-2.5 rounded-full bg-indigo-600 dark:bg-indigo-400"></div>
                            )}
                          </div>
                          <span className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wide">
                            {t.codigo}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Calendario Desplegado Mensual Integrado */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block flex items-center justify-between">
                  <span>Fecha Objetivo / Vencimiento</span>
                  {tipoItemActual.requiere_fecha_objetivo && (
                    <span className="text-amber-500 dark:text-amber-400 font-extrabold text-[9px] tracking-normal">
                      REQUERIDO
                    </span>
                  )}
                </label>

                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <button
                      type="button"
                      onClick={() =>
                        setCalendarMonth(new Date(year, month - 1, 1))
                      }
                      className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors cursor-pointer flex items-center justify-center"
                    >
                      <ChevronLeft className="w-4 h-4 stroke-[2.5]" />
                    </button>
                    <span className="font-black text-sm text-slate-800 dark:text-white capitalize tracking-wide flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-indigo-500 stroke-[2.2]" />
                      <span>{nombresMeses[month]} {year}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setCalendarMonth(new Date(year, month + 1, 1))
                      }
                      className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors cursor-pointer flex items-center justify-center"
                    >
                      <ChevronRight className="w-4 h-4 stroke-[2.5]" />
                    </button>
                  </div>

                  <div className="grid grid-cols-7 text-center text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                    <span>L</span>
                    <span>M</span>
                    <span>M</span>
                    <span>J</span>
                    <span>V</span>
                    <span>S</span>
                    <span>D</span>
                  </div>

                  <div className="grid grid-cols-7 gap-1 text-center text-xs font-bold">
                    {Array.from({ length: firstDay }).map((_, i) => (
                      <div key={`empty-${i}`} className="h-8"></div>
                    ))}
                    {Array.from({ length: totalDays }).map((_, i) => {
                      const day = i + 1;
                      const mm = String(month + 1).padStart(2, '0');
                      const dd = String(day).padStart(2, '0');
                      const currentISO = `${year}-${mm}-${dd}`;
                      const isSelected = fechaObjetivo === currentISO;
                      const isToday = hoyISO === currentISO;

                      let btnStyle =
                        'h-8 w-8 rounded-full flex items-center justify-center mx-auto transition-all cursor-pointer ';
                      if (isSelected) {
                        btnStyle +=
                          'bg-indigo-600 dark:bg-indigo-500 text-white font-black shadow-md scale-105';
                      } else if (isToday) {
                        btnStyle +=
                          'border-2 border-indigo-500 text-indigo-600 dark:text-indigo-400 font-extrabold';
                      } else {
                        btnStyle +=
                          'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 font-bold';
                      }

                      return (
                        <button
                          key={currentISO}
                          type="button"
                          onClick={() =>
                            setFechaObjetivo(isSelected ? null : currentISO)
                          }
                          className={btnStyle}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Checkboxes de Certificaciones si es CERTIFICACION_UNIDAD */}
              {tipo === 'CERTIFICACION_UNIDAD' && (
                <div className="flex items-center gap-6 mt-1">
                  <label className="flex items-center gap-2.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={checkVtv}
                      onChange={(e) => setCheckVtv(e.target.checked)}
                      className="w-5 h-5 rounded accent-indigo-600 cursor-pointer"
                    />
                    <span className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                      VTV
                    </span>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={checkMass}
                      onChange={(e) => setCheckMass(e.target.checked)}
                      className="w-5 h-5 rounded accent-indigo-600 cursor-pointer"
                    />
                    <span className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                      MASS
                    </span>
                  </label>
                </div>
              )}

              {/* Detalle / Observaciones */}
              <div>
                <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5 block">
                  Detalle / Notas
                </label>
                <textarea
                  rows={3}
                  value={detalle}
                  onChange={(e) => setDetalle(e.target.value)}
                  placeholder="Describa el requerimiento..."
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-sm font-medium font-zilla text-slate-800 dark:text-slate-200 outline-none resize-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Botón Submit */}
              <button
                type="submit"
                disabled={enviando}
                className="mt-2 w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-extrabold text-xs uppercase tracking-widest p-4 rounded-xl shadow-lg shadow-indigo-600/20 transition-all disabled:opacity-50 cursor-pointer active:scale-[0.98]"
              >
                {enviando
                  ? 'Guardando...'
                  : novedadEnEdicion
                  ? 'Guardar Cambios'
                  : 'Publicar Novedad'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
