const express = require('express');
const db = require('./utils/db');
const {
    normalizar,
    serviceAccountAuth: sharedServiceAccountAuth,
    fetchRango: sharedFetchRango,
    ID_SHEET_MOVIMIENTOS,
    getFechaArgentina
} = require('./utils/shared');
const {
    syncBajasGoogleSheets,
    queueSyncBajas,
    limpiarTrackingNovedad,
    obtenerEstadoTrackingBajas
} = require('./utils/googleSheetsSync');

function sumarUnDiaIso(isoDateStr) {
    if (!isoDateStr) return null;
    const clean = String(isoDateStr).split('T')[0].trim();
    const [y, m, d] = clean.split('-').map(Number);
    if (!y || !m || !d) return null;
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + 1);
    const ny = dt.getFullYear();
    const nm = String(dt.getMonth() + 1).padStart(2, '0');
    const nd = String(dt.getDate()).padStart(2, '0');
    return `${ny}-${nm}-${nd}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(val) {
    return typeof val === 'string' && UUID_RE.test(val.trim());
}

function cleanPatenteSql(patenteRaw) {
    if (!patenteRaw) return '';
    const clean = String(patenteRaw).trim().toUpperCase();
    if (clean === 'S/D' || clean === '-') return '';
    return clean.replace(/[\s\-_.]/g, '');
}

const MAPA_SERVICIO_CANONICO = {
    'CM': 'CAMPO',
    'CAMPO': 'CAMPO',
    'MET': 'METANOL',
    'METANOL': 'METANOL',
    'LIV': 'LIVIANO',
    'LIV.': 'LIVIANO',
    'LIVIANO': 'LIVIANO',
    'PP': 'PRODUCTOS PRIMARIOS',
    'PRODUCTOS PRIMARIOS': 'PRODUCTOS PRIMARIOS',
    'EURO': 'ABAST',
    'TDS': 'ABAST',
    'ABAST': 'ABAST',
    'GLP': 'GLP',
    'GRALES': 'GRALES',
    'GRALES.': 'GRALES.',
    'PASIVO EN BASE': 'PASIVO EN BASE',
    'SOCIO': 'SOCIO'
};

async function inyectarServicioEnSheetDispo(tractorPatente, choferNom, servicioDB, serviceAccountAuth, fetchRango) {
    if (!servicioDB || !serviceAccountAuth || !fetchRango) return;
    const tractor = cleanPatenteSql(tractorPatente);
    const nomNorm = choferNom ? normalizar(choferNom) : '';

    const spreadsheetId = process.env.MES_MOVIMIENTOS_ID || ID_SHEET_MOVIMIENTOS;
    if (!spreadsheetId) return;

    // Obtener la fecha actual en Argentina
    const hoyAr = (typeof getFechaArgentina === 'function') ? getFechaArgentina() : new Date();
    const diaActual = hoyAr.getDate();
    const mesActual = hoyAr.getMonth();

    const mesesLargo = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

    let nombreHoja = null;
    try {
        const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
        const metaRes = await serviceAccountAuth.request({ url: metaUrl });
        const sheetTitles = metaRes.data.sheets.map(s => s.properties.title);

        // Pestaña dinámica del mes: ej: "AGOSTO 2026- Mov.Unidades y Choferes"
        const mesNombreUpper = mesesLargo[mesActual].toUpperCase();
        nombreHoja = sheetTitles.find(s => s.toUpperCase().includes(mesNombreUpper) && s.toLowerCase().includes('mov.unidades')) ||
                     sheetTitles.find(s => s.toLowerCase().includes('mov.unidades')) ||
                     sheetTitles.find(s => s.toLowerCase().includes('dispo')) ||
                     sheetTitles[0];
    } catch (e) {
        console.error("[Dispo] Error obteniendo pestañas:", e.message || e);
        return;
    }

    if (!nombreHoja) return;

    try {
        const rows = await fetchRango(spreadsheetId, `'${nombreHoja}'!A1:ZZ500`);
        if (!rows || rows.length === 0) return;

        let tractorColIdx = 4; // Col E (0-indexed = 4)
        let choferBaseColIdx = -1;
        let targetDispoColIdx = -1;

        // 1. Encontrar la columna "Dispo." para la FECHA ACTUAL (ej: "04 agosto 2026")
        const diaStr = String(diaActual).padStart(2, '0');
        const regexFechaActual = new RegExp(`\\b0?${diaActual}\\s+${mesesLargo[mesActual]}\\b`, 'i');

        let colFechaHeaderIdx = -1;
        if (rows[0]) {
            for (let c = 0; c < rows[0].length; c++) {
                const cellVal = String(rows[0][c] || '').trim();
                if (regexFechaActual.test(cellVal) || cellVal.includes(`${diaStr} ${mesesLargo[mesActual]}`)) {
                    colFechaHeaderIdx = c;
                    break;
                }
            }
        }

        if (colFechaHeaderIdx !== -1) {
            // Columna "Dispo." inmediatamente anterior al bloque de fecha o relativa a Chofer
            targetDispoColIdx = colFechaHeaderIdx - 2;
            if (targetDispoColIdx < 0) targetDispoColIdx = colFechaHeaderIdx + 1;
        }

        if (targetDispoColIdx === -1) {
            for (let r = 0; r < Math.min(5, rows.length); r++) {
                for (let c = 0; c < rows[r].length; c++) {
                    const cellVal = String(rows[r][c] || '').trim();
                    if (cellVal.toLowerCase() === 'tractor') tractorColIdx = c;
                    if (cellVal.toLowerCase() === 'chofer' || cellVal.toLowerCase() === 'choferes') choferBaseColIdx = c;
                }
            }

            if (choferBaseColIdx !== -1) {
                targetDispoColIdx = choferBaseColIdx + 1; // "UNA ADELANTE DEL NOM" (Columna Dispo.)
            }
        }

        if (targetDispoColIdx === -1) {
            targetDispoColIdx = 26; // Fallback Col AA
        }

        // 2. Buscar fila por tractor o chofer
        let targetRowIdx = -1;
        for (let i = 0; i < rows.length; i++) {
            const tVal = cleanPatenteSql(rows[i][tractorColIdx]);
            if (tractor && tVal === tractor) {
                targetRowIdx = i + 1;
                break;
            }

            if (choferBaseColIdx !== -1 && nomNorm) {
                const cVal = String(rows[i][choferBaseColIdx] || '').trim();
                if (cVal && normalizar(cVal) === nomNorm) {
                    targetRowIdx = i + 1;
                    break;
                }
            }
        }

        if (targetRowIdx === -1) {
            console.warn(`[Dispo] Tractor [${tractor}] o Chofer [${choferNom}] no encontrado en hoja ${nombreHoja}`);
            return;
        }

        function colToLetter(colIndex) {
            let temp, letter = '';
            while (colIndex >= 0) {
                temp = colIndex % 26;
                letter = String.fromCharCode(temp + 65) + letter;
                colIndex = (colIndex - temp) / 26 - 1;
            }
            return letter;
        }

        const colLetter = colToLetter(targetDispoColIdx);
        const rangeToUpdate = `'${nombreHoja}'!${colLetter}${targetRowIdx}`;

        await serviceAccountAuth.request({
            url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(rangeToUpdate)}?valueInputOption=USER_ENTERED`,
            method: 'PUT',
            data: { values: [[servicioDB]] }
        });

        console.log(`✓ [Dispo] Servicio [${servicioDB}] inyectado en columna Dispo. (${rangeToUpdate}) para tractor ${tractor}`);
    } catch (e) {
        console.error("[Dispo] Error inyectando servicio:", e.message || e);
    }
}

