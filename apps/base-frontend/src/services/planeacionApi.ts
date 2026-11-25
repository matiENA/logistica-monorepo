import { io, type Socket } from 'socket.io-client';
import type {
  BoardResponse,
  CircuitoAbierto,
  EstadoBox,
  PlaneacionCard,
  PlaneacionUnidadDetalle,
  ProcesoNota,
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
const TALLER_AUTH_STORAGE_KEY = 'base_taller_user';
const COORDINACION_AUTH_STORAGE_KEY = 'base_coordinacion_user';

export function getSavedTallerUser(): UsuarioTallerSession | null {
  try {
    const raw = localStorage.getItem(TALLER_AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UsuarioTallerSession;
  } catch {
    return null;
  }
}

export function saveTallerUser(user: UsuarioTallerSession) {
  try {
    localStorage.setItem(TALLER_AUTH_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // ignore storage quota errors
  }
}

export function clearTallerUser() {
  try {
    localStorage.removeItem(TALLER_AUTH_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function getSavedCoordinacionUser(): UsuarioCoordinacionSession | null {
  try {
    const raw = localStorage.getItem(COORDINACION_AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UsuarioCoordinacionSession;
  } catch {
    return null;
  }
}

export function saveCoordinacionUser(user: UsuarioCoordinacionSession) {
  try {
    localStorage.setItem(COORDINACION_AUTH_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // ignore storage quota errors
  }
}

export function clearCoordinacionUser() {
  try {
    localStorage.removeItem(COORDINACION_AUTH_STORAGE_KEY);
  } catch {
    // ignore
  }
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
    if (taller) {
      headers['x-taller-user-id'] = taller.id;
      headers['x-user-id'] = taller.id;
      headers['x-origen'] = 'taller';
      return headers;
    }
    if (mode === 'lite') {
      const coordFallback = getSavedCoordinacionUser();
      if (coordFallback) {
        headers['x-coordinacion-user-id'] = coordFallback.id;
        headers['x-user-id'] = coordFallback.id;
        headers['x-origen'] = 'coordinacion';
      }
    }
    return headers;
  }

  const coord = getSavedCoordinacionUser();
  if (coord) {
    headers['x-coordinacion-user-id'] = coord.id;
    headers['x-user-id'] = coord.id;
    headers['x-origen'] = 'coordinacion';
  }
  return headers;
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
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
}): Promise<{ authenticated: boolean; user?: UsuarioCoordinacionSession; error?: string }> {
  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/auth/coordinacion/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.authenticated || !data.user) {
    throw new Error(data.error || 'Usuario o contraseña de coordinación incorrectos');
  }
  saveCoordinacionUser(data.user);
  return data;
}

export async function verificarAccesoCoordinacion(
  userId: string
): Promise<{ authorized: boolean; user?: UsuarioCoordinacionSession; error?: string }> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/planeacion/auth/coordinacion/verify?user_id=${encodeURIComponent(userId)}`,
    {
      headers: {
        'x-coordinacion-user-id': userId,
      },
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.authorized || !data.user) {
    clearCoordinacionUser();
    return {
      authorized: false,
      error: data.error || 'Acceso delimitado a base.user_coordinacion',
    };
  }
  saveCoordinacionUser(data.user);
  return { authorized: true, user: data.user };
}

export async function loginUsuarioTaller(payload: {
  nombre_usuario: string;
  password: string;
}): Promise<{ authenticated: boolean; user?: UsuarioTallerSession; error?: string }> {
  const res = await fetchWithTimeout(`${API_BASE}/api/planeacion/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.authenticated || !data.user) {
    throw new Error(data.error || 'Usuario o contraseña incorrectos');
  }
  saveTallerUser(data.user);
  return data;
}

export async function verificarAccesoTaller(
  userId: string
): Promise<{ authorized: boolean; user?: UsuarioTallerSession; error?: string }> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/planeacion/auth/verify?user_id=${encodeURIComponent(userId)}`,
    {
      headers: {
        'x-taller-user-id': userId,
      },
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.authorized || !data.user) {
    clearTallerUser();
    return {
      authorized: false,
      error: data.error || 'Acceso delimitado a base.usuarios_taller',
    };
  }
  saveTallerUser(data.user);
  return { authorized: true, user: data.user };
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
  updatedAt?: number;
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
