import { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { Novedad, FlotaItem, Usuario, RetornoItem, TerminalItem, TipoNovedadItem } from '../types/dash';
import { api } from '../services/api';
import { useDashStore } from '../store/useDashStore';

const isLocal = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const SOCKET_URL = (import.meta as any).env?.VITE_SOCKET_URL ||
  (import.meta as any).env?.VITE_API_URL ||
  (isLocal ? 'http://localhost:3005' : 'https://diaria-operativas.onrender.com');

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

    // Socket.IO para tiempo real
    const socket: Socket = io(`${SOCKET_URL}/dash`, {
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      console.log('⚡ [Socket] Conectado a /dash');
    });

    socket.on('novedades_actualizadas', (nuevasNovedades: Novedad[]) => {
      console.log('🔔 [Socket] Novedades actualizadas en vivo:', nuevasNovedades.length);
      setNovedades(nuevasNovedades);
    });

    socket.on('datos_actualizados', (_payload: any) => {
      console.log('⚡ [Socket] Hot RAM dirty-check detectó cambios globales. Refrescando datos...');
      cargarDatos();
    });

    return () => {
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
