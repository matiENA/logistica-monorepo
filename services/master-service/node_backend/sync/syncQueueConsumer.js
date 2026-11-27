/**
 * ==============================================================================
 * 🚀 EOR SYNC QUEUE CONSUMER — Supabase Queue -> Google Sheets Batch Writer
 * ==============================================================================
 * Consume mutaciones pendientes desde `public.eor_sync_queue`, agrupa actualizaciones
 * en lotes por hoja/pestaña para respetar el límite de Google Sheets (60 req/min),
 * actualiza el estado a COMPLETADO / ERROR y recopila telemetría de egress.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config();
const { Pool } = require('pg');
const { 
    getAuthClient, 
    normalizar, 
    getFechaArgentina,
    mesesLargo,
    mesesAbrev,
    resolveTabNameMovimientos 
} = require('../utils/sheets');

const {
    ID_SPREADSHEET_MASTER,
    ID_SPREADSHEET_DIAGRAMAS,
    ID_SHEET_OBSERVACIONES,
    ID_SHEET_HABILITACIONES,
    ID_SHEET_DOCUMENTOS,
    ID_SHEET_MOVIMIENTOS,
    getTargetMovimientosSheetsForDate,
    parseHeaderDateToYMD
} = require('../utils/shared');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { pool: dbPool } = require('../utils/db');

const cleanDbUrl = process.env.DATABASE_URL
    ? process.env.DATABASE_URL.replace(/([?&])sslmode=[^&]+(&|$)/, '$1').replace(/[?&]$/, '')
    : process.env.DATABASE_URL;

const pool = dbPool || new Pool({
    connectionString: cleanDbUrl,
    ssl: { rejectUnauthorized: false }
});

// ==============================================================================
// 🛠️ HELPERS
// ==============================================================================

function cleanDni(val) {
    if (!val) return '';
    const num = String(val).replace(/\D/g, '');
    return num ? String(parseInt(num, 10)) : '';
}

function cleanCuil(val) {
    if (!val) return '';
    return String(val).replace(/\D/g, '');
}

function cleanPatente(val) {
    if (!val) return '';
    return String(val).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function cleanUte(val) {
    if (!val) return '';
    return String(val).replace(/\D/g, '');
}

function formatToSheetDate(val) {
    if (!val) return '';
    const str = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
        const [y, m, d] = str.split('T')[0].split('-');
        return `${parseInt(d, 10)}/${parseInt(m, 10)}/${y}`;
    }
    return str;
}

function colToLetter(colIndex) {
    let temp, letter = '';
    let col = colIndex + 1;
    while (col > 0) {
        temp = (col - 1) % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        col = Math.floor((col - temp) - 1) / 26;
    }
    return letter;
}

/**
 * Determina la cantidad exacta de días del mes a partir de un nombre de pestaña (ej. 'Nov-26' -> 30, 'Dic-26' -> 31).
 */
function getDaysInMonthForTab(tab) {
    const parts = String(tab || '').trim().split('-');
    if (parts.length !== 2) return 31;
    const mIdx = mesesAbrev.findIndex(m => m.toLowerCase() === parts[0].trim().toLowerCase());
    const yyDigits = parts[1].replace(/\D/g, '');
    if (mIdx === -1 || !yyDigits) return 31;
    const anio = yyDigits.length <= 2 ? parseInt('20' + yyDigits.padStart(2, '0'), 10) : parseInt(yyDigits, 10);
    return new Date(anio, mIdx + 1, 0).getDate();
}

/**
 * Extrae { year, month } (month 1..12) desde un nombre de pestaña de Movimientos (ej. 'NOVIEMBRE 2026- Mov...').
 */
function parseMonthYearFromTab(tabName) {
    const text = normalizar(tabName);
    if (!text) return null;
    const mIdx = mesesLargo.findIndex(m => text.includes(normalizar(m)));
    const yMatch = text.match(/\b(20\d{2})\b/);
    if (mIdx === -1 || !yMatch) return null;
    return { year: parseInt(yMatch[1], 10), month: mIdx + 1 };
}

/**
 * Formatea la tira de días para su escritura en Google Sheets.
 * Por defecto convierte los guiones ('-') y valores inactivos en celdas vacías ('')
 * para mantener la planilla limpia, preservando la capacidad de emitir guiones
 * si la operación incluye allowHyphens / imprimir_guiones = true (para botón futuro).
 */
function formatDiasParaSheets(tiraRaw, { allowHyphens = false, daysInMonth = 31 } = {}) {
    const targetDays = Math.max(28, Math.min(31, parseInt(daysInMonth, 10) || 31));
    if (!tiraRaw) return new Array(targetDays).fill('');
    let arrDias = tiraRaw.includes(',') ? tiraRaw.split(',') : tiraRaw.split('');
    arrDias = arrDias.map(d => {
        const val = String(d || '').trim().toUpperCase();
        if (!allowHyphens && (val === '-' || val === 'NULL' || val === 'UNDEFINED')) {
            return '';
        }
        return val;
    });
    while (arrDias.length < targetDays) {
        arrDias.push(allowHyphens ? '-' : '');
    }
    return arrDias.slice(0, targetDays);
}

