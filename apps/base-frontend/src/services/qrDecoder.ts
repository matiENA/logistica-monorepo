import jsQR from 'jsqr';

interface NativeDetectedBarcode {
  rawValue?: string;
}

interface NativeBarcodeDetector {
  detect(source: ImageBitmapSource): Promise<NativeDetectedBarcode[]>;
}

interface NativeBarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: NativeBarcodeDetectorConstructor;
  }
}

export function normalizeDominio(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase();
}

/**
 * Extrae estrictamente `dominioTractor` del JSON contenido en el QR.
 * Ignora completamente cualquier otro campo (serieDVR, nombreEmpresa, numeroInterno, etc.).
 */
export function extractDominioTractorFromQr(rawPayload: string): string | null {
  const trimmed = String(rawPayload || '').trim();
  if (!trimmed) return null;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const candidate = (parsed as Record<string, unknown>).dominioTractor;
    if (typeof candidate !== 'string') return null;
    const normalized = normalizeDominio(candidate);
    return normalized.length >= 3 ? normalized : null;
  } catch {
    return null;
  }
}

async function createNativeQrDetector(): Promise<NativeBarcodeDetector | null> {
  if (typeof window === 'undefined' || typeof window.BarcodeDetector !== 'function') {
    return null;
  }
  try {
    if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (!formats.includes('qr_code')) {
        return null;
      }
    }
    return new window.BarcodeDetector({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

export interface QrCameraScannerController {
  engine: 'native' | 'jsqr';
  stop: () => void;
}

export interface StartQrCameraScannerOptions {
  videoElement: HTMLVideoElement;
  onDecodedRaw: (rawValue: string) => void;
  onError?: (message: string) => void;
  scanIntervalMs?: number;
}

/**
 * Escáner QR optimizado para hardware con poca RAM (Moto E15 Android 14 Go 2GB, Galaxy A06/A07):
 * - Video capado a 640x480 (environment)
 * - Throttle encadenado de 300ms (~3.3 fps, sin solapamientos ni GC pressure)
 * - Motor primario BarcodeDetector nativo de Chrome con fallback automático a jsQR
 * - Apagado inmediato de MediaStreamTracks al detectar o detener
 */
export async function startQrCameraScanner(
  options: StartQrCameraScannerOptions
): Promise<QrCameraScannerController> {
  const { videoElement, onDecodedRaw, scanIntervalMs = 300 } = options;

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    throw new Error(
      'Este navegador no habilita cámara en vivo (requiere HTTPS). Usá "Foto cámara nativa" o ingreso manual.'
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      throw new Error('Permiso de cámara denegado. Habilitalo en Chrome o usá "Foto cámara nativa".');
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      throw new Error('No se detectó cámara trasera disponible en este dispositivo.');
    }
    throw new Error('No se pudo abrir la cámara en vivo. Probá con "Foto cámara nativa".');
  }

  let stopped = false;
  let timerId: number | null = null;
  let nativeDetector = await createNativeQrDetector();
  const engine: 'native' | 'jsqr' = nativeDetector ? 'native' : 'jsqr';

  // Canvas único reutilizado para evitar presión de GC en 2GB RAM
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timerId !== null) {
      window.clearTimeout(timerId);
      timerId = null;
    }
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // ignore
      }
    }
    try {
      videoElement.pause();
      videoElement.srcObject = null;
    } catch {
      // ignore
    }
  };

  videoElement.srcObject = stream;
  videoElement.setAttribute('playsinline', 'true');
  videoElement.muted = true;

  try {
    await videoElement.play();
  } catch {
    stop();
    throw new Error('No se pudo iniciar la vista previa de cámara.');
  }

  const decodeFrame = async (): Promise<string | null> => {
    if (
      videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      videoElement.videoWidth === 0 ||
      videoElement.videoHeight === 0
    ) {
      return null;
    }

    if (nativeDetector) {
      try {
        const barcodes = await nativeDetector.detect(videoElement);
        const raw = barcodes.find((b) => typeof b.rawValue === 'string' && b.rawValue.trim())?.rawValue;
        if (raw) return raw;
        return null;
      } catch {
        // En algunos Android Go sin Play Services actualizado, BarcodeDetector puede fallar en runtime:
        // degradamos automáticamente a jsQR sin cortar la sesión de escaneo.
        nativeDetector = null;
      }
    }

    if (!ctx) return null;
    const vw = videoElement.videoWidth;
    const vh = videoElement.videoHeight;
    const maxDim = 640;
    const scale = Math.min(1, maxDim / Math.max(vw, vh));
    const w = Math.max(1, Math.round(vw * scale));
    const h = Math.max(1, Math.round(vh * scale));

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.drawImage(videoElement, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const result = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' });
    return result?.data || null;
  };

  const loop = async () => {
    if (stopped) return;
    try {
      const raw = await decodeFrame();
      if (stopped) return;
      if (raw) {
        stop();
        onDecodedRaw(raw);
        return;
      }
    } catch {
      // Ignorar errores transitorios de frame
    }
    if (!stopped) {
      timerId = window.setTimeout(() => {
        void loop();
      }, scanIntervalMs);
    }
  };

  timerId = window.setTimeout(() => {
    void loop();
  }, 200);

  return { engine, stop };
}

/**
 * Decodifica un QR desde una foto fija (<input type="file" accept="image/*" capture="environment">).
 * Reescalado a máx 1024px para proteger RAM en Moto E15 / sensores de 32-50 MP.
 */
export async function decodeQrFromImageFile(file: File): Promise<string | null> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('No se pudo leer la imagen capturada.'));
      el.src = objectUrl;
    });

    const maxDim = 1024;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);

    const nativeDetector = await createNativeQrDetector();
    if (nativeDetector) {
      try {
        const barcodes = await nativeDetector.detect(canvas);
        const raw = barcodes.find((b) => typeof b.rawValue === 'string' && b.rawValue.trim())?.rawValue;
        if (raw) return raw;
      } catch {
        // fallback a jsQR
      }
    }

    const imageData = ctx.getImageData(0, 0, w, h);
    const decoded = jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
    return decoded?.data || null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
