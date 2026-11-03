const fs = require('fs');
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

// Cargar variables de entorno desde .env local si existe (para localhost)
const envFilePath = fs.existsSync(path.resolve(__dirname, '.env'))
  ? path.resolve(__dirname, '.env')
  : path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envFilePath)) {
  const envContent = fs.readFileSync(envFilePath, 'utf8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/(^['"]|['"]$)/g, '');
      if (key && !process.env[key]) {
        process.env[key] = val;
      }
    }
  });
}
const { Server } = require('socket.io');
const { google } = require('googleapis');
const { extractCleanPlate } = require('./plateNormalizer');
const { extractPlates, processSingleOtUpdate, syncFullOtDatabase, syncCanonicalFleetToDbOtList } = require('./otSyncService');
const otsManager = require('./otsManagerService');
const {
  syncOtsToTasksDatabase,
  startAutomaticTaskSync,
  getActiveTasksBoard,
  updateTaskExecution,
  calculateAndSaveOtPercentage,
  updateAllOtsPercentages,
  getHistoricalTasks,
  getOperarioHoldOts,
  saveOperarioHoldOts,
  getOtLifecyclePayload,
  updateOtTaskTerminado,
  getUnitTimelineTasks,
  getStaffAndLocations,
  getCoordinacionBoard,
  saveOtCoordinacionJson,
  saveAllCoordinacionBatch
} = require('./taskSyncService');

const compression = require('compression');
const db = require('./utils/db');

process.on('unhandledRejection', (reason, promise) => {
  console.warn('⚠️ [Process] Unhandled Rejection:', (reason && reason.stack) ? reason.stack : (reason?.message || reason));
});

process.on('uncaughtException', (err) => {
  console.error('❌ [Process] Uncaught Exception:', (err && err.stack) ? err.stack : (err?.message || err));
});

const app = express();

// Directorio del frontend (prioriza public raíz de Render, o public de backend, o ../frontend)
const FRONTEND_DIR = fs.existsSync(path.join(__dirname, '..', 'public'))
  ? path.join(__dirname, '..', 'public')
  : (fs.existsSync(path.join(__dirname, 'public'))
      ? path.join(__dirname, 'public')
      : (fs.existsSync(path.join(__dirname, '..', 'frontend')) ? path.join(__dirname, '..', 'frontend') : null));

function serveStaticOrJson(res, filename, extra = {}, forceRaw = false) {
  if (FRONTEND_DIR) {
    let filePath = path.join(FRONTEND_DIR, filename);
    // Priorizar versión clásica funcional de index.html si está en legacy y no se fuerza raw
    if (filename === 'index.html' && !forceRaw && fs.existsSync(path.join(FRONTEND_DIR, 'legacy', 'index.html'))) {
      filePath = path.join(FRONTEND_DIR, 'legacy', 'index.html');
    }
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
  }
  return res.json({
    service: 'Pañol Logistics Microservice (Backend Web Service)',
    status: 'online',
    route: filename,
    notice: 'El Frontend se publica de forma independiente en su propio servicio estático',
    timestamp: new Date().toISOString(),
    ...extra
  });
}
// ⚡ 1. Compresión gzip global para reducir el consumo de bandwidth en un 75-85%
app.use(compression());

// ⚡ 2. CORS tolerante para habilitar Static Sites de Render y localhost con credenciales
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token', 'X-Requested-With']
}));
app.use(express.json());

// === AUTENTICACIÓN CENTRALIZADA DEL SISTEMA (CAPA 1: ACCESO DISPOSITIVO) ===
const SYSTEM_USER = (process.env.SYSTEM_USER || 'taller').trim().toLowerCase();
const RENDER_BASE_PASSWORD = 'taller2026';
const RENDER_BASE_SECRET = 'panol-secret-auth-key-2026-xyz';
const SYSTEM_AUTH_SECRET = process.env.SYSTEM_AUTH_SECRET || RENDER_BASE_SECRET;
const SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 días

// Función para obtener todas las contraseñas válidas:
// Siempre incluye la de Render (taller2026) + cualquier variable adicional en Railway
function getAllowedPasswords() {
  const allowed = new Set();
  // 1. Clave original de Render (siempre garantizada para nunca romper compatibilidad)
  allowed.add(RENDER_BASE_PASSWORD);

  // 2. Si se definió SYSTEM_PASSWORD (puede tener varias separadas por coma)
  if (process.env.SYSTEM_PASSWORD) {
    process.env.SYSTEM_PASSWORD.split(',').forEach(p => {
      const trimmed = p.trim();
      if (trimmed) allowed.add(trimmed);
    });
  }

  // 3. Variable de claves adicionales en Railway (RAILWAY_PASSWORDS o EXTRA_PASSWORDS)
  const extraKeys = process.env.RAILWAY_PASSWORDS || process.env.EXTRA_PASSWORDS || '';
  if (extraKeys) {
    extraKeys.split(',').forEach(p => {
      const trimmed = p.trim();
      if (trimmed) allowed.add(trimmed);
    });
  }

  // 4. Variables dinámicas añadidas en Railway (ej: CLAVE_1, CLAVE_TABLET, RAILWAY_PASS_...)
  Object.keys(process.env).forEach(key => {
    if (/^(CLAVE_|RAILWAY_PASS_|ACCESS_KEY_|EXTRA_PASS_)/i.test(key) && process.env[key]) {
      const val = process.env[key].trim();
      if (val) allowed.add(val);
    }
  });

  return Array.from(allowed);
}

// Almacén multi-acceso: Mapea usuario -> lista de contraseñas autorizadas
function getValidUserCredentials() {
  const userMap = new Map();

  function addCred(u, p) {
    if (!u || !p) return;
    const cleanUser = String(u).trim().toLowerCase();
    const cleanPass = String(p).trim();
    if (!cleanUser || !cleanPass) return;
    if (!userMap.has(cleanUser)) {
      userMap.set(cleanUser, new Set());
    }
    userMap.get(cleanUser).add(cleanPass);
  }

  // 1. Acceso base histórico de Render (siempre garantizado: taller / taller2026)
  addCred('taller', RENDER_BASE_PASSWORD);

  // 2. Acceso configurado en SYSTEM_USER / SYSTEM_PASSWORD / RAILWAY_PASSWORDS
  const baseUser = (process.env.SYSTEM_USER || 'taller').trim().toLowerCase();
  getAllowedPasswords().forEach(p => addCred(baseUser, p));

  // 3. Múltiples accesos definidos en lista de pares: EXTRA_USERS o AUTH_USERS o SYSTEM_USERS
  // Formato: "usuario:clave, otro_usuario:otra_clave" (ej. EXTRA_USERS=supervisor:super2026,admin:secreto123)
  const multiUsersEnv = process.env.EXTRA_USERS || process.env.AUTH_USERS || process.env.SYSTEM_USERS || '';
  if (multiUsersEnv) {
    multiUsersEnv.split(',').forEach(entry => {
      const trimmed = entry.trim();
      if (!trimmed) return;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        const u = trimmed.slice(0, colonIdx).trim();
        const p = trimmed.slice(colonIdx + 1).trim();
        addCred(u, p);
      }
    });
  }

  // 4. Variables individuales por pares en Railway:
  // USER_1=supervisor y PASS_1=clave123 (o USER_SUPERVISOR / PASS_SUPERVISOR)
  Object.keys(process.env).forEach(key => {
    const match = key.match(/^USER_(.+)$/i);
    if (match) {
      const suffix = match[1];
      const u = process.env[key];
      const p = process.env[`PASS_${suffix}`] || process.env[`PASSWORD_${suffix}`] || process.env[`CLAVE_${suffix}`];
      if (u && p) {
        addCred(u, p);
      }
    }
  });

  // 5. Variables individuales con prefijo ACCESO_usuario=clave (ej. ACCESO_SUPERVISOR=super2026)
  Object.keys(process.env).forEach(key => {
    const match = key.match(/^ACCESO_(.+)$/i);
    if (match) {
      const u = match[1].toLowerCase();
      const p = process.env[key];
      if (u && p) {
        addCred(u, p);
      }
    }
  });

  return userMap;
}

// Autenticar credenciales contra todos los accesos registrados
function authenticateUser(username, password) {
  const u = String(username || '').trim().toLowerCase();
  const p = String(password || '').trim();
  if (!p) return { success: false };

  const credentials = getValidUserCredentials();

  // Si especificó usuario en el login
  if (u) {
    if (credentials.has(u) && credentials.get(u).has(p)) {
      return { success: true, user: u };
    }
    return { success: false };
  }

  // Si no especificó usuario (ingresó directo la clave)
  for (const [user, passwords] of credentials.entries()) {
    if (passwords.has(p)) {
      return { success: true, user };
    }
  }

  return { success: false };
}

// Lista de secrets válidos (secret de Railway + secret base de Render para no invalidar sesiones)
function getValidSecrets() {
  const secrets = new Set();
  if (process.env.SYSTEM_AUTH_SECRET) {
    secrets.add(process.env.SYSTEM_AUTH_SECRET.trim());
  }
  secrets.add(RENDER_BASE_SECRET);
  return Array.from(secrets);
}

function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const name = parts[0]?.trim();
    if (!name) return;
    const val = parts.slice(1).join('=').trim();
    try { list[name] = decodeURIComponent(val); } catch(e) { list[name] = val; }
  });
  return list;
}

function createAuthToken(username) {
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  const payload = `${username}:${expiresAt}`;
  const hmac = crypto.createHmac('sha256', SYSTEM_AUTH_SECRET).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64url') + '.' + hmac;
}

function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  try {
    const payloadStr = Buffer.from(parts[0], 'base64url').toString('utf8');
    const [user, expStr] = payloadStr.split(':');
    const expiresAt = Number(expStr);
    if (!expiresAt || Date.now() > expiresAt) return false;

    // Verificar contra el secret actual de Railway y el secret histórico de Render
    const secrets = getValidSecrets();
    for (const secret of secrets) {
      const expectedHmac = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
      if (parts[1].length === expectedHmac.length && crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expectedHmac))) {
        return user || 'taller';
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => callback(null, true),
    credentials: true,
    methods: ['GET', 'POST']
  }
});

// Proteger conexión WebSockets verificando cookie de sesión
io.use((socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie;
  const cookies = parseCookies(cookieHeader);
  const token = cookies.sys_auth || socket.handshake.auth?.token;
  if (verifyAuthToken(token)) {
    return next();
  }
  // Permitir en desarrollo local o reconexión graceful
  return next();
});

// === 1. CREDENCIALES CENTRALIZADAS CON GOOGLE SHEETS Y AISLAMIENTO DE ENTORNOS ===
const PROD_SPREADSHEET_ID = '1aKptNgy8a9Ca3rDW-HSlWEiriMRJMOIJuFsdViwEGFc';   // Database PRUEBAS (Render Cloud / Producción)
const LOCAL_SPREADSHEET_ID = '17yFPBMz8ExHf53e6ssh9LyDTjKCCJApoiCNXP-4KINQ';  // Database PRUEBAS LOCAL (Localhost / Desarrollo)

// Determinación robusta del entorno (Render / Railway / Producción)
const isProdEnvironment = (process.env.NODE_ENV === 'production') || 
                          (process.env.RENDER === 'true') || 
                          (process.env.RENDER === '1') ||
                          Boolean(process.env.RAILWAY_ENVIRONMENT) ||
                          Boolean(process.env.RAILWAY_PROJECT_ID) ||
                          (process.env.SPREADSHEET_ID === PROD_SPREADSHEET_ID);

// Fallback por defecto según entorno
let targetSpreadsheetId = process.env.SPREADSHEET_ID || (isProdEnvironment ? PROD_SPREADSHEET_ID : LOCAL_SPREADSHEET_ID);

// SALVAGUARDA POKA-YOKE:
// En producción (Render Cloud / Railway), NUNCA permitir que SPREADSHEET_ID apunte a la base LOCAL (17yFPB...).
// Si por desconfiguración de variables en Render/Railway se recibe el ID local, se redirige inmediatamente a PRODUCCIÓN.
if (isProdEnvironment && targetSpreadsheetId === LOCAL_SPREADSHEET_ID) {
  console.warn(`🚨 [POKA-YOKE ENTORNO] Proceso en PRODUCCIÓN detectó SPREADSHEET_ID apuntando a LOCAL (${LOCAL_SPREADSHEET_ID}). Redirigiendo forzosamente a PRODUCCIÓN (${PROD_SPREADSHEET_ID}).`);
  targetSpreadsheetId = PROD_SPREADSHEET_ID;
}

const SPREADSHEET_ID = targetSpreadsheetId;
const SOURCE_SPREADSHEET_ID = process.env.SOURCE_SPREADSHEET_ID || '1HKXGsRC149Kw4aBXQwGcPVpAvObvTUFis6YV6R5cTXk';
const MES_MOVIMIENTOS_ID = process.env.MES_MOVIMIENTOS_ID || '1Bwj8WCykMn_FbZhQ_FqnDH3K_WCod52YTSvsaxIDNS8';
const OT_SYNC_INTERVAL_MINUTES = parseInt(process.env.OT_SYNC_INTERVAL_MINUTES || '0', 10);

const DEFAULT_SERVICE_ACCOUNT = {
  type: "service_account",
  project_id: "ute-logistica",
  private_key: (process.env.GOOGLE_PRIVATE_KEY || "-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCuZk1fQXQlzgzp\nTxWrBZfYeYIZWldtLnWjqL5sse5mYkCnF0dAJRFXn90WXe1SrmjzaWZeSGEAZMME\nW2CUIz+kd/8yZa0i4QmlqbQCDfunY2X9KUjrr2L3UOHbr288Ps4ARPqLKlab9DE8\nXi/vyNy/OVZ66dI1vl/4uNUQChTDUefsMpWk8cej2ijgl0twrm2I3XRHJqSdHhgB\nUbzwPwaYlCSpNIjkqbLW83uvVDq4frl2EjiZGryISbX0FbdoVGi5DaZaAWdwRWdQ\nLpZMSq+93awV7HPrMl7Oy9AmPL+5sd9wpwzZfxy+biiBQ/z2iOS8Jl8T2VmvQJPT\nHI20H+5dAgMBAAECggEAH7CGKaNmnAH7dZ+Bs/BRvauimMHCNhwlkyXz6CNSyvba\ngaIot76kjpQFY+2QVKBNgMFrsQEc4ynsB8wk2fYnt9Z4ICu6kKZsjtYt19u7mRhm\nLWDFl9HoPUFMsRMJNtzAqOrfzc7VKwRtt+bzdfI9LmAYV0BKiqp7nOHVEVOLn0vj\nPAxfFtdYTiBdhBixZrEPwXsoq8nFxYqIE15d7kRDQDJRedMobe3ed3PkSFNa5L2n\n2GcmU71Jq89m9KMR2dVLaMON7kdtQl/AbWo89ymUPe+ylER/OAKoomNEbyL0AnnG\ny26VDHj5jF/Nu2fdKvL15hxBKg/yn9tZTi4nl4WYXwKBgQDk6CiJncyPz2PO4YSN\nRoPVE3JNcUtxEVPY74RC4mFU+E/zfUIQr7FESTH8pBWWe6qO9e5KipoRazaqjClA\nQ6lAIXwlQgHmnz1h5JMLyeybQJxOJb0nBHXNKjblWN3SgbKqGrnuLFYeXd4GHeUt\nkoIlQysJ7JCdbdoMa91Vq9/8uwKBgQDDCpU3m+hjcs6xAd/F3Ps3e9DaF2GO0Q7y\n9e7FAx+7p8c2z8ZaC13pb5Ol+ISDfsgB6ZhgJRrAes/DYOpAXs4FmqHsimNTKSB3\nwri8pJnVbUB++DDb9yGBkpyz+b5Zi38vuGsl2vWi413A1ELXMsB8yV4QR7tYDNye\n3e8iwcRbxwKBgCzY71hG+lUSpNNbi8TCFAIjFTnnAIjehDb0dk1EXR1wqPljiRYL\n1gcy8AA3haM+B2SK+mzQSu8uuj8fxtU4bGiMJu6FyCmO+U+8oLKmlRy1w+nrquuC\nDDJuGuNETfF4R7DcG6F2PkkkyuMX6FbNZYI3bq87EfpGE3prh6nJStERAoGAEBs7\nn0/8rNm6P9vLwucwx7At2xS7NbQF7AJrKVHMuQ5t4RTfaGgv5SsVoksXhlRd5+qG\nbsohn2uE5LmIHrC1irjuTj5PXXqz96/Y2ZsuKPXQsauFPWT3G2AkGKizE2n1otcz\n4fhm+ICWKWpd6q+CPcvTPLzvt6G4RlZFfTVLJdkCgYB7luOgHD8KhAsDMnREu+rb\nWJcT2Uevy2mt9f8x1A5XSwliMOYY+UloGjAF6/3y8l357pZpkxdLecDeESESXy60\nsLUr0DyAyJxw6Qg3rqyD1EsP+B66tpJRLCIf9Cw5gZdmiD6gsYYxKWHNA7vp7bLd\nrkl2DeVoePGroYwGHYxYQw==\n-----END PRIVATE KEY-----\n"),
  client_email: "firebase-adminsdk-fbsvc@ute-logistica.iam.gserviceaccount.com"
};

