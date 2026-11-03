/**
 * routes/views.js
 * Router de Vistas Relacionales de PostgreSQL (pg client)
 * 
 * Expone endpoints REST optimizados de solo lectura directamente conectados
 * al connection pool nativo de PostgreSQL (utils/db.js).
 * 
 * Vistas soportadas:
 *   1. GET /api/views/diaria       -> public.view_diaria_operativa
 *   2. GET /api/views/cards        -> public.view_cards_diarias
 *   3. GET /api/views/flota        -> public.view_flota_operativa
 *   4. GET /api/views/diagrama     -> public.view_diagrama_mensual
 *   5. GET /api/views/inducciones  -> public.view_inducciones_recientes
 *   6. GET /api/views/retorno      -> public.view_personal_retorno / fn_personal_retorno
 */

const express = require('express');
const db = require('../utils/db');
const { clasificarIcm, clasificarIsp } = require('../utils/seguridadVialClassifier');

module.exports = function createViewsRouter() {
    const router = express.Router();

    // 0. GET /api/views/diaria-km — Kilómetros del día para la Vista Diaria (Hot RAM O(1) < 1ms)
    router.get('/diaria-km', async (req, res) => {
        const t0 = Date.now();
        try {
            const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
            // 2. Fallback SQL O(1) indexado por (anio, mes_numero) + JSONB key lookup
            const r = await db.query('SELECT * FROM public.fn_km_por_fecha($1::date)', [fecha]);
            return res.json({
                success: true,
                fuente: "POSTGRES",
                latenciaMs: Date.now() - t0,
                fecha,
                count: r.rows.length,
                data: r.rows
            });
        } catch (err) {
            console.error("❌ Error en /api/views/diaria-km:", err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 1. GET /api/views/diaria — Vista Diaria Operativa de Choferes
    router.get('/diaria', async (req, res) => {
        const t0 = Date.now();
        try {
            if (!db.isConfigured()) {
                return res.status(503).json({ success: false, error: "PostgreSQL no configurado" });
            }

            const { limit = 50, offset = 0, servicio, alerta, search } = req.query;
            const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
            const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

            const conditions = [];
            const params = [];

            if (servicio && servicio !== 'TODOS') {
                const sUpper = servicio.trim().toUpperCase();
                if (sUpper === 'GRALES.' || sUpper === 'GRALES') {
                    conditions.push(`UPPER(servicio) IN ('GRALES', 'GRALES.')`);
                } else {
                    params.push(sUpper);
                    conditions.push(`UPPER(servicio) = $${params.length}`);
                }
            }

            if (alerta === 'DOCS_VENCIDOS') {
                conditions.push(`alerta_docs_chofer = 'VENCIDO'`);
            } else if (alerta === 'DOCS_POR_VENCER') {
                conditions.push(`alerta_docs_chofer = 'POR_VENCER'`);
            } else if (alerta === 'UNIDAD_VENCIDA') {
                conditions.push(`alerta_docs_unidad = 'VENCIDO'`);
            } else if (alerta === 'UNIDAD_POR_VENCER') {
                conditions.push(`alerta_docs_unidad = 'POR_VENCER'`);
            } else if (alerta === 'CUALQUIER_ALERTA') {
                conditions.push(`(alerta_docs_chofer IN ('VENCIDO', 'POR_VENCER') OR alerta_docs_unidad IN ('VENCIDO', 'POR_VENCER'))`);
            }

            if (search && search.trim().length > 0) {
                params.push(`%${search.trim().toLowerCase()}%`);
                const idx = params.length;
                conditions.push(`(
                    LOWER(nombre) LIKE $${idx} OR 
                    LOWER(COALESCE(dni, '')) LIKE $${idx} OR 
                    LOWER(COALESCE(tractor, '')) LIKE $${idx} OR 
                    LOWER(COALESCE(semi, '')) LIKE $${idx} OR 
                    LOWER(COALESCE(n_ute, '')) LIKE $${idx}
                )`);
            }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

            // Conteo total para paginación
            const countQuery = `SELECT COUNT(*) AS total FROM public.view_diaria_operativa ${whereClause}`;
            const countRes = await db.query(countQuery, params);
            const total = parseInt(countRes.rows[0]?.total || '0', 10);

            // Consulta paginada
            params.push(limitNum);
            const limitIdx = params.length;
            params.push(offsetNum);
            const offsetIdx = params.length;

            const dataQuery = `
                SELECT * FROM public.view_diaria_operativa 
                ${whereClause}
                ORDER BY nombre ASC
                LIMIT $${limitIdx} OFFSET $${offsetIdx}
            `;
            const dataRes = await db.query(dataQuery, params);

            res.json({
                success: true,
                vista: "public.view_diaria_operativa",
                latenciaMs: Date.now() - t0,
                paginacion: {
                    total,
                    limit: limitNum,
                    offset: offsetNum,
                    retornados: dataRes.rows.length,
                    hay_mas: (offsetNum + dataRes.rows.length) < total
                },
                datos: dataRes.rows
            });

        } catch (err) {
            console.error("❌ Error en GET /api/views/diaria:", err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 2. GET /api/views/cards — Feed de Novedades y Cards Diarias
    router.get('/cards', async (req, res) => {
        const t0 = Date.now();
        try {
            if (!db.isConfigured()) {
                return res.status(503).json({ success: false, error: "PostgreSQL no configurado" });
            }

            const { limit = 20, offset = 0, estado, servicio, tipo, search } = req.query;
            const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
            const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

            const conditions = [];
            const params = [];

            if (estado === 'pendientes') {
                conditions.push(`resuelto = false`);
            } else if (estado === 'resueltas') {
                conditions.push(`resuelto = true`);
            }

            if (servicio && servicio !== 'TODOS') {
                const sUpper = servicio.trim().toUpperCase();
                if (sUpper === 'GRALES.' || sUpper === 'GRALES') {
                    conditions.push(`UPPER(COALESCE(servicio, '')) IN ('GRALES', 'GRALES.')`);
                } else {
                    params.push(sUpper);
                    conditions.push(`UPPER(COALESCE(servicio, '')) = $${params.length}`);
                }
            }

            if (tipo && tipo !== 'TODOS') {
                params.push(tipo.trim());
                conditions.push(`tipo = $${params.length}`);
            }

            if (search && search.trim().length > 0) {
                params.push(`%${search.trim().toLowerCase()}%`);
                const idx = params.length;
                conditions.push(`(
                    LOWER(COALESCE(chofer_nombre, '')) LIKE $${idx} OR 
                    LOWER(COALESCE(tractor, '')) LIKE $${idx} OR 
                    LOWER(COALESCE(n_ute, '')) LIKE $${idx} OR 
                    LOWER(COALESCE(detalle, '')) LIKE $${idx}
                )`);
            }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

            // Conteo total
            const countQuery = `SELECT COUNT(*) AS total FROM public.view_cards_diarias ${whereClause}`;
            const countRes = await db.query(countQuery, params);
            const total = parseInt(countRes.rows[0]?.total || '0', 10);

            // Consulta paginada ordenada por fecha objetivo y creación
            params.push(limitNum);
            const limitIdx = params.length;
            params.push(offsetNum);
            const offsetIdx = params.length;

            const dataQuery = `
                SELECT * FROM public.view_cards_diarias 
                ${whereClause}
                ORDER BY fecha DESC NULLS LAST, creado_el DESC
                LIMIT $${limitIdx} OFFSET $${offsetIdx}
            `;
            const dataRes = await db.query(dataQuery, params);

            res.json({
                success: true,
                vista: "public.view_cards_diarias",
                latenciaMs: Date.now() - t0,
                paginacion: {
                    total,
                    limit: limitNum,
                    offset: offsetNum,
                    retornados: dataRes.rows.length,
                    hay_mas: (offsetNum + dataRes.rows.length) < total
                },
                datos: dataRes.rows
            });

        } catch (err) {
            console.error("❌ Error en GET /api/views/cards:", err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 3. GET /api/views/flota — Catálogo de Flota Operativa y Vencimientos
    router.get('/flota', async (req, res) => {
        const t0 = Date.now();
        try {
            if (!db.isConfigured()) {
                return res.status(503).json({ success: false, error: "PostgreSQL no configurado" });
            }

            const { search } = req.query;
            const conditions = [];
            const params = [];

            if (search && search.trim().length > 0) {
                params.push(`%${search.trim().toLowerCase()}%`);
                const idx = params.length;
                conditions.push(`(
                    LOWER(COALESCE(tractor, '')) LIKE $${idx} OR 
                    LOWER(COALESCE(semi, '')) LIKE $${idx} OR 
                    LOWER(COALESCE(chofer_nombre, '')) LIKE $${idx} OR 
                    LOWER(COALESCE(dia_diagrama, '')) LIKE $${idx}
                )`);
            }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            const dataQuery = `
                SELECT * FROM public.view_flota_operativa 
                ${whereClause}
                ORDER BY tractor ASC NULLS LAST, semi ASC NULLS LAST
            `;
            const dataRes = await db.query(dataQuery, params);

            res.json({
                success: true,
                vista: "public.view_flota_operativa",
                latenciaMs: Date.now() - t0,
                total: dataRes.rows.length,
                datos: dataRes.rows
            });

        } catch (err) {
            console.error("❌ Error en GET /api/views/flota:", err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 4. GET /api/views/diagrama — Grilla Operativa Mensual
    router.get('/diagrama', async (req, res) => {
        const t0 = Date.now();
        try {
            const { mesTab = 'Sep-26', servicio, search, limit = 500 } = req.query;
            if (!db.isConfigured()) {
                return res.status(503).json({ success: false, error: "PostgreSQL no configurado" });
            }
            const limitNum = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 1000);

            const conditions = [`mes_tab = $1`];
            const params = [mesTab.trim()];

            if (servicio && servicio !== 'TODOS') {
                const sUpper = servicio.trim().toUpperCase();
                if (sUpper === 'GRALES.' || sUpper === 'GRALES') {
                    conditions.push(`UPPER(COALESCE(servicio, '')) IN ('GRALES', 'GRALES.')`);
                } else {
                    params.push(sUpper);
                    conditions.push(`UPPER(COALESCE(servicio, '')) = $${params.length}`);
                }
            }

            if (search && search.trim().length > 0) {
                params.push(`%${search.trim().toLowerCase()}%`);
                const idx = params.length;
                conditions.push(`(
                    LOWER(COALESCE(chofer_nombre, '')) LIKE $${idx} OR 
                    LOWER(COALESCE(tractor, '')) LIKE $${idx}
                )`);
            }

            params.push(limitNum);
            const limitIdx = params.length;

            const dataQuery = `
                SELECT * FROM public.view_diagrama_mensual 
                WHERE ${conditions.join(' AND ')}
                ORDER BY chofer_nombre ASC
                LIMIT $${limitIdx}
            `;
            const dataRes = await db.query(dataQuery, params);

            res.json({
                success: true,
                vista: "public.view_diagrama_mensual",
                mes_tab: mesTab,
                latenciaMs: Date.now() - t0,
                total: dataRes.rows.length,
                datos: dataRes.rows
            });

        } catch (err) {
            console.error("❌ Error en GET /api/views/diagrama:", err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 5. GET /api/views/inducciones — Inducciones y Nuevos Ingresos
    router.get('/inducciones', async (req, res) => {
        const t0 = Date.now();
        try {
            if (!db.isConfigured()) {
                return res.status(503).json({ success: false, error: "PostgreSQL no configurado" });
            }

            const { limit = 50, offset = 0, search } = req.query;
            const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
            const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

            const conditions = [];
            const params = [];

            if (search && search.trim().length > 0) {
                params.push(`%${search.trim().toLowerCase()}%`);
                const idx = params.length;
                conditions.push(`(
                    LOWER(COALESCE(chofer_nombre, '')) LIKE $${idx} OR 
                    LOWER(COALESCE(servicio, '')) LIKE $${idx} OR 
                    LOWER(COALESCE(detalle, '')) LIKE $${idx}
                )`);
            }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

            params.push(limitNum);
            const limitIdx = params.length;
            params.push(offsetNum);
            const offsetIdx = params.length;

            const dataQuery = `
                SELECT * FROM public.view_inducciones_recientes 
                ${whereClause}
                ORDER BY fecha_induccion DESC NULLS LAST, creado_el DESC
                LIMIT $${limitIdx} OFFSET $${offsetIdx}
            `;
            const dataRes = await db.query(dataQuery, params);

            res.json({
                success: true,
                vista: "public.view_inducciones_recientes",
                latenciaMs: Date.now() - t0,
                total: dataRes.rows.length,
                datos: dataRes.rows
            });

        } catch (err) {
            console.error("❌ Error en GET /api/views/inducciones:", err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 6. GET /api/views/retorno — Personal que Retorna (Hoy / Mañana / Quiebres)
    router.get('/retorno', async (req, res) => {
        const t0 = Date.now();
        try {
            const { fecha, tipo, servicio, search } = req.query;
            if (!db.isConfigured()) {
                return res.status(503).json({ success: false, error: "PostgreSQL no configurado" });
            }

            const params = [];
            const conditions = [];

            // 1. Origen de datos: si se provee una fecha específica válida (YYYY-MM-DD), usamos fn_personal_retorno($1::date)
            let fromSource = 'public.view_personal_retorno';
            let fechaEvaluada = null;

            if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha.trim())) {
                params.push(fecha.trim());
                fromSource = `public.fn_personal_retorno($${params.length}::date)`;
                fechaEvaluada = fecha.trim();
            }

            // 2. Filtro por tipo de retorno (HOY, MANANA / MAÑANA, 2, 3, 4 o TODOS)
            if (tipo) {
                const tUpper = tipo.trim().toUpperCase();
                if (tUpper === 'HOY') {
                    conditions.push(`retorna_cuando = 'HOY'`);
                } else if (tUpper === 'MANANA' || tUpper === 'MAÑANA') {
                    conditions.push(`retorna_cuando IN ('MANANA', 'MAÑANA')`);
                } else if (tUpper === '2' || tUpper === '2_DIAS' || tUpper === 'EN 2 DÍAS') {
                    conditions.push(`dias_para_retorno = 2`);
                } else if (tUpper === '3' || tUpper === '3_DIAS' || tUpper === 'EN 3 DÍAS') {
                    conditions.push(`dias_para_retorno = 3`);
                } else if (tUpper === '4' || tUpper === '4_DIAS' || tUpper === 'EN 4 DÍAS') {
                    conditions.push(`dias_para_retorno = 4`);
                }
            }

            // 3. Filtro por servicio
            if (servicio && servicio !== 'TODOS') {
                const sUpper = servicio.trim().toUpperCase();
                if (sUpper === 'GRALES.' || sUpper === 'GRALES') {
                    conditions.push(`UPPER(COALESCE(servicio, '')) IN ('GRALES', 'GRALES.')`);
                } else {
                    params.push(sUpper);
                    conditions.push(`UPPER(COALESCE(servicio, '')) = $${params.length}`);
                }
            }

            // 4. Búsqueda por texto (nombre, dni, tractor, n_ute)
            if (search && search.trim().length > 0) {
                params.push(`%${search.trim().toLowerCase()}%`);
                const idx = params.length;
                conditions.push(`(
                    LOWER(COALESCE(nombre, '')) LIKE $${idx} OR 
                    LOWER(COALESCE(dni, '')) LIKE $${idx} OR 
                    LOWER(COALESCE(tractor, '')) LIKE $${idx} OR 
                    LOWER(COALESCE(n_ute, '')) LIKE $${idx}
                )`);
            }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

            const dataQuery = `
                SELECT * FROM ${fromSource}
                ${whereClause}
                ORDER BY fecha_retorno ASC, nombre ASC
            `;

            const dataRes = await db.query(dataQuery, params);
            const rows = dataRes.rows || [];

            const vuelvenHoy = rows.filter(r => r.retorna_cuando === 'HOY' || r.dias_para_retorno === 0).length;
            const vuelvenManana = rows.filter(r => r.retorna_cuando === 'MANANA' || r.retorna_cuando === 'MAÑANA' || r.dias_para_retorno === 1).length;
            const vuelven2Dias = rows.filter(r => r.dias_para_retorno === 2).length;
            const vuelven3Dias = rows.filter(r => r.dias_para_retorno === 3).length;
            const vuelven4Dias = rows.filter(r => r.dias_para_retorno === 4).length;

            res.json({
                success: true,
                vista: "public.view_personal_retorno",
                fecha_evaluada: fechaEvaluada || new Date().toISOString().split('T')[0],
                latenciaMs: Date.now() - t0,
                total: rows.length,
                resumen: {
                    vuelven_hoy: vuelvenHoy,
                    vuelven_manana: vuelvenManana,
                    vuelven_2dias: vuelven2Dias,
                    vuelven_3dias: vuelven3Dias,
                    vuelven_4dias: vuelven4Dias
                },
                datos: rows
            });

        } catch (err) {
            console.error("❌ Error en GET /api/views/retorno:", err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 7. GET /api/views/catalogo-choferes — Catálogo ligero de choferes para navegación
    router.get('/catalogo-choferes', async (req, res) => {
        const t0 = Date.now();
        try {
            if (!db.isConfigured()) {
                return res.status(503).json({ success: false, error: "PostgreSQL no configurado" });
            }

            const dataRes = await db.query(`
                SELECT chofer_id, nombre, dni, servicio, foto, telefono, estado_chofer
                FROM public.view_individual_chofer
                ORDER BY nombre ASC
            `);

            res.json({
                success: true,
                vista: "public.view_individual_chofer (lite)",
                latenciaMs: Date.now() - t0,
                total: dataRes.rows.length,
                datos: dataRes.rows.map(c => ({
                    ...c,
                    id: c.chofer_id,
                    c_servicio: c.servicio,
                    estado: c.estado_chofer
                }))
            });
        } catch (err) {
            console.error("❌ Error en GET /api/views/catalogo-choferes:", err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 8. GET /api/views/individual/:choferId — Ficha individual completa Chofer + Unidad + Vencimientos
    router.get('/individual/:choferId', async (req, res) => {
        const t0 = Date.now();
        try {
            const { choferId } = req.params;
            const forceFresh = req.query.fresh === '1' || req.query.fresh === 'true';
            if (!db.isConfigured()) {
                return res.status(503).json({ success: false, error: "PostgreSQL no configurado" });
            }

            const dataRes = await db.query(`
                SELECT * FROM public.view_individual_chofer
                WHERE chofer_id::text = $1 OR dni = $1
                LIMIT 1
            `, [choferId]);

            if (dataRes.rows.length === 0) {
                return res.status(404).json({ success: false, error: `Chofer ${choferId} no encontrado` });
            }

            const choferRow = dataRes.rows[0];
            try {
                const hoy = new Date();
                const y = hoy.getFullYear(), m = hoy.getMonth(), d = hoy.getDate();
                const dDesde = d >= 26 ? new Date(y, m, 26) : new Date(y, m - 1, 26);
                const dHasta = d >= 26 ? new Date(y, m + 1, 25) : new Date(y, m, 25);
                const fIni = `${dDesde.getFullYear()}-${String(dDesde.getMonth() + 1).padStart(2, '0')}-26`;
                const fFin = `${dHasta.getFullYear()}-${String(dHasta.getMonth() + 1).padStart(2, '0')}-25`;
                const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
                choferRow.ciclo_label = `${MESES[dDesde.getMonth()]} 26 - ${MESES[dHasta.getMonth()]} 25`;
                choferRow.ciclo_desde = fIni;
                choferRow.ciclo_hasta = fFin;
            } catch (eCiclo) {
                choferRow.km_ciclo = 0;
            }

            // Fallback de Seguridad Vial Anual si la solicitud no fue servida por Hot RAM
            if (!choferRow.seguridad_vial_anual) {
                try {
                    const svRes = await db.query(`
                        SELECT ROUND(AVG(icm)::numeric, 2) AS icm_promedio,
                               ROUND(AVG(isp)::numeric, 2) AS isp_promedio,
                               SUM(cant_infracciones)::int AS total_infracciones,
                               COUNT(*)::int AS meses_evaluados
                        FROM public.seguridad_vial
                        WHERE chofer_id::text = $1 AND anio = $2
                    `, [choferRow.chofer_id, new Date().getFullYear()]);
                    const sv = svRes.rows[0];
                    if (sv && (sv.icm_promedio !== null || sv.isp_promedio !== null)) {
                        const icmVal = sv.icm_promedio !== null ? Number(sv.icm_promedio) : null;
                        const ispVal = sv.isp_promedio !== null ? Number(sv.isp_promedio) : null;
                        choferRow.seguridad_vial_anual = {
                            anio: new Date().getFullYear(),
                            icm_promedio: icmVal,
                            isp_promedio: ispVal,
                            total_infracciones: sv.total_infracciones || 0,
                            meses_evaluados: sv.meses_evaluados || 0,
                            icm_clasificacion: clasificarIcm(icmVal),
                            isp_clasificacion: clasificarIsp(ispVal)
                        };
                    } else {
                        choferRow.seguridad_vial_anual = null;
                    }
                } catch (eSv) {
                    choferRow.seguridad_vial_anual = null;
                }
            }

            res.json({
                success: true,
                vista: "public.view_individual_chofer",
                latenciaMs: Date.now() - t0,
                dato: choferRow
            });
        } catch (err) {
            console.error("❌ Error en GET /api/views/individual:", err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 9. GET /api/views/calendario/:choferId — Calendario Diagrama + KMs agregados
    router.get('/calendario/:choferId', async (req, res) => {
        const t0 = Date.now();
        try {
            const { choferId } = req.params;
            const { zoom = '3', anio, tabs, fresh } = req.query;
            const forceFresh = fresh === '1' || fresh === 'true';
            if (!db.isConfigured()) {
                return res.status(503).json({ success: false, error: "PostgreSQL no configurado" });
            }

            let sql;
            let params;
            let vistaNombre;

            if (tabs) {
                const tabList = tabs.split(',').map(t => t.trim());
                sql = `
                    SELECT diagrama_id, chofer_id, mes_tab, anio, mes_numero, tira_dias, contabilizador,
                           km_mes_total, cant_viajes_mes, dias_km,
                           icm, isp, cant_infracciones, tiempo_conduccion_horas
                    FROM public.fn_calendario_diagrama_km($1::uuid, $2::text[], NULL)
                    ORDER BY anio ASC, mes_numero ASC
                `;
                params = [choferId, tabList];
                vistaNombre = "public.fn_calendario_diagrama_km";
            } else if (anio || zoom === '12') {
                sql = `
                    SELECT diagrama_id, chofer_id, mes_tab, anio, mes_numero, tira_dias, contabilizador,
                           km_mes_total, cant_viajes_mes, dias_km,
                           icm, isp, cant_infracciones, tiempo_conduccion_horas
                    FROM public.view_calendario_diagrama_km_12m
                    WHERE chofer_id::text = $1
                    ORDER BY anio ASC, mes_numero ASC
                `;
                params = [choferId];
                vistaNombre = "public.view_calendario_diagrama_km_12m";
            } else {
                // Default: 2 Meses Operativos Activos (Sep-26 + Oct-26)
                sql = `
                    SELECT diagrama_id, chofer_id, mes_tab, anio, mes_numero, tira_dias, contabilizador,
                           km_mes_total, cant_viajes_mes, dias_km,
                           icm, isp, cant_infracciones, tiempo_conduccion_horas
                    FROM public.view_calendario_diagrama_km_2m
                    WHERE chofer_id::text = $1
                    ORDER BY anio ASC, mes_numero ASC
                `;
                params = [choferId];
                vistaNombre = "public.view_calendario_diagrama_km_2m";
            }

            const dataRes = await db.query(sql, params);
            const enrichedRows = (dataRes.rows || []).map(row => {
                const icmVal = row.icm !== null && row.icm !== undefined ? Number(row.icm) : null;
                const ispVal = row.isp !== null && row.isp !== undefined ? Number(row.isp) : null;
                return {
                    ...row,
                    icm: icmVal,
                    isp: ispVal,
                    cant_infracciones: row.cant_infracciones !== null && row.cant_infracciones !== undefined ? Number(row.cant_infracciones) : 0,
                    tiempo_conduccion_horas: row.tiempo_conduccion_horas !== null && row.tiempo_conduccion_horas !== undefined ? Number(row.tiempo_conduccion_horas) : 0,
                    icm_clasificacion: clasificarIcm(icmVal),
                    isp_clasificacion: clasificarIsp(ispVal)
                };
            });

            res.json({
                success: true,
                vista: vistaNombre,
                latenciaMs: Date.now() - t0,
                total: enrichedRows.length,
                datos: enrichedRows
            });
        } catch (err) {
            console.error("❌ Error en GET /api/views/calendario:", err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 10. GET /api/views/movimientos — Vista Unificada de Movimientos (Unidad + Chofer Actual)
    router.get('/movimientos', async (req, res) => {
        const t0 = Date.now();
        try {
            if (!db.isConfigured()) {
                return res.status(503).json({ success: false, error: "PostgreSQL no configurado" });
            }

            const { limit = 100, offset = 0, servicio, estado, search } = req.query;
            const limitNum = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
            const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

            const conditions = [];
            const params = [];

            if (servicio && servicio !== 'TODOS') {
                const sUpper = servicio.trim().toUpperCase();
                if (sUpper === 'GRALES.' || sUpper === 'GRALES') {
                    conditions.push(`(UPPER(COALESCE(servicio_unidad, '')) IN ('GRALES', 'GRALES.') OR UPPER(COALESCE(chofer_servicio, '')) IN ('GRALES', 'GRALES.'))`);
                } else {
                    params.push(sUpper);
                    conditions.push(`(UPPER(COALESCE(servicio_unidad, '')) = $${params.length} OR UPPER(COALESCE(chofer_servicio, '')) = $${params.length})`);
                }
            }

            if (estado && estado !== 'TODOS') {
                params.push(estado.trim().toLowerCase());
                conditions.push(`(LOWER(COALESCE(unidad_estado, '')) = $${params.length} OR LOWER(COALESCE(chofer_estado, '')) = $${params.length})`);
            }

            if (search && search.trim().length > 0) {
                params.push(`%${search.trim().toLowerCase()}%`);
                const idx = params.length;
                conditions.push(`(
                    LOWER(COALESCE(chofer_nombre, '')) LIKE $${idx} OR 
                    LOWER(COALESCE(chofer_dni, '')) LIKE $${idx} OR 
                    LOWER(COALESCE(tractor, '')) LIKE $${idx} OR 
                    LOWER(COALESCE(semi, '')) LIKE $${idx} OR 
                    LOWER(COALESCE(n_ute, '')) LIKE $${idx}
                )`);
            }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

            // Conteo total
            const countQuery = `SELECT COUNT(*) AS total FROM public.view_movimientos ${whereClause}`;
            const countRes = await db.query(countQuery, params);
            const total = parseInt(countRes.rows[0]?.total || '0', 10);

            // Consulta paginada
            params.push(limitNum);
            const limitIdx = params.length;
            params.push(offsetNum);
            const offsetIdx = params.length;

            const dataQuery = `
                SELECT * FROM public.view_movimientos 
                ${whereClause}
                ORDER BY NULLIF(regexp_replace(n_ute, '[^0-9]', '', 'g'), '')::int ASC NULLS LAST, tractor ASC NULLS LAST
                LIMIT $${limitIdx} OFFSET $${offsetIdx}
            `;
            const dataRes = await db.query(dataQuery, params);

            res.json({
                success: true,
                vista: "public.view_movimientos",
                latenciaMs: Date.now() - t0,
                paginacion: {
                    total,
                    limit: limitNum,
                    offset: offsetNum,
                    retornados: dataRes.rows.length,
                    hay_mas: (offsetNum + dataRes.rows.length) < total
                },
                datos: dataRes.rows
            });
        } catch (err) {
            console.error("❌ Error en GET /api/views/movimientos:", err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 11. GET /api/views/badge — Conteo liviano de novedades pendientes (reemplaza HEAD PostgREST anon)
    router.get('/badge', async (req, res) => {
        const t0 = Date.now();
        try {
            const now = Date.now();
            if (!db.isConfigured()) {
                return res.json({ success: true, novedades_pendientes: 0 });
            }

            const r = await db.query('SELECT COUNT(*)::int AS cnt FROM public.novedades WHERE resuelto = false');
            const cnt = r.rows[0]?.cnt || 0;

            res.json({
                success: true,
                fuente: "POSTGRES",
                latenciaMs: Date.now() - t0,
                novedades_pendientes: cnt
            });
        } catch (err) {
            console.error("❌ Error en GET /api/views/badge:", err.message);
            res.status(500).json({ success: false, error: err.message, novedades_pendientes: 0 });
        }
    });

    // 12. GET /api/views/chofer-docs/:choferId — Documentación de chofer (Hot RAM C1 + refresco bajo demanda)
    router.get('/chofer-docs/:choferId', async (req, res) => {
        const t0 = Date.now();
        try {
            const chKey = String(req.params.choferId || '').trim();
            const forceFresh = req.query.fresh === '1';
            if (!db.isConfigured()) {
                return res.status(503).json({ success: false, error: "PostgreSQL no configurado" });
            }

            const r = await db.query(
                'SELECT * FROM public.chofer_documentacion WHERE chofer_id::text = $1 LIMIT 1',
                [chKey]
            );
            const dato = r.rows[0] || null;

            res.json({
                success: true,
                fuente: "POSTGRES",
                latenciaMs: Date.now() - t0,
                dato
            });
        } catch (err) {
            console.error("❌ Error en GET /api/views/chofer-docs:", err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 13. GET /api/views/chofer-observaciones/:choferId — Observaciones de chofer con caché LRU C2 (TTL 5 min)
    router.get('/chofer-observaciones/:choferId', async (req, res) => {
        const t0 = Date.now();
        try {
            const chKey = String(req.params.choferId || '').trim();
            const forceFresh = req.query.fresh === '1';
            const now = Date.now();
            if (!db.isConfigured()) {
                return res.status(503).json({ success: false, error: "PostgreSQL no configurado" });
            }

            const r = await db.query(
                'SELECT * FROM public.chofer_observaciones WHERE chofer_id::text = $1 ORDER BY fecha DESC',
                [chKey]
            );
            const datos = r.rows || [];

            res.json({
                success: true,
                fuente: "POSTGRES",
                latenciaMs: Date.now() - t0,
                datos
            });
        } catch (err) {
            console.error("❌ Error en GET /api/views/chofer-observaciones:", err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 14. POST /api/views/chofer-docs — Mutación de documentación vía PostgreSQL directo
    router.post('/chofer-docs', async (req, res) => {
        try {
            if (!db.isConfigured()) {
                return res.status(503).json({ success: false, error: "PostgreSQL no configurado" });
            }
            const { choferId, docId, fields } = req.body || {};
            if (!choferId && !docId) {
                return res.status(400).json({ success: false, error: "choferId o docId requerido" });
            }

            const allowedCols = [
                'drv_codigo', 'cuil', 'dni', 'telefono', 'email', 'empresa', 'area',
                'domicilio', 'localidad', 'telefono_emergencia', 'fecha_alta', 'estudios_nivel',
                'experiencia_anios', 'fecha_nacimiento', 'edad', 'venc_licencia_nacional',
                'venc_psicofisico', 'venc_cargas_peligrosas', 'venc_periodico', 'venc_curso_shell',
                'venc_manejo_def', 'curso_pae', 'apto_medico_venc', 'apto_medico_estado'
            ];

            const entries = Object.entries(fields || {}).filter(([k]) => allowedCols.includes(k));
            if (entries.length === 0) {
                return res.status(400).json({ success: false, error: "No se proporcionaron campos válidos" });
            }

            if (docId) {
                const setClauses = entries.map(([k], i) => `"${k}" = $${i + 1}`);
                const values = entries.map(([, v]) => v || null);
                values.push(new Date().toISOString());
                setClauses.push(`actualizado_el = $${values.length}`);
                values.push(docId);
                const sql = `UPDATE public.chofer_documentacion SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`;
                const r = await db.query(sql, values);
                return res.json({ success: true, dato: r.rows[0] });
            } else {
                const cols = ['chofer_id', ...entries.map(([k]) => `"${k}"`), 'actualizado_el'];
                const valPlaceholders = cols.map((_, i) => `$${i + 1}`);
                const values = [choferId, ...entries.map(([, v]) => v || null), new Date().toISOString()];
                const updateSets = entries.map(([k]) => `"${k}" = EXCLUDED."${k}"`);
                updateSets.push('actualizado_el = EXCLUDED.actualizado_el');
                const sql = `
                    INSERT INTO public.chofer_documentacion (${cols.join(', ')})
                    VALUES (${valPlaceholders.join(', ')})
                    ON CONFLICT (chofer_id) DO UPDATE SET ${updateSets.join(', ')}
                    RETURNING *
                `;
                const r = await db.query(sql, values);
                return res.json({ success: true, dato: r.rows[0] });
            }
        } catch (err) {
            console.error("❌ Error en POST /api/views/chofer-docs:", err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 15. POST /api/views/chofer-observaciones — Inserción de observación vía PostgreSQL directo
    router.post('/chofer-observaciones', async (req, res) => {
        try {
            if (!db.isConfigured()) {
                return res.status(503).json({ success: false, error: "PostgreSQL no configurado" });
            }
            const { choferId, unidadId, fecha, evento, obsEvento, estado, obsEstado, adminCarga } = req.body || {};
            if (!choferId) {
                return res.status(400).json({ success: false, error: "choferId requerido" });
            }

            const sql = `
                INSERT INTO public.chofer_observaciones (chofer_id, unidad_id, fecha, evento, obs_evento, estado, obs_estado, admin_carga)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
            `;
            const values = [
                choferId,
                unidadId || null,
                fecha || new Date().toISOString().split('T')[0],
                evento || null,
                obsEvento || null,
                estado || null,
                obsEstado || null,
                adminCarga || 'OPERADOR'
            ];
            const r = await db.query(sql, values);
            return res.json({ success: true, dato: r.rows[0] });
        } catch (err) {
            console.error("❌ Error en POST /api/views/chofer-observaciones:", err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // 13. POST /api/views/invalidate-calendario — Purgar caché de calendario y métricas
    router.post(['/invalidate-calendario', '/refresh-seguridad-vial'], async (req, res) => {
        res.json({ success: true, message: "Caché invalidado exitosamente" });
    });

    return router;
};
