/**
 * ============================================================================
 * PINTAR DISPONIBILIDAD — MOTOR CENTRAL (core.js)
 * ============================================================================
 *
 * Este módulo contiene la lógica completa del pintado de disponibilidad
 * en Google Sheets. Puede ser ejecutado por línea de comandos o importado
 * por la interfaz web local (server.js).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 📖 GUÍA PARA MODIFICACIONES Y CAMBIOS MAYORES EN LA PLANILLA
 * ────────────────────────────────────────────────────────────────────────────
 *
 * 1. SI CAMBIAN LAS COLUMNAS "Dispo.":
 *    - Modificar la propiedad `colsDispo` en `config.json` o desde la Interfaz Web.
 *    - Cada número corresponde a la posición exacta de la columna (1-based: A=1, B=2, etc.).
 *
 * 2. SI CAMBIA LA POSICIÓN DE TRACTOR O SEMI EN "Mov.Unidades":
 *    - Ir a la función `leerUnidades()` (aprox. línea 230).
 *    - Actualmente lee `row[4]` (Col E = Tractor) y `row[5]` (Col F = Semi).
 *    - Si se mueven, cambiar los índices `row[index]` correspondientes.
 *
 * 3. SI SE AGREGAN NUEVAS CABECERAS DE SERVICIO O DIVISIONES:
 *    - Modificar el arreglo `CONFIG.serviciosHeaders` (aprox. línea 80).
 *    - Agregar palabras clave en mayúsculas (ej: 'GASODUCTO', 'INTERPROVINCIAL').
 *    - El script protegerá automáticamente el color de fondo de esas filas.
 *
 * 4. SI CAMBIA LA ESTRUCTURA DE "base datos Uni QM":
 *    - Ir a `construirMapaVenc()` (aprox. línea 160).
 *    - Actualmente toma `row[0]` como Patente y `row[1]` a `row[5]` como Fechas.
 *    - Si hay más columnas de vencimientos, ampliar el arreglo `[row[1], row[2], ...]`.
 *
 * 5. SI CAMBIAN LOS DÍAS DE ALERTA O COLORES:
 *    - En `calcularAlertas()` (aprox. línea 300):
 *      - `minDiff < 0`   → Rojo (#FF4D4D) [Vencido]
 *      - `minDiff <= 10` → Azul (#4285F4) [Próximo a vencer en 10 días o menos]
 *      - Todo lo demás   → Normal (#F5F7FA) [Habilitado]
 * ============================================================================
 */

'use strict';

const { google } = require('googleapis');
const path       = require('path');
const fs         = require('fs');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const KEY_FILE    = path.join(__dirname, 'ute-logistica-key.json');

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
  tamanoLoteBatch: 700
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
  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];

  // 1. Variable de entorno con JSON string o Base64 (estándar para Render Cloud)
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_CREDENTIALS_JSON;
  if (rawJson && rawJson.trim()) {
    try {
      let jsonStr = rawJson.trim();
      if (!jsonStr.startsWith('{')) {
        jsonStr = Buffer.from(jsonStr, 'base64').toString('utf8');
      }
      const credentials = JSON.parse(jsonStr);
      const auth = new google.auth.GoogleAuth({ credentials, scopes });
      const client = await auth.getClient();
      return google.sheets({ version: 'v4', auth: client });
    } catch (e) {
      console.warn('⚠️ Error al parsear GOOGLE_SERVICE_ACCOUNT_JSON:', e.message);
    }
  }

  // 2. Variable de entorno con ruta de archivo
  const fileEnv = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (fileEnv && fs.existsSync(fileEnv)) {
    const auth = new google.auth.GoogleAuth({ keyFile: fileEnv, scopes });
    const client = await auth.getClient();
    return google.sheets({ version: 'v4', auth: client });
  }

  // 3. Búsqueda de archivos locales y de desarrollo (resiliencia multi-entorno)
  const homeDir = require('os').homedir();
  const candidatos = [
    KEY_FILE,
    path.join(__dirname, 'credentials.json'),
    path.join(__dirname, 'gs account', 'ute-logistica-firebase-adminsdk-fbsvc-04f3a4a36e.json'),
    path.join(homeDir, 'Desktop', 'gs account', 'ute-logistica-firebase-adminsdk-fbsvc-04f3a4a36e.json'),
    path.join(homeDir, 'Desktop', 'ute-logistica-firebase-adminsdk-fbsvc-04f3a4a36e.json')
  ];

  for (const cand of candidatos) {
    if (fs.existsSync(cand)) {
      const auth = new google.auth.GoogleAuth({ keyFile: cand, scopes });
      const client = await auth.getClient();
      return google.sheets({ version: 'v4', auth: client });
    }
  }

  throw new Error(`Archivo de clave no encontrado. Configure GOOGLE_SERVICE_ACCOUNT_JSON o coloque "credentials.json" / "ute-logistica-key.json" en la carpeta del servicio.`);
}

