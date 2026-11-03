import React, { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useDash } from './hooks/useDash';
import { useDashStore } from './store/useDashStore';
import { Header } from './components/layout/Header';
import { KanbanBoard } from './components/kanban/KanbanBoard';
import { ServiceDropOverlay } from './components/kanban/ServiceDropOverlay';
import { NoveltyModal } from './components/modals/NoveltyModal';
import { LoginWall } from './components/layout/LoginWall';
import { Toaster, toast } from 'sonner';

export const App: React.FC = () => {
  const {
    novedades,
    flota,
    usuarios,
    retornos,
    cargando,
    error,
    recargar,
    resolverNovedad,
    asignarTerminal,
    asignarServicio,
    gestionarMencion
  } = useDash();

  const {
    sesion,
    modalNuevaAbierto,
    setModalNuevaAbierto,
    novedadEnEdicion,
    setNovedadEnEdicion,
    modoCartelera,
    darkMode
  } = useDashStore();

  useEffect(() => {
    // Sincronizar clases modo-cartelera en documentElement
    if (modoCartelera) {
      document.documentElement.classList.add('modo-cartelera', 'vista-solida');
    } else {
      document.documentElement.classList.remove('modo-cartelera', 'vista-solida');
    }
  }, [modoCartelera]);

  const handleResolverConServicio = (id: number | string, nuevoServicio?: string) => {
    resolverNovedad(id, nuevoServicio);
    if (nuevoServicio) {
      toast.success(`Novedad resuelta asignando servicio ${nuevoServicio}`);
    } else {
      toast.success('Novedad marcada como resuelta');
    }
  };

  // 🔒 Login Wall: Bloquea visualización e interacción completa si no hay sesión
  if (!sesion || !sesion.usuario) {
    return (
      <div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-950 text-slate-200">
        <Toaster position="bottom-left" richColors theme={darkMode ? 'dark' : 'light'} />
        <LoginWall onLoginExitoso={recargar} />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-100/70 dark:bg-slate-950 text-slate-800 dark:text-slate-200">
      {/* Notificaciones Toaster */}
      <Toaster position="bottom-left" richColors theme={darkMode ? 'dark' : 'light'} />

      {/* Header Superior con Reloj 24h, 4 Vistas, Switch Cartelera y Auth */}
      <Header />

      {/* Contenido Principal 100% Pantalla */}
      <main id="feed-container" className="flex-1 overflow-hidden flex flex-col h-[calc(100vh-64px)] w-full">
        {cargando ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400 select-none">
            <div className="w-9 h-9 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Cargando flota y novedades en vivo...
            </span>
          </div>
        ) : error ? (
          <div className="max-w-md mx-auto my-auto p-6 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-2xl text-center shadow-lg">
            <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto mb-2 stroke-[1.8]" />
            <p className="text-xs font-bold text-rose-600 dark:text-rose-400 mb-4">{error}</p>
            <button
              onClick={recargar}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold uppercase tracking-wider rounded-xl transition-all shadow-md cursor-pointer"
            >
              Reintentar Conexión
            </button>
          </div>
        ) : (
          <KanbanBoard
            novedades={novedades}
            flota={flota}
            usuarios={usuarios}
            retornos={retornos}
            onResolver={handleResolverConServicio}
            onEditar={(nov) => setNovedadEnEdicion(nov)}
            onCambiarTerminal={asignarTerminal}
            onCambiarServicio={asignarServicio}
            onAgregarMencion={(id, u) => gestionarMencion(id, u, 'agregar')}
            onQuitarMencion={(id, u) => gestionarMencion(id, u, 'quitar')}
            onRecargar={recargar}
          />
        )}
      </main>

      {/* Modal de 2 Pasos para Crear / Editar Novedad */}
      <NoveltyModal
        abierto={modalNuevaAbierto}
        flota={flota}
        novedadEnEdicion={novedadEnEdicion}
        onCerrar={() => {
          setModalNuevaAbierto(false);
          setNovedadEnEdicion(null);
        }}
        onGuardadoExitoso={() => {
          recargar();
          toast.success(novedadEnEdicion ? 'Novedad modificada correctamente' : 'Nueva novedad publicada');
        }}
      />

      {/* Service Drop Overlay (CM, EURO, MET, LIVIANO, PP, TDS) */}
      <ServiceDropOverlay
        onAsignarServicioYResolver={(cardId, servicio) => {
          handleResolverConServicio(cardId, servicio);
        }}
      />
    </div>
  );
};

export default App;
