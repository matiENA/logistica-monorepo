import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, Eye, EyeOff, KeyRound, X } from 'lucide-react';
import { loginUsuarioCoordinacion } from '../../services/planeacionApi';
import type { UsuarioCoordinacionSession } from '../../types/planeacion';

interface CoordinacionLoginModalProps {
  open: boolean;
  onClose: () => void;
  onAuthenticated: (user: UsuarioCoordinacionSession) => void;
}

export const CoordinacionLoginModal: React.FC<CoordinacionLoginModalProps> = ({
  open,
  onClose,
  onAuthenticated,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setPassword('');
      setError(null);
      return;
    }
    const raf = requestAnimationFrame(() => userInputRef.current?.focus());
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Acceso de Coordinación"
      className="fixed inset-0 z-[60] bg-[#EDEDED]/75 backdrop-blur-[3px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[360px] bg-white border border-zinc-400 rounded-2xl p-6 shadow-xl flex flex-col gap-4"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-emerald-700/10 border border-emerald-700/30 text-emerald-800 inline-flex items-center justify-center shrink-0">
              <KeyRound size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold tracking-wide text-zinc-950 uppercase font-mono">
                Coordinación · Acceso
              </h3>
              <p className="text-[11px] text-zinc-600">
                Requerido para altas y bajas de circuito
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar acceso de coordinación"
            className="w-8 h-8 rounded-full border border-transparent hover:border-zinc-300 hover:bg-zinc-100 text-zinc-600 hover:text-zinc-950 inline-flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
          >
            <X size={16} strokeWidth={2} aria-hidden="true" focusable="false" />
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="p-2.5 rounded-lg bg-red-50 border border-red-300 flex items-center gap-2 text-xs text-red-800"
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

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="coord-username"
              className="text-[11px] font-bold uppercase tracking-wider text-zinc-700 font-mono"
            >
              Usuario
            </label>
            <input
              ref={userInputRef}
              id="coord-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Usuario"
              autoComplete="username"
              className="w-full h-11 px-3.5 bg-white border border-zinc-400 rounded-lg text-zinc-950 text-base sm:text-sm font-mono font-semibold outline-none focus:border-zinc-950 focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1 placeholder:text-zinc-400"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="coord-password"
              className="text-[11px] font-bold uppercase tracking-wider text-zinc-700 font-mono"
            >
              Contraseña
            </label>
            <div className="relative">
              <input
                id="coord-password"
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

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-11 px-4 rounded-lg border border-zinc-400 bg-transparent hover:bg-zinc-100 text-zinc-900 text-sm font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !username.trim() || !password}
              className="flex-1 h-11 px-4 rounded-lg border border-transparent bg-emerald-700 hover:bg-emerald-800 active:scale-[0.98] disabled:opacity-50 text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition-all cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
            >
              {loading ? (
                <span>Ingresando...</span>
              ) : (
                <>
                  <span>Ingresar</span>
                  <ArrowRight size={18} strokeWidth={2} aria-hidden="true" focusable="false" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
