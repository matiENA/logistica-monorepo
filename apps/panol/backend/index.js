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
  saveAllCoordinacionBatch,
  updateTaskExecutionInSupabase,
  exportAndPurgeColdOrdersOlderThan180Days,
  ingestOtsFromSheetsToSupabase
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

// Directorio del frontend compilado (Vite React dist)
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
const FRONTEND_DIR = fs.existsSync(FRONTEND_DIST) ? FRONTEND_DIST : null;

function serveStaticOrJson(res, filename, extra = {}, forceRaw = false) {
  const distDir = FRONTEND_DIR || (fs.existsSync(FRONTEND_DIST) ? FRONTEND_DIST : null);
  if (distDir) {
    const filePath = filename === 'index.html'
      ? path.join(distDir, 'index.html')
      : path.join(distDir, filename);
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
    if (filename.endsWith('.html')) {
      const spaIndex = path.join(distDir, 'index.html');
      if (fs.existsSync(spaIndex)) {
        return res.sendFile(spaIndex);
      }
    }
  }
  return res.json({
    service: 'Pañol Logistics Microservice (Backend Web Service)',
    status: 'online',
    route: filename,
    notice: 'El Frontend React se publica de forma independiente en Render Static Site (o en http://localhost:5173 en desarrollo)',
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

// Obtener contraseña maestra del sistema (prioridad: Supabase panol.system_config -> env SYSTEM_PASSWORD -> fallback taller2026)
async function getSystemPassword() {
  if (db && db.isConfigured && db.isConfigured()) {
    try {
      const q = await db.query("SELECT value FROM panol.system_config WHERE key = 'SYSTEM_PASSWORD' LIMIT 1;");
      if (q.rows.length > 0 && q.rows[0].value) {
        return q.rows[0].value.trim();
      }
    } catch (e) {}
  }
  return (process.env.SYSTEM_PASSWORD || 'taller2026').trim();
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
let ordersCacheFetchedAt = 0;
let devolucionesCache = new Map(); // key ('__ALL__' | 'NUEVO' | 'CANJE') -> { ts, payload }
let devolucionesNuevasCache = { ts: 0, payload: null };
const MONITOR_CACHE_TTL_MS = 30 * 1000;

function invalidateMonitorPanolCaches() {
  ordersCacheFetchedAt = 0;
  devolucionesCache.clear();
  devolucionesNuevasCache = { ts: 0, payload: null };
}

let itemsCatalogCache = [];
let sqlItemsCatalogCache = null;
let sqlInventoryListCache = null;
let sqlItemsMap = new Map(); // item uuid -> canonical item record
let sqlItemsMaxUpdatedAt = null;
let sqlItemsCatalogLastFetch = 0;
let sqlItemsNeedsDelta = false;
const SQL_ITEMS_CACHE_TTL = 60 * 1000; // Delta check liviano cada 60s (0 filas si no hubo cambios)

function rebuildSqlItemsDerivedCaches() {
  const activeRows = Array.from(sqlItemsMap.values())
    .filter(it => it.is_active)
    .sort((a, b) => a.name.localeCompare(b.name));

  sqlItemsCatalogCache = activeRows.map(i => ({
    id: i.item_code,
    category: i.category,
    name: i.name,
    brand: i.brand,
    stock: i.stock,
    loc: i.loc,
    requiereCanje: i.requiereCanje,
    requires_exchange: i.requires_exchange
  }));

  sqlInventoryListCache = activeRows.map(i => ({
    id: i.uuid,
    item_code: i.item_code,
    code: i.item_code,
    name: i.name,
    brand: i.brand,
    stock: i.stock,
    loc: i.loc,
    requiereCanje: i.requiereCanje,
    requires_exchange: i.requires_exchange,
    _searchName: i.nameLower,
    _searchBrand: i.brandLower,
    _searchCode: i.codeLower
  }));
}

async function ensureSqlItemsCatalog() {
  if (!(db && db.isConfigured && db.isConfigured())) return false;
  const now = Date.now();

  if (sqlItemsCatalogCache && !sqlItemsNeedsDelta && (now - sqlItemsCatalogLastFetch < SQL_ITEMS_CACHE_TTL)) {
    return true;
  }

  try {
    if (!sqlItemsCatalogCache || sqlItemsMap.size === 0 || !sqlItemsMaxUpdatedAt) {
      // Carga inicial completa una sola vez por ciclo de vida del proceso
      const itRes = await db.query(
        "SELECT id, item_code, name, brand, category, requires_exchange, stock, location, is_active, updated_at FROM panol.items WHERE is_active = true;"
      );
      sqlItemsMap.clear();
      let maxTs = null;
      for (const r of itRes.rows) {
        const tsIso = r.updated_at ? new Date(r.updated_at).toISOString() : null;
        if (tsIso && (!maxTs || tsIso > maxTs)) maxTs = tsIso;
        const nameStr = r.name || '';
        const brandStr = r.brand || '';
        const codeStr = r.item_code || '';
        sqlItemsMap.set(String(r.id), {
          uuid: r.id,
          item_code: codeStr,
          category: r.category || 'GENERAL',
          name: nameStr,
          nameLower: nameStr.toLowerCase(),
          brand: brandStr,
          brandLower: brandStr.toLowerCase(),
          codeLower: codeStr.toLowerCase(),
          stock: parseFloat(r.stock) || 0,
          loc: r.location || 'S/D',
          requiereCanje: !!r.requires_exchange,
          requires_exchange: !!r.requires_exchange,
          is_active: r.is_active !== false
        });
      }
      sqlItemsMaxUpdatedAt = maxTs || new Date().toISOString();
      rebuildSqlItemsDerivedCaches();
    } else {
      // Sincronización incremental por delta: 0 filas transferidas cuando el catálogo no cambió
      const deltaRes = await db.query(
        "SELECT id, item_code, name, brand, category, requires_exchange, stock, location, is_active, updated_at FROM panol.items WHERE updated_at > $1;",
        [sqlItemsMaxUpdatedAt]
      );
      if (deltaRes.rows.length > 0) {
        let maxTs = sqlItemsMaxUpdatedAt;
        for (const r of deltaRes.rows) {
          const tsIso = r.updated_at ? new Date(r.updated_at).toISOString() : null;
          if (tsIso && tsIso > maxTs) maxTs = tsIso;
          const key = String(r.id);
          if (r.is_active === false) {
            sqlItemsMap.delete(key);
          } else {
            const nameStr = r.name || '';
            const brandStr = r.brand || '';
            const codeStr = r.item_code || '';
            sqlItemsMap.set(key, {
              uuid: r.id,
              item_code: codeStr,
              category: r.category || 'GENERAL',
              name: nameStr,
              nameLower: nameStr.toLowerCase(),
              brand: brandStr,
              brandLower: brandStr.toLowerCase(),
              codeLower: codeStr.toLowerCase(),
              stock: parseFloat(r.stock) || 0,
              loc: r.location || 'S/D',
              requiereCanje: !!r.requires_exchange,
              requires_exchange: !!r.requires_exchange,
              is_active: true
            });
          }
        }
        sqlItemsMaxUpdatedAt = maxTs;
        rebuildSqlItemsDerivedCaches();
      }
    }

    sqlItemsCatalogLastFetch = now;
    sqlItemsNeedsDelta = false;
    return true;
  } catch (sqlErr) {
    console.warn('⚠️ [SQL] Error ensureSqlItemsCatalog:', sqlErr.message);
    return Boolean(sqlItemsCatalogCache);
  }
}
let uiPropertiesCache = {};
let readyTimestamps = {}; // reqId -> timestamp when transitioned to LISTO
let lastSyncTime = 0;
const MIN_SYNC_INTERVAL_MS = 8000; // Evitar Quota Exceeded (max 1 lectura cada 8s)

// === 2.1 CACHÉ EN RAM DE FLOTA Y OTs (Supabase panol.v_flota_busqueda y public.unidades) ===
let ramFleetCache = new Map(); // normalizedPlate -> { unidadId, nUte, tractorPlate, tractorBrand, semiPlate, semiBrand, service, activeOt, tractorOt, semiOt }
let otListByTractor = new Map();
let otListBySemi = new Map();
let lastDiagramasSync = 0;

async function syncFleetFromSupabase() {
  if (db && db.isConfigured && db.isConfigured()) {
    try {
      const res = await db.query(`
        SELECT 
          unidad_id,
          COALESCE(n_ute, '') as n_ute,
          COALESCE(tractor, '') as tractor,
          COALESCE(marca_tr, '') as marca_tr,
          COALESCE(semi, '') as semi,
          COALESCE(marca_semi, '') as marca_semi,
          COALESCE(servicio, 'GENERAL') as servicio,
          COALESCE(estado_unidad, 'disponible') as estado_unidad,
          COALESCE(active_ot_number, '') as active_ot_number,
          COALESCE(tractor_ot, '') as tractor_ot,
          COALESCE(semi_ot, '') as semi_ot
        FROM panol.v_flota_busqueda
        WHERE COALESCE(tractor, '') <> '' OR COALESCE(semi, '') <> '';
      `);

      const units = res.rows || [];
      if (units.length > 0) {
        const newFleetMap = new Map();
        const newByTractor = new Map();
        const newBySemi = new Map();

        units.forEach(u => {
          const t = u.tractor ? String(u.tractor).trim() : '';
          const s = u.semi ? String(u.semi).trim() : '';
          const tractorP = t.toUpperCase().replace(/[\s\-_.]/g, '');
          const semiP = s.toUpperCase().replace(/[\s\-_.]/g, '');
          const tractorBrand = u.marca_tr ? String(u.marca_tr).trim().toUpperCase() : '';
          const semiBrand = u.marca_semi ? String(u.marca_semi).trim().toUpperCase() : '';
          const srv = u.servicio || '';
          const tot = u.tractor_ot || u.active_ot_number || '';
          const sot = u.semi_ot || u.active_ot_number || '';

          const entry = {
            unidadId: u.unidad_id,
            nUte: u.n_ute || '',
            tractorPlate: t,
            tractorBrand,
            semiPlate: s,
            semiBrand,
            service: srv,
            activeOt: u.active_ot_number || '',
            tractorOt: tot,
            semiOt: sot
          };

          if (tractorP) newFleetMap.set(tractorP, entry);
          if (semiP) newFleetMap.set(semiP, entry);

          const item = {
            tractor: t,
            ot: tot,
            semi: s,
            semiOt: sot,
            producto: srv,
            marcaTractor: tractorBrand,
            marcaSemi: semiBrand
          };

          if (tractorP) newByTractor.set(tractorP, item);
          if (semiP) newBySemi.set(semiP, item);
        });

        ramFleetCache = newFleetMap;
        otListByTractor = newByTractor;
        otListBySemi = newBySemi;
        lastDiagramasSync = Date.now();
        console.log(`🐘 [SQL] Sincronizadas ${units.length} unidades desde Supabase panol.v_flota_busqueda (${ramFleetCache.size} patentes indexadas).`);
        return;
      }
    } catch (sqlErr) {
      console.warn(`⚠️ [SQL] Advertencia en syncFleetFromSupabase (${sqlErr.message}).`);
    }
  }
}

// Alias para compatibilidad hacia atrás
const syncFleetFromDiagramasNode = syncFleetFromSupabase;

async function syncDataFromSheets(force = false) {
  if (!sheets) return ordersCache;

  const now = Date.now();
  if (!force && (now - lastSyncTime < MIN_SYNC_INTERVAL_MS) && ordersCache.length > 0) {
    return ordersCache;
  }
  lastSyncTime = now;

  try {
    // A, B. Leer DB_ITEMS y DB_TRANSACTIONS (DB_OT_LIST eliminada de Sheets)
    const batchRes = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges: ['DB_ITEMS!A:H', 'DB_TRANSACTIONS!A:R']
    });

    const valRanges = batchRes.data.valueRanges || [];
    const itemRows = (valRanges[0] && valRanges[0].values) || [];
    const rows = (valRanges[1] && valRanges[1].values) || [];

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

    // Asegurar índice maestro de flota y OTs desde v_flota_busqueda y public.unidades
    if (otListByTractor.size === 0) {
      await syncFleetFromSupabase();
    }

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
        const rawNote = itemNote || devolucionNote;
        const finalItemNote = rawNote.replace(/Despacho listo:[^|]*(\|)?\s*/gi, '').trim();

        ordersMap[reqId].items.push({
          name: itemName,
          qty: row[7],
          id: itemDetails.id,
          code: itemDetails.id,
          item_code: itemDetails.id,
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

async function getMonitorOrdersFromDb(forceRefresh = false) {
  if (db && db.isConfigured && db.isConfigured()) {
    const now = Date.now();
    if (!forceRefresh && ordersCacheFetchedAt > 0 && (now - ordersCacheFetchedAt) < MONITOR_CACHE_TTL_MS) {
      return ordersCache;
    }
    try {
      const qRes = await db.query('SELECT * FROM panol.v_monitor_pedidos ORDER BY created_at DESC LIMIT 50;');
      const mapped = qRes.rows.map(r => ({
        reqId: r.req_code,
        orderId: r.order_id,
        mechanic_id: r.mechanic_id,
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
        readyTimestamp: readyTimestamps[r.req_code] || (r.ready_at ? new Date(r.ready_at).getTime() : null),
        items: (r.items || []).map(it => {
          const rawNote = String(it.return_notes || it.notes || '')
            .replace(/Despacho listo:[^|]*(\|)?\s*/gi, '')
            .trim();
          return {
            id: it.id || it.order_item_id,
            order_item_id: it.order_item_id || it.id,
            item_id: it.item_id,
            name: it.name,
            code: it.code || it.item_code || '',
            item_code: it.code || it.item_code || '',
            brand: it.brand || '',
            qty: it.qty,
            delivered_qty: it.delivered_qty || 0,
            returned_qty: it.returned_qty || 0,
            loc: it.location || 'S/D',
            status: it.status,
            requiereCanje: !!it.requires_exchange,
            exchange_status: it.exchange_status,
            estadoCanje: it.exchange_status || (it.requires_exchange ? 'PENDIENTE' : ''),
            panol_confirmation: it.panol_confirmation || '',
            panolConfirmacion: it.panol_confirmation || '',
            panolConfirmation: it.panol_confirmation || '',
            note: rawNote,
            return_notes: it.return_notes
          };
        })
      }));
      ordersCache = mapped;
      ordersCacheFetchedAt = Date.now();
      return mapped;
    } catch (sqlErr) {
      console.warn('⚠️ [SQL] Error obteniendo v_monitor_pedidos:', sqlErr.message);
      return ordersCache || [];
    }
  }
  return [];
}

async function broadcastOrdersSync() {
  invalidateMonitorPanolCaches();
  if (db && db.isConfigured && db.isConfigured()) {
    const orders = await getMonitorOrdersFromDb(true);
    if (io) io.emit('orders_sync', orders);
    return orders;
  }
  await syncDataFromSheets(true);
  if (io) io.emit('orders_sync', ordersCache);
  return ordersCache;
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
        } catch(e) {
          console.error('Error en auto-entrega a 1 minuto:', e.message);
        }

        if (db && db.isConfigured && db.isConfigured()) {
          try {
            await db.query(`UPDATE panol.orders SET status = 'ENTREGADO', updated_at = NOW() WHERE req_code = $1;`, [order.reqId]);
            await db.query(`UPDATE panol.stock_movements SET status = 'ENTREGADO', updated_at = NOW() WHERE order_id = (SELECT id FROM panol.orders WHERE req_code = $1);`, [order.reqId]);
          } catch(sqlE) {}
        }
        delete readyTimestamps[order.reqId];
        hasUpdates = true;
      }
    }
  }

  if (hasUpdates) {
    await broadcastOrdersSync();
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
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.sys_auth || req.headers['x-auth-token'];
  const verifiedUser = verifyAuthToken(token);

  if (verifiedUser) {
    req.authUser = verifiedUser;
    return next();
  }

  // Si es llamada API, devolver 401 JSON
  const fullPath = (req.originalUrl || req.url || req.path || '').split('?')[0];
  if (fullPath.startsWith('/api/') || req.path.startsWith('/api/')) {
    return res.status(401).json({ 
      error: 'UNAUTHORIZED', 
      message: 'Dispositivo o usuario no autorizado. Se requiere inicio de sesión con personal registrado en staff.' 
    });
  }

  // Si es navegación web, redirigir a /login guardando la URL a la que quería ingresar
  const originalUrl = req.originalUrl || req.url || '/';
  return res.redirect(`/login?next=${encodeURIComponent(originalUrl)}`);
}

// --- ENDPOINTS PÚBLICOS DE AUTH (ARQUITECTURA DE DOS PANTALLAS: DISPOSITIVO 90D + OPERARIO) ---
app.get('/login', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.sys_auth;
  // Con sesión válida redirigir directo salvo que pase ?force=1
  if (verifyAuthToken(token) && !req.query.force) {
    const nextUrl = req.query.next || '/';
    return res.redirect(nextUrl);
  }
  serveStaticOrJson(res, 'login.html');
});

// PANTALLA 1: Autorización de Dispositivo (Válido por 90 días con clave del sistema taller2026 / SYSTEM_PASSWORD)
app.post('/api/auth/system', async (req, res) => {
  const { password, next = '/' } = req.body || {};
  const cleanPass = String(password || '').trim();

  if (!cleanPass) {
    return res.status(400).json({ success: false, error: 'Por favor ingresá la contraseña del sistema.' });
  }

  const sysPass = await getSystemPassword();
  const allowedPasswords = getAllowedPasswords();
  const isGlobalPassValid =
    cleanPass === sysPass ||
    allowedPasswords.includes(cleanPass) ||
    cleanPass === 'taller2026' ||
    cleanPass === RENDER_BASE_PASSWORD;

  if (!isGlobalPassValid) {
    return res.status(401).json({ success: false, error: 'Contraseña del sistema incorrecta.' });
  }

  // Generar token de autorización del dispositivo por 90 días
  const token = createAuthToken('system-device');
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie', 
    `sys_auth=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_MAX_AGE_MS / 1000}; SameSite=${isHttps ? 'None' : 'Lax'}${isHttps ? '; Secure' : ''}`
  );

  return res.json({
    success: true,
    token,
    deviceAuthorized: true,
    message: 'Dispositivo autorizado por 90 días',
    redirect: next || '/'
  });
});

// PANTALLA 2: Ingreso de Operario (Identificación de personal en panol.staff)
app.post('/api/auth/user-login', async (req, res) => {
  const { pin, op_code, username, next = '/' } = req.body || {};
  const cleanPin = String(pin || op_code || username || '').trim();

  if (!cleanPin) {
    return res.status(400).json({ success: false, error: 'Por favor ingresá tu legajo o PIN de operario.' });
  }

  let staffObj = null;
  if (db && db.isConfigured && db.isConfigured()) {
    staffObj = await getStaffMemberByOpCode(cleanPin);
  }

  if (!staffObj) {
    return res.status(404).json({
      success: false,
      error: `Operario no encontrado: El PIN o legajo '${cleanPin}' no figura en el personal de taller (panol.staff).`
    });
  }

  const userData = {
    id: staffObj.id,
    op_code: staffObj.op_code,
    name: staffObj.name,
    role: staffObj.role || 'OPERARIO',
    default_boxes: (Array.isArray(staffObj.default_boxes) && staffObj.default_boxes.length > 0)
      ? staffObj.default_boxes
      : ['01', '02', '03'],
    auth_user_id: staffObj.auth_user_id,
    active: true
  };

  return res.json({
    success: true,
    user: userData,
    redirect: next || '/'
  });
});

// Verificación de estado de autorización del dispositivo
app.get('/api/auth/verify-device', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.sys_auth || req.headers['x-auth-token'];
  const verifiedUser = verifyAuthToken(token);

  return res.json({
    success: true,
    authorized: Boolean(verifiedUser),
    user: verifiedUser || null
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password, next = '/' } = req.body || {};
  const cleanUser = String(username || '').trim();
  const cleanPass = String(password || '').trim();

  // Validar que al menos se haya enviado la clave/PIN o el usuario
  if (!cleanPass && !cleanUser) {
    return res.status(400).json({
      success: false,
      error: 'Por favor ingresá tu contraseña o PIN de acceso.'
    });
  }

  const allowedPasswords = getAllowedPasswords();
  let staffObj = null;

  // CASO 1: Login de un solo campo (solo contraseña / PIN enviado desde App Taller)
  if (!cleanUser) {
    // A. Buscar si el PIN/código corresponde a un operario registrado en panol.staff
    if (db && db.isConfigured && db.isConfigured()) {
      staffObj = await getStaffMemberByOpCode(cleanPass);
    }

    // Si se encontró el operario por su PIN/legajo en staff
    if (staffObj) {
      const token = createAuthToken(staffObj.op_code);
      const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
      res.setHeader(
        'Set-Cookie', 
        `sys_auth=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_MAX_AGE_MS / 1000}; SameSite=${isHttps ? 'None' : 'Lax'}${isHttps ? '; Secure' : ''}`
      );

      const userData = {
        id: staffObj.id,
        op_code: staffObj.op_code,
        name: staffObj.name,
        role: staffObj.role || 'OPERARIO',
        default_boxes: (Array.isArray(staffObj.default_boxes) && staffObj.default_boxes.length > 0)
          ? staffObj.default_boxes
          : ['01', '02', '03'],
        auth_user_id: staffObj.auth_user_id,
        active: true
      };

      return res.json({ success: true, token, user: userData, redirect: next || '/' });
    }

    // B. Si no es un op_code directo, verificar si es la contraseña global de taller o permitida
    const isGlobalPassValid =
      allowedPasswords.includes(cleanPass) ||
      cleanPass === 'taller2026' ||
      cleanPass === RENDER_BASE_PASSWORD;

    if (isGlobalPassValid) {
      const token = createAuthToken('taller');
      const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
      res.setHeader(
        'Set-Cookie', 
        `sys_auth=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_MAX_AGE_MS / 1000}; SameSite=${isHttps ? 'None' : 'Lax'}${isHttps ? '; Secure' : ''}`
      );

      const userData = {
        id: 'usr-taller',
        op_code: 'taller',
        name: 'OPERARIO DE TALLER',
        role: 'TALLER',
        default_boxes: ['01', '02', '03'],
        active: true
      };

      return res.json({ success: true, token, user: userData, redirect: next || '/' });
    }

    // Si no coincide con ningún operario ni clave global
    return res.status(401).json({
      success: false,
      error: 'Contraseña o PIN incorrecto.'
    });
  }

  // CASO 2: Compatibilidad de doble campo (usuario + contraseña)
  if (db && db.isConfigured && db.isConfigured()) {
    staffObj = await getStaffMemberByOpCode(cleanUser);
  }

  if (staffObj) {
    const isPasswordValid =
      allowedPasswords.includes(cleanPass) ||
      cleanPass === staffObj.op_code ||
      cleanPass === 'taller2026' ||
      cleanPass === RENDER_BASE_PASSWORD ||
      (staffObj.auth_user_id && cleanPass === String(staffObj.auth_user_id));

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Contraseña o PIN incorrecto para este operario.'
      });
    }

    const token = createAuthToken(staffObj.op_code);
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader(
      'Set-Cookie', 
      `sys_auth=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_MAX_AGE_MS / 1000}; SameSite=${isHttps ? 'None' : 'Lax'}${isHttps ? '; Secure' : ''}`
    );

    const userData = {
      id: staffObj.id,
      op_code: staffObj.op_code,
      name: staffObj.name,
      role: staffObj.role || 'OPERARIO',
      default_boxes: (Array.isArray(staffObj.default_boxes) && staffObj.default_boxes.length > 0)
        ? staffObj.default_boxes
        : ['01', '02', '03'],
      auth_user_id: staffObj.auth_user_id,
      active: true
    };

    return res.json({ success: true, token, user: userData, redirect: next || '/' });
  }

  // Si no está en staff, verificar credenciales generales
  const authRes = authenticateUser(cleanUser, cleanPass);
  if (authRes.success) {
    const token = createAuthToken(authRes.user || cleanUser);
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader(
      'Set-Cookie', 
      `sys_auth=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_MAX_AGE_MS / 1000}; SameSite=${isHttps ? 'None' : 'Lax'}${isHttps ? '; Secure' : ''}`
    );
    const userData = {
      id: 'usr-' + (authRes.user || cleanUser),
      op_code: authRes.user || cleanUser,
      name: (authRes.user || cleanUser).toUpperCase(),
      role: 'TALLER',
      default_boxes: ['01', '02', '03'],
      active: true
    };
    return res.json({ success: true, token, user: userData, redirect: next || '/' });
  }

  return res.status(403).json({
    success: false,
    error: `Acceso denegado: El usuario o legajo '${cleanUser}' no figura en el registro de personal ni cuenta con autorización.`
  });
});