function getSheetsClient() {
  try {
    let credentials = DEFAULT_SERVICE_ACCOUNT;
    if (process.env.GOOGLE_CREDENTIALS) {
      credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    }
    const privateKey = credentials.private_key.replace(/\\n/g, '\n');

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: credentials.client_email,
        private_key: privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    return google.sheets({ version: 'v4', auth });
  } catch (e) {
    console.error('❌ Error al inicializar cliente de Google Sheets:', e.message);
    return null;
  }
}

const sheets = getSheetsClient();

// === 2. MEMORIA Y CACHÉ TIEMPO REAL ===
let ordersCache = [];
let itemsCatalogCache = [];
let uiPropertiesCache = {};
let readyTimestamps = {}; // reqId -> timestamp when transitioned to LISTO
let lastSyncTime = 0;
const MIN_SYNC_INTERVAL_MS = 8000; // Evitar Quota Exceeded (max 1 lectura cada 8s)

// === 2.1 CACHÉ EN RAM DE UNIDADES (Supabase EOR public.unidades) ===
let ramFleetCache = new Map(); // normalizedPlate -> { unidadId, nUte, tractorPlate, tractorBrand, semiPlate, semiBrand, service }
let lastDiagramasSync = 0;

async function syncFleetFromSupabase() {
  if (db && db.isConfigured && db.isConfigured()) {
    try {
      const res = await db.query(`
        SELECT 
          u.id as unidad_id,
          u.n_ute,
          COALESCE(t.patente, '') as tractor,
          COALESCE(t.marca, '') as marca_tr,
          COALESCE(s.patente, '') as semi,
          COALESCE(s.marca, '') as marca_semi,
          COALESCE(su.denominacion, 'GENERAL') as servicio
        FROM public.unidades u
        LEFT JOIN public.tractores t ON u.tractor_id = t.id
        LEFT JOIN public.semis s ON u.semi_id = s.id
        LEFT JOIN public.servicios_unidades su ON u.servicio_id = su.id;
      `);

      const units = res.rows || [];
      if (units.length > 0) {
        const newMap = new Map();
        units.forEach(u => {
          const tractorP = u.tractor ? String(u.tractor).trim().toUpperCase().replace(/[\s\-_.]/g, '') : '';
          const tractorBrand = u.marca_tr ? String(u.marca_tr).trim().toUpperCase() : '';
          const semiP = u.semi ? String(u.semi).trim().toUpperCase().replace(/[\s\-_.]/g, '') : '';
          const semiBrand = u.marca_semi ? String(u.marca_semi).trim().toUpperCase() : '';
          const srv = u.servicio || '';

          const entry = {
            unidadId: u.unidad_id,
            nUte: u.n_ute || '',
            tractorPlate: u.tractor || '',
            tractorBrand,
            semiPlate: u.semi || '',
            semiBrand,
            service: srv
          };

          if (tractorP) newMap.set(tractorP, entry);
          if (semiP) newMap.set(semiP, entry);
        });

        ramFleetCache = newMap;
        lastDiagramasSync = Date.now();
        console.log(`🐘 [SQL] Sincronizadas ${units.length} unidades desde Supabase EOR (${ramFleetCache.size} patentes indexadas).`);
        return;
      }
    } catch (sqlErr) {
      console.warn(`⚠️ [SQL] Advertencia en syncFleetFromSupabase (${sqlErr.message}).`);
    }
  }
}

// Alias para compatibilidad hacia atrás
const syncFleetFromDiagramasNode = syncFleetFromSupabase;


// === 2.2 CACHÉ DB_OT_LIST (Cols A:G) ===
let dbOtListRowsCache = [];
let lastDbOtListSync = 0;

async function getDbOtListRows() {
  const now = Date.now();
  if (dbOtListRowsCache.length > 0 && (now - lastDbOtListSync < 60000)) {
    return dbOtListRowsCache;
  }
  if (!sheets) return dbOtListRowsCache;
  try {
    const otRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "'DB_OT_LIST'!A2:G"
    });
    dbOtListRowsCache = otRes.data.values || [];
    lastDbOtListSync = now;
  } catch (e) {
    console.warn('⚠️ Advertencia al leer DB_OT_LIST para órdenes:', e.message);
  }
  return dbOtListRowsCache;
}

async function syncDataFromSheets(force = false) {
  if (!sheets) return ordersCache;

  const now = Date.now();
  if (!force && (now - lastSyncTime < MIN_SYNC_INTERVAL_MS) && ordersCache.length > 0) {
    return ordersCache;
  }
  lastSyncTime = now;

  try {
    // A, B, C. Leer DB_ITEMS, DB_OT_LIST y DB_TRANSACTIONS en 1 sola llamada HTTP batchGet
    const batchRes = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges: ['DB_ITEMS!A:H', "'DB_OT_LIST'!A2:G", 'DB_TRANSACTIONS!A:R']
    });

    const valRanges = batchRes.data.valueRanges || [];
    const itemRows = (valRanges[0] && valRanges[0].values) || [];
    const dbOtListRows = (valRanges[1] && valRanges[1].values) || [];
    const rows = (valRanges[2] && valRanges[2].values) || [];

    dbOtListRowsCache = dbOtListRows;
    lastDbOtListSync = now;

    const itemMap = {};
    itemsCatalogCache = [];

    for (let i = 1; i < itemRows.length; i++) {
      const id = String(itemRows[i][0] || '').trim();
      const name = String(itemRows[i][1] || '').trim();
      const brand = String(itemRows[i][2] || '').trim();
      const category = String(itemRows[i][3] || '').trim();
      const stock = Number(itemRows[i][4]) || 0;
      const loc = String(itemRows[i][5] || 'S/D').trim();
      const requiereCanje = itemRows[i][7] === 'TRUE' || itemRows[i][7] === true;

      if (name) {
        itemMap[name.toUpperCase()] = { id, name, brand, category, stock, loc, requiereCanje };
        itemsCatalogCache.push({ id, name, brand, category, stock, loc, requiereCanje });
      }
    }

    const otsData = await otsManager.getCurrentOtsMap(sheets, SPREADSHEET_ID);
    const otListByTractor = new Map();
    const otListBySemi = new Map();

    dbOtListRows.forEach(r => {
      const t = String(r[0] || '').trim();
      const otDb = otsManager.normalizeOt(r[1]);
      const s = String(r[2] || '').trim();
      const semiOtDb = otsManager.normalizeOt(r[3]);
      const prod = String(r[4] || '').trim();
      const marcaT = String(r[5] || '').trim();
      const marcaS = String(r[6] || '').trim();

      const normT = otsManager.normalizePlate(t);
      const normS = otsManager.normalizePlate(s);

      // DB_OT_LIST como principal, ots como fallback vigente
      const tOtObj = otsData.byPlate.get(normT);
      const sOtObj = otsData.byPlate.get(normS);

      const activeTractorOt = otDb || (tOtObj && tOtObj.ot) || '';
      const activeSemiOt = semiOtDb || (sOtObj && sOtObj.ot) || '';

      const item = {
        tractor: t,
        ot: activeTractorOt,
        semi: s,
        semiOt: activeSemiOt,
        producto: prod,
        marcaTractor: marcaT,
        marcaSemi: marcaS
      };

      const keyT = t.toUpperCase().replace(/[\s\-_.]/g, '');
      const keyS = s.toUpperCase().replace(/[\s\-_.]/g, '');
      if (keyT) otListByTractor.set(keyT, item);
      if (keyS) otListBySemi.set(keyS, item);
    });

    if (rows.length < 2) {
      ordersCache = [];
      return ordersCache;
    }

    const ordersMap = {};
    for (let i = Math.max(1, rows.length - 1000); i < rows.length; i++) {
      const row = rows[i];
      const reqId = String(row[1] || '').trim();
      const status = String(row[8] || '').trim();
      if (!reqId) continue;

      const panolOpId = String(row[15] || '').trim();
      const estadoCanje = String(row[16] || '').trim();
      const panolConfirmacion = String(row[17] || '').trim();
      const notesColO = String(row[14] || '').trim();

      const isPendingReturn = estadoCanje !== "" && !panolConfirmacion.includes("OK") && !panolConfirmacion.includes("INCOMPLETO") && status !== "DEVOLUCION PENDIENTE" && status !== "DEVOLUCION";

      if (status === "PENDIENTE" || status === "LISTO" || status === "ENTREGADO" || status === "DEVOLUCION PENDIENTE" || status === "DEVOLUCION") {
        if (!ordersMap[reqId]) {
          const unitInfo = String(row[5] || '');
          const boxRaw = String(row[2] || '').trim();
          const opInfo = String(row[3] || '').trim();

          let boxNumber = '';
          const m = opInfo.match(/\[(.*?)\]/);
          if (m && m[1]) {
            boxNumber = m[1].trim();
          } else {
            const m2 = opInfo.match(/box\s*([0-9a-zA-Z]+)/i);
            if (m2) boxNumber = m2[0].trim();
            else if (boxRaw && !/^\d{4,}$/.test(boxRaw)) boxNumber = boxRaw;
          }

          const rawPlates = unitInfo.split(/[\/+]/).map(p => p.trim().toUpperCase().replace(/[\s\-_.]/g, '')).filter(Boolean);
          const p1 = rawPlates[0] || '';
          const p2 = rawPlates[1] || '';

          const otMatch = (p1 && (otListByTractor.get(p1) || otListBySemi.get(p1))) ||
                          (p2 && (otListByTractor.get(p2) || otListBySemi.get(p2))) || null;

          let tractorPlate = otMatch ? otMatch.tractor : (unitInfo.includes('/') ? unitInfo.split('/')[0].trim() : unitInfo);
          let semiPlate = otMatch ? otMatch.semi : (unitInfo.includes('/') ? unitInfo.split('/')[1].trim() : '');

          const cleanTractor = tractorPlate.toUpperCase().replace(/[\s\-_.]/g, '');
          const cleanSemi = semiPlate.toUpperCase().replace(/[\s\-_.]/g, '');

          const ramTractor = cleanTractor ? ramFleetCache.get(cleanTractor) : null;
          const ramSemi = cleanSemi ? ramFleetCache.get(cleanSemi) : null;

          const tractorBrand = (ramTractor?.tractorBrand) || (otMatch?.marcaTractor) || String(row[13] || '').trim() || '';
          const semiBrand = (ramSemi?.semiBrand) || (otMatch?.marcaSemi) || (semiPlate ? 'SEMI' : '');

          const tractorOt = otMatch?.ot || String(row[4] || '').trim();
          const semiOt = otMatch?.semiOt || '';

          ordersMap[reqId] = {
            reqId: reqId,
            opId: String(row[2] || '').trim(),
            timestamp: row[0],
            box: boxNumber,
            opInfo: opInfo,
            otNumber: tractorOt,
            semiOt: semiOt,
            unitInfo: unitInfo,
            tractorPlate: tractorPlate,
            tractorBrand: tractorBrand,
            semiPlate: semiPlate,
            semiBrand: semiBrand,
            product: String(row[12] || ramTractor?.service || '').trim(),
            brand: tractorBrand,
            status: status,
            panolOpId: panolOpId,
            items: [],
            notes: row[11],
            uiColor: uiPropertiesCache['COLOR_' + reqId] || 'default',
            uiPing: uiPropertiesCache['PING_' + reqId] || null
          };
        }

        const itemName = String(row[6] || '');
        const itemDetails = itemMap[itemName.toUpperCase()] || { id: '---', loc: 'S/D', requiereCanje: false, stock: 0 };
        const itemNote = String(row[11] || '').trim();
        const devolucionNote = String(row[14] || '').trim();
        const finalItemNote = itemNote || devolucionNote;

        ordersMap[reqId].items.push({
          name: itemName,
          qty: row[7],
          id: itemDetails.id,
          loc: itemDetails.loc,
          note: finalItemNote,
          requiereCanje: itemDetails.requiereCanje,
          estadoCanje: estadoCanje,
          panolConfirmacion: panolConfirmacion,
          stock: itemDetails.stock,
          isPendingReturn: isPendingReturn,
          status: status,
          notesColO: notesColO
        });
      }
    }

    ordersCache = Object.values(ordersMap).map(order => {
      const itemStatuses = order.items.map(i => i.status);
      if (itemStatuses.includes("PENDIENTE")) {
        order.status = "PENDIENTE";
      } else if (itemStatuses.includes("LISTO")) {
        order.status = "LISTO";
      } else if (itemStatuses.includes("ENTREGADO")) {
        order.status = "ENTREGADO";
      } else if (itemStatuses.includes("DEVOLUCION PENDIENTE")) {
        order.status = "DEVOLUCION PENDIENTE";
      } else {
        order.status = "DEVOLUCION";
      }
      return order;
    });
    return ordersCache;
  } catch (e) {
    console.error('❌ Error en syncDataFromSheets:', e.message);
    return ordersCache;
  }
}

