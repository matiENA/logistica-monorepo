import React, { useState } from 'react';
import { CalendarMonthCard } from './CalendarMonthCard';
import { RangeActionBar } from './RangeActionBar';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { useCalendarDiagramaKm, useUpdateDiagramaRange } from '../hooks/useCalendarDiagramaKm';
import { useAuth } from '@/context/AuthContext';

export const TrimestralCalendar = ({ choferId, choferNombre }) => {
  const { user } = useAuth();
  const [zoomLevel, setZoomLevel] = useState(3); // 3 (90 días / Trimestre) | 12 (Anual)
  const [baseDate, setBaseDate] = useState(() => new Date()); // Mes actual dinámico
  const [selectedRange, setSelectedRange] = useState(null);

  const updateDiagrama = useUpdateDiagramaRange(choferId);

  // Consulta optimizada a la vista public.view_calendario_diagrama_km (Egress < 3 KB en 90d / < 11 KB en 12m)
  const { data: calData, isLoading: isLoadingCalendar } = useCalendarDiagramaKm(choferId, zoomLevel, baseDate);

  const mesesNombres = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  const mesesAbrev = [
    'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
    'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
  ];

  const monthsMap = calData?.monthsMap || {};
  const tripsMap = calData?.tripsMap || {};

  // Calcular lista de meses a renderizar
  const monthsToRender = [];
  if (zoomLevel === 3) {
    // 3 Meses: Anterior, Base, Siguiente (90 días de horizonte operativo)
    [-1, 0, 1].forEach((offset) => {
      const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + offset, 1);
      const mIdx = d.getMonth();
      const y = d.getFullYear();
      const yShort = String(y).slice(-2);
      const tabKey = `${mesesAbrev[mIdx]}-${yShort}`;
      const mesData = monthsMap[tabKey];

      monthsToRender.push({
        year: y,
        monthIndex: mIdx,
        monthName: mesesNombres[mIdx],
        tabKey,
        tiraDias: mesData?.tira_dias || '',
        kmMesTotal: mesData?.km_mes_total || 0,
        cantViajesMes: mesData?.cant_viajes_mes || 0,
        icm: mesData?.icm !== undefined ? mesData.icm : null,
        isp: mesData?.isp !== undefined ? mesData.isp : null,
        icmClasificacion: mesData?.icm_clasificacion || null,
        ispClasificacion: mesData?.isp_clasificacion || null,
        isActiveMonth: offset === 0,
      });
    });
  } else {
    // 12 Meses: Año completo (Consulta anual ampliada)
    const y = baseDate.getFullYear();
    for (let mIdx = 0; mIdx < 12; mIdx++) {
      const yShort = String(y).slice(-2);
      const tabKey = `${mesesAbrev[mIdx]}-${yShort}`;
      const mesData = monthsMap[tabKey];

      monthsToRender.push({
        year: y,
        monthIndex: mIdx,
        monthName: mesesNombres[mIdx],
        tabKey,
        tiraDias: mesData?.tira_dias || '',
        kmMesTotal: mesData?.km_mes_total || 0,
        cantViajesMes: mesData?.cant_viajes_mes || 0,
        icm: mesData?.icm !== undefined ? mesData.icm : null,
        isp: mesData?.isp !== undefined ? mesData.isp : null,
        icmClasificacion: mesData?.icm_clasificacion || null,
        ispClasificacion: mesData?.isp_clasificacion || null,
        isActiveMonth: mIdx === baseDate.getMonth(),
      });
    }
  }

  // Manejador de Selección Matricial con Shift + Clic
  const handleDayClick = (isoStr, event) => {
    if (event.shiftKey && selectedRange?.startIso) {
      // Extender selección de rango
      setSelectedRange((prev) => ({
        startIso: prev.startIso,
        endIso: isoStr,
      }));
    } else {
      // Selección de un único día
      setSelectedRange({
        startIso: isoStr,
        endIso: isoStr,
      });
    }
  };

  const handleClearSelection = () => {
    setSelectedRange(null);
  };

  // Cálculo reactivo de Kilómetros y Viajes en el Rango Seleccionado
  const rangeStats = React.useMemo(() => {
    if (!selectedRange?.startIso || !selectedRange?.endIso) {
      return { km: 0, tripsCount: 0, daysCount: 0, minIso: null, maxIso: null };
    }

    const minIso = selectedRange.startIso <= selectedRange.endIso ? selectedRange.startIso : selectedRange.endIso;
    const maxIso = selectedRange.startIso <= selectedRange.endIso ? selectedRange.endIso : selectedRange.startIso;

    const d1 = new Date(minIso + 'T12:00:00');
    const d2 = new Date(maxIso + 'T12:00:00');
    let km = 0;
    let tripsCount = 0;
    let daysCount = 0;

    for (let d = new Date(d1); d <= d2; d.setDate(d.getDate() + 1)) {
      daysCount++;
      const iso = d.toISOString().substring(0, 10);
      const trip = tripsMap[iso];
      if (trip && trip.km > 0) {
        km += trip.km;
        tripsCount++;
      }
    }

    return {
      km: Math.round(km * 100) / 100,
      tripsCount,
      daysCount,
      minIso,
      maxIso,
    };
  }, [selectedRange, tripsMap]);

  // Helper canónico para contabilizar días de diagrama
  const getBaseState = (val) => {
    if (val === undefined || val === null) return '';
    const str = String(val).trim().toUpperCase();
    if (str.includes('+')) return str.split('+')[0].trim();
    return str;
  };

  const calcularContabilizador = (diasArr) => {
    let trabajados = 0;
    let francos = 0;
    let vacaciones = 0;
    let ausencias = 0;
    let inactivos = 0;
    const desglose = {
      enfermedad: 0,
      art: 0,
      indisposicion: 0,
      suspension: 0,
      ausencia: 0,
      permiso: 0,
      otros: 0,
    };

    for (const val of diasArr) {
      if (!val || val === '-' || val === '0' || val === 'NULL' || val === 'UNDEFINED') {
        inactivos++;
        continue;
      }
      const base = getBaseState(val);
      if ((!isNaN(base) && base !== '') || base === 'O' || base === 'OPERATIVO') {
        trabajados++;
      } else if (['F', 'FSF', 'FRANCO', 'RPT'].includes(base)) {
        francos++;
      } else if (['V', 'VSF', 'VACACIONES'].includes(base)) {
        vacaciones++;
      } else if (['E', 'ART', 'IND', 'IIND', 'A', 'S', 'P', 'MED', 'SUSP', 'LIC'].some((k) => base.includes(k))) {
        ausencias++;
        if (base === 'E' || base.startsWith('MED')) desglose.enfermedad++;
        else if (base === 'ART') desglose.art++;
        else if (base.startsWith('IND')) desglose.indisposicion++;
        else if (base === 'S' || base.startsWith('SUSP')) desglose.suspension++;
        else if (base === 'A') desglose.ausencia++;
        else if (base === 'P') desglose.permiso++;
        else desglose.otros++;
      } else {
        desglose.otros++;
      }
    }

    return {
      total_evaluados: diasArr.length,
      trabajados,
      francos,
      vacaciones,
      ausencias,
      inactivos,
      desglose,
    };
  };

  // Asignar estado en lote en el rango seleccionado
  const handleAssignStatus = async (nuevoEstado) => {
    if (!selectedRange || !choferId) return;

    const { startIso, endIso } = selectedRange;
    const minIso = startIso <= endIso ? startIso : endIso;
    const maxIso = startIso <= endIso ? endIso : startIso;

    // Calcular días a modificar y actualizar cada mes correspondiente
    const dStart = new Date(minIso + 'T12:00:00');
    const dEnd = new Date(maxIso + 'T12:00:00');

    // Lógica canónica legacy para Día Activo: correlativo numérico (1..35)
    const isActivo = nuevoEstado === 'ACTIVO' || nuevoEstado === 'OPERATIVO';
    let correlativoContador = 1;

    if (isActivo) {
      const fAyer = new Date(dStart);
      fAyer.setDate(fAyer.getDate() - 1);
      const prevMIdx = fAyer.getMonth();
      const prevYShort = String(fAyer.getFullYear()).slice(-2);
      const prevTabKey = `${mesesAbrev[prevMIdx]}-${prevYShort}`;
      const prevTira = (monthsMap[prevTabKey]?.tira_dias || '').split(',');
      const valAyerRaw = prevTira[fAyer.getDate() - 1];
      const valAyerBase = getBaseState(valAyerRaw);
      const numAyer = parseInt(valAyerBase, 10);
      correlativoContador = (!isNaN(numAyer) && numAyer > 0) ? numAyer + 1 : 1;
    }

    // Agrupar modificaciones por pestaña mensual en orden cronológico
    const updatesPorMes = {};
    for (let d = new Date(dStart); d <= dEnd; d.setDate(d.getDate() + 1)) {
      const mIdx = d.getMonth();
      const yShort = String(d.getFullYear()).slice(-2);
      const tabKey = `${mesesAbrev[mIdx]}-${yShort}`;
      const dayNum = d.getDate();

      if (!updatesPorMes[tabKey]) updatesPorMes[tabKey] = [];
      const valorAsignar = isActivo ? String(correlativoContador++) : nuevoEstado;
      updatesPorMes[tabKey].push({ dia: dayNum, valor: valorAsignar });
    }

    // Limpiar selección de rango inmediatamente en UI
    setSelectedRange(null);

    // Disparar mutación con Optimistic UI (<16ms), rollback automático y enrutamiento a eor_sync_queue
    updateDiagrama.mutate({
      updatesPorMes,
      monthsMap,
      usuario: user?.usuario || 'OPERADOR',
    });
  };

  const nextMonth = () => {
    setBaseDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const prevMonth = () => {
    setBaseDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const todayIso = new Date().toISOString().substring(0, 10);

  return (
    <section className="calendar-trimestre-section">
      {/* Barra Superior con Selector de Escala y Navegación */}
      <div className="calendar-top-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 900, textTransform: 'uppercase', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.4rem', margin: 0 }}>
            <Calendar size={18} style={{ color: 'var(--primary)' }} />
            <span>{zoomLevel === 12 ? `Año ${baseDate.getFullYear()}` : 'Diagrama KMs (90 Días)'}</span>
          </h3>

          {/* Botones 90 Días (3 Meses) vs 12 Meses (Anual) */}
          <div className="calendar-scale-toggle">
            <button
              onClick={() => setZoomLevel(3)}
              className={`scale-btn ${zoomLevel === 3 ? 'active' : ''}`}
              title="Vista de 90 días en 3 meses (Egress ultra-bajo: ~2.99 KB)"
            >
              90 Días (3 Meses)
            </button>
            <button
              onClick={() => setZoomLevel(12)}
              className={`scale-btn ${zoomLevel === 12 ? 'active' : ''}`}
              title="Consulta ampliada de 12 meses (Egress: ~10.60 KB)"
            >
              12 Meses (Anual)
            </button>
          </div>

          {/* Navegación de meses */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
            <button onClick={prevMonth} className="btn-icon-square" style={{ width: '28px', height: '28px' }} title="Mes Anterior">
              <ChevronLeft size={16} />
            </button>
            <button onClick={nextMonth} className="btn-icon-square" style={{ width: '28px', height: '28px' }} title="Mes Siguiente">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* Indicadores de KMs y Ayuda Shift */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {selectedRange && (
            <div
              className="badge-km-rango"
              title={`Kilómetros acumulados en el rango seleccionado (${rangeStats.minIso} al ${rangeStats.maxIso})`}
            >
              <span className="badge-km-rango-label">Km Rango:</span>
              <span className="badge-km-rango-val">
                {rangeStats.km.toLocaleString('es-AR')} <span className="badge-km-rango-unit">km</span>
              </span>
            </div>
          )}

          <div className="badge-shift-hint">
            <kbd>Shift</kbd>
            <span>+ Clic para seleccionar rangos</span>
          </div>
        </div>
      </div>

      {/* Loading state o Cuadrícula de Tarjetas Mensuales */}
      {isLoadingCalendar ? (
        <div style={{ padding: '3rem', textAlign: 'center' }}>
          <span className="spinner-pulse" style={{ width: '24px', height: '24px' }} />
          <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Cargando diagrama y viajes de {choferNombre || 'conductor'}...
          </p>
        </div>
      ) : (
        <div className={`calendar-months-grid zoom-${zoomLevel}`}>
          {monthsToRender.map((m) => (
            <CalendarMonthCard
              key={m.tabKey}
              year={m.year}
              monthIndex={m.monthIndex}
              monthName={m.monthName}
              tiraDias={m.tiraDias}
              kmMesTotal={m.kmMesTotal}
              cantViajesMes={m.cantViajesMes}
              isActiveMonth={m.isActiveMonth}
              todayIso={todayIso}
              selectedRange={selectedRange}
              tripsMap={tripsMap}
              onDayClick={handleDayClick}
              icm={m.icm}
              isp={m.isp}
              icmClasificacion={m.icmClasificacion}
              ispClasificacion={m.ispClasificacion}
            />
          ))}
        </div>
      )}

      {/* Barra de Acciones de Rango Inferior Flotante */}
      <RangeActionBar
        selectedRange={selectedRange}
        rangeKm={rangeStats.km}
        tripsCount={rangeStats.tripsCount}
        onClear={handleClearSelection}
        onAssignStatus={handleAssignStatus}
        isPending={updateDiagrama.isPending}
      />
    </section>
  );
};
