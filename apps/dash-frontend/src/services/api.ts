import { Novedad, FlotaItem, Usuario, RetornoItem, SesionUsuario, TerminalItem, ServicioChoferItem, TipoNovedadItem } from '../types/dash';

const isLocal = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

function resolveBackendUrl(url?: string): string {
  if (url && typeof url === 'string') {
    const clean = url.trim().replace(/\/+$/, '');
    // Interceptar y redirigir activamente cualquier referencia al backend anterior o deprecado
    if (clean && !clean.includes('dash-backend') && !clean.includes('srv-dbfpnrl9fdbs739n5vvg')) {
      return clean;
    }
  }
  return isLocal ? 'http://localhost:3005' : 'https://diaria-operativas.onrender.com';
}

const API_BASE = resolveBackendUrl((import.meta as any).env?.VITE_API_URL);

export function normalizarNovedad(n: any): Novedad {
  if (!n) return n;
  let fechaObj = n.fecha_objetivo;
  if (fechaObj) {
    fechaObj = String(fechaObj).split('T')[0].trim();
    if (fechaObj === '' || fechaObj === 'null') fechaObj = null;
  }
  return {
    ...n,
    fecha_objetivo: fechaObj || null
  };
}

export const api = {
  async fetchNovedades(): Promise<Novedad[]> {
    // ⚡ Priorizar vista relacional directa public.view_cards_diarias con Column Pruning
    try {
      const res = await fetch(`${API_BASE}/api/views/cards?limit=150`);
      if (res.ok) {
        const json = await res.json();
        if (json.datos && Array.isArray(json.datos)) {
          return json.datos.map(normalizarNovedad);
        }
      }
    } catch (e) {
      console.warn('⚠️ [API] Fallback de cards a endpoint /api/dash/novedades:', e);
    }

    const res = await fetch(`${API_BASE}/api/dash/novedades`);
    if (!res.ok) {
      // Fallback secundario
      const fallbackRes = await fetch(`${API_BASE}/api/novedades`);
      if (!fallbackRes.ok) throw new Error('Error al cargar novedades');
      const json = await fallbackRes.json();
      return (json.data || []).map(normalizarNovedad);
    }
    const json = await res.json();
    return (json.data || []).map(normalizarNovedad);
  },

  // 🎯 Patrón "Listen on Table, Fetch from View": Obtiene solo la fila modificada (< 1ms en Postgres)
  async fetchNovedadPorId(id: number | string): Promise<Novedad | null> {
    try {
      const res = await fetch(`${API_BASE}/api/views/cards?id=${encodeURIComponent(id)}&limit=1`);
      if (res.ok) {
        const json = await res.json();
        const item = json.datos?.[0];
        return item ? normalizarNovedad(item) : null;
      }
    } catch (e) {
      console.warn('⚠️ Error al consultar fila única de novedad en vista:', e);
    }
    return null;
  },

  // 🎯 Batch fetch de IDs modificados (con debounce de 300-500ms)
  async fetchNovedadesPorIds(ids: (number | string)[]): Promise<Novedad[]> {
    if (!ids || ids.length === 0) return [];
    try {
      const idsParam = ids.map(id => encodeURIComponent(String(id))).join(',');
      const res = await fetch(`${API_BASE}/api/views/cards?ids=${idsParam}&limit=${ids.length}`);
      if (res.ok) {
        const json = await res.json();
        return (json.datos || []).map(normalizarNovedad);
      }
    } catch (e) {
      console.warn('⚠️ Error al consultar lote de novedades en vista:', e);
    }
    return [];
  },

  async fetchFlota(): Promise<{ flota: FlotaItem[]; vencimientosObj: any[] }> {
    const res = await fetch(`${API_BASE}/api/dash/flota`);
    if (!res.ok) throw new Error('Error al cargar catálogo de flota');
    const json = await res.json();
    return {
      flota: json.flota || [],
      vencimientosObj: json.vencimientosObj || []
    };
  },

  async fetchTiposNovedad(): Promise<TipoNovedadItem[]> {
    try {
      const res = await fetch(`${API_BASE}/api/dash/tipos-novedad`);
      if (!res.ok) return [];
      const json = await res.json();
      const raw = json.data || [];
      return raw.map((t: any) => ({
        id: t.id || '',
        codigo: t.codigo || '',
        titulo: t.titulo || t.denominacion || t.codigo || '',
        descripcion: t.descripcion || null,
        bg_color: t.bg_color || t.color || '#6366F1',
        text_color: t.text_color || '#FFFFFF',
        requiere_fecha_objetivo: Boolean(t.requiere_fecha_objetivo),
        imprime_nota_movimientos: Boolean(t.imprime_nota_movimientos),
        activo: t.activo !== false,
        orden: Number(t.orden) || 0
      }));
    } catch (e) {
      console.warn('No se pudo cargar tipos de novedad:', e);
      return [];
    }
  },

  async fetchTerminales(): Promise<TerminalItem[]> {
    try {
      const res = await fetch(`${API_BASE}/api/dash/terminales`);
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    } catch (e) {
      console.warn('No se pudo cargar terminales:', e);
      return [];
    }
  },

  async fetchServicios(): Promise<ServicioChoferItem[]> {
    try {
      const res = await fetch(`${API_BASE}/api/dash/servicios`);
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    } catch (e) {
      console.warn('No se pudo cargar servicios de choferes:', e);
      return [];
    }
  },

  async fetchRetornos(): Promise<RetornoItem[]> {
    try {
      const res = await fetch(`${API_BASE}/api/dash/retorno`);
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    } catch (e) {
      console.warn('No se pudo cargar retornos:', e);
      return [];
    }
  },

  async fetchUsuarios(): Promise<Usuario[]> {
    const res = await fetch(`${API_BASE}/api/dash/usuarios`);
    if (!res.ok) throw new Error('Error al cargar usuarios');
    const json = await res.json();
    const raw = json.data || [];
    return raw
      .map((item: any) => {
        if (typeof item === 'string') {
          const u = item.trim().toUpperCase();
          return { id: u, usuario: u, rol: 'operador' };
        }
        const nom = String(item?.usuario || item?.nombre || '').trim().toUpperCase();
        return {
          id: item?.id || nom || '',
          usuario: nom,
          rol: item?.rol || 'operador'
        };
      })
      .filter((u: Usuario) => u.usuario.length > 0);
  },

  async despacharNovedad(body: { action: 'nueva' | 'editar' | 'resolver'; id_novedad?: number | string; payload?: any }) {
    // Sanitizar fechas vacías preventivamente
    if (body.payload) {
      if (body.payload.fecha_objetivo === '' || body.payload.fecha_objetivo === undefined) {
        body.payload.fecha_objetivo = null;
      }
      if (body.payload.fecha_resolucion === '' || body.payload.fecha_resolucion === undefined) {
        body.payload.fecha_resolucion = null;
      }
    }

    const res = await fetch(`${API_BASE}/api/novedades/actualizar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Error HTTP ${res.status}`);
    }
    return await res.json();
  },

  async gestionarMencion(idNovedad: number | string, usuario: string, accion: 'agregar' | 'quitar') {
    const res = await fetch(`${API_BASE}/api/novedades/mencion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_novedad: Number(idNovedad), usuario, accion })
    });
    if (!res.ok) throw new Error('Error gestionando mención');
    return await res.json();
  },

  async asignarTerminal(idNovedad: number | string, terminal: string, terminal_id?: string | null) {
    const res = await fetch(`${API_BASE}/api/novedades/terminal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_novedad: Number(idNovedad), terminal, terminal_id })
    });
    if (!res.ok) throw new Error('Error asignando terminal');
    return await res.json();
  },

  async login(usuario: string, password: string): Promise<SesionUsuario> {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Credenciales inválidas');
    }
    return {
      id: data.id,
      usuario: (data.usuario || '').toUpperCase(),
      rol: data.rol || 'operador'
    };
  }
};