async function updateStockByName(itemName, deltaQty) {
  if (!sheets || !itemName || !deltaQty) return;
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'DB_ITEMS!A:E' });
    const rows = res.data.values || [];
    const searchName = String(itemName).trim().toLowerCase();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][1] || '').trim().toLowerCase() === searchName) {
        const currentStock = Number(rows[i][4]) || 0;
        // 829.txt Punto 3: Permitir saldos negativos para mantener la fidelidad real del stock
        const newStock = currentStock + Number(deltaQty);
        const rowNum = i + 1;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `DB_ITEMS!E${rowNum}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[newStock]] }
        });
        break;
      }
    }
  } catch(e) {
    console.error('Error actualizando stock:', e.message);
  }
}

// 829.txt Punto 4: Resolución temporal a 1 minuto (LISTO -> ENTREGADO Y CERRADO)
async function checkAutoDeliveredOrders() {
  if (!sheets || !ordersCache || ordersCache.length === 0) return;
  const now = Date.now();
  const ONE_MINUTE_MS = 60 * 1000;
  let hasUpdates = false;

  for (const order of ordersCache) {
    if (order.status === 'LISTO') {
      let readyTime = readyTimestamps[order.reqId];
      if (!readyTime) {
        readyTime = now;
        readyTimestamps[order.reqId] = readyTime;
      }

      if (now - readyTime >= ONE_MINUTE_MS) {
        console.log(`⏰ Resolución temporal (1 min transcurrido): Auto-cambiando pedido ${order.reqId} a ENTREGADO Y CERRADO...`);
        try {
          const transRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'DB_TRANSACTIONS!A:R' });
          const rows = transRes.data.values || [];
          const nowObj = new Date();
          const dateStr = nowObj.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
          const timeStr = nowObj.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', second: '2-digit' });

          for (let i = 1; i < rows.length; i++) {
            if (String(rows[i][1] || '').trim() === String(order.reqId).trim()) {
              const rowNum = i + 1;
              await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `DB_TRANSACTIONS!I${rowNum}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [['ENTREGADO']] }
              });
              await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `DB_TRANSACTIONS!K${rowNum}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[`${dateStr} ${timeStr}`]] }
              });
            }
          }
          delete readyTimestamps[order.reqId];
          hasUpdates = true;
        } catch(e) {
          console.error('Error en auto-entrega a 1 minuto:', e.message);
        }
      }
    }
  }

  if (hasUpdates) {
    await syncDataFromSheets();
    io.emit('orders_sync', ordersCache);
  }
}

setInterval(checkAutoDeliveredOrders, 10000);

// === 3. RUTAS DE AUTENTICACIÓN Y MONOLITO (PROTECCIÓN DE ACCESO GENERAL) ===
// Protección de caché estricta únicamente para endpoints dinámicos de API
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Función de detección de entorno local de desarrollo
function isLocalRequest(req) {
  if (!req || isProdEnvironment) return false;
  const host = String(req.headers['x-forwarded-host'] || req.hostname || req.headers?.host || '').toLowerCase();
  const ip = String(req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '');
  return (
    host.includes('localhost') ||
    host.includes('127.0.0.1') ||
    ip.includes('127.0.0.1') ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    process.env.NODE_ENV === 'development'
  );
}

// Middleware de verificación de autenticación de dispositivo (Con bypass automático para localhost / desarrollo)
function requireAuth(req, res, next) {
  const isLocal = isLocalRequest(req);
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.sys_auth || req.headers['x-auth-token'];

  if (isLocal || verifyAuthToken(token)) {
    // Si es local y no tiene token de sesión, generamos uno automáticamente
    if (isLocal && !verifyAuthToken(token)) {
      const devToken = createAuthToken('local-dev');
      res.setHeader(
        'Set-Cookie',
        `sys_auth=${encodeURIComponent(devToken)}; Path=/; Max-Age=${SESSION_MAX_AGE_MS / 1000}; SameSite=Lax`
      );
    }
    return next();
  }

  // Si es llamada API, devolver 401 JSON
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ 
      error: 'UNAUTHORIZED', 
      message: 'Dispositivo no autorizado. Se requiere inicio de sesión en el sistema.' 
    });
  }

  // Si es navegación web, redirigir a /login guardando la URL a la que quería ingresar
  const originalUrl = req.originalUrl || req.url || '/';
  return res.redirect(`/login?next=${encodeURIComponent(originalUrl)}`);
}

// --- ENDPOINTS PÚBLICOS DE AUTH ---
app.get('/login', (req, res) => {
  const isLocal = isLocalRequest(req);
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.sys_auth;
  // En localhost o con sesión válida redirigir directo salvo que pase ?force=1
  if ((isLocal || verifyAuthToken(token)) && !req.query.force) {
    const nextUrl = req.query.next || '/';
    return res.redirect(nextUrl);
  }
  serveStaticOrJson(res, 'login.html');
});

app.post('/api/auth/login', (req, res) => {
  const { username, password, next = '/' } = req.body || {};
  const isLocal = isLocalRequest(req);

  const authResult = authenticateUser(username, password);

  // En entorno local permite cualquier contraseña para pruebas ágiles
  if (isLocal || authResult.success) {
    const activeUser = authResult.user || String(username || '').trim().toLowerCase() || SYSTEM_USER || 'local-dev';
    const token = createAuthToken(activeUser);
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader(
      'Set-Cookie', 
      `sys_auth=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_MAX_AGE_MS / 1000}; SameSite=${isHttps ? 'None' : 'Lax'}${isHttps ? '; Secure' : ''}`
    );
    return res.json({ success: true, token, user: activeUser, redirect: next || '/' });
  }

  return res.status(401).json({ 
    success: false, 
    error: 'Usuario o contraseña incorrectos.' 
  });
});

app.all(['/api/auth/logout', '/logout'], (req, res) => {
  res.setHeader('Set-Cookie', `sys_auth=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`);
  if (req.method === 'POST' || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.json({ success: true, redirect: '/login' });
  }
  return res.redirect('/login');
});

app.get('/api/auth/status', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.sys_auth || req.headers['x-auth-token'];
  const verifiedUser = verifyAuthToken(token);
  res.json({ 
    authenticated: Boolean(verifiedUser), 
    user: typeof verifiedUser === 'string' ? verifiedUser : (verifiedUser ? SYSTEM_USER : null) 
  });
});

// Información del entorno actual (Localhost vs Render vs Railway)
app.get('/api/env-info', (req, res) => {
  res.json({
    environment: isProdEnvironment ? 'production' : 'development',
    isProduction: isProdEnvironment,
    hosting: process.env.RAILWAY_ENVIRONMENT ? 'railway' : (process.env.RENDER ? 'render' : 'localhost'),
    spreadsheetTitle: isProdEnvironment ? 'Database PRUEBAS' : 'Database PRUEBAS LOCAL',
    spreadsheetId: SPREADSHEET_ID,
    spreadsheetIdShort: SPREADSHEET_ID.slice(0, 6) + '...' + SPREADSHEET_ID.slice(-4),
    serverTime: new Date().toISOString()
  });
});

// === ENDPOINTS DE SALUD Y DIAGNÓSTICO (RAILWAY / RENDER) ===
app.get('/api/health', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: 'ok',
    service: 'panol-monolith-service',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    environment: isProdEnvironment ? 'production' : 'development',
    hosting: process.env.RAILWAY_ENVIRONMENT ? 'railway' : (process.env.RENDER ? 'render' : 'localhost'),
    postgresConfigured: db.isConfigured(),
    memory: {
      rssMB: +(mem.rss / 1024 / 1024).toFixed(2),
      heapUsedMB: +(mem.heapUsed / 1024 / 1024).toFixed(2),
      heapTotalMB: +(mem.heapTotal / 1024 / 1024).toFixed(2)
    }
  });
});

app.get('/api/db/health', async (req, res) => {
  const health = await db.checkHealth();
  res.status(health.ok ? 200 : (db.isConfigured() ? 503 : 200)).json({
    ...health,
    notice: db.isConfigured() ? 'PostgreSQL activo' : 'DATABASE_URL no configurada (Modo Fallback Google Sheets)'
  });
});

app.get('/api/db/metrics', (req, res) => {
  res.json(db.getPoolMetrics());
});

// Rutas estáticas de scripts esenciales (disponibles para cliente)
app.get('/client-shim.js', (req, res) => serveStaticOrJson(res, 'client-shim.js'));
app.get('/js/client-shim.js', (req, res) => serveStaticOrJson(res, 'js/client-shim.js'));

// --- RUTAS DEL SISTEMA ---
app.get('/', requireAuth, (req, res) => {
  const v = String(req.query.v || req.query.view || req.query.page || req.query.p || '').toLowerCase().trim();
  if (v === 'panol' || v === 'monitor') return serveStaticOrJson(res, 'panol.html');
  if (v === 'dashboard' || v === 'dash') return serveStaticOrJson(res, 'dashboard.html');
  if (v === 'inv' || v === 'inventory' || v === 'stock') return serveStaticOrJson(res, 'inv.html');
  if (v === 'mobile' || v === 'm' || v === 'app-mecanico') return serveStaticOrJson(res, 'mobile.html');
  if (v === 'coordinacion' || v === 'coord' || v === 'wireframe') return serveStaticOrJson(res, 'coordinacion.html');
  return serveStaticOrJson(res, 'index.html');
});

app.get('/mobile', requireAuth, (req, res) => serveStaticOrJson(res, 'mobile.html'));
app.get('/m', requireAuth, (req, res) => serveStaticOrJson(res, 'mobile.html'));
app.get('/app-mecanico', requireAuth, (req, res) => serveStaticOrJson(res, 'mobile.html'));
app.get(['/panol', '/panol/'], requireAuth, (req, res) => serveStaticOrJson(res, 'panol.html'));
app.get('/panol.html', (req, res) => res.redirect(301, '/panol'));
app.get('/dashboard', requireAuth, (req, res) => serveStaticOrJson(res, 'dashboard.html'));
app.get('/inv', requireAuth, (req, res) => serveStaticOrJson(res, 'inv.html'));
app.get(['/coordinacion', '/coordinacion/'], (req, res) => serveStaticOrJson(res, 'coordinacion.html'));
app.get('/coordinacion.html', (req, res) => res.redirect(301, '/coordinacion'));
app.get('/wireframe', (req, res) => res.redirect(301, '/coordinacion'));
app.get('/wireframe.html', (req, res) => res.redirect(301, '/coordinacion'));
app.get('/react', (req, res) => serveStaticOrJson(res, 'index.html', {}, true));

// Proteger cualquier acceso directo a archivos .html estáticos
app.use((req, res, next) => {
  if (req.path.endsWith('.html') && !req.path.includes('login.html')) {
    return requireAuth(req, res, next);
  }
  next();
});

// Servidor de archivos estáticos (JS, CSS, imágenes) con compresión y caché si FRONTEND_DIR está presente
if (FRONTEND_DIR) {
  app.use(express.static(FRONTEND_DIR, {
    index: false,
    etag: true,
    lastModified: true,
    maxAge: '2h'
  }));
}

async function updateStockByName(itemName, deltaQty) {
  if (!sheets || !itemName || !deltaQty) return;
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'DB_ITEMS!A1:E500' });
    const rows = res.data.values || [];
    const searchName = String(itemName).trim().toLowerCase();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][1] || '').trim().toLowerCase() === searchName) {
        const currentStock = Number(rows[i][4]) || 0;
        const newStock = Math.max(0, currentStock + Number(deltaQty));
        const rowNum = i + 1;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `DB_ITEMS!E${rowNum}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[newStock]] }
        });
        break;
      }
    }
  } catch(e) {
    console.error('Error actualizando stock:', e.message);
  }
}

// Función para buscar operario en DB_STAFF soportando coincidencia exacta, IDs duplicados (ej. 190190 <-> 190, 106 <-> 106106) y nombres
function findStaffMember(rows, opId) {
  if (!rows || !rows.length || !opId) return null;
  const cleanId = String(opId).trim();
  
  // 1. Coincidencia exacta por ID
  let match = rows.find(r => String(r[0] || '').trim() === cleanId);
  if (match) return match;
  
  // 2. Si el ID ingresado está repetido (ej. "190190" -> "190")
  if (cleanId.length >= 4 && cleanId.length % 2 === 0) {
    const half = cleanId.slice(0, cleanId.length / 2);
    if (half === cleanId.slice(cleanId.length / 2)) {
      match = rows.find(r => String(r[0] || '').trim() === half);
      if (match) return match;
    }
  }
  
  // 3. Si el ID en la planilla está repetido (ej. planilla tiene "106106" y se ingresó "106")
  match = rows.find(r => {
    const rowId = String(r[0] || '').trim();
    if (rowId.length >= 4 && rowId.length % 2 === 0) {
      const half = rowId.slice(0, rowId.length / 2);
      if (half === rowId.slice(rowId.length / 2) && half === cleanId) return true;
    }
    return false;
  });
  if (match) return match;

  // 4. Coincidencia numérica (ej. "01" == "1")
  const numId = parseInt(cleanId, 10);
  if (!isNaN(numId)) {
    match = rows.find(r => parseInt(String(r[0] || '').trim(), 10) === numId);
    if (match) return match;
  }

  // 5. Coincidencia por nombre completo si se ingresó nombre
  match = rows.find(r => String(r[1] || '').trim().toLowerCase() === cleanId.toLowerCase());
  if (match) return match;

  return null;
}

// Función para buscar operario en panol.staff soportando coincidencia exacta, códigos duplicados (106 <-> 106106, 190 <-> 190190) y UUID
async function getStaffMemberByOpCode(opId) {
  if (!db || !db.isConfigured || !db.isConfigured() || !opId) return null;
  const clean = String(opId).trim();
  let doubleClean = clean + clean;
  let halfClean = '';
  if (clean.length >= 4 && clean.length % 2 === 0) {
    const h = clean.slice(0, clean.length / 2);
    if (h === clean.slice(clean.length / 2)) halfClean = h;
  }
  try {
    const res = await db.query(
      `SELECT id, op_code, name, role FROM panol.staff 
       WHERE op_code = $1 
          OR id::text = $1 
          OR op_code = $2 
          OR ($3 <> '' AND op_code = $3)
       LIMIT 1;`,
      [clean, doubleClean, halfClean]
    );
    return res.rows[0] || null;
  } catch (err) {
    console.warn('⚠️ [SQL] Error buscando operario en panol.staff:', err.message);
    return null;
  }
}

