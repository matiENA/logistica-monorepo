import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Image as ImageIcon,
  Keyboard,
  Loader2,
  LogOut,
  QrCode,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  confirmarAltaCircuitoQr,
  getCachedEncargadoZonaUser,
  loginEncargadoZona,
  logoutEncargadoZona,
  QrApiError,
  resolveDominioTractor,
  verifyEncargadoZonaSession,
  type EncargadoZonaSession,
  type QrAltaCircuitoResult,
  type QrResolveTractorResult,
} from '../services/qrApi';
import {
  decodeQrFromImageFile,
  extractDominioTractorFromQr,
  normalizeDominio,
  startQrCameraScanner,
  type QrCameraScannerController,
} from '../services/qrDecoder';

type ViewPhase = 'scan' | 'resolving' | 'confirm' | 'submitting' | 'done';

function formatShortTime(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export const QrIngresoPage: React.FC = () => {
  const [authChecking, setAuthChecking] = useState(true);
  const [sessionUser, setSessionUser] = useState<EncargadoZonaSession | null>(() =>
    getCachedEncargadoZonaUser()
  );

  // Login form
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Scanner & flow state
  const [phase, setPhase] = useState<ViewPhase>('scan');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraEngine, setCameraEngine] = useState<'native' | 'jsqr' | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  // Manual fallback
  const [showManual, setShowManual] = useState(false);
  const [manualInput, setManualInput] = useState('');

  // Confirm & result
  const [resolved, setResolved] = useState<QrResolveTractorResult | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [createdCircuito, setCreatedCircuito] = useState<QrAltaCircuitoResult | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scannerRef = useRef<QrCameraScannerController | null>(null);
  const handledQueryRawRef = useRef(false);

  const stopCamera = useCallback(() => {
    if (scannerRef.current) {
      scannerRef.current.stop();
      scannerRef.current = null;
    }
    setCameraActive(false);
  }, []);

  // 1. Verificación inicial de sesión persistente (30 días)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await verifyEncargadoZonaSession();
        if (!active) return;
        if (res.authorized && res.user) {
          setSessionUser(res.user);
          setLoginError(null);
        } else {
          setSessionUser(null);
          if (res.error && res.error !== 'Sesión no iniciada') {
            setLoginError(res.error);
          }
        }
      } catch {
        if (!active) return;
        // Si hay error de red temporal pero tenemos sesión cacheada, mantenemos caché
      } finally {
        if (active) setAuthChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // 2. Resolver dominioTractor contra índice C1 Hot RAM (base.tractores)
  const lookupDominio = useCallback(
    async (dominioNormalizado: string) => {
      stopCamera();
      setScanError(null);
      setConfirmError(null);
      setResolved(null);
      setCreatedCircuito(null);
      setPhase('resolving');

      try {
        const result = await resolveDominioTractor(dominioNormalizado);
        setResolved(result);
        setPhase('confirm');
      } catch (err) {
        if (err instanceof QrApiError && (err.status === 401 || err.status === 403)) {
          setSessionUser(null);
          setLoginError(err.message);
          setPhase('scan');
          return;
        }
        const msg = err instanceof Error ? err.message : 'No se pudo consultar el tractor.';
        setScanError(msg);
        toast.error(msg);
        setPhase('scan');
      }
    },
    [stopCamera]
  );

  // 3. Procesar texto crudo leído del QR (extrae SOLO dominioTractor)
  const handleRawQrDecoded = useCallback(
    (rawPayload: string) => {
      const dominio = extractDominioTractorFromQr(rawPayload);
      if (!dominio) {
        stopCamera();
        const msg = 'QR inválido: no contiene un dominioTractor válido.';
        setScanError(msg);
        toast.error(msg);
        setPhase('scan');
        return;
      }
      void lookupDominio(dominio);
    },
    [lookupDominio, stopCamera]
  );

  // 4. Soporte opcional ?raw=... en query string (compatibilidad con lectores externos MDM)
  useEffect(() => {
    if (!sessionUser || handledQueryRawRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const rawParam = params.get('raw');
    if (rawParam && rawParam.trim()) {
      handledQueryRawRef.current = true;
      window.history.replaceState(null, '', window.location.pathname);
      handleRawQrDecoded(rawParam);
    }
  }, [sessionUser, handleRawQrDecoded]);

  // 5. Arranque/parada controlada de cámara WebRTC (640x480 · 300ms throttle · Moto E15 safe)
  const bootCamera = useCallback(async () => {
    stopCamera();
    setCameraError(null);

    const videoEl = videoRef.current;
    if (!videoEl) return;

    try {
      const controller = await startQrCameraScanner({
        videoElement: videoEl,
        scanIntervalMs: 300,
        onDecodedRaw: (raw) => {
          handleRawQrDecoded(raw);
        },
      });
      scannerRef.current = controller;
      setCameraEngine(controller.engine);
      setCameraActive(true);
    } catch (err) {
      setCameraActive(false);
      setCameraError(
        err instanceof Error
          ? err.message
          : 'No se pudo iniciar la cámara. Usá "Foto cámara nativa".'
      );
    }
  }, [handleRawQrDecoded, stopCamera]);

  useEffect(() => {
    if (!sessionUser || phase !== 'scan' || showManual) {
      stopCamera();
      return;
    }

    let cancelled = false;
    const run = async () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      await bootCamera();
    };
    void run();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stopCamera();
      } else if (!cancelled) {
        void bootCamera();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopCamera();
    };
  }, [sessionUser, phase, showManual, bootCamera, stopCamera]);

  // Handlers de Login / Logout
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!username.trim() || !password) {
      setLoginError('Ingresá usuario y contraseña.');
      return;
    }
    setLoginBusy(true);
    try {
      const user = await loginEncargadoZona(username, password);
      setSessionUser(user);
      setPassword('');
      setPhase('scan');
      toast.success(`Sesión iniciada: ${user.nombre_usuario}`);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Error al iniciar sesión.');
    } finally {
      setLoginBusy(false);
    }
  };

  const handleLogout = async () => {
    stopCamera();
    await logoutEncargadoZona();
    setSessionUser(null);
    setResolved(null);
    setCreatedCircuito(null);
    setScanError(null);
    setConfirmError(null);
    setPhase('scan');
  };

  // Handler de foto nativa (<input capture="environment">)
  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    stopCamera();
    setPhotoBusy(true);
    setScanError(null);
    try {
      const raw = await decodeQrFromImageFile(file);
      if (!raw) {
        const msg = 'No se detectó ningún código QR en la foto. Intentá acercarte y enfocar.';
        setScanError(msg);
        toast.error(msg);
        setPhase('scan');
        return;
      }
      handleRawQrDecoded(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error leyendo la foto.';
      setScanError(msg);
      toast.error(msg);
      setPhase('scan');
    } finally {
      setPhotoBusy(false);
    }
  };

  // Handler ingreso manual
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const norm = normalizeDominio(manualInput);
    if (norm.length < 3) {
      setScanError('Ingresá un dominio válido (ej: AG088KS).');
      return;
    }
    setShowManual(false);
    setManualInput('');
    void lookupDominio(norm);
  };

  // Confirmar alta de circuito (tractor + semi desde índice base.unidades)
  const handleConfirmAlta = async () => {
    if (!resolved || !resolved.found || resolved.ya_en_circuito || resolved.semi_ya_en_circuito) {
      return;
    }
    const dominioToSubmit = resolved.dominio_registrado || resolved.dominio_normalizado;

    setConfirmError(null);
    setPhase('submitting');
    try {
      const circuito = await confirmarAltaCircuitoQr(dominioToSubmit);
      setCreatedCircuito(circuito);
      setPhase('done');
      toast.success(`Tractor ${dominioToSubmit} ingresado al circuito.`);
    } catch (err) {
      if (err instanceof QrApiError && (err.status === 401 || err.status === 403)) {
        setSessionUser(null);
        setLoginError(err.message);
        setPhase('scan');
        return;
      }
      const msg = err instanceof Error ? err.message : 'No se pudo registrar el ingreso.';
      setConfirmError(msg);
      toast.error(msg);
      setPhase('confirm');
    }
  };

  const resetToScan = () => {
    setResolved(null);
    setCreatedCircuito(null);
    setScanError(null);
    setConfirmError(null);
    setShowManual(false);
    setPhase('scan');
  };

  // Pantalla de carga inicial de sesión
  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#070A0F] text-[#F3F4F6] flex flex-col items-center justify-center p-6">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mb-3" />
        <p className="text-sm text-zinc-400">Verificando sesión de Encargado de Zona...</p>
      </div>
    );
  }

  // Pantalla Login (exclusivo Encargado de Zona)
  if (!sessionUser) {
    return (
      <div className="min-h-screen bg-[#070A0F] text-[#F3F4F6] flex flex-col justify-center px-5 py-8">
        <div className="w-full max-w-sm mx-auto bg-[#11161F] border border-zinc-800 rounded-xl p-6 shadow-2xl">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-white">Ingreso QR</h1>
              <p className="text-xs text-zinc-400">Exclusivo Encargados de Zona</p>
            </div>
          </div>

          {loginError && (
            <div
              role="alert"
              className="mb-4 rounded-lg bg-red-950/60 border border-red-700/60 px-3.5 py-2.5 text-xs text-red-200 flex items-start gap-2"
            >
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label htmlFor="qr-user" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Usuario
              </label>
              <input
                id="qr-user"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loginBusy}
                placeholder="encargado_..."
                className="w-full h-12 rounded-lg bg-[#070A0F] border border-zinc-700 px-3.5 text-base text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label htmlFor="qr-pass" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Contraseña
              </label>
              <input
                id="qr-pass"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loginBusy}
                placeholder="••••••••"
                className="w-full h-12 rounded-lg bg-[#070A0F] border border-zinc-700 px-3.5 text-base text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <button
              type="submit"
              disabled={loginBusy}
              className="w-full h-12 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
            >
              {loginBusy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Ingresando...
                </>
              ) : (
                'Iniciar sesión'
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070A0F] text-[#F3F4F6] flex flex-col">
      {/* Header compacto */}
      <header className="shrink-0 bg-[#11161F] border-b border-zinc-800 px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <QrCode className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate leading-tight">
              Ingreso QR · Tractor
            </p>
            <p className="text-[11px] text-zinc-400 truncate">
              {sessionUser.nombre_usuario}
              {sessionUser.zone_name ? ` · ${sessionUser.zone_name}` : ''}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          aria-label="Cerrar sesión"
          className="h-10 px-3 rounded-lg border border-zinc-700 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-200 text-xs font-medium flex items-center gap-1.5 shrink-0"
        >
          <LogOut className="w-4 h-4" />
          <span>Salir</span>
        </button>
      </header>

      {/* Input oculto para foto con cámara nativa (fallback Android Go / enfoque complejo) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoCapture}
        className="hidden"
      />

      {/* Contenido principal */}
      <main className="flex-1 flex flex-col justify-center px-4 py-5 max-w-md w-full mx-auto">
        {phase === 'scan' && (
          <div className="space-y-4">
            {scanError && (
              <div
                role="alert"
                className="rounded-lg bg-red-950/60 border border-red-700/60 px-3.5 py-2.5 text-xs text-red-200 flex items-start gap-2"
              >
                <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
                <span>{scanError}</span>
              </div>
            )}

            {!showManual ? (
              <>
                {/* Visor de cámara WebRTC 640x480 */}
                <div className="relative w-full aspect-square max-h-[360px] rounded-xl overflow-hidden bg-[#11161F] border border-zinc-800 flex items-center justify-center">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className={`w-full h-full object-cover ${cameraActive ? 'opacity-100' : 'opacity-0'}`}
                  />

                  {cameraActive && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="w-56 h-56 rounded-xl border-2 border-emerald-400/90 shadow-[0_0_0_9999px_rgba(7,10,15,0.52)]" />
                    </div>
                  )}

                  {!cameraActive && !cameraError && !photoBusy && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                      <Loader2 className="w-7 h-7 animate-spin text-emerald-400 mb-2.5" />
                      <p className="text-xs text-zinc-300">Activando cámara...</p>
                    </div>
                  )}

                  {photoBusy && (
                    <div className="absolute inset-0 bg-[#070A0F]/85 flex flex-col items-center justify-center p-6 text-center">
                      <Loader2 className="w-7 h-7 animate-spin text-emerald-400 mb-2.5" />
                      <p className="text-xs text-zinc-200">Leyendo QR de la foto...</p>
                    </div>
                  )}

                  {cameraError && !photoBusy && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center gap-3">
                      <Camera className="w-8 h-8 text-amber-400" />
                      <p className="text-xs text-zinc-200 leading-relaxed">{cameraError}</p>
                      <button
                        type="button"
                        onClick={() => void bootCamera()}
                        className="h-10 px-4 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-xs font-medium text-white flex items-center gap-1.5"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Reintentar cámara
                      </button>
                    </div>
                  )}
                </div>

                <p className="text-center text-xs text-zinc-400">
                  Apuntá al código QR de la unidad para leer el dominio del tractor.
                  {cameraEngine ? (
                    <span className="sr-only">Motor: {cameraEngine}</span>
                  ) : null}
                </p>

                {/* Botones fallback (Foto cámara nativa + Ingreso manual) */}
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={photoBusy}
                    onClick={() => fileInputRef.current?.click()}
                    className="h-12 rounded-lg bg-[#11161F] hover:bg-zinc-800 active:bg-zinc-700 border border-zinc-700 text-zinc-100 text-xs font-medium flex items-center justify-center gap-2 px-3"
                  >
                    <ImageIcon className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Foto cámara</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setScanError(null);
                      setShowManual(true);
                    }}
                    className="h-12 rounded-lg bg-[#11161F] hover:bg-zinc-800 active:bg-zinc-700 border border-zinc-700 text-zinc-100 text-xs font-medium flex items-center justify-center gap-2 px-3"
                  >
                    <Keyboard className="w-4 h-4 text-zinc-300 shrink-0" />
                    <span>Dominio manual</span>
                  </button>
                </div>
              </>
            ) : (
              /* Formulario ingreso manual de patente */
              <form
                onSubmit={handleManualSubmit}
                className="bg-[#11161F] border border-zinc-800 rounded-xl p-5 space-y-4"
              >
                <div>
                  <label
                    htmlFor="manual-dominio"
                    className="block text-xs font-medium text-zinc-300 mb-1.5"
                  >
                    Dominio del tractor
                  </label>
                  <input
                    id="manual-dominio"
                    type="text"
                    autoFocus
                    autoCapitalize="characters"
                    autoCorrect="off"
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value.toUpperCase())}
                    placeholder="Ej: AG088KS"
                    className="w-full h-12 rounded-lg bg-[#070A0F] border border-zinc-700 px-3.5 text-lg font-mono tracking-wider uppercase text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="flex flex-col gap-2.5">
                  <button
                    type="submit"
                    className="w-full h-12 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm"
                  >
                    Buscar tractor
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowManual(false);
                      setScanError(null);
                    }}
                    className="w-full h-11 rounded-lg border border-zinc-700 bg-transparent hover:bg-zinc-800 text-zinc-300 text-xs font-medium"
                  >
                    Volver al escáner QR
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {phase === 'resolving' && (
          <div className="bg-[#11161F] border border-zinc-800 rounded-xl p-8 flex flex-col items-center justify-center text-center">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mb-3" />
            <p className="text-sm font-medium text-white">Validando tractor en padrón...</p>
          </div>
        )}

        {(phase === 'confirm' || phase === 'submitting') && resolved && (
          <div className="bg-[#11161F] border border-zinc-800 rounded-xl p-6 space-y-5">
            <div className="text-center space-y-2.5">
              <p className="text-xs uppercase tracking-widest text-zinc-400">
                Dominio de Tractor Detectado
              </p>
              <div className="inline-block px-5 py-2.5 rounded-lg bg-[#070A0F] border-2 border-zinc-600 font-mono text-3xl font-bold tracking-[0.14em] text-white">
                {resolved.dominio_registrado || resolved.dominio_normalizado}
              </div>

              {resolved.found && resolved.semi_dominio && (
                <div className="pt-1 flex items-center justify-center gap-2 text-xs text-zinc-300">
                  <span className="text-zinc-400">Semi acoplado (unidades):</span>
                  <span className="px-2.5 py-0.5 rounded bg-[#070A0F] border border-zinc-700 font-mono font-semibold tracking-wider text-emerald-300">
                    {resolved.semi_dominio}
                  </span>
                </div>
              )}
            </div>

            {/* Estado de validación contra base.tractores + base.unidades */}
            {!resolved.found ? (
              <div className="rounded-lg bg-red-950/60 border border-red-700/60 p-4 flex items-start gap-3">
                <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div className="text-xs text-red-100 space-y-1">
                  <p className="font-semibold text-sm">Tractor no registrado</p>
                  <p className="text-red-200/90">
                    El dominio no coincide con ningún registro del índice de tractores (
                    <code>base.tractores</code>). No se puede realizar el ingreso.
                  </p>
                </div>
              </div>
            ) : resolved.ya_en_circuito ? (
              <div className="rounded-lg bg-amber-950/60 border border-amber-700/60 p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-100 space-y-1">
                  <p className="font-semibold text-sm">Ya posee un circuito abierto</p>
                  <p className="text-amber-200/90">
                    Este tractor ya se encuentra ingresado en planta
                    {resolved.ingreso_at ? ` desde ${formatShortTime(resolved.ingreso_at)}` : ''}.
                  </p>
                </div>
              </div>
            ) : resolved.semi_ya_en_circuito ? (
              <div className="rounded-lg bg-amber-950/60 border border-amber-700/60 p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-100 space-y-1">
                  <p className="font-semibold text-sm">Semi acoplado ya está en circuito</p>
                  <p className="text-amber-200/90">
                    El semi <strong>{resolved.semi_dominio}</strong> (asociado en{' '}
                    <code>base.unidades</code>) ya posee un circuito abierto
                    {resolved.ingreso_at ? ` desde ${formatShortTime(resolved.ingreso_at)}` : ''}.
                    Ingreso bloqueado.
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-emerald-950/40 border border-emerald-700/50 p-3.5 text-center">
                <p className="text-xs text-emerald-200">
                  {resolved.semi_dominio
                    ? `Tractor y semi (${resolved.semi_dominio}) validados. Confirmá para ingresar al circuito.`
                    : 'Tractor validado en padrón (sin semi acoplado en unidades). Confirmá para ingresar al circuito.'}
                </p>
              </div>
            )}

            {confirmError && (
              <div
                role="alert"
                className="rounded-lg bg-red-950/60 border border-red-700/60 px-3.5 py-2.5 text-xs text-red-200 flex items-start gap-2"
              >
                <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
                <span>{confirmError}</span>
              </div>
            )}

            {/* Acciones de confirmación */}
            <div className="flex flex-col gap-2.5 pt-1">
              {resolved.found && !resolved.ya_en_circuito && !resolved.semi_ya_en_circuito && (
                <button
                  type="button"
                  disabled={phase === 'submitting'}
                  onClick={() => void handleConfirmAlta()}
                  className="w-full h-14 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-60 text-white font-semibold text-base flex items-center justify-center gap-2 transition-colors"
                >
                  {phase === 'submitting' ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Registrando ingreso...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      Confirmar ingreso al circuito
                    </>
                  )}
                </button>
              )}

              <button
                type="button"
                disabled={phase === 'submitting'}
                onClick={resetToScan}
                className="w-full h-12 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-zinc-200 text-sm font-medium"
              >
                {resolved.found && !resolved.ya_en_circuito && !resolved.semi_ya_en_circuito
                  ? 'Cancelar y re-escanear'
                  : 'Escanear otra unidad'}
              </button>
            </div>
          </div>
        )}

        {phase === 'done' && resolved && (
          <div className="bg-[#11161F] border border-emerald-700/60 rounded-xl p-6 space-y-5 text-center">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold text-white">Ingreso registrado</h2>
              <p className="font-mono text-2xl font-bold tracking-[0.14em] text-emerald-300">
                {resolved.dominio_registrado || resolved.dominio_normalizado}
              </p>
              {resolved.semi_dominio && (
                <p className="font-mono text-sm font-semibold tracking-wider text-zinc-300">
                  Semi: {resolved.semi_dominio}
                </p>
              )}
              {createdCircuito?.ingreso_at && (
                <p className="text-xs text-zinc-400">
                  Circuito abierto · {formatShortTime(createdCircuito.ingreso_at)}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={resetToScan}
              className="w-full h-14 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold text-base flex items-center justify-center gap-2"
            >
              <QrCode className="w-5 h-5" />
              Escanear siguiente unidad
            </button>
          </div>
        )}
      </main>
    </div>
  );
};

export default QrIngresoPage;