// ==============================================================
// HELPERS RELACIONALES POSTGRESQL (public.novedades + vistas)
// ==============================================================
async function resolveTipoNovedad(payload) {
    if (isValidUuid(payload?.tipo_novedad_id)) {
        const byId = await db.query(
            `SELECT id, codigo, titulo, COALESCE(imprime_nota_movimientos, false) AS imprime_nota_movimientos
             FROM public.tipos_novedad
             WHERE id = $1::uuid
             LIMIT 1`,
            [payload.tipo_novedad_id.trim()]
        );
        if (byId.rows.length > 0) return byId.rows[0];
    }

    const codeCand = String(
        payload?.tipo_novedad || payload?.tipo || payload?.tipo_novedad_titulo || 'LIBRES'
    ).trim();

    if (codeCand) {
        const byCode = await db.query(
            `SELECT id, codigo, titulo, COALESCE(imprime_nota_movimientos, false) AS imprime_nota_movimientos
             FROM public.tipos_novedad
             WHERE UPPER(TRIM(codigo)) = UPPER(TRIM($1))
                OR UPPER(TRIM(titulo)) = UPPER(TRIM($1))
             LIMIT 1`,
            [codeCand]
        );
        if (byCode.rows.length > 0) return byCode.rows[0];
    }

    const fallback = await db.query(
        `SELECT id, codigo, titulo, COALESCE(imprime_nota_movimientos, false) AS imprime_nota_movimientos
         FROM public.tipos_novedad
         ORDER BY (codigo = 'LIBRES') DESC, activo DESC, orden ASC
         LIMIT 1`
    );
    return fallback.rows[0] || null;
}

async function resolveTerminalId(terminalIdRaw, terminalCodigoRaw, esLibre = true) {
    if (!esLibre) return null;

    const codeClean = String(terminalCodigoRaw || '').trim();
    const idClean = String(terminalIdRaw || '').trim();

    if (!idClean && !codeClean) return null;

    if (isValidUuid(idClean)) {
        const byId = await db.query(
            `SELECT id FROM public.terminales WHERE id = $1::uuid LIMIT 1`,
            [idClean]
        );
        if (byId.rows.length > 0) return byId.rows[0].id;
    }

    if (codeClean) {
        const byCode = await db.query(
            `SELECT id FROM public.terminales
             WHERE UPPER(TRIM(codigo)) = UPPER(TRIM($1))
                OR UPPER(TRIM(nombre)) = UPPER(TRIM($1))
             LIMIT 1`,
            [codeClean]
        );
        if (byCode.rows.length > 0) return byCode.rows[0].id;
    }

    return null;
}

async function resolveCreadoPorId(creadoPorIdRaw, creadorNombreRaw) {
    // Validar estrictamente contra public.dash(id) para respetar FK novedades_creado_por_id_fkey
    if (isValidUuid(creadoPorIdRaw)) {
        const byId = await db.query(
            `SELECT id FROM public.dash WHERE id = $1::uuid LIMIT 1`,
            [creadoPorIdRaw.trim()]
        );
        if (byId.rows.length > 0) return byId.rows[0].id;
    }

    const nomClean = String(creadorNombreRaw || '').trim();
    if (nomClean) {
        const byName = await db.query(
            `SELECT id FROM public.dash WHERE UPPER(TRIM(nombre)) = UPPER(TRIM($1)) LIMIT 1`,
            [nomClean]
        );
        if (byName.rows.length > 0) return byName.rows[0].id;
    }

    return null;
}