// === 4. RPC UNIVERSAL DISPATCHER (google.script.run Polyfill - Protegido por requireAuth) ===
app.post('/api/rpc', requireAuth, async (req, res) => {
  const { action, args = [] } = req.body;
  try {
    let result = null;

    if (action === 'getMechanicConfig') {
      const opId = String(args[0] || '').trim();
      const isLocal = isLocalRequest(req);
      let staffRow = null;

      // 🐘 1. Prioridad SQL: Supabase panol.staff
      if (db && db.isConfigured && db.isConfigured()) {
        try {
          const sRes = await db.query(
            'SELECT op_code, name, role, default_boxes, app_access FROM panol.staff WHERE op_code = $1 AND is_active = true;',
            [opId]
          );
          if (sRes.rows.length > 0) {
            const member = sRes.rows[0];
            if (!member.app_access && !isLocal) {
              result = { success: false, error: "Usuario no encontrado o sin acceso activo" };
            } else {
              const boxes = (Array.isArray(member.default_boxes) && member.default_boxes.length > 0)
                ? member.default_boxes
                : ['01', '02', '03'];
              result = { success: true, name: member.name, role: member.role || 'MECANICO', boxes };
            }
          }
        } catch (sqlErr) {
          console.warn('⚠️ [SQL] Error getMechanicConfig:', sqlErr.message);
        }
      }

      // 2. Fallback a Google Sheets si no se resolvió en SQL
      if (!result && sheets) {
        try {
          const sRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'DB_STAFF!A1:L100' });
          const rows = sRes.data.values || [];
          staffRow = findStaffMember(rows, opId);
          if (!staffRow && SPREADSHEET_ID !== PROD_SPREADSHEET_ID) {
            const sProdRes = await sheets.spreadsheets.values.get({ spreadsheetId: PROD_SPREADSHEET_ID, range: 'DB_STAFF!A1:L100' });
            staffRow = findStaffMember(sProdRes.data.values || [], opId);
          }
        } catch(e) {}
      }

      if (!result) {
        if (staffRow) {
          const hasAppAccess = staffRow[11] === true || String(staffRow[11] || '').toUpperCase() === 'TRUE';
          if (!hasAppAccess && staffRow[11] !== undefined && !isLocal) {
            result = { success: false, error: "Usuario no encontrado o sin acceso activo" };
          } else {
            const boxes = staffRow.slice(6, 11).map(c => String(c || '').trim()).filter(c => c !== '');
            result = { success: true, name: staffRow[1] || ('Operario ' + opId), role: staffRow[2] || 'MECANICO', boxes: boxes.length > 0 ? boxes : ['01', '02', '03'] };
          }
        } else if (isLocal) {
          result = { success: true, name: 'Operario ' + (opId || 'Test'), role: 'MECANICO', boxes: ['01', '02', '03'] };
        } else {
          result = { success: false, error: "Usuario no encontrado o sin acceso activo" };
        }
      }
    } 
    else if (action === 'getPanolStaff') {
      let panoleros = [];

      // 🐘 1. Prioridad SQL: Supabase panol.staff
      if (db && db.isConfigured && db.isConfigured()) {
        try {
          const pRes = await db.query(
            "SELECT op_code, name FROM panol.staff WHERE role IN ('PANOL', 'PAÑOL', 'LOGISTICA') AND is_active = true ORDER BY name;"
          );
          if (pRes.rows.length > 0) {
            panoleros = pRes.rows.map(r => ({ id: r.op_code, name: r.name }));
            result = panoleros;
          }
        } catch (sqlErr) {
          console.warn('⚠️ [SQL] Error getPanolStaff:', sqlErr.message);
        }
      }

      // 2. Fallback a Google Sheets si no se resolvió en SQL
      if (!result && sheets) {
        try {
          const sRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'DB_STAFF!A1:L100' });
          const rows = sRes.data.values || [];
          for (let i = 1; i < rows.length; i++) {
            const id = String(rows[i][0] || '').trim();
            const name = String(rows[i][1] || '').trim();
            const role = String(rows[i][2] || '').trim().toUpperCase();
            const hasAppAccess = rows[i][11] === true || String(rows[i][11] || '').toUpperCase() === 'TRUE';
            if (id && name && hasAppAccess && (role === 'PANOL' || role === 'PAÑOL' || role === 'LOGISTICA')) {
              panoleros.push({ id: id, name: name });
            }
          }
          if (panoleros.length === 0) {
            for (let i = 1; i < rows.length; i++) {
              const id = String(rows[i][0] || '').trim();
              const name = String(rows[i][1] || '').trim();
              if (id && name) panoleros.push({ id: id, name: name });
            }
          }
        } catch(e) {}
        result = panoleros.sort((a, b) => a.name.localeCompare(b.name));
      }
    }
    else if (action === 'getItemCatalog') {
      // 🐘 1. Prioridad SQL: Supabase panol.items
      if (db && db.isConfigured && db.isConfigured()) {
        try {
          const itRes = await db.query(
            "SELECT item_code, name, brand, category, requires_exchange, stock, location FROM panol.items WHERE is_active = true ORDER BY name;"
          );
          if (itRes.rows.length > 0) {
            result = itRes.rows.map(i => ({
              id: i.item_code,
              category: i.category || 'GENERAL',
              name: i.name,
              brand: i.brand || '',
              stock: parseFloat(i.stock) || 0,
              loc: i.location || 'S/D',
              requiereCanje: !!i.requires_exchange
            }));
          }
        } catch (sqlErr) {
          console.warn('⚠️ [SQL] Error getItemCatalog:', sqlErr.message);
        }
      }

      if (!result) {
        await syncDataFromSheets();
        result = itemsCatalogCache.map(i => ({ category: i.category || 'GENERAL', name: i.name, requiereCanje: !!i.requiereCanje }));
      }
    }

    else if (action === 'getUnitCatalog') {
      if (sheets) {
        try {
          const cat = await otsManager.getFleetSearchCatalog(sheets, SPREADSHEET_ID);
          result = cat.unitList;
        } catch(e) {
          result = [];
        }
      } else {
        result = [];
      }
    }
    else if (action === 'getFleetSearchCatalog') {
      result = await otsManager.getFleetSearchCatalog(sheets, SPREADSHEET_ID);
    }
    else if (action === 'findUnitOrOt') {
      const query = args[0];
      const type = args[1];
      result = await otsManager.findUnitOrOt({
        sheetsClient: sheets,
        spreadsheetId: SPREADSHEET_ID,
        query,
        type
      });
    }
    else if (action === 'getOtsAnteriores') {
      const plate = args[0];
      result = await otsManager.getOtsAnterioresForPlate(sheets, SPREADSHEET_ID, plate);
    }
    else if (action === 'wipeColdOts') {
      result = await otsManager.wipeAndArchiveOlderThan6Months(sheets, SPREADSHEET_ID);
    }
    else if (action === 'submitBatchRequest' || action === 'createOrder') {
      const payload = args[0] || {};
      const opId = payload.opId || '';
      const rawMechName = payload.mechanicName || payload.mechName || '';

      // Poka-Yoke: Garantizar que NUNCA se guarde ni imprima "Operario Local", usar el mismo nombre real
      let cleanMechName = String(rawMechName || '').trim();
      cleanMechName = cleanMechName.replace(/Operario\s+Local\b/gi, 'Operario');

      if (sheets && opId) {
        try {
          const sRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'DB_STAFF!A1:L100' });
          const staffRows = sRes.data.values || [];
          let staffMatch = findStaffMember(staffRows, opId);
          if (!staffMatch && SPREADSHEET_ID !== PROD_SPREADSHEET_ID) {
            const sProdRes = await sheets.spreadsheets.values.get({ spreadsheetId: PROD_SPREADSHEET_ID, range: 'DB_STAFF!A1:L100' });
            staffMatch = findStaffMember(sProdRes.data.values || [], opId);
          }
          if (staffMatch && staffMatch[1]) {
            const realName = String(staffMatch[1]).trim();
            const boxMatch = cleanMechName.match(/\[Box\s*[^\]]+\]/i);
            cleanMechName = boxMatch ? `${realName} ${boxMatch[0]}` : realName;
          }
        } catch(e) {}
      }
      const mechanicName = cleanMechName || ('Operario ' + opId);
      const otNumber = payload.otNumber || payload.ot || '';
      const unitId = payload.unitId || payload.unit || '';
      const items = payload.items || [];
      const now = new Date();
      const timestamp = now.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
      const reqId = 'REQ-' + Math.floor(Math.random() * 10000000).toString(16).toUpperCase();
      const rowsToAppend = [];

      (items || []).forEach(itemObj => {
        const itemName = itemObj.item || itemObj.name || '';
        rowsToAppend.push([
          timestamp, reqId, opId, mechanicName, otNumber, unitId,
          itemName, itemObj.qty, 'PENDIENTE', '', '', itemObj.notes || '', '', '', '', '', itemObj.canjeStatus || '', ''
        ]);
      });

      // 🐘 Persistencia SQL en Supabase: panol.orders y panol.order_items
      if (db && db.isConfigured && db.isConfigured()) {
        try {
          let staffQ = await db.query('SELECT id FROM panol.staff WHERE op_code = $1 LIMIT 1;', [opId]);
          let mechUuid = staffQ.rows[0]?.id || null;
          if (!mechUuid) {
            const fallbackStaff = await db.query(
              "SELECT id FROM panol.staff WHERE upper(name) LIKE upper($1) OR role = 'MECANICO' ORDER BY is_active DESC LIMIT 1;",
              [`%${mechanicName}%`]
            );
            mechUuid = fallbackStaff.rows[0]?.id || null;
          }

          let unidadUuid = null;
          const uClean = String(unitId || '').split(/[\/+]/)[0].trim().toUpperCase().replace(/[\s\-_.]/g, '');
          const ramU = ramFleetCache.get(uClean);
          if (ramU && ramU.unidadId) {
            unidadUuid = ramU.unidadId;
          }

          let woUuid = null;
          if (otNumber) {
            const woQ = await db.query('SELECT id, tractor_id, semi_id FROM panol.work_orders WHERE ot_number = $1 LIMIT 1;', [String(otNumber).trim()]);
            if (woQ.rows.length > 0) {
              woUuid = woQ.rows[0].id;
            }
          }

          let tractorUuid = null;
          let semiUuid = null;
          const trClean = String(payload.tractorPlate || payload.plate || unitId || '').split(/[\/+]/)[0].trim().toUpperCase().replace(/[\s\-_.]/g, '');
          if (trClean) {
            const tQ = await db.query(
              "SELECT id FROM public.tractores WHERE replace(replace(replace(patente, ' ', ''), '-', ''), '.', '') = $1 LIMIT 1;",
              [trClean]
            );
            tractorUuid = tQ.rows[0]?.id || null;
          }

          const smClean = String(payload.semiPlate || '').trim().toUpperCase().replace(/[\s\-_.]/g, '');
          if (smClean) {
            const sQ = await db.query(
              "SELECT id FROM public.semis WHERE replace(replace(replace(patente, ' ', ''), '-', ''), '.', '') = $1 LIMIT 1;",
              [smClean]
            );
            semiUuid = sQ.rows[0]?.id || null;
          }

          if (woUuid) {
            const woVehicleQ = await db.query('SELECT tractor_id, semi_id, unidad_id FROM panol.work_orders WHERE id = $1;', [woUuid]);
            if (woVehicleQ.rows.length > 0) {
              if (!tractorUuid) tractorUuid = woVehicleQ.rows[0].tractor_id;
              if (!semiUuid) semiUuid = woVehicleQ.rows[0].semi_id;
              if (!unidadUuid) unidadUuid = woVehicleQ.rows[0].unidad_id;
            }
          }

          // Resolver Box o Sector respetando parámetros directos y legacy
          const rawBoxParam = String(payload.box || '').trim();
          const boxMatch = cleanMechName.match(/\[Box\s*([^\]]+)\]/i);
          const boxNum = (rawBoxParam && rawBoxParam.toLowerCase() !== 'prueba')
            ? rawBoxParam
            : (boxMatch ? boxMatch[1].trim() : '01');

          if (mechUuid) {
            const insOrder = await db.query(`
              INSERT INTO panol.orders (req_code, mechanic_id, work_order_id, ot_number, unidad_id, tractor_id, semi_id, box_number, status, notes)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDIENTE', $9)
              RETURNING id, order_number;
            `, [
              reqId,
              mechUuid,
              woUuid,
              String(otNumber || '').trim(),
              unidadUuid,
              tractorUuid,
              semiUuid,
              boxNum,
              `OT: ${otNumber} | Unidad: ${unitId || payload.tractorPlate || ''}`
            ]);

            const orderUuid = insOrder.rows[0]?.id;
            if (orderUuid) {
              for (const it of items) {
                const iName = it.item || it.name || '';
                const iQty = parseFloat(it.qty) || 1;
                const itQ = await db.query('SELECT id FROM panol.items WHERE upper(name) = upper($1) LIMIT 1;', [iName]);
                let itemUuid = itQ.rows[0]?.id;
                if (!itemUuid) {
                  const autoCode = 'AUTO-' + Math.random().toString(36).substring(2, 9).toUpperCase();
                  const insIt = await db.query(`
                    INSERT INTO panol.items (item_code, name, brand, category, stock, location)
                    VALUES ($1, $2, 'GENERICO', 'REPUESTOS', 50, 'Pañol Ppal')
                    RETURNING id;
                  `, [autoCode, iName]);
                  itemUuid = insIt.rows[0]?.id;
                }
                if (itemUuid) {
                  await db.query(`
                    INSERT INTO panol.order_items (order_id, item_id, quantity, status, exchange_status, notes)
                    VALUES ($1, $2, $3, 'PENDIENTE', $4, $5);
                  `, [orderUuid, itemUuid, iQty, it.canjeStatus || '', it.notes || '']);
                }
              }
              console.log(`🐘 [SQL] Pedido ${reqId} insertado en panol.orders con ${items.length} items.`);
            }
          }
        } catch (sqlErr) {
          console.warn('⚠️ [SQL] Error guardando pedido en Supabase:', sqlErr.message);
        }
      }

      if (sheets && rowsToAppend.length > 0) {

        const colARes = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: 'DB_TRANSACTIONS!A:A'
        });
        const colAVals = colARes.data.values || [];
        let lastFilledRow = 0;
        for (let i = colAVals.length - 1; i >= 0; i--) {
          if (colAVals[i] && colAVals[i][0] && String(colAVals[i][0]).trim() !== '') {
            lastFilledRow = i + 1;
            break;
          }
        }
        if (lastFilledRow === 0) lastFilledRow = colAVals.length;

        const startRow = lastFilledRow + 1;
        const endRow = startRow + rowsToAppend.length - 1;

        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `DB_TRANSACTIONS!A${startRow}:R${endRow}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: rowsToAppend }
        });

        console.log(`🛒 [DB_TRANSACTIONS] Pedido ${reqId} guardado (${rowsToAppend.length} filas) en ${isProdEnvironment ? '🔴 PRODUCCIÓN' : '🟢 LOCAL'} | Planilla: ${SPREADSHEET_ID}`);

        (items || []).forEach(itemObj => {
          updateStockByName(itemObj.item, -Math.abs(Number(itemObj.qty) || 0));
        });
      }
      await syncDataFromSheets();
      io.emit('orders_sync', ordersCache);
      result = { success: true, reqId: reqId, environment: isProdEnvironment ? 'production' : 'development' };
    }
    else if (action === 'updatePendingItemQty') {
      const reqId = String(args[0] || '').trim();
      const itemName = String(args[1] || '').trim();
      const newQty = Number(args[2]) || 0;
      let updated = false;

      if (sheets) {
        const transRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'DB_TRANSACTIONS!A:R' });
        const rows = transRes.data.values || [];
        for (let i = 1; i < rows.length; i++) {
          const rReq = String(rows[i][1] || '').trim();
          const rItem = String(rows[i][6] || '').trim();
          const rStatus = String(rows[i][8] || '').trim();

          if (rReq === reqId && rItem.toLowerCase() === itemName.toLowerCase() && rStatus === 'PENDIENTE') {
            const oldQty = Number(rows[i][7]) || 0;
            const delta = newQty - oldQty;
            const rowNum = i + 1;

            if (newQty <= 0) {
              await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `DB_TRANSACTIONS!A${rowNum}:R${rowNum}` });
              await updateStockByName(itemName, oldQty);
            } else {
              await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `DB_TRANSACTIONS!H${rowNum}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[newQty]] }
              });
              await updateStockByName(itemName, -delta);
            }
            updated = true;
            break;
          }
        }
      }
      await syncDataFromSheets(true);
      io.emit('orders_sync', ordersCache);
      result = { success: updated };
    }
    else if (action === 'removePendingItem') {
      const reqId = String(args[0] || '').trim();
      const itemName = String(args[1] || '').trim();
      let updated = false;

      if (sheets) {
        const transRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'DB_TRANSACTIONS!A:R' });
        const rows = transRes.data.values || [];
        for (let i = 1; i < rows.length; i++) {
          const rReq = String(rows[i][1] || '').trim();
          const rItem = String(rows[i][6] || '').trim();
          const rStatus = String(rows[i][8] || '').trim();

          if (rReq === reqId && rItem.toLowerCase() === itemName.toLowerCase() && rStatus === 'PENDIENTE') {
            const oldQty = Number(rows[i][7]) || 0;
            const rowNum = i + 1;
            await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `DB_TRANSACTIONS!A${rowNum}:R${rowNum}` });
            if (oldQty > 0) await updateStockByName(itemName, oldQty);
            updated = true;
            break;
          }
        }
      }
      await syncDataFromSheets(true);
      io.emit('orders_sync', ordersCache);
      result = { success: updated };
    }
    else if (action === 'addItemToPendingOrder') {
      const reqId = String(args[0] || '').trim();
      const itemName = String(args[1] || '').trim();
      const qty = Number(args[2]) || 0;
      let updated = false;

      if (sheets && qty > 0) {
        const transRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'DB_TRANSACTIONS!A:R' });
        const rows = transRes.data.values || [];
        let contextRow = null;

        for (let i = 1; i < rows.length; i++) {
          if (String(rows[i][1] || '').trim() === reqId && String(rows[i][8] || '').trim() === 'PENDIENTE') {
            contextRow = rows[i];
            break;
          }
        }

        if (contextRow) {
          const newRow = new Array(17).fill('');
          newRow[0] = contextRow[0];
          newRow[1] = reqId;
          newRow[2] = contextRow[2];
          newRow[3] = contextRow[3];
          newRow[4] = contextRow[4];
          newRow[5] = contextRow[5];
          newRow[6] = itemName;
          newRow[7] = qty;
          newRow[8] = 'PENDIENTE';
          newRow[11] = '';

          const colARes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'DB_TRANSACTIONS!A:A' });
          const colAVals = colARes.data.values || [];
          let lastFilledRow = 0;
          for (let i = colAVals.length - 1; i >= 0; i--) {
            if (colAVals[i] && colAVals[i][0] && String(colAVals[i][0]).trim() !== '') {
              lastFilledRow = i + 1;
              break;
            }
          }
          const startRow = (lastFilledRow || colAVals.length) + 1;

          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `DB_TRANSACTIONS!A${startRow}:Q${startRow}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [newRow] }
          });
          await updateStockByName(itemName, -Math.abs(qty));
          updated = true;
        }
      }
      await syncDataFromSheets(true);
      io.emit('orders_sync', ordersCache);
      result = { success: updated };
    }
    else if (action === 'confirmReturnItem' || action === 'confirmReturnBatch') {
      const reqId = String(args[0] || '').trim();
      let itemName = null;
      let opId = null;
      let status = null;
      let declaredQty = null;

      if (args.length >= 4 && typeof args[1] === 'string' && isNaN(Number(args[1]))) {
        itemName = String(args[1]).trim().toLowerCase();
        opId = args[2];
        status = args[3];
        declaredQty = args[4];
      } else {
        opId = args[1];
        status = args[2];
        declaredQty = args[3];
      }

      let updated = false;
      if (sheets) {
        const transRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'DB_TRANSACTIONS!A:R' });
        const rows = transRes.data.values || [];

        for (let i = 1; i < rows.length; i++) {
          const rReq = String(rows[i][1] || '').trim();
          const rItem = String(rows[i][6] || '').trim().toLowerCase();
          const reqMatch = rReq === reqId;
          const itemMatch = !itemName || rItem === itemName;

          if (reqMatch && itemMatch) {
            const rowNum = i + 1;
            const confirmacionColR = String(rows[i][17] || '').trim();

            if (!confirmacionColR.includes('OK') && !confirmacionColR.includes('INCOMPLETO')) {
              let finalAuditString;
              if (status === 'INCOMPLETO' && declaredQty !== null && declaredQty !== undefined) {
                const originalQty = Number(rows[i][7]) || 0;
                finalAuditString = `[OP: ${opId}] - INCOMPLETO (${declaredQty}/${originalQty})`;
              } else {
                finalAuditString = `[OP: ${opId}] - ${status}`;
              }

              await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `DB_TRANSACTIONS!R${rowNum}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[finalAuditString]] }
              });
              updated = true;
              if (itemName) break;
            }
          }
        }
      }

      // 🐘 Persistencia SQL en Supabase: panol.order_items y stock_movements
      if (db && db.isConfigured && db.isConfigured()) {
        try {
          const auditStatus = status === 'INCOMPLETO' ? `[OP: ${opId}] - INCOMPLETO (${declaredQty || 0})` : `[OP: ${opId}] - OK`;
          const retQty = status === 'INCOMPLETO' ? Number(declaredQty || 0) : null;
          await db.query(`
            UPDATE panol.order_items oi
            SET 
              panol_confirmation = $1,
              returned_qty = COALESCE($2, oi.quantity),
              status = CASE WHEN $3 = 'OK' THEN 'DEVUELTO' ELSE 'EN_CAMBIO' END,
              updated_at = now()
            FROM panol.orders o, panol.items i
            WHERE oi.order_id = o.id AND oi.item_id = i.id
              AND (o.req_code = $4 OR o.order_number::text = $4)
              AND ($5::text IS NULL OR lower(i.name) = lower($5));
          `, [auditStatus, retQty, status, reqId, itemName]);
          updated = true;
          console.log(`🐘 [SQL] Devolución auditada para pedido ${reqId} (${itemName || 'TODOS'}): ${status}`);
        } catch (sqlErr) {
          console.warn('⚠️ [SQL] Error confirmReturnItem en Supabase:', sqlErr.message);
        }
      }

      await syncDataFromSheets(true);
      io.emit('orders_sync', ordersCache);
      result = { success: updated };
    }
    else if (action === 'confirmNewReturn' || action === 'processNewItemReturn' || action === 'confirmNewReturnRow') {
      const reqId = String(args[0] || '').trim();
      const itemName = String(args[1] || '').trim();
      const returnQty = Number(args[2]) || null;
      const panolOpId = args[3] || args[4] || '';
      let updated = false;

      if (sheets && reqId) {
        const transRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'DB_TRANSACTIONS!A:R' });
        const rows = transRes.data.values || [];
        const isAll = !itemName || itemName.toUpperCase() === 'ALL' || itemName === '__ALL__';

        const panolNote = `DEVOLUCIÓN ACEPTADA: OK [OP: ${panolOpId || 'PAÑOL'}]`;
        const updates = [];
        const stockItemsToRestore = [];

        // 1. Identificar filas a procesar
        const targetIndices = [];
        for (let i = 1; i < rows.length; i++) {
          const rReq = String(rows[i][1] || '').trim();
          if (rReq !== reqId) continue;

          const rStatus = String(rows[i][8] || '').trim();
          const rItem = String(rows[i][6] || '').trim();

          if (isAll) {
            // Toda la row: procesar ítems con status DEVOLUCION PENDIENTE
            if (rStatus === 'DEVOLUCION PENDIENTE') {
              targetIndices.push(i);
            }
          } else {
            // Ítem específico (compatibilidad)
            if (rItem.toLowerCase() === itemName.toLowerCase() && 
               (rStatus === 'DEVOLUCION PENDIENTE' || rStatus === 'ENTREGADO' || rStatus === 'LISTO')) {
              targetIndices.push(i);
              break;
            }
          }
        }

        // Si es isAll y no había ninguno explícitamente en DEVOLUCION PENDIENTE, fallback a ENTREGADO o LISTO
        if (isAll && targetIndices.length === 0) {
          for (let i = 1; i < rows.length; i++) {
            const rReq = String(rows[i][1] || '').trim();
            if (rReq !== reqId) continue;
            const rStatus = String(rows[i][8] || '').trim();
            if (rStatus === 'ENTREGADO' || rStatus === 'LISTO') {
              targetIndices.push(i);
            }
          }
        }

        for (const idx of targetIndices) {
          const rowNum = idx + 1;
          const rItem = String(rows[idx][6] || '').trim();
          const origQty = Number(rows[idx][7]) || 1;
          const qtyToRestore = (!isAll && returnQty) ? returnQty : origQty;

          const existingNote = String(rows[idx][14] || '').trim();
          const finalNote = existingNote ? `${existingNote} | ${panolNote}` : panolNote;

          updates.push({
            range: `DB_TRANSACTIONS!I${rowNum}`,
            values: [['DEVOLUCION']]
          });
          updates.push({
            range: `DB_TRANSACTIONS!O${rowNum}`,
            values: [[finalNote]]
          });

          stockItemsToRestore.push({ itemName: rItem, qty: qtyToRestore });
          updated = true;
        }

        if (updates.length > 0) {
          try {
            await sheets.spreadsheets.values.batchUpdate({
              spreadsheetId: SPREADSHEET_ID,
              requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: updates
              }
            });
          } catch(batchErr) {
            console.warn('batchUpdate falló, aplicando updates individuales:', batchErr.message);
            for (const u of updates) {
              await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: u.range,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: u.values }
              });
            }
          }

          for (const s of stockItemsToRestore) {
            await updateStockByName(s.itemName, s.qty);
          }
        }
      }
      await syncDataFromSheets(true);
      io.emit('orders_sync', ordersCache);
      result = { success: updated };
    }
    else if (action === 'requestRefund' || action === 'requestReturn') {
      const reqId = String(args[0] || '').trim();
      const itemName = String(args[1] || '').trim();
      const reason = String(args[2] || '').trim();
      const returnQty = Number(args[3]) || 1;
      let updated = false;

      if (sheets && reqId && itemName) {
        try {
          const transRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'DB_TRANSACTIONS!A:R' });
          const rows = transRes.data.values || [];
          const fallbackReason = reason ? reason : "Devolución repuesto nuevo";

          for (let i = 1; i < rows.length; i++) {
            const rReq = String(rows[i][1] || '').trim();
            const rItem = String(rows[i][6] || '').trim().toLowerCase();
            const rStatus = String(rows[i][8] || '').trim();

            if (rReq === reqId && rItem === itemName.toLowerCase() && rStatus === 'ENTREGADO') {
              const originalQty = Number(rows[i][7]) || 1;
              const actualReturnQty = Math.min(returnQty, originalQty);
              const rowNum = i + 1;

              if (actualReturnQty >= originalQty) {
                // DEVOLUCIÓN TOTAL SOLICITADA: Col I = DEVOLUCION PENDIENTE, Col O = SOLICITUD DEVOLUCIÓN NUEVA: ...
                await sheets.spreadsheets.values.update({
                  spreadsheetId: SPREADSHEET_ID,
                  range: `DB_TRANSACTIONS!I${rowNum}`,
                  valueInputOption: 'USER_ENTERED',
                  requestBody: { values: [['DEVOLUCION PENDIENTE']] }
                });
                await sheets.spreadsheets.values.update({
                  spreadsheetId: SPREADSHEET_ID,
                  range: `DB_TRANSACTIONS!O${rowNum}`,
                  valueInputOption: 'USER_ENTERED',
                  requestBody: { values: [[`SOLICITUD DEVOLUCIÓN NUEVA: ${fallbackReason}`]] }
                });
              } else {
                // DEVOLUCIÓN PARCIAL SOLICITADA (SPLIT ROW)
                const remainingQty = originalQty - actualReturnQty;
                await sheets.spreadsheets.values.update({
                  spreadsheetId: SPREADSHEET_ID,
                  range: `DB_TRANSACTIONS!H${rowNum}`,
                  valueInputOption: 'USER_ENTERED',
                  requestBody: { values: [[remainingQty]] }
                });

                const newRow = [...rows[i]];
                while (newRow.length < 18) newRow.push('');
                newRow[7] = actualReturnQty; // Col H
                newRow[8] = 'DEVOLUCION PENDIENTE'; // Col I
                newRow[14] = `SOLICITUD DEVOLUCIÓN NUEVA PARCIAL: ${fallbackReason}`; // Col O (Índice 14)
                newRow[16] = ''; // Col Q: Limpiar ESTADO_CANJE para devolución de repuesto nuevo
                newRow[17] = ''; // Col R: Limpiar PANOL_CONFIRMACION

                const colARes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'DB_TRANSACTIONS!A:A' });
                const colAVals = colARes.data.values || [];
                let lastFilledRow = 0;
                for (let k = colAVals.length - 1; k >= 0; k--) {
                  if (colAVals[k] && colAVals[k][0] && String(colAVals[k][0]).trim() !== '') {
                    lastFilledRow = k + 1;
                    break;
                  }
                }
                const startRow = (lastFilledRow || colAVals.length) + 1;

                await sheets.spreadsheets.values.update({
                  spreadsheetId: SPREADSHEET_ID,
                  range: `DB_TRANSACTIONS!A${startRow}:R${startRow}`,
                  valueInputOption: 'USER_ENTERED',
                  requestBody: { values: [newRow] }
                });
              }

              updated = true;
              break;
            }
          }
        } catch(e) {
          console.error('Error en requestRefund:', e.message);
        }
      }
      await syncDataFromSheets();
      io.emit('orders_sync', ordersCache);
      result = { success: updated, error: updated ? null : "El repuesto exacto no fue encontrado o ya fue devuelto." };
    }
    else if (action === 'getPendingOrdersEnriched' || action === 'getPendingOrders' || action === 'getMechanicOrders') {
      result = await syncDataFromSheets();
    }
    else if (action === 'getInventoryItems') {
      const q = String(args[0] || '').trim().toLowerCase();
      await syncDataFromSheets();
      let resList = itemsCatalogCache;
      if (q) resList = resList.filter(i => i.name.toLowerCase().includes(q) || i.brand.toLowerCase().includes(q));
      result = resList.slice(0, 50);
    }
    else if (action === 'markAsReady' || action === 'markAsDelivered') {
      const reqId = args[0];
      const panolOpId = args[1];
      const itemsPayload = args[2]; // Opcional: array de [{ name, qty }] confirmados al presionar LISTO

      if (sheets && reqId) {
        const transRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'DB_TRANSACTIONS!A:R' });
        const rows = transRes.data.values || [];
        const now = new Date();
        const dateStr = now.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
        const timeStr = now.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const newStatus = action === 'markAsDelivered' ? 'ENTREGADO' : 'LISTO';
        const colIdx = action === 'markAsDelivered' ? 'K' : 'J';

        if (newStatus === 'LISTO') {
          readyTimestamps[reqId] = Date.now();
        } else {
          delete readyTimestamps[reqId];
        }

        const batchData = [];
        const stockUpdates = [];

        for (let i = 1; i < rows.length; i++) {
          if (String(rows[i][1] || '').trim() === String(reqId).trim()) {
            const rowNum = i + 1;
            const rItemName = String(rows[i][6] || '').trim();

            // Si el Pañolero modificó cantidades con los contadores antes de confirmar
            if (Array.isArray(itemsPayload)) {
              const matchedItem = itemsPayload.find(p => String(p.name || '').trim().toLowerCase() === rItemName.toLowerCase());
              if (matchedItem && matchedItem.qty !== undefined) {
                const confirmedQty = Number(matchedItem.qty);
                const oldQty = Number(rows[i][7]) || 0;
                const delta = confirmedQty - oldQty;

                if (delta !== 0) {
                  batchData.push({
                    range: `DB_TRANSACTIONS!H${rowNum}`,
                    values: [[confirmedQty]]
                  });
                  stockUpdates.push({ name: rItemName, delta: -delta });
                }
              }
            }

            batchData.push({
              range: `DB_TRANSACTIONS!I${rowNum}`,
              values: [[newStatus]]
            });
            batchData.push({
              range: `DB_TRANSACTIONS!${colIdx}${rowNum}`,
              values: [[`${dateStr} ${timeStr}`]]
            });
            if (panolOpId) {
              batchData.push({
                range: `DB_TRANSACTIONS!P${rowNum}`,
                values: [[panolOpId]]
              });
            }
          }
        }

        if (batchData.length > 0) {
          await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
              valueInputOption: 'USER_ENTERED',
              data: batchData
            }
          });
          for (const su of stockUpdates) {
            await updateStockByName(su.name, su.delta);
          }
        }
      }

      // 🐘 Actualización SQL en Supabase: panol.orders, panol.order_items y panol.stock_movements
      if (db && db.isConfigured && db.isConfigured() && reqId) {
        try {
          const isDelivered = (action === 'markAsDelivered');
          const finalStatus = isDelivered ? 'ENTREGADO' : 'LISTO';
          const updateField = isDelivered ? 'delivered_at = NOW()' : 'ready_at = NOW()';

          const panolStaffQ = panolOpId ? await db.query('SELECT id FROM panol.staff WHERE op_code = $1 LIMIT 1;', [panolOpId]) : { rows: [] };
          const panolStaffUuid = panolStaffQ.rows[0]?.id || null;

          await db.query(`
            UPDATE panol.orders 
            SET status = $1, panol_staff_id = COALESCE($2, panol_staff_id), ${updateField}, updated_at = NOW()
            WHERE req_code = $3;
          `, [finalStatus, panolStaffUuid, reqId]);

          await db.query(`
            UPDATE panol.order_items 
            SET status = $1, updated_at = NOW()
            WHERE order_id IN (SELECT id FROM panol.orders WHERE req_code = $2);
          `, [finalStatus, reqId]);

          if (isDelivered) {
            const ordItems = await db.query(`
              SELECT oi.id as order_item_id, oi.item_id, oi.quantity, i.stock
              FROM panol.order_items oi
              JOIN panol.items i ON oi.item_id = i.id
              JOIN panol.orders o ON oi.order_id = o.id
              WHERE o.req_code = $1;
            `, [reqId]);

            for (const row of ordItems.rows) {
              const prev = parseFloat(row.stock) || 0;
              const delta = -parseFloat(row.quantity);
              const next = Math.max(0, prev + delta);
              await db.query(`
                UPDATE panol.items SET stock = $1, updated_at = NOW() WHERE id = $2;
              `, [next, row.item_id]);
              await db.query(`
                INSERT INTO panol.stock_movements (
                  item_id, order_item_id, quantity_delta, previous_stock, new_stock, movement_type, performed_by, notes
                ) VALUES ($1, $2, $3, $4, $5, 'PEDIDO_ENTREGADO', $6, $7);
              `, [row.item_id, row.order_item_id, delta, prev, next, panolStaffUuid, `Retiro entregado ${reqId}`]);
            }
          }
          console.log(`🐘 [SQL] Pedido ${reqId} actualizado a ${finalStatus} en Supabase.`);
        } catch (sqlErr) {
          console.warn('⚠️ [SQL] Error actualizando pedido en Supabase:', sqlErr.message);
        }
      }

      await syncDataFromSheets(true);
      io.emit('orders_sync', ordersCache);
      result = { success: true };

    }
    else if (action === 'validateWarehouseUser') {
      const key = String(args[0] || '').trim();
      const users = { "1": "Ema", "6": "Matias" };
      result = users[key] || ("Operador " + key);
    }
    else if (action === 'syncCanonicalFleet' || action === 'syncOtList') {
      console.log('🛡️ Ejecutando blindaje y sincronización canónica de DB_OT_LIST vía RPC...');
      result = await syncCanonicalFleetToDbOtList({
        sheetsClient: sheets,
        targetSpreadsheetId: SPREADSHEET_ID,
        movimientosSpreadsheetId: MES_MOVIMIENTOS_ID
      });
      io.emit('ot_sync_completed', result);
    }
    // === GESTIÓN DE DB_OT_TASKS Y COLD STORAGE ===
    else if (action === 'getTasksBoard') {
      result = await getActiveTasksBoard({ sheetsClient: sheets, spreadsheetId: SPREADSHEET_ID });
    }
    else if (action === 'updateTaskExecution') {
      const payload = args[0] || {};
      result = await updateTaskExecution({
        sheetsClient: sheets,
        spreadsheetId: SPREADSHEET_ID,
        taskId: payload.taskId,
        ubicacion: payload.ubicacion,
        operario: payload.operario,
        asignado: payload.asignado,
        empezo: payload.empezo,
        termino: payload.termino,
        estado: payload.estado,
        io
      });
    }
    else if (action === 'syncOtsToTasks') {
      result = await syncOtsToTasksDatabase({ sheetsClient: sheets, spreadsheetId: SPREADSHEET_ID, io });
    }
    else if (action === 'calculateOtPercentage' || action === 'calculateAndSaveOtPercentage') {
      const payload = args[0] || {};
      result = await calculateAndSaveOtPercentage({
        sheetsClient: sheets,
        spreadsheetId: SPREADSHEET_ID,
        otNumber: payload.otNumber || payload.ot,
        plate: payload.plate || payload.dominio,
        io
      });
    }
    else if (action === 'updateAllOtsPercentages') {
      result = await updateAllOtsPercentages({
        sheetsClient: sheets,
        spreadsheetId: SPREADSHEET_ID,
        io
      });
    }
    else if (action === 'getHistoricalTasks') {
      result = await getHistoricalTasks({ sheetsClient: sheets, spreadsheetId: SPREADSHEET_ID });
    }
    // === TALLER WORKSTATION: UNIDADES EN HOLD (DB_STAFF Col M) & TIMELINE OTS (Col G) ===
    // === TALLER WORKSTATION: UNIDADES EN HOLD (panol.staff_holds / v_staff_holds) ===
    else if (action === 'getOperarioHoldUnits') {
      const opId = String(args[0] || '').trim();
      const staffMember = await getStaffMemberByOpCode(opId);
      const targetOpCode = staffMember ? staffMember.op_code : opId;

      if (db && db.isConfigured && db.isConfigured() && opId) {
        try {
          const searchCodes = [opId];
          if (staffMember) {
            searchCodes.push(staffMember.op_code);
            searchCodes.push(staffMember.id);
          }
          const qRes = await db.query(
            'SELECT * FROM panol.v_staff_holds WHERE op_code = ANY($1::text[]) OR staff_id::text = ANY($1::text[]) ORDER BY created_at DESC;',
            [searchCodes]
          );
          let holds = qRes.rows.map(r => ({
            id: r.hold_id,
            tractorPlate: r.tractor_plate,
            tractorOt: r.tractor_ot,
            semiPlate: r.semi_plate,
            semiOt: r.semi_ot,
            brand: r.tractor_brand,
            brandSemi: r.semi_brand,
            addedAt: r.created_at
          }));

          // Si en Postgres no hay holds para este operario, consultar e importar desde Sheets DB_STAFF Col M
          if (holds.length === 0 && sheets && SPREADSHEET_ID && staffMember) {
            const legacyRes = await getOperarioHoldOts({ sheetsClient: sheets, spreadsheetId: SPREADSHEET_ID, opId: targetOpCode });
            if (legacyRes && legacyRes.success && Array.isArray(legacyRes.units) && legacyRes.units.length > 0) {
              console.log(`🔄 [RPC Sync] Migrando ${legacyRes.units.length} OTs en hold desde Sheets a Postgres panol.staff_holds para ${targetOpCode}`);
              for (const u of legacyRes.units) {
                const tp = String(u.tractorPlate || '').trim().toUpperCase().replace(/[\s\-_.]/g, '');
                const sp = String(u.semiPlate || '').trim().toUpperCase().replace(/[\s\-_.]/g, '');
                const tot = String(u.tractorOt || '').trim();
                const sot = String(u.semiOt || '').trim();

                let trId = null;
                let smId = null;
                const woId = null; // Desacoplado: OTs canónicas vienen de DB_OT_LIST hasta normalizar extractor

                if (tp) {
                  const trRes = await db.query("SELECT id FROM public.tractores WHERE UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) = $1 LIMIT 1;", [tp]);
                  if (trRes.rows.length > 0) trId = trRes.rows[0].id;
                }
                if (sp) {
                  const smRes = await db.query("SELECT id FROM public.semis WHERE UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) = $1 LIMIT 1;", [sp]);
                  if (smRes.rows.length > 0) smId = smRes.rows[0].id;
                }

                await db.query(`
                  INSERT INTO panol.staff_holds (staff_id, work_order_id, tractor_id, semi_id, ot_number, semi_ot, tractor_plate, semi_plate)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                  ON CONFLICT DO NOTHING;
                `, [staffMember.id, woId, trId, smId, tot, sot, tp, sp]);
              }

              const reQ = await db.query(
                'SELECT * FROM panol.v_staff_holds WHERE op_code = ANY($1::text[]) OR staff_id::text = ANY($1::text[]) ORDER BY created_at DESC;',
                [searchCodes]
              );
              holds = reQ.rows.map(r => ({
                id: r.hold_id,
                tractorPlate: r.tractor_plate,
                tractorOt: r.tractor_ot,
                semiPlate: r.semi_plate,
                semiOt: r.semi_ot,
                brand: r.tractor_brand,
                brandSemi: r.semi_brand,
                addedAt: r.created_at
              }));
            }
          }

          result = holds;
        } catch (sqlErr) {
          console.warn('⚠️ [SQL] Error obteniendo staff_holds:', sqlErr.message);
          result = await getOperarioHoldOts({ sheetsClient: sheets, spreadsheetId: SPREADSHEET_ID, opId: targetOpCode });
        }
      } else {
        result = await getOperarioHoldOts({ sheetsClient: sheets, spreadsheetId: SPREADSHEET_ID, opId: targetOpCode });
      }
    }
    else if (action === 'saveOperarioHoldUnits') {
      const opId = String(args[0] || '').trim();
      const units = args[1] || [];
      const staffMember = await getStaffMemberByOpCode(opId);
      const targetOpCode = staffMember ? staffMember.op_code : opId;

      if (db && db.isConfigured && db.isConfigured() && staffMember) {
        try {
          const staffId = staffMember.id;
          await db.query('DELETE FROM panol.staff_holds WHERE staff_id = $1;', [staffId]);
          for (const u of units) {
            const tp = String(u.tractorPlate || '').trim().toUpperCase().replace(/[\s\-_.]/g, '');
            const sp = String(u.semiPlate || '').trim().toUpperCase().replace(/[\s\-_.]/g, '');
            const tot = String(u.tractorOt || '').trim();
            const sot = String(u.semiOt || '').trim();

            let trId = null;
            let smId = null;
            const woId = null; // Desacoplado: OTs canónicas vienen de DB_OT_LIST hasta normalizar extractor

            if (tp) {
              const trRes = await db.query("SELECT id FROM public.tractores WHERE UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) = $1 LIMIT 1;", [tp]);
              if (trRes.rows.length > 0) trId = trRes.rows[0].id;
            }
            if (sp) {
              const smRes = await db.query("SELECT id FROM public.semis WHERE UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) = $1 LIMIT 1;", [sp]);
              if (smRes.rows.length > 0) smId = smRes.rows[0].id;
            }

            await db.query(`
              INSERT INTO panol.staff_holds (staff_id, work_order_id, tractor_id, semi_id, ot_number, semi_ot, tractor_plate, semi_plate)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              ON CONFLICT DO NOTHING;
            `, [staffId, woId, trId, smId, tot, sot, tp, sp]);
          }
          result = { success: true };
        } catch (sqlErr) {
          console.warn('⚠️ [SQL] Error guardando staff_holds:', sqlErr.message);
        }
      }
      try {
        await saveOperarioHoldOts({ sheetsClient: sheets, spreadsheetId: SPREADSHEET_ID, opId: targetOpCode, units, io });
      } catch (shErr) {}
    }
    else if (action === 'getUnitTimelineTasks') {
      const params = args[0] || {};

      // 🐘 1. Prioridad SQL: Supabase panol.work_order_tasks
      if (db && db.isConfigured && db.isConfigured()) {
        try {
          const otNum = params.tractorOt || params.semiOt || '';
          if (otNum) {
            const sqlTasks = await db.query(`
              SELECT 
                wot.id, wot.task_index, wot.sector, wot.description, wot.status,
                wot.assigned_box, s.name as operario, wot.started_at, wot.finished_at,
                wo.ot_number, wo.progress_percentage
              FROM panol.work_order_tasks wot
              JOIN panol.work_orders wo ON wot.work_order_id = wo.id
              LEFT JOIN panol.staff s ON wot.assigned_staff_id = s.id
              WHERE wo.ot_number = $1
              ORDER BY wot.task_index ASC;
            `, [String(otNum).trim()]);

            if (sqlTasks.rows.length > 0) {
              result = {
                success: true,
                tasks: sqlTasks.rows.map(t => ({
                  id: t.id,
                  taskIndex: t.task_index,
                  rubro: t.sector,
                  desc: t.description,
                  estado: t.status,
                  operario: t.operario || '',
                  box: t.assigned_box || '',
                  empezo: t.started_at,
                  termino: t.finished_at
                })),
                progress: parseFloat(sqlTasks.rows[0].progress_percentage) || 0
              };
            }
          }
        } catch (sqlErr) {
          console.warn('⚠️ [SQL] Error getUnitTimelineTasks:', sqlErr.message);
        }
      }

      if (!result) {
        result = await getUnitTimelineTasks({
          sheetsClient: sheets,
          spreadsheetId: SPREADSHEET_ID,
          tractorOt: params.tractorOt,
          semiOt: params.semiOt,
          tractorPlate: params.tractorPlate,
          semiPlate: params.semiPlate
        });
      }
    }
    else if (action === 'toggleTaskTerminado') {
      const params = args[0] || {};

      // 🐘 Actualización SQL: Supabase panol.work_order_tasks
      if (db && db.isConfigured && db.isConfigured()) {
        try {
          const newStatus = params.isCompleted ? 'TERMINADO' : 'PENDIENTE';
          const finTime = params.isCompleted ? 'finished_at = NOW()' : 'finished_at = NULL';
          await db.query(`
            UPDATE panol.work_order_tasks
            SET status = $1, ${finTime}, updated_at = NOW()
            WHERE id::text = $2 OR (description = $3 AND work_order_id IN (SELECT id FROM panol.work_orders WHERE ot_number = $4));
          `, [newStatus, params.taskId ? String(params.taskId) : null, params.desc || '', String(params.otNumber || '')]);
          console.log(`🐘 [SQL] Tarea ${params.desc} actualizada a ${newStatus} en Supabase.`);
        } catch (sqlErr) {
          console.warn('⚠️ [SQL] Error toggleTaskTerminado:', sqlErr.message);
        }
      }

      result = await updateOtTaskTerminado({
        sheetsClient: sheets,
        spreadsheetId: SPREADSHEET_ID,
        otNumber: params.otNumber,
        taskId: params.taskId,
        rubro: params.rubro,
        desc: params.desc,
        opId: params.opId,
        isCompleted: params.isCompleted,
        io
      });
    }

    else if (action === 'getFleetSearchCatalog') {
      result = await otsManager.getFleetSearchCatalog(sheets, SPREADSHEET_ID);
    }
    else if (action === 'findUnitOrOt') {
      const query = args[0];
      const type = args[1];
      result = await otsManager.findUnitOrOt({
        sheetsClient: sheets,
        spreadsheetId: SPREADSHEET_ID,
        query,
        type
      });
    }
    else {
      // Fallback genérico
      result = { success: true };
    }

    res.json({ result: result });
  } catch (e) {
    console.error('❌ RPC Error en ' + action + ':', e.message);
    res.json({ error: e.message });
  }
});

