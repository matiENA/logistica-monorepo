/**
 * ============================================================================
 * PINTAR DISPONIBILIDAD — MOTOR CENTRAL (core.js)
 * ============================================================================
 *
 * Este módulo contiene la lógica completa del pintado de disponibilidad
 * en Google Sheets sincronizado bidireccionalmente con Google Drive:
 *   Carpeta Drive: 18E_m8Ye5dp5xv2oCmYhEm8Ts7eeA7y8-
 *   Archivo de estado: pintardispo.json
 *
 * Arquitectura de Rendimiento:
 * 1. Índice de patentes y vencimientos extraído de "base datos Uni QM".
 * 2. Mapeo de filas con tracking dual de estado: estadoPrevio vs estadoActual.
 * 3. Detección O(1) de cambios de vencimientos (cambioDeVencimiento).
 * 4. Actualización selectiva en Google Sheets únicamente para celdas/filas modificadas
 *    (Gris #F5F7FA, Azul #4285F4, Rojo #FF4D4D).
 * 5. Lotes de tamaño controlado (30 ops) con división adaptativa contra errores 503/500.
 * ============================================================================
 */

'use strict';

const { google } = require('googleapis');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');

const {
  getAuthClient,
  getDriveClient,
  leerEstadoDrive,
  guardarEstadoDrive,
  LOCAL_CACHE_FILE,
  DRIVE_FOLDER_ID,
  STATE_FILENAME
} = require('./driveDispoManager');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const KEY_FILE    = path.join(__dirname, 'ute-logistica-key.json');
const STATE_FILE  = path.join(__dirname, 'last_dispo_state.json');

// ─── CARGA DE CONFIGURACIÓN DINÁMICA ──────────────────────────────────────────

function cargarConfig() {
  const envSpreadsheetId = process.env.MES_MOVIMIENTOS_ID || process.env.ID_SHEET_MOVIMIENTOS;
  const porDefecto = {
    spreadsheetId: envSpreadsheetId || '1z66kNDjMki1k9csQevuyhfz50dYoHrQro4wPj-Yt-hc',
    planillasGuardadas: [],
    colsDispo: [
       29,  42,  55,  68,  81,  94, 107, 120, 133, 146, 159,  // Días 1-11
      172, 185, 198, 211, 224, 237, 250, 263, 276, 289, 302,  // Días 12-22
      315, 328, 341, 354, 367, 380, 393, 406, 415, 419, 428   // Días 23-31
    ]
  };

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      const cfg = { ...porDefecto, ...parsed };
      if (envSpreadsheetId) cfg.spreadsheetId = envSpreadsheetId;
      return cfg;
    } catch (e) {
      console.warn('⚠️ Error al leer config.json, usando valores por defecto.');
    }
  }
  return porDefecto;
}

function guardarConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