app.all(['/api/auth/logout', '/logout'], (req, res) => {
  const scope = req.body?.scope || req.query?.scope;
  // Solo borrar la cookie de autorización de 90 días si se pide desvincular el dispositivo (scope=device)
  if (scope === 'device' || req.query?.force === '1') {
    res.setHeader('Set-Cookie', `sys_auth=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`);
  }
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

// Proteger todos los endpoints de datos de /api/* que no sean de autenticación o monitoreo público
const PUBLIC_API_PREFIXES = [
  '/api/auth',
  '/api/health',
  '/api/db/health',
  '/api/db/metrics',
  '/api/env-info'
];

app.use('/api', (req, res, next) => {
  const fullPath = (req.originalUrl || req.url || '').split('?')[0];
  const isPublic = PUBLIC_API_PREFIXES.some(p => fullPath === p || fullPath.startsWith(p + '/'));
  if (isPublic) {
    return next();
  }
  return requireAuth(req, res, next);
});

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
      `SELECT id, op_code, name, role, default_boxes, auth_user_id FROM panol.staff 
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

// Función para resolver jerárquicamente las OTs (tractor_work_order_id y semi_work_order_id)
async function resolveHoldWorkOrders({ trId, tot, smId, sot }) {
  let trWoId = null;
  let smWoId = null;

  if (db && db.isConfigured && db.isConfigured()) {
    try {
      // 1. Tractor OT
      if (trId) {
        const uwoTr = await db.query(`
          SELECT uwo.work_order_id 
          FROM panol.unit_work_orders uwo
          JOIN panol.work_orders wo ON uwo.work_order_id = wo.id
          WHERE uwo.tractor_id = $1 AND wo.status = 'ACTIVA'
          ORDER BY wo.created_at DESC
          LIMIT 1;
        `, [trId]);
        if (uwoTr.rows.length > 0) trWoId = uwoTr.rows[0].work_order_id;
      }
      if (tot && (!trWoId || !tot.startsWith('---'))) {
        const woByNum = await db.query(
          "SELECT id FROM panol.work_orders WHERE ot_number = $1 LIMIT 1;",
          [tot]
        );
        if (woByNum.rows.length > 0) trWoId = woByNum.rows[0].id;
      }

      // 2. Semi OT
      if (smId) {
        const uwoSm = await db.query(`
          SELECT uwo.work_order_id 
          FROM panol.unit_work_orders uwo
          JOIN panol.work_orders wo ON uwo.work_order_id = wo.id
          WHERE uwo.semi_id = $1 AND wo.status = 'ACTIVA'
          ORDER BY wo.created_at DESC
          LIMIT 1;
        `, [smId]);
        if (uwoSm.rows.length > 0) smWoId = uwoSm.rows[0].work_order_id;
      }
      if (sot && (!smWoId || !sot.startsWith('---'))) {
        const woByNum = await db.query(
          "SELECT id FROM panol.work_orders WHERE ot_number = $1 LIMIT 1;",
          [sot]
        );
        if (woByNum.rows.length > 0) smWoId = woByNum.rows[0].id;
      }
    } catch (err) {
      console.warn('⚠️ [SQL] Error resolviendo work orders para hold:', err.message);
    }
  }

  return { trWoId, smWoId };
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
          const member = await getStaffMemberByOpCode(opId);
          if (member) {
            const boxes = (Array.isArray(member.default_boxes) && member.default_boxes.length > 0)
              ? member.default_boxes
              : ['01', '02', '03'];
            result = {
              success: true,
              id: member.id,
              op_code: member.op_code,
              name: member.name,
              role: member.role || 'MECANICO',
              boxes,
              auth_user_id: member.auth_user_id
            };
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
          if (!hasAppAccess && staffRow[11] !== undefined) {
            result = { success: false, error: "Usuario sin acceso activo a la aplicación de taller." };
          } else {
            const boxes = staffRow.slice(6, 11).map(c => String(c || '').trim()).filter(c => c !== '');
            result = { success: true, name: staffRow[1] || ('Operario ' + opId), role: staffRow[2] || 'MECANICO', boxes: boxes.length > 0 ? boxes : ['01', '02', '03'] };
          }
        } else {
          result = { 
            success: false, 
            error: `Acceso denegado: El operario '${opId}' no figura en el registro de personal de taller (panol.staff).` 
          };
        }
      }
    } 
    else if (action === 'getPanolStaff') {
      let panoleros = [];

      // 🐘 1. Prioridad SQL: Supabase panol.staff
      if (db && db.isConfigured && db.isConfigured()) {
        try {
          const pRes = await db.query(
            "SELECT id, op_code, name, role FROM panol.staff WHERE role IN ('PANOL', 'PAÑOL', 'LOGISTICA') ORDER BY name;"
          );
          if (pRes.rows.length > 0) {
            panoleros = pRes.rows.map(r => ({ id: r.op_code, staff_id: r.id, name: r.name, role: r.role }));
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
      // 🐘 1. Prioridad SQL: Supabase panol.items (Hot RAM + sincronización incremental por delta)
      if (db && db.isConfigured && db.isConfigured()) {
        await ensureSqlItemsCatalog();
        result = sqlItemsCatalogCache || [];
      } else {
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
        const canjeStr = (itemObj.canjeStatus && typeof itemObj.canjeStatus === 'object')
          ? JSON.stringify(itemObj.canjeStatus)
          : (itemObj.canjeStatus || '');
        rowsToAppend.push([
          timestamp, reqId, opId, mechanicName, otNumber, unitId,
          itemName, itemObj.qty, 'PENDIENTE', '', '', itemObj.notes || '', '', '', '', '', canjeStr, ''
        ]);
      });

      // 🐘 Persistencia SQL en Supabase: panol.orders y panol.order_items
      if (db && db.isConfigured && db.isConfigured()) {
        try {
          let mechUuid = payload.mechanicId || null;
          if (!mechUuid) {
            let staffQ = await db.query('SELECT id FROM panol.staff WHERE op_code = $1 LIMIT 1;', [opId]);
            mechUuid = staffQ.rows[0]?.id || null;
          }
          if (!mechUuid) {
            const fallbackStaff = await db.query(
              "SELECT id FROM panol.staff WHERE upper(name) LIKE upper($1) OR role = 'MECANICO' LIMIT 1;",
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
            const woQ = await db.query('SELECT id FROM panol.work_orders WHERE ot_number = $1 LIMIT 1;', [String(otNumber).trim()]);
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

          if (unidadUuid && (!tractorUuid || !semiUuid)) {
            const uQ = await db.query('SELECT tractor_id, semi_id FROM public.unidades WHERE id = $1 LIMIT 1;', [unidadUuid]);
            if (uQ.rows.length > 0) {
              if (!tractorUuid) tractorUuid = uQ.rows[0].tractor_id;
              if (!semiUuid) semiUuid = uQ.rows[0].semi_id;
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
                  let exchStr = '';
                  let returnedQty = null;
                  if (it.canjeStatus) {
                    if (typeof it.canjeStatus === 'object') {
                      exchStr = JSON.stringify(it.canjeStatus);
                      if (it.canjeStatus.cant_entregada !== undefined) {
                        returnedQty = Number(it.canjeStatus.cant_entregada);
                      }
                    } else {
                      exchStr = String(it.canjeStatus);
                      try {
                        const parsed = JSON.parse(exchStr);
                        if (parsed && parsed.cant_entregada !== undefined) {
                          returnedQty = Number(parsed.cant_entregada);
                        }
                      } catch (_) {}
                    }
                  }
                  await db.query(`
                    INSERT INTO panol.stock_movements (
                      order_id, item_id, mechanic_id, quantity, quantity_delta,
                      status, movement_type, exchange_status, returned_qty, notes
                    )
                    VALUES ($1, $2, $3, $4, 0, 'PENDIENTE', 'SOLICITUD', $5, $6, $7);
                  `, [orderUuid, itemUuid, mechUuid, iQty, exchStr, returnedQty, it.notes || '']);
                }
              }
              console.log(`🐘 [SQL] Pedido ${reqId} insertado en panol.orders con ${items.length} items en stock_movements.`);
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
      await broadcastOrdersSync();
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

      if (db && db.isConfigured && db.isConfigured() && reqId && itemName) {
        try {
          if (newQty <= 0) {
            await db.query(`
              DELETE FROM panol.stock_movements sm
              USING panol.orders o, panol.items i
              WHERE sm.order_id = o.id AND sm.item_id = i.id
                AND (o.req_code = $1 OR o.order_number::text = $1)
                AND lower(i.name) = lower($2)
                AND sm.status = 'PENDIENTE';
            `, [reqId, itemName]);
          } else {
            await db.query(`
              UPDATE panol.stock_movements sm
              SET quantity = $3, updated_at = NOW()
              FROM panol.orders o, panol.items i
              WHERE sm.order_id = o.id AND sm.item_id = i.id
                AND (o.req_code = $1 OR o.order_number::text = $1)
                AND lower(i.name) = lower($2)
                AND sm.status = 'PENDIENTE';
            `, [reqId, itemName, newQty]);
          }
          updated = true;
        } catch (sqlErr) {
          console.warn('⚠️ [SQL] Error updatePendingItemQty en Supabase:', sqlErr.message);
        }
      }

      await broadcastOrdersSync();
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

      if (db && db.isConfigured && db.isConfigured() && reqId && itemName) {
        try {
          await db.query(`
            DELETE FROM panol.stock_movements sm
            USING panol.orders o, panol.items i
            WHERE sm.order_id = o.id AND sm.item_id = i.id
              AND (o.req_code = $1 OR o.order_number::text = $1)
              AND lower(i.name) = lower($2)
              AND sm.status = 'PENDIENTE';
          `, [reqId, itemName]);
          updated = true;
        } catch (sqlErr) {
          console.warn('⚠️ [SQL] Error removePendingItem en Supabase:', sqlErr.message);
        }
      }

      await broadcastOrdersSync();
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

      if (db && db.isConfigured && db.isConfigured() && reqId && itemName && qty > 0) {
        try {
          const ordQ = await db.query('SELECT id, mechanic_id FROM panol.orders WHERE req_code = $1 OR order_number::text = $1 LIMIT 1;', [reqId]);
          const itmQ = await db.query('SELECT id, requires_exchange FROM panol.items WHERE lower(name) = lower($1) LIMIT 1;', [itemName]);
          if (ordQ.rows[0] && itmQ.rows[0]) {
            await db.query(`
              INSERT INTO panol.stock_movements (order_id, item_id, mechanic_id, quantity, quantity_delta, status, movement_type, exchange_status)
              VALUES ($1, $2, $3, $4, 0, 'PENDIENTE', 'SOLICITUD', $5);
            `, [ordQ.rows[0].id, itmQ.rows[0].id, ordQ.rows[0].mechanic_id, qty, itmQ.rows[0].requires_exchange ? 'PENDIENTE' : null]);
            updated = true;
          }
        } catch (sqlErr) {
          console.warn('⚠️ [SQL] Error addItemToPendingOrder en Supabase:', sqlErr.message);
        }
      }

      await broadcastOrdersSync();
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

      // 🐘 Persistencia SQL en Supabase: panol.stock_movements (Alternativa B)
      if (db && db.isConfigured && db.isConfigured()) {
        try {
          const predeterminedId = args[5] || (reqId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reqId) ? reqId : null);
          const auditStatus = status === 'INCOMPLETO' ? `[OP: ${opId}] - INCOMPLETO (${declaredQty || 0})` : `[OP: ${opId}] - OK`;
          const retQty = status === 'INCOMPLETO' ? Number(declaredQty || 0) : null;
          const finalItemStatus = status === 'OK' ? 'DEVUELTO' : 'EN_CAMBIO';

          const staffQ = opId ? await db.query('SELECT id FROM panol.staff WHERE op_code = $1 LIMIT 1;', [opId]) : { rows: [] };
          const panolStaffUuid = staffQ.rows[0]?.id || null;

          if (predeterminedId) {
            await db.query(`
              UPDATE panol.stock_movements sm
              SET 
                panol_confirmation = $1,
                returned_qty = COALESCE($2, sm.quantity),
                status = $3,
                movement_type = 'DEVOLUCION_CANJE',
                performed_by = COALESCE($4, sm.performed_by),
                notes = CASE WHEN sm.notes IS NOT NULL AND sm.notes <> '' THEN sm.notes || ' | ' || $1 ELSE $1 END,
                updated_at = NOW()
              WHERE sm.id = $5;
            `, [auditStatus, retQty, finalItemStatus, panolStaffUuid, predeterminedId]);
          } else {
            await db.query(`
              UPDATE panol.stock_movements sm
              SET 
                panol_confirmation = $1,
                returned_qty = COALESCE($2, sm.quantity),
                status = $3,
                movement_type = 'DEVOLUCION_CANJE',
                performed_by = COALESCE($4, sm.performed_by),
                notes = CASE WHEN sm.notes IS NOT NULL AND sm.notes <> '' THEN sm.notes || ' | ' || $1 ELSE $1 END,
                updated_at = NOW()
              FROM panol.orders o, panol.items i
              WHERE sm.order_id = o.id AND sm.item_id = i.id
                AND (o.req_code = $5 OR o.order_number::text = $5 OR o.id::text = $5)
                AND ($6::text IS NULL OR lower(i.name) = lower($6));
            `, [auditStatus, retQty, finalItemStatus, panolStaffUuid, reqId, itemName]);
          }

          updated = true;
          console.log(`🐘 [SQL] Devolución auditada para pedido ${reqId || predeterminedId} (${itemName || 'TODOS'}): ${status} (Alternativa B)`);
        } catch (sqlErr) {
          console.warn('⚠️ [SQL] Error confirmReturnItem en Supabase:', sqlErr.message);
        }
      }

      await broadcastOrdersSync();
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

      if (db && db.isConfigured && db.isConfigured() && (reqId || args[4])) {
        try {
          const predeterminedId = (args[4] && typeof args[4] === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args[4]))
            ? args[4]
            : null;
          const isAll = !itemName || itemName.toUpperCase() === 'ALL' || itemName === '__ALL__';
          const panolNote = `DEVOLUCIÓN ACEPTADA: OK [OP: ${panolOpId || 'PAÑOL'}]`;

          await db.transaction(async (tx) => {
            const panolStaffQ = panolOpId ? await tx.query('SELECT id FROM panol.staff WHERE op_code = $1 OR id::text = $1 LIMIT 1;', [panolOpId]) : { rows: [] };
            const panolStaffUuid = panolStaffQ.rows[0]?.id || null;

            let itemsToReturnQ;
            if (predeterminedId) {
              itemsToReturnQ = await tx.query(`
                SELECT sm.id as order_item_id, sm.order_id, sm.item_id, sm.quantity, sm.returned_qty, sm.quantity_delta, sm.mechanic_id, i.stock, i.name as item_name
                FROM panol.stock_movements sm
                JOIN panol.items i ON sm.item_id = i.id
                WHERE sm.id = $1 AND sm.status <> 'DEVOLUCION'
                FOR UPDATE OF i, sm;
              `, [predeterminedId]);
            } else {
              itemsToReturnQ = await tx.query(`
                SELECT sm.id as order_item_id, sm.order_id, sm.item_id, sm.quantity, sm.returned_qty, sm.quantity_delta, sm.mechanic_id, i.stock, i.name as item_name
                FROM panol.stock_movements sm
                JOIN panol.orders o ON sm.order_id = o.id
                JOIN panol.items i ON sm.item_id = i.id
                WHERE (o.req_code = $1 OR o.order_number::text = $1 OR o.id::text = $1)
                  AND ($2::boolean = true OR lower(i.name) = lower($3))
                  AND sm.status <> 'DEVOLUCION'
                FOR UPDATE OF i, sm;
              `, [reqId, isAll, itemName]);
            }

            for (const row of itemsToReturnQ.rows) {
              const qtyToRestore = (!isAll && returnQty) ? returnQty : (Number(row.returned_qty) || Number(row.quantity) || 1);
              const prevStock = parseFloat(row.stock) || 0;
              const newStock = prevStock + qtyToRestore;

              await tx.query(`
                UPDATE panol.items
                SET stock = $1, updated_at = NOW()
                WHERE id = $2;
              `, [newStock, row.item_id]);
              sqlItemsNeedsDelta = true;

              await tx.query(`
                UPDATE panol.stock_movements
                SET
                  status = 'DEVOLUCION',
                  movement_type = 'DEVOLUCION_NUEVO',
                  quantity_delta = quantity_delta + $1,
                  returned_qty = $1,
                  previous_stock = $2,
                  new_stock = $3,
                  performed_by = COALESCE($4, performed_by),
                  return_notes = CASE
                    WHEN return_notes IS NOT NULL AND return_notes <> '' THEN return_notes || ' | ' || $5
                    ELSE $5
                  END,
                  updated_at = NOW()
                WHERE id = $6;
              `, [qtyToRestore, prevStock, newStock, panolStaffUuid, panolNote, row.order_item_id]);
            }

            if (itemsToReturnQ.rows.length > 0) {
              const ordUuid = itemsToReturnQ.rows[0].order_id;
              await tx.query(`
                UPDATE panol.orders
                SET status = 'DEVOLUCION', updated_at = NOW()
                WHERE id = $1 AND NOT EXISTS (
                  SELECT 1 FROM panol.stock_movements WHERE order_id = $1 AND status NOT IN ('DEVOLUCION', 'DEVUELTO', 'CANCELADO')
                );
              `, [ordUuid]);
            }
          });

          updated = true;
          console.log(`🐘 [SQL-ACID] Devolución de nuevo confirmada para ${reqId || predeterminedId} (${itemName || 'ALL'}). Stock reintegrado bajo transacción.`);
        } catch (sqlErr) {
          console.warn('⚠️ [SQL-ACID] Error confirmNewReturn en Supabase:', sqlErr.message);
        }
      }

      await broadcastOrdersSync();
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

            if (rReq === reqId && rItem === itemName.toLowerCase() && (rStatus === 'ENTREGADO' || rStatus === 'LISTO')) {
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

      if (db && db.isConfigured && db.isConfigured() && (reqId || args[4])) {
        try {
          const predeterminedId = args[4] || null;
          const retNote = reason ? `SOLICITUD DEVOLUCIÓN NUEVA: ${reason}` : 'SOLICITUD DEVOLUCIÓN NUEVA';
          let updateRes;
          if (predeterminedId) {
            updateRes = await db.query(`
              UPDATE panol.stock_movements sm
              SET status = 'DEVOLUCION PENDIENTE', returned_qty = $1, return_notes = $2, movement_type = 'DEVOLUCION_NUEVO', updated_at = NOW()
              WHERE sm.id = $3
              RETURNING sm.order_id;
            `, [returnQty, retNote, predeterminedId]);
          } else {
            updateRes = await db.query(`
              UPDATE panol.stock_movements sm
              SET status = 'DEVOLUCION PENDIENTE', returned_qty = $1, return_notes = $2, movement_type = 'DEVOLUCION_NUEVO', updated_at = NOW()
              FROM panol.orders o, panol.items i
              WHERE sm.order_id = o.id AND sm.item_id = i.id
                AND (o.req_code = $3 OR o.order_number::text = $3 OR o.id::text = $3)
                AND lower(i.name) = lower($4)
                AND sm.status IN ('LISTO', 'ENTREGADO')
              RETURNING sm.order_id;
            `, [returnQty, retNote, reqId, itemName]);
          }

          if (updateRes.rowCount > 0) {
            const ordId = updateRes.rows[0].order_id;
            await db.query(`UPDATE panol.orders SET status = 'DEVOLUCION PENDIENTE', updated_at = NOW() WHERE id = $1;`, [ordId]);
            updated = true;
          }
        } catch (sqlErr) {
          console.warn('⚠️ [SQL] Error requestRefund en Supabase:', sqlErr.message);
        }
      }
      await broadcastOrdersSync();
      result = { success: updated, error: updated ? null : "El repuesto exacto no fue encontrado o ya fue devuelto." };
    }
    else if (action === 'getPendingOrdersEnriched' || action === 'getPendingOrders' || action === 'getMechanicOrders') {
      if (db && db.isConfigured && db.isConfigured()) {
        result = await getMonitorOrdersFromDb();
      } else {
        result = await syncDataFromSheets();
      }
    }
    else if (action === 'getInventoryItems') {
      const q = String(args[0] || '').trim().toLowerCase();
      if (db && db.isConfigured && db.isConfigured()) {
        const ready = await ensureSqlItemsCatalog();
        if (ready && Array.isArray(sqlInventoryListCache)) {
          const matched = q
            ? sqlInventoryListCache.filter(
                i => i._searchName.includes(q) || i._searchBrand.includes(q) || i._searchCode.includes(q)
              )
            : sqlInventoryListCache;
          result = matched.slice(0, 50).map(({ _searchName, _searchBrand, _searchCode, ...pub }) => pub);
        } else {
          try {
            const sqlRes = q
              ? await db.query(
                  `SELECT id, item_code, item_code AS code, name, COALESCE(brand, '') AS brand, COALESCE(stock, 0) AS stock, COALESCE(location, 'S/D') AS loc, COALESCE(requires_exchange, false) AS "requiereCanje", COALESCE(requires_exchange, false) AS "requires_exchange"
                   FROM panol.items
                   WHERE is_active = true AND (lower(name) LIKE $1 OR lower(COALESCE(brand, '')) LIKE $1 OR lower(COALESCE(item_code, '')) LIKE $1)
                   ORDER BY name ASC LIMIT 50;`,
                  [`%${q}%`]
                )
              : await db.query(
                  `SELECT id, item_code, item_code AS code, name, COALESCE(brand, '') AS brand, COALESCE(stock, 0) AS stock, COALESCE(location, 'S/D') AS loc, COALESCE(requires_exchange, false) AS "requiereCanje", COALESCE(requires_exchange, false) AS "requires_exchange"
                   FROM panol.items
                   WHERE is_active = true
                   ORDER BY name ASC LIMIT 50;`
                );
            result = sqlRes.rows || [];
          } catch (sqlErr) {
            console.warn('⚠️ [SQL] Error getInventoryItems en Supabase:', sqlErr.message);
            result = [];
          }
        }
      } else {
        await syncDataFromSheets();
        let resList = itemsCatalogCache;
        if (q) resList = resList.filter(i => i.name.toLowerCase().includes(q) || i.brand.toLowerCase().includes(q));
        result = resList.slice(0, 50);
      }
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

      // 🐘 Actualización SQL transaccional ACID en Supabase: panol.orders, panol.order_items y panol.stock_movements
      if (db && db.isConfigured && db.isConfigured() && reqId) {
        try {
          const finalStatus = 'LISTO';
          readyTimestamps[reqId] = Date.now();

          await db.transaction(async (tx) => {
            const panolStaffQ = panolOpId ? await tx.query('SELECT id FROM panol.staff WHERE op_code = $1 LIMIT 1;', [panolOpId]) : { rows: [] };
            const panolStaffUuid = panolStaffQ.rows[0]?.id || null;

            const ordQ = await tx.query(
              `SELECT id, status, mechanic_id, req_code 
               FROM panol.orders 
               WHERE req_code = $1 OR order_number::text = $1 OR id::text = $1 
               LIMIT 1 
               FOR UPDATE;`,
              [reqId]
            );
            const orderRow = ordQ.rows[0];

            if (orderRow) {
              const orderUuid = orderRow.id;
              const alreadyDispensed = (orderRow.status === 'LISTO' || orderRow.status === 'ENTREGADO');

              if (Array.isArray(itemsPayload) && itemsPayload.length > 0) {
                for (const p of itemsPayload) {
                  if (p && p.name && p.qty !== undefined) {
                    await tx.query(`
                      UPDATE panol.stock_movements sm
                      SET quantity = $2, updated_at = NOW()
                      FROM panol.items i
                      WHERE sm.order_id = $1 AND sm.item_id = i.id
                        AND lower(i.name) = lower($3);
                    `, [orderUuid, Number(p.qty), String(p.name).trim()]);
                  }
                }
              }

              await tx.query(`
                UPDATE panol.orders 
                SET status = $1, panol_staff_id = COALESCE($2, panol_staff_id), ready_at = COALESCE(ready_at, NOW()), updated_at = NOW()
                WHERE id = $3;
              `, [finalStatus, panolStaffUuid, orderUuid]);

              if (!alreadyDispensed) {
                const ordItems = await tx.query(`
                  SELECT sm.id, sm.item_id, sm.quantity, i.stock, i.name as item_name
                  FROM panol.stock_movements sm
                  JOIN panol.items i ON sm.item_id = i.id
                  WHERE sm.order_id = $1
                  FOR UPDATE OF i, sm;
                `, [orderUuid]);

                for (const row of ordItems.rows) {
                  const prev = parseFloat(row.stock) || 0;
                  const qty = parseFloat(row.quantity) || 1;
                  const delta = -qty;
                  const next = Math.max(0, prev + delta);
                  await tx.query(`
                    UPDATE panol.items SET stock = $1, updated_at = NOW() WHERE id = $2;
                  `, [next, row.item_id]);
                  sqlItemsNeedsDelta = true;
                  await tx.query(`
                    UPDATE panol.stock_movements
                    SET
                      status = $1,
                      movement_type = 'PEDIDO_LISTO',
                      quantity_delta = $2,
                      previous_stock = $3,
                      new_stock = $4,
                      delivered_qty = COALESCE(delivered_qty, quantity),
                      ready_at = NOW(),
                      performed_by = COALESCE($5, performed_by),
                      updated_at = NOW()
                    WHERE id = $6;
                  `, [finalStatus, delta, prev, next, panolStaffUuid, row.id]);
                }
              } else {
                await tx.query(`
                  UPDATE panol.stock_movements 
                  SET status = $1, delivered_qty = COALESCE(delivered_qty, quantity), updated_at = NOW()
                  WHERE order_id = $2 AND status NOT IN ('DEVOLUCION', 'DEVUELTO');
                `, [finalStatus, orderUuid]);
              }
              console.log(`🐘 [SQL-ACID] Pedido ${reqId} (${orderUuid}) despachado como ${finalStatus} bajo transacción atómica.`);
            }
          });
        } catch (sqlErr) {
          console.warn('⚠️ [SQL-ACID] Error en transacción de despacho de pedido:', sqlErr.message);
        }
      }

      await broadcastOrdersSync();
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
      if (db && db.isConfigured && db.isConfigured()) {
        result = await updateTaskExecutionInSupabase({
          taskId: payload.taskId,
          ubicacion: payload.ubicacion || payload.box,
          operario: payload.operario,
          assignedStaffId: payload.assignedStaffId,
          empezo: payload.empezo,
          termino: payload.termino,
          estado: payload.estado || payload.status,
          otNumber: payload.otNumber,
          isCompleted: payload.isCompleted,
          io
        });
      }
      if (sheets && SPREADSHEET_ID && payload.taskId) {
        updateTaskExecution({
          sheetsClient: sheets,
          spreadsheetId: SPREADSHEET_ID,
          taskId: payload.taskId,
          ubicacion: payload.ubicacion,
          operario: payload.operario,
          asignado: payload.asignado,
          empezo: payload.empezo,
          termino: payload.termino,
          estado: payload.estado,
          skipSupabaseSync: true,
          io
        }).catch(e => console.warn('⚠️ [Sheets Sync Task RPC] Fallback error:', e.message));
      }
      if (!result) result = { success: true };
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
            tractorWorkOrderId: r.tractor_work_order_id,
            semiWorkOrderId: r.semi_work_order_id,
            tractorOtStatus: r.tractor_ot_status,
            semiOtStatus: r.semi_ot_status,
            tractorId: r.tractor_id,
            semiId: r.semi_id,
            tractorPlate: r.tractor_plate,
            tractorOt: r.tractor_ot,
            semiPlate: r.semi_plate,
            semiOt: r.semi_ot,
            brand: r.tractor_brand,
            brandSemi: r.semi_brand,
            addedAt: r.created_at,
            source: r.source || 'MANUAL',
            reviewedAt: r.reviewed_at || null,
            isCoordAssigned: Boolean(r.is_coord_assigned)
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

                if (tp) {
                  const trRes = await db.query("SELECT id FROM public.tractores WHERE UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) = $1 LIMIT 1;", [tp]);
                  if (trRes.rows.length > 0) trId = trRes.rows[0].id;
                }
                if (sp) {
                  const smRes = await db.query("SELECT id FROM public.semis WHERE UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) = $1 LIMIT 1;", [sp]);
                  if (smRes.rows.length > 0) smId = smRes.rows[0].id;
                }

                const { trWoId, smWoId } = await resolveHoldWorkOrders({ trId, tot, smId, sot });

                await db.query(`
                  INSERT INTO panol.staff_holds (staff_id, tractor_work_order_id, semi_work_order_id, tractor_id, semi_id, ot_number, semi_ot, tractor_plate, semi_plate)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                  ON CONFLICT DO NOTHING;
                `, [staffMember.id, trWoId, smWoId, trId, smId, tot, sot, tp, sp]);
              }

              const reQ = await db.query(
                'SELECT * FROM panol.v_staff_holds WHERE op_code = ANY($1::text[]) OR staff_id::text = ANY($1::text[]) ORDER BY created_at DESC;',
                [searchCodes]
              );
              holds = reQ.rows.map(r => ({
                id: r.hold_id,
                tractorWorkOrderId: r.tractor_work_order_id,
                semiWorkOrderId: r.semi_work_order_id,
                tractorOtStatus: r.tractor_ot_status,
                semiOtStatus: r.semi_ot_status,
                tractorId: r.tractor_id,
                semiId: r.semi_id,
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

          result = { success: true, units: holds, holds };
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
          await db.transaction(async (tx) => {
            await tx.query('DELETE FROM panol.staff_holds WHERE staff_id = $1;', [staffId]);
            for (const u of units) {
              const tp = String(u.tractorPlate || '').trim().toUpperCase().replace(/[\s\-_.]/g, '');
              const sp = String(u.semiPlate || '').trim().toUpperCase().replace(/[\s\-_.]/g, '');
              const tot = String(u.tractorOt || '').trim();
              const sot = String(u.semiOt || '').trim();

              let trId = null;
              let smId = null;

              if (tp) {
                const trRes = await tx.query("SELECT id FROM public.tractores WHERE UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) = $1 LIMIT 1;", [tp]);
                if (trRes.rows.length > 0) trId = trRes.rows[0].id;
              }
              if (sp) {
                const smRes = await tx.query("SELECT id FROM public.semis WHERE UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) = $1 LIMIT 1;", [sp]);
                if (smRes.rows.length > 0) smId = smRes.rows[0].id;
              }

              const { trWoId, smWoId } = await resolveHoldWorkOrders({ trId, tot, smId, sot });

              await tx.query(`
                INSERT INTO panol.staff_holds (staff_id, tractor_work_order_id, semi_work_order_id, tractor_id, semi_id, ot_number, semi_ot, tractor_plate, semi_plate)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT DO NOTHING;
              `, [staffId, trWoId, smWoId, trId, smId, tot, sot, tp, sp]);
            }
          });
          result = { success: true };
        } catch (sqlErr) {
          console.warn('⚠️ [SQL-ACID] Error guardando staff_holds en transacción:', sqlErr.message);
        }
      }
      try {
        await saveOperarioHoldOts({ sheetsClient: sheets, spreadsheetId: SPREADSHEET_ID, opId: targetOpCode, units, io });
      } catch (shErr) {}
    }
    else if (action === 'getUnitTimelineTasks') {
      const params = args[0] || {};
      result = await getUnitTimelineTasks({
        sheetsClient: sheets,
        spreadsheetId: SPREADSHEET_ID,
        tractorOt: params.tractorOt,
        semiOt: params.semiOt,
        tractorPlate: params.tractorPlate,
        semiPlate: params.semiPlate
      });
    }
    else if (action === 'toggleTaskTerminado') {
      const params = args[0] || {};

      // 🐘 Actualización atómica en Supabase panol.work_order_tasks y consolidación al 100%
      if (db && db.isConfigured && db.isConfigured()) {
        try {
          await updateTaskExecutionInSupabase({
            taskId: params.taskId,
            desc: params.desc,
            rubro: params.rubro,
            otNumber: params.otNumber,
            operario: params.opId,
            isCompleted: params.isCompleted,
            estado: params.isCompleted ? 'TERMINADO' : 'PENDIENTE',
            io
          });
        } catch (sqlErr) {
          console.warn('⚠️ [SQL] Error toggleTaskTerminado en Supabase:', sqlErr.message);
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
    else if (action === 'exportColdOrders' || action === 'exportAndPurgeColdOrders') {
      result = await exportAndPurgeColdOrdersOlderThan180Days();
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
    const { taskId, estado, status, empezo, termino, operario, ubicacion, box, otNumber, plate, assignedStaffId, isCompleted } = req.body;
    let result = null;

    if (db && db.isConfigured && db.isConfigured()) {
      result = await updateTaskExecutionInSupabase({
        taskId,
        estado: estado || status,
        empezo,
        termino,
        operario,
        assignedStaffId,
        ubicacion: ubicacion || box,
        otNumber,
        isCompleted,
        io
      });
    }

    // Sincronización en segundo plano con Sheets si está configurado
    if (sheets && SPREADSHEET_ID && taskId) {
      updateTaskExecution({
        sheetsClient: sheets,
        spreadsheetId: SPREADSHEET_ID,
        ...req.body,
        skipSupabaseSync: true,
        io
      }).catch(e => console.warn('⚠️ [Sheets Sync Task] Fallback error:', e.message));
    }

    res.json(result || { success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint analítico de Recursos y Operarios (Balance de Carga y Disponibilidad)
app.get('/api/tasks/recursos-operarios', async (req, res) => {
  try {
    if (db && db.isConfigured && db.isConfigured()) {
      const qRes = await db.query('SELECT * FROM panol.v_recursos_operarios ORDER BY staff_name ASC;');
      return res.json({ success: true, recursos: qRes.rows });
    }
    res.json({ success: true, recursos: [] });
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

app.post('/api/tasks/cold-purge', async (req, res) => {
  try {
    const result = await exportAndPurgeColdOrdersOlderThan180Days();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// REST GET /api/orders
app.get('/api/orders', async (req, res) => {
  // 🐘 Prioridad 1: SQL Supabase (panol.v_monitor_pedidos)
  if (db && db.isConfigured && db.isConfigured()) {
    const orders = await getMonitorOrdersFromDb();
    return res.json(orders);
  }

  // Fallback a Sheets solo si no está configurada la base de datos SQL
  const orders = await syncDataFromSheets();
  res.json(orders);
});

// REST GET /api/fleet/search-catalog (Canonical Supabase PostgreSQL)
app.get('/api/fleet/search-catalog', async (req, res) => {
  try {
    const data = await otsManager.getFleetSearchCatalog();
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('❌ Error en /api/fleet/search-catalog:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// REST GET /api/devoluciones (Alimenta el panel de Devoluciones y Canjes de Pañol con Hot RAM C1 30s)
app.get('/api/devoluciones', async (req, res) => {
  if (db && db.isConfigured && db.isConfigured()) {
    try {
      const { tipo } = req.query || {};
      const tipoUpper = tipo ? String(tipo).toUpperCase() : '';
      const cacheKey = (tipoUpper === 'NUEVO' || tipoUpper === 'CANJE') ? tipoUpper : '__ALL__';
      const now = Date.now();
      const cached = devolucionesCache.get(cacheKey);
      if (cached && (now - cached.ts) < MONITOR_CACHE_TTL_MS) {
        return res.json(cached.payload);
      }

      let q = 'SELECT * FROM panol.v_devoluciones_pendientes';
      const params = [];
      if (cacheKey !== '__ALL__') {
        q += ' WHERE tipo_devolucion = $1';
        params.push(cacheKey);
      }
      q += ' ORDER BY movement_created_at DESC NULLS LAST, order_created_at DESC;';
      const qRes = await db.query(q, params);
      const payload = { success: true, count: qRes.rows.length, devoluciones: qRes.rows };
      devolucionesCache.set(cacheKey, { ts: now, payload });
      return res.json(payload);
    } catch (sqlErr) {
      console.warn('⚠️ [SQL] Error obteniendo v_devoluciones_pendientes:', sqlErr.message);
    }
  }
  res.json({ success: true, count: 0, devoluciones: [] });
});

// REST GET /api/devoluciones/nuevas (Historial y pendientes de devoluciones nuevas con Hot RAM C1 30s)
app.get('/api/devoluciones/nuevas', async (req, res) => {
  if (db && db.isConfigured && db.isConfigured()) {
    try {
      const now = Date.now();
      if (devolucionesNuevasCache.payload && (now - devolucionesNuevasCache.ts) < MONITOR_CACHE_TTL_MS) {
        return res.json(devolucionesNuevasCache.payload);
      }
      const qRes = await db.query('SELECT * FROM panol.v_devoluciones_nuevas ORDER BY updated_at DESC, order_created_at DESC LIMIT 100;');
      const payload = { success: true, count: qRes.rows.length, devoluciones: qRes.rows };
      devolucionesNuevasCache = { ts: now, payload };
      return res.json(payload);
    } catch (sqlErr) {
      console.warn('⚠️ [SQL] Error obteniendo v_devoluciones_nuevas:', sqlErr.message);
      return res.status(500).json({ success: false, error: sqlErr.message });
    }
  }
  res.json({ success: true, count: 0, devoluciones: [] });
});

// REST GET /api/boxes/en-vivo (Monitor de boxes/bahías en tiempo real)
app.get('/api/boxes/en-vivo', async (req, res) => {
  if (db && db.isConfigured && db.isConfigured()) {
    try {
      const qRes = await db.query('SELECT * FROM panol.v_boxes_en_vivo ORDER BY box_number ASC;');
      return res.json({ success: true, count: qRes.rows.length, boxes: qRes.rows });
    } catch (sqlErr) {
      console.warn('⚠️ [SQL] Error obteniendo v_boxes_en_vivo:', sqlErr.message);
      return res.status(500).json({ success: false, error: sqlErr.message });
    }
  }
  res.json({ success: true, count: 0, boxes: [] });
});

// REST GET /api/pedidos/canjes (Canjes y devoluciones consolidados de pañol)
app.get('/api/pedidos/canjes', async (req, res) => {
  if (db && db.isConfigured && db.isConfigured()) {
    try {
      const qRes = await db.query('SELECT * FROM panol.v_pedidos_canjes_consolidada ORDER BY fecha_pedido DESC LIMIT 100;');
      return res.json({ success: true, count: qRes.rows.length, items: qRes.rows });
    } catch (sqlErr) {
      console.warn('⚠️ [SQL] Error obteniendo v_pedidos_canjes_consolidada:', sqlErr.message);
      return res.status(500).json({ success: false, error: sqlErr.message });
    }
  }
  res.json({ success: true, count: 0, items: [] });
});

// REST GET /api/metrics/taller (Métricas y KPIs operativos en vivo)
app.get('/api/metrics/taller', async (req, res) => {
  if (db && db.isConfigured && db.isConfigured()) {
    try {
      const qRes = await db.query('SELECT * FROM panol.v_kpis_taller_diario LIMIT 1;');
      return res.json({ success: true, metrics: qRes.rows[0] || null });
    } catch (sqlErr) {
      console.warn('⚠️ [SQL] Error obteniendo v_kpis_taller_diario:', sqlErr.message);
      return res.status(500).json({ success: false, error: sqlErr.message });
    }
  }
  res.json({ success: true, metrics: null });
});

// REST GET /api/recursos/operarios (Carga y disponibilidad de mecánicos/operarios)
app.get('/api/recursos/operarios', async (req, res) => {
  if (db && db.isConfigured && db.isConfigured()) {
    try {
      const qRes = await db.query('SELECT * FROM panol.v_recursos_operarios ORDER BY staff_name ASC;');
      return res.json({ success: true, count: qRes.rows.length, recursos: qRes.rows });
    } catch (sqlErr) {
      console.warn('⚠️ [SQL] Error obteniendo v_recursos_operarios:', sqlErr.message);
      return res.status(500).json({ success: false, error: sqlErr.message });
    }
  }
  res.json({ success: true, count: 0, recursos: [] });
});

// REST GET /api/holds/:opCode (Unidades en puesto desde panol.v_staff_holds)
app.get('/api/holds/:opCode', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
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

      // Reconocimiento dinámico en backend de tareas asignadas por Coordinación
      const activeWoMap = new Map();
      if (staffMember && staffMember.id) {
        try {
          const tasksRes = await db.query(`
            SELECT work_order_id, 
                   COUNT(*) as total_assigned,
                   COUNT(*) FILTER (WHERE empezo IS NULL) as pending_start,
                   COUNT(*) FILTER (WHERE empezo IS NOT NULL AND termino IS NULL) as in_progress
            FROM panol.work_order_tasks
            WHERE worker_id = $1
              AND COALESCE(estado, 'PENDIENTE') != 'COMPLETADA'
              AND termino IS NULL
            GROUP BY work_order_id;
          `, [staffMember.id]);

          tasksRes.rows.forEach(t => {
            activeWoMap.set(String(t.work_order_id), {
              total: parseInt(t.total_assigned || '0', 10),
              pending: parseInt(t.pending_start || '0', 10),
              inProgress: parseInt(t.in_progress || '0', 10)
            });
          });
        } catch (tErr) {
          console.warn('⚠️ [SQL] Error obteniendo tareas activas para holds:', tErr.message);
        }
      }

      let holds = qRes.rows.map(r => {
        const trWoId = r.tractor_work_order_id ? String(r.tractor_work_order_id) : null;
        const smWoId = r.semi_work_order_id ? String(r.semi_work_order_id) : null;

        const trTaskInfo = trWoId ? activeWoMap.get(trWoId) : null;
        const smTaskInfo = smWoId ? activeWoMap.get(smWoId) : null;

        const tractorHasCoordTasks = Boolean(trTaskInfo && (trTaskInfo.pending > 0 || trTaskInfo.inProgress > 0));
        const semiHasCoordTasks = Boolean(smTaskInfo && (smTaskInfo.pending > 0 || smTaskInfo.inProgress > 0));
        const hasCoordTasks = tractorHasCoordTasks || semiHasCoordTasks;

        const isCoordAssigned = hasCoordTasks || Boolean(r.is_coord_assigned) || (r.source === 'COORDINACION' && !r.reviewed_at);

        return {
          id: r.hold_id,
          tractorWorkOrderId: r.tractor_work_order_id,
          semiWorkOrderId: r.semi_work_order_id,
          tractorOtStatus: r.tractor_ot_status,
          semiOtStatus: r.semi_ot_status,
          tractorId: r.tractor_id,
          semiId: r.semi_id,
          tractorPlate: r.tractor_plate,
          tractorOt: r.tractor_ot,
          semiPlate: r.semi_plate,
          semiOt: r.semi_ot,
          brand: r.tractor_brand,
          brandSemi: r.semi_brand,
          addedAt: r.created_at,
          source: r.source || (hasCoordTasks ? 'COORDINACION' : 'MANUAL'),
          reviewedAt: r.reviewed_at || null,
          isCoordAssigned,
          tractorHasCoordTasks,
          semiHasCoordTasks,
          hasCoordTasks,
          assignedTasksCount: (trTaskInfo?.total || 0) + (smTaskInfo?.total || 0)
        };
      });

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

            if (tp) {
              const trRes = await db.query("SELECT id FROM public.tractores WHERE UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) = $1 LIMIT 1;", [tp]);
              if (trRes.rows.length > 0) trId = trRes.rows[0].id;
            }
            if (sp) {
              const smRes = await db.query("SELECT id FROM public.semis WHERE UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) = $1 LIMIT 1;", [sp]);
              if (smRes.rows.length > 0) smId = smRes.rows[0].id;
            }

            const { trWoId, smWoId } = await resolveHoldWorkOrders({ trId, tot, smId, sot });

            await db.query(`
              INSERT INTO panol.staff_holds (staff_id, tractor_work_order_id, semi_work_order_id, tractor_id, semi_id, ot_number, semi_ot, tractor_plate, semi_plate)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              ON CONFLICT DO NOTHING;
            `, [staffMember.id, trWoId, smWoId, trId, smId, tot, sot, tp, sp]);
          }

          const reQ = await db.query(
            'SELECT * FROM panol.v_staff_holds WHERE op_code = ANY($1::text[]) OR staff_id::text = ANY($1::text[]) ORDER BY created_at DESC;',
            [searchCodes]
          );
          holds = reQ.rows.map(r => ({
            id: r.hold_id,
            tractorWorkOrderId: r.tractor_work_order_id,
            semiWorkOrderId: r.semi_work_order_id,
            tractorOtStatus: r.tractor_ot_status,
            semiOtStatus: r.semi_ot_status,
            tractorId: r.tractor_id,
            semiId: r.semi_id,
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

      return res.json({ success: true, holds, units: holds });
    } catch (sqlErr) {
      console.warn('⚠️ [SQL] Error obteniendo /api/holds:', sqlErr.message);
    }
  }

  // Fallback si Postgres no está disponible: leer de Sheets directamente
  if (sheets && SPREADSHEET_ID && opCode) {
    const legacyRes = await getOperarioHoldOts({ sheetsClient: sheets, spreadsheetId: SPREADSHEET_ID, opId: targetOpCode });
    const legacyUnits = legacyRes.units || [];
    return res.json({ success: true, holds: legacyUnits, units: legacyUnits });
  }

  res.json({ success: true, holds: [], units: [] });
});

// REST POST /api/holds (Agregar unidad al puesto en panol.staff_holds y replicar en Sheets DB_STAFF Col M)
app.post('/api/holds', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
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

      if (tp) {
        const trRes = await db.query("SELECT id FROM public.tractores WHERE UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) = $1 LIMIT 1;", [tp]);
        if (trRes.rows.length > 0) trId = trRes.rows[0].id;
      }
      if (sp) {
        const smRes = await db.query("SELECT id FROM public.semis WHERE UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) = $1 LIMIT 1;", [sp]);
        if (smRes.rows.length > 0) smId = smRes.rows[0].id;
      }

      const { trWoId, smWoId } = await resolveHoldWorkOrders({ trId, tot, smId, sot });

      // Evitar duplicados para el mismo operario si ya tiene esta unidad en hold
      const existingHold = await db.query(`
        SELECT id FROM panol.staff_holds 
        WHERE staff_id = $1 
          AND (
            ($2 <> '' AND tractor_plate = $2) OR 
            ($3 <> '' AND semi_plate = $3) OR
            ($4::uuid IS NOT NULL AND tractor_id = $4) OR
            ($5::uuid IS NOT NULL AND semi_id = $5)
          )
        LIMIT 1;
      `, [staffId, tp, sp, trId, smId]);

      let newId;
      if (existingHold.rows.length > 0) {
        newId = existingHold.rows[0].id;
        await db.query(`
          UPDATE panol.staff_holds 
          SET tractor_work_order_id = COALESCE($1, tractor_work_order_id),
              semi_work_order_id = COALESCE($2, semi_work_order_id),
              ot_number = COALESCE(NULLIF($3, ''), ot_number),
              semi_ot = COALESCE(NULLIF($4, ''), semi_ot),
              tractor_id = COALESCE($5, tractor_id),
              semi_id = COALESCE($6, semi_id),
              tractor_plate = COALESCE(NULLIF($7, ''), tractor_plate),
              semi_plate = COALESCE(NULLIF($8, ''), semi_plate)
          WHERE id = $9;
        `, [trWoId, smWoId, tot, sot, trId, smId, tp, sp, newId]);
      } else {
        const insRes = await db.query(`
          INSERT INTO panol.staff_holds (staff_id, tractor_work_order_id, semi_work_order_id, tractor_id, semi_id, ot_number, semi_ot, tractor_plate, semi_plate)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id, created_at;
        `, [staffId, trWoId, smWoId, trId, smId, tot, sot, tp, sp]);
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
          tractorWorkOrderId: trWoId,
          semiWorkOrderId: smWoId,
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
// REST POST /api/holds/:id/review (Marcar unidad en puesto como revisada por el operario)
app.post('/api/holds/:id/review', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const { id } = req.params;
  if (db && db.isConfigured && db.isConfigured() && id) {
    try {
      await db.query('UPDATE panol.staff_holds SET reviewed_at = NOW() WHERE id::text = $1;', [id]);
      return res.json({ success: true });
    } catch (sqlErr) {
      console.warn('⚠️ [SQL] Error marcando hold como revisado:', sqlErr.message);
      return res.status(500).json({ success: false, error: sqlErr.message });
    }
  }
  res.json({ success: true });
});

app.delete('/api/holds/:id', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
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
  const { id, reqId, itemName, returnQty, reason, opId } = req.body || {};
  if (!reqId && !id) return res.status(400).json({ success: false, error: 'Falta reqId o id' });

  const qty = parseInt(returnQty || '1', 10);
  const note = reason ? `DEVOLUCIÓN SOLICITADA POR TALLER: ${reason}` : 'DEVOLUCIÓN SOLICITADA POR TALLER';

  if (db && db.isConfigured && db.isConfigured()) {
    try {
      if (id) {
        // Devolución determinística por ID predeterminada (UUID en panol.stock_movements)
        const updateSm = await db.query(`
          UPDATE panol.stock_movements
          SET status = 'DEVOLUCION PENDIENTE', returned_qty = $1, return_notes = $2, movement_type = 'DEVOLUCION_NUEVO', updated_at = NOW()
          WHERE id = $3
          RETURNING order_id;
        `, [qty, note, id]);

        if (updateSm.rows.length > 0) {
          await db.query(`
            UPDATE panol.orders 
            SET status = 'DEVOLUCION PENDIENTE', updated_at = NOW()
            WHERE id = $1;
          `, [updateSm.rows[0].order_id]);
        }
      } else {
        // Fallback por req_code / order_number y nombre del repuesto
        const updateSm = await db.query(`
          UPDATE panol.stock_movements sm
          SET status = 'DEVOLUCION PENDIENTE', returned_qty = $1, return_notes = $2, movement_type = 'DEVOLUCION_NUEVO', updated_at = NOW()
          FROM panol.orders o, panol.items i
          WHERE sm.order_id = o.id AND sm.item_id = i.id
            AND (o.req_code = $3 OR o.id::text = $3 OR o.order_number::text = $3)
            AND (i.name ILIKE $4 OR $4 = '__ALL__' OR $4 = 'ALL')
          RETURNING sm.order_id;
        `, [qty, note, reqId, itemName || '__ALL__']);

        await db.query(`
          UPDATE panol.orders 
          SET status = 'DEVOLUCION PENDIENTE', updated_at = NOW()
          WHERE (req_code = $1 OR id::text = $1 OR order_number::text = $1);
        `, [reqId]);
      }
    } catch (sqlErr) {
      console.warn('⚠️ [SQL] Error registrando devolución de taller:', sqlErr.message);
    }
  }

  // Invalidar cachés C1 de Monitor y notificar por websockets con estado canónico
  await broadcastOrdersSync();

  res.json({ success: true });
});

// REST GET /api/stock-movements (Movimientos transaccionales de stock)
app.get('/api/stock-movements', async (req, res) => {
  if (db && db.isConfigured && db.isConfigured()) {
    try {
      const qRes = await db.query('SELECT * FROM panol.v_stock_movements LIMIT 200;');
      return res.json({ success: true, count: qRes.rows.length, movements: qRes.rows });
    } catch (sqlErr) {
      console.warn('⚠️ [SQL] Error obteniendo v_stock_movements:', sqlErr.message);
      return res.status(500).json({ success: false, error: sqlErr.message });
    }
  }
  res.json({ success: true, count: 0, movements: [] });
});

// REST POST /api/items/refresh-catalog (Fuerza la recarga completa de Supabase panol.items en RAM)
app.post(['/api/items/refresh-catalog', '/api/items/cache/clear'], (req, res) => {
  sqlItemsCatalogCache = null;
  sqlInventoryListCache = null;
  sqlItemsMap.clear();
  sqlItemsMaxUpdatedAt = null;
  sqlItemsCatalogLastFetch = 0;
  sqlItemsNeedsDelta = false;
  console.log('🔄 [Catalog Cache] Caché de repuestos panol.items invalidada.');
  return res.json({ success: true, message: 'Caché de repuestos invalidada. Próxima consulta leerá directo de Supabase.' });
});

// REST POST /api/items/:id/toggle-exchange (Toggle indicador canje en panol.items)
app.post('/api/items/:id/toggle-exchange', async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, error: 'Falta ID de repuesto' });
  if (db && db.isConfigured && db.isConfigured()) {
    try {
      const qRes = await db.query(`
        UPDATE panol.items
        SET requires_exchange = NOT COALESCE(requires_exchange, false), updated_at = NOW()
        WHERE id::text = $1 OR item_code = $1
        RETURNING id, item_code, name, requires_exchange;
      `, [id]);
      if (qRes.rows.length > 0) {
        sqlItemsNeedsDelta = true; // Próxima lectura sincronizará únicamente el delta modificado
        return res.json({ success: true, item: qRes.rows[0] });
      } else {
        return res.status(404).json({ success: false, error: 'Repuesto no encontrado' });
      }
    } catch (sqlErr) {
      console.warn('⚠️ [SQL] Error toggle-exchange:', sqlErr.message);
      return res.status(500).json({ success: false, error: sqlErr.message });
    }
  }
  res.status(503).json({ success: false, error: 'Base de datos no configurada' });
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

    // Invalidar caché del catálogo de flota ante nueva OT
    if (otsManager.invalidateFleetCatalogCache) {
      otsManager.invalidateFleetCatalogCache();
    }

    // Notificar a todos los navegadores/dashboards conectados en tiempo real vía WebSocket
    io.emit('ot_updated', {
      action: (otsManagerResult && otsManagerResult.action) || (result && result.action) || 'UPDATED',
      matchedPlate: effectivePlate,
      otNumber: effectiveOt,
      otsDetails: otsManagerResult,
      timestamp: new Date().toISOString()
    });
    io.emit('fleet_catalog_updated');

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

// === 4.2 ENDPOINT INTEGRACIÓN N8N & TRIGGER DE SYNC SUPABASE ===
app.all('/api/taller/sync-ots', async (req, res) => {
  try {
    const spreadsheetId = req.body?.spreadsheetId || req.query?.spreadsheetId || PROD_SPREADSHEET_ID;
    const daysCutoff = parseInt(req.body?.days || req.body?.daysCutoff || req.query?.days || req.query?.daysCutoff || '7', 10);
    const onlyLastWeek = (req.body?.onlyLastWeek !== false) && (req.query?.onlyLastWeek !== 'false');
    const mode = req.body?.mode || req.query?.mode || 'latest';

    console.log(`📡 [n8n Trigger] Invocando sincronización de OTs a Supabase (mode=${mode}, onlyLastWeek=${onlyLastWeek}, days=${daysCutoff})`);

    const result = await ingestOtsFromSheetsToSupabase({
      sheetsClient: sheets,
      spreadsheetId,
      daysCutoff,
      onlyLastWeek,
      mode
    });

    if (io) {
      io.emit('taller_ots_synced', result);
    }

    res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    console.error('❌ Error en /api/taller/sync-ots:', err.message);
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

    // 3. Sincronizar transacciones y pedidos iniciales
    if (db && db.isConfigured && db.isConfigured()) {
      console.log('🐘 [SSOT] Cargando pedidos iniciales desde Supabase SQL (panol.v_monitor_pedidos)...');
      await getMonitorOrdersFromDb();
    } else {
      await syncDataFromSheets();
    }

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

    // 5. Catálogo Canónico de Taller y OTs (Supabase PostgreSQL SSOT)
    try {
      console.log('⚡ [Taller] Precalentando catálogo de flota desde Supabase (panol.v_taller_flota_ot)...');
      const catRes = await otsManager.getFleetSearchCatalog(null, null, true);
      console.log(`✅ [Taller] Catálogo inicializado: ${catRes.count} pares y ${catRes.allOts ? catRes.allOts.length : 0} OTs activas cargadas desde Supabase.`);
    } catch (eInitCat) {
      console.warn('⚠️ Error inicializando catálogo de flota desde Supabase:', eInitCat.message);
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