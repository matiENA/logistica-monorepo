import React, { useMemo } from 'react';
import { useDailyDrivers, getDriverDayStatus, calculateDriverReturn } from '../hooks/useDailyDrivers';
import { useDailyKm } from '../hooks/useDailyKm';
import { DailyDriverCard } from './DailyDriverCard';
import { Users, AlertCircle, Loader2 } from 'lucide-react';

/**
 * Helper para formatear encabezados de grupos de retorno (Fecha Wipe: H1 Helvetica Bold #F59E0B)
 */
function getReturnGroupInfo(driver, fechaRef) {
  let date = driver.retorno_info?.fecha_retorno;
  let diffDays = driver.retorno_info?.dias_para_retorno;
  let returnsToday = driver.retorno_info?.retorna_cuando === 'HOY' || diffDays === 0;

  if (!date) {
    const ret = calculateDriverReturn(driver, fechaRef);
    if (ret) {
      date = ret.date;
      diffDays = ret.diffDays;
      returnsToday = ret.returnsToday;
    }
  }

  if (!date) return { key: 'SIN_FECHA', label: 'SIN FECHA DE RETORNO', date: '', diffDays: 999 };

  const parts = date.split('-');
  const ddMm = parts.length === 3 ? `${parseInt(parts[2], 10)}/${parseInt(parts[1], 10)}` : date;

  let label = '';
  if (returnsToday || diffDays === 0) {
    label = `VUELVE HOY ${ddMm}`;
  } else if (diffDays === 1) {
    label = `VUELVE MAÑANA ${ddMm}`;
  } else {
    label = `VUELVE EL ${ddMm}`;
  }

  return { key: date, label, date, diffDays };
}

export const DailyDriversFeed = ({ fechaContexto, filters, onSelectDriver }) => {
  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDailyDrivers(filters, fechaContexto);

  // Consulta de kilómetros y hojas de ruta para la fecha contexto
  const { data: kmMap } = useDailyKm(fechaContexto);

  // Aplanar páginas de conductores
  const allDrivers = useMemo(() => {
    return data?.pages?.flatMap((page) => page.drivers) || [];
  }, [data]);

  // Filtro secundario en cliente por Estado del Día y Personal que Retorna
  const filteredDrivers = useMemo(() => {
    let list = allDrivers;

    if (filters.estado && filters.estado !== 'TODOS') {
      list = list.filter((driver) => {
        const st = getDriverDayStatus(driver, fechaContexto);
        if (filters.estado === 'ACT' || filters.estado === 'ACTIVOS') return st.type === 'OPERATIVO';
        if (filters.estado === 'FRANCOS') return st.type === 'FRANCO';
        if (filters.estado === 'VACACIONES') return st.type === 'VACACIONES';
        if (filters.estado === 'LICENCIAS') return st.type === 'LICENCIA';

        // Coincidencia exacta o por prefijo con el código de novedad seleccionado (F, FSF, V, VSF, E, ART, IND, S, A)
        const base = (st.base || '').trim().toUpperCase();
        const raw = (st.raw || '').trim().toUpperCase();
        const target = filters.estado.trim().toUpperCase();
        return base === target || raw === target || base.startsWith(target);
      });
    }

    if (filters.retornan) {
      list = list.filter((driver) => {
        if (driver.retorno_info) return true;
        const ret = calculateDriverReturn(driver, fechaContexto);
        return Boolean(ret);
      });

      // Orden cronológico de retorno en lugar de orden alfabético
      list = [...list].sort((a, b) => {
        const dateA = a.retorno_info?.fecha_retorno || '';
        const dateB = b.retorno_info?.fecha_retorno || '';
        if (dateA && dateB && dateA !== dateB) return dateA.localeCompare(dateB);
        return (a.nombre || '').localeCompare(b.nombre || '');
      });
    }

    return list;
  }, [allDrivers, filters.estado, filters.retornan, fechaContexto]);

  // Agrupamiento cronológico de retorno para Fecha Wipe
  const groupedReturnDrivers = useMemo(() => {
    if (!filters.retornan) return null;

    const groupsMap = new Map();

    filteredDrivers.forEach((driver) => {
      const info = getReturnGroupInfo(driver, fechaContexto);
      if (!groupsMap.has(info.key)) {
        groupsMap.set(info.key, {
          key: info.key,
          label: info.label,
          diffDays: info.diffDays,
          drivers: [],
        });
      }
      groupsMap.get(info.key).drivers.push(driver);
    });

    return Array.from(groupsMap.values()).sort((a, b) => {
      if (a.diffDays !== b.diffDays) return a.diffDays - b.diffDays;
      return a.key.localeCompare(b.key);
    });
  }, [filteredDrivers, filters.retornan, fechaContexto]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem 0' }}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="daily-driver-skeleton">
            <div className="skeleton-avatar" />
            <div className="skeleton-content">
              <div className="skeleton-bar" style={{ width: '40%' }} />
              <div className="skeleton-bar" style={{ width: '70%', height: '14px' }} />
            </div>
            <div className="skeleton-badge" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="daily-empty-box error">
        <AlertCircle size={36} color="#dc2626" />
        <h3 style={{ fontWeight: 800, marginTop: '0.5rem' }}>Error al consultar la grilla diaria</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{error?.message || 'Error de conexión'}</p>
      </div>
    );
  }

  if (filteredDrivers.length === 0) {
    return (
      <div className="daily-empty-box">
        <Users size={36} style={{ color: 'var(--text-muted)' }} />
        <h3 style={{ fontWeight: 800, marginTop: '0.5rem' }}>
          {filters.retornan ? 'No se encontraron choferes con retorno' : 'No se encontraron conductores'}
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {filters.retornan
            ? `No hay conductores con retorno programado para la fecha ${fechaContexto}.`
            : `Prueba cambiando la fecha contexto (${fechaContexto}) o ajustando los filtros de búsqueda.`}
        </p>
      </div>
    );
  }

  // Renderizado especial cuando el botón "Personal que Retorna" está activo (Fecha Wipe)
  if (filters.retornan && groupedReturnDrivers) {
    return (
      <div className="daily-retorno-feed">
        {groupedReturnDrivers.map((group, groupIndex) => (
          <section
            key={group.key}
            className="retorno-group-section"
            style={{ marginTop: groupIndex === 0 ? 0 : '35px' }}
          >
            <h1 className="retorno-group-title">
              {group.label}
            </h1>
            <div className="retorno-group-cards">
              {group.drivers.map((driver) => (
                <DailyDriverCard
                  key={driver.chofer_id}
                  driver={driver}
                  fechaContexto={fechaContexto}
                  kmInfo={kmMap?.[driver.chofer_id]}
                  onSelectDriver={onSelectDriver}
                  isRetornoMode={true}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {filteredDrivers.map((driver) => (
        <DailyDriverCard
          key={driver.chofer_id}
          driver={driver}
          fechaContexto={fechaContexto}
          kmInfo={kmMap?.[driver.chofer_id]}
          onSelectDriver={onSelectDriver}
          isRetornoMode={false}
        />
      ))}

      {/* Botón o trigger de Carga Paginada (oculto en modo retorno para renderizar todos de una vez) */}
      {hasNextPage && !filters.retornan && (
        <div style={{ padding: '1.5rem', textAlign: 'center' }}>
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="btn-load-more-drivers"
          >
            {isFetchingNextPage ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Cargando más conductores...</span>
              </>
            ) : (
              <span>Cargar más conductores</span>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
