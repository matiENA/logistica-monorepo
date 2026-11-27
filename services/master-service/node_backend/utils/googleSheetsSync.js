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
const { getFechaArgentina, supabase: sharedSupabase, getTargetMovimientosSheetsForDate, parseHeaderDateToYMD } = require('./shared');

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
    },
    DICIEMBRE_2026: {
        id: '14QpWY9KvOVj2Yinn5F1hOiSkTxASYwLc-Cd7F2rFO_k',
        tabName: 'DICIEMBRE 2026- Mov.Unidades y Choferes',
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

    // 2. Fallbacks históricos / puente conocidos por mes exacto
    if (year === 2026 && month === 10) {
        return SPREADSHEETS.OCTUBRE_2026;
    }
    if (year === 2026 && month === 11) {
        return SPREADSHEETS.NOVIEMBRE_2026;
    }
    if (year === 2026 && month === 12) {
        return SPREADSHEETS.DICIEMBRE_2026;
    }

    // 3. Variables de entorno activas (#idmensual)
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
 * Resuelve la lista de planillas destino para una fecha (Merge Virtual):
 * - Días normales: [planilla del mes]
 * - Días de cruce (ej. 1 y 2 de Diciembre): [planilla entrante (primary), cola de planilla saliente (bridge_tail)]
 */
function resolveSheetsForDate(d) {
    try {
        const targets = getTargetMovimientosSheetsForDate(d);
        if (Array.isArray(targets) && targets.length > 0) {
            return targets.map(t => ({
                role: t.role || 'primary',
                id: t.id,
                tabName: t.tabName,
                sheetIdNum: 0
            }));
        }
    } catch (_) {}
    const single = resolveSheetForDate(d);
    return [{ role: 'primary', ...single }];
}

/**
 * Busca en Fila 1 de una hoja de cruce (`bridge_tail`) la columna exacta de Chofer
 * correspondiente a `targetDate` (ej. 01/12 o 02/12 en la cola de Noviembre).
 * Retorna el índice 0-based de la columna Chofer (colFecha - 3), o null si no existe.
 */
async function resolveBridgeDateColChofer(spreadsheetId, tabName, targetDate, accessToken) {
    const cacheKey = `${spreadsheetId}:::${tabName}`;
    const cached = dayHeaderMapCache.get(cacheKey);
    const now = Date.now();
    let dateMap = null;
    if (cached && (now - cached.ts) < 10 * 60 * 1000) {
        dateMap = cached.map;
    } else {
        const range = `'${tabName}'!A1:RT1`;
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`;
        const res = await fetchWithRetry(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        dateMap = new Map();
        if (res && res.ok) {
            const json = await res.json();
            const r0 = (json.values && json.values[0]) || [];
            r0.forEach((cell, idx) => {
                const ymd = parseHeaderDateToYMD(cell);
                if (ymd) {
                    const k = `${ymd.year}-${ymd.month}-${ymd.day}`;
                    if (!dateMap.has(k)) dateMap.set(k, Math.max(0, idx - 3));
                }
            });
            dayHeaderMapCache.set(cacheKey, { ts: now, map: dateMap });
        }
    }
    const key = `${targetDate.getFullYear()}-${targetDate.getMonth() + 1}-${targetDate.getDate()}`;
    return dateMap.has(key) ? dateMap.get(key) : null;
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

const BAJA_DIAGRAMA_UUID = '77f25961-a989-46a7-b710-1e1c83c2cdbe';
const MAX_SYNC_REINTENTOS = 5;
const NOTE_SEPARATOR = '\n──────────\n';

/**
 * Prioridad jerárquica para composición de notas hover en una misma celda.
 * Regla operativa estricta: BAJA_DIAGRAMA siempre tiene prioridad 0 (primero arriba).
 */
function getTipoPrioridad(tipoCodigo, tipoOrden = null, tipoId = null) {
    const code = String(tipoCodigo || '').trim().toUpperCase();
    const idNorm = String(tipoId || '').trim().toLowerCase();
    if (code === 'BAJA_DIAGRAMA' || idNorm === BAJA_DIAGRAMA_UUID) {
        return 0;
    }
    const ord = Number(tipoOrden);
    return Number.isFinite(ord) && ord > 0 ? ord : 50;
}

/**
 * Emoji visual por código de tipo de novedad
 */
function getTipoEmoji(tipoCodigo) {
    const code = String(tipoCodigo || '').trim().toUpperCase();
    switch (code) {
        case 'BAJA_DIAGRAMA': return '⚠️';
        case 'CERTIFICACION_UNIDAD': return '📋';
        case 'REPARACION': return '🔧';
        case 'ESTADO_DEMORA': return '⏱️';
        case 'EXAMEN_CHOFER': return '🩺';
        default: return '📌';
    }
}

/**
 * Formatea el contenido de la nota emergente (hover note) para cualquier tipo de novedad.
 * Soporta novedades con fecha_objetivo (Hasta: DD/MM/YYYY) y sin fecha_objetivo (Activa).
 */
function formatNovedadNote(tipoTitulo, fechaObjStr, detalle, tipoCodigo = 'BAJA_DIAGRAMA') {
    let fDisplay = '';
    if (fechaObjStr && String(fechaObjStr).trim()) {
        const clean = String(fechaObjStr).split('T')[0].trim();
        if (clean.includes('-')) {
            const parts = clean.split('-');
            if (parts.length === 3) {
                fDisplay = `${parts[2]}/${parts[1]}/${parts[0]}`;
            } else {
                fDisplay = clean;
            }
        } else {
            fDisplay = clean;
        }
    }
    const emoji = getTipoEmoji(tipoCodigo);
    const titulo = String(tipoTitulo || 'BAJA DE DIAGRAMA').trim().toUpperCase();
    const header = fDisplay ? `${emoji} ${titulo} (Hasta: ${fDisplay})` : `${emoji} ${titulo} (Activa)`;
    const lines = [header];
    if (detalle && String(detalle).trim()) {
        lines.push(`Detalle: ${String(detalle).trim()}`);
    }
    return lines.join('\n');
}

/**
 * Alias de compatibilidad hacia atrás
 */
function formatBajaNote(tipoTitulo, fechaObjStr, detalle, tipoCodigo = 'BAJA_DIAGRAMA') {
    return formatNovedadNote(tipoTitulo, fechaObjStr, detalle, tipoCodigo);
}

/**
 * Compone múltiples notas activas sobre una misma celda física respetando jerarquía estricta:
 * BAJA_DIAGRAMA siempre primero (prioridad 0), luego orden de tipos_novedad ASC e id DESC.
 */
function composeCellHoverNotes(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return '';
    const dedup = new Map();
    for (const entry of entries) {
        if (!entry || !entry.note) continue;
        const key = entry.novedad_id != null ? `id_${entry.novedad_id}` : `txt_${entry.note}`;
        dedup.set(key, entry);
    }
    const sorted = Array.from(dedup.values()).sort((a, b) => {
        const pa = Number.isFinite(Number(a.prioridad)) ? Number(a.prioridad) : 50;
        const pb = Number.isFinite(Number(b.prioridad)) ? Number(b.prioridad) : 50;
        if (pa !== pb) return pa - pb;
        return (Number(b.novedad_id) || 0) - (Number(a.novedad_id) || 0);
    });
    return sorted.map(e => e.note).join(NOTE_SEPARATOR);
}

/**
 * Descarga en lotes de hasta 5 columnas (values:batchGet) aquellas columnas no presentes en columnCache.
 * Retorna { ok, failedCols, error } para evitar falsos positivos de limpieza ante timeouts/errores de red.
 */
async function prefetchColumnsBatch(sheetId, tabName, colLetters, accessToken) {
    const missing = Array.from(new Set(colLetters)).filter(c => !columnCache.has(`${sheetId}_${tabName}_${c}`));
    if (missing.length === 0) return { ok: true, failedCols: [], error: null };

    const failedCols = [];
    let lastError = null;
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
                lastError = `batchGet HTTP ${res.status} en [${tabName}] (${chunk.join(', ')})`;
                console.warn(`⚠️ [Hover Sync] ${lastError}`);
                failedCols.push(...chunk);
            } else {
                lastError = `Sin respuesta batchGet en [${tabName}] (${chunk.join(', ')})`;
                failedCols.push(...chunk);
            }
        } catch (e) {
            lastError = `Error en prefetchColumnsBatch (${chunk.join(', ')}): ${e.message}`;
            console.warn(`⚠️ [Hover Sync] ${lastError}`);
            failedCols.push(...chunk);
        }
    }
    return { ok: failedCols.length === 0, failedCols, error: lastError };
}

const unitsRowMapCache = new Map();

/**
 * Escanea el catálogo de unidades de las columnas A..F (filas 1..350)
 * para mapear UTE y Tractor a su fila física 1-based en la planilla Movimientos.
 * Nunca cachea un resultado vacío tras un timeout o error HTTP.
 */
async function getUnitsRowMap(sheetId, tabName, accessToken) {
    const cacheKey = `${sheetId}:::${tabName}`;
    const cached = unitsRowMapCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
    }

    const mapUteToRow = new Map();
    const mapTractorToRow = new Map();
    const rangeEnc = encodeURIComponent(`'${tabName}'!C1:F250`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${rangeEnc}?valueRenderOption=UNFORMATTED_VALUE`;
    let fetchOk = false;

    try {
        const res = await fetchWithRetry(url, {
            headers: { Authorization: `Bearer ${accessToken}` }
        }, 210000, 2);

        if (res && res.ok) {
            fetchOk = true;
            const data = await res.json();
            const rows = data.values || [];
            rows.forEach((r, idx) => {
                const rowNum = 1 + idx;
                const uteRaw = r && r[0] ? String(r[0]).trim() : '';
                const tracRaw = r && r[2] ? String(r[2]).trim() : '';
                const semiRaw = r && r[3] ? String(r[3]).trim() : '';

                if (uteRaw) {
                    const cleanU = uteRaw.toUpperCase().replace(/\s+/g, '');
                    mapUteToRow.set(cleanU, rowNum);
                    const numOnly = cleanU.replace(/^0+/, '');
                    if (numOnly) mapUteToRow.set(numOnly, rowNum);
                }
                if (tracRaw) {
                    const cleanT = tracRaw.toUpperCase().replace(/[\s\-_.]/g, '');
                    mapTractorToRow.set(cleanT, rowNum);
                }
                if (semiRaw) {
                    const cleanS = semiRaw.toUpperCase().replace(/[\s\-_.]/g, '');
                    mapTractorToRow.set(cleanS, rowNum);
                }
            });
        }
    } catch (e) {
        console.warn(`⚠️ [Hover Sync] Error obteniendo mapeo de unidades en [${tabName}]:`, e.message);
    }

    const result = { mapUteToRow, mapTractorToRow, ok: fetchOk };
    if (fetchOk && (mapUteToRow.size > 0 || mapTractorToRow.size > 0)) {
        unitsRowMapCache.set(cacheKey, {
            data: result,
            expiresAt: Date.now() + 60 * 60 * 1000 // 60 min TTL
        });
    }
    return result;
}

/**
 * Compara si el texto de una celda coincide con el nombre de un chofer buscado.
 * Insensible a acentos, signos de puntuación y espacios.
 */
function isDriverMatch(cellVal, normChofer) {
    if (!cellVal || !normChofer) return false;
    const normCell = normalizeText(cellVal);
    if (!normCell) return false;
    if (normChofer === normCell) return true;
    if (normChofer.length >= 6 && normCell.includes(normChofer)) return true;
    if (normCell.length >= 6 && normChofer.includes(normCell)) return true;
    return false;
}

/**
 * Busca estrictamente al chofer en los valores de la columna Chofer del día (filas 3..250, 1-based)
 * Regla operativa estricta: SIN fallback a tractor.
 */
function findDriverRowInColValues(colVals, normChofer) {
    if (!normChofer || !Array.isArray(colVals)) return null;
    for (let r = 2; r < colVals.length; r++) {
        if (isDriverMatch(colVals[r], normChofer)) {
            return r + 1; // 1-based row index
        }
    }
    return null;
}

/**
 * Convierte Map<dateStr, info> a objeto JSON plano ordenadamente para persistencia en public.novedades.sync_sheets_celdas
 */
function mapDiasToPlainObject(diasMap) {
    const obj = {};
    if (!(diasMap instanceof Map)) return obj;
    const keys = Array.from(diasMap.keys()).sort();
    for (const k of keys) {
        const v = diasMap.get(k);
        if (!v) continue;
        obj[k] = {
            status: v.status,
            coord: v.coord || null,
            colLetter: v.colLetter || null,
            colIdx: v.colIdx != null ? v.colIdx : null,
            row1Based: v.row1Based != null ? v.row1Based : null,
            sheetId: v.sheetId || null,
            tabName: v.tabName || null
        };
    }
    return obj;
}

/**
 * Hidrata Map<dateStr, info> desde JSONB persistido en public.novedades.sync_sheets_celdas
 */
function plainObjectToDiasMap(raw) {
    const m = new Map();
    if (!raw || typeof raw !== 'object') return m;
    for (const [k, v] of Object.entries(raw)) {
        if (v && typeof v === 'object') {
            m.set(k, v);
        }
    }
    return m;
}

/**
 * Smart Diff UPDATE directo sobre la tabla física public.novedades (0 vistas, 0 WAL/Realtime redundantes).
 * Solo escribe si cambia estado, hash, celdas o error; nunca altera actualizado_el.
 */
async function persistirEstadoSyncNovedad(novedadId, {
    estado,
    celdas = undefined,
    hash = undefined,
    error = undefined,
    incrementarReintento = false,
    resetReintentos = false,
    marcarSincronizado = false
} = {}) {
    if (!db.isConfigured() || novedadId == null) return false;
    const idClean = Number(novedadId);
    if (!Number.isFinite(idClean)) return false;

    try {
        const celdasJson = celdas !== undefined ? JSON.stringify(celdas || {}) : null;
        const hashVal = hash !== undefined ? (hash === null ? null : String(hash)) : null;
        const errVal = error !== undefined ? (error ? String(error).slice(0, 500) : null) : null;

        if (incrementarReintento) {
            const { rowCount } = await db.query(
                `UPDATE public.novedades
                 SET sync_sheets_reintentos = LEAST(COALESCE(sync_sheets_reintentos, 0) + 1, 32767),
                     sync_sheets_estado = CASE
                         WHEN COALESCE(sync_sheets_reintentos, 0) + 1 >= $2 THEN 'ERROR'
                         ELSE 'PAUSADO'
                     END,
                     sync_sheets_error = $3
                 WHERE id = $1::bigint`,
                [idClean, MAX_SYNC_REINTENTOS, errVal]
            );
            return rowCount > 0;
        }

        const { rowCount } = await db.query(
            `UPDATE public.novedades
             SET sync_sheets_estado = $2,
                 sync_sheets_celdas = COALESCE($3::jsonb, sync_sheets_celdas),
                 sync_sheets_hash = CASE WHEN $4::boolean THEN $5 ELSE sync_sheets_hash END,
                 sync_sheets_reintentos = CASE WHEN $6::boolean THEN 0 ELSE sync_sheets_reintentos END,
                 sync_sheets_error = CASE WHEN $7::boolean THEN $8 ELSE sync_sheets_error END,
                 sync_sheets_at = CASE WHEN $9::boolean THEN NOW() ELSE sync_sheets_at END
             WHERE id = $1::bigint
               AND (
                   sync_sheets_estado IS DISTINCT FROM $2
                   OR ($3::jsonb IS NOT NULL AND sync_sheets_celdas IS DISTINCT FROM $3::jsonb)
                   OR ($4::boolean AND sync_sheets_hash IS DISTINCT FROM $5)
                   OR ($7::boolean AND sync_sheets_error IS DISTINCT FROM $8)
               )`,
            [
                idClean,
                estado,
                celdasJson,
                hash !== undefined,
                hashVal,
                Boolean(resetReintentos),
                error !== undefined,
                errVal,
                Boolean(marcarSincronizado)
            ]
        );
        return rowCount > 0;
    } catch (e) {
        console.warn(`⚠️ [Hover Sync DB] Error persistiendo estado en novedades#${idClean}:`, e.message);
        return false;
    }
}

/**
 * Recupera novedades resueltas o editadas que quedaron en PENDIENTE_LIMPIEZA (ej. ante reinicio o pausa)
 */
async function fetchPendingCleanups() {
    if (!db.isConfigured()) return [];
    try {
        const { rows } = await db.query(
            `SELECT
                n.id,
                n.chofer_id,
                UPPER(TRIM(COALESCE(c.nombre, ''))) AS chofer_nombre,
                n.unidad_id,
                COALESCE(u.n_ute, '') AS n_ute,
                UPPER(TRIM(COALESCE(t.patente, ''))) AS tractor,
                TO_CHAR(n.fecha_objetivo, 'YYYY-MM-DD') AS fecha_objetivo,
                n.sync_sheets_celdas,
                n.sync_sheets_reintentos
             FROM public.novedades n
             LEFT JOIN public.choferes c ON n.chofer_id = c.id
             LEFT JOIN public.unidades u ON n.unidad_id = u.id
             LEFT JOIN public.tractores t ON u.tractor_id = t.id
             WHERE n.sync_sheets_estado = 'PENDIENTE_LIMPIEZA'
               AND COALESCE(n.sync_sheets_reintentos, 0) < $1
             ORDER BY n.id DESC
             LIMIT 100`,
            [MAX_SYNC_REINTENTOS]
        );
        return rows || [];
    } catch (e) {
        console.warn('⚠️ [Hover Sync DB] Error consultando PENDIENTE_LIMPIEZA:', e.message);
        return [];
    }
}

/**
 * Consulta en PostgreSQL (o fallback Supabase) las novedades activas cuya relación UUID
 * hacia public.tipos_novedad tenga imprime_nota_movimientos = true (todas excepto LIBRES).
 * Soporta novedades con fecha_objetivo >= HOY y también fecha_objetivo IS NULL (ej. REPARACION / ESTADO_DEMORA).
 * Ordena estrictamente con BAJA_DIAGRAMA primero.
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
                n.unidad_id,
                COALESCE(u.n_ute, '') AS n_ute,
                UPPER(TRIM(COALESCE(t.patente, ''))) AS tractor,
                n.tipo_novedad_id,
                tn.codigo AS tipo_novedad,
                tn.titulo AS tipo_novedad_titulo,
                COALESCE(tn.orden, 50) AS tipo_novedad_orden,
                COALESCE(tn.imprime_nota_movimientos, false) AS imprime_nota_movimientos,
                TO_CHAR(n.fecha_objetivo, 'YYYY-MM-DD') AS fecha_objetivo,
                n.detalle,
                n.resuelto,
                n.sync_sheets_estado,
                n.sync_sheets_celdas,
                n.sync_sheets_hash,
                n.sync_sheets_reintentos
             FROM public.novedades n
             JOIN public.tipos_novedad tn ON n.tipo_novedad_id = tn.id
             LEFT JOIN public.choferes c ON n.chofer_id = c.id
             LEFT JOIN public.unidades u ON n.unidad_id = u.id
             LEFT JOIN public.tractores t ON u.tractor_id = t.id
             WHERE tn.imprime_nota_movimientos = true
               AND UPPER(TRIM(tn.codigo)) <> 'LIBRES'
               AND n.resuelto = false
               AND n.chofer_id IS NOT NULL
               AND (
                   n.fecha_objetivo IS NULL
                   OR n.fecha_objetivo >= (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
               )
               ${extraWhere}
             ORDER BY (CASE WHEN UPPER(TRIM(tn.codigo)) = 'BAJA_DIAGRAMA' THEN 0 ELSE 1 END) ASC,
                      COALESCE(tn.orden, 50) ASC,
                      n.id DESC`,
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
            .neq('tipo_novedad', 'LIBRES')
            .eq('resuelto', false)
            .not('chofer_id', 'is', null)
            .order('id', { ascending: false });

        if (filterChoferId) {
            query = query.eq('chofer_id', filterChoferId);
        }

        const { data, error } = await query;
        if (error) throw new Error(error.message);
        const rows = data || [];
        rows.sort((a, b) => {
            const pa = getTipoPrioridad(a.tipo_novedad, a.tipo_novedad_orden, a.tipo_novedad_id);
            const pb = getTipoPrioridad(b.tipo_novedad, b.tipo_novedad_orden, b.tipo_novedad_id);
            if (pa !== pb) return pa - pb;
            return (Number(b.id) || 0) - (Number(a.id) || 0);
        });
        return rows;
    }

    return [];
}

/**
 * Consulta en vivo el estado de sincronización directamente sobre la tabla física public.novedades
 * (sin vistas adicionales, aprovechando idx_novedades_sync_sheets_activos).
 */
async function obtenerEstadoSyncNovedades() {
    if (!db.isConfigured()) {
        return {
            resumen: {},
            pendientes: [],
            trackingRam: obtenerEstadoTrackingBajas()
        };
    }

    const [{ rows: counts }, { rows: detalle }] = await Promise.all([
        db.query(
            `SELECT sync_sheets_estado AS estado, COUNT(*)::int AS cantidad
             FROM public.novedades
             GROUP BY sync_sheets_estado
             ORDER BY sync_sheets_estado`
        ),
        db.query(
            `SELECT
                n.id AS novedad_id,
                tn.codigo AS tipo_novedad,
                tn.titulo AS tipo_novedad_titulo,
                n.tipo_novedad_id,
                n.chofer_id,
                UPPER(TRIM(COALESCE(c.nombre, ''))) AS chofer_nombre,
                COALESCE(u.n_ute, '') AS n_ute,
                TO_CHAR(n.fecha_objetivo, 'YYYY-MM-DD') AS fecha_objetivo,
                n.resuelto,
                n.sync_sheets_estado,
                n.sync_sheets_reintentos,
                n.sync_sheets_error,
                n.sync_sheets_at,
                n.sync_sheets_celdas
             FROM public.novedades n
             JOIN public.tipos_novedad tn ON n.tipo_novedad_id = tn.id
             LEFT JOIN public.choferes c ON n.chofer_id = c.id
             LEFT JOIN public.unidades u ON n.unidad_id = u.id
             WHERE n.sync_sheets_estado IN ('PENDIENTE', 'PENDIENTE_LIMPIEZA', 'PAUSADO', 'PENDIENTE_TIPEO', 'ERROR')
                OR (n.sync_sheets_estado = 'SINCRONIZADO' AND n.resuelto = false)
             ORDER BY (CASE WHEN n.sync_sheets_estado IN ('ERROR', 'PAUSADO', 'PENDIENTE_LIMPIEZA', 'PENDIENTE') THEN 0 ELSE 1 END) ASC,
                      (CASE WHEN UPPER(TRIM(tn.codigo)) = 'BAJA_DIAGRAMA' THEN 0 ELSE 1 END) ASC,
                      n.id DESC
             LIMIT 100`
        )
    ]);

    const resumen = {};
    for (const row of counts || []) {
        resumen[row.estado] = row.cantidad;
    }

    return {
        resumen,
        items: detalle || [],
        trackingRam: obtenerEstadoTrackingBajas()
    };
}

/**
 * Reanuda manualmente novedades en estado PAUSADO o ERROR reseteando reintentos y disparando sync inmediato.
 */
async function reanudarSyncPausados(options = {}) {
    if (!db.isConfigured()) {
        return { success: false, error: 'PostgreSQL no configurado' };
    }

    const { rows } = await db.query(
        `UPDATE public.novedades
         SET sync_sheets_estado = CASE
                 WHEN resuelto = true THEN 'PENDIENTE_LIMPIEZA'
                 ELSE 'PENDIENTE'
             END,
             sync_sheets_reintentos = 0,
             sync_sheets_error = NULL
         WHERE sync_sheets_estado IN ('PAUSADO', 'ERROR')
         RETURNING id, sync_sheets_estado`
    );

    const reanudados = rows.length;
    const syncResult = await syncBajasGoogleSheets(null, {
        forceRefresh: true,
        dryRun: Boolean(options?.dryRun)
    });

    return {
        success: Boolean(syncResult?.success),
        reanudados,
        syncResult
    };
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
        // ACCIÓN 2: SINCRONIZACIÓN E INYECCIÓN DE NOTAS ACTIVAS (MULTI-NOVEDAD)
        // =================================================================
        let novedades = [];
        let isFullSweep = false;
        let recoveredCleanups = 0;

        if (
            contextoNovedad &&
            (contextoNovedad.chofer_id || contextoNovedad.chofer_nombre || contextoNovedad.nom)
        ) {
            // Para garantizar composición jerárquica multi-novedad (BAJA_DIAGRAMA siempre primero),
            // si tenemos chofer_id traemos todas sus novedades activas elegibles desde PostgreSQL.
            if (contextoNovedad.chofer_id) {
                const delChofer = await fetchActiveNovedadesConNota(supabaseClient, contextoNovedad.chofer_id);
                novedades = delChofer.length > 0 ? delChofer : [contextoNovedad];
            } else {
                novedades = [contextoNovedad];
            }
        } else {
            isFullSweep = true;

            // 2.0. Recuperar limpiezas pendientes que hayan quedado en pausa / tras reinicio
            const pendingCleanups = await fetchPendingCleanups();
            for (const cleanRow of pendingCleanups) {
                const cleanRes = await ejecutarLimpiezaNotas(
                    {
                        action: 'limpiar',
                        id: cleanRow.id,
                        chofer_id: cleanRow.chofer_id,
                        chofer_nombre: cleanRow.chofer_nombre,
                        unidad_id: cleanRow.unidad_id,
                        n_ute: cleanRow.n_ute,
                        tractor: cleanRow.tractor,
                        fecha_objetivo: cleanRow.fecha_objetivo,
                        sync_sheets_celdas: cleanRow.sync_sheets_celdas
                    },
                    accessToken,
                    supabaseClient,
                    hoy,
                    dryRun,
                    { skipResyncOthers: true }
                );
                if (cleanRes?.success) recoveredCleanups++;
            }

            novedades = await fetchActiveNovedadesConNota(supabaseClient);
        }

        // En barrido completo, depurar del tracker en RAM las novedades que ya no están vigentes
        if (isFullSweep) {
            const activeIds = new Set(novedades.map(n => String(n.id)));
            for (const trackedId of Array.from(bajasSyncTracker.keys())) {
                if (!activeIds.has(trackedId)) {
                    bajasSyncTracker.delete(trackedId);
                }
            }
        }

        if (novedades.length === 0) {
            return { success: true, count: 0, pendingDays: 0, recoveredCleanups };
        }

        // Garantizar orden jerárquico: BAJA_DIAGRAMA siempre primero
        novedades.sort((a, b) => {
            const pa = getTipoPrioridad(a.tipo_novedad, a.tipo_novedad_orden, a.tipo_novedad_id);
            const pb = getTipoPrioridad(b.tipo_novedad, b.tipo_novedad_orden, b.tipo_novedad_id);
            if (pa !== pb) return pa - pb;
            return (Number(b.id) || 0) - (Number(a.id) || 0);
        });

        // Paso A: Evaluar días por novedad, determinar qué días necesitan lectura fresca o escritura
        const neededColsBySheet = new Map();
        const workPlan = [];
        const hoyIso = toIsoDateLocal(hoy);

        for (const nov of novedades) {
            // Defensa en profundidad: nunca imprimir LIBRES
            if (String(nov.tipo_novedad || '').trim().toUpperCase() === 'LIBRES') continue;

            let choferNom = nov.chofer_nombre || nov.nom || nov.chofer || '';
            if (!choferNom && nov.chofer_id) {
                choferNom = await resolveChoferNombreById(nov.chofer_id, supabaseClient);
            }
            if (!choferNom) continue;

            const normChofer = normalizeText(choferNom);
            if (!normChofer) continue;

            let fObjStr = '';
            let fObj = new Date(hoy.getTime());
            if (nov.fecha_objetivo) {
                fObjStr = (nov.fecha_objetivo instanceof Date)
                    ? toIsoDateLocal(nov.fecha_objetivo)
                    : String(nov.fecha_objetivo).split('T')[0].trim();
                const [y, m, d] = fObjStr.split('-').map(Number);
                if (!y || !m || !d) continue;
                fObj = new Date(y, m - 1, d);
                fObj.setHours(0, 0, 0, 0);
                if (fObj < hoy) continue;
            } else {
                // Sin fecha_objetivo (ej. REPARACION / ESTADO_DEMORA): imprime en el día operativo actual (HOY)
                fObjStr = '';
                fObj = new Date(hoy.getTime());
            }

            const novKey = nov.id != null ? String(nov.id) : `tmp_${normChofer}_${fObjStr || hoyIso}`;
            const tipoCodigo = nov.tipo_novedad || 'BAJA_DIAGRAMA';
            const tipoTitulo = nov.tipo_novedad_titulo || tipoCodigo;
            const prioridad = getTipoPrioridad(tipoCodigo, nov.tipo_novedad_orden, nov.tipo_novedad_id);
            const noteText = formatNovedadNote(tipoTitulo, fObjStr, nov.detalle, tipoCodigo);

            // Hidratar estado previo desde RAM o desde public.novedades.sync_sheets_celdas
            const prevRam = bajasSyncTracker.get(novKey);
            const prevDbDias = plainObjectToDiasMap(nov.sync_sheets_celdas);
            const prevTrackDias = prevRam?.dias || (prevDbDias.size > 0 ? prevDbDias : null);
            const prevHash = prevRam?.noteHash || nov.sync_sheets_hash || null;
            const needsRetry = ['PENDIENTE', 'PAUSADO', 'ERROR'].includes(String(nov.sync_sheets_estado || '').toUpperCase());
            const noteChanged = !prevTrackDias || prevHash !== noteText || needsRetry || (prevRam && prevRam.chofer_nombre !== choferNom);

            const daysForNov = [];
            let cur = new Date(hoy.getTime());
            while (cur <= fObj) {
                const baseDateStr = toIsoDateLocal(cur);
                const diaNum = cur.getDate();
                const targetSheets = resolveSheetsForDate(cur);

                for (const baseSheet of targetSheets) {
                    const isBridgeTail = baseSheet.role === 'bridge_tail';
                    const resolvedMeta = await resolveDynamicSheetMeta(baseSheet.id, baseSheet.tabName, cur, accessToken);

                    let colIdx = null;
                    if (isBridgeTail) {
                        colIdx = await resolveBridgeDateColChofer(baseSheet.id, resolvedMeta.tabName, cur, accessToken);
                        if (colIdx === null) {
                            continue;
                        }
                    } else {
                        // Guardia de cruce mensual para hoja primaria
                        const tabYM = parseMonthYearFromText(resolvedMeta.tabName);
                        if (tabYM && (tabYM.year !== cur.getFullYear() || tabYM.month !== (cur.getMonth() + 1))) {
                            continue;
                        }
                        colIdx = getColChofer(diaNum);
                    }

                    const dateStr = isBridgeTail ? `${baseDateStr}#bridge` : baseDateStr;
                    const colLetter = indexToColLetter(colIdx);

                    const prevDay = prevTrackDias?.get(dateStr) || null;
                    const alreadySynced = Boolean(
                        !isReconciler &&
                        !forceRefresh &&
                        !noteChanged &&
                        prevDay &&
                        prevDay.status === 'SINCRONIZADO' &&
                        prevDay.coord
                    );

                    if (!alreadySynced) {
                        const cacheKey = `${baseSheet.id}_${resolvedMeta.tabName}_${colLetter}`;
                        if (forceRefresh || isReconciler || !prevDay || prevDay.status === 'PENDIENTE_TIPEO' || needsRetry) {
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
                }

                cur.setDate(cur.getDate() + 1);
            }

            workPlan.push({
                nov,
                novKey,
                choferNom,
                normChofer,
                tipoCodigo,
                prioridad,
                fObjStr: fObjStr || hoyIso,
                noteText,
                daysForNov,
                touchedSheetIds: new Set()
            });
        }

        // Si todas las celdas de todas las novedades activas ya están sincronizadas, salir con 0 llamadas a values:batchGet
        if (neededColsBySheet.size === 0) {
            return { success: true, count: 0, pendingDays: 0, recoveredCleanups, skippedAlreadySynced: true };
        }

        // Paso B: Descargar columnas pendientes en lote
        const prefetchErrorsBySheet = new Map();
        for (const [, group] of neededColsBySheet.entries()) {
            const pfRes = await prefetchColumnsBatch(group.sheetId, group.tabName, Array.from(group.cols), accessToken);
            if (!pfRes.ok) {
                prefetchErrorsBySheet.set(group.sheetId, pfRes.error || `Error leyendo columnas ${pfRes.failedCols.join(', ')}`);
            }
        }

        // Paso C: Detectar presencia del chofer, componer notas por celda (jerarquía BAJA_DIAGRAMA primero)
        const cellOpsBySpreadsheet = new Map();
        const plannedItems = [];
        let pendingDaysCount = 0;

        function getCellBucket(sheetId, tabName, sheetIdNum, r1Based, colIdx) {
            if (!cellOpsBySpreadsheet.has(sheetId)) {
                cellOpsBySpreadsheet.set(sheetId, {
                    tabName,
                    cells: new Map()
                });
            }
            const sheetGroup = cellOpsBySpreadsheet.get(sheetId);
            const row0 = r1Based - 1;
            const cellKey = `${sheetIdNum}_${row0}_${colIdx}`;
            if (!sheetGroup.cells.has(cellKey)) {
                sheetGroup.cells.set(cellKey, {
                    sheetIdNum,
                    row0,
                    colIdx,
                    injectEntries: [],
                    shouldClear: false
                });
            }
            return sheetGroup.cells.get(cellKey);
        }

        for (const item of workPlan) {
            const { nov, novKey, choferNom, normChofer, tipoCodigo, prioridad, fObjStr, noteText, daysForNov, touchedSheetIds } = item;
            const diasMap = new Map();

            const cleanUteNov = nov.n_ute ? String(nov.n_ute).trim().toUpperCase().replace(/\s+/g, '') : '';
            const cleanTracNov = nov.tractor ? String(nov.tractor).trim().toUpperCase().replace(/[\s\-_.]/g, '') : '';

            for (const dInfo of daysForNov) {
                if (dInfo.alreadySynced && dInfo.prevDay) {
                    diasMap.set(dInfo.dateStr, dInfo.prevDay);
                    // Incluso si ya estaba sincronizada individualmente, si otro item toca esta celda,
                    // aportar su entrada para preservar la composición jerárquica completa.
                    if (dInfo.prevDay.row1Based) {
                        const bucket = getCellBucket(dInfo.sheetId, dInfo.tabName, dInfo.sheetIdNum, dInfo.prevDay.row1Based, dInfo.colIdx);
                        bucket.injectEntries.push({
                            novedad_id: nov.id || null,
                            prioridad,
                            tipo_novedad: tipoCodigo,
                            note: noteText
                        });
                    }
                    continue;
                }

                const { mapUteToRow, mapTractorToRow } = await getUnitsRowMap(dInfo.sheetId, dInfo.tabName, accessToken);

                let rowUnit = null;
                if (cleanUteNov) {
                    rowUnit = mapUteToRow.get(cleanUteNov) || mapUteToRow.get(cleanUteNov.replace(/^0+/, '')) || null;
                }
                if (!rowUnit && cleanTracNov) {
                    rowUnit = mapTractorToRow.get(cleanTracNov) || null;
                }

                const colVals = columnCache.get(`${dInfo.sheetId}_${dInfo.tabName}_${dInfo.colLetter}`) || [];
                const prevRow = dInfo.prevDay?.row1Based || null;

                function markClearHoverNote(r1Based) {
                    if (!r1Based || r1Based < 1) return;
                    const bucket = getCellBucket(dInfo.sheetId, dInfo.tabName, dInfo.sheetIdNum, r1Based, dInfo.colIdx);
                    bucket.shouldClear = true;
                    touchedSheetIds.add(dInfo.sheetId);
                }

                function markSetHoverNote(r1Based) {
                    if (!r1Based || r1Based < 1) return;
                    const bucket = getCellBucket(dInfo.sheetId, dInfo.tabName, dInfo.sheetIdNum, r1Based, dInfo.colIdx);
                    bucket.injectEntries.push({
                        novedad_id: nov.id || null,
                        prioridad,
                        tipo_novedad: tipoCodigo,
                        note: noteText
                    });
                    touchedSheetIds.add(dInfo.sheetId);
                }

                let targetRow = null;

                // 1. REGLA CLAVE: "header nombre > fk chofer_id"
                if (rowUnit !== null) {
                    const cellValAtUnit = (rowUnit <= colVals.length) ? colVals[rowUnit - 1] : '';
                    const sameDriverAtUnit = isDriverMatch(cellValAtUnit, normChofer);

                    if (sameDriverAtUnit) {
                        targetRow = rowUnit;
                    } else {
                        markClearHoverNote(rowUnit);
                        console.log(`🧹 [Hover Sync] Chofer en unidad [${cleanUteNov || cleanTracNov || rowUnit}] (${dInfo.dateStr}) dejó de ser '${choferNom}' (actual: '${cellValAtUnit || 'VACÍO'}'). Nota hover eliminada de ${dInfo.colLetter}${rowUnit}.`);
                    }
                }

                // 2. Si no estuvo en la fila de la unidad (o no tenía unidad), buscar si el chofer fue diagramado en otra fila
                if (targetRow === null) {
                    const rowFoundAny = findDriverRowInColValues(colVals, normChofer);
                    if (rowFoundAny !== null) {
                        targetRow = rowFoundAny;
                    }
                }

                // 3. Si en una celda previamente sincronizada (prevRow) el chofer ya no está, limpiarla
                if (prevRow !== null && prevRow !== targetRow) {
                    const cellValAtPrev = (prevRow <= colVals.length) ? colVals[prevRow - 1] : '';
                    if (!isDriverMatch(cellValAtPrev, normChofer)) {
                        markClearHoverNote(prevRow);
                        console.log(`🧹 [Hover Sync] Celda previa ${dInfo.colLetter}${prevRow} (${dInfo.dateStr}) ya no contiene a '${choferNom}'. Nota hover eliminada.`);
                    }
                }

                // 4. Asignar estado e inyectar nota compuesta si corresponde
                if (targetRow !== null) {
                    const coord = `${dInfo.colLetter}${targetRow}`;
                    console.log(`📍 [Hover Sync] [${tipoCodigo}] Chofer '${choferNom}' activo en [${dInfo.tabName}] ${coord} (${dInfo.dateStr})`);

                    diasMap.set(dInfo.dateStr, {
                        status: 'SINCRONIZADO',
                        coord,
                        colLetter: dInfo.colLetter,
                        colIdx: dInfo.colIdx,
                        row1Based: targetRow,
                        sheetId: dInfo.sheetId,
                        tabName: dInfo.tabName,
                        updatedAt: new Date().toISOString()
                    });

                    plannedItems.push({
                        novedad_id: nov.id || null,
                        tipo_novedad: tipoCodigo,
                        prioridad,
                        chofer: choferNom,
                        date: dInfo.dateStr,
                        coord,
                        tabName: dInfo.tabName,
                        note: noteText
                    });

                    markSetHoverNote(targetRow);
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
                        console.log(`⏳ [Hover Sync] [${tipoCodigo}] Día ${dInfo.dateStr} en espera (PENDIENTE_TIPEO): '${choferNom}' no presente en columna ${dInfo.colLetter}`);
                    }
                }
            }

            item.diasMap = diasMap;

            if (!dryRun && nov.id != null) {
                bajasSyncTracker.set(novKey, {
                    novedad_id: Number(nov.id),
                    tipo_novedad_id: nov.tipo_novedad_id || null,
                    tipo_novedad: tipoCodigo,
                    chofer_id: nov.chofer_id || null,
                    chofer_nombre: choferNom,
                    fecha_objetivo: fObjStr,
                    noteHash: noteText,
                    dias: diasMap
                });
            }
        }

        // Construir solicitudes finales compuestas por celda (BAJA_DIAGRAMA siempre primero)
        const requestsBySpreadsheet = new Map();
        const composedPreview = [];

        for (const [sheetId, group] of cellOpsBySpreadsheet.entries()) {
            const finalRequests = [];
            for (const bucket of group.cells.values()) {
                let finalNote = null;
                if (bucket.injectEntries.length > 0) {
                    finalNote = composeCellHoverNotes(bucket.injectEntries);
                } else if (bucket.shouldClear) {
                    finalNote = '';
                }
                if (finalNote === null) continue;

                if (dryRun) {
                    composedPreview.push({
                        sheetId,
                        tabName: group.tabName,
                        coord: `${indexToColLetter(bucket.colIdx)}${bucket.row0 + 1}`,
                        novedadesCount: bucket.injectEntries.length,
                        note: finalNote
                    });
                }

                finalRequests.push({
                    updateCells: {
                        range: {
                            sheetId: bucket.sheetIdNum,
                            startRowIndex: bucket.row0,
                            endRowIndex: bucket.row0 + 1,
                            startColumnIndex: bucket.colIdx,
                            endColumnIndex: bucket.colIdx + 1
                        },
                        rows: [{ values: [{ note: finalNote }] }],
                        fields: 'note'
                    }
                });
            }
            if (finalRequests.length > 0) {
                requestsBySpreadsheet.set(sheetId, {
                    tabName: group.tabName,
                    requests: finalRequests
                });
            }
        }

        if (dryRun) {
            return {
                success: true,
                dryRun: true,
                count: composedPreview.length,
                pendingDays: pendingDaysCount,
                recoveredCleanups,
                planned: plannedItems,
                composedCells: composedPreview
            };
        }

        // Paso D: Aplicar lotes en Google Sheets API con fields: 'note'
        let totalApplied = 0;
        const failedSheets = new Map(prefetchErrorsBySheet);

        for (const [sheetId, group] of requestsBySpreadsheet.entries()) {
            const finalRequests = group.requests;
            const batchSize = 100;
            for (let i = 0; i < finalRequests.length; i += batchSize) {
                const chunk = finalRequests.slice(i, i + batchSize);
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
                        console.log(`✅ [Hover Sync] ${chunk.length} celda(s) hover actualizadas en [${group.tabName}].`);
                        totalApplied += chunk.length;
                    } else if (updateRes) {
                        const errBody = await updateRes.text();
                        const errMsg = `HTTP ${updateRes.status}: ${errBody.slice(0, 250)}`;
                        console.warn(`⚠️ [Hover Sync] Error batchUpdate en ${sheetId}: ${errMsg}`);
                        failedSheets.set(sheetId, errMsg);
                    }
                } catch (batchErr) {
                    console.warn(`⚠️ [Hover Sync] Excepción batchUpdate en ${sheetId}:`, batchErr.message);
                    failedSheets.set(sheetId, batchErr.message);
                }
            }
        }

        // Paso E: Persistencia Smart Diff directa en public.novedades (0 writes si nada cambió)
        for (const item of workPlan) {
            if (item.nov?.id == null) continue;
            const sheetErrors = [];
            for (const sid of item.touchedSheetIds) {
                if (failedSheets.has(sid)) sheetErrors.push(failedSheets.get(sid));
            }

            if (sheetErrors.length > 0) {
                await persistirEstadoSyncNovedad(item.nov.id, {
                    incrementarReintento: true,
                    error: sheetErrors.join(' | ')
                });
                continue;
            }

            const diasObj = mapDiasToPlainObject(item.diasMap);
            let syncCount = 0;
            let pendCount = 0;
            for (const info of Object.values(diasObj)) {
                if (info.status === 'SINCRONIZADO') syncCount++;
                else pendCount++;
            }

            const nuevoEstado = (pendCount === 0 && syncCount > 0)
                ? 'SINCRONIZADO'
                : (pendCount > 0 ? 'PENDIENTE_TIPEO' : 'PENDIENTE');

            await persistirEstadoSyncNovedad(item.nov.id, {
                estado: nuevoEstado,
                celdas: diasObj,
                hash: item.noteText,
                resetReintentos: true,
                error: null,
                marcarSincronizado: syncCount > 0
            });
        }

        return {
            success: failedSheets.size === 0,
            count: totalApplied,
            pendingDays: pendingDaysCount,
            recoveredCleanups
        };
    } catch (err) {
        console.warn('⚠️ [Hover Sync] Error general durante sincronización:', err.message);
        return { success: false, error: err.message };
    } finally {
        isSyncRunning = false;
    }
}

