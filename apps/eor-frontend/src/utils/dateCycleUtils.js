/**
 * dateCycleUtils.js
 * Utilidades para cálculo determinístico de ciclos de liquidación y diagramas operativos (del día 26 al día 25).
 */

const MESES_ABREV = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Retorna las fechas y etiqueta del ciclo de liquidación/diagrama (día 26 al día 25).
 * 
 * Regla de negocio:
 * El ciclo abarca desde el día 26 de un mes hasta el día 25 del mes siguiente.
 * Ejemplos:
 *  - 26 de septiembre al 25 de octubre  -> "sep 26 - oct 25"
 *  - 26 de octubre al 25 de noviembre   -> "oct 26 - nov 25"
 * 
 * @param {Date|string} [refDate=new Date()] - Fecha de referencia
 * @returns {{ startIso: string, endIso: string, label: string }}
 */
export function getDiagramaCicloFechas(refDate = new Date()) {
  const d = (refDate instanceof Date) ? refDate : new Date(refDate);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0..11
  const day = d.getDate();

  let dDesde, dHasta;
  if (day >= 26) {
    // Si la fecha es día 26 o posterior, el ciclo corre del 26 de este mes al 25 del próximo
    dDesde = new Date(year, month, 26);
    dHasta = new Date(year, month + 1, 25);
  } else {
    // Si la fecha es anterior al 26, el ciclo corre del 26 del mes anterior al 25 de este mes
    dDesde = new Date(year, month - 1, 26);
    dHasta = new Date(year, month, 25);
  }

  const startIso = `${dDesde.getFullYear()}-${String(dDesde.getMonth() + 1).padStart(2, '0')}-26`;
  const endIso = `${dHasta.getFullYear()}-${String(dHasta.getMonth() + 1).padStart(2, '0')}-25`;

  const mDesde = MESES_ABREV[dDesde.getMonth()];
  const mHasta = MESES_ABREV[dHasta.getMonth()];
  const label = `${mDesde} 26 - ${mHasta} 25`;

  return { startIso, endIso, label };
}

/**
 * Calcula la suma de kilómetros dentro de un ciclo (26 al 25) a partir de tripsMap.
 * Si el ciclo en curso aún no tiene viajes cargados en la planilla, toma el ciclo activo más reciente.
 * 
 * @param {Object} tripsMap - Diccionario { [isoDate]: { km, hr, ... } }
 * @param {Date|string} [refDate=new Date()] - Fecha de referencia
 * @returns {{ km: number, label: string, startIso: string, endIso: string }}
 */
export function calcularKmCiclo(tripsMap, refDate = new Date()) {
  const defaultCiclo = getDiagramaCicloFechas(refDate);
  if (!tripsMap || typeof tripsMap !== 'object') {
    return { km: 0, label: defaultCiclo.label, startIso: defaultCiclo.startIso, endIso: defaultCiclo.endIso };
  }

  // 1. Evaluar ciclo según fecha de referencia
  let kmActual = 0;
  let countActual = 0;

  for (const [isoDate, trip] of Object.entries(tripsMap)) {
    if (isoDate >= defaultCiclo.startIso && isoDate <= defaultCiclo.endIso) {
      const k = parseFloat(trip.km) || 0;
      if (k > 0) {
        kmActual += k;
        countActual++;
      }
    }
  }

  if (countActual > 0 || kmActual > 0) {
    return {
      km: Math.round(kmActual * 100) / 100,
      label: defaultCiclo.label,
      startIso: defaultCiclo.startIso,
      endIso: defaultCiclo.endIso,
    };
  }

  // 2. Si el ciclo en curso aún no tiene datos (ej: el período recién empieza),
  // evaluar el ciclo inmediatamente anterior que sí contiene la liquidación activa
  const dPrev = new Date(defaultCiclo.startIso + 'T12:00:00');
  dPrev.setDate(dPrev.getDate() - 1); // 1 día antes del inicio del ciclo actual (ej: día 25)
  const cicloPrevio = getDiagramaCicloFechas(dPrev);
  let kmPrevio = 0;
  let countPrevio = 0;

  for (const [isoDate, trip] of Object.entries(tripsMap)) {
    if (isoDate >= cicloPrevio.startIso && isoDate <= cicloPrevio.endIso) {
      const k = parseFloat(trip.km) || 0;
      if (k > 0) {
        kmPrevio += k;
        countPrevio++;
      }
    }
  }

  if (countPrevio > 0 || kmPrevio > 0) {
    return {
      km: Math.round(kmPrevio * 100) / 100,
      label: cicloPrevio.label,
      startIso: cicloPrevio.startIso,
      endIso: cicloPrevio.endIso,
    };
  }

  return {
    km: 0,
    label: defaultCiclo.label,
    startIso: defaultCiclo.startIso,
    endIso: defaultCiclo.endIso,
  };
}

/**
 * Calcula tanto el ciclo actual como el ciclo anterior de liquidación (del 26 al 25).
 * Ej: Ciclo anterior "sep 26 - oct 25" y Ciclo actual "oct 26 - nov 25".
 * 
 * @param {Object} tripsMap - Diccionario { [isoDate]: { km, hr, ... } }
 * @param {Date|string} [refDate=new Date()] - Fecha de referencia
 * @returns {{ actual: { km: number, label: string, startIso: string, endIso: string }, anterior: { km: number, label: string, startIso: string, endIso: string } }}
 */
export function calcularCiclosComparativos(tripsMap, refDate = new Date()) {
  const d = (refDate instanceof Date) ? refDate : new Date(refDate);
  const cicloActualFechas = getDiagramaCicloFechas(d);

  // Fecha de referencia para el ciclo anterior: 1 día antes del inicio del ciclo actual
  const dPrev = new Date(cicloActualFechas.startIso + 'T12:00:00');
  dPrev.setDate(dPrev.getDate() - 1);
  const cicloAnteriorFechas = getDiagramaCicloFechas(dPrev);

  let kmActual = 0;
  let kmAnterior = 0;

  if (tripsMap && typeof tripsMap === 'object') {
    for (const [isoDate, trip] of Object.entries(tripsMap)) {
      const k = parseFloat(trip?.km) || 0;
      if (k > 0) {
        if (isoDate >= cicloActualFechas.startIso && isoDate <= cicloActualFechas.endIso) {
          kmActual += k;
        } else if (isoDate >= cicloAnteriorFechas.startIso && isoDate <= cicloAnteriorFechas.endIso) {
          kmAnterior += k;
        }
      }
    }
  }

  return {
    actual: {
      km: Math.round(kmActual * 100) / 100,
      label: cicloActualFechas.label,
      startIso: cicloActualFechas.startIso,
      endIso: cicloActualFechas.endIso,
    },
    anterior: {
      km: Math.round(kmAnterior * 100) / 100,
      label: cicloAnteriorFechas.label,
      startIso: cicloAnteriorFechas.startIso,
      endIso: cicloAnteriorFechas.endIso,
    },
  };
}