async function resolveChoferYUnidad(payload, cacheDatosGlobales) {
    let choferId = null;
    let choferUnidadFallback = null;
    let unidadId = null;

    const rawChoferUuid = payload?.chofer_id || payload?.id_chofer || null;
    const rawNom = String(payload?.nom || payload?.nombre || payload?.chofer || '').trim();
    const patTractor = cleanPatenteSql(payload?.tractor);
    const rawUte = String(payload?.n_ute || '').trim();

    // 1. Resolver Chofer
    if (isValidUuid(rawChoferUuid)) {
        const chRes = await db.query(
            `SELECT id, nombre, unidad_id FROM public.choferes WHERE id = $1::uuid LIMIT 1`,
            [rawChoferUuid.trim()]
        );
        if (chRes.rows.length > 0) {
            const dbNomNorm = normalizar(chRes.rows[0].nombre || '');
            const inputNomNorm = rawNom ? normalizar(rawNom) : '';
            // Si el operador escribió otro nombre distinto manualmente, priorizar el texto escrito
            if (!inputNomNorm || dbNomNorm === inputNomNorm || dbNomNorm.includes(inputNomNorm) || inputNomNorm.includes(dbNomNorm)) {
                choferId = chRes.rows[0].id;
                choferUnidadFallback = chRes.rows[0].unidad_id || null;
            }
        }
    }

    if (!choferId && rawNom) {
        const chByName = await db.query(
            `SELECT id, unidad_id FROM public.choferes
             WHERE TRANSLATE(UPPER(TRIM(REPLACE(nombre, ',', ''))), 'ÁÉÍÓÚÜÑ', 'AEIOUUN') =
                   TRANSLATE(UPPER(TRIM(REPLACE($1, ',', ''))), 'ÁÉÍÓÚÜÑ', 'AEIOUUN')
             ORDER BY (COALESCE(estado, '') = 'circulando') DESC, id ASC
             LIMIT 1`,
            [rawNom]
        );
        if (chByName.rows.length > 0) {
            choferId = chByName.rows[0].id;
            choferUnidadFallback = chByName.rows[0].unidad_id || null;
        } else if (cacheDatosGlobales?.mapaNombreDiagramaAId) {
            const mappedId = cacheDatosGlobales.mapaNombreDiagramaAId[normalizar(rawNom)];
            if (isValidUuid(mappedId)) {
                const verifyCh = await db.query(
                    `SELECT id, unidad_id FROM public.choferes WHERE id = $1::uuid LIMIT 1`,
                    [mappedId]
                );
                if (verifyCh.rows.length > 0) {
                    choferId = verifyCh.rows[0].id;
                    choferUnidadFallback = verifyCh.rows[0].unidad_id || null;
                }
            }
        }
    }

    // 2. Resolver Unidad (respetando ediciones manuales de patente de tractor)
    if (isValidUuid(payload?.unidad_id)) {
        const uRes = await db.query(
            `SELECT u.id, t.patente AS tractor_patente
             FROM public.unidades u
             LEFT JOIN public.tractores t ON u.tractor_id = t.id
             WHERE u.id = $1::uuid
             LIMIT 1`,
            [payload.unidad_id.trim()]
        );
        if (uRes.rows.length > 0) {
            const dbPat = cleanPatenteSql(uRes.rows[0].tractor_patente);
            if (!patTractor || dbPat === patTractor) {
                unidadId = uRes.rows[0].id;
            }
        }
    }

    if (!unidadId && patTractor) {
        const uByTractor = await db.query(
            `SELECT u.id
             FROM public.unidades u
             JOIN public.tractores t ON u.tractor_id = t.id
             WHERE REGEXP_REPLACE(UPPER(COALESCE(t.patente, '')), '[\\s\\-_.]', '', 'g') = $1
             ORDER BY (u.estado = 'circulando') DESC, u.n_ute ASC NULLS LAST
             LIMIT 1`,
            [patTractor]
        );
        if (uByTractor.rows.length > 0) {
            unidadId = uByTractor.rows[0].id;
        }
    }

    if (!unidadId && rawUte && rawUte.toUpperCase() !== 'S/D') {
        const uByUte = await db.query(
            `SELECT id FROM public.unidades WHERE UPPER(TRIM(n_ute)) = UPPER(TRIM($1)) LIMIT 1`,
            [rawUte]
        );
        if (uByUte.rows.length > 0) {
            unidadId = uByUte.rows[0].id;
        }
    }

    if (!unidadId && choferId) {
        const movRes = await db.query(
            `SELECT id_unidad FROM public.movimientos WHERE id_chofer = $1::uuid LIMIT 1`,
            [choferId]
        );
        if (movRes.rows.length > 0 && movRes.rows[0].id_unidad) {
            unidadId = movRes.rows[0].id_unidad;
        } else if (choferUnidadFallback) {
            unidadId = choferUnidadFallback;
        }
    }

    // 3. Caso especial: el operador escribió una patente en el campo Conductor/Patente sin elegir del dropdown
    if (!choferId && !unidadId && rawNom) {
        const patFromNom = cleanPatenteSql(rawNom);
        if (patFromNom.length >= 5 && patFromNom.length <= 8) {
            const uFromNom = await db.query(
                `SELECT u.id AS unidad_id, m.id_chofer AS chofer_id
                 FROM public.unidades u
                 JOIN public.tractores t ON u.tractor_id = t.id
                 LEFT JOIN public.movimientos m ON m.id_unidad = u.id
                 WHERE REGEXP_REPLACE(UPPER(COALESCE(t.patente, '')), '[\\s\\-_.]', '', 'g') = $1
                 ORDER BY (m.id_chofer IS NOT NULL) DESC
                 LIMIT 1`,
                [patFromNom]
            );
            if (uFromNom.rows.length > 0) {
                unidadId = uFromNom.rows[0].unidad_id;
                if (uFromNom.rows[0].chofer_id) choferId = uFromNom.rows[0].chofer_id;
            }
        }
    }

    return { choferId, unidadId };
}

