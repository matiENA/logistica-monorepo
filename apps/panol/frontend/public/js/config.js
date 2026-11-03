// ==============================================================
// 🌐 CONFIGURACIÓN CENTRALIZADA DE BACKEND (PAÑOL CLIENTE)
// ==============================================================

(function() {
  // 🚀 CONFIGURACIÓN DE BACKEND ACTIVO EN RENDER
  // Web Service de Producción en Render:
  const BACKEND_PROD_URL = "https://panol-monolith-service.onrender.com"; // RENDER (ACTIVO)
  // const BACKEND_PROD_URL = "https://panolnd-taller.up.railway.app"; // RAILWAY (BACKUP / ALTERNATIVO)

  const isLocal = typeof window !== 'undefined' && window.location && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.protocol === 'file:'
  );

  // Puerto asignado al Backend en localhost: 5000 (Frontend corre en localhost:5173, Dash en 3000/3005)
  const LOCAL_BACKEND_PORT = 5000;
  const localHost = (typeof window !== 'undefined' && window.location && window.location.hostname && window.location.hostname !== '') 
    ? window.location.hostname 
    : 'localhost';

  // Si se abre desde localhost o archivo local, usar backend local en puerto 5000; en la nube usar Render
  const resolvedBackendUrl = isLocal 
    ? (`http://${localHost}:${LOCAL_BACKEND_PORT}`) 
    : BACKEND_PROD_URL;

  window.PANOL_CONFIG = {
    BACKEND_URL: resolvedBackendUrl,
    RENDER_URL: "https://panol-monolith-service.onrender.com",
    RAILWAY_URL: "https://panolnd-taller.up.railway.app",
    LOCAL_BACKEND_PORT: LOCAL_BACKEND_PORT,
    IS_LOCAL: isLocal
  };

  window.BACKEND_URL = resolvedBackendUrl;

  /**
   * Helper universal para llamadas API con soporte cross-origin y token de sesión
   */
  window.panolFetch = function(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : (window.BACKEND_URL + (endpoint.startsWith('/') ? '' : '/') + endpoint);
    const headers = options.headers ? { ...options.headers } : {};

    // Inyectar token guardado de localStorage para compatibilidad total cross-site (Render Static <-> Render Web)
    let token = '';
    try {
      token = localStorage.getItem('sys_auth_token') || '';
    } catch(e) {}

    if (token && !headers['x-auth-token']) {
      headers['x-auth-token'] = token;
    }
    if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    return fetch(url, {
      ...options,
      headers,
      credentials: 'include' // Enviar cookies de sesión SameSite=None
    });
  };

  console.log(`🌐 [Pañol Config] Backend conectado a: ${window.BACKEND_URL} (${isLocal ? `🟢 LOCALHOST :${LOCAL_BACKEND_PORT}` : '🚀 RENDER CLOUD'})`);
})();
