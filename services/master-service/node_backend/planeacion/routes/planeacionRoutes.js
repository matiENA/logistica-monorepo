"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPlaneacionRouter = createPlaneacionRouter;
const express_1 = require("express");
const zod_1 = require("zod");
const hotRamBaseService_js_1 = require("../services/hotRamBaseService.js");
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function extractActorContext(req) {
    const tallerId = req.headers['x-taller-user-id']
        ? String(req.headers['x-taller-user-id']).trim()
        : '';
    const coordId = req.headers['x-coordinacion-user-id']
        ? String(req.headers['x-coordinacion-user-id']).trim()
        : '';
    const genericId = req.headers['x-user-id'] ? String(req.headers['x-user-id']).trim() : '';
    const rawOrigen = req.headers['x-origen'] ? String(req.headers['x-origen']).trim().toLowerCase() : '';
    const origen = rawOrigen === 'coordinacion' || (Boolean(coordId) && !tallerId) ? 'coordinacion' : 'taller';
    const candidateId = origen === 'coordinacion' ? coordId || genericId : tallerId || genericId;
    const actorUsuarioId = UUID_REGEX.test(candidateId) ? candidateId : null;
    return { actorUsuarioId, origen };
}
/**
 * Jerarquía de permisos estricta (/db-render-arch):
 * Únicamente usuarios autenticados en base.user_coordinacion pueden ver/editar /coordinacion,
 * gestionar circuitos (Alta/Baja/Desunión) o eliminar registros (PREASIGNADO / notas).
 * Los usuarios de taller (base.usuarios_taller) tienen acceso denegado.
 */
