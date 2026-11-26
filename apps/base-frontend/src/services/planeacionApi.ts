import { io, type Socket } from 'socket.io-client';
import type {
  BoardResponse,
  CircuitoAbierto,
  CircuitoTimelineStep,
  EstadoBox,
  PlaneacionCard,
  PlaneacionUnidadDetalle,
  ProcesoNota,
  QuitarOperarioProcesoResponse,
  ReasignarOperarioBoxResponse,
  TrayectoriaResponse,
  UsuarioCoordinacionSession,
  UsuarioTallerSession,
} from '../types/planeacion';

export class PlaneacionApiError extends Error {
  public readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'PlaneacionApiError';
    this.status = status;
  }
}

function extractApiErrorMessage(errBody: unknown, fallback: string): string {
  if (!errBody || typeof errBody !== 'object') return fallback;
  const rawError = (errBody as { error?: unknown }).error;
  if (typeof rawError === 'string' && rawError.trim()) return rawError;
  if (rawError && typeof rawError === 'object') {
    const flat = rawError as { formErrors?: unknown; fieldErrors?: Record<string, unknown> };
    const parts: string[] = [];
    if (Array.isArray(flat.formErrors)) {
      parts.push(...flat.formErrors.filter((m): m is string => typeof m === 'string' && m.trim().length > 0));
    }
    if (flat.fieldErrors && typeof flat.fieldErrors === 'object') {
      for (const [field, msgs] of Object.entries(flat.fieldErrors)) {
        if (Array.isArray(msgs) && msgs.length > 0) {
          parts.push(`${field}: ${msgs.map(String).join(', ')}`);
        }
      }
    }
    if (parts.length > 0) return parts.join(' | ');
  }
  return fallback;
}

const API_BASE = import.meta.env.VITE_API_URL || '';
const REQUEST_TIMEOUT_MS = 50_000; // Poka-Yoke Cold Start (Render)
export const TALLER_AUTH_STORAGE_KEY = 'base_taller_user';
export const COORDINACION_AUTH_STORAGE_KEY = 'base_coordinacion_user';
const TALLER_TOKEN_STORAGE_KEY = 'base_taller_session_token';
const COORDINACION_TOKEN_STORAGE_KEY = 'base_coordinacion_session_token';
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

export function getSavedTallerToken(): string | null {
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
  }
  return ck;
}

