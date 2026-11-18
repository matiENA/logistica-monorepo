// ==============================================================================
// 🔄 SINCRONIZACIÓN DE ESTADO DE CAPACITACIÓN (HUMAND)
// Planilla: Seguimiento Humand-01 (11xeC7mt6Xdjzz_X-XvJl4wdOrQLJ0WXqjQiOp1rm8ac)
// Pestaña: Control Pendientes (Rango B7:H350)
// Destino: public.chofer_documentacion (estado_capacitacion)
// ==============================================================================

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { JWT } = require('google-auth-library');
const { google } = require('googleapis');
const db = require('../utils/db');

const ID_SHEET_HUMAND = '11xeC7mt6Xdjzz_X-XvJl4wdOrQLJ0WXqjQiOp1rm8ac';
const RANGO_CONTROL_PENDIENTES = 'Control Pendientes!B7:H350';

/**
 * Normaliza nombres eliminando acentos, caracteres especiales y espacios redundantes.
 */
function normalizarNombre(str) {
    if (!str) return '';
    return String(str)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/ñ/g, 'n')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ');
}

/**
 * Limpia y normaliza DNI/CUIT extrayendo sólo dígitos.
 */
function extraerDigitos(str) {
    if (!str) return '';
    return String(str).replace(/\D/g, '');
}

/**
 * Obtiene DNI de 7 u 8 dígitos a partir de un CUIT/CUIL de 11 dígitos.
 */
function dniDesdeCuil(cuilStr) {
    const digits = extraerDigitos(cuilStr);
    if (digits.length === 11) {
        return digits.substring(2, 10);
    }
    if (digits.length >= 7 && digits.length <= 8) {
        return digits;
    }
    return digits;
}

/**
 * Distancia de Levenshtein para matching difuso.
 */