async function requireCoordinacionAuth(req, res, actionLabel = 'ejecutar esta operación') {
    const coordId = req.headers['x-coordinacion-user-id']
        ? String(req.headers['x-coordinacion-user-id']).trim()
        : '';
    const tallerId = req.headers['x-taller-user-id']
        ? String(req.headers['x-taller-user-id']).trim()
        : '';
    const rawOrigen = req.headers['x-origen'] ? String(req.headers['x-origen']).trim().toLowerCase() : '';
    if (rawOrigen === 'taller' || (tallerId && !coordId)) {
        res.status(403).json({
            success: false,
            error: `Permiso denegado: usuarios_taller no tienen permiso para ${actionLabel}.`,
        });
        return null;
    }
    if (!coordId) {
        res.status(401).json({
            success: false,
            error: `Autenticación requerida: se requiere sesión activa de Coordinación (base.user_coordinacion) para ${actionLabel}.`,
        });
        return null;
    }
    if (!UUID_REGEX.test(coordId)) {
        res.status(403).json({
            success: false,
            error: `Permiso denegado: identificador de Coordinación inválido para ${actionLabel}.`,
        });
        return null;
    }
    const authorized = await hotRamBaseService_js_1.hotRamBaseService.isCoordinacionUserAuthorized(coordId);
    if (!authorized) {
        res.status(403).json({
            success: false,
            error: 'Permiso denegado: el usuario no pertenece a la jerarquía autorizada de Coordinación (base.user_coordinacion).',
        });
        return null;
    }
    return coordId;
}
async function requireTallerOrCoordinacionAuth(req, res, actionLabel = 'acceder a este recurso') {
    const coordId = req.headers['x-coordinacion-user-id']
        ? String(req.headers['x-coordinacion-user-id']).trim()
        : '';
    const tallerId = req.headers['x-taller-user-id']
        ? String(req.headers['x-taller-user-id']).trim()
        : '';
    const rawOrigen = req.headers['x-origen'] ? String(req.headers['x-origen']).trim().toLowerCase() : '';
    if (rawOrigen === 'coordinacion' || (coordId && !tallerId)) {
        const verifiedCoordId = await requireCoordinacionAuth(req, res, actionLabel);
        if (!verifiedCoordId)
            return null;
        return { role: 'coordinacion', userId: verifiedCoordId };
    }
    if (tallerId) {
        if (!UUID_REGEX.test(tallerId)) {
            res.status(403).json({
                success: false,
                error: `Permiso denegado: identificador de taller inválido para ${actionLabel}.`,
            });
            return null;
        }
        const authorized = await hotRamBaseService_js_1.hotRamBaseService.isTallerUserAuthorized(tallerId);
        if (!authorized) {
            res.status(403).json({
                success: false,
                error: 'Permiso denegado: el usuario no pertenece a la tabla autorizada base.usuarios_taller.',
            });
            return null;
        }
        return { role: 'taller', userId: tallerId };
    }
    res.status(401).json({
        success: false,
        error: `Autenticación requerida para ${actionLabel}.`,
    });
    return null;
}
function formatZodError(err, fallback = 'Datos de entrada inválidos.') {
    const flat = err.flatten();
    const parts = [];
    if (flat.formErrors.length > 0) {
        parts.push(...flat.formErrors);
    }
    for (const [field, messages] of Object.entries(flat.fieldErrors)) {
        if (Array.isArray(messages) && messages.length > 0) {
            parts.push(`${field}: ${messages.join(', ')}`);
        }
    }
    return parts.length > 0 ? parts.join(' | ') : fallback;
}
function sendRouteError(res, err, fallbackMessage) {
    if (err instanceof hotRamBaseService_js_1.ForbiddenError) {
        res.status(403).json({ success: false, error: err.message });
        return;
    }
    if (err instanceof hotRamBaseService_js_1.ConflictError) {
        res.status(409).json({ success: false, error: err.message });
        return;
    }
    if (err instanceof hotRamBaseService_js_1.NotFoundError) {
        res.status(404).json({ success: false, error: err.message });
        return;
    }
    const pgCode = err?.code;
    const msg = err instanceof Error ? err.message : fallbackMessage;
    if (pgCode === '23505' || msg.includes('CONFLICT:')) {
        res.status(409).json({
            success: false,
            error: msg.replace(/^CONFLICT:\s*/i, ''),
        });
        return;
    }
    res.status(500).json({
        success: false,
        error: msg,
    });
}
const llegadaSchema = zod_1.z.object({
    boxId: zod_1.z.string().uuid(),
    circuitoId: zod_1.z.string().uuid().nullable().optional(),
    unidadId: zod_1.z.string().uuid().nullable().optional(),
    tractorId: zod_1.z.string().uuid().nullable().optional(),
    semiId: zod_1.z.string().uuid().nullable().optional(),
    usuariosIds: zod_1.z.array(zod_1.z.string().uuid()).optional(),
    notaTexto: zod_1.z.string().max(1000).nullable().optional(),
    notaUsuarioId: zod_1.z.string().uuid().nullable().optional(),
});
const patchProcesoSchema = zod_1.z.object({
    boxId: zod_1.z.string().uuid().optional(),
    zoneId: zod_1.z.string().uuid().optional(),
    estado: zod_1.z.enum(['adentro', 'afuera']).nullable().optional(),
    usuariosIds: zod_1.z.array(zod_1.z.string().uuid()).optional(),
    targetEstado: zod_1.z.enum(['LLEGADA', 'INICIO']).optional(),
    action: zod_1.z.enum([
        'INICIAR',
        'FINALIZAR',
        'REABRIR',
        'DESHACER_INICIO',
        'DESHACER',
        'REVERTIR_A_HOLD',
        'REINTEGRAR_A_PREASIGNADO',
        'ARCHIVAR',
    ]).optional(),
});
const notaSchema = zod_1.z.object({
    usuarioId: zod_1.z.string().uuid().nullable().optional(),
    usuario_id: zod_1.z.string().uuid().nullable().optional(),
    usuario: zod_1.z.string().nullable().optional(),
    location: zod_1.z.string().nullable().optional(),
    texto: zod_1.z.string().trim().min(1).max(1000),
});
const createHoldSchema = zod_1.z.object({
    zoneId: zod_1.z.string().uuid(),
    boxId: zod_1.z.string().uuid().nullable().optional(),
    circuitoId: zod_1.z.string().uuid().nullable().optional(),
    unidadId: zod_1.z.string().uuid().nullable().optional(),
    tractorId: zod_1.z.string().uuid().nullable().optional(),
    semiId: zod_1.z.string().uuid().nullable().optional(),
    orden: zod_1.z.number().min(0).optional(),
    usuariosIds: zod_1.z.array(zod_1.z.string().uuid()).optional(),
    notaPlanificacion: zod_1.z.string().max(1000).nullable().optional(),
    procesoOrigenId: zod_1.z.string().uuid().nullable().optional(),
});
const altaCircuitoSchema = zod_1.z.object({
    unidadId: zod_1.z.string().uuid().nullable().optional(),
    tractorId: zod_1.z.string().uuid().nullable().optional(),
    semiId: zod_1.z.string().uuid().nullable().optional(),
    tractorN: zod_1.z.string().max(100).nullable().optional(),
    semiN: zod_1.z.string().max(100).nullable().optional(),
    notaTexto: zod_1.z.string().max(1000).nullable().optional(),
});
const desunirCircuitoSchema = zod_1.z.object({
    mantenerEn: zod_1.z.enum(['TRACTOR', 'SEMI']).optional(),
});
const patchHoldSchema = zod_1.z.object({
    zoneId: zod_1.z.string().uuid().optional(),
    boxId: zod_1.z.string().uuid().nullable().optional(),
    orden: zod_1.z.number().min(0).optional(),
    usuariosIds: zod_1.z.array(zod_1.z.string().uuid()).optional(),
    notaPlanificacion: zod_1.z.string().max(1000).nullable().optional(),
});
const activarHoldSchema = zod_1.z.object({
    boxId: zod_1.z.string().uuid().nullable().optional(),
    iniciarInmediato: zod_1.z.boolean().optional(),
    estado: zod_1.z.enum(['adentro', 'afuera']).nullable().optional(),
});
const archiveColdSchema = zod_1.z.object({
    retencion: zod_1.z
        .string()
        .trim()
        .regex(/^\d+\s+(seconds?|minutes?|hours?|days?|weeks?)$/i, 'Intervalo de retención inválido (ej: "7 days")')
        .optional(),
});
const loginTallerSchema = zod_1.z.object({
    nombre_usuario: zod_1.z.string().trim().min(1, 'El nombre de usuario es requerido'),
    password: zod_1.z.string().min(1, 'La contraseña es requerida'),
});
function createPlaneacionRouter(io) {
    const router = (0, express_1.Router)();
    // Autenticación de Usuarios de Taller (base.usuarios_taller / base.fn_login_usuario_taller)
    router.post('/auth/login', async (req, res) => {
        const parsed = loginTallerSchema.safeParse({
            nombre_usuario: req.body?.nombre_usuario ?? req.body?.username ?? '',
            password: req.body?.password ?? '',
        });
        if (!parsed.success) {
            res.status(400).json({
                success: false,
                authenticated: false,
                error: 'Ingresá usuario y contraseña.',
            });
            return;
        }
        try {
            const result = await hotRamBaseService_js_1.hotRamBaseService.loginUsuarioTaller(parsed.data.nombre_usuario, parsed.data.password);
            if (!result.authenticated || !result.user) {
                res.status(401).json({
                    success: false,
                    authenticated: false,
                    error: result.error || 'Credenciales inválidas.',
                });
                return;
            }
            res.json({
                success: true,
                authenticated: true,
                user: result.user,
                redirect: '/taller',
            });
        }
        catch (err) {
            res.status(500).json({
                success: false,
                authenticated: false,
                error: err instanceof Error ? err.message : 'Error autenticando usuario de taller',
            });
        }
    });
    // Verificación de acceso a /taller delimitada estrictamente por base.usuarios_taller + auth.users
    router.get('/auth/verify', async (req, res) => {
        const userId = String(req.headers['x-taller-user-id'] || req.query.user_id || '').trim();
        if (!userId) {
            res.status(401).json({
                success: false,
                authorized: false,
                error: 'Sesión no iniciada',
            });
            return;
        }
        try {
            const result = await hotRamBaseService_js_1.hotRamBaseService.verificarAccesoTaller(userId);
            if (!result.authorized || !result.user) {
                res.status(403).json({
                    success: false,
                    authorized: false,
                    error: result.error || 'Acceso delimitado a base.usuarios_taller',
                });
                return;
            }
            res.json({
                success: true,
                authorized: true,
                user: result.user,
            });
        }
        catch (err) {
            res.status(500).json({
                success: false,
                authorized: false,
                error: err instanceof Error ? err.message : 'Error verificando sesión de taller',
            });
        }
    });
    // Autenticación de Usuarios de Coordinación (base.user_coordinacion / base.fn_login_user_coordinacion)
    router.post('/auth/coordinacion/login', async (req, res) => {
        const parsed = loginTallerSchema.safeParse({
            nombre_usuario: req.body?.nombre_usuario ?? req.body?.username ?? '',
            password: req.body?.password ?? '',
        });
        if (!parsed.success) {
            res.status(400).json({
                success: false,
                authenticated: false,
                error: 'Ingresá usuario y contraseña.',
            });
            return;
        }
        try {
            const result = await hotRamBaseService_js_1.hotRamBaseService.loginUserCoordinacion(parsed.data.nombre_usuario, parsed.data.password);
            if (!result.authenticated || !result.user) {
                res.status(401).json({
                    success: false,
                    authenticated: false,
                    error: result.error || 'Credenciales inválidas.',
                });
                return;
            }
            res.json({
                success: true,
                authenticated: true,
                user: result.user,
                redirect: '/coordinacion',
            });
        }
        catch (err) {
            res.status(500).json({
                success: false,
                authenticated: false,
                error: err instanceof Error ? err.message : 'Error autenticando usuario de coordinación',
            });
        }
    });
    // Verificación de acceso a Coordinación delimitada por base.user_coordinacion + auth.users
    router.get('/auth/coordinacion/verify', async (req, res) => {
        const userId = String(req.headers['x-coordinacion-user-id'] || req.query.user_id || '').trim();
        if (!userId) {
            res.status(401).json({
                success: false,
                authorized: false,
                error: 'Sesión no iniciada',
            });
            return;
        }
        try {
            const result = await hotRamBaseService_js_1.hotRamBaseService.verificarAccesoCoordinacion(userId);
            if (!result.authorized || !result.user) {
                res.status(403).json({
                    success: false,
                    authorized: false,
                    error: result.error || 'Acceso delimitado a base.user_coordinacion',
                });
                return;
            }
            res.json({
                success: true,
                authorized: true,
                user: result.user,
            });
        }
        catch (err) {
            res.status(500).json({
                success: false,
                authorized: false,
                error: err instanceof Error ? err.message : 'Error verificando sesión de coordinación',
            });
        }
    });
    // Tablero caliente C1 (activos + holds + catalog) con soporte ETag / 304
    // includeCatalog=0 omite el catálogo completo para mantener /taller ultra liviano (/db-perf-review)
    // Con zoneId válido junto a includeCatalog=0, proyecta solo cards del sector y taller_zone_map (sin catalog).
    router.get('/board', async (req, res) => {
        try {
            const includeCatalog = req.query.includeCatalog !== '0';
            if (includeCatalog) {
                if (!(await requireCoordinacionAuth(req, res, 'ver el tablero de coordinación')))
                    return;
            }
            else {
                if (!(await requireTallerOrCoordinacionAuth(req, res, 'ver el tablero de taller')))
                    return;
            }
            const rawZoneId = typeof req.query.zoneId === 'string' ? req.query.zoneId.trim() : '';
            const validZoneId = UUID_REGEX.test(rawZoneId) ? rawZoneId : '';
            const sectorZoneId = !includeCatalog ? validZoneId : '';
            const snapshot = await hotRamBaseService_js_1.hotRamBaseService.getBoardSnapshot();
            const effectiveEtag = includeCatalog
                ? validZoneId
                    ? `${snapshot.etag.slice(0, -1)}-coord-v2-${validZoneId}"`
                    : `${snapshot.etag.slice(0, -1)}-coord-v2"`
                : sectorZoneId
                    ? `${snapshot.etag.slice(0, -1)}-taller-v5-${sectorZoneId}"`
                    : `${snapshot.etag.slice(0, -1)}-taller"`;
            const clientEtag = req.headers['if-none-match'];
            if (clientEtag && clientEtag === effectiveEtag) {
                res.status(304).end();
                return;
            }
            res.setHeader('ETag', effectiveEtag);
            res.setHeader('Cache-Control', 'no-cache');
            if (!includeCatalog && sectorZoneId) {
                const lite = hotRamBaseService_js_1.hotRamBaseService.buildLiteTallerBoardPayload(snapshot, sectorZoneId);
                res.json({
                    success: true,
                    activos: lite.activos,
                    holds: lite.holds,
                    taller_zone_map: lite.taller_zone_map,
                    updatedAt: snapshot.updatedAt,
                });
                return;
            }
            const tallerZoneMap = validZoneId ? snapshot.tallerZoneMaps.get(validZoneId) ?? null : null;
            if (includeCatalog) {
                const coordPayload = hotRamBaseService_js_1.hotRamBaseService.buildCoordinacionBoardPayload(snapshot);
                res.json({
                    success: true,
                    activos: coordPayload.activos,
                    holds: coordPayload.holds,
                    circuitos_abiertos: coordPayload.circuitos_abiertos,
                    catalog: coordPayload.catalog,
                    ...(validZoneId ? { taller_zone_map: tallerZoneMap } : {}),
                    updatedAt: snapshot.updatedAt,
                });
                return;
            }
            res.json({
                success: true,
                activos: snapshot.activos,
                holds: snapshot.holds,
                ...(validZoneId ? { taller_zone_map: tallerZoneMap } : {}),
                updatedAt: snapshot.updatedAt,
            });
        }
        catch (err) {
            res.status(500).json({
                success: false,
                error: err instanceof Error ? err.message : 'Error cargando tablero',
            });
        }
    });
    // Mapeo C1 Hot RAM dedicado para renderizado de /taller por zona (boxes contenidos + adentro/afuera)
    router.get('/taller-zone-map/:zoneId', async (req, res) => {
        if (!(await requireTallerOrCoordinacionAuth(req, res, 'consultar el mapa de zona')))
            return;
        const zoneId = String(req.params.zoneId || '').trim();
        if (!UUID_REGEX.test(zoneId)) {
            res.status(400).json({ success: false, error: 'zoneId inválido (se requiere UUID).' });
            return;
        }
        try {
            const { zoneMap, etag, updatedAt } = await hotRamBaseService_js_1.hotRamBaseService.getTallerZoneMap(zoneId);
            if (!zoneMap) {
                res.status(404).json({ success: false, error: `Zona ${zoneId} no encontrada en base.zones.` });
                return;
            }
            const clientEtag = req.headers['if-none-match'];
            if (clientEtag && clientEtag === etag) {
                res.status(304).end();
                return;
            }
            res.setHeader('ETag', etag);
            res.setHeader('Cache-Control', 'no-cache');
            res.json({
                success: true,
                taller_zone_map: zoneMap,
                updatedAt,
            });
        }
        catch (err) {
            res.status(500).json({
                success: false,
                error: err instanceof Error ? err.message : 'Error cargando mapeo de boxes de zona',
            });
        }
    });
    // Refresco forzado de C1 Hot RAM
    router.post('/board/refresh', async (req, res) => {
        if (!(await requireCoordinacionAuth(req, res, 'refrescar el tablero')))
            return;
        try {
            const snapshot = await hotRamBaseService_js_1.hotRamBaseService.hydrateBoard(true);
            io.emit('planeacion_board_updated', { updatedAt: snapshot.updatedAt });
            res.json({
                success: true,
                count: snapshot.activos.length,
                holdsCount: snapshot.holds.length,
                updatedAt: snapshot.updatedAt,
            });
        }
        catch (err) {
            res.status(500).json({
                success: false,
                error: err instanceof Error ? err.message : 'Error refrescando tablero',
            });
        }
    });
    // =========================================================================
    // CIRCUITOS V3 (Alta en Planta / Baja en cualquier instancia / Desunión Tractor-Semi)
    // =========================================================================
    router.get('/circuitos', async (req, res) => {
        if (!(await requireCoordinacionAuth(req, res, 'listar circuitos abiertos')))
            return;
        try {
            const snapshot = await hotRamBaseService_js_1.hotRamBaseService.getBoardSnapshot();
            res.json({
                success: true,
                circuitos: snapshot.circuitos_abiertos,
                updatedAt: snapshot.updatedAt,
            });
        }
        catch (err) {
            sendRouteError(res, err, 'Error listando circuitos abiertos');
        }
    });
    router.post('/circuitos', async (req, res) => {
        const coordId = await requireCoordinacionAuth(req, res, 'dar de alta un circuito');
        if (!coordId)
            return;
        const parsed = altaCircuitoSchema.safeParse(req.body || {});
        if (!parsed.success) {
            res.status(400).json({ success: false, error: parsed.error.flatten() });
            return;
        }
        try {
            const circuito = await hotRamBaseService_js_1.hotRamBaseService.altaCircuito({
                ...parsed.data,
                coordUserId: coordId,
            });
            io.emit('planeacion_board_updated', {
                action: 'CIRCUITO_ALTA',
                circuitoId: circuito.circuito_id,
                updatedAt: Date.now(),
            });
            res.status(201).json({ success: true, circuito });
        }
        catch (err) {
            sendRouteError(res, err, 'Error dando de alta el circuito');
        }
    });
    router.post('/circuitos/:id/baja', async (req, res) => {
        const coordId = await requireCoordinacionAuth(req, res, 'dar de baja un circuito');
        if (!coordId)
            return;
        const circuitoId = String(req.params.id || '').trim();
        if (!UUID_REGEX.test(circuitoId)) {
            res.status(400).json({ success: false, error: 'ID de circuito inválido.' });
            return;
        }
        try {
            const result = await hotRamBaseService_js_1.hotRamBaseService.bajaCircuito(circuitoId, coordId);
            io.emit('planeacion_board_updated', {
                action: 'CIRCUITO_BAJA',
                circuitoId,
                updatedAt: Date.now(),
            });
            res.json({ success: true, ...result });
        }
        catch (err) {
            sendRouteError(res, err, 'Error dando de baja el circuito');
        }
    });
    router.post('/circuitos/:id/desunir', async (req, res) => {
        const coordId = await requireCoordinacionAuth(req, res, 'desunir un circuito');
        if (!coordId)
            return;
        const circuitoId = String(req.params.id || '').trim();
        if (!UUID_REGEX.test(circuitoId)) {
            res.status(400).json({ success: false, error: 'ID de circuito inválido.' });
            return;
        }
        const parsed = desunirCircuitoSchema.safeParse(req.body || {});
        if (!parsed.success) {
            res.status(400).json({ success: false, error: parsed.error.flatten() });
            return;
        }
        try {
            const result = await hotRamBaseService_js_1.hotRamBaseService.desunirCircuito(circuitoId, parsed.data.mantenerEn || 'TRACTOR', coordId);
            io.emit('planeacion_board_updated', {
                action: 'CIRCUITO_DESUNIDO',
                circuitoId,
                ...result,
                updatedAt: Date.now(),
            });
            res.json({ success: true, ...result });
        }
        catch (err) {
            sendRouteError(res, err, 'Error desuniendo el circuito');
        }
    });
    // Sweep semanal hacia base.procesos_cold (circuitos cerrados con >= retencion, default '7 days')
    router.post('/board/archive-cold', async (req, res) => {
        if (!(await requireCoordinacionAuth(req, res, 'ejecutar el archivado a cold')))
            return;
        const parsed = archiveColdSchema.safeParse(req.body || {});
        if (!parsed.success) {
            res.status(400).json({ success: false, error: parsed.error.flatten() });
            return;
        }
        try {
            const retencion = parsed.data.retencion || '7 days';
            const result = await hotRamBaseService_js_1.hotRamBaseService.ejecutarSweepSemanalCold(retencion);
            res.json({
                success: true,
                retencion,
                ...result,
            });
        }
        catch (err) {
            sendRouteError(res, err, 'Error ejecutando archivado semanal a base.procesos_cold');
        }
    });
    // C2 On-Demand: Procesos finalizados paginados (ventana reciente base.procesos + store semanal base.procesos_cold)
    router.get('/finalizados', async (req, res) => {
        if (!(await requireTallerOrCoordinacionAuth(req, res, 'consultar procesos finalizados')))
            return;
        try {
            const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
            const offset = Math.max(Number(req.query.offset) || 0, 0);
            const items = await hotRamBaseService_js_1.hotRamBaseService.getFinalizados(limit, offset);
            res.json({ success: true, items, limit, offset });
        }
        catch (err) {
            res.status(500).json({
                success: false,
                error: err instanceof Error ? err.message : 'Error cargando finalizados',
            });
        }
    });
    // C2 On-Demand: Trayectoria cronológica completa de una unidad/tractor/semi (cold -> hot -> hold)
    router.get('/trayectoria', async (req, res) => {
        if (!(await requireTallerOrCoordinacionAuth(req, res, 'consultar trayectoria de unidad')))
            return;
        try {
            const data = await hotRamBaseService_js_1.hotRamBaseService.getTrayectoriaUnidad({
                unidadId: req.query.unidad_id ? String(req.query.unidad_id) : undefined,
                tractorId: req.query.tractor_id ? String(req.query.tractor_id) : undefined,
                semiId: req.query.semi_id ? String(req.query.semi_id) : undefined,
            });
            res.json({ success: true, ...data });
        }
        catch (err) {
            res.status(500).json({
                success: false,
                error: err instanceof Error ? err.message : 'Error consultando trayectoria',
            });
        }
    });
    // C2 On-Demand: Detalle enriquecido (vencimientos) para vista Deployed
    router.get('/unidad-detalle', async (req, res) => {
        if (!(await requireTallerOrCoordinacionAuth(req, res, 'consultar detalle de unidad')))
            return;
        try {
            const detail = await hotRamBaseService_js_1.hotRamBaseService.getUnidadDetalleDeployed({
                tractorPlate: String(req.query.tractor || ''),
                semiPlate: String(req.query.semi || ''),
                nUte: String(req.query.n_ute || ''),
            });
            res.json({ success: true, detail });
        }
        catch (err) {
            res.status(500).json({
                success: false,
                error: err instanceof Error ? err.message : 'Error cargando detalle de unidad',
            });
        }
    });
    // Registrar llegada a un Box (Hot)
    router.post('/procesos/llegada', async (req, res) => {
        if (!(await requireTallerOrCoordinacionAuth(req, res, 'registrar llegada a box')))
            return;
        const parsed = llegadaSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ success: false, error: parsed.error.flatten() });
            return;
        }
        try {
            const { actorUsuarioId, origen } = extractActorContext(req);
            const proceso = await hotRamBaseService_js_1.hotRamBaseService.registrarLlegadaBox({
                ...parsed.data,
                actorUsuarioId,
                origen,
            });
            io.emit('planeacion_board_updated', {
                action: 'LLEGADA',
                procesoId: proceso.proceso_id,
                circuitoId: proceso.circuitoId,
                updatedAt: Date.now(),
            });
            res.status(201).json({ success: true, proceso });
        }
        catch (err) {
            sendRouteError(res, err, 'Error registrando llegada');
        }
    });
    // Actualizar proceso (box, usuarios, iniciar/finalizar/reabrir/deshacer/revertir/archivar)
    router.patch('/procesos/:id', async (req, res) => {
        const parsed = patchProcesoSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ success: false, error: parsed.error.flatten() });
            return;
        }
        if (parsed.data.action === 'ARCHIVAR') {
            if (!(await requireCoordinacionAuth(req, res, 'archivar/dar de baja un circuito')))
                return;
        }
        else {
            if (!(await requireTallerOrCoordinacionAuth(req, res, 'actualizar un proceso')))
                return;
        }
        try {
            const procesoId = String(req.params.id);
            const { actorUsuarioId, origen } = extractActorContext(req);
            const updated = await hotRamBaseService_js_1.hotRamBaseService.actualizarProceso(procesoId, {
                ...parsed.data,
                actorUsuarioId,
                origen,
            });
            const updatedProcesoId = updated?.proceso_id || procesoId;
            io.emit('planeacion_board_updated', {
                action: parsed.data.action || 'UPDATED',
                procesoId: updatedProcesoId,
                updatedAt: Date.now(),
            });
            if (parsed.data.action === 'FINALIZAR') {
                const u = updated;
                io.emit('unidad_salida_hold', {
                    procesoId,
                    unidadId: u.unidad_id || null,
                    tractorId: u.tractor_id || null,
                    semiId: u.semi_id || null,
                    origenBox: u.box_name || 'Box previo',
                    salidaAt: u.salida_at || new Date().toISOString(),
                    ultimaTarea: u.ultima_tarea || null,
                    pendingHold: u.pending_hold || null,
                    updatedAt: Date.now(),
                });
            }
            res.json({ success: true, proceso: updated });
        }
        catch (err) {
            sendRouteError(res, err, 'Error actualizando proceso');
        }
    });
    // Chat de Notas: Obtener historial completo bajo demanda (C1 Hot RAM fast-path / C2 B-Tree fallback)
    router.get('/procesos/:id/notas', async (req, res) => {
        if (!(await requireTallerOrCoordinacionAuth(req, res, 'consultar notas del proceso')))
            return;
        const procesoId = String(req.params.id || '').trim();
        if (!UUID_REGEX.test(procesoId)) {
            res.status(400).json({ success: false, error: 'ID de proceso inválido.' });
            return;
        }
        try {
            const notes = await hotRamBaseService_js_1.hotRamBaseService.getNotasProceso(procesoId);
            res.json({ success: true, notes });
        }
        catch (err) {
            sendRouteError(res, err, 'Error obteniendo notas del proceso');
        }
    });
    // Chat de Notas: Agregar mensaje
    router.post('/procesos/:id/notas', async (req, res) => {
        const auth = await requireTallerOrCoordinacionAuth(req, res, 'agregar nota al proceso');
        if (!auth)
            return;
        const procesoId = String(req.params.id || '').trim();
        if (!UUID_REGEX.test(procesoId)) {
            res.status(400).json({ success: false, error: 'ID de proceso o circuito inválido.' });
            return;
        }
        const parsed = notaSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                success: false,
                error: formatZodError(parsed.error, 'Datos de nota inválidos.'),
                details: parsed.error.flatten(),
            });
            return;
        }
        try {
            const isCoordinacion = auth.role === 'coordinacion' ||
                req.headers['x-origen'] === 'coordinacion' ||
                parsed.data.location === 'Coordinación' ||
                (!parsed.data.usuarioId && !parsed.data.usuario_id && !req.headers['x-taller-user-id']);
            let usuarioId = null;
            let location = isCoordinacion ? 'Coordinación' : (parsed.data.location || null);
            if (!isCoordinacion) {
                usuarioId =
                    parsed.data.usuarioId ||
                        parsed.data.usuario_id ||
                        (req.headers['x-taller-user-id'] ? String(req.headers['x-taller-user-id']).trim() : null) ||
                        (req.headers['x-user-id'] ? String(req.headers['x-user-id']).trim() : null);
                const usuarioNombre = parsed.data.usuario ||
                    (req.headers['x-usuario-nombre'] ? String(req.headers['x-usuario-nombre']).trim() : null);
                if (!usuarioId && usuarioNombre) {
                    usuarioId = hotRamBaseService_js_1.hotRamBaseService.resolveUserIdByName(usuarioNombre);
                }
            }
            const result = await hotRamBaseService_js_1.hotRamBaseService.agregarNota(procesoId, usuarioId, parsed.data.texto, location);
            io.emit('planeacion_board_updated', {
                action: 'NOTA_AGREGADA',
                procesoId,
                circuitoId: result.circuitoId,
                updatedAt: Date.now(),
            });
            res.status(201).json({ success: true, result });
        }
        catch (err) {
            sendRouteError(res, err, 'Error agregando nota');
        }
    });
    // Chat de Notas: Editar mensaje por noteId
    router.patch('/procesos/:id/notas/:noteId', async (req, res) => {
        if (!(await requireTallerOrCoordinacionAuth(req, res, 'editar nota')))
            return;
        const procesoId = String(req.params.id || '').trim();
        const noteId = String(req.params.noteId || '').trim();
        if (!UUID_REGEX.test(procesoId) || !UUID_REGEX.test(noteId)) {
            res.status(400).json({ success: false, error: 'ID de proceso o nota inválido.' });
            return;
        }
        const parsed = notaSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                success: false,
                error: formatZodError(parsed.error, 'Datos de nota inválidos.'),
                details: parsed.error.flatten(),
            });
            return;
        }
        try {
            let usuarioId = parsed.data.usuarioId ||
                parsed.data.usuario_id ||
                (req.headers['x-coordinacion-user-id'] ? String(req.headers['x-coordinacion-user-id']).trim() : null) ||
                (req.headers['x-taller-user-id'] ? String(req.headers['x-taller-user-id']).trim() : null) ||
                (req.headers['x-user-id'] ? String(req.headers['x-user-id']).trim() : null);
            const usuarioNombre = parsed.data.usuario ||
                (req.headers['x-usuario-nombre'] ? String(req.headers['x-usuario-nombre']).trim() : null);
            if (!usuarioId && usuarioNombre) {
                usuarioId = hotRamBaseService_js_1.hotRamBaseService.resolveUserIdByName(usuarioNombre);
            }
            const result = await hotRamBaseService_js_1.hotRamBaseService.editarNota(procesoId, noteId, usuarioId, parsed.data.texto);
            io.emit('planeacion_board_updated', {
                action: 'NOTA_EDITADA',
                procesoId,
                circuitoId: result.circuitoId,
                noteId,
                updatedAt: Date.now(),
            });
            res.json({ success: true, result });
        }
        catch (err) {
            sendRouteError(res, err, 'Error editando nota');
        }
    });
    // Chat de Notas: Eliminar mensaje por noteId (restringido exclusivamente a base.user_coordinacion)
    router.delete('/procesos/:id/notas/:noteId', async (req, res) => {
        try {
            if (!(await requireCoordinacionAuth(req, res, 'eliminar notas')))
                return;
            const procesoId = String(req.params.id || '').trim();
            const noteId = String(req.params.noteId || '').trim();
            if (!UUID_REGEX.test(procesoId) || !UUID_REGEX.test(noteId)) {
                res.status(400).json({ success: false, error: 'ID de proceso o nota inválido.' });
                return;
            }
            const result = await hotRamBaseService_js_1.hotRamBaseService.eliminarNota(procesoId, noteId);
            io.emit('planeacion_board_updated', {
                action: 'NOTA_ELIMINADA',
                procesoId,
                circuitoId: result.circuitoId,
                noteId,
                updatedAt: Date.now(),
            });
            res.json({ success: true, result });
        }
        catch (err) {
            sendRouteError(res, err, 'Error eliminando nota');
        }
    });
    // Preasignaciones / Recorrido Programado (unificado en base.procesos V2 con llegada_zona_at = NULL)
    router.post('/holds', async (req, res) => {
        if (!(await requireCoordinacionAuth(req, res, 'crear preasignación')))
            return;
        const parsed = createHoldSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ success: false, error: parsed.error.flatten() });
            return;
        }
        try {
            const hold = await hotRamBaseService_js_1.hotRamBaseService.crearHold(parsed.data);
            io.emit('planeacion_board_updated', { action: 'HOLD_CREATED', updatedAt: Date.now() });
            res.status(201).json({ success: true, hold });
        }
        catch (err) {
            sendRouteError(res, err, 'Error creando preasignación');
        }
    });
    router.patch('/holds/:id', async (req, res) => {
        if (!(await requireTallerOrCoordinacionAuth(req, res, 'actualizar preasignación')))
            return;
        const parsed = patchHoldSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ success: false, error: parsed.error.flatten() });
            return;
        }
        try {
            const holdId = String(req.params.id);
            const { actorUsuarioId, origen } = extractActorContext(req);
            const hold = await hotRamBaseService_js_1.hotRamBaseService.actualizarHold(holdId, {
                ...parsed.data,
                actorUsuarioId,
                origen,
            });
            io.emit('planeacion_board_updated', {
                action: 'HOLD_UPDATED',
                holdId,
                circuitoId: hold.circuitoId,
                updatedAt: Date.now(),
            });
            res.json({ success: true, hold });
        }
        catch (err) {
            sendRouteError(res, err, 'Error actualizando preasignación');
        }
    });
    // Eliminación de PREASIGNADO: restringido exclusivamente a jerarquía base.user_coordinacion (usuarios_taller NO pueden eliminar)
    router.delete('/holds/:id', async (req, res) => {
        try {
            if (!(await requireCoordinacionAuth(req, res, 'eliminar registros')))
                return;
            const holdId = String(req.params.id);
            await hotRamBaseService_js_1.hotRamBaseService.eliminarHold(holdId);
            io.emit('planeacion_board_updated', { action: 'HOLD_DELETED', holdId, updatedAt: Date.now() });
            res.json({ success: true });
        }
        catch (err) {
            sendRouteError(res, err, 'Error eliminando preasignación');
        }
    });
    router.post('/holds/:id/activar', async (req, res) => {
        if (!(await requireTallerOrCoordinacionAuth(req, res, 'activar preasignación')))
            return;
        const parsed = activarHoldSchema.safeParse(req.body || {});
        if (!parsed.success) {
            res.status(400).json({ success: false, error: parsed.error.flatten() });
            return;
        }
        try {
            const holdId = String(req.params.id);
            const { actorUsuarioId } = extractActorContext(req);
            const proceso = await hotRamBaseService_js_1.hotRamBaseService.activarHold(holdId, parsed.data.boxId, Boolean(parsed.data.iniciarInmediato), actorUsuarioId, parsed.data.estado);
            io.emit('planeacion_board_updated', { action: 'HOLD_ACTIVATED', holdId, updatedAt: Date.now() });
            res.json({ success: true, proceso });
        }
        catch (err) {
            sendRouteError(res, err, 'Error activando preasignación');
        }
    });
    return router;
}
