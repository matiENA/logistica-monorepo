// ==============================================================
// 🌐 CLIENTE API CENTRALIZADO DE PAÑOL LOGISTICS
// ==============================================================

const IS_LOCAL = typeof window !== 'undefined' && (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
);

export const BACKEND_URL = IS_LOCAL
  ? 'http://localhost:5000'
  : (import.meta.env.VITE_BACKEND_URL || 'https://panolnd.onrender.com');

export async function panolFetch<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `${BACKEND_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const headers = new Headers(options.headers || {});

  const token = typeof window !== 'undefined' ? localStorage.getItem('sys_auth_token') : null;
  if (token && !headers.has('x-auth-token')) {
    headers.set('x-auth-token', token);
  }

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (response.status === 401) {
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new Error('No autorizado (401)');
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error [${response.status}]: ${errorText}`);
  }

  return response.json();
}