// ─── INSPECCIÓN RÁPIDA DE METADATOS ──────────────────────────────────────────

async function inspeccionarPlanilla(spreadsheetId) {
  const sheets = await getSheetsInstance();
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

// ─── PROCESO PRINCIPAL DE PINTADO ────────────────────────────────────────────

async function ejecutarPintado(options = {}, onLog = null) {
  const t0 = Date.now();
  const config = cargarConfig();
  const spreadsheetId = options.spreadsheetId || config.spreadsheetId;
  const colsDispo = options.colsDispo || config.colsDispo || porDefecto.colsDispo;

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

  const sheets = await getSheetsInstance();

  // 1. Detectar pestaña Mov.Unidades
  log('Verificando pestañas y metadatos...', 'INFO');
  const metadata = await inspeccionarPlanilla(spreadsheetId);
  if (!metadata.movSheet) {
    throw new Error('No se encontró ninguna pestaña con "Mov.Unidades" en el nombre.');
  }

  const movTitle = metadata.movSheet;
  const movSheetId = metadata.movSheetId;
  log(`Planilla activa: "${metadata.title}"`, 'OK');
  log(`Pestaña detectada: "${movTitle}" (sheetId: ${movSheetId})`, 'OK');

  // 2. Leer vencimientos y unidades en paralelo
  log('Leyendo datos de vencimientos y unidades...', 'INFO');
  const [rowsUniQM, rowsMov] = await Promise.all([
    leerRango(sheets, spreadsheetId, DEFAULTS.uniQMSheet, 'A2:F5000'),
    leerRango(sheets, spreadsheetId, movTitle, 'A3:F2000')
  ]);

  log(`"base datos Uni QM": ${rowsUniQM.length} filas obtenidas`, 'INFO');
  log(`"${movTitle}": ${rowsMov.length} filas obtenidas`, 'INFO');

  // 3. Procesar mapa de vencimientos (con merge inteligente)
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

  const mapaVenc = {};
  let totalDuplicados = 0;

  for (const [unitId, entradas] of agrupado.entries()) {
    if (entradas.length === 1) {
      mapaVenc[unitId] = entradas[0].fechas;
    } else {
      totalDuplicados++;
      entradas.sort((a, b) => {
        if (b.maxFecha !== a.maxFecha) return b.maxFecha - a.maxFecha;
        if (b.fechas.length !== a.fechas.length) return b.fechas.length - a.fechas.length;
        return b.fila - a.fila;
      });
      mapaVenc[unitId] = entradas[0].fechas;
    }
  }
  log(`Vencimientos: ${Object.keys(mapaVenc).length} unidades indexadas (${totalDuplicados} duplicados resueltos)`, 'OK');

  // 4. Procesar unidades y detectar filas de servicio / cabeceras
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

  // Chunks continuos de unidades
  const chunksUnidades = [];
  let start = -1;
  for (let r = 0; r < esDivision.length; r++) {
    if (!esDivision[r]) {
      if (start === -1) start = r;
    } else {
      if (start !== -1) {
        chunksUnidades.push({ startRow: start, endRow: r });
        start = -1;
      }
    }
  }
  if (start !== -1) {
    chunksUnidades.push({ startRow: start, endRow: esDivision.length });
  }

  const nDivisiones = esDivision.filter(Boolean).length;
  const nUnidades   = esDivision.length - nDivisiones;
  log(`Estructura: ${rowsMov.length} filas | 🚛 ${nUnidades} unidades | 🏷️  ${nDivisiones} cabeceras protegidas`, 'OK');

  // 5. Generar Capa Base (#F5F7FA) y Capa de Alertas (🔴 / 🔵)
  const fb = fechaBaseDesdeTitulo(movTitle);
  const msPorDia = 86400000;
  const allRequests = [];

  log(`Fecha base del mes: ${fb.toLocaleDateString('es-AR')}`, 'INFO');

  // Capa Base
  for (const colNum of colsDispo) {
    for (const chunk of chunksUnidades) {
      allRequests.push({
        repeatCell: {
          range: {
            sheetId:          movSheetId,
            startRowIndex:    (DEFAULTS.filaInicioDatos - 1) + chunk.startRow,
            endRowIndex:      (DEFAULTS.filaInicioDatos - 1) + chunk.endRow,
            startColumnIndex: colNum - 1,
            endColumnIndex:   colNum
          },
          cell:   { userEnteredFormat: { backgroundColor: DEFAULTS.colores.normal } },
          fields: 'userEnteredFormat.backgroundColor'
        }
      });
    }
  }
  const baseCount = allRequests.length;
  log(`Capa Base (#F5F7FA): ${baseCount} operaciones sobre ${colsDispo.length} columnas`, 'INFO');

  // Capa de Alertas
  const bloquesAlertas = { R: [], A: [] };
  for (let ci = 0; ci < colsDispo.length; ci++) {
    const colNum     = colsDispo[ci];
    const diaOffset  = Math.min(ci, 30);
    const fechaColMs = fb.getTime() + diaOffset * msPorDia;
    let bColor = null, bStart = -1;

    for (let r = 0; r <= rowsMov.length; r++) {
      let color = null;
      if (r < rowsMov.length && !esDivision[r]) {
        const tsTr = mapaVenc[trIds[r]] || [];
        const tsSe = mapaVenc[seIds[r]] || [];
        let minDiff = Infinity;

        for (const ts of tsTr) {
          const d = Math.round((ts - fechaColMs) / msPorDia);
          if (d < minDiff) minDiff = d;
        }
        for (const ts of tsSe) {
          const d = Math.round((ts - fechaColMs) / msPorDia);
          if (d < minDiff) minDiff = d;
        }

        if      (minDiff < 0)   color = 'R';
        else if (minDiff <= 10) color = 'A';
      }

      if (color !== bColor) {
        if (bColor === 'R' || bColor === 'A') {
          bloquesAlertas[bColor].push({
            sr: (DEFAULTS.filaInicioDatos - 1) + bStart,
            er: (DEFAULTS.filaInicioDatos - 1) + r,
            ci: colNum - 1
          });
        }
        bColor = color;
        bStart = r;
      }
    }
  }

  const alertMap = { R: DEFAULTS.colores.rojo, A: DEFAULTS.colores.azul };
  for (const [c, lista] of Object.entries(bloquesAlertas)) {
    for (const b of lista) {
      allRequests.push({
        repeatCell: {
          range: {
            sheetId:          movSheetId,
            startRowIndex:    b.sr,
            endRowIndex:      b.er,
            startColumnIndex: b.ci,
            endColumnIndex:   b.ci + 1
          },
          cell:   { userEnteredFormat: { backgroundColor: alertMap[c] } },
          fields: 'userEnteredFormat.backgroundColor'
        }
      });
    }
  }

  const alertCount = allRequests.length - baseCount;
  log(`Alertas calculadas: 🔴${bloquesAlertas.R.length} Rojos + 🔵${bloquesAlertas.A.length} Azules = ${alertCount} operaciones`, 'OK');
  log(`Total operaciones en Sheets: ${allRequests.length}`, 'INFO');

  // 6. Enviar en lotes con reintento
  const loteSize = DEFAULTS.tamanoLoteBatch;
  const totalLotes = Math.ceil(allRequests.length / loteSize);
  log(`Aplicando cambios en ${totalLotes} lotes...`, 'INFO');

  for (let i = 0; i < allRequests.length; i += loteSize) {
    const lote = allRequests.slice(i, i + loteSize);
    const nroLote = Math.floor(i / loteSize) + 1;
    log(`Enviando lote ${nroLote}/${totalLotes} (${lote.length} bloques)...`, 'INFO');

    let intento = 0;
    while (intento < 4) {
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: lote }
        });
        break;
      } catch (err) {
        intento++;
        const esErrorServidor = err.code === 500 || err.code === 503 || String(err.message).includes('backendError');
        if (esErrorServidor && intento < 4) {
          const espera = intento * 3000;
          log(`Google API ocupada. Reintentando en ${espera/1000}s (intento ${intento}/4)...`, 'WARN');
          await sleep(espera);
        } else {
          throw err;
        }
      }
    }
    log(`Lote ${nroLote}/${totalLotes} aplicado con éxito`, 'OK');
    if (nroLote < totalLotes) await sleep(400);
  }

  const dur = ((Date.now() - t0) / 1000).toFixed(2);
  log(`PROCESO COMPLETO FINALIZADO EXITOSAMENTE EN ${dur}s`, 'OK');

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
      rojos: bloquesAlertas.R.length,
      azules: bloquesAlertas.A.length,
      total: alertCount
    }
  };
}

module.exports = {
  cargarConfig,
  guardarConfig,
  inspeccionarPlanilla,
  ejecutarPintado,
  DEFAULTS,
  KEY_FILE
};
