import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Eye, EyeOff, KeyRound } from 'lucide-react';
import { loginUsuarioCoordinacion } from '../../services/planeacionApi';
import type { UsuarioCoordinacionSession } from '../../types/planeacion';

interface CoordinacionLoginWallProps {
  onAuthenticated: (user: UsuarioCoordinacionSession) => void;
}

export const CoordinacionLoginWall: React.FC<CoordinacionLoginWallProps> = ({
  onAuthenticated,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => userInputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUser = username.trim();
    if (!cleanUser || !password) {
      setError('Ingresá tu usuario y contraseña de Coordinación.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await loginUsuarioCoordinacion({
        nombre_usuario: cleanUser,
        password,
      });
      if (res.authenticated && res.user) {
        onAuthenticated(res.user);
      } else {
        setError(res.error || 'Credenciales inválidas.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#EDEDED] text-zinc-950 flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-[380px] bg-white border border-zinc-400 rounded-2xl p-7 shadow-xl flex flex-col gap-5">
        <div className="text-center flex flex-col items-center">
          <div className="w-12 h-12 rounded-xl bg-emerald-700/10 border border-emerald-700/30 text-emerald-800 inline-flex items-center justify-center mb-3">
            <KeyRound size={24} strokeWidth={2} aria-hidden="true" focusable="false" />
          </div>
          <h1 className="text-lg font-extrabold tracking-wider text-zinc-950 uppercase font-mono">
            COORDINACIÓN · ACCESO
          </h1>
          <p className="text-xs text-zinc-600 mt-1">
            Acceso exclusivo para usuarios de Coordinación
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-red-50 border border-red-300 flex items-center gap-2 text-xs text-red-800"
          >
            <AlertCircle
              size={16}
              strokeWidth={2}
              aria-hidden="true"
              focusable="false"
              className="shrink-0 text-red-700"
            />
            <span className="leading-tight">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="coord-wall-username"
              className="text-[11px] font-bold uppercase tracking-wider text-zinc-700 font-mono"
            >
              Usuario
            </label>
            <input
              ref={userInputRef}
              id="coord-wall-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Usuario"
              autoComplete="username"
              className="w-full h-11 px-3.5 bg-white border border-zinc-400 rounded-lg text-zinc-950 text-base sm:text-sm font-mono font-semibold outline-none focus:border-zinc-950 focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1 placeholder:text-zinc-400"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="coord-wall-password"
              className="text-[11px] font-bold uppercase tracking-wider text-zinc-700 font-mono"
            >
              Contraseña
            </label>
            <div className="relative">
              <input
                id="coord-wall-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full h-11 px-3.5 pr-11 bg-white border border-zinc-400 rounded-lg text-zinc-950 text-base sm:text-sm font-mono font-semibold outline-none focus:border-zinc-950 focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1 placeholder:text-zinc-400"
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                aria-label="Mostrar u ocultar contraseña"
                className="w-8 h-8 rounded-md absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-950 inline-flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
              >
                {showPassword ? (
                  <EyeOff size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
                ) : (
                  <Eye size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="w-full h-11 mt-1 px-4 rounded-lg border border-transparent bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] disabled:opacity-50 text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition-all cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
          >
            {loading ? (
              <span>Verificando...</span>
            ) : (
              <>
                <span>Ingresar</span>
                <ArrowRight size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
