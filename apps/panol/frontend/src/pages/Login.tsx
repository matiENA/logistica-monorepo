import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { BACKEND_URL } from '../services/api';
import { Lock, Eye, EyeOff, AlertCircle, ShieldCheck, Unlink, UserCheck } from 'lucide-react';

export const Login: React.FC = () => {
  const { isDeviceAuthorized, authorizeDevice, deauthorizeDevice, loginUser } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const nextUrl = searchParams.get('next') || '/';
  const paramStep = searchParams.get('step');

  // Determinar pantalla activa: 'sistema' (Paso 1) o 'usuario' (Paso 2)
  const [activeStep, setActiveStep] = useState<'sistema' | 'usuario'>(() => {
    if (paramStep === 'sistema') return 'sistema';
    if (paramStep === 'usuario') return 'usuario';
    return isDeviceAuthorized ? 'usuario' : 'sistema';
  });

  // Campos de formulario (1 solo campo por pantalla)
  const [systemPassword, setSystemPassword] = useState('');
  const [userPin, setUserPin] = useState('');
  const [showSystemPassword, setShowSystemPassword] = useState(false);
  const [showUserPin, setShowUserPin] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sincronizar estado si cambia el parámetro de búsqueda o la autorización
  useEffect(() => {
    if (paramStep === 'sistema') {
      setActiveStep('sistema');
    } else if (paramStep === 'usuario') {
      setActiveStep('usuario');
    } else {
      setActiveStep(isDeviceAuthorized ? 'usuario' : 'sistema');
    }
  }, [paramStep, isDeviceAuthorized]);

  // Si el destino es /panol y el dispositivo ya está autorizado, redirigir automáticamente a Pañol
  useEffect(() => {
    if (isDeviceAuthorized && nextUrl.startsWith('/panol') && paramStep !== 'sistema') {
      navigate('/panol', { replace: true });
    }
  }, [isDeviceAuthorized, nextUrl, paramStep, navigate]);

  // ==============================================================
  // PANTALLA 1: INGRESO AL SISTEMA (Dispositivo válido por 90 días)
  // ==============================================================
  const handleSystemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPass = systemPassword.trim();
    if (!cleanPass) {
      setError('Por favor ingresá la contraseña del sistema.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/system`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          password: cleanPass,
          next: nextUrl,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success && data.token) {
        // Dispositivo autorizado exitosamente por 90 días
        authorizeDevice(data.token);

        // Si el usuario intentaba ir a Monitor Pañol, llevarlo directamente
        if (nextUrl.startsWith('/panol')) {
          navigate('/panol', { replace: true });
          return;
        }

        // Si va a Taller o cualquier otra sección, avanzar fluidamente a la Pantalla 2 (Operario)
        setSystemPassword('');
        setActiveStep('usuario');
        setSearchParams({ step: 'usuario', next: nextUrl });
      } else {
        setError(data.error || 'Contraseña del sistema incorrecta.');
      }
    } catch (err: any) {
      console.error('Error autorizando dispositivo:', err);
      setError('No se pudo conectar con el servidor. Verificá tu conexión a internet.');
    } finally {
      setIsLoading(false);
    }
  };

  // ==============================================================
  // PANTALLA 2: INGRESO POR USUARIO (Operario de Taller)
  // ==============================================================
  const handleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPin = userPin.trim();
    if (!cleanPin) {
      setError('Por favor ingresá tu legajo o PIN de operario.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/user-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          pin: cleanPin,
          next: nextUrl,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success && data.user) {
        // Operario identificado correctamente
        loginUser(data.user);

        const targetRoute = data.redirect || nextUrl;
        navigate(targetRoute.startsWith('/') ? targetRoute : '/', { replace: true });
      } else {
        setError(data.error || 'Operario no encontrado. Verificá tu PIN o legajo.');
      }
    } catch (err: any) {
      console.error('Error identificando operario:', err);
      setError('No se pudo conectar con el servidor. Verificá tu conexión a internet.');
    } finally {
      setIsLoading(false);
    }
  };

  // Desvincular el dispositivo completamente del sistema
  const handleDeauthorize = async () => {
    if (!confirm('¿Deseás desvincular este dispositivo del sistema? Tendrás que volver a ingresar la clave maestra.')) {
      return;
    }
    try {
      await fetch(`${BACKEND_URL}/api/auth/logout?scope=device`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (e) {}

    deauthorizeDevice();
    setActiveStep('sistema');
    setSearchParams({ step: 'sistema', next: nextUrl });
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#090D16] text-panol-text flex items-center justify-center p-4">
      <div className="w-full max-w-[420px] bg-panol-card-bg border border-white/10 rounded-2xl p-8 shadow-2xl shadow-black/80">
        
        {/* ========================================================= */}
        {/* VISTA 1: INGRESO AL SISTEMA (1 vez cada 90 días)          */}
        {/* ========================================================= */}
        {activeStep === 'sistema' ? (
          <div>
            <div className="text-center mb-6">
              <div className="w-13 h-13 bg-blue-500/15 border border-blue-500/30 rounded-2xl inline-flex items-center justify-center text-2xl mb-3 shadow-inner">
                🔐
              </div>
              <h1 className="text-xl font-black tracking-tight text-white uppercase">
                INGRESO AL SISTEMA
              </h1>
              <p className="text-[12px] text-panol-text-muted mt-1 font-medium">
                Autorización de dispositivo para uso de Pañol y Taller
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-950/60 border border-red-500/40 rounded-xl flex items-center gap-2 text-xs text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSystemSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-panol-text-muted mb-1.5">
                  CONTRASEÑA DEL SISTEMA
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-panol-text-dim" />
                  <input
                    type={showSystemPassword ? 'text' : 'password'}
                    value={systemPassword}
                    onChange={(e) => setSystemPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-10 py-2.5 bg-[#1E293B] border border-white/10 rounded-xl text-white text-sm outline-none focus:border-panol-blue focus:ring-2 focus:ring-panol-blue/20 transition-all placeholder:text-panol-text-dim font-mono"
                    autoFocus
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSystemPassword(!showSystemPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-panol-text-dim hover:text-white transition-colors"
                    title="Mostrar/ocultar contraseña"
                  >
                    {showSystemPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
                    <span>VERIFICANDO DISPOSITIVO...</span>
                  </>
                ) : (
                  'AUTORIZAR DISPOSITIVO'
                )}
              </button>
            </form>

            <div className="mt-6 pt-4 border-t border-white/5 text-center space-y-1">
              <p className="text-[11px] text-panol-text-dim leading-relaxed">
                🔒 Una vez verificado, este dispositivo permanecerá autorizado automáticamente por 90 días.
              </p>
            </div>
          </div>
        ) : (
          /* ========================================================= */
          /* VISTA 2: INGRESO POR USUARIO (Operario en equipo validado) */
          /* ========================================================= */
          <div>
            <div className="text-center mb-6">
              <div className="w-13 h-13 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl inline-flex items-center justify-center text-2xl mb-3 shadow-inner text-emerald-400">
                <UserCheck className="w-7 h-7" />
              </div>
              <h1 className="text-xl font-black tracking-tight text-white uppercase">
                INGRESO OPERARIO
              </h1>
              <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/60 border border-emerald-500/40 rounded-full text-[10px] font-bold tracking-wider text-emerald-400 uppercase">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Dispositivo Autorizado (90 Días)</span>
              </div>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-950/60 border border-red-500/40 rounded-xl flex items-center gap-2 text-xs text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleUserSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-panol-text-muted mb-1.5">
                  LEGAJO / PIN DE OPERARIO
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-panol-text-dim" />
                  <input
                    type={showUserPin ? 'text' : 'password'}
                    value={userPin}
                    onChange={(e) => setUserPin(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-10 py-2.5 bg-[#1E293B] border border-white/10 rounded-xl text-white text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all placeholder:text-panol-text-dim font-mono tracking-wider"
                    autoFocus
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowUserPin(!showUserPin)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-panol-text-dim hover:text-white transition-colors"
                    title="Mostrar/ocultar PIN"
                  >
                    {showUserPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full mt-2 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black text-sm tracking-wide rounded-xl shadow-lg shadow-emerald-950/40 transition-all flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>INGRESANDO AL TALLER...</span>
                  </>
                ) : (
                  'INGRESAR AL TALLER'
                )}
              </button>
            </form>

            {/* Opción de desvinculación */}
            <div className="mt-6 pt-4 border-t border-white/5 text-center">
              <button
                type="button"
                onClick={handleDeauthorize}
                className="inline-flex items-center gap-1.5 text-[11px] text-panol-text-dim hover:text-red-400 transition-colors"
              >
                <Unlink className="w-3 h-3" />
                <span>Desvincular este dispositivo del sistema</span>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
