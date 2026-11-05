/**
 * ================================================================================
 * GOOGLE SHEETS SYNC — SINCRONIZACIÓN NATIVA Y RESILIENTE DE NOTAS HOVER
 * ================================================================================
 * Integración nativa en logistica-monorepo (services/master-service/node_backend).
 * Inyecta y limpia notas emergentes (hover notes) en las celdas de la columna
 * 'Chofer' de la planilla mensual de Movimientos para toda novedad cuyo UUID
 * tipo_novedad_id en public.tipos_novedad tenga imprime_nota_movimientos = true
 * (ej. BAJA_DIAGRAMA: 77f25961-a989-46a7-b710-1e1c83c2cdbe).
 *
 * Garantías Operativas:
 * 1. Fuente de Verdad Relacional por UUID (PostgreSQL directo vía utils/db.js):
 *    Sigue estrictamente novedades.tipo_novedad_id -> tipos_novedad.imprime_nota_movimientos.
 * 2. Detección Estricta en Columna Chofer:
 *    Solo inyecta nota si el chofer está efectivamente tipeado en la columna Chofer
 *    del día operativo (mapeo dinámico Fila 1 con fallback 27 + 13 * (dia - 1)).
 *    Sin fallback a columna Tractor.
 * 3. Inmunidad Total de Celda:
 *    batchUpdate -> updateCells con máscara estricta fields: 'note' (0% alteración
 *    de valores, fórmulas, colores o bordes; 0 colisión con notas de Ruteos en AE/AG).
 * 4. Doble Capa Anti-Fallo + Pending Days Watcher (bajasSyncTracker):
 *    - Capa A (Tiempo Real): Cola asíncrona con debounce (1.5s) y reintentos exponenciales.
 *    - Capa B (Auto-Reparable cada 5 min): Invalida selectivamente columnCache solo en
 *      columnas con días en estado PENDIENTE_TIPEO e inyecta la nota apenas el
 *      coordinador anota al chofer en días futuros hasta fecha_objetivo.
 * 5. Protección Multi-Novedad:
 *    Al limpiar notas de una novedad resuelta/editada, re-sincroniza automáticamente si
 *    el mismo chofer posee otra novedad activa con imprime_nota_movimientos = true.
 * ================================================================================
 */

const dns = require('dns');
if (dns && typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
}

const fs = require('fs');
const path = require('path');
const { JWT } = require('google-auth-library');
const db = require('./db');
const { getFechaArgentina, supabase: sharedSupabase } = require('./shared');

// IDs oficiales de respaldo histórico (#idmensual)
const SPREADSHEETS = {
    OCTUBRE_2026: {
        id: '14Mb5rD853zxDkaLDS-IrW-OBDTDBjuJxn_3olXeWlkc',
        tabName: 'OCTUBRE 2026- Mov.Unidades y Choferes',
        sheetIdNum: 0
    },
    NOVIEMBRE_2026: {
        id: '1z66kNDjMki1k9csQevuyhfz50dYoHrQro4wPj-Yt-hc',
        tabName: 'NOVIEMBRE 2026- Mov.Unidades y Choferes',
        sheetIdNum: 0
    }
};

const MESES_NOMBRES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

let cachedJwtClient = null;
const sheetMetaCache = new Map();
const dayHeaderMapCache = new Map();
const columnCache = new Map();

/**
 * Máquina de estados en memoria (Pending Days Watcher)
 * Map<string(novedadId), {
 *   novedad_id: number,
 *   tipo_novedad_id: string | null,
 *   tipo_novedad: string,
 *   chofer_id: string | null,
 *   chofer_nombre: string,
 *   fecha_objetivo: string,
 *   noteHash: string,
 *   dias: Map<dateStr, {
 *     status: 'SINCRONIZADO' | 'PENDIENTE_TIPEO',
 *     coord: string | null,
 *     colLetter: string,
 *     colIdx: number,
 *     row1Based: number | null,
 *     sheetId: string,
 *     tabName: string,
 *     updatedAt: string
 *   }>
 * }>
 */
const bajasSyncTracker = new Map();

/**
 * Normaliza cadenas de texto para comparación insensible a acentos, comas y puntuación
 */