const DEFAULTS = {
  uniQMSheet: 'base datos Uni QM',
  serviciosHeaders: [
    'LIVIANO', 'METANOL', 'CAMPO', 'ABASTECEDOR', 'GLP', 'GENERAL', 'SOCIO'
  ],
  colores: {
    rojo:   { red: 1,     green: 0.302, blue: 0.302 }, // #FF4D4D — Vencido
    azul:   { red: 0.259, green: 0.522, blue: 0.957 }, // #4285F4 — Vence ≤ 10 días
    normal: { red: 0.961, green: 0.969, blue: 0.980 }  // #F5F7FA — Base / Habilitado
  },
  filaInicioDatos: 3,
  tamanoLoteBatch: parseInt(process.env.DISPO_BATCH_SIZE || '30', 10)
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const norm = s => String(s || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseFecha(v) {
  if (v === null || v === undefined || v === '' || v === '#N/A') return null;
  if (typeof v === 'number') {
    const d = new Date((v - 25569) * 86400000);
    if (!isNaN(d)) { d.setHours(0,0,0,0); return d; }
  }
  const s = String(v).trim().toLowerCase();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split('/');
    const d = new Date(+yyyy, +mm - 1, +dd);
    if (!isNaN(d)) { d.setHours(0,0,0,0); return d; }
  }
  const meses = { enero:0,febrero:1,marzo:2,abril:3,mayo:4,junio:5,julio:6,
                  agosto:7,septiembre:8,setiembre:8,octubre:9,noviembre:10,diciembre:11 };
  const m = s.match(/^(\d{1,2})\s+([a-záéíóúü]+)\s+(\d{4})/);
  if (m && m[2] in meses) {
    const d = new Date(+m[3], meses[m[2]], +m[1]);
    if (!isNaN(d)) { d.setHours(0,0,0,0); return d; }
  }
  return null;
}

function formatearFecha(ts) {
  if (!ts) return 'N/A';
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function fechaBaseDesdeTitulo(titulo) {
  const s = String(titulo).toLowerCase();
  const meses = { enero:0,febrero:1,marzo:2,abril:3,mayo:4,junio:5,julio:6,
                  agosto:7,septiembre:8,setiembre:8,octubre:9,noviembre:10,diciembre:11 };
  let mes = new Date().getMonth();
  for (const k in meses) { if (s.includes(k)) { mes = meses[k]; break; } }
  const aMatch = s.match(/\b(20\d{2})\b/);
  const anio = aMatch ? +aMatch[1] : new Date().getFullYear();
  const d = new Date(anio, mes, 1);
  d.setHours(0,0,0,0);
  return d;
}

// ─── AUTENTICACIÓN ────────────────────────────────────────────────────────────

async function getSheetsInstance() {
  const client = await getAuthClient();
  return google.sheets({ version: 'v4', auth: client });
}

// ─── INSPECCIÓN DE METADATOS ─────────────────────────────────────────────────

async function inspeccionarPlanilla(spreadsheetId, sheetsInstance = null) {
  const sheets = sheetsInstance || await getSheetsInstance();
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'properties.title,sheets.properties(sheetId,title)'
  });
  const title = res.data.properties.title || 'Planilla sin título';
  const list = res.data.sheets.map(s => ({
    sheetId: s.properties.sheetId,
    title: s.properties.title
  }));
  const movSheet = list.find(s => s.title.toLowerCase().includes('mov.unidades'));
  const uniQMSheet = list.find(s => s.title.toLowerCase().includes('uni qm'));

  return {
    spreadsheetId,
    title,
    sheets: list,
    movSheet: movSheet ? movSheet.title : null,
    movSheetId: movSheet ? movSheet.sheetId : null,
    uniQMSheet: uniQMSheet ? uniQMSheet.title : null,
    esValida: Boolean(movSheet && uniQMSheet)
  };
}

// ─── LECTURA DE RANGOS ────────────────────────────────────────────────────────

