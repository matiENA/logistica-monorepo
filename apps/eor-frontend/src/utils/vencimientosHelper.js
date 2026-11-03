/**
 * apps/frontend/src/utils/vencimientosHelper.js
 *
 * Helper unificado para evaluación de vencimientos y generación
 * de la matriz compartida entre el Badge de cabecera y el Acordeón.
 * 
 * Regla canónica (Obsidian / EOR):
 * - 🔴 VENCIDO: Fecha < Hoy
 * - 🟡 POR VENCER: 0 <= Días restantes <= 30 (1 mes)
 * - 🟢 VIGENTE: Días restantes > 30
 * - ⚪ S/D: Sin fecha registrada o sin unidad
 */

/**
 * Formatea una fecha a DD/MM/AAAA
 * @param {string|Date} d
 * @returns {string}
 */
export function formatVencDate(d) {
  if (!d) return 'S/D';
  const clean = String(d).trim().split('T')[0];
  const parts = clean.split(/[-/]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      // YYYY-MM-DD -> DD/MM/YYYY
      return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
    }
    // DD-MM-YYYY -> DD/MM/YYYY
    return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2]}`;
  }
  return clean;
}

/**
 * Evalúa el estado de vigencia de una fecha respecto al día actual (a las 00:00:00).
 * @param {string|Date} dateVal - Fecha ISO, DD/MM/AAAA o timestamp
 * @param {number} [warningDays=30] - Umbral para amarillo (1 mes = 30 días)
 * @returns {{ status: 'vencido'|'por_vencer'|'vigente'|'s_d', diffDays: number|null, label: string }}
 */
export function evaluateDateStatus(dateVal, warningDays = 30) {
  if (!dateVal) return { status: 's_d', diffDays: null, label: 'S/D' };

  const s = String(dateVal).trim().split('T')[0];
  const parts = s.split(/[-/]/);
  let y, m, d;

  if (parts.length === 3) {
    if (parts[0].length === 4) {
      // YYYY-MM-DD
      y = parseInt(parts[0], 10);
      m = parseInt(parts[1], 10) - 1;
      d = parseInt(parts[2], 10);
    } else {
      // DD-MM-YYYY o DD/MM/YYYY
      d = parseInt(parts[0], 10);
      m = parseInt(parts[1], 10) - 1;
      y = parseInt(parts[2].length === 2 ? '20' + parts[2] : parts[2], 10);
    }
  } else {
    const parsed = new Date(dateVal);
    if (isNaN(parsed.getTime())) return { status: 's_d', diffDays: null, label: 'S/D' };
    y = parsed.getFullYear();
    m = parsed.getMonth();
    d = parsed.getDate();
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(y, m, d);
  target.setHours(0, 0, 0, 0);

  const diffDays = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { status: 'vencido', diffDays, label: 'VENCIDO' };
  }
  if (diffDays <= warningDays) {
    return { status: 'por_vencer', diffDays, label: 'POR VENCER' };
  }
  return { status: 'vigente', diffDays, label: 'AL DÍA' };
}

/**
 * Genera el dataset consolidado de los 8 vencimientos y calcula el estado resumen
 * consumido tanto por el Badge de cabecera como por la Matriz del Acordeón.
 * 
 * @param {Object} driver - Registro de chofer proveniente de view_diaria_operativa
 * @returns {Object} { items, globalStatus, badgeLabel, countVencidos, countPorVencer, tieneUnidad }
 */
export function buildUnifiedVencimientos(driver) {
  if (!driver) {
    return {
      items: [],
      globalStatus: 's_d',
      badgeLabel: 'S/D',
      countVencidos: 0,
      countPorVencer: 0,
      tieneUnidad: false,
    };
  }

  const tieneUnidad = Boolean(driver.tractor || driver.semi || driver.n_ute);

  const rawItems = [
    // 👤 Conductor (4 vencimientos obligatorios)
    { id: 'periodico', grupo: 'conductor', icon: '👤', nombre: 'Periódico', rawFecha: driver.venc_periodico },
    { id: 'licencia', grupo: 'conductor', icon: '👤', nombre: 'Licencia Nac.', rawFecha: driver.venc_licencia_nacional },
    { id: 'cargas_pel', grupo: 'conductor', icon: '👤', nombre: 'Certificado M.P', rawFecha: driver.venc_cargas_peligrosas },
    { id: 'apto_medico', grupo: 'conductor', icon: '👤', nombre: 'Apto Médico', rawFecha: driver.apto_medico_venc },

    // 🚚 Unidad (4 vencimientos de tractores y semis)
    { id: 'vtv_tr', grupo: 'unidad', icon: '🚚', nombre: 'VTV Tractor', rawFecha: tieneUnidad ? driver.vtv_tr : null, sinUnidad: !tieneUnidad },
    { id: 'mas_tr', grupo: 'unidad', icon: '🚚', nombre: 'MASS Tractor', rawFecha: tieneUnidad ? driver.mas_tr : null, sinUnidad: !tieneUnidad },
    { id: 'vtv_semi', grupo: 'unidad', icon: '🚚', nombre: 'VTV Semi', rawFecha: tieneUnidad ? driver.vtv_semi : null, sinUnidad: !tieneUnidad },
    { id: 'mas_semi', grupo: 'unidad', icon: '🚚', nombre: 'MASS Semi', rawFecha: tieneUnidad ? driver.mas_semi : null, sinUnidad: !tieneUnidad },
  ];

  const items = rawItems.map((it) => {
    if (it.sinUnidad) {
      return {
        ...it,
        status: 's_d',
        diffDays: null,
        label: 'Sin Unidad',
        formattedDate: '—',
        tooltip: 'Conductor sin unidad asignada',
      };
    }

    const { status, diffDays, label } = evaluateDateStatus(it.rawFecha, 30);
    const formattedDate = formatVencDate(it.rawFecha);

    let tooltip = '';
    if (status === 'vencido') {
      const d = Math.abs(diffDays);
      tooltip = `🔴 Vencido hace ${d} día${d === 1 ? '' : 's'} (${formattedDate})`;
    } else if (status === 'por_vencer') {
      tooltip = `🟡 Vence en ${diffDays} día${diffDays === 1 ? '' : 's'} (< 1 mes) (${formattedDate})`;
    } else if (status === 'vigente') {
      tooltip = `🟢 Vigente hasta el ${formattedDate} (${diffDays} días restantes)`;
    } else {
      tooltip = '⚪ Sin fecha registrada en el sistema';
    }

    return {
      ...it,
      status,
      diffDays,
      label,
      formattedDate,
      tooltip,
    };
  });

  // Agregación de estado peor caso para el Badge
  const docVencidos = items.filter(i => i.grupo === 'conductor' && i.status === 'vencido').length;
  const uniVencidos = items.filter(i => i.grupo === 'unidad' && i.status === 'vencido').length;
  const countVencidos = docVencidos + uniVencidos;

  const docPorVencer = items.filter(i => i.grupo === 'conductor' && i.status === 'por_vencer').length;
  const uniPorVencer = items.filter(i => i.grupo === 'unidad' && i.status === 'por_vencer').length;
  const countPorVencer = docPorVencer + uniPorVencer;

  let globalStatus = 'vigente';
  let badgeLabel = 'AL DÍA';

  if (countVencidos > 0) {
    globalStatus = 'vencido';
    if (docVencidos > 0 && uniVencidos > 0) {
      badgeLabel = 'DOCS Y UNIDAD';
    } else if (docVencidos > 0) {
      badgeLabel = 'DOCS VENCIDOS';
    } else {
      badgeLabel = 'UNIDAD VENCIDA';
    }
  } else if (countPorVencer > 0) {
    globalStatus = 'por_vencer';
    if (docPorVencer > 0 && uniPorVencer > 0) {
      badgeLabel = 'DOCS Y UNIDAD (1m)';
    } else if (docPorVencer > 0) {
      badgeLabel = 'DOCS (1m)';
    } else {
      badgeLabel = 'UNIDAD (1m)';
    }
  }

  return {
    items,
    globalStatus,
    badgeLabel,
    countVencidos,
    countPorVencer,
    docVencidos,
    uniVencidos,
    docPorVencer,
    uniPorVencer,
    tieneUnidad,
  };
}