function normalizeText(text) {
    if (!text) return '';
    return text.toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Convierte índice de columna 0-based a letra A1 de Google Sheets (0 -> A, 27 -> AB, 417 -> PB)
 */
function indexToColLetter(colIdx) {
    let res = '';
    let temp = colIdx;
    while (temp >= 0) {
        res = String.fromCharCode((temp % 26) + 65) + res;
        temp = Math.floor(temp / 26) - 1;
    }
    return res;
}

/**
 * Fórmula canónica de columna Chofer (0-based) para el día operativo (1..31)
 */
function getColChofer(dia) {
    return 27 + 13 * (dia - 1);
}

/**
 * Formatea Date local a YYYY-MM-DD sin desfase UTC
 */
function toIsoDateLocal(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Obtiene la fecha operativa actual en Argentina truncada a 00:00:00
 */
function getHoyArgentinaDate() {
    const ar = typeof getFechaArgentina === 'function' ? getFechaArgentina() : new Date();
    const d = new Date(ar.getFullYear(), ar.getMonth(), ar.getDate());
    d.setHours(0, 0, 0, 0);
    return d;
}

/**
 * Extrae { year, month } (month 1..12) desde un texto como "Noviembre 2026" o "NOVIEMBRE 2026- Mov..."
 */
function parseMonthYearFromText(str) {
    if (!str) return null;
    const low = String(str).toLowerCase();
    let foundMonth = null;
    for (let i = 0; i < MESES_NOMBRES.length; i++) {
        if (low.includes(MESES_NOMBRES[i])) {
            foundMonth = i + 1;
            break;
        }
    }
    if (!foundMonth) return null;
    const yearMatch = low.match(/\b(20\d{2})\b/);
    const foundYear = yearMatch ? parseInt(yearMatch[1], 10) : null;
    return foundYear ? { year: foundYear, month: foundMonth } : null;
}

/**
 * Carga config_operativas.json desde el motor Python del monorepo (o rutas de respaldo)
 */
function loadExternalConfig() {
    const configPaths = [
        path.join(__dirname, '../../python_engine/config_operativas.json'),
        path.join(process.cwd(), 'services/master-service/python_engine/config_operativas.json'),
        path.join(__dirname, '../../server_local/operativas_diarias/config_operativas.json'),
        'C:\\Users\\Matias Rodriguez\\Documents\\logistica-monorepo\\services\\master-service\\python_engine\\config_operativas.json',
        'C:\\Users\\Matias Rodriguez\\Documents\\server_local\\operativas_diarias\\config_operativas.json'
    ];
    for (const cp of configPaths) {
        if (fs.existsSync(cp)) {
            try {
                return JSON.parse(fs.readFileSync(cp, 'utf8'));
            } catch (_) {}
        }
    }
    return null;
}

/**
 * Obtiene cliente autenticado de Google Service Account con scopes de escritura en Sheets
 */
function getGoogleAuthClient() {
    if (cachedJwtClient) return cachedJwtClient;

    let creds = null;

    // 1. Variable JSON completa o Base64
    const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_CREDENTIALS_JSON;
    if (rawJson && rawJson.trim()) {
        try {
            creds = JSON.parse(rawJson.trim());
        } catch (_) {
            try {
                const decoded = Buffer.from(rawJson.trim(), 'base64').toString('utf8');
                creds = JSON.parse(decoded);
            } catch (e2) {
                console.warn('⚠️ [Hover Bajas Sync] Error al parsear GOOGLE_SERVICE_ACCOUNT_JSON:', e2.message);
            }
        }
    }

    // 2. Variables separadas EMAIL + PRIVATE_KEY
    if (!creds && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
        creds = {
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
        };
    }

    // 3. Archivos secretos en Render (/etc/secrets) o monorepo local
    if (!creds) {
        const potentialFiles = [
            process.env.GOOGLE_CREDENTIALS_PATH,
            process.env.GOOGLE_APPLICATION_CREDENTIALS,
            '/etc/secrets/credentials.json',
            path.join(__dirname, '../credentials.json'),
            path.join(__dirname, '../../python_engine/credentials.json'),
            path.join(__dirname, '../../python_engine/ute-logistica-key.json'),
            path.join(process.cwd(), 'credentials.json'),
            'C:\\Users\\Matias Rodriguez\\Documents\\server_local\\operativas_diarias\\credentials.json'
        ].filter(Boolean);

        for (const f of potentialFiles) {
            if (fs.existsSync(f)) {
                try {
                    creds = JSON.parse(fs.readFileSync(f, 'utf8'));
                    if (creds?.client_email && creds?.private_key) break;
                } catch (_) {}
            }
        }
    }

    if (!creds || !creds.client_email || !creds.private_key) {
        return null;
    }

    cachedJwtClient = new JWT({
        email: creds.client_email,
        key: creds.private_key.replace(/\\n/g, '\n'),
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]
    });

    return cachedJwtClient;
}

/**
 * Resuelve dinámicamente el spreadsheetId y pestaña de Movimientos para cualquier fecha (#idmensual)
 */
function resolveSheetForDate(d, customConfig = null) {
    const envMovId = process.env.ID_SHEET_MOVIMIENTOS || process.env.MES_MOVIMIENTOS_ID || process.env.DEFAULT_MOV_ID;
    const envTabName = process.env.TAB_MOVIMIENTOS;
    const extCfg = customConfig || loadExternalConfig();

    const year = d.getFullYear();
    const month = d.getMonth() + 1; // 1..12
    const defaultTabForDate = `${MESES_NOMBRES[month - 1].toUpperCase()} ${year}- Mov.Unidades y Choferes`;

    // 1. Verificar coincidencia exacta en config_operativas.json (soporta transición mes_actual / mes_anterior en cualquier año)
    if (extCfg) {
        const parsedActual = parseMonthYearFromText(extCfg.mes_actual?.nombre || extCfg.mes_actual?.tab_movimientos);
        if (parsedActual && parsedActual.year === year && parsedActual.month === month) {
            const envIsStalePrev = envMovId && extCfg.mes_anterior?.movimientos_id && envMovId === extCfg.mes_anterior.movimientos_id;
            const chosenId = (!envMovId || envIsStalePrev) ? extCfg.mes_actual.movimientos_id : envMovId;
            const parsedEnvTab = parseMonthYearFromText(envTabName);
            const chosenTab = (envTabName && (!parsedEnvTab || (parsedEnvTab.year === year && parsedEnvTab.month === month)))
                ? envTabName
                : (extCfg.mes_actual.tab_movimientos || defaultTabForDate);
            return {
                id: chosenId,
                tabName: chosenTab,
                sheetIdNum: 0
            };
        }

        const parsedAnterior = parseMonthYearFromText(extCfg.mes_anterior?.nombre || extCfg.mes_anterior?.tab_movimientos);
        if (parsedAnterior && parsedAnterior.year === year && parsedAnterior.month === month && extCfg.mes_anterior?.movimientos_id) {
            return {
                id: extCfg.mes_anterior.movimientos_id,
                tabName: extCfg.mes_anterior.tab_movimientos || defaultTabForDate,
                sheetIdNum: 0
            };
        }
    }

    // 2. Variables de entorno activas (#idmensual)
    if (envMovId) {
        const parsedEnvTab = parseMonthYearFromText(envTabName);
        if (!parsedEnvTab || (parsedEnvTab.year === year && parsedEnvTab.month === month)) {
            return {
                id: envMovId,
                tabName: envTabName || extCfg?.mes_actual?.tab_movimientos || defaultTabForDate,
                sheetIdNum: 0
            };
        }
        // Si la fecha objetivo apunta a un mes futuro aún no rotado, usar la planilla activa actual
        if (year > parsedEnvTab.year || (year === parsedEnvTab.year && month > parsedEnvTab.month)) {
            return {
                id: envMovId,
                tabName: envTabName,
                sheetIdNum: 0
            };
        }
    }

    // 3. Fallbacks históricos conocidos
    if (year === 2026 && month === 10) {
        return SPREADSHEETS.OCTUBRE_2026;
    }
    if (year === 2026 && month === 11) {
        return SPREADSHEETS.NOVIEMBRE_2026;
    }

    if (extCfg?.mes_actual?.movimientos_id) {
        return {
            id: extCfg.mes_actual.movimientos_id,
            tabName: extCfg.mes_actual.tab_movimientos || defaultTabForDate,
            sheetIdNum: 0
        };
    }

    return SPREADSHEETS.NOVIEMBRE_2026;
}

/**
 * Ejecuta HTTP request con reintentos exponenciales ante 429 / 5xx
 */
async function fetchWithRetry(url, options = {}, timeoutMs = 180000, maxRetries = 3) {
    let attempt = 0;
    let delay = 2500;

    while (attempt < maxRetries) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timer);

            if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
                attempt++;
                if (attempt >= maxRetries) return res;
                console.warn(`⏳ [Hover Bajas Sync] HTTP ${res.status}. Reintento ${attempt}/${maxRetries} en ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                delay *= 2;
                continue;
            }
            return res;
        } catch (err) {
            clearTimeout(timer);
            attempt++;
            if (attempt >= maxRetries) throw err;
            console.warn(`⏳ [Hover Bajas Sync] Error de red (${err.message}). Reintento ${attempt}/${maxRetries} en ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            delay *= 2;
        }
    }
}

