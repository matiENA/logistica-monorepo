const express = require('express');
const db = require('../utils/db');
const { supabase, normalizar, mesesAbrev } = require('../utils/shared');

function parseMesTab(mesTab) {
    const parts = String(mesTab || '').trim().split('-');
    if (parts.length !== 2) return null;
    const mIdx = mesesAbrev.findIndex(m => m.toLowerCase() === parts[0].trim().toLowerCase());
    const yyDigits = parts[1].replace(/\D/g, '');
    if (mIdx === -1 || !yyDigits) return null;
    const anio = yyDigits.length <= 2 ? parseInt('20' + yyDigits.padStart(2, '0'), 10) : parseInt(yyDigits, 10);
    const mesNumero = mIdx + 1;
    const canonicalTab = `${mesesAbrev[mIdx]}-${String(anio).slice(-2)}`;
    return { mesTab: canonicalTab, anio, mesNumero };
}

/**
 * Motor Contabilizador Canónico de Días
 */
function getBaseState(val) {
    if (val === undefined || val === null) return '';
    const str = String(val).trim().toUpperCase();
    if (str.includes('+')) return str.split('+')[0].trim();
    return str;
}

function contabilizarDias(diasMap) {
    let trabajados = 0;
    let francos = 0;
    let vacaciones = 0;
    let ausencias = 0;
    let inactivos = 0;
    const desglose = {
        enfermedad: 0,
        art: 0,
        indisposicion: 0,
        suspension: 0,
        ausencia: 0,
        permiso: 0,
        otros: 0
    };

    const entries = Object.entries(diasMap || {});
    for (const [, val] of entries) {
        if (!val || val === '-' || val === '0' || val === 'NULL' || val === 'UNDEFINED') {
            inactivos++;
            continue;
        }

        const base = getBaseState(val);

        if ((!isNaN(base) && base !== '') || base === 'O' || base === 'OPERATIVO') {
            trabajados++;
        } else if (['F', 'FSF', 'FRANCO', 'RPT'].includes(base)) {
            francos++;
        } else if (['V', 'VSF', 'VACACIONES'].includes(base)) {
            vacaciones++;
        } else if (['E', 'ART', 'IND', 'IIND', 'A', 'S', 'P', 'MED', 'SUSP', 'LIC'].some(k => base.includes(k))) {
            ausencias++;
            if (base === 'E' || base.startsWith('MED')) desglose.enfermedad++;
            else if (base === 'ART') desglose.art++;
            else if (base.startsWith('IND')) desglose.indisposicion++;
            else if (base === 'S' || base.startsWith('SUSP')) desglose.suspension++;
            else if (base === 'A') desglose.ausencia++;
            else if (base === 'P') desglose.permiso++;
            else desglose.otros++;
        } else {
            desglose.otros++;
        }
    }

    return {
        total_evaluados: entries.length,
        trabajados,
        francos,
        vacaciones,
        ausencias,
        inactivos,
        desglose
    };
}