function levenshtein(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

function similitudTexto(a, b) {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1.0;
    return 1 - (levenshtein(a, b) / maxLen);
}

/**
 * Autenticación para Google Sheets API.
 */
function getGoogleAuth() {
    let saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    let saKey = process.env.GOOGLE_PRIVATE_KEY;

    if (!saEmail || !saKey) {
        throw new Error('Credenciales de Google Service Account no encontradas en variables de entorno.');
    }

    return new JWT({
        email: saEmail,
        key: saKey.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
}

/**
 * Función principal de sincronización.
 */
async function sincronizarCapacitaciones({ dryRun = true } = {}) {
    console.log(`\n=============================================================`);
    console.log(`🚀 INICIANDO SINCRONIZACIÓN DE ESTADO DE CAPACITACIÓN (HUMAND)`);
    console.log(`Modo: ${dryRun ? '🔍 DRY RUN (Simulación - Sin escribir en DB)' : '⚡ APPLY (Persistencia activa en PostgreSQL)'}`);
    console.log(`=============================================================\n`);

    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Leer planilla Google Sheets
    console.log(`📥 Leyendo rango '${RANGO_CONTROL_PENDIENTES}' de la planilla...`);
    const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: ID_SHEET_HUMAND,
        range: RANGO_CONTROL_PENDIENTES,
    });

    const rows = resp.data.values || [];
    if (rows.length === 0) {
        console.log('⚠️ No se encontraron filas en la planilla.');
        return { total: 0, actualizados: 0, sinCambios: 0, noEncontrados: 0 };
    }

    // Cabecera en fila 0: ['Usuario / CUIT', 'Chofer', 'Servicio', '% Avance Aprobado', '% Cumplimiento Firma', 'Cursos Faltantes', 'Nivel de Prioridad']
    const dataRows = rows.slice(1).filter(r => r && r[0] && r[1]);
    console.log(`📋 Total de filas operativas en Control Pendientes: ${dataRows.length}`);

    // 2. Consultar choferes y documentación en Postgres
    const { rows: dbChoferes } = await db.query(`
        SELECT 
            c.id AS chofer_id,
            c.nombre,
            cd.id AS doc_id,
            cd.cuil,
            cd.dni,
            cd.estado_capacitacion
        FROM public.choferes c
        LEFT JOIN public.chofer_documentacion cd ON cd.chofer_id = c.id
    `);

    console.log(`👥 Choferes cargados desde PostgreSQL: ${dbChoferes.length}`);

    // Índices en memoria para resolución ultra rápida O(1)
    const mapPorDni = new Map();
    const mapPorCuil = new Map();
    const listadoChoferes = [];

    for (const ch of dbChoferes) {
        const normNom = normalizarNombre(ch.nombre);
        listadoChoferes.push({ ...ch, normNom });

        if (ch.dni) {
            const cleanD = extraerDigitos(ch.dni);
            if (cleanD) mapPorDni.set(cleanD, ch);
        }
        if (ch.cuil) {
            const cleanC = extraerDigitos(ch.cuil);
            if (cleanC) mapPorCuil.set(cleanC, ch);
        }
    }

    let actualizados = 0;
    let sinCambios = 0;
    let noEncontrados = 0;
    const matchedChoferIds = new Set();

    for (const r of dataRows) {
        const rawCuit = (r[0] || '').trim();
        const rawNombre = (r[1] || '').trim();
        const rawPrioridad = (r[6] || '').trim().toUpperCase(); // 'CRÍTICA' | 'ALTA' | 'MEDIA'

        if (!rawPrioridad) continue;

        const cleanCuit = extraerDigitos(rawCuit);
        const cleanDni = dniDesdeCuil(rawCuit);
        const normSheetNom = normalizarNombre(rawNombre);

        // 1. Intentar match por CUIL/CUIT
        let match = mapPorCuil.get(cleanCuit);

        // 2. Intentar match por DNI
        if (!match && cleanDni) {
            match = mapPorDni.get(cleanDni);
        }

        // 3. Match difuso por nombre
        if (!match && normSheetNom.length > 4) {
            let bestSim = 0;
            let bestCandidate = null;

            for (const ch of listadoChoferes) {
                if (ch.normNom === normSheetNom) {
                    bestCandidate = ch;
                    bestSim = 1.0;
                    break;
                }
                const sim = similitudTexto(normSheetNom, ch.normNom);
                if (sim > bestSim) {
                    bestSim = sim;
                    bestCandidate = ch;
                }
            }

            if (bestSim >= 0.82) {
                match = bestCandidate;
            }
        }

        if (!match) {
            console.log(`⚠️ No se encontró chofer en DB para: ${rawNombre} (CUIT: ${rawCuit})`);
            noEncontrados++;
            continue;
        }

        matchedChoferIds.add(match.chofer_id);

        const estadoActual = (match.estado_capacitacion || '').trim().toUpperCase();
        if (estadoActual === rawPrioridad) {
            sinCambios++;
            continue;
        }

        // Si hay cambio
        if (dryRun) {
            console.log(`[DRY-RUN] UPDATE chofer '${match.nombre}': ${estadoActual || 'NULL'} -> ${rawPrioridad}`);
            actualizados++;
        } else {
            // Smart diff incremental con IS DISTINCT FROM
            if (match.doc_id) {
                await db.query(`
                    UPDATE public.chofer_documentacion
                    SET estado_capacitacion = $1, actualizado_el = NOW()
                    WHERE chofer_id = $2 AND estado_capacitacion IS DISTINCT FROM $1
                `, [rawPrioridad, match.chofer_id]);
            } else {
                await db.query(`
                    INSERT INTO public.chofer_documentacion (chofer_id, dni, cuil, estado_capacitacion, actualizado_el)
                    VALUES ($1, $2, $3, $4, NOW())
                    ON CONFLICT (chofer_id) DO UPDATE 
                    SET estado_capacitacion = EXCLUDED.estado_capacitacion, actualizado_el = NOW()
                    WHERE chofer_documentacion.estado_capacitacion IS DISTINCT FROM EXCLUDED.estado_capacitacion
                `, [match.chofer_id, cleanDni || null, cleanCuit || null, rawPrioridad]);
            }
            actualizados++;
        }
    }

    // Limpieza de choferes que ya no tienen pendientes (quedan en NULL para no renderizar badge)
    if (!dryRun && matchedChoferIds.size > 0) {
        const { rowCount: limpiados } = await db.query(`
            UPDATE public.chofer_documentacion
            SET estado_capacitacion = NULL, actualizado_el = NOW()
            WHERE estado_capacitacion IS NOT NULL 
              AND chofer_id NOT IN (${Array.from(matchedChoferIds).map((_, i) => `$${i + 1}`).join(',')})
        `, Array.from(matchedChoferIds));
        if (limpiados > 0) {
            console.log(`🧹 Choferes regularizados (sin pendientes, estado reseteado a NULL): ${limpiados}`);
        }
    }

    console.log(`\n=============================================================`);
    console.log(`🏁 RESUMEN DE SINCRONIZACIÓN HUMAND:`);
    console.log(`  - Total filas procesadas: ${dataRows.length}`);
    console.log(`  - Choferes a actualizar:   ${actualizados}`);
    console.log(`  - Choferes sin cambios:    ${sinCambios}`);
    console.log(`  - Choferes no encontrados: ${noEncontrados}`);
    console.log(`=============================================================\n`);

    return { total: dataRows.length, actualizados, sinCambios, noEncontrados };
}

// Ejecución directa por CLI
if (require.main === module) {
    const isApply = process.argv.includes('--apply');
    sincronizarCapacitaciones({ dryRun: !isApply })
        .then(() => process.exit(0))
        .catch(err => {
            console.error('❌ Error fatal en sincronización:', err);
            process.exit(1);
        });
}

module.exports = { sincronizarCapacitaciones };