/**
 * Resuelve el nombre exacto de pestaña y su sheetId numérico consultando metadatos de Google Sheets
 */
async function resolveDynamicSheetMeta(sheetId, preferredTabName, targetDate, accessToken) {
    if (!sheetMetaCache.has(sheetId)) {
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`;
        try {
            const res = await fetchWithRetry(url, {
                headers: { Authorization: `Bearer ${accessToken}` }
            }, 20000, 2);

            if (res && res.ok) {
                const data = await res.json();
                const list = (data.sheets || []).map(s => ({
                    title: String(s.properties?.title || ''),
                    sheetId: Number(s.properties?.sheetId || 0)
                }));
                sheetMetaCache.set(sheetId, list);
            }
        } catch (e) {
            console.warn(`⚠️ [Hover Bajas Sync] No se pudieron leer metadatos de ${sheetId}: ${e.message}`);
        }
    }

    const sheetsList = sheetMetaCache.get(sheetId) || [];
    if (sheetsList.length === 0) {
        return { tabName: preferredTabName, sheetIdNum: 0 };
    }

    const prefNorm = String(preferredTabName || '').trim().toLowerCase();
    const exact = sheetsList.find(s => s.title.trim().toLowerCase() === prefNorm);
    if (exact) {
        return { tabName: exact.title, sheetIdNum: exact.sheetId };
    }

    if (targetDate instanceof Date && !isNaN(targetDate.getTime())) {
        const mesNombre = MESES_NOMBRES[targetDate.getMonth()];
        const byMonthMov = sheetsList.find(s => {
            const low = s.title.toLowerCase();
            return low.includes(mesNombre) && low.includes('mov') && low.includes('unidades');
        });
        if (byMonthMov) {
            return { tabName: byMonthMov.title, sheetIdNum: byMonthMov.sheetId };
        }
    }

    const anyMov = sheetsList.find(s => {
        const low = s.title.toLowerCase();
        return low.includes('mov') && low.includes('unidades');
    });
    if (anyMov) {
        return { tabName: anyMov.title, sheetIdNum: anyMov.sheetId };
    }

    return { tabName: preferredTabName || sheetsList[0].title, sheetIdNum: sheetsList[0].sheetId || 0 };
}

/**
 * Escanea la Fila 1 ('1:1') para mapear cada día operativo (1..31) a su columna exacta de Chofer,
 * con fallback matemático garantizado a 27 + 13 * (dia - 1).
 */
async function getDayToChoferColMap(sheetId, tabName, accessToken) {
    const cacheKey = `${sheetId}:::${tabName}`;
    if (dayHeaderMapCache.has(cacheKey)) {
        return dayHeaderMapCache.get(cacheKey);
    }

    const dayMap = new Map();
    const rangeEnc = encodeURIComponent(`'${tabName}'!1:1`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${rangeEnc}`;

    try {
        const res = await fetchWithRetry(url, {
            headers: { Authorization: `Bearer ${accessToken}` }
        }, 25000, 2);

        if (res && res.ok) {
            const data = await res.json();
            const row1 = (data.values && data.values[0]) ? data.values[0] : [];
            let currentChoferCol = null;
            const regexDiaMes = /\b0?([1-9]|[12][0-9]|3[01])\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i;

            for (let cIdx = 0; cIdx < row1.length; cIdx++) {
                const cellText = String(row1[cIdx] || '').trim();
                if (!cellText) continue;
                if (cellText.toLowerCase().includes('chofer')) {
                    currentChoferCol = cIdx;
                }
                const m = cellText.match(regexDiaMes);
                if (m && currentChoferCol !== null) {
                    const dayNum = parseInt(m[1], 10);
                    dayMap.set(dayNum, currentChoferCol);
                }
            }
        }
    } catch (e) {
        console.warn(`⚠️ [Hover Bajas Sync] Fallback stride 13 en cabecera de [${tabName}]: ${e.message}`);
    }

    for (let d = 1; d <= 31; d++) {
        if (!dayMap.has(d)) {
            dayMap.set(d, getColChofer(d));
        }
    }

    dayHeaderMapCache.set(cacheKey, dayMap);
    return dayMap;
}

/**
 * Formatea el contenido de la nota emergente (hover note)
 */
function formatBajaNote(tipoTitulo, fechaObjStr, detalle) {
    let fDisplay = fechaObjStr || '';
    if (fechaObjStr && String(fechaObjStr).includes('-')) {
        const parts = String(fechaObjStr).split('T')[0].split('-');
        if (parts.length === 3) {
            fDisplay = `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
    }
    const titulo = String(tipoTitulo || 'BAJA DE DIAGRAMA').trim().toUpperCase();
    const lines = [`⚠️ ${titulo} (Hasta: ${fDisplay})`];
    if (detalle && String(detalle).trim()) {
        lines.push(`Detalle: ${String(detalle).trim()}`);
    }
    return lines.join('\n');
}

/**
 * Descarga en lotes de hasta 5 columnas (values:batchGet) aquellas columnas no presentes en columnCache
 */
async function prefetchColumnsBatch(sheetId, tabName, colLetters, accessToken) {
    const missing = Array.from(new Set(colLetters)).filter(c => !columnCache.has(`${sheetId}_${tabName}_${c}`));
    if (missing.length === 0) return;

    const chunkSize = 5;
    for (let i = 0; i < missing.length; i += chunkSize) {
        const chunk = missing.slice(i, i + chunkSize);
        const rangesParams = chunk.map(c => `ranges=${encodeURIComponent(`'${tabName}'!${c}1:${c}250`)}`).join('&');
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?${rangesParams}&valueRenderOption=UNFORMATTED_VALUE`;

        try {
            const res = await fetchWithRetry(url, {
                headers: { Authorization: `Bearer ${accessToken}` }
            }, 180000, 2);

            if (res && res.ok) {
                const data = await res.json();
                const valueRanges = data.valueRanges || [];
                valueRanges.forEach((vr, idx) => {
                    const colLetter = chunk[idx];
                    const rawValues = vr.values || [];
                    const parsed = rawValues.map(row => (row && row.length > 0 ? String(row[0]).trim() : ''));
                    columnCache.set(`${sheetId}_${tabName}_${colLetter}`, parsed);
                });
            } else if (res) {
                console.warn(`⚠️ [Hover Bajas Sync] batchGet HTTP ${res.status} en [${tabName}] (${chunk.join(', ')})`);
            }
        } catch (e) {
            console.warn(`⚠️ [Hover Bajas Sync] Error en prefetchColumnsBatch (${chunk.join(', ')}):`, e.message);
        }
    }
}

/**
 * Busca estrictamente al chofer en los valores de la columna Chofer del día (filas 3..250, 1-based)
 * Regla operativa estricta: SIN fallback a tractor.
 */
function findDriverRowInColValues(colVals, normChofer) {
    if (!normChofer || !Array.isArray(colVals)) return null;
    for (let r = 2; r < colVals.length; r++) {
        const cellVal = colVals[r];
        if (cellVal && cellVal.length >= 3) {
            const normCell = normalizeText(cellVal);
            if (
                normChofer === normCell ||
                (normChofer.length >= 6 && normCell.includes(normChofer)) ||
                (normCell.length >= 6 && normChofer.includes(normCell))
            ) {
                return r + 1; // 1-based row index
            }
        }
    }
    return null;
}

/**
 * Consulta en PostgreSQL (o fallback Supabase) las novedades activas cuya relación UUID
 * hacia public.tipos_novedad tenga imprime_nota_movimientos = true.
 */
async function fetchActiveNovedadesConNota(supabaseClient = null, filterChoferId = null) {
    if (db.isConfigured()) {
        const params = [];
        let extraWhere = '';
        if (filterChoferId) {
            params.push(filterChoferId);
            extraWhere = ` AND n.chofer_id = $1::uuid`;
        }
        const { rows } = await db.query(
            `SELECT
                n.id,
                n.chofer_id,
                UPPER(TRIM(COALESCE(c.nombre, ''))) AS chofer_nombre,
                n.tipo_novedad_id,
                tn.codigo AS tipo_novedad,
                tn.titulo AS tipo_novedad_titulo,
                COALESCE(tn.imprime_nota_movimientos, false) AS imprime_nota_movimientos,
                TO_CHAR(n.fecha_objetivo, 'YYYY-MM-DD') AS fecha_objetivo,
                n.detalle,
                n.resuelto
             FROM public.novedades n
             JOIN public.tipos_novedad tn ON n.tipo_novedad_id = tn.id
             LEFT JOIN public.choferes c ON n.chofer_id = c.id
             WHERE tn.imprime_nota_movimientos = true
               AND n.resuelto = false
               AND n.chofer_id IS NOT NULL
               AND n.fecha_objetivo IS NOT NULL
               AND n.fecha_objetivo >= (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
               ${extraWhere}
             ORDER BY n.id DESC`,
            params
        );
        return rows || [];
    }

    const sb = supabaseClient || sharedSupabase;
    if (sb) {
        let query = sb
            .from('view_dash_novedades')
            .select('*')
            .eq('imprime_nota_movimientos', true)
            .eq('resuelto', false)
            .not('chofer_id', 'is', null)
            .not('fecha_objetivo', 'is', null)
            .order('id', { ascending: false });

        if (filterChoferId) {
            query = query.eq('chofer_id', filterChoferId);
        }

        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return data || [];
    }

    return [];
}

/**
 * Resuelve el nombre del chofer desde PostgreSQL / Supabase cuando el payload solo trae chofer_id
 */
async function resolveChoferNombreById(choferId, supabaseClient = null) {
    if (!choferId) return '';
    if (db.isConfigured()) {
        try {
            const { rows } = await db.query(
                `SELECT nombre FROM public.choferes WHERE id = $1::uuid LIMIT 1`,
                [choferId]
            );
            if (rows.length > 0 && rows[0].nombre) return rows[0].nombre;
        } catch (_) {}
    }
    const sb = supabaseClient || sharedSupabase;
    if (sb) {
        try {
            const { data } = await sb.from('choferes').select('nombre').eq('id', choferId).limit(1);
            if (data && data.length > 0) return data[0].nombre || '';
        } catch (_) {}
    }
    return '';
}

/**
 * Elimina una novedad del tracker en memoria
 */
function limpiarTrackingNovedad(novedadId) {
    if (novedadId === undefined || novedadId === null) return false;
    return bajasSyncTracker.delete(String(novedadId));
}

/**
 * Exporta un resumen estructurado del estado de días sincronizados vs pendientes por novedad
 */
function obtenerEstadoTrackingBajas() {
    const resumen = [];
    for (const [, entry] of bajasSyncTracker.entries()) {
        const diasSincronizados = [];
        const diasPendientes = [];
        const detalleDias = {};

        for (const [dateStr, info] of entry.dias.entries()) {
            detalleDias[dateStr] = {
                status: info.status,
                coord: info.coord || null,
                colLetter: info.colLetter,
                tabName: info.tabName,
                updatedAt: info.updatedAt
            };
            if (info.status === 'SINCRONIZADO') {
                diasSincronizados.push(dateStr);
            } else {
                diasPendientes.push(dateStr);
            }
        }

        resumen.push({
            novedad_id: entry.novedad_id,
            tipo_novedad_id: entry.tipo_novedad_id,
            tipo_novedad: entry.tipo_novedad,
            chofer_id: entry.chofer_id,
            chofer_nombre: entry.chofer_nombre,
            fecha_objetivo: entry.fecha_objetivo,
            diasSincronizados,
            diasPendientes,
            completo: diasPendientes.length === 0 && diasSincronizados.length > 0,
            detalleDias
        });
    }
    return resumen;
}

let isSyncRunning = false;

/**
 * Sincroniza notas hover de bajas de diagrama hacia Google Sheets Movimientos.
 * @param {Object|null} contextoNovedad - Novedad puntual ({ action: 'crear'|'limpiar', ... }) o null para barrido completo
 * @param {Object} options - { supabaseClient, dryRun, forceRefresh, isReconciler }
 */
async function syncBajasGoogleSheets(contextoNovedad = null, options = {}) {
    const supabaseClient = (options && typeof options.from === 'function') ? options : (options?.supabaseClient || null);
    const dryRun = Boolean(options?.dryRun);
    const forceRefresh = Boolean(options?.forceRefresh);
    const isReconciler = Boolean(options?.isReconciler);

    if (isSyncRunning && isReconciler) {
        return { success: true, count: 0, skippedBusy: true };
    }

    const authClient = getGoogleAuthClient();
    if (!authClient) {
        console.warn('ℹ️ [Hover Bajas Sync] Credenciales de Google no configuradas. Sync omitido.');
        return { success: false, reason: 'NO_CREDENTIALS' };
    }

    isSyncRunning = true;
    try {
        const tokenInfo = await authClient.authorize();
        const accessToken = tokenInfo?.access_token || tokenInfo?.token;
        if (!accessToken) {
            console.warn('⚠️ [Hover Bajas Sync] No se pudo obtener access_token de Google.');
            return { success: false, reason: 'NO_ACCESS_TOKEN' };
        }

        const hoy = getHoyArgentinaDate();

        // =================================================================
        // ACCIÓN 1: LIMPIEZA DE NOTAS HOVER (Resolver / Acortar fecha / Cambiar chofer o tipo)
        // =================================================================
        if (contextoNovedad && contextoNovedad.action === 'limpiar') {
            return await ejecutarLimpiezaNotas(contextoNovedad, accessToken, supabaseClient, hoy, dryRun);
        }

        // =================================================================
        // ACCIÓN 2: SINCRONIZACIÓN E INYECCIÓN DE NOTAS ACTIVAS
        // =================================================================
        let novedades = [];
        let isFullSweep = false;

        if (
            contextoNovedad &&
            (contextoNovedad.chofer_id || contextoNovedad.chofer_nombre || contextoNovedad.nom) &&
            contextoNovedad.fecha_objetivo
        ) {
            novedades = [contextoNovedad];
        } else {
            isFullSweep = true;
            novedades = await fetchActiveNovedadesConNota(supabaseClient);
        }

        // En barrido completo, depurar del tracker las novedades que ya no están vigentes
        if (isFullSweep) {
            const activeIds = new Set(novedades.map(n => String(n.id)));
            for (const trackedId of Array.from(bajasSyncTracker.keys())) {
                if (!activeIds.has(trackedId)) {
                    bajasSyncTracker.delete(trackedId);
                }
            }
        }

        if (novedades.length === 0) {
            return { success: true, count: 0, pendingDays: 0 };
        }

        // Paso A: Evaluar días por novedad, determinar qué días necesitan lectura fresca o escritura
        const neededColsBySheet = new Map();
        const workPlan = [];

        for (const nov of novedades) {
            let choferNom = nov.chofer_nombre || nov.nom || nov.chofer || '';
            if (!choferNom && nov.chofer_id) {
                choferNom = await resolveChoferNombreById(nov.chofer_id, supabaseClient);
            }
            if (!choferNom || !nov.fecha_objetivo) continue;

            const normChofer = normalizeText(choferNom);
            if (!normChofer) continue;

            const fObjStr = (nov.fecha_objetivo instanceof Date)
                ? toIsoDateLocal(nov.fecha_objetivo)
                : String(nov.fecha_objetivo).split('T')[0].trim();

            const [y, m, d] = fObjStr.split('-').map(Number);
            if (!y || !m || !d) continue;
            const fObj = new Date(y, m - 1, d);
            fObj.setHours(0, 0, 0, 0);
            if (fObj < hoy) continue;

            const novKey = nov.id != null ? String(nov.id) : `tmp_${normChofer}_${fObjStr}`;
            const tipoTitulo = nov.tipo_novedad_titulo || nov.tipo_novedad || 'BAJA DE DIAGRAMA';
            const noteText = formatBajaNote(tipoTitulo, fObjStr, nov.detalle);

            const prevTrack = bajasSyncTracker.get(novKey);
            const noteChanged = !prevTrack || prevTrack.noteHash !== noteText || prevTrack.chofer_nombre !== choferNom;

            const daysForNov = [];
            let cur = new Date(hoy.getTime());
            while (cur <= fObj) {
                const dateStr = toIsoDateLocal(cur);
                const diaNum = cur.getDate();
                const baseSheet = resolveSheetForDate(cur);
                const resolvedMeta = await resolveDynamicSheetMeta(baseSheet.id, baseSheet.tabName, cur, accessToken);
                const colIdx = getColChofer(diaNum);
                const colLetter = indexToColLetter(colIdx);

                const prevDay = prevTrack?.dias?.get(dateStr);
                const alreadySynced = Boolean(
                    !forceRefresh &&
                    !noteChanged &&
                    prevDay &&
                    prevDay.status === 'SINCRONIZADO' &&
                    prevDay.coord
                );

                if (!alreadySynced) {
                    // Invalidar caché selectivamente si el día estaba PENDIENTE_TIPEO, es barrido reconciliador o forzado
                    const cacheKey = `${baseSheet.id}_${resolvedMeta.tabName}_${colLetter}`;
                    if (forceRefresh || isReconciler || !prevDay || prevDay.status === 'PENDIENTE_TIPEO') {
                        columnCache.delete(cacheKey);
                    }

                    const groupKey = `${baseSheet.id}:::${resolvedMeta.tabName}`;
                    if (!neededColsBySheet.has(groupKey)) {
                        neededColsBySheet.set(groupKey, {
                            sheetId: baseSheet.id,
                            tabName: resolvedMeta.tabName,
                            cols: new Set()
                        });
                    }
                    neededColsBySheet.get(groupKey).cols.add(colLetter);
                }

                daysForNov.push({
                    dateStr,
                    diaNum,
                    sheetId: baseSheet.id,
                    tabName: resolvedMeta.tabName,
                    sheetIdNum: resolvedMeta.sheetIdNum,
                    colIdx,
                    colLetter,
                    alreadySynced,
                    prevDay
                });

                cur.setDate(cur.getDate() + 1);
            }

            workPlan.push({
                nov,
                novKey,
                choferNom,
                normChofer,
                fObjStr,
                noteText,
                daysForNov
            });
        }

        // Si todas las celdas de todas las novedades activas ya están sincronizadas, salir con 0 llamadas a values:batchGet
        if (neededColsBySheet.size === 0) {
            return { success: true, count: 0, pendingDays: 0, skippedAlreadySynced: true };
        }

        // Paso B: Descargar columnas pendientes en lote
        for (const [, group] of neededColsBySheet.entries()) {
            await prefetchColumnsBatch(group.sheetId, group.tabName, Array.from(group.cols), accessToken);
        }

        // Paso C: Detectar presencia del chofer, armar batchUpdate y actualizar bajasSyncTracker
        const updatesBySpreadsheet = new Map();
        const plannedItems = [];
        let pendingDaysCount = 0;

        for (const item of workPlan) {
            const { nov, novKey, choferNom, normChofer, fObjStr, noteText, daysForNov } = item;
            const diasMap = new Map();

            for (const dInfo of daysForNov) {
                if (dInfo.alreadySynced && dInfo.prevDay) {
                    diasMap.set(dInfo.dateStr, dInfo.prevDay);
                    continue;
                }

                const colVals = columnCache.get(`${dInfo.sheetId}_${dInfo.tabName}_${dInfo.colLetter}`) || [];
                const rowFound1Based = findDriverRowInColValues(colVals, normChofer);

                if (rowFound1Based !== null) {
                    const coord = `${dInfo.colLetter}${rowFound1Based}`;
                    console.log(`📍 [Hover Bajas Sync] Chofer '${choferNom}' detectado en [${dInfo.tabName}] ${coord} (${dInfo.dateStr})`);

                    diasMap.set(dInfo.dateStr, {
                        status: 'SINCRONIZADO',
                        coord,
                        colLetter: dInfo.colLetter,
                        colIdx: dInfo.colIdx,
                        row1Based: rowFound1Based,
                        sheetId: dInfo.sheetId,
                        tabName: dInfo.tabName,
                        updatedAt: new Date().toISOString()
                    });

                    plannedItems.push({
                        novedad_id: nov.id || null,
                        chofer: choferNom,
                        date: dInfo.dateStr,
                        coord,
                        tabName: dInfo.tabName,
                        note: noteText
                    });

                    if (!updatesBySpreadsheet.has(dInfo.sheetId)) {
                        updatesBySpreadsheet.set(dInfo.sheetId, {
                            tabName: dInfo.tabName,
                            requests: []
                        });
                    }

                    updatesBySpreadsheet.get(dInfo.sheetId).requests.push({
                        updateCells: {
                            range: {
                                sheetId: dInfo.sheetIdNum,
                                startRowIndex: rowFound1Based - 1,
                                endRowIndex: rowFound1Based,
                                startColumnIndex: dInfo.colIdx,
                                endColumnIndex: dInfo.colIdx + 1
                            },
                            rows: [{ values: [{ note: noteText }] }],
                            fields: 'note'
                        }
                    });
                } else {
                    pendingDaysCount++;
                    diasMap.set(dInfo.dateStr, {
                        status: 'PENDIENTE_TIPEO',
                        coord: null,
                        colLetter: dInfo.colLetter,
                        colIdx: dInfo.colIdx,
                        row1Based: null,
                        sheetId: dInfo.sheetId,
                        tabName: dInfo.tabName,
                        updatedAt: new Date().toISOString()
                    });
                    if (!isReconciler) {
                        console.log(`⏳ [Hover Bajas Sync] Día ${dInfo.dateStr} en espera (PENDIENTE_TIPEO): '${choferNom}' aún no tipeado en col ${dInfo.colLetter}`);
                    }
                }
            }

            if (!dryRun && nov.id != null) {
                bajasSyncTracker.set(novKey, {
                    novedad_id: Number(nov.id),
                    tipo_novedad_id: nov.tipo_novedad_id || null,
                    tipo_novedad: nov.tipo_novedad || 'BAJA_DIAGRAMA',
                    chofer_id: nov.chofer_id || null,
                    chofer_nombre: choferNom,
                    fecha_objetivo: fObjStr,
                    noteHash: noteText,
                    dias: diasMap
                });
            }
        }

        if (dryRun) {
            return {
                success: true,
                dryRun: true,
                count: plannedItems.length,
                pendingDays: pendingDaysCount,
                planned: plannedItems
            };
        }

        // Paso D: Aplicar lotes en Google Sheets API con fields: 'note'
        let totalApplied = 0;
        for (const [sheetId, group] of updatesBySpreadsheet.entries()) {
            if (group.requests.length === 0) continue;

            const batchSize = 100;
            for (let i = 0; i < group.requests.length; i += batchSize) {
                const chunk = group.requests.slice(i, i + batchSize);
                const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`;

                try {
                    const updateRes = await fetchWithRetry(updateUrl, {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ requests: chunk })
                    }, 180000, 2);

                    if (updateRes && updateRes.ok) {
                        console.log(`✅ [Hover Bajas Sync] ${chunk.length} nota(s) hover inyectadas en [${group.tabName}].`);
                        totalApplied += chunk.length;
                    } else if (updateRes) {
                        const errBody = await updateRes.text();
                        console.warn(`⚠️ [Hover Bajas Sync] Error batchUpdate en ${sheetId}: HTTP ${updateRes.status} - ${errBody}`);
                    }
                } catch (batchErr) {
                    console.warn(`⚠️ [Hover Bajas Sync] Excepción batchUpdate en ${sheetId}:`, batchErr.message);
                }
            }
        }

        return {
            success: true,
            count: totalApplied,
            pendingDays: pendingDaysCount
        };
    } catch (err) {
        console.warn('⚠️ [Hover Bajas Sync] Error general durante sincronización:', err.message);
        return { success: false, error: err.message };
    } finally {
        isSyncRunning = false;
    }
}

/**
 * Limpia notas hover (note: '') para una novedad resuelta, cancelada o cuyo rango se acortó.
 * Si el mismo chofer conserva otra novedad activa con imprime_nota_movimientos = true,
 * re-sincroniza inmediatamente sus días vigentes para no perder la advertencia activa.
 */
async function ejecutarLimpiezaNotas(contexto, accessToken, supabaseClient, hoy, dryRun = false) {
    try {
        if (contexto.id != null) {
            limpiarTrackingNovedad(contexto.id);
        }

        let choferNom = contexto.chofer_nombre || contexto.nom || contexto.chofer || '';
        if (!choferNom && contexto.chofer_id) {
            choferNom = await resolveChoferNombreById(contexto.chofer_id, supabaseClient);
        }

        if (!choferNom || !contexto.fecha_objetivo) {
            return { success: true, count: 0 };
        }

        const normChofer = normalizeText(choferNom);
        const fObjStr = (contexto.fecha_objetivo instanceof Date)
            ? toIsoDateLocal(contexto.fecha_objetivo)
            : String(contexto.fecha_objetivo).split('T')[0].trim();

        const [y, m, d] = fObjStr.split('-').map(Number);
        if (!y || !m || !d) return { success: true, count: 0 };
        const fObj = new Date(y, m - 1, d);
        fObj.setHours(0, 0, 0, 0);

        let fechaInicioLimpieza = new Date(hoy.getTime());
        if (contexto.desde_fecha) {
            const desdeStr = String(contexto.desde_fecha).split('T')[0].trim();
            const [dy, dm, dd] = desdeStr.split('-').map(Number);
            if (dy && dm && dd) {
                const dDesde = new Date(dy, dm - 1, dd);
                dDesde.setHours(0, 0, 0, 0);
                if (dDesde > fechaInicioLimpieza) {
                    fechaInicioLimpieza = dDesde;
                }
            }
        }

        if (fObj < fechaInicioLimpieza) {
            return { success: true, count: 0 };
        }

        console.log(`🧹 [Hover Bajas Sync] Limpiando notas hover de '${choferNom}' (${toIsoDateLocal(fechaInicioLimpieza)} .. ${fObjStr})...`);

        const neededCols = new Map();
        const scanDays = [];
        let curCheck = new Date(fechaInicioLimpieza.getTime());
        while (curCheck <= fObj) {
            const diaNum = curCheck.getDate();
            const baseSheet = resolveSheetForDate(curCheck);
            const resolvedMeta = await resolveDynamicSheetMeta(baseSheet.id, baseSheet.tabName, curCheck, accessToken);
            const colIdx = getColChofer(diaNum);
            const colLetter = indexToColLetter(colIdx);

            // Asegurar lectura fresca al limpiar
            columnCache.delete(`${baseSheet.id}_${resolvedMeta.tabName}_${colLetter}`);

            const key = `${baseSheet.id}:::${resolvedMeta.tabName}`;
            if (!neededCols.has(key)) {
                neededCols.set(key, { sheetId: baseSheet.id, tabName: resolvedMeta.tabName, cols: new Set() });
            }
            neededCols.get(key).cols.add(colLetter);

            scanDays.push({
                dateStr: toIsoDateLocal(curCheck),
                sheetId: baseSheet.id,
                tabName: resolvedMeta.tabName,
                sheetIdNum: resolvedMeta.sheetIdNum,
                colIdx,
                colLetter
            });

            curCheck.setDate(curCheck.getDate() + 1);
        }

        for (const [, group] of neededCols.entries()) {
            await prefetchColumnsBatch(group.sheetId, group.tabName, Array.from(group.cols), accessToken);
        }

        const clearRequestsBySheet = new Map();
        for (const dInfo of scanDays) {
            const colVals = columnCache.get(`${dInfo.sheetId}_${dInfo.tabName}_${dInfo.colLetter}`) || [];
            const rowFound1Based = findDriverRowInColValues(colVals, normChofer);
            if (rowFound1Based !== null) {
                if (!clearRequestsBySheet.has(dInfo.sheetId)) {
                    clearRequestsBySheet.set(dInfo.sheetId, {
                        tabName: dInfo.tabName,
                        requests: []
                    });
                }
                clearRequestsBySheet.get(dInfo.sheetId).requests.push({
                    updateCells: {
                        range: {
                            sheetId: dInfo.sheetIdNum,
                            startRowIndex: rowFound1Based - 1,
                            endRowIndex: rowFound1Based,
                            startColumnIndex: dInfo.colIdx,
                            endColumnIndex: dInfo.colIdx + 1
                        },
                        rows: [{ values: [{ note: '' }] }],
                        fields: 'note'
                    }
                });
            }
        }

        if (dryRun) {
            let dryCount = 0;
            for (const [, g] of clearRequestsBySheet.entries()) dryCount += g.requests.length;
            return { success: true, dryRun: true, count: dryCount };
        }

        let totalCleared = 0;
        for (const [sheetId, group] of clearRequestsBySheet.entries()) {
            if (group.requests.length === 0) continue;
            const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`;
            try {
                const updateRes = await fetchWithRetry(updateUrl, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ requests: group.requests })
                }, 180000, 2);
                if (updateRes && updateRes.ok) {
                    console.log(`✅ [Hover Bajas Sync] ${group.requests.length} nota(s) removidas en [${group.tabName}].`);
                    totalCleared += group.requests.length;
                }
            } catch (e) {
                console.warn(`⚠️ [Hover Bajas Sync] Error limpiando notas en ${sheetId}:`, e.message);
            }
        }

        // Protección Multi-Novedad: si el chofer tiene otra novedad activa con imprime_nota_movimientos = true, re-aplicarla
        if (contexto.chofer_id) {
            const otrasActivas = await fetchActiveNovedadesConNota(supabaseClient, contexto.chofer_id);
            if (otrasActivas.length > 0) {
                for (const otra of otrasActivas) {
                    limpiarTrackingNovedad(otra.id);
                    await syncBajasGoogleSheets(otra, { supabaseClient, forceRefresh: true });
                }
            }
        }

        return { success: true, count: totalCleared };
    } catch (e) {
        console.warn('⚠️ [Hover Bajas Sync] Error en ejecutarLimpiezaNotas:', e.message);
        return { success: false, error: e.message };
    }
}

