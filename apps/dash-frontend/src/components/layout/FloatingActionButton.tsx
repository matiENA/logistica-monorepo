import React from 'react';
import { Plus } from 'lucide-react';
import { useDashStore } from '../../store/useDashStore';

/**
 * @deprecated Reubicado a Header.tsx como botón contiguo a las pestañas
 * para evitar superponer contenedores y badges en el Kanban inferior derecho.
 */
export const FloatingActionButton: React.FC = () => {
  const { modoCartelera, setModalNuevaAbierto, setNovedadEnEdicion, sesion } = useDashStore();

  if (modoCartelera) return null;

  const handleClick = () => {
    if (!sesion || !sesion.usuario) {
      alert('Debe iniciar sesión para reportar una novedad.');
      return;
    }
    setNovedadEnEdicion(null);
    setModalNuevaAbierto(true);
  };

  return (
    <button
      id="btn-fab-nueva"
      onClick={handleClick}
      className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-tr from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-2xl shadow-lg shadow-indigo-600/30 flex justify-center items-center active:scale-90 transition-all duration-200 z-50 border border-indigo-400/30 group cursor-pointer"
      title="Reportar nueva novedad"
    >
      <Plus className="w-7 h-7 stroke-[2.5] group-hover:rotate-90 transition-transform duration-300" />
    </button>
  );
};
