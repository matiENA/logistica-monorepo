import { supabase } from './supabaseClient';

const IS_RENDER_HOST =
  typeof window !== 'undefined' &&
  window.location &&
  window.location.hostname.endsWith('.onrender.com');

const BASE_API_URL = (
  import.meta.env.VITE_API_URL ||
  (IS_RENDER_HOST ? 'https://eor-backend.onrender.com' : '')
).replace(/\/+$/, '');

/**
 * Cliente de transporte HTTP unificado.
 * Prioriza los endpoints optimizados de Node.js (/api/views/* y /api/diagramas/*)
 * con compresión Gzip nativa y Connection Pooling, con fallback transparente
 * a Supabase client si el backend local no está disponible.
 */
class ApiClient {
  constructor() {
    this.backendWarm = false;
  }

  async fetchJson(endpoint, options = {}) {
    const url = `${BASE_API_URL}${endpoint}`;
    const defaultTimeout = this.backendWarm ? 8000 : (IS_RENDER_HOST ? 24000 : 8000);
    const timeoutMs = options.timeoutMs || defaultTimeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        cache: options.cache || 'no-cache',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          ...options.headers,
        },
        signal: options.signal || controller.signal,
        ...options,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Unexpected content-type: ${contentType || 'none'}`);
      }

      const json = await res.json();
      this.backendWarm = true;
      return json;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  // 1. Vista Diaria Operativa (con paginación y filtros)
  async getDiaria({ limit = 16, offset = 0, servicio, alerta, search } = {}) {
    try {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      if (servicio && servicio !== 'TODOS') params.set('servicio', servicio);
      if (alerta && alerta !== 'TODAS') params.set('alerta', alerta);
      if (search && search.trim()) params.set('search', search.trim());

      const res = await this.fetchJson(`/api/views/diaria?${params.toString()}`);
      if (res && res.success) {
        return {
          drivers: res.datos || [],
          totalCount: res.paginacion?.total || 0,
          hayMas: res.paginacion?.hay_mas ?? false,
        };
      }
    } catch (err) {
      console.warn('⚠️ [ApiClient] Fallback a Supabase para view_diaria_operativa:', err.message);
    }

    // Fallback Supabase
    let query = supabase.from('view_diaria_operativa').select('*', { count: 'exact' });
    if (servicio && servicio !== 'TODOS') query = query.eq('servicio', servicio);
    if (alerta === 'DOCS_VENCIDOS') query = query.eq('alerta_docs_chofer', 'VENCIDO');
    else if (alerta === 'DOCS_POR_VENCER') query = query.eq('alerta_docs_chofer', 'POR_VENCER');
    else if (alerta === 'UNIDAD_VENCIDA') query = query.eq('alerta_docs_unidad', 'VENCIDO');
    else if (alerta === 'UNIDAD_POR_VENCER') query = query.eq('alerta_docs_unidad', 'POR_VENCER');
    else if (alerta === 'CUALQUIER_ALERTA') {
      query = query.or('alerta_docs_chofer.eq.VENCIDO,alerta_docs_unidad.eq.VENCIDO,alerta_docs_chofer.eq.POR_VENCER,alerta_docs_unidad.eq.POR_VENCER');
    }
    if (search && search.trim()) {
      const t = search.trim();
      query = query.or(`nombre.ilike.%${t}%,dni.ilike.%${t}%,tractor.ilike.%${t}%,semi.ilike.%${t}%,n_ute.ilike.%${t}%`);
    }

    const from = offset;
    const to = offset + limit - 1;
    const { data, count, error } = await query.order('nombre', { ascending: true }).range(from, to);
    if (error) throw error;

    return {
      drivers: data || [],
      totalCount: count || 0,
      hayMas: (data && data.length === limit),
    };
  }

  // 1.5. Kilómetros diarios para Vista Diaria (Hot RAM O(1) < 1ms con fallback RPC fn_km_por_fecha)
  async getDiariaKm(fecha) {
    const fIso = (fecha || new Date().toISOString().split('T')[0]).split('T')[0];
    try {
      const res = await this.fetchJson(`/api/views/diaria-km?fecha=${encodeURIComponent(fIso)}`);
      if (res && res.success && Array.isArray(res.data)) {
        return res.data;
      }
    } catch (err) {
      console.warn('⚠️ [ApiClient] Fallback a RPC fn_km_por_fecha en Supabase:', err.message);
    }

    // Fallback Supabase O(1) indexado por (anio, mes_numero)
    const { data, error } = await supabase.rpc('fn_km_por_fecha', { p_fecha: fIso });

    if (error) {
      console.warn('⚠️ [ApiClient] Error ejecutando fn_km_por_fecha en Supabase:', error.message);
      return [];
    }
    return data || [];
  }

  // 2. Personal que Retorna
  async getPersonalRetorno(fechaTarget) {
    try {
      const res = await this.fetchJson(`/api/views/retorno?fecha=${encodeURIComponent(fechaTarget)}`);
      if (res && res.success) {
        return res.datos || [];
      }
    } catch (err) {
      console.warn('⚠️ [ApiClient] Fallback a RPC Supabase para fn_personal_retorno:', err.message);
    }

    const { data, error } = await supabase.rpc('fn_personal_retorno', { p_fecha: fechaTarget });
    if (error) throw error;
    return data || [];
  }

  // 3. Catálogo de Flota Operativa y Vencimientos
  async getFlota(search = '') {
    try {
      const param = search ? `?search=${encodeURIComponent(search.trim())}` : '';
      const res = await this.fetchJson(`/api/views/flota${param}`);
      if (res && res.success) {
        return res.datos || [];
      }
    } catch (err) {
      console.warn('⚠️ [ApiClient] Fallback a Supabase para view_flota_operativa:', err.message);
    }

    let query = supabase.from('view_flota_operativa').select('*');
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  // 4. Catálogo Ligero de Choferes (para selector lateral)
  async getCatalogoChoferesLite() {
    try {
      const res = await this.fetchJson('/api/views/catalogo-choferes');
      if (res && res.success) {
        return res.datos || [];
      }
    } catch (err) {
      console.warn('⚠️ [ApiClient] Fallback a Supabase para catalogo-choferes:', err.message);
    }

    const { data, error } = await supabase
      .from('view_individual_chofer')
      .select('chofer_id, nombre, dni, servicio, foto, telefono, estado_chofer')
      .order('nombre');

    if (error) throw error;
    return (data || []).map((c) => ({
      ...c,
      id: c.chofer_id,
      c_servicio: c.servicio,
      estado: c.estado_chofer,
    }));
  }

  // 5. Ficha Individual de Chofer (unificada con Unidad + Vencimientos + Avalados)
  async getIndividualChofer(choferId) {
    if (!choferId) return null;
    try {
      const res = await this.fetchJson(`/api/views/individual/${encodeURIComponent(choferId)}`);
      if (res && res.success && res.dato) {
        return res.dato;
      }
    } catch (err) {
      console.warn('⚠️ [ApiClient] Fallback a Supabase para view_individual_chofer:', err.message);
    }

    const { data, error } = await supabase
      .from('view_individual_chofer')
      .select('*')
      .eq('chofer_id', choferId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  // 6. Calendario Diagrama + KMs
  async getCalendarioDiagramaKm(choferId, zoom = 3, targetTabs = [], anio = null, fresh = false) {
    if (!choferId) return [];
    try {
      const tabsParam = targetTabs.length ? `&tabs=${encodeURIComponent(targetTabs.join(','))}` : '';
      const anioParam = anio ? `&anio=${encodeURIComponent(anio)}` : '';
      const freshParam = fresh ? '&fresh=1' : '';
      const res = await this.fetchJson(`/api/views/calendario/${encodeURIComponent(choferId)}?zoom=${zoom}${tabsParam}${anioParam}${freshParam}`);
      if (res && res.success) {
        return res.datos || [];
      }
    } catch (err) {
      console.warn('⚠️ [ApiClient] Fallback a Supabase para view_calendario_diagrama_km:', err.message);
    }

    let query = supabase
      .from('view_calendario_diagrama_km')
      .select('diagrama_id, chofer_id, mes_tab, anio, mes_numero, tira_dias, contabilizador, km_mes_total, cant_viajes_mes, dias_km, icm, isp, cant_infracciones, tiempo_conduccion_horas')
      .eq('chofer_id', choferId);

    if (targetTabs.length > 0) {
      query = query.in('mes_tab', targetTabs);
    } else if (anio) {
      query = query.eq('anio', parseInt(anio, 10));
    }

    const { data, error } = await query.order('anio', { ascending: true }).order('mes_numero', { ascending: true });
    if (error) throw error;
    return (data || []).map(r => ({
      ...r,
      icm: r.icm !== null && r.icm !== undefined ? Number(r.icm) : null,
      isp: r.isp !== null && r.isp !== undefined ? Number(r.isp) : null,
      cant_infracciones: r.cant_infracciones ? Number(r.cant_infracciones) : 0,
      tiempo_conduccion_horas: r.tiempo_conduccion_horas ? Number(r.tiempo_conduccion_horas) : 0
    }));
  }

  async invalidateCalendario(choferId = null) {
    try {
      return await this.fetchJson('/api/views/invalidate-calendario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choferId })
      });
    } catch (err) {
      console.warn('⚠️ [ApiClient] Error invalidando calendario en backend:', err.message);
      return null;
    }
  }

  async refreshSeguridadVial() {
    try {
      return await this.fetchJson('/api/views/refresh-seguridad-vial', {
        method: 'POST'
      });
    } catch (err) {
      console.warn('⚠️ [ApiClient] Error refrescando seguridad vial:', err.message);
      return null;
    }
  }

  // 7. Cards Diarias / Novedades
  async getCards({ limit = 12, offset = 0, estado, servicio, tipo, search } = {}) {
    try {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      if (estado) params.set('estado', estado);
      if (servicio && servicio !== 'TODOS') params.set('servicio', servicio);
      if (tipo && tipo !== 'TODOS') params.set('tipo', tipo);
      if (search && search.trim()) params.set('search', search.trim());

      const res = await this.fetchJson(`/api/views/cards?${params.toString()}`);
      if (res && res.success) {
        return {
          cards: res.datos || [],
          totalCount: res.paginacion?.total || 0,
          hayMas: res.paginacion?.hay_mas ?? false,
        };
      }
    } catch (err) {
      console.warn('⚠️ [ApiClient] Fallback a Supabase para view_cards_diarias:', err.message);
    }

    let query = supabase.from('view_cards_diarias').select('*', { count: 'exact' });
    if (estado === 'pendientes') query = query.eq('resuelto', false);
    else if (estado === 'resueltas') query = query.eq('resuelto', true);
    if (servicio && servicio !== 'TODOS') query = query.eq('servicio', servicio);
    if (tipo && tipo !== 'TODOS') query = query.eq('tipo', tipo);
    if (search && search.trim()) {
      const term = search.trim();
      query = query.or(`chofer_nombre.ilike.%${term}%,tractor.ilike.%${term}%,n_ute.ilike.%${term}%`);
    }

    const from = offset;
    const to = offset + limit - 1;
    const { data, error, count } = await query
      .order('fecha', { ascending: false, nullsFirst: false })
      .order('creado_el', { ascending: false })
      .range(from, to);

    if (error) throw error;
    return {
      cards: data || [],
      totalCount: count || 0,
      hayMas: (data && data.length === limit),
    };
  }

  // 8. Grilla Operativa Mensual de Diagrama
  async getDiagramaMensual(mesTab = 'Sep-26', servicio = 'TODOS', search = '') {
    try {
      const params = new URLSearchParams();
      params.set('mesTab', mesTab);
      if (servicio && servicio !== 'TODOS') params.set('servicio', servicio);
      if (search && search.trim()) params.set('search', search.trim());

      const res = await this.fetchJson(`/api/views/diagrama?${params.toString()}`);
      if (res && res.success) {
        return res.datos || [];
      }
    } catch (err) {
      console.warn('⚠️ [ApiClient] Fallback a Supabase para view_diagrama_mensual:', err.message);
    }

    let query = supabase.from('view_diagrama_mensual').select('*').eq('mes_tab', mesTab);
    if (servicio && servicio !== 'TODOS') query = query.eq('servicio', servicio);
    const { data, error } = await query.order('chofer_nombre');
    if (error) throw error;
    return data || [];
  }

  // 9. Movimientos Activos (Unidad + Chofer Actual)
  async getMovimientos({ limit = 100, offset = 0, servicio = 'TODOS', estado = 'TODOS', search = '' } = {}) {
    try {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      if (servicio && servicio !== 'TODOS') params.set('servicio', servicio);
      if (estado && estado !== 'TODOS') params.set('estado', estado);
      if (search && search.trim()) params.set('search', search.trim());

      const res = await this.fetchJson(`/api/views/movimientos?${params.toString()}`);
      if (res && res.success) {
        return {
          datos: res.datos || [],
          total: res.paginacion?.total || 0,
          hayMas: res.paginacion?.hay_mas ?? false,
        };
      }
    } catch (err) {
      console.warn('⚠️ [ApiClient] Fallback a Supabase para view_movimientos:', err.message);
    }

    // Fallback Supabase
    let query = supabase.from('view_movimientos').select('*', { count: 'exact' });
    if (servicio && servicio !== 'TODOS') {
      query = query.or(`servicio_unidad.eq.${servicio},chofer_servicio.eq.${servicio}`);
    }
    if (estado && estado !== 'TODOS') {
      query = query.or(`unidad_estado.eq.${estado},chofer_estado.eq.${estado}`);
    }
    if (search && search.trim()) {
      const t = search.trim();
      query = query.or(`chofer_nombre.ilike.%${t}%,chofer_dni.ilike.%${t}%,tractor.ilike.%${t}%,semi.ilike.%${t}%,n_ute.ilike.%${t}%`);
    }

    const from = offset;
    const to = offset + limit - 1;
    const { data, count, error } = await query
      .order('n_ute', { ascending: true, nullsFirst: false })
      .order('tractor', { ascending: true, nullsFirst: false })
      .range(from, to);

    if (error) throw error;
    return {
      datos: data || [],
      total: count || 0,
      hayMas: data && data.length === limit,
    };
  }

  // 10. Badge de Novedades Pendientes (Hot RAM TTL 30s)
  async getBadgePendientes() {
    try {
      const res = await this.fetchJson('/api/views/badge');
      if (res && res.success) {
        return { novedades_pendientes: res.novedades_pendientes || 0 };
      }
    } catch (err) {
      console.warn('⚠️ [ApiClient] Fallback a Supabase para badge novedades:', err.message);
    }

    const { count, error } = await supabase
      .from('novedades')
      .select('id', { count: 'exact', head: true })
      .eq('resuelto', false);
    if (error) return { novedades_pendientes: 0 };
    return { novedades_pendientes: count || 0 };
  }

  // 11. Documentación de Chofer (Hot RAM C1 + refresco canónico post-mutación)
  async getChoferDocs(choferId, fresh = false) {
    if (!choferId) return null;
    try {
      const qs = fresh ? '?fresh=1' : '';
      const res = await this.fetchJson(`/api/views/chofer-docs/${encodeURIComponent(choferId)}${qs}`);
      if (res && res.success) {
        return res.dato || null;
      }
    } catch (err) {
      console.warn('⚠️ [ApiClient] Fallback a Supabase para chofer_documentacion:', err.message);
    }

    const { data, error } = await supabase
      .from('chofer_documentacion')
      .select('*')
      .eq('chofer_id', choferId)
      .maybeSingle();

    if (error) {
      console.warn('⚠️ [ApiClient] Error consultando chofer_documentacion:', error.message);
      return null;
    }
    return data;
  }

  // 12. Observaciones de Chofer (LRU C2 TTL 5 min)
  async getChoferObservaciones(choferId, fresh = false) {
    if (!choferId) return [];
    try {
      const qs = fresh ? '?fresh=1' : '';
      const res = await this.fetchJson(`/api/views/chofer-observaciones/${encodeURIComponent(choferId)}${qs}`);
      if (res && res.success) {
        return res.datos || [];
      }
    } catch (err) {
      console.warn('⚠️ [ApiClient] Fallback a Supabase para chofer_observaciones:', err.message);
    }

    const { data, error } = await supabase
      .from('chofer_observaciones')
      .select('*')
      .eq('chofer_id', choferId)
      .order('fecha', { ascending: false });

    if (error) {
      console.warn('⚠️ [ApiClient] Error consultando chofer_observaciones:', error.message);
      return [];
    }
    return data || [];
  }

  // 13. Asignación Atómica de Unidad (Node Backend Hot RAM + ACID Supabase RPC fallback)
  async asignarUnidad({ choferId, unidadId, usuario = 'OPERADOR', tractor = null, semi = null, n_ute = null, choferNombre = null }) {
    try {
      const res = await this.fetchJson('/api/movimientos/asignar', {
        method: 'POST',
        body: JSON.stringify({
          choferId,
          unidadId,
          usuario,
          tractor,
          semi,
          n_ute,
          choferNombre
        })
      });
      if (res && res.success) {
        return res;
      }
    } catch (err) {
      console.warn('⚠️ [ApiClient] Fallback a RPC fn_asignar_unidad_chofer en Supabase:', err.message);
    }

    // Fallback RPC directo a Supabase
    const { data, error } = await supabase.rpc('fn_asignar_unidad_chofer', {
      p_chofer_id: choferId,
      p_unidad_id: unidadId,
      p_usuario: usuario,
    });
    if (error) throw error;
    return { success: true, message: 'Unidad asignada exitosamente', data };
  }

  // 14. Desunión Atómica de Unidad (Node Backend Hot RAM + ACID Supabase RPC fallback)
  async desunirUnidad({ choferId, usuario = 'OPERADOR' }) {
    try {
      const res = await this.fetchJson('/api/movimientos/desunir', {
        method: 'POST',
        body: JSON.stringify({
          choferId,
          usuario
        })
      });
      if (res && res.success) {
        return res;
      }
    } catch (err) {
      console.warn('⚠️ [ApiClient] Fallback a RPC fn_desunir_unidad_chofer en Supabase:', err.message);
    }

    // Fallback RPC directo a Supabase
    const { data, error } = await supabase.rpc('fn_desunir_unidad_chofer', {
      p_chofer_id: choferId,
      p_usuario: usuario,
    });
    if (error) throw error;
    return { success: true, message: 'Unidad desasignada exitosamente', data };
  }
}

export const apiClient = new ApiClient();