// =================================================================
// CAPA A: COLA ASÍNCRONA CON DEBOUNCING Y SERIALIZACIÓN (1.5s)
// =================================================================
let debounceTimer = null;
let pendingContexts = [];
let isQueueBusy = false;

function queueSyncBajas(contexto = null, supabaseClient = null) {
    if (contexto) {
        pendingContexts.push(contexto);
    }

    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
        debounceTimer = null;
        if (isQueueBusy) {
            debounceTimer = setTimeout(() => queueSyncBajas(null, supabaseClient), 3000);
            return;
        }

        isQueueBusy = true;
        const currentBatch = [...pendingContexts];
        pendingContexts = [];

        try {
            // Primero procesar todas las limpiezas en orden para evitar sobrescribir notas nuevas
            const limpiezas = currentBatch.filter(c => c && c.action === 'limpiar');
            const altas = currentBatch.filter(c => c && c.action !== 'limpiar');

            for (const cleanCtx of limpiezas) {
                await syncBajasGoogleSheets(cleanCtx, { supabaseClient });
            }

            if (altas.length === 1) {
                await syncBajasGoogleSheets(altas[0], { supabaseClient, forceRefresh: true });
            } else if (altas.length > 1 || currentBatch.length === 0) {
                await syncBajasGoogleSheets(null, { supabaseClient });
            }
        } catch (err) {
            console.warn('⚠️ [Hover Bajas Queue] Error procesando lote:', err.message);
        } finally {
            isQueueBusy = false;
            if (pendingContexts.length > 0 && !debounceTimer) {
                queueSyncBajas(null, supabaseClient);
            }
        }
    }, 1500);
}

