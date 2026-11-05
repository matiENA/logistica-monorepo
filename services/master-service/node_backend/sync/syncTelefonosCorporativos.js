// ==============================================================================
// 🔄 SINCRONIZACIÓN Y NORMALIZACIÓN DE TELÉFONOS CORPORATIVOS
// Planilla: Asignación De Teléfonos - Choferes (1xJ31YzNbX8BwO3t3zLSm3GdRyM_E7_TImKpD7plBNoU)
// Destino: public.chofer_documentacion (telef_corp y telefono personal)
// ==============================================================================

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { JWT } = require('google-auth-library');
const { Pool } = require('pg');

const ID_SHEET_CORPORATIVOS = '1xJ31YzNbX8BwO3t3zLSm3GdRyM_E7_TImKpD7plBNoU';

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
 * Limpia y normaliza números telefónicos a formato numérico de 10 dígitos (ej: 2994232869).
 */
function limpiarTelefono(tel) {
    if (!tel) return '';
    let digits = String(tel).replace(/\D/g, '');
    // Si empieza con código de país 549... o 54...
    if (digits.startsWith('549') && digits.length >= 13) {
        digits = digits.substring(3);
    } else if (digits.startsWith('54') && digits.length >= 12) {
        digits = digits.substring(2);
    }
    // Si empieza con 0 inicial (ej: 0299...)
    if (digits.startsWith('0') && digits.length > 10) {
        digits = digits.substring(1);
    }
    // Si tiene un 15 interpuesto común en Argentina (ej: 299 15 4232869)
    if (digits.length === 12 && digits.slice(3, 5) === '15') {
        digits = digits.slice(0, 3) + digits.slice(5);
    }
    return digits;
}

/**
 * Calcula la distancia de Levenshtein entre dos cadenas para matching difuso.
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
                    matrix[i - 1][j - 1] + 1, // sustitución
                    matrix[i][j - 1] + 1,     // inserción
                    matrix[i - 1][j] + 1      // eliminación
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

/**
 * Similitud entre 0 y 1 basada en Levenshtein.
 */
function similitudTexto(a, b) {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1.0;
    const dist = levenshtein(a, b);
    return 1 - (dist / maxLen);
}

/**
 * Obtiene cliente autenticado para Google Sheets API.
 */