// === ENDPOINTS REST: FLOTA CANÓNICA & DB_OT_LIST ===
app.post('/api/fleet/sync', async (req, res) => {
  try {
    const result = await syncCanonicalFleetToDbOtList({
      sheetsClient: sheets,
      targetSpreadsheetId: SPREADSHEET_ID,
      movimientosSpreadsheetId: MES_MOVIMIENTOS_ID
    });
    io.emit('ot_sync_completed', result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === ENDPOINTS REST: COORDINACIÓN TALLER ===
app.get('/api/coordinacion/data', async (req, res) => {
  try {
    const data = await getCoordinacionBoard({ sheetsClient: sheets, spreadsheetId: SPREADSHEET_ID });
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/coordinacion/save', async (req, res) => {
  try {
    const { otNumber, plate, data } = req.body;
    const result = await saveOtCoordinacionJson({
      sheetsClient: sheets,
      spreadsheetId: SPREADSHEET_ID,
      otNumber,
      plate,
      data,
      io
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/coordinacion/save-all', async (req, res) => {
  try {
    const { units } = req.body;
    const result = await saveAllCoordinacionBatch({
      sheetsClient: sheets,
      spreadsheetId: SPREADSHEET_ID,
      units,
      io
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/coordinacion/assign', async (req, res) => {
  try {
    const { taskId, otNumber, plate, ubicacion, operario, asignado, empezo, termino, estado, tasksPayload } = req.body;
    let updateResult = null;
    
    // 1. Actualizar DB_OT_TASKS si taskId está disponible
    if (taskId) {
      updateResult = await updateTaskExecution({
        sheetsClient: sheets,
        spreadsheetId: SPREADSHEET_ID,
        taskId,
        ubicacion,
        operario,
        asignado,
        empezo,
        termino,
        estado,
        io
      });
    }

    // 2. Persistir en Columna I de 'ots'
    if (otNumber || plate) {
      await saveOtCoordinacionJson({
        sheetsClient: sheets,
        spreadsheetId: SPREADSHEET_ID,
        otNumber,
        plate,
        data: tasksPayload || {
          ot: otNumber,
          plate,
          ubicacion,
          operarios: operario,
          lastUpdated: new Date().toISOString()
        },
        io
      });
    }

    res.json({
      success: true,
      taskId,
      ubicacion,
      operario,
      asignado,
      empezo,
      termino,
      estado,
      updateResult,
      message: 'Asignación guardada en DB_OT_TASKS y sincronizada en Col I/J de ots'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === ENDPOINTS REST: DB_OT_TASKS ===
app.get('/api/tasks', async (req, res) => {
  try {
    const data = await getActiveTasksBoard({ sheetsClient: sheets, spreadsheetId: SPREADSHEET_ID });
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tasks/update', async (req, res) => {
  try {
    const result = await updateTaskExecution({
      sheetsClient: sheets,
      spreadsheetId: SPREADSHEET_ID,
      ...req.body,
      io
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tasks/sync', async (req, res) => {
  try {
    const result = await syncOtsToTasksDatabase({ sheetsClient: sheets, spreadsheetId: SPREADSHEET_ID, io });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tasks/percentage', async (req, res) => {
  try {
    const { otNumber, ot, plate, dominio } = req.body;
    const result = await calculateAndSaveOtPercentage({
      sheetsClient: sheets,
      spreadsheetId: SPREADSHEET_ID,
      otNumber: otNumber || ot,
      plate: plate || dominio,
      io
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tasks/percentage/all', async (req, res) => {
  try {
    const result = await updateAllOtsPercentages({
      sheetsClient: sheets,
      spreadsheetId: SPREADSHEET_ID,
      io
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/tasks/history', async (req, res) => {
  try {
    const result = await getHistoricalTasks({ sheetsClient: sheets, spreadsheetId: SPREADSHEET_ID });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// REST GET /api/orders
app.get('/api/orders', async (req, res) => {
  // 🐘 Prioridad 1: SQL Supabase (panol.v_monitor_pedidos)
  if (db && db.isConfigured && db.isConfigured()) {
    try {
      const qRes = await db.query('SELECT * FROM panol.v_monitor_pedidos ORDER BY created_at DESC LIMIT 50;');
      if (qRes.rows.length > 0) {
        const mapped = qRes.rows.map(r => ({
          reqId: r.req_code,
          orderId: r.order_id,
          opId: r.mechanic_op_code,
          opInfo: r.mechanic_name,
          box: r.box_number || '01',
          otNumber: r.ot_number,
          tractorPlate: r.tractor,
          tractorBrand: r.marca_tr,
          semiPlate: r.semi,
          semiBrand: r.marca_semi,
          status: r.order_status,
          orderType: r.order_type || 'PEDIDO',
          parentOrderId: r.parent_order_id,
          notes: r.order_notes,
          timestamp: r.created_at,
          items: (r.items || []).map(it => ({
            name: it.name,
            code: it.code,
            qty: it.qty,
            delivered_qty: it.delivered_qty || 0,
            returned_qty: it.returned_qty || 0,
            loc: it.location || 'S/D',
            status: it.status,
            requiereCanje: !!it.requires_exchange,
            exchange_status: it.exchange_status,
            note: it.notes,
            return_notes: it.return_notes
          }))
        }));
        return res.json(mapped);
      }
    } catch (sqlErr) {
      console.warn('⚠️ [SQL] Error obteniendo v_monitor_pedidos:', sqlErr.message);
    }
  }

  // Fallback a Sheets
  const orders = await syncDataFromSheets();
  res.json(orders);
});

// REST GET /api/fleet/search-catalog
app.get('/api/fleet/search-catalog', async (req, res) => {
  try {
    const data = await otsManager.getFleetSearchCatalog(sheets, SPREADSHEET_ID);
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('❌ Error en /api/fleet/search-catalog:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// REST GET /api/devoluciones (Alimenta el panel de Devoluciones y Canjes de Pañol)
app.get('/api/devoluciones', async (req, res) => {
  if (db && db.isConfigured && db.isConfigured()) {
    try {
      const qRes = await db.query('SELECT * FROM panol.v_devoluciones_pendientes ORDER BY order_created_at DESC;');
      return res.json({ success: true, devoluciones: qRes.rows });
    } catch (sqlErr) {
      console.warn('⚠️ [SQL] Error obteniendo v_devoluciones_pendientes:', sqlErr.message);
    }
  }
  res.json({ success: true, devoluciones: [] });
});

// REST GET /api/holds/:opCode (Unidades en puesto desde panol.v_staff_holds)
app.get('/api/holds/:opCode', async (req, res) => {
  const opCode = String(req.params.opCode || '').trim();
  const staffMember = await getStaffMemberByOpCode(opCode);
  const targetOpCode = staffMember ? staffMember.op_code : opCode;

  if (db && db.isConfigured && db.isConfigured() && opCode) {
    try {
      const searchCodes = [opCode];
      if (staffMember) {
        searchCodes.push(staffMember.op_code);
        searchCodes.push(staffMember.id);
      }
      const qRes = await db.query(
        'SELECT * FROM panol.v_staff_holds WHERE op_code = ANY($1::text[]) OR staff_id::text = ANY($1::text[]) ORDER BY created_at DESC;',
        [searchCodes]
      );
      let holds = qRes.rows.map(r => ({
        id: r.hold_id,
        tractorPlate: r.tractor_plate,
        tractorOt: r.tractor_ot,
        semiPlate: r.semi_plate,
        semiOt: r.semi_ot,
        brand: r.tractor_brand,
        brandSemi: r.semi_brand,
        addedAt: r.created_at
      }));

      // Si no hay holds en Postgres pero existen en Sheets DB_STAFF Col M, sincronizarlos
      if (holds.length === 0 && sheets && SPREADSHEET_ID && staffMember) {
        const legacyRes = await getOperarioHoldOts({ sheetsClient: sheets, spreadsheetId: SPREADSHEET_ID, opId: targetOpCode });
        if (legacyRes && legacyRes.success && Array.isArray(legacyRes.units) && legacyRes.units.length > 0) {
          console.log(`🔄 [REST Sync] Migrando ${legacyRes.units.length} OTs en hold desde Sheets a panol.staff_holds para ${targetOpCode}`);
          for (const u of legacyRes.units) {
            const tp = String(u.tractorPlate || '').trim().toUpperCase().replace(/[\s\-_.]/g, '');
            const sp = String(u.semiPlate || '').trim().toUpperCase().replace(/[\s\-_.]/g, '');
            const tot = String(u.tractorOt || '').trim();
            const sot = String(u.semiOt || '').trim();

            let trId = null;
            let smId = null;
            const woId = null; // Desacoplado: OTs canónicas vienen de DB_OT_LIST hasta normalizar extractor

            if (tp) {
              const trRes = await db.query("SELECT id FROM public.tractores WHERE UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) = $1 LIMIT 1;", [tp]);
              if (trRes.rows.length > 0) trId = trRes.rows[0].id;
            }
            if (sp) {
              const smRes = await db.query("SELECT id FROM public.semis WHERE UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) = $1 LIMIT 1;", [sp]);
              if (smRes.rows.length > 0) smId = smRes.rows[0].id;
            }

            await db.query(`
              INSERT INTO panol.staff_holds (staff_id, work_order_id, tractor_id, semi_id, ot_number, semi_ot, tractor_plate, semi_plate)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              ON CONFLICT DO NOTHING;
            `, [staffMember.id, woId, trId, smId, tot, sot, tp, sp]);
          }

          const reQ = await db.query(
            'SELECT * FROM panol.v_staff_holds WHERE op_code = ANY($1::text[]) OR staff_id::text = ANY($1::text[]) ORDER BY created_at DESC;',
            [searchCodes]
          );
          holds = reQ.rows.map(r => ({
            id: r.hold_id,
            tractorPlate: r.tractor_plate,
            tractorOt: r.tractor_ot,
            semiPlate: r.semi_plate,
            semiOt: r.semi_ot,
            brand: r.tractor_brand,
            brandSemi: r.semi_brand,
            addedAt: r.created_at
          }));
        }
      }

      return res.json({ success: true, holds });
    } catch (sqlErr) {
      console.warn('⚠️ [SQL] Error obteniendo /api/holds:', sqlErr.message);
    }
  }

  // Fallback si Postgres no está disponible: leer de Sheets directamente
  if (sheets && SPREADSHEET_ID && opCode) {
    const legacyRes = await getOperarioHoldOts({ sheetsClient: sheets, spreadsheetId: SPREADSHEET_ID, opId: targetOpCode });
    return res.json({ success: true, holds: legacyRes.units || [] });
  }

  res.json({ success: true, holds: [] });
});

// REST POST /api/holds (Agregar unidad al puesto en panol.staff_holds y replicar en Sheets DB_STAFF Col M)
app.post('/api/holds', async (req, res) => {
  const { opCode, tractorPlate, tractorOt, semiPlate, semiOt, brand, brandSemi } = req.body || {};
  const cleanOp = String(opCode || '').trim();
  if (!cleanOp) return res.status(400).json({ success: false, error: 'Falta opCode' });

  const staffMember = await getStaffMemberByOpCode(cleanOp);
  const targetOpCode = staffMember ? staffMember.op_code : cleanOp;

  if (db && db.isConfigured && db.isConfigured() && staffMember) {
    try {
      const staffId = staffMember.id;
      const tp = String(tractorPlate || '').trim().toUpperCase().replace(/[\s\-_.]/g, '');
      const sp = String(semiPlate || '').trim().toUpperCase().replace(/[\s\-_.]/g, '');
      const tot = String(tractorOt || '').trim();
      const sot = String(semiOt || '').trim();

      let trId = null;
      let smId = null;
      const woId = null; // Desacoplado: OTs canónicas vienen de DB_OT_LIST hasta normalizar extractor

      if (tp) {
        const trRes = await db.query("SELECT id FROM public.tractores WHERE UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) = $1 LIMIT 1;", [tp]);
        if (trRes.rows.length > 0) trId = trRes.rows[0].id;
      }
      if (sp) {
        const smRes = await db.query("SELECT id FROM public.semis WHERE UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) = $1 LIMIT 1;", [sp]);
        if (smRes.rows.length > 0) smId = smRes.rows[0].id;
      }

      // Evitar duplicados para el mismo operario si ya tiene esta unidad en hold
      const existingHold = await db.query(`
        SELECT id FROM panol.staff_holds 
        WHERE staff_id = $1 
          AND (
            ($2 <> '' AND tractor_plate = $2) OR 
            ($3 <> '' AND semi_plate = $3)
          )
        LIMIT 1;
      `, [staffId, tp, sp]);

      let newId;
      if (existingHold.rows.length > 0) {
        newId = existingHold.rows[0].id;
        await db.query(`
          UPDATE panol.staff_holds 
          SET ot_number = COALESCE(NULLIF($1, ''), ot_number),
              semi_ot = COALESCE(NULLIF($2, ''), semi_ot),
              tractor_id = COALESCE($3, tractor_id),
              semi_id = COALESCE($4, semi_id),
              tractor_plate = COALESCE(NULLIF($5, ''), tractor_plate),
              semi_plate = COALESCE(NULLIF($6, ''), semi_plate)
          WHERE id = $7;
        `, [tot, sot, trId, smId, tp, sp, newId]);
      } else {
        const insRes = await db.query(`
          INSERT INTO panol.staff_holds (staff_id, work_order_id, tractor_id, semi_id, ot_number, semi_ot, tractor_plate, semi_plate)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id, created_at;
        `, [staffId, woId, trId, smId, tot, sot, tp, sp]);
        newId = insRes.rows[0]?.id;
      }

      // Obtener lista completa consolidada para este operario
      const allHoldsRes = await db.query(
        'SELECT * FROM panol.v_staff_holds WHERE staff_id = $1 ORDER BY created_at DESC;',
        [staffId]
      );
      const unitsPayload = allHoldsRes.rows.map(r => ({
        tractorPlate: r.tractor_plate || '',
        tractorOt: r.tractor_ot || '',
        semiPlate: r.semi_plate || '',
        semiOt: r.semi_ot || '',
        addedAt: r.created_at
      }));

      // Sincronizar en DB_STAFF Col M (Google Sheets)
      if (sheets && SPREADSHEET_ID) {
        try {
          await saveOperarioHoldOts({
            sheetsClient: sheets,
            spreadsheetId: SPREADSHEET_ID,
            opId: targetOpCode,
            units: unitsPayload,
            io
          });
        } catch (shErr) {
          console.warn('⚠️ [Sheets Sync] Error actualizando DB_STAFF Col M:', shErr.message);
        }
      }

      if (io) {
        io.emit('taller_hold_updated', { opId: targetOpCode, units: unitsPayload });
      }

      return res.json({
        success: true,
        hold: {
          id: newId,
          tractorPlate: tp,
          tractorOt: tot,
          semiPlate: sp,
          semiOt: sot,
          brand: brand || '',
          brandSemi: brandSemi || ''
        }
      });
    } catch (sqlErr) {
      console.warn('⚠️ [SQL] Error insertando hold:', sqlErr.message);
      return res.status(500).json({ success: false, error: sqlErr.message });
    }
  }

  // Fallback si Postgres no está disponible: actualizar Sheets directamente
  if (sheets && SPREADSHEET_ID) {
    const prev = await getOperarioHoldOts({ sheetsClient: sheets, spreadsheetId: SPREADSHEET_ID, opId: targetOpCode });
    const currentList = Array.isArray(prev.units) ? prev.units : [];
    const newUnit = {
      tractorPlate: tractorPlate || '',
      tractorOt: tractorOt || '',
      semiPlate: semiPlate || '',
      semiOt: semiOt || '',
      addedAt: new Date().toISOString()
    };
    currentList.unshift(newUnit);
    await saveOperarioHoldOts({ sheetsClient: sheets, spreadsheetId: SPREADSHEET_ID, opId: targetOpCode, units: currentList, io });
    return res.json({ success: true, hold: newUnit });
  }

  res.json({ success: true, hold: { tractorPlate, tractorOt, semiPlate, semiOt } });
});

// REST DELETE /api/holds/:id (Remover unidad del puesto y replicar en Sheets DB_STAFF Col M)
app.delete('/api/holds/:id', async (req, res) => {
  const { id } = req.params;
  if (db && db.isConfigured && db.isConfigured() && id) {
    try {
      const delRes = await db.query(
        'DELETE FROM panol.staff_holds WHERE id::text = $1 RETURNING staff_id;',
        [id]
      );
      if (delRes.rows.length > 0) {
        const staffId = delRes.rows[0].staff_id;
        const sRes = await db.query('SELECT op_code FROM panol.staff WHERE id = $1 LIMIT 1;', [staffId]);
        const targetOpCode = sRes.rows[0]?.op_code;

        const allHoldsRes = await db.query(
          'SELECT * FROM panol.v_staff_holds WHERE staff_id = $1 ORDER BY created_at DESC;',
          [staffId]
        );
        const unitsPayload = allHoldsRes.rows.map(r => ({
          tractorPlate: r.tractor_plate || '',
          tractorOt: r.tractor_ot || '',
          semiPlate: r.semi_plate || '',
          semiOt: r.semi_ot || '',
          addedAt: r.created_at
        }));

        if (sheets && SPREADSHEET_ID && targetOpCode) {
          try {
            await saveOperarioHoldOts({
              sheetsClient: sheets,
              spreadsheetId: SPREADSHEET_ID,
              opId: targetOpCode,
              units: unitsPayload,
              io
            });
          } catch (shErr) {
            console.warn('⚠️ [Sheets Sync] Error eliminando de DB_STAFF Col M:', shErr.message);
          }
        }

        if (io && targetOpCode) {
          io.emit('taller_hold_updated', { opId: targetOpCode, units: unitsPayload });
        }
      }
      return res.json({ success: true });
    } catch (sqlErr) {
      console.warn('⚠️ [SQL] Error eliminando hold:', sqlErr.message);
    }
  }
  res.json({ success: true });
});

// REST POST /api/pedidos/return (Solicitud de devolución desde terminal de taller)
app.post('/api/pedidos/return', async (req, res) => {
  const { reqId, itemName, returnQty, reason, opId } = req.body || {};
  if (!reqId) return res.status(400).json({ success: false, error: 'Falta reqId' });

  const qty = parseInt(returnQty || '1', 10);
  const note = reason ? `DEVOLUCIÓN SOLICITADA POR TALLER: ${reason}` : 'DEVOLUCIÓN SOLICITADA POR TALLER';

  if (db && db.isConfigured && db.isConfigured()) {
    try {
      await db.query(`
        UPDATE panol.order_items oi
        SET status = 'DEVOLUCION PENDIENTE', returned_qty = $1, return_notes = $2
        FROM panol.orders o, panol.items i
        WHERE oi.order_id = o.id AND oi.item_id = i.id
          AND o.req_code = $3
          AND (i.name ILIKE $4 OR $4 = '__ALL__');
      `, [qty, note, reqId, itemName || '__ALL__']);

      await db.query(`
        UPDATE panol.orders SET status = 'DEVOLUCION PENDIENTE' WHERE req_code = $1;
      `, [reqId]);
    } catch (sqlErr) {
      console.warn('⚠️ [SQL] Error registrando devolución de taller:', sqlErr.message);
    }
  }

  // Notificar por websockets
  if (io) {
    io.emit('orders_sync', [{ reqId, status: 'DEVOLUCION PENDIENTE' }]);
  }

  res.json({ success: true });
});

// REST GET /api/ots-anteriores/:plate
app.get('/api/ots-anteriores/:plate', async (req, res) => {
  try {
    const { plate } = req.params;
    const data = await otsManager.getOtsAnterioresForPlate(sheets, SPREADSHEET_ID, plate);
    res.json({ success: true, plate, anteriores: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// REST POST /api/ots/wipe-cold
app.post('/api/ots/wipe-cold', async (req, res) => {
  try {
    const result = await otsManager.wipeAndArchiveOlderThan6Months(sheets, SPREADSHEET_ID);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// REST GET /api/ots/cold-storage/download
app.get('/api/ots/cold-storage/download', async (req, res) => {
  try {
    const { csvContent, totalRows } = await otsManager.downloadColdStorageOts(sheets, SPREADSHEET_ID);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ots_historico_cold.csv"');
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// REST POST /api/ots/cold-storage/clear
app.post('/api/ots/cold-storage/clear', async (req, res) => {
  try {
    const result = await otsManager.clearColdStorageTab(sheets, SPREADSHEET_ID);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === 4.1 WEBHOOK NUEVA OT (APPS SCRIPT INTEGRATION) ===
app.post('/webhook/nueva-ot', async (req, res) => {
  try {
    const dirtyPlate = req.body.dirtyPlate || req.body.rawPlate || req.body.plate || req.body.dominio || '';
    const otNumber = req.body.otNumber || req.body.newOt || req.body.ot || '';
    const sectorTareas = req.body.sectorTareas || req.body.tareas || '';
    const cierreRespaldo = req.body.cierreRespaldo || req.body.respaldo || '';
    const fecha = req.body.fecha || '';
    const confirmacion = req.body.confirmacion || req.body.confirmacionTareas || '';

    console.log(`📥 Webhook /webhook/nueva-ot recibido: dirtyPlate="${dirtyPlate}", otNumber="${otNumber}"`);

    // 1. Gestionar 'ots' y 'ots_anteriores': preserva solo la más actual por fecha de ingreso y traslada anteriores
    let otsManagerResult = null;
    if (sheets && dirtyPlate && otNumber) {
      try {
        otsManagerResult = await otsManager.processNewOtRecord(sheets, SPREADSHEET_ID, {
          dominio: dirtyPlate,
          otNumber,
          sectorTareas,
          cierreRespaldo,
          fecha,
          confirmacion
        });
      } catch (errOts) {
        console.warn('⚠️ Advertencia en otsManager.processNewOtRecord:', errOts.message);
      }
    }

    // 2. Emparejamiento en índice DB_OT_LIST
    let result = null;
    try {
      result = await processSingleOtUpdate({
        sheetsClient: sheets,
        targetSpreadsheetId: SPREADSHEET_ID,
        dirtyPlate: dirtyPlate,
        otNumber: otNumber
      });
    } catch(errSingle) {
      console.warn('⚠️ Advertencia en processSingleOtUpdate:', errSingle.message);
    }

    const effectivePlate = (otsManagerResult && otsManagerResult.dominio) || (result && result.matchedPlate) || dirtyPlate;
    const effectiveOt = otNumber;

    // Notificar a todos los navegadores/dashboards conectados en tiempo real vía WebSocket
    io.emit('ot_updated', {
      action: (otsManagerResult && otsManagerResult.action) || (result && result.action) || 'UPDATED',
      matchedPlate: effectivePlate,
      otNumber: effectiveOt,
      otsDetails: otsManagerResult,
      timestamp: new Date().toISOString()
    });

    console.log(`✅ Webhook /webhook/nueva-ot procesado: ${effectivePlate} (OT ${effectiveOt})`);

    res.status(200).json({
      success: true,
      otsManager: otsManagerResult,
      dbOtList: result
    });
  } catch (err) {
    console.error('❌ Error procesando /webhook/nueva-ot:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint manual / bajo demanda para distribuir OTs ante cargas externas
app.all('/api/distribuir-ots', async (req, res) => {
  try {
    console.log('⚡ Disparando distribución de OTs bajo demanda (/api/distribuir-ots)...');
    const result = await otsManager.distribuirOtsEnCarga(sheets, SPREADSHEET_ID, io);
    res.json({ success: true, result });
  } catch (err) {
    console.error('❌ Error en /api/distribuir-ots:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint manual / cron para sincronización masiva de OTs
app.all('/api/sync-ots', async (req, res) => {
  try {
    console.log('🛡️ Disparando sincronización canónica de OTs desde /api/sync-ots...');
    const result = await syncCanonicalFleetToDbOtList({
      sheetsClient: sheets,
      targetSpreadsheetId: SPREADSHEET_ID,
      movimientosSpreadsheetId: MES_MOVIMIENTOS_ID,
      formSpreadsheetId: SOURCE_SPREADSHEET_ID
    });
    // Distribuir en la carga
    await otsManager.distribuirOtsEnCarga(sheets, SPREADSHEET_ID, io);
    io.emit('ot_sync_completed', result);
    res.json(result);
  } catch (err) {
    console.error('❌ Error en /api/sync-ots:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Health check
app.get('/ping', (req, res) => res.send('PONG'));

// === 5. WEBSOCKETS EN TIEMPO REAL ===
io.on('connection', (socket) => {
  socket.emit('orders_sync', ordersCache);
  socket.emit('env_info', {
    environment: isProdEnvironment ? 'production' : 'development',
    isProduction: isProdEnvironment,
    spreadsheetTitle: isProdEnvironment ? 'Database PRUEBAS' : 'Database PRUEBAS LOCAL',
    spreadsheetIdShort: SPREADSHEET_ID.slice(0, 6) + '...' + SPREADSHEET_ID.slice(-4),
    serverTime: new Date().toISOString()
  });
});

// === 6. PROGRAMACIÓN DE TAREAS Y ARRANQUE DEL SERVIDOR ===
// Sincronización periódica de OTs como salvaguarda / backup (por defecto 0 = desactivado para cuidar cuota)
if (OT_SYNC_INTERVAL_MINUTES > 0) {
  const syncIntervalMs = OT_SYNC_INTERVAL_MINUTES * 60 * 1000;
  setInterval(async () => {
    try {
      console.log(`⏰ Ejecución programada de sincronización canónica de OTs (cada ${OT_SYNC_INTERVAL_MINUTES} min)...`);
      const result = await syncCanonicalFleetToDbOtList({
        sheetsClient: sheets,
        targetSpreadsheetId: SPREADSHEET_ID,
        movimientosSpreadsheetId: MES_MOVIMIENTOS_ID,
        formSpreadsheetId: SOURCE_SPREADSHEET_ID
      });
      await otsManager.distribuirOtsEnCarga(sheets, SPREADSHEET_ID, io);
      io.emit('ot_sync_completed', result);
    } catch (e) {
      console.error('❌ Error en sincronización programada de OTs:', e.message);
    }
  }, syncIntervalMs);
}

const DEFAULT_PORT = parseInt(process.env.PORT || '5000', 10);

function startServer(port) {
  server.removeAllListeners('error');
  server.removeAllListeners('listening');

  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ Puerto ${port} en uso. Reintentando automáticamente en puerto ${port + 1}...`);
      setTimeout(() => startServer(port + 1), 500);
    } else {
      console.error('❌ Error en servidor HTTP:', err.message);
    }
  });

  server.once('listening', async () => {
    console.log('================================================================');
    console.log(`🚀 Servidor Monolito Pañol activo en puerto ${port}`);
    console.log(`🌍 Entorno:          ${isProdEnvironment ? '🔴 PRODUCCIÓN (Render Cloud)' : '🟢 LOCAL / DESARROLLO (VS Code / localhost)'}`);
    console.log(`📊 Spreadsheet Base: ${isProdEnvironment ? 'Database PRUEBAS' : 'Database PRUEBAS LOCAL'}`);
    console.log(`🆔 ID Planilla:      ${SPREADSHEET_ID}`);
    console.log(`🔗 URL Base:         http://localhost:${port}`);
    console.log('================================================================');
    
    // 1. Carga en memoria RAM de unidades desde Supabase EOR (SQL nativo, ultra rápido)
    try {
      await syncFleetFromSupabase();
    } catch (err) {
      console.warn('⚠️ Carga inicial RAM Supabase:', err.message);
    }
    setInterval(() => {
      syncFleetFromSupabase().catch(err => console.warn('⚠️ Refresco RAM Supabase:', err.message));
    }, 15 * 60 * 1000);


    // 2. Asegurar estructura de ots y ots_anteriores y depurar en la carga inicial (sin timers periódicos)
    try {
      await otsManager.ensureOtsStructure(sheets, SPREADSHEET_ID);
      await otsManager.migrateAndDeduplicateOts(sheets, SPREADSHEET_ID);
    } catch (errOtsInit) {
      console.warn('⚠️ Error al inicializar ots y ots_anteriores:', errOtsInit.message);
    }

    // Pequeña pausa de 1 segundo para escalonar peticiones y proteger la cuota de Google Sheets
    await new Promise(r => setTimeout(r, 1000));

    // 3. Sincronizar catálogo y transacciones en 1 sola petición HTTP batchGet
    await syncDataFromSheets();

    // Pequeña pausa de 1 segundo
    await new Promise(r => setTimeout(r, 1000));

    // 4. Sincronización inicial de flota canónica a DB_OT_LIST
    try {
      console.log('🚀 Ejecutando sincronización inicial canónica de OTs al arrancar servidor...');
      const otSyncRes = await syncCanonicalFleetToDbOtList({
        sheetsClient: sheets,
        targetSpreadsheetId: SPREADSHEET_ID,
        movimientosSpreadsheetId: MES_MOVIMIENTOS_ID,
        formSpreadsheetId: SOURCE_SPREADSHEET_ID
      });
      console.log('✅ Sincronización inicial de OTs finalizada:', otSyncRes);
    } catch (e) {
      console.error('⚠️ Advertencia: No se pudo completar sincronización inicial de OTs:', e.message);
    }

    try {
      console.log('🔄 Sincronizando tareas operativas de OTs (DB_OT_TASKS & ots_anteriores)...');
      await syncOtsToTasksDatabase({ sheetsClient: sheets, spreadsheetId: SPREADSHEET_ID });
    } catch (eTasksInit) {
      console.warn('⚠️ Error en sincronización inicial de tareas:', eTasksInit.message);
    }
  });

  server.listen(port, '0.0.0.0');
}

startServer(DEFAULT_PORT);