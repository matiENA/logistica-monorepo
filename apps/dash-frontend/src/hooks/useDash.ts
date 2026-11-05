import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { toast } from 'sonner';
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

  // Evita desmontar el tablero con pantalla negra durante refrescos silenciosos o reconexiones
  const cargaInicialCompletadaRef = useRef(false);

  const sincronizarNovedad = useCallback((novServidor?: Novedad | null) => {
    if (!novServidor || novServidor.id === undefined || novServidor.id === null) return;
    const idBuscado = String(novServidor.id);
    setNovedades((prev) => {
      const existe = prev.some((n) => String(n.id) === idBuscado);
      if (existe) {
        return prev.map((n) => (String(n.id) === idBuscado ? novServidor : n));
      }
      return [novServidor, ...prev];
    });
  }, []);

  const cargarDatos = useCallback(async (silencioso = false) => {
    const esCargaInicial = !cargaInicialCompletadaRef.current && !silencioso;
    try {
      if (esCargaInicial) {
        setCargando(true);
      }

      const [novsRes, flotaRes, usrsRes, retsRes, termsRes, servsRes, tiposRes] = await Promise.allSettled([
        api.fetchNovedades(),
        api.fetchFlota(),
        api.fetchUsuarios(),
        api.fetchRetornos(),
        api.fetchTerminales(),
        api.fetchServicios(),
        api.fetchTiposNovedad()
      ]);

      if (esCargaInicial && novsRes.status === 'rejected' && flotaRes.status === 'rejected') {
        throw new Error(novsRes.reason?.message || 'No se pudo conectar con el servidor');
      }

      if (novsRes.status === 'fulfilled') {
        setNovedades(novsRes.value);
      }
      if (flotaRes.status === 'fulfilled') {
        setFlota(flotaRes.value.flota);
        setVencimientos(flotaRes.value.vencimientosObj);
      }
      if (usrsRes.status === 'fulfilled') {
        setUsuarios(usrsRes.value);
      }
      if (retsRes.status === 'fulfilled') {
        setRetornos(retsRes.value);
      }
      if (termsRes.status === 'fulfilled' && termsRes.value.length > 0) {
        setTerminalesLocales(termsRes.value);
        setTerminales(termsRes.value);
      }
      if (servsRes.status === 'fulfilled' && servsRes.value.length > 0) {
        setServicios(servsRes.value);
      }
      if (tiposRes.status === 'fulfilled' && tiposRes.value.length > 0) {
        setTiposNovedadLocales(tiposRes.value);
        setTiposNovedad(tiposRes.value);
      }

      cargaInicialCompletadaRef.current = true;
      setError(null);
    } catch (err: any) {
      if (esCargaInicial) {
        setError(err.message || 'Error cargando datos');
      } else {
        console.warn('⚠️ [useDash] Error en refresco silencioso:', err?.message || err);
      }
    } finally {
      if (esCargaInicial) {
        setCargando(false);
      }
    }
  }, [setTerminales, setServicios, setTiposNovedad]);

  useEffect(() => {
    cargarDatos(false);

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
      console.log('⚡ [Socket] Conectado reactivamente a /dash (Tiempo Real PostgreSQL activo)');
    });

    // Evento granular por ID en PostgreSQL (Listen on Table -> Fetch from View)
    socket.on('novedad_cambiada', (payload: { id: string | number }) => {
      if (payload?.id !== undefined && payload?.id !== null) {
        agendarActualizacionFila(payload.id);
      }
    });

    // Evento de dirty-check global de flota/retornos (refresco 100% silencioso con throttle de 15s)
    let lastRefresh = 0;
    socket.on('datos_actualizados', (_payload: any) => {
      const now = Date.now();
      if (now - lastRefresh > 15000) {
        lastRefresh = now;
        cargarDatos(true);
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
      const res = await api.despacharNovedad({
        action: 'resolver',
        id_novedad: idStr,
        payload: {
          resuelto: true,
          fecha_resolucion: ahoraIso,
          ...(nuevoServicio ? { servicio: nuevoServicio } : {})
        }
      });
      if (res?.data) {
        sincronizarNovedad(res.data);
      }
    } catch (e: any) {
      console.error('Error resolviendo novedad:', e);
      await cargarDatos(true); // Revertir silenciosamente sin desmontar el tablero
      throw e;
    }
  };

  // Mutación: Asignar Terminal (Exclusivo para LIBRES)
  const asignarTerminal = async (id: number | string, terminal: string, terminal_id?: string | null) => {
    const idStr = String(id);
    setNovedades(prev => prev.map(n => String(n.id) === idStr ? { ...n, terminal, terminal_id: terminal_id || null } : n));
    try {
      const res = await api.asignarTerminal(idStr, terminal, terminal_id || null);
      if (res?.data) {
        sincronizarNovedad(res.data);
      }
    } catch (e: any) {
      console.error('Error cambiando terminal:', e);
      toast.error(`Error al cambiar terminal: ${e?.message || 'Error de red'}`);
      cargarDatos(true);
    }
  };

  // Mutación: Asignar Servicio
  const asignarServicio = async (id: number | string, servicio: string) => {
    const idStr = String(id);
    setNovedades(prev => prev.map(n => String(n.id) === idStr ? { ...n, servicio, srv: servicio } : n));
    try {
      const res = await api.despacharNovedad({
        action: 'editar',
        id_novedad: idStr,
        payload: { servicio, srv: servicio }
      });
      if (res?.data) {
        sincronizarNovedad(res.data);
      }
    } catch (e: any) {
      console.error('Error cambiando servicio:', e);
      toast.error(`Error al cambiar servicio: ${e?.message || 'Error de red'}`);
      cargarDatos(true);
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
      const res = await api.gestionarMencion(idStr, usuario, accion);
      if (res?.data) {
        sincronizarNovedad(res.data);
      }
    } catch (e: any) {
      console.error('Error gestionando mención:', e);
      toast.error(`Error al actualizar mención: ${e?.message || 'Error de red'}`);
      cargarDatos(true);
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
    sincronizarNovedad,
    resolverNovedad,
    asignarTerminal,
    asignarServicio,
    gestionarMencion
  };
}
