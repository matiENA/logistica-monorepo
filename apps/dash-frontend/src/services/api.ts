import { Novedad, FlotaItem, Usuario, RetornoItem, SesionUsuario, TerminalItem, ServicioChoferItem, TipoNovedadItem } from '../types/dash';

const isLocal = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const API_BASE = (import.meta as any).env?.VITE_API_URL || 
  (isLocal ? 'http://localhost:3005' : 'https://diaria-operativas.onrender.com');

export const api = {
  async fetchNovedades(): Promise<Novedad[]> {
    const res = await fetch(`${API_BASE}/api/dash/novedades`);
    if (!res.ok) {
      // Fallback
      const fallbackRes = await fetch(`${API_BASE}/api/novedades`);
      if (!fallbackRes.ok) throw new Error('Error al cargar novedades');
      const json = await fallbackRes.json();
      return json.data || [];
    }
    const json = await res.json();
    return json.data || [];
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
      return json.data || [];
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
    return json.data || [];
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
