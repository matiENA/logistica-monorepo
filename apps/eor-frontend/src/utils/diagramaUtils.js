const MESES_ABREV = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
];

export function getCurrentMesTab() {
  const now = new Date();
  return `${MESES_ABREV[now.getMonth()]}-${String(now.getFullYear()).slice(-2)}`;
}

export function parseMesTab(tabKey) {
  const parts = String(tabKey || '').trim().split('-');
  if (parts.length !== 2) return null;
  const mIdx = MESES_ABREV.findIndex((m) => m.toLowerCase() === parts[0].trim().toLowerCase());
  const yyDigits = parts[1].replace(/\D/g, '');
  if (mIdx === -1 || !yyDigits) return null;
  const anio = yyDigits.length <= 2 ? parseInt('20' + yyDigits.padStart(2, '0'), 10) : parseInt(yyDigits, 10);
  const mesNumero = mIdx + 1;
  const daysInMonth = new Date(anio, mesNumero, 0).getDate();
  return {
    mesTab: `${MESES_ABREV[mIdx]}-${String(anio).slice(-2)}`,
    anio,
    mesNumero,
    daysInMonth,
  };
}

export function buildUpdatedTira(tiraActual = '', dayUpdates = [], daysInMonth = 31) {
  let arr = tiraActual && tiraActual.length > 0 ? tiraActual.split(',').map((v) => v.trim() || '-') : [];
  while (arr.length < daysInMonth) arr.push('-');
  if (arr.length > daysInMonth) arr = arr.slice(0, daysInMonth);

  for (const { dia, valor } of dayUpdates) {
    if (dia >= 1 && dia <= daysInMonth) {
      arr[dia - 1] = String(valor ?? '-').trim().toUpperCase() || '-';
    }
  }
  return arr;
}

export function buildDiasMapFromArray(arr = [], anio, mesNumero) {
  const mesStr = String(mesNumero).padStart(2, '0');
  const diasMap = {};
  arr.forEach((val, idx) => {
    const iso = `${anio}-${mesStr}-${String(idx + 1).padStart(2, '0')}`;
    diasMap[iso] = val || '-';
  });
  return diasMap;
}

export function getBaseState(val) {
  if (!val || val === '-' || val === '0') return '';
  const str = String(val).toUpperCase().trim();
  if (str.includes('+')) return str.split('+')[0].trim();
  return str;
}

/**
 * Normaliza cualquier código de diagrama/novedad al sufijo canónico de token CSS (--novedad-*).
 */
export function getNovedadCode(val) {
  if (!val || val === '-' || val === '0') return 'default';
  const base = getBaseState(val);
  if (!base) return 'default';

  if (base === 'FSF' || base.startsWith('FSF')) return 'fsf';
  if (['F', 'FRANCO', 'RPT'].includes(base) || base.startsWith('F')) return 'f';
  if (base === 'VSF' || base.startsWith('VSF')) return 'vsf';
  if (['V', 'VACACIONES'].includes(base) || base.startsWith('V')) return 'v';
  if (base === 'ART') return 'art';
  if (base === 'IND' || base === 'IIND' || base.startsWith('IND')) return 'ind';
  if (base === 'S' || base.startsWith('SUSP')) return 's';
  if (base === 'A') return 'a';
  if (base === 'E' || base.startsWith('MED') || base === 'LIC') return 'e';
  if (base === 'O' || base === 'OPERATIVO' || base === 'ACTIVO' || !isNaN(Number(base))) return 'act';

  return 'default';
}

/**
 * Devuelve las clases CSS canónicas de estado y fatiga para cualquier celda/badge
 * (Calendario Individual, Vista Diaria y Grilla Mensual).
 */
export function getDiagramaStatusClasses(val) {
  const code = getNovedadCode(val);
  if (code === 'act' && val) {
    const base = getBaseState(val);
    const num = parseInt(base, 10);
    if (!isNaN(num)) {
      if (num >= 22) return 'novedad-act fatiga-crit';
      if (num >= 18) return 'novedad-act fatiga-warn';
    }
  }
  return `novedad-${code}`;
}

export function calcularContabilizador(diasArr = []) {
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
}