async function actualizarServicioChoferSiCorresponde(choferId, rawServicio, cacheDatosGlobales = null) {
    if (!choferId || !rawServicio) return false;
    const sUpper = String(rawServicio).trim().toUpperCase();
    if (!sUpper || sUpper === 'S/A') return false;

    const targetDenom = MAPA_SERVICIO_CANONICO[sUpper] || sUpper;
    const srvRes = await db.query(
        `SELECT id, denominacion FROM public.servicios_choferes
         WHERE UPPER(TRIM(denominacion)) = $1
           AND denominacion !~ '^[0-9]+$'
         LIMIT 1`,
        [targetDenom]
    );

    if (srvRes.rows.length === 0) return false;
    const srvRow = srvRes.rows[0];

    await db.query(
        `UPDATE public.choferes SET servicio_id = $1::uuid, actualizado_el = NOW() WHERE id = $2::uuid`,
        [srvRow.id, choferId]
    );

    // Sincronizar también en RAM si está cargada para que /api/dash/flota refleje el cambio al instante
    if (cacheDatosGlobales?.diagramas?.diagramas && Array.isArray(cacheDatosGlobales.diagramas.diagramas)) {
        const chRam = cacheDatosGlobales.diagramas.diagramas.find(c => String(c.id) === String(choferId));
        if (chRam) {
            chRam.srv_chofer = srvRow.denominacion;
            chRam.srv = srvRow.denominacion;
        }
    }
    return true;
}

async function obtenerCardEnriquecida(idNovedad) {
    const viewRes = await db.query(
        `SELECT * FROM public.view_cards_diarias WHERE id = $1::bigint LIMIT 1`,
        [idNovedad]
    );
    if (viewRes.rows.length > 0) return viewRes.rows[0];

    // Fallback directo sin filtro de 14 días en caso de editar/consultar un registro histórico
    const fallbackRes = await db.query(
        `SELECT
            n.id,
            n.id AS card_id,
            tn.codigo AS tipo_novedad,
            tn.codigo AS tipo,
            tn.id AS tipo_novedad_id,
            tn.titulo AS tipo_novedad_titulo,
            tn.bg_color AS tipo_bg_color,
            tn.text_color AS tipo_text_color,
            COALESCE(tn.requiere_fecha_objetivo, false) AS requiere_fecha_objetivo,
            COALESCE(tn.imprime_nota_movimientos, false) AS imprime_nota_movimientos,
            n.fecha_objetivo,
            n.fecha_objetivo AS fecha,
            n.fecha_resolucion,
            n.detalle,
            n.resuelto,
            COALESCE(n.prioridad, 'media'::text) AS prioridad,
            n.creado_el,
            n.creado_el AS "timestamp",
            n.creado_por_id,
            COALESCE(d_user.nombre, 'DASH'::text) AS creador,
            COALESCE(d_user.nombre, 'DASH'::text) AS usuario,
            c.id AS chofer_id,
            UPPER(TRIM(BOTH FROM COALESCE(c.nombre, ''::text))) AS nom,
            UPPER(TRIM(BOTH FROM COALESCE(c.nombre, ''::text))) AS chofer_nombre,
            COALESCE(c.estado, 'disponible'::text) AS chofer_estado,
            cd.telefono AS chofer_telefono,
            c.foto,
            u.id AS unidad_id,
            UPPER(TRIM(BOTH FROM COALESCE(t.patente, ''::text))) AS tractor,
            UPPER(TRIM(BOTH FROM COALESCE(s.patente, ''::text))) AS semi,
            s.cisternado,
            COALESCE(u.n_ute, 'S/D'::text) AS n_ute,
            UPPER(TRIM(BOTH FROM COALESCE(sc.denominacion, su.denominacion, 'S/A'::text))) AS srv,
            UPPER(TRIM(BOTH FROM COALESCE(sc.denominacion, su.denominacion, 'S/A'::text))) AS servicio,
            c.servicio_id AS servicio_chofer_id,
            CASE WHEN tn.codigo = 'LIBRES' THEN COALESCE(term.codigo, '') ELSE '' END AS terminal,
            CASE WHEN tn.codigo = 'LIBRES' THEN n.terminal_id ELSE NULL::uuid END AS terminal_id,
            CASE WHEN tn.codigo = 'LIBRES' THEN term.nombre ELSE NULL::text END AS terminal_nombre,
            COALESCE((
                SELECT array_agg(m.usuario_nombre)
                FROM public.dash_menciones m
                WHERE m.novedad_id = n.id
            ), ARRAY[]::text[]) AS menciones
         FROM public.novedades n
         JOIN public.tipos_novedad tn ON n.tipo_novedad_id = tn.id
         LEFT JOIN public.choferes c ON n.chofer_id = c.id
         LEFT JOIN public.servicios_choferes sc ON c.servicio_id = sc.id
         LEFT JOIN public.chofer_documentacion cd ON cd.chofer_id = c.id
         LEFT JOIN public.unidades u ON n.unidad_id = u.id
         LEFT JOIN public.tractores t ON u.tractor_id = t.id
         LEFT JOIN public.semis s ON u.semi_id = s.id
         LEFT JOIN public.servicios_unidades su ON u.servicio_id = su.id
         LEFT JOIN public.terminales term ON n.terminal_id = term.id
         LEFT JOIN public.dash d_user ON n.creado_por_id = d_user.id
         WHERE n.id = $1::bigint
         LIMIT 1`,
        [idNovedad]
    );
    return fallbackRes.rows[0] || null;
}

function sincronizarEspejoRamLocal(cacheDatosGlobales, card) {
    if (!cacheDatosGlobales || !card) return;
    if (!Array.isArray(cacheDatosGlobales.novedades)) cacheDatosGlobales.novedades = [];
    const idx = cacheDatosGlobales.novedades.findIndex(n => String(n.id) === String(card.id));
    if (idx > -1) {
        cacheDatosGlobales.novedades[idx] = card;
    } else {
        cacheDatosGlobales.novedades.unshift(card);
    }
}