export function saveTallerToken(token: string) {
  try {
    localStorage.setItem(TALLER_TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore
  }
  writeDeviceCookie(TALLER_TOKEN_STORAGE_KEY, token);
}

export function getSavedCoordinacionToken(): string | null {
  try {
    const ls = localStorage.getItem(COORDINACION_TOKEN_STORAGE_KEY);
    if (ls) return ls;
  } catch {
    // ignore
  }
  const ck = readDeviceCookie(COORDINACION_TOKEN_STORAGE_KEY);
  if (ck) {
    try {
      localStorage.setItem(COORDINACION_TOKEN_STORAGE_KEY, ck);
    } catch {
      // ignore
    }
  }
  return ck;
}

export function saveCoordinacionToken(token: string) {
  try {
    localStorage.setItem(COORDINACION_TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore
  }
  writeDeviceCookie(COORDINACION_TOKEN_STORAGE_KEY, token);
}

export function getSavedTallerUser(): UsuarioTallerSession | null {
  try {
    const raw = localStorage.getItem(TALLER_AUTH_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as UsuarioTallerSession;
  } catch {
    // ignore
  }
  const ck = readDeviceCookie(TALLER_AUTH_STORAGE_KEY);
  if (ck) {
    try {
      const parsed = JSON.parse(ck) as UsuarioTallerSession;
      try {
        localStorage.setItem(TALLER_AUTH_STORAGE_KEY, ck);
      } catch {
        // ignore
      }
      return parsed;
    } catch {
      // ignore
    }
  }
  return null;
}

export function saveTallerUser(user: UsuarioTallerSession, sessionToken?: string) {
  const serialized = JSON.stringify(user);
  try {
    localStorage.setItem(TALLER_AUTH_STORAGE_KEY, serialized);
  } catch {
    // ignore storage quota errors
  }
  writeDeviceCookie(TALLER_AUTH_STORAGE_KEY, serialized);
  if (sessionToken) {
    saveTallerToken(sessionToken);
  }
}

export function clearTallerUser() {
  try {
    localStorage.removeItem(TALLER_AUTH_STORAGE_KEY);
    localStorage.removeItem(TALLER_TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
  deleteDeviceCookie(TALLER_AUTH_STORAGE_KEY);
  deleteDeviceCookie(TALLER_TOKEN_STORAGE_KEY);
}

export function getSavedCoordinacionUser(): UsuarioCoordinacionSession | null {
  try {
    const raw = localStorage.getItem(COORDINACION_AUTH_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as UsuarioCoordinacionSession;
  } catch {
    // ignore
  }
  const ck = readDeviceCookie(COORDINACION_AUTH_STORAGE_KEY);
  if (ck) {
    try {
      const parsed = JSON.parse(ck) as UsuarioCoordinacionSession;
      try {
        localStorage.setItem(COORDINACION_AUTH_STORAGE_KEY, ck);
      } catch {
        // ignore
      }
      return parsed;
    } catch {
      // ignore
    }
  }
  return null;
}

export function saveCoordinacionUser(user: UsuarioCoordinacionSession, sessionToken?: string) {
  const serialized = JSON.stringify(user);
  try {
    localStorage.setItem(COORDINACION_AUTH_STORAGE_KEY, serialized);
  } catch {
    // ignore storage quota errors
  }
  writeDeviceCookie(COORDINACION_AUTH_STORAGE_KEY, serialized);
  if (sessionToken) {
    saveCoordinacionToken(sessionToken);
  }
}

export function clearCoordinacionUser() {
  try {
    localStorage.removeItem(COORDINACION_AUTH_STORAGE_KEY);
    localStorage.removeItem(COORDINACION_TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
  deleteDeviceCookie(COORDINACION_AUTH_STORAGE_KEY);
  deleteDeviceCookie(COORDINACION_TOKEN_STORAGE_KEY);
}

function isTallerPathname(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.location.pathname.startsWith('/taller') ||
      window.location.pathname.startsWith('/login'))
  );
}

export function getActiveSessionUser(): {
  id: string;
  nombre_usuario: string;
  rol: 'taller' | 'coordinacion';
} | null {
  if (isTallerPathname()) {
    const taller = getSavedTallerUser();
    if (taller) return { id: taller.id, nombre_usuario: taller.nombre_usuario, rol: 'taller' };
    return null;
  }
  const coord = getSavedCoordinacionUser();
  if (coord) return { id: coord.id, nombre_usuario: coord.nombre_usuario, rol: 'coordinacion' };
  return null;
}

const boardCache: Record<string, { etag: string | null; data: BoardResponse | null }> = {
  full: { etag: null, data: null },
  lite: { etag: null, data: null },
};

export function clearBoardCache() {
  for (const key of Object.keys(boardCache)) {
    boardCache[key].etag = null;
    boardCache[key].data = null;
  }
}

function buildAuthHeaders(
  mode?: 'full' | 'lite',
  includeJsonContentType = false
): Record<string, string> {
  const headers: Record<string, string> = includeJsonContentType
    ? { 'Content-Type': 'application/json' }
    : {};

  const useTaller = mode === 'lite' || (mode === undefined && isTallerPathname());
  if (useTaller) {
    const taller = getSavedTallerUser();
    const tallerToken = getSavedTallerToken();
    if (taller) {
      headers['x-taller-user-id'] = taller.id;
      headers['x-user-id'] = taller.id;
      headers['x-origen'] = 'taller';
      if (tallerToken) headers['Authorization'] = `Bearer ${tallerToken}`;
      return headers;
    }
    if (tallerToken) {
      headers['Authorization'] = `Bearer ${tallerToken}`;
      headers['x-origen'] = 'taller';
      return headers;
    }
    if (mode === 'lite') {
      const coordFallback = getSavedCoordinacionUser();
      const coordToken = getSavedCoordinacionToken();
      if (coordFallback) {
        headers['x-coordinacion-user-id'] = coordFallback.id;
        headers['x-user-id'] = coordFallback.id;
        headers['x-origen'] = 'coordinacion';
        if (coordToken) headers['Authorization'] = `Bearer ${coordToken}`;
      }
    }
    return headers;
  }

  const coord = getSavedCoordinacionUser();
  const coordToken = getSavedCoordinacionToken();
  if (coord) {
    headers['x-coordinacion-user-id'] = coord.id;
    headers['x-user-id'] = coord.id;
    headers['x-origen'] = 'coordinacion';
  }
  if (coordToken) {
    headers['Authorization'] = `Bearer ${coordToken}`;
  }
  return headers;
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, {
      credentials: 'include',
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(id);
  }
}

async function loadBoardWithEtag(mode: 'full' | 'lite', zoneId?: string): Promise<BoardResponse> {
  const cacheKey = mode === 'lite' && zoneId ? `lite:${zoneId}` : mode;
  if (!boardCache[cacheKey]) {
    boardCache[cacheKey] = { etag: null, data: null };
  }
  const entry = boardCache[cacheKey];
  const headers: Record<string, string> = {
    ...buildAuthHeaders(mode, false),
    ...(entry.etag ? { 'If-None-Match': entry.etag } : {}),
  };
  const qs =
    mode === 'lite'
      ? `?includeCatalog=0${zoneId ? `&zoneId=${encodeURIComponent(zoneId)}` : ''}`
      : '';

  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/board${qs}`, { headers });

  if (res.status === 304 && entry.data) {
    return entry.data;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PlaneacionApiError(
      extractApiErrorMessage(err, `Error HTTP ${res.status} cargando tablero de planeación`),
      res.status
    );
  }

  const etag = res.headers.get('ETag');
  const raw = (await res.json()) as Partial<BoardResponse>;
  const data: BoardResponse = {
    success: Boolean(raw.success),
    activos: raw.activos || [],
    holds: raw.holds || [],
    circuitos_abiertos: raw.circuitos_abiertos || [],
    circuitos_terminados: raw.circuitos_terminados || [],
    circuitos_timelines: raw.circuitos_timelines || {},
    catalog: raw.catalog || { zones: [], boxes: [], usuarios: [], unidades: [] },
    taller_zone_map: raw.taller_zone_map ?? null,
    updatedAt: raw.updatedAt || Date.now(),
  };

  if (etag) entry.etag = etag;
  entry.data = data;
  return data;
}

export async function fetchPlaneacionBoard(): Promise<BoardResponse> {
  return loadBoardWithEtag('full');
}

export async function fetchTallerBoard(zoneId?: string): Promise<BoardResponse> {
  return loadBoardWithEtag('lite', zoneId);
}

export async function fetchFinalizados(limit = 50, offset = 0): Promise<PlaneacionCard[]> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/planeacion/finalizados?limit=${limit}&offset=${offset}`,
    {
      headers: buildAuthHeaders(undefined, false),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PlaneacionApiError(
      extractApiErrorMessage(err, `Error HTTP ${res.status} cargando finalizados`),
      res.status
    );
  }
  const data = await res.json();
  return data.items || [];
}

export async function fetchUnidadDetalleDeployed(params: {
  tractor?: string;
  semi?: string;
  n_ute?: string;
}): Promise<PlaneacionUnidadDetalle | null> {
  const qs = new URLSearchParams();
  if (params.tractor) qs.set('tractor', params.tractor);
  if (params.semi) qs.set('semi', params.semi);
  if (params.n_ute) qs.set('n_ute', params.n_ute);

  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/unidad-detalle?${qs.toString()}`, {
    headers: buildAuthHeaders(undefined, false),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.detail || null;
}

function buildSessionHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...buildAuthHeaders(undefined, true),
    ...(extra || {}),
  };
}

export async function registrarLlegadaBox(payload: {
  boxId: string;
  unidadId?: string | null;
  tractorId?: string | null;
  semiId?: string | null;
  usuariosIds?: string[];
  notaTexto?: string | null;
  notaUsuarioId?: string | null;
}) {
  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/procesos/llegada`, {
    method: 'POST',
    headers: buildSessionHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PlaneacionApiError(extractApiErrorMessage(err, 'Error registrando llegada a box'), res.status);
  }
  clearBoardCache();
  return res.json();
}

export async function actualizarProceso(
  procesoId: string,
  patch: {
    boxId?: string;
    zoneId?: string;
    estado?: EstadoBox | null;
    usuariosIds?: string[];
    targetEstado?: 'LLEGADA' | 'INICIO';
    action?:
      | 'INICIAR'
      | 'FINALIZAR'
      | 'REABRIR'
      | 'DESHACER_INICIO'
      | 'DESHACER'
      | 'REVERTIR_A_HOLD'
      | 'VOLVER_A_RESERVADO'
      | 'REINTEGRAR_A_PREASIGNADO'
      | 'ARCHIVAR';
  }
) {
  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/procesos/${procesoId}`, {
    method: 'PATCH',
    headers: buildSessionHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PlaneacionApiError(extractApiErrorMessage(err, 'Error actualizando proceso'), res.status);
  }
  clearBoardCache();
  return res.json();
}

export async function crearHold(payload: {
  zoneId: string;
  boxId?: string | null;
  circuitoId?: string | null;
  unidadId?: string | null;
  tractorId?: string | null;
  semiId?: string | null;
  orden?: number;
  usuariosIds?: string[];
  notaPlanificacion?: string | null;
  procesoOrigenId?: string | null;
}) {
  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/holds`, {
    method: 'POST',
    headers: buildSessionHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PlaneacionApiError(err.error || 'Error creando preasignación', res.status);
  }
  clearBoardCache();
  return res.json();
}

export async function altaCircuito(payload: {
  unidadId?: string | null;
  tractorId?: string | null;
  semiId?: string | null;
  tractorN?: string | null;
  semiN?: string | null;
  notaTexto?: string | null;
}): Promise<{ success: boolean; circuito: CircuitoAbierto }> {
  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/circuitos`, {
    method: 'POST',
    headers: buildSessionHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PlaneacionApiError(
      typeof err.error === 'string' ? err.error : 'Error incorporando unidad al circuito',
      res.status
    );
  }
  clearBoardCache();
  return res.json();
}

export async function bajaCircuito(circuitoId: string) {
  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/circuitos/${circuitoId}/baja`, {
    method: 'POST',
    headers: buildSessionHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PlaneacionApiError(
      typeof err.error === 'string' ? err.error : 'Error dando de baja el circuito',
      res.status
    );
  }
  clearBoardCache();
  return res.json();
}

export async function reordenarProcesosCircuito(
  circuitoId: string,
  procesoIds: string[]
): Promise<{ success: boolean; circuitoId: string; timeline: CircuitoTimelineStep[] }> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/planeacion/circuitos/${circuitoId}/procesos-orden`,
    {
      method: 'PATCH',
      headers: buildSessionHeaders(),
      body: JSON.stringify({ procesoIds }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PlaneacionApiError(
      extractApiErrorMessage(err, 'Error reordenando procesos del circuito'),
      res.status
    );
  }
  clearBoardCache();
  return res.json();
}

export async function fetchProcesoNotas(procesoId: string): Promise<ProcesoNota[]> {
  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/procesos/${procesoId}/notas`, {
    headers: buildAuthHeaders(undefined, false),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PlaneacionApiError(
      extractApiErrorMessage(err, 'Error cargando notas del proceso'),
      res.status
    );
  }
  const data = await res.json();
  return Array.isArray(data.notes) ? data.notes : [];
}

export interface NotaMutationResponse {
  success: boolean;
  result?: {
    procesoId?: string;
    circuitoId?: string;
    notes: ProcesoNota[];
  };
}

export async function agregarNotaProceso(
  procesoId: string,
  payload: { usuarioId?: string | null; usuario_id?: string | null; usuario?: string; location?: string; texto: string }
): Promise<NotaMutationResponse> {
  const isTaller = isTallerPathname();
  const tallerUser = isTaller ? getSavedTallerUser() : null;
  const coordUser = !isTaller ? getSavedCoordinacionUser() : null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  let usuarioId = payload.usuarioId ?? payload.usuario_id ?? null;
  let usuario: string | null = payload.usuario ?? null;
  let location = payload.location ?? null;

  if (isTaller && tallerUser) {
    usuarioId = tallerUser.id;
    usuario = tallerUser.nombre_usuario;
    location = tallerUser.box_name || 'Box';
    headers['x-taller-user-id'] = tallerUser.id;
    headers['x-user-id'] = tallerUser.id;
    headers['x-usuario-nombre'] = tallerUser.nombre_usuario;
    headers['x-origen'] = 'taller';
  } else {
    // Coordinación: sin usuario en nota, location = 'Coordinación', pero envía auth header de sesión
    usuarioId = null;
    usuario = null;
    location = 'Coordinación';
    headers['x-origen'] = 'coordinacion';
    if (coordUser) {
      headers['x-coordinacion-user-id'] = coordUser.id;
      headers['x-user-id'] = coordUser.id;
    }
  }

  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/procesos/${procesoId}/notas`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      texto: payload.texto,
      usuarioId,
      usuario: usuario ?? undefined,
      location: location ?? undefined,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PlaneacionApiError(extractApiErrorMessage(err, 'Error agregando nota'), res.status);
  }
  clearBoardCache();
  return res.json();
}

export async function loginUsuarioCoordinacion(payload: {
  nombre_usuario: string;
  password: string;
}): Promise<{
  authenticated: boolean;
  user?: UsuarioCoordinacionSession;
  sessionToken?: string;
  error?: string;
}> {
  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/auth/coordinacion/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.authenticated || !data.user) {
    throw new Error(data.error || 'Usuario o contraseña de coordinación incorrectos');
  }
  saveCoordinacionUser(data.user, typeof data.sessionToken === 'string' ? data.sessionToken : undefined);
  return data;
}

export async function logoutUsuarioCoordinacion(): Promise<void> {
  clearCoordinacionUser();
  clearBoardCache();
  try {
    await fetchWithTimeout(`${API_BASE}/api/planeacion/auth/coordinacion/logout`, {
      method: 'POST',
    });
  } catch {
    // Best-effort: el estado local ya se limpió
  }
}

export async function verificarAccesoCoordinacion(
  userId?: string
): Promise<{
  authorized: boolean;
  user?: UsuarioCoordinacionSession;
  error?: string;
  transientError?: boolean;
}> {
  const token = getSavedCoordinacionToken();
  const headers: Record<string, string> = {};
  if (userId) headers['x-coordinacion-user-id'] = userId;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const qs = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/auth/coordinacion/verify${qs}`, {
      headers,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      clearCoordinacionUser();
      return {
        authorized: false,
        error: data.error || 'Acceso delimitado a base.user_coordinacion',
      };
    }
    if (!res.ok || !data.authorized || !data.user) {
      // Error transitorio (5xx / cold start): conservar la sesión persistida en el dispositivo
      return {
        authorized: false,
        transientError: true,
        error: data.error || `Error temporal verificando sesión (${res.status})`,
      };
    }
    saveCoordinacionUser(data.user, typeof data.sessionToken === 'string' ? data.sessionToken : undefined);
    return { authorized: true, user: data.user };
  } catch {
    // Fallo de red / timeout: nunca borrar sesión persistida
    return {
      authorized: false,
      transientError: true,
      error: 'Sin conexión temporal con el servidor',
    };
  }
}

export async function loginUsuarioTaller(payload: {
  nombre_usuario: string;
  password: string;
}): Promise<{
  authenticated: boolean;
  user?: UsuarioTallerSession;
  sessionToken?: string;
  error?: string;
}> {
  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.authenticated || !data.user) {
    throw new Error(data.error || 'Usuario o contraseña incorrectos');
  }
  saveTallerUser(data.user, typeof data.sessionToken === 'string' ? data.sessionToken : undefined);
  return data;
}

export async function logoutUsuarioTaller(): Promise<void> {
  clearTallerUser();
  clearBoardCache();
  try {
    await fetchWithTimeout(`${API_BASE}/api/planeacion/auth/logout`, {
      method: 'POST',
    });
  } catch {
    // Best-effort: el estado local ya se limpió
  }
}

export async function verificarAccesoTaller(
  userId?: string
): Promise<{
  authorized: boolean;
  user?: UsuarioTallerSession;
  error?: string;
  transientError?: boolean;
}> {
  const token = getSavedTallerToken();
  const headers: Record<string, string> = {};
  if (userId) headers['x-taller-user-id'] = userId;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const qs = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/auth/verify${qs}`, {
      headers,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      clearTallerUser();
      return {
        authorized: false,
        error: data.error || 'Acceso delimitado a base.usuarios_taller',
      };
    }
    if (!res.ok || !data.authorized || !data.user) {
      // Error transitorio (5xx / cold start): conservar la sesión persistida en el dispositivo
      return {
        authorized: false,
        transientError: true,
        error: data.error || `Error temporal verificando sesión (${res.status})`,
      };
    }
    saveTallerUser(data.user, typeof data.sessionToken === 'string' ? data.sessionToken : undefined);
    return { authorized: true, user: data.user };
  } catch {
    // Fallo de red / timeout: nunca borrar sesión persistida
    return {
      authorized: false,
      transientError: true,
      error: 'Sin conexión temporal con el servidor',
    };
  }
}

export async function editarNotaProceso(
  procesoId: string,
  noteId: string,
  payload: { usuarioId?: string | null; usuario_id?: string | null; usuario?: string; texto: string }
) {
  const activeUser = getActiveSessionUser();
  const usuarioId = payload.usuarioId || payload.usuario_id || activeUser?.id || null;
  const usuario = payload.usuario || activeUser?.nombre_usuario || undefined;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (activeUser?.rol === 'coordinacion') {
    headers['x-coordinacion-user-id'] = activeUser.id;
    headers['x-origen'] = 'coordinacion';
  } else if (activeUser?.rol === 'taller') {
    headers['x-taller-user-id'] = activeUser.id;
    headers['x-origen'] = 'taller';
  }
  if (usuarioId) {
    headers['x-user-id'] = usuarioId;
  }
  if (usuario) {
    headers['x-usuario-nombre'] = usuario;
  }

  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/procesos/${procesoId}/notas/${noteId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      texto: payload.texto,
      usuarioId,
      usuario,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PlaneacionApiError(extractApiErrorMessage(err, 'Error editando nota'), res.status);
  }
  clearBoardCache();
  return res.json();
}

export async function eliminarNotaProceso(procesoId: string, noteId: string) {
  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/procesos/${procesoId}/notas/${noteId}`, {
    method: 'DELETE',
    headers: buildSessionHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PlaneacionApiError(extractApiErrorMessage(err, 'Error eliminando nota'), res.status);
  }
  clearBoardCache();
  return res.json();
}

export async function activarHoldProceso(
  holdId: string,
  boxId?: string | null,
  iniciarInmediato = false,
  estado?: EstadoBox | null
) {
  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/holds/${holdId}/activar`, {
    method: 'POST',
    headers: buildSessionHeaders(),
    body: JSON.stringify({
      boxId: boxId || null,
      iniciarInmediato,
      ...(estado !== undefined ? { estado } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PlaneacionApiError(extractApiErrorMessage(err, 'Error activando unidad en box'), res.status);
  }
  clearBoardCache();
  return res.json();
}

export async function actualizarHold(
  id: string,
  patch: {
    zoneId?: string;
    boxId?: string | null;
    orden?: number;
    usuariosIds?: string[];
    notaPlanificacion?: string | null;
  }
) {
  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/holds/${id}`, {
    method: 'PATCH',
    headers: buildSessionHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PlaneacionApiError(extractApiErrorMessage(err, 'Error actualizando preasignación'), res.status);
  }
  clearBoardCache();
  return res.json();
}

export async function eliminarHold(id: string) {
  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/holds/${id}`, {
    method: 'DELETE',
    headers: buildSessionHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PlaneacionApiError(err.error || 'Error eliminando preasignación', res.status);
  }
  clearBoardCache();
  return res.json();
}

export async function fetchTrayectoriaUnidad(params: {
  unidadId?: string | null;
  tractorId?: string | null;
  semiId?: string | null;
}): Promise<TrayectoriaResponse> {
  const qs = new URLSearchParams();
  if (params.unidadId) qs.set('unidad_id', params.unidadId);
  if (params.tractorId) qs.set('tractor_id', params.tractorId);
  if (params.semiId) qs.set('semi_id', params.semiId);

  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/trayectoria?${qs.toString()}`, {
    headers: buildAuthHeaders(undefined, false),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PlaneacionApiError(
      extractApiErrorMessage(err, 'Error consultando timeline de unidad'),
      res.status
    );
  }
  return res.json();
}

export interface UnidadSalidaHoldEvent {
  procesoId: string;
  unidadId: string | null;
  tractorId: string | null;
  semiId: string | null;
  origenBox: string;
  salidaAt: string;
  ultimaTarea: string | null;
  pendingHold: {
    id: string;
    zone_id: string;
    zone_name: string;
    box_id: string | null;
    box_name: string;
    orden: number;
    usuarios_ids: string[];
  } | null;
  updatedAt: number;
}

export interface PlaneacionBoardUpdateEvent {
  action?: string;
  procesoId?: string;
  holdId?: string;
  circuitoId?: string;
  operarioId?: string;
  boxId?: string | null;
  zoneId?: string | null;
  updatedAt?: number;
}

export async function reasignarBoxOperario(
  operarioId: string,
  boxId: string | null
): Promise<ReasignarOperarioBoxResponse> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/planeacion/taller/operarios/${operarioId}/box`,
    {
      method: 'PATCH',
      headers: buildSessionHeaders(),
      body: JSON.stringify({ boxId }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PlaneacionApiError(
      extractApiErrorMessage(err, 'Error reasignando box de operario'),
      res.status
    );
  }
  clearBoardCache();
  return res.json();
}

export async function quitarOperarioDeProceso(
  procesoId: string,
  operarioId: string
): Promise<QuitarOperarioProcesoResponse> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/planeacion/procesos/${procesoId}/usuarios/${operarioId}`,
    {
      method: 'DELETE',
      headers: buildSessionHeaders(),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new PlaneacionApiError(
      extractApiErrorMessage(err, 'Error quitando operario del proceso'),
      res.status
    );
  }
  clearBoardCache();
  return res.json();
}

export function subscribePlaneacionSocket(
  onUpdate: (event?: PlaneacionBoardUpdateEvent) => void,
  onUnidadSalidaHold?: (event: UnidadSalidaHoldEvent) => void
): () => void {
  const socket: Socket = io(API_BASE || window.location.origin, {
    transports: ['websocket', 'polling'],
  });
  socket.on('planeacion_board_updated', onUpdate);
  if (onUnidadSalidaHold) {
    socket.on('unidad_salida_hold', onUnidadSalidaHold);
  }
  return () => {
    socket.off('planeacion_board_updated', onUpdate);
    if (onUnidadSalidaHold) {
      socket.off('unidad_salida_hold', onUnidadSalidaHold);
    }
    socket.disconnect();
  };
}