module.exports = function createDiagramasRouter() {
    const router = express.Router();

    // 1. GET /api/diagramas/parametros — Diccionario de parámetros
    router.get('/parametros', (req, res) => {
        res.json({
            servicio: "Consultas de Diagramas Bajo Demanda (Supabase)",
            descripcion: "Permite consultar cualquier rango de fechas histórico o futuro, evaluar el contabilizador canónico y filtrar por chofer, servicio o tipo de diagrama.",
            endpoints: [
                {
                    ruta: "GET /api/diagramas/consulta",
                    descripcion: "Consulta bajo demanda por rango de fechas arbitrario con cálculo dinámico del contabilizador.",
                    parametros: {
                        desde: { tipo: "String (YYYY-MM-DD)", requerido: true, descripcion: "Fecha inicial del rango.", ejemplo: "2026-08-01" },
                        hasta: { tipo: "String (YYYY-MM-DD)", requerido: true, descripcion: "Fecha final del rango (>= desde).", ejemplo: "2026-08-31" },
                        chofer: { tipo: "String", requerido: false, descripcion: "Filtro por nombre parcial o completo del chofer.", ejemplo: "ACUÑA" },
                        legajo: { tipo: "String", requerido: false, descripcion: "Filtro exacto por número de legajo.", ejemplo: "744" },
                        servicio: { tipo: "String", requerido: false, descripcion: "Filtro por servicio de flota.", opciones: ["METANOL", "LIVIANO", "CAMPO", "GLP"] },
                        diagrama_tipo: { tipo: "String", requerido: false, descripcion: "Filtro por esquema de rotación.", opciones: ["22X6", "14X7"] },
                        formato: { tipo: "String", requerido: false, default: "completo", opciones: ["completo", "resumido"] },
                        limit: { tipo: "Integer", requerido: false, descripcion: "Límite de resultados retornados para paginación." },
                        offset: { tipo: "Integer", requerido: false, default: 0, descripcion: "Salto de registros para paginación." }
                    }
                },
                {
                    ruta: "GET /api/diagramas/mes/:mesTab",
                    descripcion: "Obtiene los registros mensuales completos persistidos en la tabla Supabase 'diagramas'.",
                    parametros: {
                        mesTab: { tipo: "Path String", requerido: true, descripcion: "Pestaña mensual.", ejemplo: "Sep-26" },
                        servicio: { tipo: "Query String", requerido: false, descripcion: "Filtro por servicio." },
                        limit: { tipo: "Query Integer", requerido: false, default: 500, descripcion: "Límite de registros." }
                    }
                },
                {
                    ruta: "GET /api/diagramas/chofer/:idOrNombre",
                    descripcion: "Consulta el historial completo y JSON de un chofer específico por ID, Legajo o Nombre.",
                    parametros: {
                        idOrNombre: { tipo: "Path String", requerido: true, descripcion: "ID UUID, número de legajo o Nombre.", ejemplo: "ACUÑA RAFAEL SANTIAGO" }
                    }
                }
            ],
            contabilizador_reglas: {
                trabajados: "Números (1-35), 'O', 'OPERATIVO'",
                francos: "'F', 'FSF', 'FRANCO', 'RPT', 'F+...'",
                vacaciones: "'V', 'VSF', 'VACACIONES', 'V+...'",
                ausencias: "'E'/'MED' (enfermedad), 'ART', 'IND' (indisposición), 'S' (suspensión), 'A' (ausente), 'P' (permiso), 'LIC'",
                inactivos: "'-', '0', vacío",
                regla_modificador_plus: "Cualquier código con '+' (ej: F+1, E+23, O+30) se preserva textual en caracteres y cuenta estrictamente como 1 día en su categoría base."
            }
        });
    });

    // 2. GET /api/diagramas/consulta — Consulta dinámica por rango
    router.get('/consulta', async (req, res) => {
        try {
            const { desde, hasta, chofer, nombre, legajo, servicio, diagrama_tipo, tipo, formato, limit, limite, offset } = req.query;
            const choferFiltro = chofer || nombre;
            const diagramaFiltro = diagrama_tipo || tipo;
            const formatoVal = (formato || 'completo').toLowerCase();
            const limitParam = parseInt(limit || limite, 10);
            const offsetParam = parseInt(offset || '0', 10);

            if (!desde || !hasta) {
                return res.status(400).json({
                    error: "Debe proveer los parámetros de fecha obligatorios 'desde' y 'hasta' (formato YYYY-MM-DD).",
                    ejemplo: "/api/diagramas/consulta?desde=2026-08-01&hasta=2026-08-31&servicio=METANOL",
                    parametros_disponibles: ["desde", "hasta", "chofer", "legajo", "servicio", "diagrama_tipo", "formato", "limit", "offset"]
                });
            }

            const dCurrent = new Date(desde + 'T12:00:00');
            const dEnd = new Date(hasta + 'T12:00:00');
            if (isNaN(dCurrent.getTime()) || isNaN(dEnd.getTime()) || dCurrent > dEnd) {
                return res.status(400).json({ error: "Rango de fechas inválido. Formato requerido: YYYY-MM-DD y 'desde' <= 'hasta'." });
            }

            const diasRango = [];
            for (let d = new Date(dCurrent); d <= dEnd; d.setDate(d.getDate() + 1)) {
                diasRango.push(d.toISOString().split('T')[0]);
            }

            const t0 = Date.now();
            const ymPairs = [];
            const seenYm = new Set();
            for (const iso of diasRango) {
                const [yy, mm] = iso.split('-').map(Number);
                const key = `${yy}-${mm}`;
                if (!seenYm.has(key)) {
                    seenYm.add(key);
                    ymPairs.push({ anio: yy, mes: mm });
                }
            }

            let rowsDiag = [];
            if (db.isConfigured()) {
                const ymClauses = ymPairs.map((_, idx) => `(d.anio = $${idx * 2 + 1} AND d.mes_numero = $${idx * 2 + 2})`).join(' OR ');
                const ymParams = ymPairs.flatMap(p => [p.anio, p.mes]);
                const resC = await db.query(`
                    SELECT
                        c.id AS chofer_id,
                        c.nombre,
                        c.legajo,
                        COALESCE(s.denominacion, '') AS c_servicio,
                        d.diagrama_tipo,
                        d.anio,
                        d.mes_numero,
                        d.dias
                    FROM public.choferes c
                    INNER JOIN public.diagramas d ON d.chofer_id = c.id
                    LEFT JOIN public.servicios_choferes s ON s.id = c.servicio_id
                    WHERE (${ymClauses})
                    ORDER BY c.nombre ASC, d.anio ASC, d.mes_numero ASC
                `, ymParams);
                rowsDiag = resC.rows || [];
            } else {
                const { data, error } = await supabase
                    .from('diagramas')
                    .select('chofer_id, diagrama_tipo, anio, mes_numero, dias, choferes!inner(id, nombre, legajo, servicio_id, servicios_choferes(denominacion))')
                    .in('anio', [...new Set(ymPairs.map(p => p.anio))])
                    .in('mes_numero', [...new Set(ymPairs.map(p => p.mes))]);
                if (error) throw error;
                rowsDiag = (data || []).map(r => ({
                    chofer_id: r.chofer_id,
                    nombre: r.choferes?.nombre || '',
                    legajo: r.choferes?.legajo || null,
                    c_servicio: r.choferes?.servicios_choferes?.denominacion || '',
                    diagrama_tipo: r.diagrama_tipo,
                    anio: r.anio,
                    mes_numero: r.mes_numero,
                    dias: r.dias
                }));
            }

            // Agrupar por chofer consolidando los días de los meses consultados
            const porChofer = new Map();
            for (const row of rowsDiag) {
                if (!porChofer.has(row.chofer_id)) {
                    porChofer.set(row.chofer_id, {
                        id: row.chofer_id,
                        nombre: row.nombre,
                        legajo: row.legajo,
                        c_servicio: row.c_servicio,
                        diagrama_tipo: row.diagrama_tipo,
                        diasMerged: {}
                    });
                }
                const entry = porChofer.get(row.chofer_id);
                if (!entry.diagrama_tipo && row.diagrama_tipo) entry.diagrama_tipo = row.diagrama_tipo;
                if (row.dias && typeof row.dias === 'object') {
                    Object.assign(entry.diasMerged, row.dias);
                }
            }

            // Aplicar filtros
            let targetChoferes = Array.from(porChofer.values()).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
            if (choferFiltro) {
                const normFiltro = normalizar(choferFiltro);
                targetChoferes = targetChoferes.filter(c => normalizar(c.nombre).includes(normFiltro) || String(c.legajo) === choferFiltro);
            }
            if (legajo) {
                targetChoferes = targetChoferes.filter(c => String(c.legajo).trim() === String(legajo).trim());
            }
            if (servicio) {
                const srvUpper = servicio.trim().toUpperCase();
                targetChoferes = targetChoferes.filter(c => (c.c_servicio || '').toUpperCase() === srvUpper);
            }
            if (diagramaFiltro) {
                const diagUpper = diagramaFiltro.trim().toUpperCase();
                targetChoferes = targetChoferes.filter(c => (c.diagrama_tipo || '').toUpperCase() === diagUpper);
            }

            const totalCoincidencias = targetChoferes.length;

            let choferesPaginados = targetChoferes;
            if (!isNaN(offsetParam) && offsetParam > 0) choferesPaginados = choferesPaginados.slice(offsetParam);
            if (!isNaN(limitParam) && limitParam > 0) choferesPaginados = choferesPaginados.slice(0, limitParam);

            const resultados = [];
            for (const c of choferesPaginados) {
                const caracteresRango = {};
                diasRango.forEach(iso => {
                    caracteresRango[iso] = c.diasMerged[iso] || '-';
                });

                const contabilizadorRango = contabilizarDias(caracteresRango);

                const item = {
                    chofer_id: c.id,
                    nombre: c.nombre,
                    legajo: c.legajo,
                    servicio: c.c_servicio,
                    diagrama_tipo: c.diagrama_tipo,
                    contabilizador: contabilizadorRango
                };

                if (formatoVal !== 'resumido') {
                    item.caracteres = caracteresRango;
                }

                resultados.push(item);
            }

            const duracion = Date.now() - t0;
            res.json({
                success: true,
                fuente: 'SUPABASE_RESTO_CONSULTA',
                latenciaMs: `${duracion}ms`,
                parametros_aplicados: {
                    desde,
                    hasta,
                    total_dias: diasRango.length,
                    chofer: choferFiltro || null,
                    legajo: legajo || null,
                    servicio: servicio || null,
                    diagrama_tipo: diagramaFiltro || null,
                    formato: formatoVal,
                    limit: limitParam || null,
                    offset: offsetParam || 0
                },
                paginacion: {
                    total_registros: totalCoincidencias,
                    retornados: resultados.length,
                    offset: offsetParam || 0,
                    hay_mas: (!isNaN(limitParam) && limitParam > 0) ? (offsetParam + resultados.length < totalCoincidencias) : false
                },
                resultados
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 3. GET /api/diagramas/mes/:mesTab — Consulta directa de pestaña mensual en Supabase
    router.get('/mes/:mesTab', async (req, res) => {
        try {
            const { mesTab } = req.params;
            const { servicio, limit, limite } = req.query;
            const limitParam = parseInt(limit || limite || '500', 10);
            const t0 = Date.now();

            let rows = [];
            if (db.isConfigured()) {
                let sql = `
                    SELECT
                        d.*,
                        c.nombre AS chofer_nombre,
                        c.legajo,
                        COALESCE(s.denominacion, 'SIN SERVICIO') AS servicio
                    FROM public.diagramas d
                    INNER JOIN public.choferes c ON c.id = d.chofer_id
                    LEFT JOIN public.servicios_choferes s ON s.id = c.servicio_id
                    WHERE d.mes_tab = $1
                `;
                const params = [mesTab];
                if (servicio) {
                    sql += ' AND UPPER(COALESCE(s.denominacion, \'\')) = $2';
                    params.push(servicio.trim().toUpperCase());
                }
                sql += ' ORDER BY c.nombre ASC LIMIT $' + (params.length + 1);
                params.push(limitParam);

                const resSql = await db.query(sql, params);
                rows = resSql.rows || [];
            } else {
                const { data, error } = await supabase
                    .from('diagramas')
                    .select('*, choferes!inner(nombre, legajo, servicios_choferes(denominacion))')
                    .eq('mes_tab', mesTab)
                    .limit(limitParam);
                if (error) throw error;
                rows = (data || []).map(r => ({
                    ...r,
                    chofer_nombre: r.choferes?.nombre || '',
                    legajo: r.choferes?.legajo || null,
                    servicio: r.choferes?.servicios_choferes?.denominacion || 'SIN SERVICIO'
                }));
                if (servicio) {
                    const srvUpper = servicio.trim().toUpperCase();
                    rows = rows.filter(r => (r.servicio || '').toUpperCase() === srvUpper);
                }
                rows.sort((a, b) => (a.chofer_nombre || '').localeCompare(b.chofer_nombre || '', 'es'));
            }

            res.json({
                success: true,
                fuente: 'SUPABASE_TABLA_DIAGRAMAS',
                mes_tab: mesTab,
                servicio: servicio || 'TODOS',
                latenciaMs: `${Date.now() - t0}ms`,
                total: rows.length,
                diagramas: rows
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 4. GET /api/diagramas/chofer/:idOrNombre — Historial de un chofer específico
    router.get('/chofer/:idOrNombre', async (req, res) => {
        try {
            const { idOrNombre } = req.params;
            const norm = normalizar(idOrNombre);

            let chofer = null;
            let diagramasMeses = [];
            if (db.isConfigured()) {
                const resC = await db.query(`
                    SELECT c.*, COALESCE(s.denominacion, 'SIN SERVICIO') AS servicio
                    FROM public.choferes c
                    LEFT JOIN public.servicios_choferes s ON s.id = c.servicio_id
                    WHERE c.id::text = $1 OR c.legajo = $1 OR UPPER(c.nombre) ILIKE $2
                    LIMIT 1
                `, [idOrNombre, `%${idOrNombre}%`]);
                chofer = resC.rows[0] || null;
                if (chofer) {
                    const resD = await db.query(`
                        SELECT mes_tab, anio, mes_numero, diagrama_tipo, dias, tira_dias, contabilizador
                        FROM public.diagramas
                        WHERE chofer_id = $1
                        ORDER BY anio DESC, mes_numero DESC
                    `, [chofer.id]);
                    diagramasMeses = resD.rows || [];
                }
            } else {
                const { data, error } = await supabase
                    .from('choferes')
                    .select('*, servicios_choferes(denominacion)')
                    .or(`id.eq.${idOrNombre},legajo.eq.${idOrNombre},nombre.ilike.%${idOrNombre}%`)
                    .limit(1);
                if (error) throw error;
                chofer = data?.[0] || null;
                if (chofer) {
                    chofer.servicio = chofer.servicios_choferes?.denominacion || 'SIN SERVICIO';
                    const { data: dData } = await supabase
                        .from('diagramas')
                        .select('mes_tab, anio, mes_numero, diagrama_tipo, dias, tira_dias, contabilizador')
                        .eq('chofer_id', chofer.id)
                        .order('anio', { ascending: false })
                        .order('mes_numero', { ascending: false });
                    diagramasMeses = dData || [];
                }
            }

            if (!chofer) {
                return res.status(404).json({ success: false, error: `Chofer '${idOrNombre}' no encontrado.` });
            }

            res.json({
                success: true,
                fuente: 'SUPABASE_CHOFER_REGISTRO',
                chofer: {
                    id: chofer.id,
                    nombre: chofer.nombre,
                    legajo: chofer.legajo,
                    servicio: chofer.servicio,
                    diagrama_tipo: diagramasMeses[0]?.diagrama_tipo || null,
                    estado: chofer.estado,
                    contabilizador: diagramasMeses[0]?.contabilizador || null,
                    diagramas: diagramasMeses
                }
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 5. POST /api/diagramas/upsert — Upsert atómico de días por mes (C2 BFF -> C3 PostgreSQL -> eor_sync_queue)
    router.post('/upsert', async (req, res) => {
        try {
            const body = req.body || {};
            const choferId = body.choferId || body.chofer_id;
            const updatesPorMes = body.updatesPorMes || body.updates_por_mes;
            const mesTab = body.mesTab || body.mes_tab;
            const updates = body.updates;
            const usuario = body.usuario || body.actualizado_por;
            if (!choferId) {
                return res.status(400).json({ success: false, error: 'choferId es obligatorio.' });
            }

            const payloadMap = (updatesPorMes && typeof updatesPorMes === 'object')
                ? updatesPorMes
                : (mesTab && Array.isArray(updates) ? { [mesTab]: updates } : null);

            if (!payloadMap || Object.keys(payloadMap).length === 0) {
                return res.status(400).json({ success: false, error: 'Debe enviar updatesPorMes o mesTab + updates.' });
            }

            const usuarioActivo = String(usuario || 'OPERADOR').trim() || 'OPERADOR';
            const parsedEntries = [];
            for (const [rawTab, dayUpdates] of Object.entries(payloadMap)) {
                const parsed = parseMesTab(rawTab);
                if (!parsed) {
                    return res.status(400).json({ success: false, error: `mesTab inválido: '${rawTab}'. Formato esperado: 'Dic-26'.` });
                }
                if (!Array.isArray(dayUpdates) || dayUpdates.length === 0) continue;
                parsedEntries.push({ ...parsed, dayUpdates });
            }

            if (parsedEntries.length === 0) {
                return res.status(400).json({ success: false, error: 'No hay cambios de días para aplicar.' });
            }

            // Cargar registros preexistentes del chofer para los meses involucrados
            const existingMap = new Map();
            if (db.isConfigured()) {
                const ymClauses = parsedEntries.map((_, i) => `(anio = $${i * 2 + 2} AND mes_numero = $${i * 2 + 3})`).join(' OR ');
                const ymParams = [choferId, ...parsedEntries.flatMap(e => [e.anio, e.mesNumero])];
                const exRes = await db.query(
                    `SELECT id, mes_tab, anio, mes_numero, tira_dias, dias
                     FROM public.diagramas
                     WHERE chofer_id = $1::uuid AND (${ymClauses})`,
                    ymParams
                );
                for (const row of exRes.rows || []) {
                    existingMap.set(`${row.anio}-${row.mes_numero}`, row);
                }
            } else {
                const { data: exData, error: exErr } = await supabase
                    .from('diagramas')
                    .select('id, mes_tab, anio, mes_numero, tira_dias, dias')
                    .eq('chofer_id', choferId)
                    .in('anio', [...new Set(parsedEntries.map(e => e.anio))])
                    .in('mes_numero', [...new Set(parsedEntries.map(e => e.mesNumero))]);
                if (exErr) throw exErr;
                for (const row of exData || []) {
                    existingMap.set(`${row.anio}-${row.mes_numero}`, row);
                }
            }

            const actualizados = [];
            for (const entry of parsedEntries) {
                const { mesTab: canonicalTab, anio, mesNumero, dayUpdates } = entry;
                const daysInMonth = new Date(anio, mesNumero, 0).getDate();
                const mesStr = String(mesNumero).padStart(2, '0');
                const ex = existingMap.get(`${anio}-${mesNumero}`);

                let arr = [];
                if (ex?.tira_dias) {
                    arr = String(ex.tira_dias).split(',').map(v => v.trim() || '-');
                } else if (ex?.dias && typeof ex.dias === 'object') {
                    for (let d = 1; d <= daysInMonth; d++) {
                        const iso = `${anio}-${mesStr}-${String(d).padStart(2, '0')}`;
                        arr.push(String(ex.dias[iso] || '-').trim() || '-');
                    }
                }
                while (arr.length < daysInMonth) arr.push('-');
                if (arr.length > daysInMonth) arr = arr.slice(0, daysInMonth);

                for (const u of dayUpdates) {
                    const dNum = parseInt(u?.dia, 10);
                    if (dNum >= 1 && dNum <= daysInMonth) {
                        const valNorm = String(u?.valor ?? '-').trim().toUpperCase();
                        arr[dNum - 1] = valNorm || '-';
                    }
                }

                const diasMap = {};
                for (let d = 1; d <= daysInMonth; d++) {
                    const iso = `${anio}-${mesStr}-${String(d).padStart(2, '0')}`;
                    diasMap[iso] = arr[d - 1];
                }
                const nuevaTira = arr.join(',');
                const nuevoContabilizador = contabilizarDias(diasMap);

                if (db.isConfigured()) {
                    const upRes = await db.query(
                        `INSERT INTO public.diagramas (
                            chofer_id, mes_tab, anio, mes_numero, dias, tira_dias, contabilizador, actualizado_el, actualizado_por
                        ) VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7::jsonb, NOW(), $8)
                        ON CONFLICT (chofer_id, anio, mes_numero)
                        DO UPDATE SET
                            mes_tab = EXCLUDED.mes_tab,
                            dias = EXCLUDED.dias,
                            tira_dias = EXCLUDED.tira_dias,
                            contabilizador = EXCLUDED.contabilizador,
                            actualizado_el = NOW(),
                            actualizado_por = EXCLUDED.actualizado_por
                        RETURNING id AS diagrama_id, chofer_id, mes_tab, anio, mes_numero, tira_dias, contabilizador, actualizado_el`,
                        [choferId, canonicalTab, anio, mesNumero, JSON.stringify(diasMap), nuevaTira, JSON.stringify(nuevoContabilizador), usuarioActivo]
                    );
                    if (upRes.rows[0]) actualizados.push(upRes.rows[0]);
                } else {
                    const { data: upData, error: upErr } = await supabase
                        .from('diagramas')
                        .upsert({
                            chofer_id: choferId,
                            mes_tab: canonicalTab,
                            anio,
                            mes_numero: mesNumero,
                            dias: diasMap,
                            tira_dias: nuevaTira,
                            contabilizador: nuevoContabilizador,
                            actualizado_el: new Date().toISOString(),
                            actualizado_por: usuarioActivo
                        }, { onConflict: 'chofer_id,anio,mes_numero' })
                        .select('id, chofer_id, mes_tab, anio, mes_numero, tira_dias, contabilizador, actualizado_el');
                    if (upErr) throw upErr;
                    if (upData?.[0]) actualizados.push({ diagrama_id: upData[0].id, ...upData[0] });
                }
            }

            res.json({
                success: true,
                fuente: 'POSTGRES_UPSERT',
                actualizados
            });
        } catch (err) {
            console.error('❌ Error en POST /api/diagramas/upsert:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