// ==============================================================
// 1. CARGA E INSPECCIÓN DE NOVEDADES (DESDE POSTGRESQL)
// ==============================================================
async function cargarNovedades(_fetchRango, _ID_SPREADSHEET_MASTER, cacheDatosGlobales) {
    if (!db.isConfigured()) return false;
    try {
        const { rows } = await db.query(
            `SELECT * FROM public.view_cards_diarias
             ORDER BY fecha DESC NULLS LAST, creado_el DESC
             LIMIT 200`
        );
        if (cacheDatosGlobales) {
            cacheDatosGlobales.novedades = rows || [];
        }
        return true;
    } catch (e) {
        console.error("⚠️ [Novedades] Error cargando espejo desde PostgreSQL:", e.message);
        return false;
    }
}

async function enriquecerNovedadesConFlota() {
    // Las vistas relacionales view_dash_novedades / view_cards_diarias enriquecen por JOIN en tiempo real
    return false;
}

function iniciarPollingNovedades() {
    // Polling legacy sobre Google Sheets deprecado: todo corre reactivamente sobre PostgreSQL + Socket.IO
    return null;
}

// ==============================================================
// 2. ENDPOINTS DE LA API (Router 100% PostgreSQL)
// ==============================================================
function createNovedadesRouter(cacheDatosGlobales, _io, ioDash, serviceAccountAuth, _ID_SPREADSHEET_MASTER, fetchRango) {
    const router = express.Router();
    const authSheets = serviceAccountAuth || sharedServiceAccountAuth;
    const rangoSheets = fetchRango || sharedFetchRango;

    // GET /api/novedades — Leer novedades desde PostgreSQL (view_cards_diarias o histórico completo)
    router.get('/', async (req, res) => {
        try {
            if (!db.isConfigured()) {
                return res.status(503).json({ success: false, error: 'PostgreSQL no configurado' });
            }

            if (req.query.historico === 'true') {
                const { rows } = await db.query(
                    `SELECT
                        n.id,
                        tn.codigo AS tipo_novedad,
                        tn.id AS tipo_novedad_id,
                        tn.titulo AS tipo_novedad_titulo,
                        n.fecha_objetivo,
                        n.fecha_resolucion,
                        n.detalle,
                        n.resuelto,
                        n.prioridad,
                        n.creado_el,
                        n.creado_el AS "timestamp",
                        COALESCE(d_user.nombre, 'DASH') AS creador,
                        c.id AS chofer_id,
                        UPPER(TRIM(COALESCE(c.nombre, ''))) AS nom,
                        u.id AS unidad_id,
                        UPPER(TRIM(COALESCE(t.patente, ''))) AS tractor,
                        COALESCE(u.n_ute, 'S/D') AS n_ute,
                        UPPER(TRIM(COALESCE(sc.denominacion, su.denominacion, 'S/A'))) AS srv,
                        CASE WHEN tn.codigo = 'LIBRES' THEN COALESCE(term.codigo, '') ELSE '' END AS terminal,
                        CASE WHEN tn.codigo = 'LIBRES' THEN n.terminal_id ELSE NULL::uuid END AS terminal_id
                     FROM public.novedades n
                     JOIN public.tipos_novedad tn ON n.tipo_novedad_id = tn.id
                     LEFT JOIN public.choferes c ON n.chofer_id = c.id
                     LEFT JOIN public.servicios_choferes sc ON c.servicio_id = sc.id
                     LEFT JOIN public.unidades u ON n.unidad_id = u.id
                     LEFT JOIN public.tractores t ON u.tractor_id = t.id
                     LEFT JOIN public.servicios_unidades su ON u.servicio_id = su.id
                     LEFT JOIN public.terminales term ON n.terminal_id = term.id
                     LEFT JOIN public.dash d_user ON n.creado_por_id = d_user.id
                     ORDER BY n.creado_el DESC
                     LIMIT 500`
                );
                return res.json({ success: true, count: rows.length, data: rows });
            }

            const { rows } = await db.query(
                `SELECT * FROM public.view_cards_diarias
                 ORDER BY fecha DESC NULLS LAST, creado_el DESC
                 LIMIT 200`
            );
            return res.json({ success: true, count: rows.length, data: rows });
        } catch (err) {
            console.error("❌ [Novedades] Error en GET /api/novedades:", err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /api/novedades/actualizar — Crear, Editar o Resolver en PostgreSQL
    router.post('/actualizar', async (req, res) => {
        try {
            if (!db.isConfigured()) {
                return res.status(503).json({ success: false, error: 'PostgreSQL no configurado' });
            }

            const { action, id_novedad, payload = {} } = req.body || {};

            if (action === 'nueva') {
                const tipoObj = await resolveTipoNovedad(payload);
                if (!tipoObj || !tipoObj.id) {
                    return res.status(400).json({ success: false, error: 'Clasificación de novedad inválida' });
                }

                const esLibre = tipoObj.codigo === 'LIBRES';
                const [terminalId, creadoPorId, { choferId, unidadId }] = await Promise.all([
                    resolveTerminalId(payload.terminal_id, payload.terminal, esLibre),
                    resolveCreadoPorId(payload.creado_por_id, payload.creador || payload.usuario),
                    resolveChoferYUnidad(payload, cacheDatosGlobales)
                ]);

                const fechaObjClean = (payload.fecha_objetivo && String(payload.fecha_objetivo).trim() !== '')
                    ? String(payload.fecha_objetivo).split('T')[0].trim()
                    : null;
                const detalleClean = payload.detalle != null ? String(payload.detalle) : '';
                const prioridadClean = String(payload.prioridad || 'media').trim().toLowerCase();

                const insRes = await db.query(
                    `INSERT INTO public.novedades (
                        unidad_id,
                        chofer_id,
                        fecha_objetivo,
                        detalle,
                        resuelto,
                        prioridad,
                        creado_por_id,
                        terminal_id,
                        tipo_novedad_id,
                        creado_el,
                        actualizado_el
                    ) VALUES ($1, $2, $3::date, $4, false, $5, $6, $7, $8, NOW(), NOW())
                    RETURNING id`,
                    [
                        unidadId,
                        choferId,
                        fechaObjClean,
                        detalleClean,
                        prioridadClean,
                        creadoPorId,
                        terminalId,
                        tipoObj.id
                    ]
                );

                const newId = insRes.rows[0].id;
                const card = await obtenerCardEnriquecida(newId);
                sincronizarEspejoRamLocal(cacheDatosGlobales, card);

                if (ioDash) {
                    ioDash.emit('novedad_cambiada', { id: newId, action: 'nueva' });
                }

                // Disparador asíncrono de Notas Hover en Google Sheets Movimientos (por UUID -> imprime_nota_movimientos)
                const debeImprimirNota = Boolean(card?.imprime_nota_movimientos ?? tipoObj.imprime_nota_movimientos);
                if (debeImprimirNota && (card?.chofer_id || choferId) && (card?.fecha_objetivo || fechaObjClean)) {
                    queueSyncBajas({
                        action: 'crear',
                        id: newId,
                        tipo_novedad_id: card?.tipo_novedad_id || tipoObj.id,
                        tipo_novedad: card?.tipo_novedad || tipoObj.codigo,
                        tipo_novedad_titulo: card?.tipo_novedad_titulo || tipoObj.titulo,
                        chofer_id: card?.chofer_id || choferId,
                        chofer_nombre: card?.chofer_nombre || card?.nom || '',
                        fecha_objetivo: fechaObjClean || card?.fecha_objetivo,
                        detalle: detalleClean
                    });
                }

                return res.json({ success: true, data: card });
            }

            if (action === 'editar') {
                const idClean = String(id_novedad ?? '').trim();
                if (!/^\d+$/.test(idClean)) {
                    return res.status(400).json({ success: false, error: 'ID de novedad inválido' });
                }

                const existingRes = await db.query(
                    `SELECT n.*,
                            tn.codigo AS tipo_codigo,
                            tn.titulo AS tipo_titulo,
                            COALESCE(tn.imprime_nota_movimientos, false) AS prev_imprime_nota,
                            UPPER(TRIM(COALESCE(c_prev.nombre, ''))) AS prev_chofer_nombre,
                            TO_CHAR(n.fecha_objetivo, 'YYYY-MM-DD') AS prev_fecha_iso
                     FROM public.novedades n
                     JOIN public.tipos_novedad tn ON n.tipo_novedad_id = tn.id
                     LEFT JOIN public.choferes c_prev ON n.chofer_id = c_prev.id
                     WHERE n.id = $1::bigint
                     LIMIT 1`,
                    [idClean]
                );

                if (existingRes.rows.length === 0) {
                    return res.status(404).json({ success: false, error: 'No encontrada' });
                }

                const actual = existingRes.rows[0];
                let targetChoferId = actual.chofer_id;
                let targetUnidadId = actual.unidad_id;
                let targetTipoId = actual.tipo_novedad_id;
                let targetTipoCodigo = actual.tipo_codigo;
                let targetTipoTitulo = actual.tipo_titulo;
                let targetImprimeNota = Boolean(actual.prev_imprime_nota);
                let targetTerminalId = actual.terminal_id;

                const tieneCambioTipo = payload.tipo_novedad !== undefined || payload.tipo_novedad_id !== undefined || payload.tipo !== undefined;
                if (tieneCambioTipo) {
                    const resolvedTipo = await resolveTipoNovedad(payload);
                    if (resolvedTipo?.id) {
                        targetTipoId = resolvedTipo.id;
                        targetTipoCodigo = resolvedTipo.codigo;
                        targetTipoTitulo = resolvedTipo.titulo;
                        targetImprimeNota = Boolean(resolvedTipo.imprime_nota_movimientos);
                    }
                }

                const esLibre = targetTipoCodigo === 'LIBRES';
                if (!esLibre) {
                    targetTerminalId = null;
                } else if (payload.terminal !== undefined || payload.terminal_id !== undefined) {
                    targetTerminalId = await resolveTerminalId(payload.terminal_id, payload.terminal, true);
                }

                const tieneCambioActivos =
                    payload.chofer_id !== undefined ||
                    payload.unidad_id !== undefined ||
                    payload.nom !== undefined ||
                    payload.tractor !== undefined;

                if (tieneCambioActivos) {
                    const resolvedActivos = await resolveChoferYUnidad(payload, cacheDatosGlobales);
                    if (resolvedActivos.choferId) targetChoferId = resolvedActivos.choferId;
                    if (resolvedActivos.unidadId) targetUnidadId = resolvedActivos.unidadId;
                }

                const targetFechaObjetivo = payload.fecha_objetivo !== undefined
                    ? (payload.fecha_objetivo && String(payload.fecha_objetivo).trim() !== ''
                        ? String(payload.fecha_objetivo).split('T')[0].trim()
                        : null)
                    : actual.prev_fecha_iso;

                const targetDetalle = payload.detalle !== undefined
                    ? String(payload.detalle ?? '')
                    : actual.detalle;

                const targetPrioridad = payload.prioridad !== undefined
                    ? String(payload.prioridad || 'media').trim().toLowerCase()
                    : actual.prioridad;

                await db.query(
                    `UPDATE public.novedades
                     SET unidad_id = $1,
                         chofer_id = $2,
                         tipo_novedad_id = $3,
                         terminal_id = $4,
                         fecha_objetivo = $5::date,
                         detalle = $6,
                         prioridad = $7,
                         actualizado_el = NOW()
                     WHERE id = $8::bigint`,
                    [
                        targetUnidadId,
                        targetChoferId,
                        targetTipoId,
                        targetTerminalId,
                        targetFechaObjetivo,
                        targetDetalle,
                        targetPrioridad,
                        idClean
                    ]
                );

                // Si se solicitó cambio rápido de servicio sobre la card (asignarServicio en NoveltyCard)
                const rawSrv = payload.servicio || payload.srv;
                if (rawSrv && targetChoferId && !tieneCambioTipo) {
                    await actualizarServicioChoferSiCorresponde(targetChoferId, rawSrv, cacheDatosGlobales);
                }

                const card = await obtenerCardEnriquecida(idClean);
                sincronizarEspejoRamLocal(cacheDatosGlobales, card);

                if (ioDash) {
                    ioDash.emit('novedad_cambiada', { id: card ? card.id : idClean, action: 'editar' });
                }

                // Sincronización diferencial de Notas Hover (UUID tipos_novedad.imprime_nota_movimientos)
                const prevImprimia = Boolean(actual.prev_imprime_nota) && !actual.resuelto && Boolean(actual.chofer_id) && Boolean(actual.prev_fecha_iso);
                const nuevoImprime = Boolean(card?.imprime_nota_movimientos ?? targetImprimeNota) && !Boolean(card?.resuelto ?? actual.resuelto) && Boolean(targetChoferId) && Boolean(targetFechaObjetivo);

                if (prevImprimia && (!nuevoImprime || String(actual.chofer_id) !== String(targetChoferId))) {
                    limpiarTrackingNovedad(idClean);
                    queueSyncBajas({
                        action: 'limpiar',
                        id: Number(idClean),
                        chofer_id: actual.chofer_id,
                        chofer_nombre: actual.prev_chofer_nombre,
                        fecha_objetivo: actual.prev_fecha_iso
                    });
                } else if (prevImprimia && nuevoImprime && targetFechaObjetivo < actual.prev_fecha_iso) {
                    const desdeRecorte = sumarUnDiaIso(targetFechaObjetivo);
                    if (desdeRecorte && desdeRecorte <= actual.prev_fecha_iso) {
                        queueSyncBajas({
                            action: 'limpiar',
                            id: null,
                            chofer_id: actual.chofer_id,
                            chofer_nombre: actual.prev_chofer_nombre,
                            desde_fecha: desdeRecorte,
                            fecha_objetivo: actual.prev_fecha_iso
                        });
                    }
                }

                if (nuevoImprime) {
                    limpiarTrackingNovedad(idClean);
                    queueSyncBajas({
                        action: 'crear',
                        id: Number(idClean),
                        tipo_novedad_id: card?.tipo_novedad_id || targetTipoId,
                        tipo_novedad: card?.tipo_novedad || targetTipoCodigo,
                        tipo_novedad_titulo: card?.tipo_novedad_titulo || targetTipoTitulo,
                        chofer_id: targetChoferId,
                        chofer_nombre: card?.chofer_nombre || card?.nom || '',
                        fecha_objetivo: targetFechaObjetivo,
                        detalle: targetDetalle
                    });
                }

                return res.json({ success: true, data: card });
            }

            if (action === 'resolver') {
                const idClean = String(id_novedad ?? '').trim();
                if (!/^\d+$/.test(idClean)) {
                    return res.status(400).json({ success: false, error: 'ID de novedad inválido' });
                }

                const fechaResParam = (payload?.fecha_resolucion && String(payload.fecha_resolucion).trim() !== '')
                    ? String(payload.fecha_resolucion).trim()
                    : null;

                const updRes = await db.query(
                    `UPDATE public.novedades n
                     SET resuelto = true,
                         fecha_resolucion = COALESCE($2::timestamptz, NOW()),
                         actualizado_el = NOW()
                     FROM public.tipos_novedad tn
                     WHERE n.id = $1::bigint
                       AND n.tipo_novedad_id = tn.id
                     RETURNING n.id,
                               n.chofer_id,
                               n.unidad_id,
                               TO_CHAR(n.fecha_objetivo, 'YYYY-MM-DD') AS fecha_objetivo_iso,
                               COALESCE(tn.imprime_nota_movimientos, false) AS imprime_nota_movimientos`,
                    [idClean, fechaResParam]
                );

                if (updRes.rows.length === 0) {
                    return res.status(404).json({ success: false, error: 'No encontrada' });
                }

                const rowUpdated = updRes.rows[0];
                const rawServ = payload?.servicio ? String(payload.servicio).trim().toUpperCase() : null;

                if (rawServ && rowUpdated.chofer_id) {
                    await actualizarServicioChoferSiCorresponde(rowUpdated.chofer_id, rawServ, cacheDatosGlobales);
                }

                const card = await obtenerCardEnriquecida(idClean);
                sincronizarEspejoRamLocal(cacheDatosGlobales, card);

                if (ioDash) {
                    ioDash.emit('novedad_cambiada', { id: card ? card.id : idClean, action: 'resolver' });
                }

                res.json({ success: true, data: card });

                // Limpieza asíncrona de Notas Hover si la novedad resuelta tenía imprime_nota_movimientos = true
                if (rowUpdated.imprime_nota_movimientos && rowUpdated.chofer_id && rowUpdated.fecha_objetivo_iso) {
                    limpiarTrackingNovedad(rowUpdated.id);
                    queueSyncBajas({
                        action: 'limpiar',
                        id: rowUpdated.id,
                        chofer_id: rowUpdated.chofer_id,
                        chofer_nombre: card?.chofer_nombre || card?.nom || '',
                        fecha_objetivo: rowUpdated.fecha_objetivo_iso
                    });
                }

                // Inyección asíncrona no bloqueante en planilla Dispo cuando se resuelve asignando servicio
                if (rawServ && card) {
                    let dispoServicio = rawServ;
                    if (rawServ === 'EURO') dispoServicio = 'DOCK SUD';
                    if (rawServ === 'LIVIANO' || rawServ === 'LIV') dispoServicio = 'UTE';

                    inyectarServicioEnSheetDispo(card.tractor, card.nom, dispoServicio, authSheets, rangoSheets).catch(e => {
                        console.error("⚠️ [Dispo] Error asíncrono inyectando servicio:", e.message || e);
                    });
                }
                return;
            }

            return res.status(400).json({ success: false, error: `Acción no soportada: ${action}` });
        } catch (err) {
            console.error("❌ [Novedades] Error en POST /api/novedades/actualizar:", err.message);
            return res.status(500).json({ success: false, error: err.message || 'Error en servidor' });
        }
    });

    // POST /api/novedades/mencion — Agregar o quitar @mención en public.dash_menciones
    router.post('/mencion', async (req, res) => {
        try {
            if (!db.isConfigured()) {
                return res.status(503).json({ success: false, error: 'PostgreSQL no configurado' });
            }

            const { id_novedad, usuario, accion } = req.body || {};
            const idClean = String(id_novedad ?? '').trim();
            const uNorm = String(usuario ?? '').trim().toUpperCase();

            if (!/^\d+$/.test(idClean) || !uNorm || !accion) {
                return res.status(400).json({ success: false, error: 'Faltan campos requeridos' });
            }

            const existsRes = await db.query(
                `SELECT id FROM public.novedades WHERE id = $1::bigint LIMIT 1`,
                [idClean]
            );
            if (existsRes.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Novedad no encontrada' });
            }

            if (accion === 'agregar') {
                const usrRes = await db.query(
                    `SELECT id FROM public.dash WHERE UPPER(TRIM(nombre)) = $1 LIMIT 1`,
                    [uNorm]
                );
                const usuarioId = usrRes.rows[0]?.id || null;

                await db.query(
                    `INSERT INTO public.dash_menciones (novedad_id, usuario_id, usuario_nombre, mencionado_el)
                     VALUES ($1::bigint, $2::uuid, $3, NOW())
                     ON CONFLICT (novedad_id, usuario_nombre) DO NOTHING`,
                    [idClean, usuarioId, uNorm]
                );
            } else if (accion === 'quitar') {
                await db.query(
                    `DELETE FROM public.dash_menciones
                     WHERE novedad_id = $1::bigint
                       AND UPPER(TRIM(usuario_nombre)) = $2`,
                    [idClean, uNorm]
                );
            } else {
                return res.status(400).json({ success: false, error: 'Acción de mención inválida' });
            }

            const card = await obtenerCardEnriquecida(idClean);
            sincronizarEspejoRamLocal(cacheDatosGlobales, card);

            if (ioDash) {
                ioDash.emit('novedad_cambiada', { id: card ? card.id : idClean, action: 'mencion' });
            }

            return res.json({ success: true, data: card });
        } catch (err) {
            console.error("❌ [Novedades] Error en POST /api/novedades/mencion:", err.message);
            return res.status(500).json({ success: false, error: err.message || 'Error en servidor' });
        }
    });

    // POST /api/novedades/terminal — Asignar o limpiar terminal en public.novedades
    router.post('/terminal', async (req, res) => {
        try {
            if (!db.isConfigured()) {
                return res.status(503).json({ success: false, error: 'PostgreSQL no configurado' });
            }

            const { id_novedad, terminal, terminal_id } = req.body || {};
            const idClean = String(id_novedad ?? '').trim();
            if (!/^\d+$/.test(idClean)) {
                return res.status(400).json({ success: false, error: 'Id de novedad requerido' });
            }

            const resolvedTermId = await resolveTerminalId(terminal_id, terminal, true);

            const updRes = await db.query(
                `UPDATE public.novedades
                 SET terminal_id = $1::uuid,
                     actualizado_el = NOW()
                 WHERE id = $2::bigint
                 RETURNING id`,
                [resolvedTermId, idClean]
            );

            if (updRes.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Novedad no encontrada' });
            }

            const card = await obtenerCardEnriquecida(idClean);
            sincronizarEspejoRamLocal(cacheDatosGlobales, card);

            if (ioDash) {
                ioDash.emit('novedad_cambiada', { id: card ? card.id : idClean, action: 'terminal' });
            }

            return res.json({ success: true, data: card });
        } catch (err) {
            console.error("❌ [Novedades] Error en POST /api/novedades/terminal:", err.message);
            return res.status(500).json({ success: false, error: err.message || 'Error en servidor' });
        }
    });

    // POST /api/novedades/sync-bajas — Sincronización manual / programada de notas hover (BAJA_DIAGRAMA / UUID)
    router.post('/sync-bajas', async (req, res) => {
        try {
            const wait = req.query.wait === 'true' || req.body?.wait === true;
            const dryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;
            const forceRefresh = req.query.force === 'true' || req.body?.force === true;

            if (wait || dryRun) {
                const result = await syncBajasGoogleSheets(null, { dryRun, forceRefresh });
                return res.json({
                    ...result,
                    tracking: obtenerEstadoTrackingBajas()
                });
            }

            queueSyncBajas(null);
            return res.json({
                success: true,
                message: 'Sincronización de notas hover disparada en segundo plano',
                tracking: obtenerEstadoTrackingBajas()
            });
        } catch (err) {
            console.error("❌ [Novedades] Error en POST /api/novedades/sync-bajas:", err.message);
            return res.status(500).json({ success: false, error: err.message || 'Error en servidor' });
        }
    });

    // GET /api/novedades/sync-bajas/estado — Estado en vivo del Pending Days Watcher (SINCRONIZADO vs PENDIENTE_TIPEO)
    router.get('/sync-bajas/estado', (_req, res) => {
        try {
            const estado = obtenerEstadoTrackingBajas();
            return res.json({
                success: true,
                count: estado.length,
                data: estado
            });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message || 'Error en servidor' });
        }
    });

    return router;
}

module.exports = { cargarNovedades, enriquecerNovedadesConFlota, iniciarPollingNovedades, createNovedadesRouter };
