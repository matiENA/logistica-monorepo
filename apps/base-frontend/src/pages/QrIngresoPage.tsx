import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  LayoutGrid,
  Loader2,
  LogIn,
  MapPin,
  QrCode,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  confirmarAltaCircuitoQr,
  confirmarLlegadaZonaQr,
  confirmarSalidaZonaQr,
  getCachedEncargadoZonaUser,
  loginEncargadoZona,
  logoutEncargadoZona,
  QrApiError,
  resolveDominioTractor,
  verifyEncargadoZonaSession,
  type EncargadoZonaSession,
  type QrResolveTractorResult,
} from '../services/qrApi';
import { extractDominioTractorFromQr } from '../services/qrDecoder';
import { QrMobileShell, type FieldSection } from '../components/qr/QrMobileShell';
import { QrScannerPanel } from '../components/qr/QrScannerPanel';
import { AdminBoxPlaceholderView } from '../components/qr/AdminBoxPlaceholderView';

type ActionPhase = 'scan' | 'resolving' | 'confirm' | 'submitting' | 'done';

interface DoneFeedback {
  title: string;
  subtitle: string;
  dominio: string;
  semiDominio: string | null;
  continueToLlegadaDominio?: string | null;
}

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

const SECTION_TITLES: Record<FieldSection, string> = {
  menu: 'Operación de Campo',
  ingreso: 'Ingreso a Base',
  llegada: 'Llegada a Zona',
  boxes: 'Administración Box',
  salida: 'Salida de Zona',
};

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

  // Navegación principal + sub-estado de flujo QR
  const [section, setSection] = useState<FieldSection>('menu');
  const [phase, setPhase] = useState<ActionPhase>('scan');
  const [scanError, setScanError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<QrResolveTractorResult | null>(null);
  const [doneFeedback, setDoneFeedback] = useState<DoneFeedback | null>(null);
  const [returnToLlegadaAfterIngreso, setReturnToLlegadaAfterIngreso] = useState(false);

  const handledQueryRawRef = useRef(false);

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
        // Mantener caché local ante error de red transitorio
      } finally {
        if (active) setAuthChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const resetActionFlow = useCallback(() => {
    setPhase('scan');
    setScanError(null);
    setConfirmError(null);
    setResolved(null);
    setDoneFeedback(null);
    setReturnToLlegadaAfterIngreso(false);
  }, []);

  const navigateSection = useCallback(
    (next: FieldSection) => {
      setSection(next);
      resetActionFlow();
    },
    [resetActionFlow]
  );

  // 2. Resolver dominioTractor contra Hot RAM C1 (base.tractores + base.unidades + mi_zona)
  const lookupDominio = useCallback(
    async (dominioNormalizado: string, targetSection?: FieldSection) => {
      if (targetSection) setSection(targetSection);
      setScanError(null);
      setConfirmError(null);
      setResolved(null);
      setDoneFeedback(null);
      setPhase('resolving');

      try {
        const result = await resolveDominioTractor(dominioNormalizado);
        setResolved(result);
        setPhase('confirm');
      } catch (err) {
        if (err instanceof QrApiError && (err.status === 401 || err.status === 403)) {
          setSessionUser(null);
          setLoginError(err.message);
          setSection('menu');
          setPhase('scan');
          return;
        }
        const msg = err instanceof Error ? err.message : 'No se pudo consultar el tractor.';
        setScanError(msg);
        toast.error(msg);
        setPhase('scan');
      }
    },
    []
  );

  // 3. Soporte opcional ?raw=... en query string (abre directamente Ingreso a Base)
  useEffect(() => {
    if (!sessionUser || handledQueryRawRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const rawParam = params.get('raw');
    if (rawParam && rawParam.trim()) {
      handledQueryRawRef.current = true;
      window.history.replaceState(null, '', window.location.pathname);
      const dom = extractDominioTractorFromQr(rawParam);
      if (dom) {
        void lookupDominio(dom, 'ingreso');
      } else {
        setSection('ingreso');
        setScanError('QR inválido: no contiene un dominioTractor válido.');
      }
    }
  }, [sessionUser, lookupDominio]);

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
      setSection('menu');
      resetActionFlow();
      toast.success(`Sesión iniciada: ${user.nombre_usuario}`);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Error al iniciar sesión.');
    } finally {
      setLoginBusy(false);
    }
  };

  const handleLogout = async () => {
    await logoutEncargadoZona();
    setSessionUser(null);
    setSection('menu');
    resetActionFlow();
  };

  // Atajo UX: desde Llegada a Zona (si no está en Base) -> saltar a Ingreso a Base sin re-escanear
  const handleJumpToIngresoFromLlegada = () => {
    if (!resolved) return;
    setConfirmError(null);
    setReturnToLlegadaAfterIngreso(true);
    setSection('ingreso');
    setPhase('confirm');
  };

  // Confirmar acción según sección activa
  const handleConfirmAction = async () => {
    if (!resolved || !resolved.found) return;
    const dominioToSubmit = resolved.dominio_registrado || resolved.dominio_normalizado;

    setConfirmError(null);
    setPhase('submitting');
    try {
      if (section === 'ingreso') {
        const circuito = await confirmarAltaCircuitoQr(dominioToSubmit);
        const shouldOfferLlegada = returnToLlegadaAfterIngreso;
        setReturnToLlegadaAfterIngreso(false);
        setDoneFeedback({
          title: 'Ingreso a Base registrado',
          subtitle: circuito.ingreso_at
            ? `Circuito abierto · ${formatShortTime(circuito.ingreso_at)}`
            : 'Circuito abierto en planta',
          dominio: dominioToSubmit,
          semiDominio: resolved.semi_dominio,
          continueToLlegadaDominio: shouldOfferLlegada ? dominioToSubmit : null,
        });
        setPhase('done');
        toast.success(`Ingreso registrado: ${dominioToSubmit}`);
        return;
      }

      if (section === 'llegada') {
        const res = await confirmarLlegadaZonaQr(dominioToSubmit);
        setDoneFeedback({
          title: 'Llegada a Zona registrada',
          subtitle:
            res.mode === 'PROMOTED_HOLD'
              ? `Preasignación recibida en ${res.zone_name || sessionUser?.zone_name || 'tu zona'}`
              : `Unidad reservada en ${res.zone_name || sessionUser?.zone_name || 'tu zona'}`,
          dominio: dominioToSubmit,
          semiDominio: resolved.semi_dominio,
        });
        setPhase('done');
        toast.success(`Llegada registrada en ${res.zone_name || 'zona'}`);
        return;
      }

      if (section === 'salida') {
        const res = await confirmarSalidaZonaQr(dominioToSubmit);
        setDoneFeedback({
          title: 'Salida de Zona registrada',
          subtitle: `Proceso finalizado en ${res.zone_name || sessionUser?.zone_name || 'tu zona'} · ${formatShortTime(res.salida_at)}`,
          dominio: dominioToSubmit,
          semiDominio: resolved.semi_dominio,
        });
        setPhase('done');
        toast.success(`Salida registrada: ${dominioToSubmit}`);
      }
    } catch (err) {
      if (err instanceof QrApiError && (err.status === 401 || err.status === 403)) {
        setSessionUser(null);
        setLoginError(err.message);
        setSection('menu');
        setPhase('scan');
        return;
      }
      const msg = err instanceof Error ? err.message : 'No se pudo completar la operación.';
      setConfirmError(msg);
      toast.error(msg);
      setPhase('confirm');
    }
  };

  // Pantalla de verificación inicial
  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#070A0F] text-[#F8FAFC] flex flex-col items-center justify-center p-6">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mb-3" strokeWidth={2} />
        <p className="text-sm text-slate-300">Verificando sesión de Encargado de Zona...</p>
      </div>
    );
  }

  // Pantalla Login (exclusivo Encargado de Zona · WCAG 2.2 · inputs 16px)
  if (!sessionUser) {
    return (
      <div className="min-h-screen bg-[#070A0F] text-[#F8FAFC] flex flex-col justify-center px-5 py-8">
        <div className="w-full max-w-sm mx-auto bg-[#11161F] border border-slate-700 rounded-xl p-6 shadow-2xl">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <QrCode className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-white">Flowsite Campo</h1>
              <p className="text-xs text-slate-300">Exclusivo Encargados de Zona</p>
            </div>
          </div>

          {loginError && (
            <div
              role="alert"
              className="mb-4 rounded-xl bg-red-950/70 border border-red-600/80 px-3.5 py-3 text-sm text-red-100 flex items-start gap-2.5"
            >
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5 text-red-400" strokeWidth={2} aria-hidden="true" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label htmlFor="qr-user" className="block text-sm font-medium text-slate-200 mb-1.5">
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
                className="w-full h-12 rounded-xl bg-[#070A0F] border border-slate-600 px-3.5 text-base text-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:border-emerald-400"
              />
            </div>

            <div>
              <label htmlFor="qr-pass" className="block text-sm font-medium text-slate-200 mb-1.5">
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
                className="w-full h-12 rounded-xl bg-[#070A0F] border border-slate-600 px-3.5 text-base text-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:border-emerald-400"
              />
            </div>

            <button
              type="submit"
              disabled={loginBusy}
              className="w-full h-[52px] rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50 border border-transparent text-white font-semibold text-base flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#11161F] transition-transform"
            >
              {loginBusy ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" strokeWidth={2} />
                  <span>Ingresando...</span>
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

  const zoneLabel = sessionUser.zone_name || 'tu zona';

  // Evaluar elegibilidad de confirmación según la sección activa
  const renderConfirmBody = () => {
    if (!resolved) return null;
    const displayDominio = resolved.dominio_registrado || resolved.dominio_normalizado;
    const miZona = resolved.mi_zona;

    let canConfirm = false;
    let ctaLabel = 'Confirmar';
    let ctaTone: 'emerald' | 'red' = 'emerald';
    let statusBanner: React.ReactNode = null;
    let secondaryAction: React.ReactNode = null;

    if (!resolved.found) {
      statusBanner = (
        <div className="rounded-xl bg-red-950/70 border border-red-600/80 p-4 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" strokeWidth={2} aria-hidden="true" />
          <div className="text-sm text-red-100 space-y-1">
            <p className="font-semibold">Tractor no registrado</p>
            <p className="text-xs text-red-200">
              El dominio no figura en el índice <code>base.tractores</code>.
            </p>
          </div>
        </div>
      );
    } else if (section === 'ingreso') {
      if (resolved.ya_en_circuito) {
        statusBanner = (
          <div className="rounded-xl bg-amber-950/70 border border-amber-600/80 p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" strokeWidth={2} aria-hidden="true" />
            <div className="text-sm text-amber-100 space-y-1">
              <p className="font-semibold">Ya posee un circuito abierto</p>
              <p className="text-xs text-amber-200">
                Ingresado en Base{resolved.ingreso_at ? ` desde ${formatShortTime(resolved.ingreso_at)}` : ''}.
              </p>
            </div>
          </div>
        );
      } else if (resolved.semi_ya_en_circuito) {
        statusBanner = (
          <div className="rounded-xl bg-amber-950/70 border border-amber-600/80 p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" strokeWidth={2} aria-hidden="true" />
            <div className="text-sm text-amber-100 space-y-1">
              <p className="font-semibold">Semi acoplado ya está en circuito</p>
              <p className="text-xs text-amber-200">
                El semi <strong>{resolved.semi_dominio}</strong> (según <code>base.unidades</code>) ya
                tiene un circuito abierto. Ingreso bloqueado.
              </p>
            </div>
          </div>
        );
      } else {
        canConfirm = true;
        ctaLabel = 'Confirmar Ingreso a Base';
        statusBanner = (
          <div className="rounded-xl bg-emerald-950/50 border border-emerald-600/60 p-3.5 text-center">
            <p className="text-sm text-emerald-100">
              {resolved.semi_dominio
                ? `Se abrirá circuito en Base con Tractor y Semi (${resolved.semi_dominio}).`
                : 'Tractor validado (sin semi acoplado). Confirmá para abrir circuito en Base.'}
            </p>
          </div>
        );
      }
    } else if (section === 'llegada') {
      if (!resolved.ya_en_circuito) {
        statusBanner = (
          <div className="rounded-xl bg-amber-950/70 border border-amber-600/80 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" strokeWidth={2} aria-hidden="true" />
              <div className="text-sm text-amber-100 space-y-1">
                <p className="font-semibold">Falta Ingreso a Base</p>
                <p className="text-xs text-amber-200">
                  Esta unidad todavía no tiene un circuito abierto en planta. Primero debés
                  ingresarla a Base.
                </p>
              </div>
            </div>
            {!resolved.semi_ya_en_circuito && (
              <button
                type="button"
                onClick={handleJumpToIngresoFromLlegada}
                className="w-full h-12 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] border border-transparent text-white font-semibold text-sm inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#11161F] transition-transform"
              >
                <span>Ir a Ingreso a Base con {displayDominio}</span>
                <ArrowRight className="w-4 h-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </div>
        );
      } else if (
        miZona &&
        (miZona.estado_en_zona === 'RESERVADO' || miZona.estado_en_zona === 'TRABAJANDO')
      ) {
        statusBanner = (
          <div className="rounded-xl bg-amber-950/70 border border-amber-600/80 p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" strokeWidth={2} aria-hidden="true" />
            <div className="text-sm text-amber-100 space-y-1">
              <p className="font-semibold">Ya está en {miZona.zone_name || zoneLabel}</p>
              <p className="text-xs text-amber-200">
                {miZona.estado_en_zona === 'TRABAJANDO'
                  ? `Actualmente trabajando${miZona.box_name ? ` en ${miZona.box_name}` : ''}.`
                  : 'Actualmente reservada esperando ingreso a box.'}
              </p>
            </div>
          </div>
        );
      } else {
        canConfirm = true;
        ctaLabel = `Confirmar Llegada a ${miZona?.zone_name || zoneLabel}`;
        statusBanner = (
          <div className="rounded-xl bg-emerald-950/50 border border-emerald-600/60 p-3.5 text-center space-y-1">
            <p className="text-sm text-emerald-100 font-medium">
              {miZona?.estado_en_zona === 'PREASIGNADO'
                ? `Tiene preasignación en ${miZona.zone_name || zoneLabel}. Pasará a Reservado.`
                : `Se registrará llegada (Reservado) en ${miZona?.zone_name || zoneLabel}.`}
            </p>
            {miZona?.en_otra_zona && (
              <p className="text-xs text-amber-200">
                Nota: cerrará su estadía previa activa en {miZona.en_otra_zona}.
              </p>
            )}
          </div>
        );
      }
    } else if (section === 'salida') {
      if (!resolved.ya_en_circuito) {
        statusBanner = (
          <div className="rounded-xl bg-amber-950/70 border border-amber-600/80 p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" strokeWidth={2} aria-hidden="true" />
            <div className="text-sm text-amber-100 space-y-1">
              <p className="font-semibold">Sin circuito abierto</p>
              <p className="text-xs text-amber-200">
                Esta unidad no registra circuito abierto en Base.
              </p>
            </div>
          </div>
        );
      } else if (
        !miZona ||
        (miZona.estado_en_zona !== 'TRABAJANDO' && miZona.estado_en_zona !== 'RESERVADO')
      ) {
        statusBanner = (
          <div className="rounded-xl bg-amber-950/70 border border-amber-600/80 p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" strokeWidth={2} aria-hidden="true" />
            <div className="text-sm text-amber-100 space-y-1">
              <p className="font-semibold">Sin proceso activo en {miZona?.zone_name || zoneLabel}</p>
              <p className="text-xs text-amber-200">
                {miZona?.estado_en_zona === 'TERMINADO'
                  ? 'El proceso en esta zona ya figura como finalizado.'
                  : miZona?.estado_en_zona === 'PREASIGNADO'
                  ? 'Solo está preasignada; todavía no ingresó a la zona.'
                  : miZona?.en_otra_zona
                  ? `Actualmente activa en otra zona (${miZona.en_otra_zona}).`
                  : 'No hay estadía activa para cerrar en esta zona.'}
              </p>
            </div>
          </div>
        );
      } else {
        canConfirm = true;
        ctaTone = 'red';
        ctaLabel = `Confirmar Salida de ${miZona.zone_name || zoneLabel}`;
        statusBanner = (
          <div className="rounded-xl bg-slate-900/90 border border-slate-600 p-3.5 text-center space-y-1">
            <p className="text-sm text-white font-medium">
              {miZona.estado_en_zona === 'TRABAJANDO'
                ? `Trabajando en ${miZona.box_name || 'Box'}${miZona.estado_box ? ` (${miZona.estado_box})` : ''}`
                : `Reservado esperando box en ${miZona.zone_name || zoneLabel}`}
            </p>
            <p className="text-xs text-slate-300">
              Al confirmar se finalizará el proceso en esta zona (Terminado).
            </p>
          </div>
        );
      }
    }

    return (
      <div className="bg-[#11161F] border border-slate-700 rounded-xl p-5 space-y-5">
        {/* Identificación reducida: SOLO patente tractor + semi acoplado */}
        <div className="text-center space-y-2.5">
          <p className="text-xs uppercase tracking-widest text-slate-300">Tractor Detectado</p>
          <div className="inline-block px-5 py-2.5 rounded-xl bg-[#070A0F] border-2 border-slate-500 font-mono text-3xl font-bold tracking-[0.14em] text-white">
            {displayDominio}
          </div>

          {resolved.found && resolved.semi_dominio && (
            <div className="pt-1 flex items-center justify-center gap-2 text-xs text-slate-300">
              <span>Semi acoplado:</span>
              <span className="px-2.5 py-0.5 rounded-md bg-[#070A0F] border border-slate-600 font-mono font-semibold tracking-wider text-emerald-300">
                {resolved.semi_dominio}
              </span>
            </div>
          )}
        </div>

        {statusBanner}

        {confirmError && (
          <div
            role="alert"
            className="rounded-xl bg-red-950/70 border border-red-600/80 px-3.5 py-3 text-sm text-red-100 flex items-start gap-2.5"
          >
            <XCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-400" strokeWidth={2} aria-hidden="true" />
            <span>{confirmError}</span>
          </div>
        )}

        {/* Acciones de confirmación (52px CTA primario + 52px secundario · gap 12px) */}
        <div className="flex flex-col gap-3 pt-1">
          {canConfirm && (
            <button
              type="button"
              disabled={phase === 'submitting'}
              onClick={() => void handleConfirmAction()}
              className={`w-full h-[52px] rounded-xl active:scale-[0.98] disabled:opacity-50 border border-transparent text-white font-semibold text-base flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#11161F] transition-transform ${
                ctaTone === 'red'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {phase === 'submitting' ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" strokeWidth={2} />
                  <span>Procesando...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5 shrink-0" strokeWidth={2} aria-hidden="true" />
                  <span>{ctaLabel}</span>
                </>
              )}
            </button>
          )}

          {secondaryAction}

          <button
            type="button"
            disabled={phase === 'submitting'}
            onClick={resetActionFlow}
            className="w-full h-[52px] rounded-xl border border-slate-600 bg-transparent hover:bg-slate-800 active:scale-[0.98] disabled:opacity-50 text-slate-100 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#11161F] transition-transform"
          >
            {canConfirm ? 'Cancelar y re-escanear' : 'Escanear otra unidad'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <QrMobileShell
      section={section}
      title={SECTION_TITLES[section]}
      user={sessionUser}
      onSelectSection={navigateSection}
      onLogout={handleLogout}
    >
      {/* 1. MENÚ PRINCIPAL SIMPLE DE USO EN CAMPO (4 instancias · 68px c/u · gap 12px) */}
      {section === 'menu' && (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Zona activa · {zoneLabel}
            </p>
            <h2 className="text-xl font-semibold text-white">Seleccioná una operación</h2>
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => navigateSection('ingreso')}
              className="w-full min-h-[68px] px-4 py-3.5 rounded-xl bg-[#11161F] hover:bg-slate-800/90 active:scale-[0.98] border border-slate-600 flex items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A0F] transition-transform"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <span className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shrink-0">
                  <LogIn className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-base font-semibold text-white leading-snug">Ingreso a Base</p>
                  <p className="text-xs text-slate-300 truncate">
                    Abrir circuito de unidad mediante QR
                  </p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-400 shrink-0" strokeWidth={2} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => navigateSection('llegada')}
              className="w-full min-h-[68px] px-4 py-3.5 rounded-xl bg-[#11161F] hover:bg-slate-800/90 active:scale-[0.98] border border-slate-600 flex items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A0F] transition-transform"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <span className="w-11 h-11 rounded-xl bg-blue-500/15 border border-blue-500/40 text-blue-300 flex items-center justify-center shrink-0">
                  <MapPin className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-base font-semibold text-white leading-snug">Llegada a Zona</p>
                  <p className="text-xs text-slate-300 truncate">
                    Recibir / reservar unidad en {zoneLabel} por QR
                  </p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-400 shrink-0" strokeWidth={2} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => navigateSection('boxes')}
              className="w-full min-h-[68px] px-4 py-3.5 rounded-xl bg-[#11161F] hover:bg-slate-800/90 active:scale-[0.98] border border-slate-600 flex items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A0F] transition-transform"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <span className="w-11 h-11 rounded-xl bg-slate-700/60 border border-slate-500 text-slate-200 flex items-center justify-center shrink-0">
                  <LayoutGrid className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-base font-semibold text-white leading-snug">
                    Administración Box
                  </p>
                  <p className="text-xs text-slate-300 truncate">
                    Mapa móvil de boxes en {zoneLabel} (próximo)
                  </p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-400 shrink-0" strokeWidth={2} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => navigateSection('salida')}
              className="w-full min-h-[68px] px-4 py-3.5 rounded-xl bg-[#11161F] hover:bg-slate-800/90 active:scale-[0.98] border border-slate-600 flex items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A0F] transition-transform"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <span className="w-11 h-11 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 flex items-center justify-center shrink-0">
                  <CheckSquare className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-base font-semibold text-white leading-snug">Salida</p>
                  <p className="text-xs text-slate-300 truncate">
                    Finalizar unidad en {zoneLabel} mediante QR
                  </p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-400 shrink-0" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* 2. ESPACIO RESERVADO: ADMINISTRACIÓN BOX */}
      {section === 'boxes' && (
        <AdminBoxPlaceholderView zoneName={zoneLabel} onNavigate={navigateSection} />
      )}

      {/* 3. FLUJOS QR CON CONFIRMACIÓN OBLIGATORIA (Ingreso a Base / Llegada a Zona / Salida) */}
      {(section === 'ingreso' || section === 'llegada' || section === 'salida') && (
        <>
          {phase === 'scan' && (
            <QrScannerPanel
              active={phase === 'scan'}
              externalError={scanError}
              helperText={
                section === 'ingreso'
                  ? 'Escaneá el QR de la unidad para registrar su Ingreso a Base.'
                  : section === 'llegada'
                  ? `Escaneá el QR de la unidad para registrar Llegada a ${zoneLabel}.`
                  : `Escaneá el QR de la unidad para registrar Salida de ${zoneLabel}.`
              }
              onDominioDetected={(dom) => void lookupDominio(dom)}
            />
          )}

          {phase === 'resolving' && (
            <div className="bg-[#11161F] border border-slate-700 rounded-xl p-8 flex flex-col items-center justify-center text-center">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mb-3" strokeWidth={2} />
              <p className="text-base font-medium text-white">Consultando estado de unidad...</p>
            </div>
          )}

          {(phase === 'confirm' || phase === 'submitting') && renderConfirmBody()}

          {phase === 'done' && doneFeedback && (
            <div className="bg-[#11161F] border border-emerald-600/70 rounded-xl p-6 space-y-5 text-center">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                <CheckCircle2 className="w-8 h-8" strokeWidth={2} aria-hidden="true" />
              </div>

              <div className="space-y-1.5">
                <h2 className="text-lg font-semibold text-white">{doneFeedback.title}</h2>
                <p className="font-mono text-2xl font-bold tracking-[0.14em] text-emerald-300">
                  {doneFeedback.dominio}
                </p>
                {doneFeedback.semiDominio && (
                  <p className="font-mono text-sm font-semibold tracking-wider text-slate-200">
                    Semi: {doneFeedback.semiDominio}
                  </p>
                )}
                <p className="text-xs text-slate-300 pt-1">{doneFeedback.subtitle}</p>
              </div>

              <div className="flex flex-col gap-3">
                {doneFeedback.continueToLlegadaDominio ? (
                  <button
                    type="button"
                    onClick={() =>
                      void lookupDominio(doneFeedback.continueToLlegadaDominio!, 'llegada')
                    }
                    className="w-full h-[52px] rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] border border-transparent text-white font-semibold text-base flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#11161F] transition-transform"
                  >
                    <span>Continuar a Llegada a {zoneLabel}</span>
                    <ArrowRight className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={resetActionFlow}
                    className="w-full h-[52px] rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] border border-transparent text-white font-semibold text-base flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#11161F] transition-transform"
                  >
                    <QrCode className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
                    <span>Escanear siguiente unidad</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => navigateSection('menu')}
                  className="w-full h-[52px] rounded-xl border border-slate-600 bg-transparent hover:bg-slate-800 active:scale-[0.98] text-slate-100 font-medium text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#11161F] transition-transform"
                >
                  Volver al menú principal
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </QrMobileShell>
  );
};

export default QrIngresoPage;