function getGoogleAuth() {
    let saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    let saKey = process.env.GOOGLE_PRIVATE_KEY;

    if ((!saEmail || !saKey) && process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        try {
            const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
            saEmail = saEmail || parsed.client_email;
            saKey = saKey || parsed.private_key;
        } catch (e) {
            console.warn('⚠️ Error al parsear GOOGLE_SERVICE_ACCOUNT_JSON:', e.message);
        }
    }

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
 * Función principal de sincronización y normalización.
 */
async function sincronizarTelefonos({ dryRun = true } = {}) {
    console.log(`\n=============================================================`);
    console.log(`🚀 INICIANDO SINCRONIZACIÓN DE TELÉFONOS CORPORATIVOS`);
    console.log(`Modo: ${dryRun ? '🔍 DRY RUN (Simulación - Sin escribir en DB)' : '⚡ APPLY (Persistencia activa en PostgreSQL)'}`);
    console.log(`=============================================================\n`);

    const auth = getGoogleAuth();
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        // 1. Descargar filas de la pestaña ASIGNACION
        console.log(`📡 Descargando pestaña 'ASIGNACION' de Google Sheet ${ID_SHEET_CORPORATIVOS}...`);
        const resSheet = await auth.request({
            url: `https://sheets.googleapis.com/v4/spreadsheets/${ID_SHEET_CORPORATIVOS}/values/${encodeURIComponent('ASIGNACION!A6:N')}`
        });

        const rawRows = resSheet.data.values || [];
        console.log(`📊 Leídas ${rawRows.length} filas desde la planilla.`);

        const sheetRecords = rawRows
            .map((r, idx) => ({
                rowNum: idx + 6,
                nombre: String(r[0] || '').trim(),
                pin: String(r[1] || '').trim(),
                telefonoRaw: String(r[2] || '').trim(),
                telefonoClean: limpiarTelefono(r[2]),
                observaciones: String(r[3] || '').trim(),
                estadoAsignacion: String(r[6] || '').trim(),
                modelo: String(r[8] || '').trim()
            }))
            .filter(r => r.nombre.length > 2 && r.telefonoClean.length >= 6);

        console.log(`✅ Filas con chofer y número corporativo válido: ${sheetRecords.length}`);

        // 2. Consultar choferes y documentación en PostgreSQL
        console.log(`📡 Consultando choferes y documentación en PostgreSQL...`);
        const qChoferes = await pool.query(`
            SELECT c.id, c.nombre, c.legajo, c.estado, cd.id AS doc_id, cd.telefono, cd.telef_corp
            FROM public.choferes c
            LEFT JOIN public.chofer_documentacion cd ON cd.chofer_id = c.id
        `);

        const dbChoferes = qChoferes.rows;
        console.log(`📊 Encontrados ${dbChoferes.length} choferes en PostgreSQL.`);

        // Construir índices para matching
        const mapExact = new Map();
        const listChoferesNorm = [];

        dbChoferes.forEach(ch => {
            const norm = normalizarNombre(ch.nombre);
            mapExact.set(norm, ch);
            listChoferesNorm.push({
                chofer: ch,
                norm,
                tokens: norm.split(' ').filter(t => t.length > 2)
            });
        });

        // 3. Emparejamiento (Exacto -> Tokens -> Levenshtein)
        const stats = {
            totalSheet: sheetRecords.length,
            matchExact: 0,
            matchTokens: 0,
            matchFuzzy: 0,
            noMatch: 0,
            samePhone: 0,
            diffPhone: 0,
            emptyPhone: 0,
            updates: []
        };

        const unmatchedList = [];

        sheetRecords.forEach(sr => {
            const normSr = normalizarNombre(sr.nombre);
            let matchedChofer = mapExact.get(normSr);
            let matchType = 'EXACT';

            if (!matchedChofer) {
                // Intento 1: Tokens coinciden
                const tokensSr = normSr.split(' ').filter(t => t.length > 2);
                for (const item of listChoferesNorm) {
                    const allIn = tokensSr.every(t => item.tokens.includes(t));
                    const reverseIn = item.tokens.every(t => tokensSr.includes(t));
                    if (allIn || reverseIn) {
                        matchedChofer = item.chofer;
                        matchType = 'TOKENS';
                        break;
                    }
                }
            }

            if (!matchedChofer) {
                // Intento 2: Levenshtein > 0.82
                let bestScore = 0;
                let bestItem = null;
                for (const item of listChoferesNorm) {
                    const score = similitudTexto(normSr, item.norm);
                    if (score > bestScore && score >= 0.82) {
                        bestScore = score;
                        bestItem = item;
                    }
                }
                if (bestItem) {
                    matchedChofer = bestItem.chofer;
                    matchType = `FUZZY (${Math.round(bestScore * 100)}%)`;
                }
            }

            if (!matchedChofer) {
                stats.noMatch++;
                unmatchedList.push(sr);
                return;
            }

            if (matchType === 'EXACT') stats.matchExact++;
            else if (matchType === 'TOKENS') stats.matchTokens++;
            else stats.matchFuzzy++;

            // 4. Aplicar Reglas Canónicas de Teléfono
            const currentTelPersonal = matchedChofer.telefono;
            const currentTelPersonalClean = limpiarTelefono(currentTelPersonal);
            const sheetCorpClean = sr.telefonoClean;

            let nuevoTelefonoPersonal = currentTelPersonal;
            let nuevoTelefCorp = sheetCorpClean;
            let reglaAplicada = '';

            if (!currentTelPersonalClean) {
                // Caso 3: En Supabase no había teléfono
                stats.emptyPhone++;
                reglaAplicada = 'EMPTY_DB -> Asignar telef_corp';
                nuevoTelefonoPersonal = null;
            } else if (
                currentTelPersonalClean === sheetCorpClean ||
                currentTelPersonalClean.endsWith(sheetCorpClean) ||
                sheetCorpClean.endsWith(currentTelPersonalClean)
            ) {
                // Caso 1: El teléfono en Supabase era idéntico al corporativo
                stats.samePhone++;
                reglaAplicada = 'SAME_PHONE -> Mover a telef_corp y vaciar personal';
                nuevoTelefonoPersonal = null;
            } else {
                // Caso 2: El teléfono en Supabase es diferente (mantiene personal)
                stats.diffPhone++;
                reglaAplicada = 'DIFF_PHONE -> Preservar personal y agregar telef_corp';
                nuevoTelefonoPersonal = currentTelPersonal;
            }

            // Smart Diff: Verificar si hubo cambios reales contra la base de datos
            const sinCambios = (matchedChofer.telef_corp === nuevoTelefCorp) && 
                               (matchedChofer.telefono === nuevoTelefonoPersonal || 
                               (!matchedChofer.telefono && !nuevoTelefonoPersonal));

            if (sinCambios) {
                stats.noOp = (stats.noOp || 0) + 1;
                reglaAplicada += ' [NO_OP: Sin cambios]';
            } else {
                stats.realUpdates = (stats.realUpdates || 0) + 1;
            }

            stats.updates.push({
                choferId: matchedChofer.id,
                docId: matchedChofer.doc_id,
                choferNombre: matchedChofer.nombre,
                sheetNombre: sr.nombre,
                matchType,
                prevTel: currentTelPersonal,
                prevCorp: matchedChofer.telef_corp,
                nextTel: nuevoTelefonoPersonal,
                nextCorp: nuevoTelefCorp,
                regla: reglaAplicada,
                sinCambios
            });
        });

        // 5. Imprimir Reporte de Estadísticas
        console.log(`\n=============================================================`);
        console.log(`📈 RESUMEN DEL PROCESAMIENTO`);
        console.log(`=============================================================`);
        console.log(`Total registros en hoja procesados: ${stats.totalSheet}`);
        console.log(`Matches exactos:                    ${stats.matchExact}`);
        console.log(`Matches por tokens:                 ${stats.matchTokens}`);
        console.log(`Matches difusos (Fuzzy):            ${stats.matchFuzzy}`);
        console.log(`Total coincidencias:                ${stats.updates.length}`);
        console.log(`Sin coincidencia en choferes:       ${stats.noMatch}`);
        console.log(`-------------------------------------------------------------`);
        console.log(`Regla 1 (Mismo teléfono -> mover a corp y NULL personal):    ${stats.samePhone}`);
        console.log(`Regla 2 (Distinto teléfono -> mantener personal + corp):    ${stats.diffPhone}`);
        console.log(`Regla 3 (Sin teléfono en DB -> asignar corp):               ${stats.emptyPhone}`);
        console.log(`=============================================================\n`);

        if (unmatchedList.length > 0) {
            console.log(`⚠️ Registros de la planilla sin chofer emparejado (${unmatchedList.length}):`);
            unmatchedList.forEach(u => {
                console.log(`  - Fila ${u.rowNum}: "${u.nombre}" | Tel: ${u.telefonoRaw} | Obs: "${u.observaciones}"`);
            });
            console.log('');
        }

        // 6. Aplicar en Base de Datos si no es dryRun
        if (!dryRun) {
            const updatesReales = stats.updates.filter(u => !u.sinCambios);
            console.log(`💾 Persistiendo ${updatesReales.length} actualizaciones en PostgreSQL (Smart Diff omitió ${stats.noOp || 0} sin cambios)...`);
            if (updatesReales.length === 0) {
                console.log(`✨ Smart Diff: 0 cambios pendientes. Base de datos ya sincronizada al 100%.`);
                return;
            }

            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                let updatedCount = 0;
                let insertedCount = 0;

                for (const up of updatesReales) {
                    if (up.docId) {
                        // UPDATE existente en chofer_documentacion con cláusula de seguridad IS DISTINCT FROM
                        await client.query(`
                            UPDATE public.chofer_documentacion
                            SET telefono = $1, telef_corp = $2, actualizado_el = NOW()
                            WHERE id = $3 AND (telefono IS DISTINCT FROM $1 OR telef_corp IS DISTINCT FROM $2)
                        `, [up.nextTel, up.nextCorp, up.docId]);
                        updatedCount++;
                    } else {
                        // INSERT si el chofer no tenía registro en chofer_documentacion
                        await client.query(`
                            INSERT INTO public.chofer_documentacion (chofer_id, telefono, telef_corp, actualizado_el)
                            VALUES ($1, $2, $3, NOW())
                            ON CONFLICT (chofer_id) DO UPDATE
                            SET telefono = EXCLUDED.telefono, telef_corp = EXCLUDED.telef_corp, actualizado_el = NOW()
                            WHERE chofer_documentacion.telefono IS DISTINCT FROM EXCLUDED.telefono 
                               OR chofer_documentacion.telef_corp IS DISTINCT FROM EXCLUDED.telef_corp
                        `, [up.choferId, up.nextTel, up.nextCorp]);
                        insertedCount++;
                    }
                }

                await client.query('COMMIT');
                console.log(`✅ Transacción completada con éxito.`);
                console.log(`   - Documentaciones actualizadas: ${updatedCount}`);
                console.log(`   - Documentaciones insertadas/creadas: ${insertedCount}`);
            } catch (err) {
                await client.query('ROLLBACK');
                console.error(`❌ Error en transacción. Se realizó ROLLBACK:`, err);
                throw err;
            } finally {
                client.release();
            }
        } else {
            console.log(`ℹ️ [DRY RUN]: No se aplicaron cambios en la base de datos.`);
            console.log(`Para persistir los cambios, ejecuta: node services/master-service/node_backend/sync/syncTelefonosCorporativos.js --apply\n`);
        }

    } finally {
        await pool.end();
    }
}

// Ejecución por CLI
if (require.main === module) {
    const isApply = process.argv.includes('--apply');
    sincronizarTelefonos({ dryRun: !isApply })
        .then(() => {
            console.log('🏁 Proceso finalizado.');
            process.exit(0);
        })
        .catch(err => {
            console.error('💥 Error fatal en sincronización:', err);
            process.exit(1);
        });
}

module.exports = { sincronizarTelefonos };
