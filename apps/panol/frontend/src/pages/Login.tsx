import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { BACKEND_URL } from '../services/api';
import { Lock, User, Eye, EyeOff, AlertCircle, Laptop } from 'lucide-react';

export const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { login } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const isLocal = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.protocol === 'file:'
  );

  const handleLoginSubmit = async (u: string, p: string) => {
    if (!u.trim() && !p.trim()) {
      setError('Por favor completá usuario y contraseña.');
      return;
    }

    setIsLoading(true);
    setError(null);

    const nextUrl = searchParams.get('next') || '/';

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username: u.trim(),
          password: p.trim(),
          next: nextUrl,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        try {
          localStorage.setItem('sys_auth_ok', '1');
          if (data.token) {
            localStorage.setItem('sys_auth_token', data.token);
          }
        } catch (e) {}

        const activeUser = typeof data.user === 'object' ? data.user : {
          id: 'usr-1',
          op_code: u.trim() || '190',
          name: data.user || u.trim() || 'Operario Taller',
          role: (u.toLowerCase().includes('panol') ? 'PANOLERO' : 'OPERARIO') as any,
          default_boxes: ['01', '02', '03'],
          active: true,
        };

        login(data.token || 'auth-token', activeUser);

        const targetRoute = data.redirect || nextUrl;
        navigate(targetRoute.startsWith('/') ? targetRoute : '/');
      } else {
        setError(data.error || data.message || 'Credenciales inválidas. Verificá usuario y contraseña.');
      }
    } catch (err: any) {
      console.error('Error de login:', err);
      setError('No se pudo conectar con el servidor. Comprobá tu conexión a internet.');
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleLoginSubmit(username, password);
  };

  const handleLocalBypass = () => {
    setUsername('taller');
    setPassword('taller2026');
    handleLoginSubmit('taller', 'taller2026');
  };

  return (
    <div className="min-h-screen bg-[#090D16] text-panol-text flex items-center justify-center p-4">
      <div className="w-full max-w-[420px] bg-panol-card-bg border border-white/10 rounded-2xl p-8 shadow-2xl shadow-black/80">
        {/* Brand Header: Limpio sin títulos extra (Legacy Parity) */}
        <div className="text-center mb-6">
          <div className="w-13 h-13 bg-blue-500/15 border border-blue-500/30 rounded-2xl inline-flex items-center justify-center text-2xl mb-3 shadow-inner">
            🔐
          </div>
          <h1 className="text-xl font-black tracking-tight text-white uppercase">
            INGRESO
          </h1>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-4 p-3 bg-red-950/60 border border-red-500/40 rounded-xl flex items-center gap-2 text-xs text-red-300">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-extrabold uppercase tracking-wider text-panol-text-muted mb-1.5">
              LEGAJO / OPERARIO
            </label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-panol-text-dim" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="USUARIO O LEGAJO"
                className="w-full pl-10 pr-4 py-2.5 bg-[#1E293B] border border-white/10 rounded-xl text-white text-sm outline-none focus:border-panol-blue focus:ring-2 focus:ring-panol-blue/20 transition-all placeholder:text-panol-text-dim"
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-extrabold uppercase tracking-wider text-panol-text-muted mb-1.5">
              CONTRASEÑA / PIN
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-panol-text-dim" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-10 py-2.5 bg-[#1E293B] border border-white/10 rounded-xl text-white text-sm outline-none focus:border-panol-blue focus:ring-2 focus:ring-panol-blue/20 transition-all placeholder:text-panol-text-dim"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-panol-text-dim hover:text-white transition-colors"
                title="Mostrar/ocultar contraseña"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-3 bg-panol-blue-primary hover:bg-blue-600 disabled:opacity-50 text-white font-black text-sm tracking-wide rounded-xl shadow-lg shadow-blue-900/30 transition-all flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>VERIFICANDO...</span>
              </>
            ) : (
              'INGRESAR AL SISTEMA'
            )}
          </button>

          {/* Botón de acceso rápido para desarrollo local */}
          {isLocal && (
            <div className="pt-2">
              <button
                type="button"
                onClick={handleLocalBypass}
                className="w-full py-2.5 bg-[#1E293B] hover:bg-[#283548] border border-panol-blue/50 rounded-xl text-xs font-bold text-panol-blue flex items-center justify-center gap-2 transition-colors"
              >
                <Laptop className="w-3.5 h-3.5" />
                <span>💻 Modo Pruebas Local (taller / taller2026)</span>
              </button>
            </div>
          )}
        </form>

        {/* Footer info */}
        <div className="mt-6 pt-4 border-t border-white/5 text-center space-y-1">
          <p className="text-[11px] text-panol-text-dim leading-relaxed">
            🔒 Una vez verificado, este dispositivo permanecerá autorizado automáticamente por 90 días.
          </p>
        </div>
      </div>
    </div>
  );
};
