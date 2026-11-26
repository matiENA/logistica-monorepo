export interface EncargadoZonaSession {
  id: string;
  nombre_usuario: string;
  rol: 'encargado_zona';
  box_id: string | null;
  box_name: string;
  zone_id: string | null;
  zone_name: string;
}

export interface QrResolveTractorResult {
  found: boolean;
  dominio_normalizado: string;
  tractor_id: string | null;
  dominio_registrado: string | null;
  semi_id: string | null;
  semi_dominio: string | null;
  n_ute: string | null;
  ya_en_circuito: boolean;
  semi_ya_en_circuito: boolean;
  circuito_abierto_id: string | null;
  ingreso_at: string | null;
}

export interface QrAltaCircuitoResult {
  circuito_id: string;
  tractor_id: string | null;
  semi_id: string | null;
  ingreso_at: string;
}

export class QrApiError extends Error {
  public readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'QrApiError';
    this.status = status;
  }
}

const API_BASE = import.meta.env.VITE_API_URL || '';
const REQUEST_TIMEOUT_MS = 50_000; // Poka-Yoke Cold Start (Render)
const TALLER_AUTH_STORAGE_KEY = 'base_taller_user';
const TALLER_TOKEN_STORAGE_KEY = 'base_taller_session_token';
const DEVICE_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 días

function readDeviceCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const prefix = `${name}=`;
    const parts = document.cookie.split(';');
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.startsWith(prefix)) {
        return decodeURIComponent(trimmed.slice(prefix.length));
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function writeDeviceCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  try {
    const secureAttr = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${DEVICE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secureAttr}`;
  } catch {
    // ignore
  }
}

function deleteDeviceCookie(name: string): void {
  if (typeof document === 'undefined') return;
  try {
    const secureAttr = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secureAttr}`;
  } catch {
    // ignore
  }
}

function getSavedTallerToken(): string | null {
  try {
    const ls = localStorage.getItem(TALLER_TOKEN_STORAGE_KEY);
    if (ls) return ls;
  } catch {
    // ignore
  }
  const ck = readDeviceCookie(TALLER_TOKEN_STORAGE_KEY);
  if (ck) {
    try {
      localStorage.setItem(TALLER_TOKEN_STORAGE_KEY, ck);
    } catch {
      // ignore
    }
    return ck;
  }
  return null;
}

function saveTallerToken(token: string | null | undefined): void {
  if (!token) return;
  try {
    localStorage.setItem(TALLER_TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore
  }
  writeDeviceCookie(TALLER_TOKEN_STORAGE_KEY, token);
}

function clearTallerSessionStorage(): void {
  try {
    localStorage.removeItem(TALLER_TOKEN_STORAGE_KEY);
    localStorage.removeItem(TALLER_AUTH_STORAGE_KEY);
  } catch {
    // ignore
  }
  deleteDeviceCookie(TALLER_TOKEN_STORAGE_KEY);
}

function saveTallerUser(user: EncargadoZonaSession): void {
  try {
    localStorage.setItem(TALLER_AUTH_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // ignore
  }
}

export function getCachedEncargadoZonaUser(): EncargadoZonaSession | null {
  try {
    const raw = localStorage.getItem(TALLER_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EncargadoZonaSession>;
    if (parsed && typeof parsed.id === 'string' && parsed.rol === 'encargado_zona') {
      return parsed as EncargadoZonaSession;
    }
  } catch {
    // ignore
  }
  return null;
}

function buildAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-origen': 'taller',
    ...(extra || {}),
  };
  const token = getSavedTallerToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const cachedUser = getCachedEncargadoZonaUser();
  if (cachedUser?.id) {
    headers['x-taller-user-id'] = cachedUser.id;
  }
  return headers;
}

async function fetchWithTimeout(input: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, {
      ...init,
      credentials: 'include',
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new QrApiError('Tiempo de espera agotado conectando con el servidor.', 408);
    }
    throw new QrApiError('Error de red. Verificá tu conexión.', 0);
  } finally {
    window.clearTimeout(timer);
  }
}