// ==============================================================================
// 📡 GOOGLE SHEETS API CALLERS
// ==============================================================================

async function fetchRangeValues(spreadsheetId, range) {
    const auth = getAuthClient();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
    const res = await auth.request({ url });
    return res.data.values || [];
}

async function executeBatchUpdate(spreadsheetId, valueRanges) {
    if (!valueRanges || valueRanges.length === 0) return { updatedCells: 0 };
    const auth = getAuthClient();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`;
    const res = await auth.request({
        url,
        method: 'POST',
        data: {
            valueInputOption: 'USER_ENTERED',
            data: valueRanges
        }
    });
    return res.data;
}

async function appendRangeValues(spreadsheetId, range, rows) {
    if (!rows || rows.length === 0) return { updates: { updatedRows: 0 } };
    const auth = getAuthClient();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
    const res = await auth.request({
        url,
        method: 'POST',
        data: { values: rows }
    });
    return res.data;
}

// ==============================================================================
// 🧠 IN-MEMORY ROW INDEX CACHE (Evita lecturas repetidas a Sheets en cada lote)
// ==============================================================================
const rowIndexCache = {
    periodicos: { data: null, expiresAt: 0 },
    vencimientos: { data: null, expiresAt: 0 },
    diagramas: {}, // tab -> { data, expiresAt }
    movimientos: { data: null, expiresAt: 0 }
};
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutos en RAM

// ==============================================================================
// 🎯 MAIN CONSUMER FUNCTION
// ==============================================================================

async function processSyncQueue({ batchLimit = 50, dryRun = false } = {}) {
    const tStart = Date.now();
    const stats = {
        totalPending: 0,
        processed: 0,
        completed: 0,
        failed: 0,
        googleApiRequests: 0,
        individualMutations: 0,
        batchRequestsSent: 0,
        egressBytes: 0,
        executionTimeMs: 0,
        wipedRows: 0,
        details: []
    };

    const client = await pool.connect();

    try {
        // 1. Obtener registros pendientes o bloqueos huérfanos (stale EN_PROCESO > 5m) en orden FIFO
        const { rows: pendingItems } = await client.query(`
            SELECT q.id, q.entidad, q.destino_sheet, q.tipo_operacion, q.chofer_id, q.chofer_nombre,
                   q.dni_cuil, q.unidad_tractor, q.datos_nuevos, q.datos_previos, q.usuario, q.creado_el,
                   c.legajo AS chofer_legajo
            FROM public.eor_sync_queue q
            LEFT JOIN public.choferes c ON c.id = q.chofer_id
            WHERE q.estado_sync = 'PENDIENTE'
               OR (q.estado_sync = 'EN_PROCESO' AND q.creado_el < NOW() - INTERVAL '5 minutes' AND COALESCE(q.reintentos, 0) < 5)
            ORDER BY q.creado_el ASC
            LIMIT $1
        `, [batchLimit]);

        stats.totalPending = pendingItems.length;
        if (pendingItems.length === 0) {
            stats.executionTimeMs = Date.now() - tStart;
            return stats;
        }

        const itemIds = pendingItems.map(i => i.id);

        // 2. Marcar como EN_PROCESO en Supabase
        if (!dryRun) {
            await client.query(`
                UPDATE public.eor_sync_queue
                SET estado_sync = 'EN_PROCESO'
                WHERE id = ANY($1)
            `, [itemIds]);
        }

        // Estimar egress de Supabase
        const egressDb = Buffer.byteLength(JSON.stringify(pendingItems));
        stats.egressBytes += egressDb;

        // 3. Agrupar por Entidad y Spreadsheet destino
        const groups = {
            docPeriodicos: [],
            docVencimientos: [],
            diagramas: {},      // tab -> items
            movimientos: [],
            observaciones: []
        };

        for (const item of pendingItems) {
            stats.individualMutations++;
            const ent = (item.entidad || '').toUpperCase();
            const dest = (item.destino_sheet || '').toUpperCase();

            if (ent === 'DOCUMENTACION') {
                if (dest === 'PERIODICOS') {
                    groups.docPeriodicos.push(item);
                } else {
                    groups.docVencimientos.push(item);
                }
            } else if (ent === 'DIAGRAMA') {
                const hoyAr = getFechaArgentina();
                const defaultTab = `${mesesAbrev[hoyAr.getMonth()]}-${String(hoyAr.getFullYear()).slice(-2)}`;
                const tab = item.destino_sheet || defaultTab;
                if (!groups.diagramas[tab]) groups.diagramas[tab] = [];
                groups.diagramas[tab].push(item);
            } else if (ent === 'ASIGNACION') {
                groups.movimientos.push(item);
            } else if (ent === 'OBSERVACION') {
                groups.observaciones.push(item);
            } else {
                console.warn(`⚠️ Entidad desconocida en cola: ${ent} (ID: ${item.id})`);
            }
        }

        // ======================================================================
        // A. PROCESAR DOCUMENTACION -> PERIODICOS (ID_SHEET_DOCUMENTOS)
        // ======================================================================
        if (groups.docPeriodicos.length > 0) {
            try {
                let mapCuilToRow, mapNameToRow;
                if (rowIndexCache.periodicos.data && rowIndexCache.periodicos.expiresAt > Date.now()) {
                    mapCuilToRow = rowIndexCache.periodicos.data.mapCuilToRow;
                    mapNameToRow = rowIndexCache.periodicos.data.mapNameToRow;
                } else {
                    stats.googleApiRequests++;
                    const rowsPer = await fetchRangeValues(ID_SHEET_DOCUMENTOS, "'PERIODICOS'!B5:E");
                    mapCuilToRow = new Map();
                    mapNameToRow = new Map();

                    rowsPer.forEach((r, idx) => {
                        const rowNum = 5 + idx;
                        const nom = normalizar(r[0]);
                        const cuil = cleanCuil(r[3]);
                        if (cuil) mapCuilToRow.set(cuil, rowNum);
                        if (nom) mapNameToRow.set(nom, rowNum);
                    });

                    rowIndexCache.periodicos = {
                        data: { mapCuilToRow, mapNameToRow },
                        expiresAt: Date.now() + CACHE_TTL_MS
                    };
                }

                const batchData = [];
                const successIds = [];
                const failedUnmatched = [];

                for (const item of groups.docPeriodicos) {
                    const cuilNorm = cleanCuil(item.dni_cuil);
                    const nomNorm = normalizar(item.chofer_nombre);
                    const rowNum = (cuilNorm && mapCuilToRow.get(cuilNorm)) || (nomNorm && mapNameToRow.get(nomNorm));

                    if (rowNum) {
                        const colLetra = item.datos_nuevos?.columna || 'I';
                        const valFecha = formatToSheetDate(item.datos_nuevos?.valor);
                        batchData.push({
                            range: `'PERIODICOS'!${colLetra}${rowNum}`,
                            values: [[valFecha]]
                        });
                        successIds.push(item.id);
                    } else {
                        console.warn(`   ⚠️ Chofer no hallado en PERIODICOS: CUIL=${cuilNorm || '-'}, Nombre=${nomNorm || '-'}`);
                        failedUnmatched.push(item);
                    }
                }

                if (failedUnmatched.length > 0 && !dryRun) {
                    stats.failed += failedUnmatched.length;
                    for (const fItem of failedUnmatched) {
                        const desc = `Chofer no hallado en PERIODICOS: ${fItem.chofer_nombre} (CUIL: ${fItem.dni_cuil || '-'})`;
                        await client.query(`
                            UPDATE public.eor_sync_queue 
                            SET estado_sync = 'ERROR', error_detalle = $1, reintentos = COALESCE(reintentos, 0) + 1 
                            WHERE id = $2
                        `, [desc, fItem.id]);
                    }
                }

                if (batchData.length > 0) {
                    stats.googleApiRequests++;
                    stats.batchRequestsSent++;
                    stats.egressBytes += Buffer.byteLength(JSON.stringify(batchData));
                    if (!dryRun) {
                        await executeBatchUpdate(ID_SHEET_DOCUMENTOS, batchData);
                        await client.query(`
                            UPDATE public.eor_sync_queue 
                            SET estado_sync = 'COMPLETADO', sincronizado_el = NOW() 
                            WHERE id = ANY($1)
                        `, [successIds]);
                    }
                    stats.completed += successIds.length;
                    stats.details.push(`PERIODICOS: ${successIds.length} actualizados en 1 batchUpdate.`);
                }
            } catch (errPer) {
                console.error('❌ Error sincronizando PERIODICOS:', errPer.message);
                const failedIds = groups.docPeriodicos.map(i => i.id);
                stats.failed += failedIds.length;
                if (!dryRun) {
                    await client.query(`
                        UPDATE public.eor_sync_queue 
                        SET estado_sync = 'ERROR', error_detalle = $1, reintentos = COALESCE(reintentos, 0) + 1 
                        WHERE id = ANY($2)
                    `, [errPer.message, failedIds]);
                }
            }
        }

        // ======================================================================
        // B. PROCESAR DOCUMENTACION -> VENCIMIENTOS (ID_SHEET_HABILITACIONES)
        // ======================================================================
        if (groups.docVencimientos.length > 0) {
            try {
                let mapDniToRow, mapNameToRow;
                if (rowIndexCache.vencimientos.data && rowIndexCache.vencimientos.expiresAt > Date.now()) {
                    mapDniToRow = rowIndexCache.vencimientos.data.mapDniToRow;
                    mapNameToRow = rowIndexCache.vencimientos.data.mapNameToRow;
                } else {
                    stats.googleApiRequests++;
                    const rowsVenc = await fetchRangeValues(ID_SHEET_HABILITACIONES, "'VENCIMIENTOS'!A3:C");
                    mapDniToRow = new Map();
                    mapNameToRow = new Map();

                    rowsVenc.forEach((r, idx) => {
                        const rowNum = 3 + idx;
                        const nom = normalizar(r[1]);
                        const dni = cleanDni(r[2]);
                        if (dni) mapDniToRow.set(dni, rowNum);
                        if (nom) mapNameToRow.set(nom, rowNum);
                    });

                    rowIndexCache.vencimientos = {
                        data: { mapDniToRow, mapNameToRow },
                        expiresAt: Date.now() + CACHE_TTL_MS
                    };
                }

                const batchData = [];
                const successIds = [];
                const failedUnmatched = [];

                for (const item of groups.docVencimientos) {
                    const dniNorm = cleanDni(item.dni_cuil);
                    const nomNorm = normalizar(item.chofer_nombre);
                    const rowNum = (dniNorm && mapDniToRow.get(dniNorm)) || (nomNorm && mapNameToRow.get(nomNorm));

                    if (rowNum) {
                        const colLetra = item.datos_nuevos?.columna || 'E';
                        const valFecha = formatToSheetDate(item.datos_nuevos?.valor);
                        batchData.push({
                            range: `'VENCIMIENTOS'!${colLetra}${rowNum}`,
                            values: [[valFecha]]
                        });
                        successIds.push(item.id);
                    } else {
                        console.warn(`   ⚠️ Chofer no hallado en VENCIMIENTOS: DNI=${dniNorm || '-'}, Nombre=${nomNorm || '-'}`);
                        failedUnmatched.push(item);
                    }
                }

                if (failedUnmatched.length > 0 && !dryRun) {
                    stats.failed += failedUnmatched.length;
                    for (const fItem of failedUnmatched) {
                        const desc = `Chofer no hallado en VENCIMIENTOS: ${fItem.chofer_nombre} (DNI: ${fItem.dni_cuil || '-'})`;
                        await client.query(`
                            UPDATE public.eor_sync_queue 
                            SET estado_sync = 'ERROR', error_detalle = $1, reintentos = COALESCE(reintentos, 0) + 1 
                            WHERE id = $2
                        `, [desc, fItem.id]);
                    }
                }

                if (batchData.length > 0) {
                    stats.googleApiRequests++;
                    stats.batchRequestsSent++;
                    stats.egressBytes += Buffer.byteLength(JSON.stringify(batchData));
                    if (!dryRun) {
                        await executeBatchUpdate(ID_SHEET_HABILITACIONES, batchData);
                        await client.query(`
                            UPDATE public.eor_sync_queue 
                            SET estado_sync = 'COMPLETADO', sincronizado_el = NOW() 
                            WHERE id = ANY($1)
                        `, [successIds]);
                    }
                    stats.completed += successIds.length;
                    stats.details.push(`VENCIMIENTOS: ${successIds.length} actualizados en 1 batchUpdate.`);
                }
            } catch (errVenc) {
                console.error('❌ Error sincronizando VENCIMIENTOS:', errVenc.message);
                const failedIds = groups.docVencimientos.map(i => i.id);
                stats.failed += failedIds.length;
                if (!dryRun) {
                    await client.query(`
                        UPDATE public.eor_sync_queue 
                        SET estado_sync = 'ERROR', error_detalle = $1, reintentos = COALESCE(reintentos, 0) + 1 
                        WHERE id = ANY($2)
                    `, [errVenc.message, failedIds]);
                }
            }
        }

        // ======================================================================
        // C. PROCESAR DIAGRAMAS (ID_SPREADSHEET_DIAGRAMAS)
        // ======================================================================
        const diagTabs = Object.keys(groups.diagramas);
        for (const tab of diagTabs) {
            const items = groups.diagramas[tab];
            try {
                let mapNameToRow, mapLegajoToRow;
                if (rowIndexCache.diagramas[tab]?.data && rowIndexCache.diagramas[tab]?.expiresAt > Date.now()) {
                    mapNameToRow = rowIndexCache.diagramas[tab].data.mapNameToRow;
                    mapLegajoToRow = rowIndexCache.diagramas[tab].data.mapLegajoToRow;
                } else {
                    stats.googleApiRequests++;
                    const rowsDiag = await fetchRangeValues(ID_SPREADSHEET_DIAGRAMAS, `'${tab}'!A6:B350`);
                    mapNameToRow = new Map();
                    mapLegajoToRow = new Map();

                    rowsDiag.forEach((r, idx) => {
                        const rowNum = 6 + idx;
                        const legajo = String(r[0] || '').trim();
                        const nom = normalizar(r[1]);
                        if (nom) mapNameToRow.set(nom, rowNum);
                        if (legajo) mapLegajoToRow.set(legajo, rowNum);
                    });

                    rowIndexCache.diagramas[tab] = {
                        data: { mapNameToRow, mapLegajoToRow },
                        expiresAt: Date.now() + CACHE_TTL_MS
                    };
                }

                const batchData = [];
                const successIds = [];
                const failedUnmatched = [];
                const daysInMonth = getDaysInMonthForTab(tab);
                const endColLetter = colToLetter(4 + daysInMonth - 1);

                for (const item of items) {
                    const nomNorm = normalizar(item.chofer_nombre);
                    const legajoNorm = String(item.chofer_legajo || item.datos_nuevos?.legajo || '').trim();
                    let rowNum = (nomNorm && mapNameToRow.get(nomNorm))
                              || (legajoNorm && legajoNorm !== 'null' && mapLegajoToRow.get(legajoNorm))
                              || null;

                    // Fallback por prefijo único (ej. nombres truncados a 30 caracteres en DB vs Sheets)
                    if (!rowNum && nomNorm && nomNorm.length >= 15) {
                        const prefixMatches = [];
                        for (const [sheetName, rNum] of mapNameToRow.entries()) {
                            if (sheetName.startsWith(nomNorm) || nomNorm.startsWith(sheetName)) {
                                prefixMatches.push(rNum);
                            }
                        }
                        if (prefixMatches.length === 1) {
                            rowNum = prefixMatches[0];
                        }
                    }

                    if (rowNum) {
                        const tiraRaw = item.datos_nuevos?.tira_dias || '';
                        const allowHyphens = Boolean(
                            item.datos_nuevos?.imprimir_guiones ||
                            item.datos_nuevos?.con_guiones ||
                            item.datos_nuevos?.allowHyphens
                        );
                        const arrDias = formatDiasParaSheets(tiraRaw, { allowHyphens, daysInMonth });

                        // Si viene rango específico (ej. días 1..14)
                        if (item.datos_nuevos?.dia_inicio && item.datos_nuevos?.dia_fin) {
                            const dIni = Math.max(1, parseInt(item.datos_nuevos.dia_inicio, 10));
                            const dFin = Math.min(daysInMonth, parseInt(item.datos_nuevos.dia_fin, 10));
                            const colIni = colToLetter(4 + dIni - 1);
                            const colFin = colToLetter(4 + dFin - 1);
                            const sliceDias = arrDias.slice(dIni - 1, dFin);

                            batchData.push({
                                range: `'${tab}'!${colIni}${rowNum}:${colFin}${rowNum}`,
                                values: [sliceDias]
                            });
                        } else {
                            // Mes completo ajustado a días reales del mes (ej. E..AH en meses de 30 días, E..AI en 31)
                            batchData.push({
                                range: `'${tab}'!E${rowNum}:${endColLetter}${rowNum}`,
                                values: [arrDias]
                            });
                        }
                        successIds.push(item.id);
                    } else {
                        console.warn(`   ⚠️ Chofer no hallado en Diagrama [${tab}]: ${item.chofer_nombre} (Legajo: ${legajoNorm || '-'})`);
                        failedUnmatched.push(item);
                    }
                }

                if (failedUnmatched.length > 0 && !dryRun) {
                    stats.failed += failedUnmatched.length;
                    for (const fItem of failedUnmatched) {
                        const desc = `Chofer no hallado en Diagrama [${tab}]: ${fItem.chofer_nombre}`;
                        await client.query(`
                            UPDATE public.eor_sync_queue 
                            SET estado_sync = 'ERROR', error_detalle = $1, reintentos = COALESCE(reintentos, 0) + 1 
                            WHERE id = $2
                        `, [desc, fItem.id]);
                    }
                }

                if (batchData.length > 0) {
                    stats.googleApiRequests++;
                    stats.batchRequestsSent++;
                    stats.egressBytes += Buffer.byteLength(JSON.stringify(batchData));
                    if (!dryRun) {
                        await executeBatchUpdate(ID_SPREADSHEET_DIAGRAMAS, batchData);
                        await client.query(`
                            UPDATE public.eor_sync_queue 
                            SET estado_sync = 'COMPLETADO', sincronizado_el = NOW() 
                            WHERE id = ANY($1)
                        `, [successIds]);
                    }
                    stats.completed += successIds.length;
                    stats.details.push(`DIAGRAMAS [${tab}]: ${successIds.length} turnos actualizados en 1 batchUpdate.`);
                }
            } catch (errDiag) {
                console.error(`❌ Error sincronizando DIAGRAMA [${tab}]:`, errDiag.message);
                const failedIds = items.map(i => i.id);
                stats.failed += failedIds.length;
                if (!dryRun) {
                    await client.query(`
                        UPDATE public.eor_sync_queue 
                        SET estado_sync = 'ERROR', error_detalle = $1, reintentos = COALESCE(reintentos, 0) + 1 
                        WHERE id = ANY($2)
                    `, [errDiag.message, failedIds]);
                }
            }
        }

        // ======================================================================
        // D. PROCESAR ASIGNACIONES DE UNIDADES (MERGE VIRTUAL MOVIMIENTOS)
        //    - Auto-cutover por fecha (sin reinicio ni ejecución manual)
        //    - Días 1 y 2 de Diciembre se imprimen en AMBAS planillas (Dic + cola Nov)
        // ======================================================================
        if (groups.movimientos.length > 0) {
            try {
                if (!rowIndexCache.movimientosBySheet) rowIndexCache.movimientosBySheet = {};
                if (!rowIndexCache.movHeadersBySheet) rowIndexCache.movHeadersBySheet = {};

                async function getMovSheetIndex(sheetId, fallbackTab) {
                    const cached = rowIndexCache.movimientosBySheet[sheetId];
                    if (cached && cached.expiresAt > Date.now()) {
                        return cached.data;
                    }
                    const tabMov = await resolveTabNameMovimientos(sheetId, fallbackTab);
                    stats.googleApiRequests++;
                    const rowsUnits = await fetchRangeValues(sheetId, `'${tabMov}'!A1:F350`);
                    const mapTractorToRow = new Map();
                    const mapUteToRow = new Map();
                    rowsUnits.forEach((r, idx) => {
                        const rowNum = 1 + idx;
                        const ute = cleanUte(r[2]);
                        const tractor = cleanPatente(r[4]);
                        const semi = cleanPatente(r[5]);
                        if (tractor) mapTractorToRow.set(tractor, rowNum);
                        if (semi) mapTractorToRow.set(semi, rowNum);
                        if (ute) mapUteToRow.set(ute, rowNum);
                    });
                    const data = { tabMov, mapTractorToRow, mapUteToRow };
                    rowIndexCache.movimientosBySheet[sheetId] = { data, expiresAt: Date.now() + CACHE_TTL_MS };
                    return data;
                }

                async function getMovDateColChofer(sheetId, tabMov, year, month, day, isBridgeTail) {
                    if (!isBridgeTail) {
                        return 27 + 13 * (day - 1);
                    }
                    const hKey = `${sheetId}:::${tabMov}`;
                    let headerMap = rowIndexCache.movHeadersBySheet[hKey];
                    if (!headerMap || headerMap.expiresAt <= Date.now()) {
                        stats.googleApiRequests++;
                        const rowsH = await fetchRangeValues(sheetId, `'${tabMov}'!A1:RT1`);
                        const r0 = rowsH[0] || [];
                        const map = new Map();
                        r0.forEach((cell, idx) => {
                            const ymd = parseHeaderDateToYMD(cell);
                            if (ymd) {
                                const k = `${ymd.year}-${ymd.month}-${ymd.day}`;
                                if (!map.has(k)) map.set(k, Math.max(0, idx - 3));
                            }
                        });
                        headerMap = { map, expiresAt: Date.now() + CACHE_TTL_MS };
                        rowIndexCache.movHeadersBySheet[hKey] = headerMap;
                    }
                    const colIdx = headerMap.map.get(`${year}-${month}-${day}`);
                    return colIdx !== undefined ? colIdx : null;
                }

                const cellMapsBySheet = new Map();
                const successIds = [];
                const failedUnmatched = [];

                for (const item of groups.movimientos) {
                    const hoyAr = getFechaArgentina();
                    let diaNum = hoyAr.getDate();
                    let targetYM = { year: hoyAr.getFullYear(), month: hoyAr.getMonth() + 1 };
                    if (item.datos_nuevos?.fecha) {
                        const dateStr = String(item.datos_nuevos.fecha).split('T')[0];
                        const parts = dateStr.split('-');
                        if (parts.length === 3) {
                            targetYM = { year: parseInt(parts[0], 10), month: parseInt(parts[1], 10) };
                            diaNum = parseInt(parts[2], 10);
                        } else {
                            const dObj = new Date(item.datos_nuevos.fecha);
                            if (!isNaN(dObj.getTime())) {
                                targetYM = { year: dObj.getUTCFullYear(), month: dObj.getUTCMonth() + 1 };
                                diaNum = dObj.getUTCDate();
                            }
                        }
                    }

                    const targetDate = new Date(targetYM.year, targetYM.month - 1, diaNum);
                    const targetSheets = getTargetMovimientosSheetsForDate(targetDate);

                    let prevU = null;
                    let matchedAny = false;
                    let primaryTabLabel = targetSheets[0]?.tabName || 'Movimientos';

                    for (const tSheet of targetSheets) {
                        const { tabMov, mapTractorToRow, mapUteToRow } = await getMovSheetIndex(tSheet.id, tSheet.tabName);
                        if (tSheet.role === 'primary') primaryTabLabel = tabMov;

                        const isBridgeTail = tSheet.role === 'bridge_tail';
                        const colChoferIdx = await getMovDateColChofer(tSheet.id, tabMov, targetYM.year, targetYM.month, diaNum, isBridgeTail);
                        if (colChoferIdx === null) {
                            continue;
                        }

                        const tractorNorm = cleanPatente(item.unidad_tractor || item.datos_nuevos?.tractor);
                        const semiNorm = cleanPatente(item.datos_nuevos?.semi);
                        const nUteNorm = cleanUte(item.datos_nuevos?.n_ute);
                        let rowNum = (tractorNorm && mapTractorToRow.get(tractorNorm))
                                  || (semiNorm && mapTractorToRow.get(semiNorm))
                                  || (nUteNorm && mapUteToRow.get(nUteNorm));

                        if (!rowNum && (item.datos_nuevos?.esDesasignar || item.datos_previos?.unidad_anterior)) {
                            const prevId = item.datos_previos?.unidad_anterior || item.datos_nuevos?.unidad_id;
                            if (prevId) {
                                if (!prevU) {
                                    try {
                                        const uRes = await client.query(`
                                            SELECT u.n_ute, t.patente as tractor, s.patente as semi
                                            FROM public.unidades u
                                            LEFT JOIN public.tractores t ON t.id = u.tractor_id
                                            LEFT JOIN public.semis s ON s.id = u.semi_id
                                            WHERE u.id = $1
                                        `, [prevId]);
                                        if (uRes.rows.length > 0) prevU = uRes.rows[0];
                                    } catch (eDb) {
                                        console.warn('   ⚠️ Error consultando unidad previa en DB:', eDb.message);
                                    }
                                }
                                if (prevU) {
                                    const prevTrac = cleanPatente(prevU.tractor);
                                    const prevSemi = cleanPatente(prevU.semi);
                                    const prevUte = cleanUte(prevU.n_ute);
                                    rowNum = (prevTrac && mapTractorToRow.get(prevTrac))
                                          || (prevSemi && mapTractorToRow.get(prevSemi))
                                          || (prevUte && mapUteToRow.get(prevUte));
                                }
                            }
                        }

                        if (rowNum) {
                            const colLetter = colToLetter(colChoferIdx);
                            const valChofer = item.datos_nuevos?.esDesasignar ? (item.datos_nuevos?.caracter || '1') : (item.chofer_nombre || '');
                            const cellRange = `'${tabMov}'!${colLetter}${rowNum}`;
                            if (!cellMapsBySheet.has(tSheet.id)) cellMapsBySheet.set(tSheet.id, new Map());
                            cellMapsBySheet.get(tSheet.id).set(cellRange, valChofer);
                            matchedAny = true;
                        }
                    }

                    if (matchedAny) {
                        successIds.push(item.id);
                    } else {
                        const tractorNorm = cleanPatente(item.unidad_tractor || item.datos_nuevos?.tractor);
                        const semiNorm = cleanPatente(item.datos_nuevos?.semi);
                        const nUteNorm = cleanUte(item.datos_nuevos?.n_ute);
                        console.warn(`   ⚠️ Unidad no hallada en Movimientos (${primaryTabLabel}): Tractor=${tractorNorm || '-'}, Semi=${semiNorm || '-'}, UTE=${nUteNorm || '-'}`);
                        failedUnmatched.push({ item, tabMov: primaryTabLabel });
                        rowIndexCache.movimientosBySheet = {};
                    }
                }

                if (failedUnmatched.length > 0 && !dryRun) {
                    stats.failed += failedUnmatched.length;
                    for (const { item: fItem, tabMov: fTab } of failedUnmatched) {
                        const desc = `Unidad no hallada en Movimientos [${fTab}] (Tractor: ${fItem.unidad_tractor || fItem.datos_nuevos?.tractor || 'N/A'}, Semi: ${fItem.datos_nuevos?.semi || 'N/A'}, UTE: ${fItem.datos_nuevos?.n_ute || 'N/A'})`;
                        await client.query(`
                            UPDATE public.eor_sync_queue 
                            SET estado_sync = 'ERROR', error_detalle = $1, reintentos = COALESCE(reintentos, 0) + 1 
                            WHERE id = $2
                        `, [desc, fItem.id]);
                    }
                }

                let totalBatchItems = 0;
                for (const [sheetId, cellMap] of cellMapsBySheet.entries()) {
                    const batchData = [];
                    for (const [range, val] of cellMap.entries()) {
                        batchData.push({ range, values: [[val]] });
                    }
                    if (batchData.length > 0) {
                        totalBatchItems += batchData.length;
                        stats.googleApiRequests++;
                        stats.batchRequestsSent++;
                        stats.egressBytes += Buffer.byteLength(JSON.stringify(batchData));
                        if (!dryRun) {
                            await executeBatchUpdate(sheetId, batchData);
                        }
                    }
                }

                if (totalBatchItems > 0) {
                    if (!dryRun && successIds.length > 0) {
                        await client.query(`
                            UPDATE public.eor_sync_queue 
                            SET estado_sync = 'COMPLETADO', sincronizado_el = NOW() 
                            WHERE id = ANY($1)
                        `, [successIds]);
                    }
                    stats.completed += successIds.length;
                    stats.details.push(`MOVIMIENTOS (Merge Virtual): ${successIds.length} asignaciones actualizadas en ${cellMapsBySheet.size} planilla(s).`);
                }
            } catch (errMov) {
                console.error('❌ Error sincronizando MOVIMIENTOS:', errMov.message);
                const failedIds = groups.movimientos.map(i => i.id);
                stats.failed += failedIds.length;
                if (!dryRun) {
                    await client.query(`
                        UPDATE public.eor_sync_queue 
                        SET estado_sync = 'ERROR', error_detalle = $1, reintentos = COALESCE(reintentos, 0) + 1 
                        WHERE id = ANY($2)
                    `, [errMov.message, failedIds]);
                }
            }
        }

        // ======================================================================
        // E. PROCESAR OBSERVACIONES (ID_SHEET_OBSERVACIONES)
        // ======================================================================
        if (groups.observaciones.length > 0) {
            try {
                const appendRows = [];
                const successIds = [];

                for (const item of groups.observaciones) {
                    const rowData = [
                        formatToSheetDate(item.datos_nuevos?.fecha || item.creado_el),
                        item.chofer_nombre || '',
                        cleanDni(item.dni_cuil) || '',
                        item.datos_nuevos?.observacion || '',
                        item.usuario || 'SISTEMA'
                    ];
                    appendRows.push(rowData);
                    successIds.push(item.id);
                }

                if (appendRows.length > 0) {
                    stats.googleApiRequests++;
                    stats.egressBytes += Buffer.byteLength(JSON.stringify(appendRows));
                    if (!dryRun) {
                        await appendRangeValues(ID_SHEET_OBSERVACIONES, "'Observaciones'!A:E", appendRows);
                        await client.query(`
                            UPDATE public.eor_sync_queue 
                            SET estado_sync = 'COMPLETADO', sincronizado_el = NOW() 
                            WHERE id = ANY($1)
                        `, [successIds]);
                    }
                    stats.completed += successIds.length;
                    stats.details.push(`OBSERVACIONES: ${successIds.length} registros insertados en Sheets.`);
                }
            } catch (errObs) {
                console.error('❌ Error sincronizando OBSERVACIONES:', errObs.message);
                const failedIds = groups.observaciones.map(i => i.id);
                stats.failed += failedIds.length;
                if (!dryRun) {
                    await client.query(`
                        UPDATE public.eor_sync_queue 
                        SET estado_sync = 'ERROR', error_detalle = $1, reintentos = COALESCE(reintentos, 0) + 1 
                        WHERE id = ANY($2)
                    `, [errObs.message, failedIds]);
                }
            }
        }

        // 4. Wipe Diario si corresponde (limpiar filas completadas > 24hs)
        if (!dryRun) {
            try {
                const { rows: wipeRes } = await client.query('SELECT public.fn_wipe_diario_sync_queue() AS wiped');
                stats.wipedRows = wipeRes[0]?.wiped || 0;
            } catch (wErr) {
                // Si la función no existe, no es un error fatal
                stats.wipedRows = 0;
            }
        }

    } catch (errGlobal) {
        console.error('❌ Error fatal en proceso de sync queue:', errGlobal.message);
        throw errGlobal;
    } finally {
        client.release();
        stats.executionTimeMs = Date.now() - tStart;
    }

    return stats;
}

// Ejecución directa por CLI
if (require.main === module) {
    const isDry = process.argv.includes('--dry-run');
    console.log(`\n========================================================================`);
    console.log(`⚡ PROCESANDO COLA DE SINCRONIZACIÓN (eor_sync_queue -> Google Sheets)`);
    console.log(`   Modo: ${isDry ? 'DRY-RUN (Simulación)' : 'PRODUCCIÓN (Escritura Real)'}`);
    console.log(`========================================================================\n`);

    processSyncQueue({ dryRun: isDry })
        .then(stats => {
            console.log('\n📊 REPORTE DE SINCRONIZACIÓN:');
            console.log(`   • Total pendientes evaluados:   ${stats.totalPending}`);
            console.log(`   • Mutaciones procesadas:       ${stats.individualMutations}`);
            console.log(`   • Exitosos marcados COMPLETADO: ${stats.completed}`);
            console.log(`   • Fallidos con reintento:      ${stats.failed}`);
            console.log(`   • Peticiones Google API hechas: ${stats.googleApiRequests}`);
            console.log(`   • Lotes batchUpdate enviados:   ${stats.batchRequestsSent}`);
            console.log(`   • Datos egress transferidos:    ${stats.egressBytes} bytes`);
            console.log(`   • Filas depuradas (Wipe 24h):  ${stats.wipedRows || 0}`);
            console.log(`   • Tiempo total de ejecución:   ${stats.executionTimeMs} ms\n`);
            if (stats.details?.length > 0) {
                console.log('Detalles:');
                stats.details.forEach(d => console.log(`   - ${d}`));
            }
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ Falla en ejecución:', err);
            process.exit(1);
        });
}

module.exports = {
    processSyncQueue,
    cleanDni,
    cleanCuil,
    formatToSheetDate,
    colToLetter,
    getDaysInMonthForTab,
    parseMonthYearFromTab,
    formatDiasParaSheets
};