async function leerRango(sheets, spreadsheetId, sheetName, rango) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!${rango}`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  return res.data.values || [];
}

// ─── ENVÍO DE LOTES CON DIVISIÓN ADAPTATIVA ──────────────────────────────────

async function sendBatchWithAdaptiveSplit(sheets, spreadsheetId, lote, label, log) {
  if (!lote || lote.length === 0) return;

  const maxIntentos = 4;
  let intento = 0;

  while (intento < maxIntentos) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: lote }
      });
      return;
    } catch (err) {
      intento++;
      const errMsg = String(err.message || '');
      const esErrorServidor = err.code === 500 || err.code === 503 || err.code === 429 ||
                              errMsg.includes('backendError') || errMsg.includes('Quota exceeded') ||
                              errMsg.includes('Service Unavailable') || errMsg.includes('rateLimit');

      if (esErrorServidor && intento < maxIntentos) {
        if (lote.length > 10) {
          const mid = Math.ceil(lote.length / 2);
          const sub1 = lote.slice(0, mid);
          const sub2 = lote.slice(mid);
          log(`⚠️ Google API ocupada (${err.code || '503'}). Dividiendo ${label} (${lote.length} ops) en 2 sub-lotes (${sub1.length} y ${sub2.length})...`, 'WARN');
          await sleep(1000 + Math.floor(Math.random() * 500));
          await sendBatchWithAdaptiveSplit(sheets, spreadsheetId, sub1, `${label}.1`, log);
          await sleep(350);
          await sendBatchWithAdaptiveSplit(sheets, spreadsheetId, sub2, `${label}.2`, log);
          return;
        } else {
          const espera = intento * 2000 + Math.floor(Math.random() * 1000);
          log(`⚠️ Google API ocupada (${err.code || '503'}). Reintentando ${label} en ${(espera/1000).toFixed(1)}s (intento ${intento}/${maxIntentos})...`, 'WARN');
          await sleep(espera);
        }
      } else {
        throw err;
      }
    }
  }
}

// ─── PROCESO PRINCIPAL DE PINTADO ────────────────────────────────────────────

async function ejecutarPintado(options = {}, onLog = null, sheetsInstance = null) {
  const t0 = Date.now();
  const config = cargarConfig();
  const spreadsheetId = options.spreadsheetId || config.spreadsheetId;
  const colsDispo = options.colsDispo || config.colsDispo;

  const log = (msg, level = 'INFO') => {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const line = `[${new Date().toLocaleTimeString('es-AR')}][${elapsed}s][${level}] ${msg}`;
    console.log(line);
    if (typeof onLog === 'function') {
      onLog({ message: msg, level, elapsed, timestamp: new Date().toISOString() });
    }
  };

  log(`Iniciando proceso de disponibilidad...`, 'INFO');
  log(`ID Spreadsheet: ${spreadsheetId}`, 'INFO');

  const sheets = sheetsInstance || await getSheetsInstance();
  const drive = await getDriveClient();

  // 1. Cargar estado previo de Google Drive (pintardispo.json)
  log(`Cargando estado desde Google Drive (${STATE_FILENAME} en carpeta ${DRIVE_FOLDER_ID})...`, 'INFO');
  const driveStatePrevio = await leerEstadoDrive(drive);
  if (driveStatePrevio && driveStatePrevio.indice_patentes) {
    const totalPatPrev = Object.keys(driveStatePrevio.indice_patentes).length;
    const totalFilasPrev = driveStatePrevio.filas ? Object.keys(driveStatePrevio.filas).length : 0;
    log(`[Drive State] ✅ Estado anterior cargado: ${totalPatPrev} patentes indexadas, ${totalFilasPrev} filas registradas.`, 'OK');
  } else {
    log(`[Drive State] ℹ️ Sin estado previo registrado en Drive (Cold start inicial).`, 'INFO');
  }

  // 2. Detectar pestaña Mov.Unidades
  log('Verificando pestañas y metadatos...', 'INFO');
  const metadata = await inspeccionarPlanilla(spreadsheetId, sheets);
  if (!metadata.movSheet) {
    throw new Error('No se encontró ninguna pestaña con "Mov.Unidades" en el nombre.');
  }

  const movTitle = metadata.movSheet;
  const movSheetId = metadata.movSheetId;
  log(`Planilla activa: "${metadata.title}"`, 'OK');
  log(`Pestaña detectada: "${movTitle}" (sheetId: ${movSheetId})`, 'OK');

  // 3. Leer vencimientos y unidades en paralelo
  log('Leyendo datos de vencimientos y unidades...', 'INFO');
  const [rowsUniQM, rowsMov] = await Promise.all([
    leerRango(sheets, spreadsheetId, DEFAULTS.uniQMSheet, 'A2:F5000'),
    leerRango(sheets, spreadsheetId, movTitle, 'A3:F2000')
  ]);

  log(`"base datos Uni QM": ${rowsUniQM.length} filas obtenidas`, 'INFO');
  log(`"${movTitle}": ${rowsMov.length} filas obtenidas`, 'INFO');

  // 4. Construir índice de patentes y vencimientos sacado de "base datos Uni QM"
  const agrupado = new Map();
  for (let i = 0; i < rowsUniQM.length; i++) {
    const row = rowsUniQM[i];
    const unitId = norm(row[0]);
    if (!unitId) continue;

    const filaReal = i + 2;
    const fechas = [row[1], row[2], row[3], row[4], row[5]]
      .map(parseFecha)
      .filter(Boolean)
      .map(f => f.getTime());

    if (fechas.length === 0) continue;
    const maxFecha = Math.max(...fechas);

    if (!agrupado.has(unitId)) agrupado.set(unitId, []);
    agrupado.get(unitId).push({ fila: filaReal, fechas, maxFecha });
  }

  const indicePatentes = {};
  let totalDuplicados = 0;

  for (const [unitId, entradas] of agrupado.entries()) {
    if (entradas.length > 1) {
      totalDuplicados++;
      entradas.sort((a, b) => {
        if (b.maxFecha !== a.maxFecha) return b.maxFecha - a.maxFecha;
        if (b.fechas.length !== a.fechas.length) return b.fechas.length - a.fechas.length;
        return b.fila - a.fila;
      });
    }

    const fechasElegidas = entradas[0].fechas.sort((a, b) => a - b);
    const hash = crypto.createHash('md5').update(fechasElegidas.join(',')).digest('hex');
    const minFecha = fechasElegidas.length ? Math.min(...fechasElegidas) : null;

    indicePatentes[unitId] = {
      patente: unitId,
      vencimientos: fechasElegidas,
      vencimientosStr: fechasElegidas.map(formatearFecha),
      vencimientoMinStr: formatearFecha(minFecha),
      hash
    };
  }

  log(`Vencimientos: ${Object.keys(indicePatentes).length} unidades indexadas (${totalDuplicados} duplicados resueltos)`, 'OK');

  // 5. Procesar filas y proteger cabeceras de división
  const esDivision = [];
  const trIds = [];
  const seIds = [];

  for (let i = 0; i < rowsMov.length; i++) {
    const row = rowsMov[i];
    const colA = String(row[0] || '').trim().toUpperCase();
    const tr   = String(row[4] || '').trim(); // Col E
    const se   = String(row[5] || '').trim(); // Col F

    const matchServicio = DEFAULTS.serviciosHeaders.some(s => colA.includes(s));
    const esDiv = Boolean(
      matchServicio ||
      (!tr && !se) ||
      (!tr || (!/\d/.test(tr) && tr.length > 2))
    );

    esDivision.push(esDiv);
    trIds.push(norm(tr));
    seIds.push(norm(se));
  }

  const nDivisiones = esDivision.filter(Boolean).length;
  const nUnidades   = esDivision.length - nDivisiones;
  log(`Estructura: ${rowsMov.length} filas | 🚛 ${nUnidades} unidades | 🏷️  ${nDivisiones} cabeceras protegidas`, 'OK');

  // 6. Matriz de Estados y Detección de Cambios por Fila (Ambos estados en Drive)
  const fb = fechaBaseDesdeTitulo(movTitle);
  const msPorDia = 86400000;
  log(`Fecha base del mes: ${fb.toLocaleDateString('es-AR')}`, 'INFO');

  const colorMap = {
    R: DEFAULTS.colores.rojo,
    A: DEFAULTS.colores.azul,
    N: DEFAULTS.colores.normal
  };

  const nuevasFilas = {};
  let totalAlertasRojas = 0;
  let totalAlertasAzules = 0;
  let totalFilasCambiadas = 0;

  const prevFilasDrive = (driveStatePrevio && driveStatePrevio.filas) ? driveStatePrevio.filas : {};

  for (let r = 0; r < rowsMov.length; r++) {
    if (esDivision[r]) continue;

    const tr = trIds[r];
    const se = seIds[r];
    const infoTr = indicePatentes[tr];
    const infoSe = indicePatentes[se];

    const tsTr = infoTr ? infoTr.vencimientos : [];
    const tsSe = infoSe ? infoSe.vencimientos : [];

    // Hash de vencimientos combinado de la fila
    const hashVencimientos = crypto.createHash('md5')
      .update(`${tr}:${infoTr?.hash || ''}|${se}:${infoSe?.hash || ''}`)
      .digest('hex');

    // Calcular estadoActual para las 33 fechas
    const estadoActual = [];
    for (let ci = 0; ci < colsDispo.length; ci++) {
      const diaOffset = Math.min(ci, 30);
      const fechaColMs = fb.getTime() + diaOffset * msPorDia;

      let minDiff = Infinity;
      for (const ts of tsTr) {
        const d = Math.round((ts - fechaColMs) / msPorDia);
        if (d < minDiff) minDiff = d;
      }
      for (const ts of tsSe) {
        const d = Math.round((ts - fechaColMs) / msPorDia);
        if (d < minDiff) minDiff = d;
      }

      let c = 'N';
      if (minDiff < 0) {
        c = 'R';
        totalAlertasRojas++;
      } else if (minDiff <= 10) {
        c = 'A';
        totalAlertasAzules++;
      }
      estadoActual.push(c);
    }

    // Comparar con el estado previo de la fila en Drive
    const filaKey = String(r);
    const prevData = prevFilasDrive[filaKey] || null;
    const prevEstado = prevData ? prevData.estadoActual : null;
    const prevHashVenc = prevData ? prevData.hashVencimientos : null;
    const prevTr = prevData ? prevData.tractor : null;
    const prevSe = prevData ? prevData.semi : null;

    const cambioDeVencimiento = Boolean(
      options.force ||
      !prevData ||
      prevHashVenc !== hashVencimientos ||
      prevTr !== tr ||
      prevSe !== se
    );

    const cambioDeEstado = Boolean(
      options.force ||
      !prevEstado ||
      JSON.stringify(estadoActual) !== JSON.stringify(prevEstado)
    );

    if (cambioDeVencimiento || cambioDeEstado) {
      totalFilasCambiadas++;
    }

    nuevasFilas[filaKey] = {
      fila: DEFAULTS.filaInicioDatos + r,
      tractor: tr,
      semi: se,
      vencimientoMinTractor: infoTr ? infoTr.vencimientoMinStr : 'N/A',
      vencimientoMinSemi: infoSe ? infoSe.vencimientoMinStr : 'N/A',
      hashVencimientos,
      estadoPrevio: prevEstado || estadoActual,
      estadoActual,
      cambioDeVencimiento,
      cambioDeEstado,
      updatedAt: (cambioDeVencimiento || cambioDeEstado) ? new Date().toISOString() : (prevData?.updatedAt || new Date().toISOString())
    };
  }

  log(`Matriz calculada: 🔴 ${totalAlertasRojas} celdas rojas, 🔵 ${totalAlertasAzules} celdas azules sobre ${colsDispo.length * nUnidades} celdas totales`, 'INFO');
  log(`Diffing de filas: ${totalFilasCambiadas} fila(s) con cambio de vencimiento o estado detectado`, 'INFO');

  // 7. Gatekeeper O(1): Si no hay filas cambiadas ni es force, salir en 0s con 0 escrituras
  if (totalFilasCambiadas === 0 && !options.force) {
    log(`[Gatekeeper O(1)] ✅ Cero cambios detectados en vencimientos ni asignaciones. Sincronización omitida (0 llamadas de escritura).`, 'OK');
    const dur = ((Date.now() - t0) / 1000).toFixed(2);
    return {
      exito: true,
      sinCambios: true,
      duracionSegundos: dur,
      title: metadata.title,
      movTitle,
      unidadesProcesadas: nUnidades,
      alertas: {
        rojos: totalAlertasRojas,
        azules: totalAlertasAzules,
        total: totalAlertasRojas + totalAlertasAzules
      },
      operacionesAplicadas: 0,
      modo: 'gatekeeper_drive_noop'
    };
  }

  // 8. Generación Óptima de Solicitudes repeatCell (Únicamente para filas y celdas modificadas)
  const allRequests = [];
  let celdasModificadas = 0;
  const esColdStart = !driveStatePrevio || !driveStatePrevio.filas;

  for (let r = 0; r < rowsMov.length; r++) {
    if (esDivision[r]) continue;

    const filaKey = String(r);
    const rowInfo = nuevasFilas[filaKey];
    if (!rowInfo) continue;

    // Si la fila no cambió y no es force ni cold-start, omitir por completo
    if (!rowInfo.cambioDeVencimiento && !rowInfo.cambioDeEstado && !options.force && !esColdStart) {
      continue;
    }

    const currEstados = rowInfo.estadoActual;
    const prevEstados = rowInfo.estadoPrevio;

    for (let ci = 0; ci < colsDispo.length; ci++) {
      const colNum = colsDispo[ci];
      const currColor = currEstados[ci];
      const prevColor = prevEstados ? prevEstados[ci] : null;

      // Si es cold start, únicamente enviamos las celdas con alerta (Rojo y Azul)
      // evitando saturar la API con 6,500 escrituras de Gris redundantes
      let debePintar = false;
      if (options.force) {
        debePintar = true;
      } else if (esColdStart) {
        debePintar = (currColor === 'R' || currColor === 'A');
      } else {
        debePintar = (currColor !== prevColor);
      }

      if (debePintar) {
        celdasModificadas++;
        allRequests.push({
          repeatCell: {
            range: {
              sheetId:          movSheetId,
              startRowIndex:    (DEFAULTS.filaInicioDatos - 1) + r,
              endRowIndex:      (DEFAULTS.filaInicioDatos - 1) + r + 1,
              startColumnIndex: colNum - 1,
              endColumnIndex:   colNum
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: colorMap[currColor]
              }
            },
            fields: 'userEnteredFormat.backgroundColor'
          }
        });
      }
    }
  }

  const modoEjecucion = esColdStart ? 'drive_cold_start' : 'drive_diff_incremental';
  log(`Estrategia: [${modoEjecucion}] -> ${celdasModificadas} celdas a pintar en ${allRequests.length} operaciones`, 'OK');

  // Preparar nuevo estado para Drive
  const nuevoEstadoDrive = {
    metadata: {
      updatedAt: new Date().toISOString(),
      spreadsheetId,
      sheetTitle: metadata.title,
      movTitle,
      movSheetId,
      fechaBase: fb.toISOString(),
      totalPatentes: Object.keys(indicePatentes).length,
      totalFilasDiagramadas: nUnidades,
      filasModificadasEnEsteCiclo: totalFilasCambiadas,
      alertas: {
        rojos: totalAlertasRojas,
        azules: totalAlertasAzules,
        normales: (colsDispo.length * nUnidades) - (totalAlertasRojas + totalAlertasAzules)
      }
    },
    indice_patentes: indicePatentes,
    filas: nuevasFilas
  };

  if (options.dryRun) {
    log(`[DRY-RUN] Simulación activa. Se habrían enviado ${allRequests.length} operaciones a Sheets.`, 'INFO');
    log(`[DRY-RUN] Guardando estado simulado en Google Drive (${STATE_FILENAME})...`, 'INFO');
    await guardarEstadoDrive(drive, nuevoEstadoDrive);
    const dur = ((Date.now() - t0) / 1000).toFixed(2);
    return {
      exito: true,
      dryRun: true,
      duracionSegundos: dur,
      title: metadata.title,
      movTitle,
      unidadesProcesadas: nUnidades,
      alertas: {
        rojos: totalAlertasRojas,
        azules: totalAlertasAzules,
        total: totalAlertasRojas + totalAlertasAzules
      },
      operacionesAplicadas: 0,
      operacionesSimuladas: allRequests.length,
      modo: modoEjecucion
    };
  }

  // 9. Enviar en lotes controlados (30 ops) con throttling preventivo
  const loteSize = options.tamanoLoteBatch || DEFAULTS.tamanoLoteBatch;
  const totalLotes = Math.ceil(allRequests.length / loteSize);
  log(`Aplicando ${allRequests.length} operaciones en ${totalLotes} lote(s) (máx ${loteSize} ops/lote)...`, 'INFO');

  for (let i = 0; i < allRequests.length; i += loteSize) {
    const lote = allRequests.slice(i, i + loteSize);
    const nroLote = Math.floor(i / loteSize) + 1;
    const tLote0 = Date.now();
    log(`Enviando lote ${nroLote}/${totalLotes} (${lote.length} bloques)...`, 'INFO');

    await sendBatchWithAdaptiveSplit(sheets, spreadsheetId, lote, `Lote ${nroLote}/${totalLotes}`, log);

    const msLote = Date.now() - tLote0;
    log(`Lote ${nroLote}/${totalLotes} aplicado con éxito en ${(msLote/1000).toFixed(2)}s`, 'OK');
    if (i + loteSize < allRequests.length) {
      await sleep(350); // Throttling preventivo para no saturar la API
    }
  }

  // 10. Persistir estado definitivo en Google Drive y Espejo Local
  log(`Persistiendo nuevo estado en Google Drive (${STATE_FILENAME} en carpeta ${DRIVE_FOLDER_ID})...`, 'INFO');
  await guardarEstadoDrive(drive, nuevoEstadoDrive);
  log(`[Drive State] ✅ Estado guardado con éxito en Drive y caché local.`, 'OK');

  const dur = ((Date.now() - t0) / 1000).toFixed(2);
  log(`PROCESO COMPLETO FINALIZADO EXITOSAMENTE EN ${dur}s (${allRequests.length} operaciones aplicadas)`, 'OK');

  // Actualizar historial de planillas si es nueva
  const existe = config.planillasGuardadas.find(p => p.id === spreadsheetId);
  if (!existe) {
    config.planillasGuardadas.unshift({
      id: spreadsheetId,
      nombre: metadata.title,
      pestaña: movTitle
    });
    if (config.planillasGuardadas.length > 12) config.planillasGuardadas.pop();
    guardarConfig(config);
  }

  return {
    exito: true,
    duracionSegundos: dur,
    title: metadata.title,
    movTitle,
    unidadesProcesadas: nUnidades,
    alertas: {
      rojos: totalAlertasRojas,
      azules: totalAlertasAzules,
      total: totalAlertasRojas + totalAlertasAzules
    },
    operacionesAplicadas: allRequests.length,
    modo: modoEjecucion
  };
}

module.exports = {
  cargarConfig,
  guardarConfig,
  inspeccionarPlanilla,
  ejecutarPintado,
  getSheetsInstance,
  getAuthClient,
  getDriveClient,
  STATE_FILE,
  DEFAULTS,
  KEY_FILE
};
