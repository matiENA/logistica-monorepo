import { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { Novedad, FlotaItem, Usuario, RetornoItem, TerminalItem, TipoNovedadItem } from '../types/dash';
import { api } from '../services/api';
import { useDashStore } from '../store/useDashStore';

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

const SOCKET_URL = resolveBackendUrl(
  (import.meta as any).env?.VITE_SOCKET_URL || (import.meta as any).env?.VITE_API_URL
);

export function useDash() {
  const { setTerminales, setServicios, setTiposNovedad } = useDashStore();
  const [novedades, setNovedades] = useState<Novedad[]>([]);
  const [flota, setFlota] = useState<FlotaItem[]>([]);
  const [vencimientos, setVencimientos] = useState<any[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [retornos, setRetornos] = useState<RetornoItem[]>([]);
  const [terminales, setTerminalesLocales] = useState<TerminalItem[]>([]);
  const [tiposNovedad, setTiposNovedadLocales] = useState<TipoNovedadItem[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargarDatos = useCallback(async () => {
    try {
      setCargando(true);
      const [novs, flotaRes, usrs, rets, terms, servs, tipos] = await Promise.all([
        api.fetchNovedades().catch(() => []),
        api.fetchFlota().catch(() => ({ flota: [], vencimientosObj: [] })),
        api.fetchUsuarios().catch(() => []),
        api.fetchRetornos().catch(() => []),
        api.fetchTerminales().catch(() => []),
        api.fetchServicios().catch(() => []),
        api.fetchTiposNovedad().catch(() => [])
      ]);
      setNovedades(novs);
      setFlota(flotaRes.flota);
      setVencimientos(flotaRes.vencimientosObj);
      setUsuarios(usrs);
      setRetornos(rets);
      setTerminalesLocales(terms);
      setTerminales(terms);
      setServicios(servs);
      setTiposNovedadLocales(tipos);
      setTiposNovedad(tipos);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Error cargando datos');
    } finally {
      setCargando(false);
    }
  }, [setTerminales, setServicios, setTiposNovedad]);

  useEffect(() => {
    cargarDatos();

    // 🎯 Socket.IO para tiempo real reactivo (Patrón: Listen on Table/Event -> Fetch from View, SIN POLLING)
    const socket: Socket = io(`${SOCKET_URL}/dash`, {
      transports: ['websocket', 'polling']
    });

    // ⚡ Cola de actualización con Debounce (300ms) para amortiguar ráfagas de cambios concurrentes
    const pendingIds = new Set<string | number>();
    let debounceTimer: any = null;

    const procesarLoteDeCambios = async () => {
      if (pendingIds.size === 0) return;
      const idsAProcesar = Array.from(pendingIds);
      pendingIds.clear();

      try {
        const filasActualizadas = await api.fetchNovedadesPorIds(idsAProcesar);
        if (filasActualizadas && filasActualizadas.length > 0) {
          const mapaNuevas = new Map(filasActualizadas.map(f => [String(f.id), f]));
          setNovedades(prev => {
            const actualizadas = prev.map(n => mapaNuevas.get(String(n.id)) || n);
            const idsExistentes = new Set(prev.map(n => String(n.id)));
            const completamenteNuevas = filasActualizadas.filter(f => !idsExistentes.has(String(f.id)));
            return completamenteNuevas.length > 0 ? [...completamenteNuevas, ...actualizadas] : actualizadas;
          });
        }
      } catch (e) {
        console.warn('⚠️ [useDash] Error sincronizando filas modificadas desde view_cards_diarias:', e);
      }
    };

    const agendarActualizacionFila = (id: string | number) => {
      pendingIds.add(id);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(procesarLoteDeCambios, 300);
    };

    socket.on('connect', () => {
      console.log('⚡ [Socket] Conectado reactivamente a /dash (Tiempo Real activo sin Polling)');
    });

    // Evento granular por ID (Listen on Table -> Fetch from View)
    socket.on('novedad_cambiada', (payload: { id: string | number }) => {
      if (payload?.id) {
        agendarActualizacionFila(payload.id);
      }
    });

    // Evento de lote completo
    socket.on('novedades_actualizadas', (nuevasNovedades: Novedad[]) => {
      if (Array.isArray(nuevasNovedades)) {
        console.log('🔔 [Socket] Novedades actualizadas en vivo:', nuevasNovedades.length);
        setNovedades(nuevasNovedades);
      }
    });

    // Evento de dirty-check global (con throttle para proteger la red)
    let lastRefresh = 0;
    socket.on('datos_actualizados', (_payload: any) => {
      const now = Date.now();
      if (now - lastRefresh > 5000) {
        lastRefresh = now;
        console.log('⚡ [Socket] Cambios detectados en datos de flota/novedades. Refrescando vistas...');
        cargarDatos();
      }
    });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      socket.disconnect();
    };
  }, [cargarDatos]);

  // Mutación: Resolver novedad con animación y posible asignación de nuevo servicio
  const resolverNovedad = async (id: number | string, nuevoServicio?: string) => {
    const idStr = String(id);
    const ahoraIso = new Date().toISOString();

    // Optimista
    setNovedades(prev =>
      prev.map(n =>
        String(n.id) === idStr
          ? {
              ...n,
              resuelto: true,
              fecha_resolucion: ahoraIso,
              ...(nuevoServicio ? { servicio: nuevoServicio } : {})
            }
          : n
      )
    );

    try {
      await api.despacharNovedad({
        action: 'resolver',
        id_novedad: idStr,
        payload: {
          resuelto: true,
          fecha_resolucion: ahoraIso,
          ...(nuevoServicio ? { servicio: nuevoServicio } : {})
        }
      });
    } catch (e: any) {
      console.error('Error resolviendo novedad:', e);
      cargarDatos(); // Revertir en falla
    }
  };

  // Mutación: Asignar Terminal (Exclusivo para LIBRES)
  const asignarTerminal = async (id: number | string, terminal: string, terminal_id?: string | null) => {
    const idStr = String(id);
    setNovedades(prev => prev.map(n => String(n.id) === idStr ? { ...n, terminal, terminal_id: terminal_id || null } : n));
    try {
      await api.asignarTerminal(idStr, terminal, terminal_id || null);
    } catch (e) {
      console.error('Error cambiando terminal:', e);
      cargarDatos();
    }
  };

  // Mutación: Asignar Servicio
  const asignarServicio = async (id: number | string, servicio: string) => {
    const idStr = String(id);
    setNovedades(prev => prev.map(n => String(n.id) === idStr ? { ...n, servicio, srv: servicio } : n));
    try {
      await api.despacharNovedad({
        action: 'editar',
        id_novedad: idStr,
        payload: { servicio, srv: servicio }
      });
    } catch (e) {
      console.error('Error cambiando servicio:', e);
      cargarDatos();
    }
  };

  // Mutación: Gestionar Mención
  const gestionarMencion = async (id: number | string, usuario: string, accion: 'agregar' | 'quitar') => {
    const idStr = String(id);
    setNovedades(prev =>
      prev.map(n => {
        if (String(n.id) !== idStr) return n;
        const mencionesActuales = Array.isArray(n.menciones) ? n.menciones : [];
        if (accion === 'agregar') {
          if (mencionesActuales.includes(usuario)) return n;
          return { ...n, menciones: [...mencionesActuales, usuario] };
        } else {
          return { ...n, menciones: mencionesActuales.filter(m => m !== usuario) };
        }
      })
    );

    try {
      await api.gestionarMencion(idStr, usuario, accion);
    } catch (e) {
      console.error('Error gestionando mención:', e);
      cargarDatos();
    }
  };

  return {
    novedades,
    flota,
    vencimientos,
    usuarios,
    retornos,
    terminales,
    tiposNovedad,
    cargando,
    error,
    recargar: cargarDatos,
    resolverNovedad,
    asignarTerminal,
    asignarServicio,
    gestionarMencion
  };
}
