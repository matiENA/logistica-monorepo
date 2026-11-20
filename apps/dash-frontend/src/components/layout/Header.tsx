import React, { useState, useEffect } from 'react';
import { Clock, Sun, Moon, LayoutGrid, Archive, User, AtSign, Plus } from 'lucide-react';
import { useDashStore } from '../../store/useDashStore';
import { VistaTab, puedeEditar } from '../../types/dash';
import { AuthDropdown } from './AuthDropdown';

export const Header: React.FC = () => {
  const {
    vistaActual,
    setVistaActual,
    modoCartelera,
    modoCarteleraOrigen,
    toggleModoCartelera,
    darkMode,
    toggleDarkMode,
    sesion,
    setNovedadEnEdicion,
    setModalNuevaAbierto
  } = useDashStore();
  const [horaArgentina, setHoraArgentina] = useState('--:--');

  useEffect(() => {
    const actualizarReloj = () => {
      try {
        const ahora = new Date();
        const formatter = new Intl.DateTimeFormat('es-AR', {
          timeZone: 'America/Argentina/Buenos_Aires',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
        setHoraArgentina(formatter.format(ahora));
      } catch {
        const d = new Date();
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        setHoraArgentina(`${hh}:${mm}`);
      }
    };

    actualizarReloj();
    const interval = setInterval(actualizarReloj, 1000);
    return () => clearInterval(interval);
  }, []);

  const userCanEdit = puedeEditar(sesion);

  const handleCrearNovedad = () => {
    if (!sesion || !sesion.usuario) {
      alert('Debe iniciar sesión para reportar una novedad.');
      return;
    }
    if (!userCanEdit) {
      alert('Su usuario no tiene permisos para crear novedades (modo solo lectura).');
      return;
    }
    setNovedadEnEdicion(null);
    setModalNuevaAbierto(true);
  };

  const tabs: { id: VistaTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'todas', label: 'Todas', icon: LayoutGrid },
    { id: 'archivo', label: 'Archivo', icon: Archive },
    { id: 'mis_novedades', label: 'Mis Novedades', icon: User },
    { id: 'menciones', label: '', icon: AtSign }
  ];

  return (
    <header className="glass-header bg-white/85 dark:bg-slate-900/85 px-4 sm:px-8 py-2.5 shadow-sm z-40 shrink-0 border-b border-slate-200/80 dark:border-slate-800/80 transition-colors duration-300 sticky top-0">
      <div className="relative flex flex-wrap md:flex-nowrap justify-between items-center w-full gap-4 mx-auto min-h-[36px]">
        {/* Izquierda: Selector de Vista + Botón Nueva Novedad (Transición suave en Modo Cartelera) */}
        <div
          aria-hidden={modoCartelera}
          className={`flex items-center gap-2 shrink-0 z-10 overflow-hidden transition-[opacity,transform,max-width] duration-300 ease-out motion-reduce:transition-none ${
            modoCartelera
              ? 'opacity-0 -translate-x-3 max-w-0 pointer-events-none select-none'
              : 'opacity-100 translate-x-0 max-w-[600px] w-full md:w-auto pointer-events-auto'
          }`}
        >
          <div className="h-9 flex items-center bg-slate-200/60 dark:bg-slate-900/90 p-1 rounded-xl shadow-inner w-full md:w-auto border border-slate-300/40 dark:border-slate-800/80 shrink-0 justify-center gap-0.5">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const activo = vistaActual === tab.id;
              const accessibleLabel = tab.id === 'menciones' ? 'Menciones' : tab.label;
              return (
                <button
                  key={tab.id}
                  onClick={() => setVistaActual(tab.id)}
                  tabIndex={modoCartelera ? -1 : 0}
                  aria-label={accessibleLabel}
                  title={accessibleLabel}
                  className={`h-full flex-1 px-3.5 font-extrabold text-xs rounded-lg transition-all duration-200 text-center whitespace-nowrap cursor-pointer flex items-center justify-center gap-1.5 ${
                    activo
                      ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 stroke-[2] ${activo ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'}`} />
                  {tab.label ? <span>{tab.label}</span> : null}
                </button>
              );
            })}
          </div>

          {/* Botón Principal Nueva Novedad (+) solo para usuarios con permisos de edición */}
          {userCanEdit && (
            <button
              id="btn-nueva-novedad-header"
              onClick={handleCrearNovedad}
              tabIndex={modoCartelera ? -1 : 0}
              className="h-9 px-3.5 bg-gradient-to-tr from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl shadow-sm shadow-indigo-600/30 flex items-center justify-center gap-1.5 font-extrabold text-xs active:scale-95 transition-all duration-200 border border-indigo-400/30 group cursor-pointer shrink-0"
              title="Reportar nueva novedad"
              aria-label="Reportar nueva novedad"
            >
              <Plus className="w-4 h-4 stroke-[2.5] group-hover:rotate-90 transition-transform duration-300" />
              <span className="hidden sm:inline">Nueva</span>
            </button>
          )}
        </div>

        {/* Centro: Reloj Digital Argentina (24H - Roboto Mono) */}
        <div
          data-cartelera-control="true"
          onClick={() => {
            if (modoCartelera) toggleModoCartelera();
          }}
          className={`font-mono font-extrabold tracking-wider shrink-0 select-none drop-shadow-sm flex items-center justify-center gap-2 transition-[transform,color] duration-300 ease-out motion-reduce:transition-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-auto text-2xl sm:text-3xl text-slate-900 dark:text-white px-4 py-1 ${
            modoCartelera ? 'scale-110 cursor-pointer' : 'scale-100 cursor-default'
          }`}
          style={{ fontFamily: "'Roboto Mono', monospace" }}
          title={modoCartelera ? 'Modo Cartelera activo: Haz clic para salir' : 'Reloj Argentina 24h'}
        >
          <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-500 dark:text-indigo-400 stroke-[2.2] shrink-0" />
          <span className="tabular-nums">{horaArgentina}</span>
        </div>

        {/* Derecha: Acciones, Switch Cartelera, Modo Oscuro, Auth */}
        <div className="flex items-center gap-2.5 shrink-0 ml-auto z-10">
          {/* Botón Modo Cartelera */}
          <button
            data-cartelera-control="true"
            onClick={toggleModoCartelera}
            className={`h-9 px-3.5 rounded-xl transition-all border active:scale-95 shadow-sm text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer shrink-0 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-hidden ${
              modoCartelera
                ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-600 dark:text-emerald-400'
                : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-slate-200/60 dark:border-slate-700/60 hover:text-slate-900 dark:hover:text-white'
            }`}
            title={
              modoCartelera
                ? modoCarteleraOrigen === 'idle'
                  ? 'Modo Cartelera automático (clic o tecla para volver a edición)'
                  : 'Modo Cartelera activo (clic o tecla para volver a edición)'
                : 'Alternar Modo Cartelera (automático tras 60s sin interacción)'
            }
            aria-label="Alternar Modo Cartelera"
          >
            <span
              className={`w-2 h-2 rounded-full transition-all ${
                modoCartelera
                  ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50 animate-pulse'
                  : 'bg-slate-400'
              }`}
            ></span>
            <span className="hidden sm:inline">Cartelera</span>
          </button>

          {/* Botón Dark Mode */}
          <button
            data-cartelera-ignore="true"
            onClick={toggleDarkMode}
            className="h-9 w-9 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-700/80 transition-all focus:outline-none border border-slate-200/60 dark:border-slate-700/60 active:scale-95 shadow-sm cursor-pointer flex items-center justify-center shrink-0"
            title={darkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            aria-label={darkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          >
            {darkMode ? (
              <Sun className="w-4 h-4 stroke-[2.2]" />
            ) : (
              <Moon className="w-4 h-4 stroke-[2.2]" />
            )}
          </button>

          {/* Autenticación (Transición suave en Modo Cartelera) */}
          <div
            aria-hidden={modoCartelera}
            className={`overflow-hidden transition-[opacity,transform,max-width,margin] duration-300 ease-out motion-reduce:transition-none ${
              modoCartelera
                ? 'opacity-0 translate-x-3 max-w-0 -ml-2.5 pointer-events-none select-none'
                : 'opacity-100 translate-x-0 max-w-[360px] pointer-events-auto'
            }`}
          >
            <AuthDropdown />
          </div>
        </div>
      </div>
    </header>
  );
};
