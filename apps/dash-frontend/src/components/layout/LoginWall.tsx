import React, { useState } from 'react';
import { Truck, AlertTriangle, ArrowRight } from 'lucide-react';
import { useDashStore } from '../../store/useDashStore';
import { api } from '../../services/api';

interface LoginWallProps {
  onLoginExitoso: () => void;
}

export const LoginWall: React.FC<LoginWallProps> = ({ onLoginExitoso }) => {
  const { setSesion } = useDashStore();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuario.trim() || !password.trim()) {
      setError('Por favor complete todos los campos');
      return;
    }

    setCargando(true);
    setError(null);

    try {
      const userSesion = await api.login(usuario.trim().toUpperCase(), password.trim());
      setSesion(userSesion);
      onLoginExitoso();
    } catch (err: any) {
      setError(err.message || 'Usuario o contraseña incorrectos');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] h-screen w-screen flex flex-col items-center justify-center bg-slate-950 p-4 relative overflow-hidden select-none">
      {/* Glow de fondo decorativo */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-3xl pointer-events-none"></div>

      <div className="relative w-full max-w-sm sm:max-w-md bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
        {/* Cabecera / Branding */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center shadow-inner mb-3 text-indigo-400">
            <Truck className="w-7 h-7 stroke-[1.8]" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white uppercase flex items-center gap-2">
            DASH <span className="text-indigo-400 font-extrabold text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/30">FLOTA</span>
          </h1>
          <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">
            Tablero Operativo • Acceso Restringido
          </p>
        </div>

        {/* Alerta de Error */}
        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs font-bold flex items-center gap-2 animate-in fade-in duration-150">
            <AlertTriangle className="w-4 h-4 shrink-0 stroke-[2.2]" />
            <span>{error}</span>
          </div>
        )}

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">
              Operador / Usuario
            </label>
            <input
              type="text"
              autoFocus
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder="TRANSER, ALEX, TOMAS..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm font-bold text-white placeholder-slate-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none uppercase transition-all shadow-inner"
              required
            />
          </div>

          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">
              Contraseña de Turno
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm font-bold text-white placeholder-slate-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all shadow-inner"
              required
            />
          </div>

          <button
            type="submit"
            disabled={cargando}
            className="mt-2 w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-indigo-600/30 active:scale-[0.98] cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {cargando ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>VERIFICANDO ACCESO...</span>
              </>
            ) : (
              <>
                <span>ENTRAR AL TABLERO</span>
                <ArrowRight className="w-4 h-4 stroke-[2.5]" />
              </>
            )}
          </button>
        </form>

        {/* Footer Informativo */}
        <div className="mt-6 pt-4 border-t border-slate-800/60 text-center">
          <span className="text-[10px] text-slate-500 font-extrabold tracking-wider uppercase">
            Autenticación Centralizada • Supabase Auth
          </span>
        </div>
      </div>
    </div>
  );
};