async function parseJsonSafe(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function verifyEncargadoZonaSession(): Promise<{
  authorized: boolean;
  user?: EncargadoZonaSession;
  error?: string;
}> {
  const cached = getCachedEncargadoZonaUser();
  const qs = cached?.id ? `?user_id=${encodeURIComponent(cached.id)}` : '';
  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/auth/verify${qs}`, {
    method: 'GET',
    headers: buildAuthHeaders(),
  });
  const body = await parseJsonSafe(res);

  if (!res.ok || !body.authorized || !body.user) {
    if (res.status === 401 || res.status === 403) {
      clearTallerSessionStorage();
    }
    return {
      authorized: false,
      error: typeof body.error === 'string' ? body.error : undefined,
    };
  }

  const user = body.user as Partial<EncargadoZonaSession>;
  if (user.rol !== 'encargado_zona') {
    return {
      authorized: false,
      error: 'Acceso exclusivo para Encargados de Zona.',
    };
  }

  const sessionUser = user as EncargadoZonaSession;
  if (typeof body.sessionToken === 'string') {
    saveTallerToken(body.sessionToken);
  }
  saveTallerUser(sessionUser);
  return { authorized: true, user: sessionUser };
}

export async function loginEncargadoZona(
  nombreUsuario: string,
  password: string
): Promise<EncargadoZonaSession> {
  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-origen': 'taller' },
    body: JSON.stringify({
      nombre_usuario: nombreUsuario.trim(),
      password,
    }),
  });
  const body = await parseJsonSafe(res);

  if (!res.ok || !body.authenticated || !body.user) {
    throw new QrApiError(
      typeof body.error === 'string' ? body.error : 'Credenciales inválidas.',
      res.status
    );
  }

  const user = body.user as Partial<EncargadoZonaSession>;
  if (user.rol !== 'encargado_zona') {
    // No retener sesión si el usuario no es encargado_zona
    try {
      await fetchWithTimeout(`${API_BASE}/api/planeacion/auth/logout`, { method: 'POST' });
    } catch {
      // ignore
    }
    clearTallerSessionStorage();
    throw new QrApiError(
      'Acceso restringido: solo Encargados de Zona pueden usar el ingreso QR.',
      403
    );
  }

  const sessionUser = user as EncargadoZonaSession;
  if (typeof body.sessionToken === 'string') {
    saveTallerToken(body.sessionToken);
  }
  saveTallerUser(sessionUser);
  return sessionUser;
}

export async function logoutEncargadoZona(): Promise<void> {
  try {
    await fetchWithTimeout(`${API_BASE}/api/planeacion/auth/logout`, {
      method: 'POST',
      headers: buildAuthHeaders(),
    });
  } catch {
    // ignore
  } finally {
    clearTallerSessionStorage();
  }
}

export async function resolveDominioTractor(dominio: string): Promise<QrResolveTractorResult> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/planeacion/qr/resolve?dominio=${encodeURIComponent(dominio)}`,
    {
      method: 'GET',
      headers: buildAuthHeaders(),
    }
  );
  const body = await parseJsonSafe(res);

  if (!res.ok || !body.success) {
    throw new QrApiError(
      typeof body.error === 'string' ? body.error : 'No se pudo consultar el dominio.',
      res.status
    );
  }

  return {
    found: Boolean(body.found),
    dominio_normalizado: String(body.dominio_normalizado || ''),
    tractor_id: typeof body.tractor_id === 'string' ? body.tractor_id : null,
    dominio_registrado: typeof body.dominio_registrado === 'string' ? body.dominio_registrado : null,
    semi_id: typeof body.semi_id === 'string' ? body.semi_id : null,
    semi_dominio: typeof body.semi_dominio === 'string' ? body.semi_dominio : null,
    n_ute: typeof body.n_ute === 'string' ? body.n_ute : null,
    ya_en_circuito: Boolean(body.ya_en_circuito),
    semi_ya_en_circuito: Boolean(body.semi_ya_en_circuito),
    circuito_abierto_id: typeof body.circuito_abierto_id === 'string' ? body.circuito_abierto_id : null,
    ingreso_at: typeof body.ingreso_at === 'string' ? body.ingreso_at : null,
  };
}

export async function confirmarAltaCircuitoQr(
  dominioTractor: string
): Promise<QrAltaCircuitoResult> {
  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/qr/alta-circuito`, {
    method: 'POST',
    headers: buildAuthHeaders(),
    body: JSON.stringify({ dominioTractor }),
  });
  const body = await parseJsonSafe(res);

  if (!res.ok || !body.success || !body.circuito) {
    throw new QrApiError(
      typeof body.error === 'string' ? body.error : 'No se pudo registrar el ingreso al circuito.',
      res.status
    );
  }

  return body.circuito as QrAltaCircuitoResult;
}