/**
 * Limpia notas hover (note: '') para una novedad resuelta, cancelada o cuyo rango se acortó.
 * Lee también sync_sheets_celdas persistidas en public.novedades para sobrevivir a reinicios/pausas
 * y a novedades sin fecha_objetivo.
 * Si el mismo chofer conserva otra novedad activa con imprime_nota_movimientos = true,
 * re-sincroniza inmediatamente sus días vigentes respetando la jerarquía (BAJA_DIAGRAMA primero).
 */
async function ejecutarLimpiezaNotas(contexto, accessToken, supabaseClient, hoy, dryRun = false, opts = {}) {
    try {
        // Recuperar tracking previo (RAM y DB) antes de limpiar RAM
        const prevTrackEntryRam = contexto.id != null ? bajasSyncTracker.get(String(contexto.id)) : null;
        let persistedCeldas = (contexto.sync_sheets_celdas && typeof contexto.sync_sheets_celdas === 'object')
            ? contexto.sync_sheets_celdas
            : null;

        if (!persistedCeldas && contexto.id != null && db.isConfigured()) {
            try {
                const { rows } = await db.query(
                    `SELECT sync_sheets_celdas FROM public.novedades WHERE id = $1::bigint LIMIT 1`,
                    [contexto.id]
                );
                if (rows.length > 0 && rows[0].sync_sheets_celdas) {
                    persistedCeldas = rows[0].sync_sheets_celdas;
                }
            } catch (_) {}
        }

        if (contexto.id != null) {
            limpiarTrackingNovedad(contexto.id);
        }

        let choferNom = contexto.chofer_nombre || contexto.nom || contexto.chofer || '';
        if (!choferNom && contexto.chofer_id) {
            choferNom = await resolveChoferNombreById(contexto.chofer_id, supabaseClient);
        }

        const normChofer = normalizeText(choferNom);
        const persistedDaysMap = plainObjectToDiasMap(persistedCeldas);

        if (!choferNom && persistedDaysMap.size === 0) {
            if (!dryRun && contexto.id != null && !contexto.desde_fecha) {
                await persistirEstadoSyncNovedad(contexto.id, {
                    estado: 'LIMPIADO',
                    celdas: {},
                    hash: null,
                    resetReintentos: true,
                    error: null,
                    marcarSincronizado: true
                });
            }
            return { success: true, count: 0 };
        }

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

        // Construir conjunto de fechas a limpiar: rango [inicio..fObj] (o HOY si fObj es null) + fechas persistidas
        const dateSet = new Set();
        if (contexto.fecha_objetivo) {
            const fObjStr = (contexto.fecha_objetivo instanceof Date)
                ? toIsoDateLocal(contexto.fecha_objetivo)
                : String(contexto.fecha_objetivo).split('T')[0].trim();
            const [y, m, d] = fObjStr.split('-').map(Number);
            if (y && m && d) {
                const fObj = new Date(y, m - 1, d);
                fObj.setHours(0, 0, 0, 0);
                let curCheck = new Date(fechaInicioLimpieza.getTime());
                while (curCheck <= fObj) {
                    dateSet.add(toIsoDateLocal(curCheck));
                    curCheck.setDate(curCheck.getDate() + 1);
                }
            }
        } else if (!contexto.desde_fecha) {
            // Novedad sin fecha_objetivo: limpiar el día operativo actual (HOY)
            dateSet.add(toIsoDateLocal(hoy));
        }

        // Agregar fechas persistidas en sync_sheets_celdas (solo >= fechaInicioLimpieza si es recorte parcial)
        const inicioIso = toIsoDateLocal(fechaInicioLimpieza);
        for (const [dStr, info] of persistedDaysMap.entries()) {
            if (!contexto.desde_fecha || dStr >= inicioIso) {
                if (info?.row1Based || dStr >= inicioIso) {
                    dateSet.add(dStr);
                }
            }
        }

        if (dateSet.size === 0) {
            if (!dryRun && contexto.id != null && !contexto.desde_fecha) {
                await persistirEstadoSyncNovedad(contexto.id, {
                    estado: 'LIMPIADO',
                    celdas: {},
                    hash: null,
                    resetReintentos: true,
                    error: null,
                    marcarSincronizado: true
                });
            }
            return { success: true, count: 0 };
        }

        const sortedDates = Array.from(dateSet).sort();
        console.log(`🧹 [Hover Sync] Limpiando notas hover de '${choferNom || contexto.id}' (${sortedDates[0]} .. ${sortedDates[sortedDates.length - 1]})...`);

        const neededCols = new Map();
        const scanDays = [];
        for (const rawDateStr of sortedDates) {
            const cleanDateStr = String(rawDateStr).split('#')[0];
            const [cy, cm, cd] = cleanDateStr.split('-').map(Number);
            if (!cy || !cm || !cd) continue;
            const curCheck = new Date(cy, cm - 1, cd);
            curCheck.setHours(0, 0, 0, 0);

            const diaNum = curCheck.getDate();
            const targetSheets = resolveSheetsForDate(curCheck);

            for (const baseSheet of targetSheets) {
                const isBridgeTail = baseSheet.role === 'bridge_tail';
                const resolvedMeta = await resolveDynamicSheetMeta(baseSheet.id, baseSheet.tabName, curCheck, accessToken);

                let colIdx = null;
                if (isBridgeTail) {
                    colIdx = await resolveBridgeDateColChofer(baseSheet.id, resolvedMeta.tabName, curCheck, accessToken);
                    if (colIdx === null) continue;
                } else {
                    const tabYM = parseMonthYearFromText(resolvedMeta.tabName);
                    if (tabYM && (tabYM.year !== curCheck.getFullYear() || tabYM.month !== (curCheck.getMonth() + 1))) {
                        continue;
                    }
                    colIdx = getColChofer(diaNum);
                }

                const colLetter = indexToColLetter(colIdx);
                columnCache.delete(`${baseSheet.id}_${resolvedMeta.tabName}_${colLetter}`);

                const key = `${baseSheet.id}:::${resolvedMeta.tabName}`;
                if (!neededCols.has(key)) {
                    neededCols.set(key, { sheetId: baseSheet.id, tabName: resolvedMeta.tabName, cols: new Set() });
                }
                neededCols.get(key).cols.add(colLetter);

                scanDays.push({
                    dateStr: isBridgeTail ? `${cleanDateStr}#bridge` : cleanDateStr,
                    sheetId: baseSheet.id,
                    tabName: resolvedMeta.tabName,
                    sheetIdNum: resolvedMeta.sheetIdNum,
                    colIdx,
                    colLetter
                });
            }
        }

        const readErrors = [];
        for (const [, group] of neededCols.entries()) {
            const pfRes = await prefetchColumnsBatch(group.sheetId, group.tabName, Array.from(group.cols), accessToken);
            if (!pfRes.ok) {
                readErrors.push(pfRes.error || `Error leyendo columnas ${pfRes.failedCols.join(', ')}`);
            }
        }

        const clearRequestsBySheet = new Map();
        for (const dInfo of scanDays) {
            const { mapUteToRow, mapTractorToRow, ok: unitsOk } = await getUnitsRowMap(dInfo.sheetId, dInfo.tabName, accessToken);

            let rowUnit = null;
            const cleanUteCtx = contexto.n_ute ? String(contexto.n_ute).trim().toUpperCase().replace(/\s+/g, '') : '';
            const cleanTracCtx = contexto.tractor ? String(contexto.tractor).trim().toUpperCase().replace(/[\s\-_.]/g, '') : '';

            if (!unitsOk && (cleanUteCtx || cleanTracCtx)) {
                readErrors.push(`No se pudo obtener mapeo de unidades en [${dInfo.tabName}]`);
            }

            if (cleanUteCtx) {
                rowUnit = mapUteToRow.get(cleanUteCtx) || mapUteToRow.get(cleanUteCtx.replace(/^0+/, '')) || null;
            }
            if (!rowUnit && cleanTracCtx) {
                rowUnit = mapTractorToRow.get(cleanTracCtx) || null;
            }

            const colVals = columnCache.get(`${dInfo.sheetId}_${dInfo.tabName}_${dInfo.colLetter}`) || [];
            const rowsToClear = new Set();

            // 1. Limpiar fila de la unidad si la novedad pertenecía a una unidad
            if (rowUnit !== null) {
                rowsToClear.add(rowUnit);
            }

            // 2. Limpiar fila donde se encuentre actualmente tipeado el chofer
            const rowFound1Based = normChofer ? findDriverRowInColValues(colVals, normChofer) : null;
            if (rowFound1Based !== null) {
                rowsToClear.add(rowFound1Based);
            }

            // 3. Limpiar fila registrada previamente en RAM o en public.novedades.sync_sheets_celdas
            const prevRamDay = prevTrackEntryRam?.dias?.get(dInfo.dateStr);
            if (prevRamDay?.row1Based) {
                rowsToClear.add(prevRamDay.row1Based);
            }
            const prevDbDay = persistedDaysMap.get(dInfo.dateStr);
            if (prevDbDay?.row1Based) {
                rowsToClear.add(prevDbDay.row1Based);
            }

            for (const rClear of rowsToClear) {
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
                            startRowIndex: rClear - 1,
                            endRowIndex: rClear,
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
        let hadError = readErrors.length > 0;
        let lastErrMsg = readErrors.length > 0 ? readErrors.join(' | ') : null;

        for (const [sheetId, group] of clearRequestsBySheet.entries()) {
            if (group.requests.length === 0) continue;

            const dedupMap = new Map();
            for (const req of group.requests) {
                const u = req.updateCells;
                if (u && u.range) {
                    const cellKey = `${u.range.sheetId}_${u.range.startRowIndex}_${u.range.startColumnIndex}`;
                    dedupMap.set(cellKey, req);
                } else {
                    dedupMap.set(Math.random().toString(), req);
                }
            }
            const finalRequests = Array.from(dedupMap.values());
            if (finalRequests.length === 0) continue;

            const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`;
            try {
                const updateRes = await fetchWithRetry(updateUrl, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ requests: finalRequests })
                }, 180000, 2);
                if (updateRes && updateRes.ok) {
                    console.log(`✅ [Hover Sync] ${finalRequests.length} nota(s) removidas en [${group.tabName}].`);
                    totalCleared += finalRequests.length;
                } else if (updateRes) {
                    hadError = true;
                    lastErrMsg = `HTTP ${updateRes.status}: ${(await updateRes.text()).slice(0, 200)}`;
                }
            } catch (e) {
                hadError = true;
                lastErrMsg = e.message;
                console.warn(`⚠️ [Hover Sync] Error limpiando notas en ${sheetId}:`, e.message);
            }
        }

        if (contexto.id != null && !contexto.desde_fecha) {
            if (hadError) {
                await persistirEstadoSyncNovedad(contexto.id, {
                    incrementarReintento: true,
                    error: lastErrMsg || 'Error limpiando notas hover'
                });
            } else {
                await persistirEstadoSyncNovedad(contexto.id, {
                    estado: 'LIMPIADO',
                    celdas: {},
                    hash: null,
                    resetReintentos: true,
                    error: null,
                    marcarSincronizado: true
                });
            }
        }

        // Protección Multi-Novedad: si el chofer tiene otra novedad activa con imprime_nota_movimientos = true,
        // re-componer inmediatamente sus notas respetando la jerarquía (BAJA_DIAGRAMA primero)
        if (!opts.skipResyncOthers && contexto.chofer_id) {
            const otrasActivas = await fetchActiveNovedadesConNota(supabaseClient, contexto.chofer_id);
            if (otrasActivas.length > 0) {
                for (const otra of otrasActivas) {
                    limpiarTrackingNovedad(otra.id);
                }
                await syncBajasGoogleSheets(
                    { chofer_id: contexto.chofer_id, chofer_nombre: choferNom },
                    { supabaseClient, forceRefresh: true }
                );
            }
        }

        return { success: !hadError, count: totalCleared };
    } catch (e) {
        console.warn('⚠️ [Hover Sync] Error en ejecutarLimpiezaNotas:', e.message);
        if (contexto?.id != null && !contexto.desde_fecha && !dryRun) {
            await persistirEstadoSyncNovedad(contexto.id, {
                incrementarReintento: true,
                error: e.message
            });
        }
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
    obtenerEstadoSyncNovedades,
    reanudarSyncPausados,
    persistirEstadoSyncNovedad,
    resolveSheetForDate,
    normalizeText,
    indexToColLetter,
    getColChofer,
    formatBajaNote,
    formatNovedadNote,
    composeCellHoverNotes,
    getTipoPrioridad,
    getTipoEmoji,
    findDriverRowInColValues,
    isDriverMatch,
    getUnitsRowMap,
    SPREADSHEETS
};
