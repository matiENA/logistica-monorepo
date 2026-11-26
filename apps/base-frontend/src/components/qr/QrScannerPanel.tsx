import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Image as ImageIcon,
  Keyboard,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  decodeQrFromImageFile,
  extractDominioTractorFromQr,
  normalizeDominio,
  startQrCameraScanner,
  type QrCameraScannerController,
} from '../../services/qrDecoder';

interface QrScannerPanelProps {
  active: boolean;
  helperText: string;
  externalError?: string | null;
  onDominioDetected: (dominioNormalizado: string) => void;
}

export const QrScannerPanel: React.FC<QrScannerPanelProps> = ({
  active,
  helperText,
  externalError,
  onDominioDetected,
}) => {
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualInput, setManualInput] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scannerRef = useRef<QrCameraScannerController | null>(null);

  const stopCamera = useCallback(() => {
    if (scannerRef.current) {
      scannerRef.current.stop();
      scannerRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const handleRawDecoded = useCallback(
    (rawPayload: string) => {
      const dominio = extractDominioTractorFromQr(rawPayload);
      if (!dominio) {
        stopCamera();
        const msg = 'QR inválido: no contiene un dominioTractor válido.';
        setScanError(msg);
        toast.error(msg);
        return;
      }
      stopCamera();
      setScanError(null);
      onDominioDetected(dominio);
    },
    [onDominioDetected, stopCamera]
  );

  const bootCamera = useCallback(async () => {
    stopCamera();
    setCameraError(null);

    const videoEl = videoRef.current;
    if (!videoEl) return;

    try {
      const controller = await startQrCameraScanner({
        videoElement: videoEl,
        scanIntervalMs: 300,
        onDecodedRaw: handleRawDecoded,
      });
      scannerRef.current = controller;
      setCameraActive(true);
    } catch (err) {
      setCameraActive(false);
      setCameraError(
        err instanceof Error
          ? err.message
          : 'No se pudo iniciar la cámara. Usá "Foto cámara" o ingreso manual.'
      );
    }
  }, [handleRawDecoded, stopCamera]);

  useEffect(() => {
    if (!active || showManual) {
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
  }, [active, showManual, bootCamera, stopCamera]);

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
        return;
      }
      handleRawDecoded(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error leyendo la foto.';
      setScanError(msg);
      toast.error(msg);
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const norm = normalizeDominio(manualInput);
    if (norm.length < 3) {
      setScanError('Ingresá un dominio válido (ej: AG088KS).');
      return;
    }
    setShowManual(false);
    setManualInput('');
    setScanError(null);
    onDominioDetected(norm);
  };

  const displayError = scanError || externalError || null;

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoCapture}
        className="hidden"
      />

      {displayError && (
        <div
          role="alert"
          className="rounded-xl bg-red-950/70 border border-red-600/80 px-3.5 py-3 text-sm text-red-100 flex items-start gap-2.5"
        >
          <XCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-400" strokeWidth={2} aria-hidden="true" />
          <span>{displayError}</span>
        </div>
      )}

      {!showManual ? (
        <>
          <div className="relative w-full aspect-square max-h-[340px] rounded-xl overflow-hidden bg-[#11161F] border border-slate-700 flex items-center justify-center">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`w-full h-full object-cover ${cameraActive ? 'opacity-100' : 'opacity-0'}`}
            />

            {cameraActive && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="w-52 h-52 rounded-xl border-2 border-emerald-400/90 shadow-[0_0_0_9999px_rgba(7,10,15,0.52)]" />
              </div>
            )}

            {!cameraActive && !cameraError && !photoBusy && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                <Loader2 className="w-7 h-7 animate-spin text-emerald-400 mb-2.5" strokeWidth={2} aria-hidden="true" />
                <p className="text-sm text-slate-300">Activando cámara...</p>
              </div>
            )}

            {photoBusy && (
              <div className="absolute inset-0 bg-[#070A0F]/85 flex flex-col items-center justify-center p-6 text-center">
                <Loader2 className="w-7 h-7 animate-spin text-emerald-400 mb-2.5" strokeWidth={2} aria-hidden="true" />
                <p className="text-sm text-slate-100">Leyendo QR de la foto...</p>
              </div>
            )}

            {cameraError && !photoBusy && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center gap-3">
                <Camera className="w-8 h-8 text-amber-400" strokeWidth={2} aria-hidden="true" />
                <p className="text-sm text-slate-200 leading-relaxed">{cameraError}</p>
                <button
                  type="button"
                  onClick={() => void bootCamera()}
                  className="h-12 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-[0.98] border border-slate-500 text-base font-medium text-white inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#11161F] transition-transform"
                >
                  <RefreshCw className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
                  <span>Reintentar cámara</span>
                </button>
              </div>
            )}
          </div>

          <p className="text-center text-sm text-slate-300">{helperText}</p>

          {/* Controles secundarios (Mobile Default 48px · font 16px · gap 12px · box-model parity) */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={photoBusy}
              onClick={() => fileInputRef.current?.click()}
              className="h-12 px-4 rounded-xl bg-[#11161F] hover:bg-slate-800 active:scale-[0.98] disabled:opacity-50 border border-slate-600 text-slate-100 text-base font-medium inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A0F] transition-transform"
            >
              <ImageIcon className="w-5 h-5 text-emerald-400 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span>Foto</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setScanError(null);
                setShowManual(true);
              }}
              className="h-12 px-4 rounded-xl bg-[#11161F] hover:bg-slate-800 active:scale-[0.98] border border-slate-600 text-slate-100 text-base font-medium inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A0F] transition-transform"
            >
              <Keyboard className="w-5 h-5 text-slate-300 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span>Manual</span>
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={handleManualSubmit}
          className="bg-[#11161F] border border-slate-700 rounded-xl p-5 space-y-4"
        >
          <div>
            <label
              htmlFor="manual-dominio"
              className="block text-sm font-medium text-slate-200 mb-2"
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
              className="w-full h-12 rounded-xl bg-[#070A0F] border border-slate-600 px-3.5 text-base font-mono tracking-wider uppercase text-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:border-emerald-400"
            />
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="submit"
              className="w-full h-[52px] rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] border border-transparent text-white font-semibold text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#11161F] transition-transform"
            >
              Buscar tractor
            </button>
            <button
              type="button"
              onClick={() => {
                setShowManual(false);
                setScanError(null);
              }}
              className="w-full h-[52px] rounded-xl border border-slate-600 bg-transparent hover:bg-slate-800 active:scale-[0.98] text-slate-100 font-medium text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#11161F] transition-transform"
            >
              Volver al escáner QR
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
