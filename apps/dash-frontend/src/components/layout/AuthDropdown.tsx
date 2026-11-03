import React from 'react';
import { User, LogOut } from 'lucide-react';
import { useDashStore } from '../../store/useDashStore';

export const AuthDropdown: React.FC = () => {
  const { sesion, cerrarSesion } = useDashStore();

  if (!sesion || !sesion.usuario) {
    return null;
  }

  return (
    <div className="h-9 flex items-center gap-2 bg-slate-100 dark:bg-slate-800/90 px-3 rounded-xl border border-slate-200/80 dark:border-slate-700/80 shadow-sm text-xs select-none shrink-0">
      <span className="font-black text-indigo-600 dark:text-indigo-400 uppercase flex items-center gap-1.5 tracking-wide">
        <User className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 stroke-[2.2]" />
        <span>{sesion.usuario}</span>
      </span>
      <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-500 uppercase tracking-widest leading-none">
        {sesion.rol}
      </span>
      <button
        type="button"
        onClick={cerrarSesion}
        className="h-6 text-[10px] font-extrabold text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 px-2 rounded-lg transition-all uppercase ml-1 cursor-pointer inline-flex items-center gap-1"
        title="Cerrar Sesión y Bloquear Tablero"
      >
        <LogOut className="w-3 h-3 stroke-[2.2]" />
        <span>Salir</span>
      </button>
    </div>
  );
};