// =================================================================
// CAPA B: RECONCILIADOR PERIÓDICO AUTO-REPARABLE (CADA 5 MINUTOS)
// =================================================================
let reconciliadorInterval = null;
let initialBootTimer = null;

function iniciarReconciliadorBajas(intervalMs = 5 * 60 * 1000, supabaseClient = null) {
    if (process.env.ENABLE_BAJAS_HOVER_SYNC === 'false') {
        console.log('🛡️ [Hover Bajas Sync] Reconciliador deshabilitado por ENABLE_BAJAS_HOVER_SYNC=false.');
        return null;
    }

    if (reconciliadorInterval) clearInterval(reconciliadorInterval);
    if (initialBootTimer) clearTimeout(initialBootTimer);

    const min = Math.max(1, Math.round(intervalMs / 60000));
    console.log(`⏱️ [Hover Bajas Sync] Reconciliador de notas hover activo (cada ${min} min | UUID tipos_novedad.imprime_nota_movimientos).`);

    // Barrido inicial diferido (20s post-arranque) para hidratar bajasSyncTracker sin competir con el boot del servidor
    initialBootTimer = setTimeout(() => {
        if (!isQueueBusy && !isSyncRunning) {
            syncBajasGoogleSheets(null, { supabaseClient, isReconciler: true }).catch(err => {
                console.warn('⚠️ [Hover Bajas Sync] Error en barrido inicial:', err.message);
            });
        }
    }, 20000);
    if (initialBootTimer.unref) initialBootTimer.unref();

    reconciliadorInterval = setInterval(() => {
        if (isQueueBusy || isSyncRunning) return;
        syncBajasGoogleSheets(null, { supabaseClient, isReconciler: true }).catch(err => {
            console.warn('⚠️ [Hover Bajas Sync] Error en ciclo reconciliador:', err.message);
        });
    }, intervalMs);

    if (reconciliadorInterval.unref) reconciliadorInterval.unref();
    return reconciliadorInterval;
}

module.exports = {
    syncBajasGoogleSheets,
    queueSyncBajas,
    iniciarReconciliadorBajas,
    limpiarTrackingNovedad,
    obtenerEstadoTrackingBajas,
    resolveSheetForDate,
    normalizeText,
    indexToColLetter,
    getColChofer,
    formatBajaNote,
    findDriverRowInColValues,
    SPREADSHEETS
};
