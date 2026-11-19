"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hotRamBaseService = exports.NotFoundError = exports.ConflictError = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_perf_hooks_1 = require("node:perf_hooks");
const drizzle_orm_1 = require("drizzle-orm");
const index_js_1 = require("../db/index.js");
const schema_js_1 = require("../db/schema.js");
class ConflictError extends Error {
    statusCode = 409;
    constructor(message) {
        super(message);
        this.name = 'ConflictError';
    }
}
exports.ConflictError = ConflictError;
class NotFoundError extends Error {
    statusCode = 404;
    constructor(message) {
        super(message);
        this.name = 'NotFoundError';
    }
}
exports.NotFoundError = NotFoundError;
const CATALOG_TTL_MS = 5 * 60 * 1000;
const WEEKLY_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // Chequeo diario (archiva circuitos > 7 días)
class HotRamBaseService {
    cache = null;
    cachedCatalog = null;
    refreshingPromise = null;
    lastCatalogRefresh = 0;
    runtimeIndex = null;
    sweepTimer = null;
    resolveUserIdByName(name) {
        if (!name || !this.runtimeIndex)
            return null;
        return this.runtimeIndex.userNameToIdMap.get(name.trim().toLowerCase()) || null;
    }
    getDefaultCoordinatorId() {
        return this.runtimeIndex?.defaultCoordinatorId || null;
    }
    /**
     * Verifica jerarquía de autorización estricta contra base.user_coordinacion.
     * Resolución O(1) en Hot RAM C1 con fallback DB si la caché de catálogo aún no se hidrató.
     */
    async isCoordinacionUserAuthorized(userId) {
        const cleanId = (userId || '').trim();
        if (!cleanId)
            return false;
        if (this.runtimeIndex?.coordUserIds.has(cleanId)) {
            return true;
        }
        const { index } = await this.ensureRuntimeIndex();
        if (index.coordUserIds.has(cleanId)) {
            return true;
        }
        const check = await this.verificarAccesoCoordinacion(cleanId);
        return Boolean(check.authorized);
    }
    computeEtag(payload) {
        return `"${node_crypto_1.default.createHash('sha1').update(JSON.stringify(payload)).digest('hex')}"`;
    }
    resolveModalidad(trId, smId) {
        if (trId && smId)
            return 'EQUIPO_ACOPLADO';
        if (trId && !smId)
            return 'SOLO_TRACTOR';
        if (!trId && smId)
            return 'SOLO_SEMI';
        return 'UNIDAD';
    }
    resolveEstado(llegadaZonaAt, ingresoBoxAt, salidaAt) {
        if (salidaAt)
            return 'FINALIZADO';
        if (ingresoBoxAt)
            return 'EN_PROCESO';
        if (llegadaZonaAt)
            return 'EN_ESPERA';
        return 'PREASIGNADO';
    }
    isPendingRow(row) {
        return !row.llegadaZonaAt && !row.ingresoBoxAt && !row.salidaAt;
    }
    buildRuntimeIndex(catalog, tractoresRows, semisRows, coordUsersRows) {
        const zonesMap = new Map();
        for (const z of catalog.zones)
            zonesMap.set(z.id, z.zone_name);
        const boxesMap = new Map();
        for (const b of catalog.boxes) {
            boxesMap.set(b.id, { box_name: b.box_name, zone_id: b.zone_id, zone_name: b.zone_name });
        }
        const usersMap = new Map();
        for (const u of catalog.usuarios)
            usersMap.set(u.id, u.nombre_usuario);
        for (const c of coordUsersRows)
            usersMap.set(c.id, c.nombre_usuario);
        const userNameToIdMap = new Map();
        for (const [id, name] of usersMap.entries()) {
            userNameToIdMap.set(name.trim().toLowerCase(), id);
        }
        const tractoresMap = new Map();
        for (const t of tractoresRows)
            tractoresMap.set(t.id, t.dominio || '');
        const semisMap = new Map();
        for (const s of semisRows)
            semisMap.set(s.id, s.dominio || '');
        // Índice virtual de unidades (base.unidades solo como índice en memoria para renderizado y re-acople futuro)
        const unidadById = new Map();
        const unidadByPair = new Map();
        const unidadByTractor = new Map();
        const unidadBySemi = new Map();
        for (const u of catalog.unidades) {
            unidadById.set(u.unidad_id, u);
            if (u.tractor_id && u.semi_id) {
                unidadByPair.set(`${u.tractor_id}_${u.semi_id}`, u);
            }
            if (u.tractor_id && !unidadByTractor.has(u.tractor_id)) {
                unidadByTractor.set(u.tractor_id, u);
            }
            if (u.semi_id && !unidadBySemi.has(u.semi_id)) {
                unidadBySemi.set(u.semi_id, u);
            }
        }
        const coordUserIds = new Set(coordUsersRows.map((c) => c.id));
        const defaultCoord = coordUsersRows[0] || null;
        return {
            zonesMap,
            boxesMap,
            usersMap,
            userNameToIdMap,
            tractoresMap,
            semisMap,
            unidadById,
            unidadByPair,
            unidadByTractor,
            unidadBySemi,
            coordUserIds,
            defaultCoordinatorId: defaultCoord?.id || null,
            defaultCoordinatorName: defaultCoord?.nombre_usuario || 'coordinacion',
        };
    }
    /**
     * Resuelve dinámicamente la unidad virtual (unidad_id + n_ute) desde el índice en memoria
     * usando (tractor_id, semi_id) sin almacenar unidad_id FK en base.procesos.
     */
    resolveVirtualUnit(idx, tractorId, semiId) {
        if (tractorId && semiId) {
            const exact = idx.unidadByPair.get(`${tractorId}_${semiId}`);
            if (exact)
                return { unidad_id: exact.unidad_id, n_ute: exact.n_ute };
        }
        if (tractorId) {
            const byTr = idx.unidadByTractor.get(tractorId);
            if (byTr)
                return { unidad_id: byTr.unidad_id, n_ute: byTr.n_ute };
        }
        if (semiId) {
            const bySm = idx.unidadBySemi.get(semiId);
            if (bySm)
                return { unidad_id: bySm.unidad_id, n_ute: bySm.n_ute };
        }
        return { unidad_id: null, n_ute: '' };
    }
    /**
     * Resuelve activos físicos (tractorId, semiId) a partir de inputs legacy que puedan enviar solo unidadId.
     */
    async resolvePhysicalAssets(tx, input) {
        let tractorId = input.tractorId || null;
        let semiId = input.semiId || null;
        if (!tractorId && !semiId && input.unidadId) {
            const cached = this.runtimeIndex?.unidadById.get(input.unidadId);
            if (cached) {
                tractorId = cached.tractor_id;
                semiId = cached.semi_id;
            }
            else {
                const uRes = await tx
                    .select({ tractorId: schema_js_1.unidades.tractorId, semiId: schema_js_1.unidades.semiId })
                    .from(schema_js_1.unidades)
                    .where((0, drizzle_orm_1.eq)(schema_js_1.unidades.id, input.unidadId))
                    .limit(1);
                if (uRes.length > 0) {
                    tractorId = uRes[0].tractorId;
                    semiId = uRes[0].semiId;
                }
            }
        }
        if (!tractorId && !semiId) {
            throw new ConflictError('Se requiere al menos tractorId o semiId (o unidadId válida) para registrar el proceso.');
        }
        return { tractorId, semiId };
    }
    mapNotaRow(n, usersMap) {
        const isCoord = !n.usuarioId || n.location === 'Coordinación';
        return {
            id: n.id,
            usuario_id: isCoord ? null : n.usuarioId,
            usuario: isCoord ? null : (n.usuarioId ? usersMap.get(n.usuarioId) || 'Operario' : null),
            location: isCoord ? 'Coordinación' : (n.location || 'Box'),
            texto: n.texto || '',
            timestamp: n.createdAt instanceof Date ? n.createdAt.toISOString() : String(n.createdAt),
            edited_at: n.editedAt ? (n.editedAt instanceof Date ? n.editedAt.toISOString() : String(n.editedAt)) : null,
        };
    }
    async fetchCatalogAndIndex() {
        const [zonesRows, boxesRows, tallerUsersRows, coordUsersRows, tractoresRows, semisRows, unitsRows,] = await Promise.all([
            index_js_1.db.select().from(schema_js_1.zones).orderBy(schema_js_1.zones.zoneName),
            index_js_1.db
                .select({
                id: schema_js_1.boxes.id,
                box_name: schema_js_1.boxes.boxName,
                zone_id: schema_js_1.boxes.zoneId,
                zone_name: schema_js_1.zones.zoneName,
            })
                .from(schema_js_1.boxes)
                .innerJoin(schema_js_1.zones, (0, drizzle_orm_1.eq)(schema_js_1.boxes.zoneId, schema_js_1.zones.id))
                .orderBy(schema_js_1.boxes.boxName),
            index_js_1.db
                .select({
                id: schema_js_1.usuariosTaller.id,
                nombre_usuario: schema_js_1.usuariosTaller.nombreUsuario,
                box_id: schema_js_1.usuariosTaller.boxId,
                box_name: schema_js_1.boxes.boxName,
            })
                .from(schema_js_1.usuariosTaller)
                .leftJoin(schema_js_1.boxes, (0, drizzle_orm_1.eq)(schema_js_1.usuariosTaller.boxId, schema_js_1.boxes.id))
                .orderBy(schema_js_1.usuariosTaller.nombreUsuario),
            index_js_1.db
                .select({
                id: schema_js_1.userCoordinacion.id,
                nombre_usuario: schema_js_1.userCoordinacion.nombreUsuario,
                box_id: schema_js_1.userCoordinacion.boxId,
                box_name: schema_js_1.boxes.boxName,
            })
                .from(schema_js_1.userCoordinacion)
                .leftJoin(schema_js_1.boxes, (0, drizzle_orm_1.eq)(schema_js_1.userCoordinacion.boxId, schema_js_1.boxes.id))
                .orderBy(schema_js_1.userCoordinacion.createdAt),
            index_js_1.db.select({ id: schema_js_1.tractores.id, dominio: schema_js_1.tractores.dominio }).from(schema_js_1.tractores),
            index_js_1.db.select({ id: schema_js_1.semis.id, dominio: schema_js_1.semis.dominio }).from(schema_js_1.semis),
            index_js_1.db
                .select({
                unidad_id: schema_js_1.unidades.id,
                n_ute: schema_js_1.unidades.nUte,
                tractor_id: schema_js_1.unidades.tractorId,
                semi_id: schema_js_1.unidades.semiId,
            })
                .from(schema_js_1.unidades)
                .orderBy(schema_js_1.unidades.nUte),
        ]);
        this.lastCatalogRefresh = Date.now();
        const trMap = new Map(tractoresRows.map((t) => [t.id, t.dominio || '']));
        const smMap = new Map(semisRows.map((s) => [s.id, s.dominio || '']));
        const catalog = {
            zones: zonesRows.map((z) => ({ id: z.id, zone_name: z.zoneName })),
            boxes: boxesRows,
            usuarios: [...tallerUsersRows, ...coordUsersRows],
            unidades: unitsRows.map((u) => ({
                unidad_id: u.unidad_id,
                n_ute: u.n_ute || '',
                tractor_id: u.tractor_id,
                tractor_plate: u.tractor_id ? trMap.get(u.tractor_id) || '' : '',
                semi_id: u.semi_id,
                semi_plate: u.semi_id ? smMap.get(u.semi_id) || '' : '',
            })),
        };
        const index = this.buildRuntimeIndex(catalog, tractoresRows, semisRows, coordUsersRows.map((c) => ({ id: c.id, nombre_usuario: c.nombre_usuario })));
        return { catalog, index };
    }
    async ensureRuntimeIndex() {
        if (this.cachedCatalog && this.runtimeIndex && Date.now() - this.lastCatalogRefresh <= CATALOG_TTL_MS) {
            return { catalog: this.cachedCatalog, index: this.runtimeIndex };
        }
        const fresh = await this.fetchCatalogAndIndex();
        this.cachedCatalog = fresh.catalog;
        this.runtimeIndex = fresh.index;
        return fresh;
    }
    /**
     * Hidratación Hot RAM C1 V2:
     * 1 único RTT paralelo sobre base.procesos (abiertos) + base.procesos_notas (circuitos activos).
     * 0 SQL JOINs repetitivos y 0 queries a catálogos o procesos_cold en warm hydrate.
     */
    async hydrateBoard(forceCatalog = false) {
        if (this.refreshingPromise) {
            return this.refreshingPromise;
        }
        this.refreshingPromise = (async () => {
            try {
                const shouldRefreshCatalog = forceCatalog ||
                    !this.cachedCatalog ||
                    !this.runtimeIndex ||
                    Date.now() - this.lastCatalogRefresh > CATALOG_TTL_MS;
                // En warm hydrate: 1 único roundtrip paralelo (procesos abiertos + notas de circuitos abiertos)
                const [catalogBundle, openRows, openNotesRows] = await Promise.all([
                    shouldRefreshCatalog
                        ? this.fetchCatalogAndIndex()
                        : Promise.resolve({ catalog: this.cachedCatalog, index: this.runtimeIndex }),
                    index_js_1.db
                        .select({
                        id: schema_js_1.procesos.id,
                        circuitoId: schema_js_1.procesos.circuitoId,
                        tractorId: schema_js_1.procesos.tractorId,
                        semiId: schema_js_1.procesos.semiId,
                        tractorN: schema_js_1.procesos.tractorN,
                        semiN: schema_js_1.procesos.semiN,
                        zoneId: schema_js_1.procesos.zoneId,
                        pendienteAt: schema_js_1.procesos.pendienteAt,
                        llegadaZonaAt: schema_js_1.procesos.llegadaZonaAt,
                        boxId: schema_js_1.procesos.boxId,
                        ingresoBoxAt: schema_js_1.procesos.ingresoBoxAt,
                        usuariosIds: schema_js_1.procesos.usuariosIds,
                        salidaAt: schema_js_1.procesos.salidaAt,
                        circuitoCerradoAt: schema_js_1.procesos.circuitoCerradoAt,
                        updatedAt: schema_js_1.procesos.updatedAt,
                    })
                        .from(schema_js_1.procesos)
                        .where((0, drizzle_orm_1.isNull)(schema_js_1.procesos.circuitoCerradoAt))
                        .orderBy((0, drizzle_orm_1.desc)(schema_js_1.procesos.pendienteAt)),
                    index_js_1.db
                        .select({
                        id: schema_js_1.procesosNotas.id,
                        circuitoId: schema_js_1.procesosNotas.circuitoId,
                        procesoId: schema_js_1.procesosNotas.procesoId,
                        usuarioId: schema_js_1.procesosNotas.usuarioId,
                        location: schema_js_1.procesosNotas.location,
                        texto: schema_js_1.procesosNotas.texto,
                        createdAt: schema_js_1.procesosNotas.createdAt,
                        editedAt: schema_js_1.procesosNotas.editedAt,
                    })
                        .from(schema_js_1.procesosNotas)
                        .where((0, drizzle_orm_1.sql) `${schema_js_1.procesosNotas.circuitoId} IN (SELECT DISTINCT circuito_id FROM base.procesos WHERE circuito_cerrado_at IS NULL)`)
                        .orderBy((0, drizzle_orm_1.asc)(schema_js_1.procesosNotas.createdAt)),
                ]);
                const { catalog, index } = catalogBundle;
                this.cachedCatalog = catalog;
                this.runtimeIndex = index;
                // Agrupar notas compartidas por circuito_id (disponibles en todas las cards del circuito, incl. Doble Carta)
                const notesByCircuito = new Map();
                for (const n of openNotesRows) {
                    const dto = this.mapNotaRow(n, index.usersMap);
                    const list = notesByCircuito.get(n.circuitoId);
                    if (list)
                        list.push(dto);
                    else
                        notesByCircuito.set(n.circuitoId, [dto]);
                }
                // Mapas en O(1) para Doble Carta (activos no finalizados) y Última Ubicación cerrada del circuito
                const activeUnfinalizedByAsset = new Map();
                const latestClosedByCircuito = new Map();
                const circuitosConPasoAbierto = new Set();
                const assetsConPasoAbierto = new Set();
                const latestClosedIdByCircuito = new Map();
                const latestClosedIdByAsset = new Map();
                for (const r of openRows) {
                    const boxInfo = r.boxId ? index.boxesMap.get(r.boxId) : null;
                    const zoneName = boxInfo?.zone_name || index.zonesMap.get(r.zoneId) || '';
                    const boxName = boxInfo?.box_name || '';
                    if (!r.salidaAt) {
                        circuitosConPasoAbierto.add(r.circuitoId);
                        if (r.tractorId)
                            assetsConPasoAbierto.add(`t_${r.tractorId}`);
                        if (r.semiId)
                            assetsConPasoAbierto.add(`s_${r.semiId}`);
                        if (!this.isPendingRow(r)) {
                            const activeData = {
                                box_name: boxName || 'Sin Box',
                                zone_name: zoneName,
                                llegada_at: (r.llegadaZonaAt || r.pendienteAt).toISOString(),
                                inicio_at: r.ingresoBoxAt ? r.ingresoBoxAt.toISOString() : null,
                                circuito_id: r.circuitoId,
                            };
                            if (r.tractorId)
                                activeUnfinalizedByAsset.set(`t_${r.tractorId}`, activeData);
                            if (r.semiId)
                                activeUnfinalizedByAsset.set(`s_${r.semiId}`, activeData);
                        }
                    }
                    else {
                        const salidaMs = r.salidaAt.getTime();
                        const prevBest = latestClosedIdByCircuito.get(r.circuitoId);
                        if (!prevBest || salidaMs > prevBest.salidaMs) {
                            latestClosedIdByCircuito.set(r.circuitoId, { id: r.id, salidaMs });
                            latestClosedByCircuito.set(r.circuitoId, {
                                salida_at: r.salidaAt.toISOString(),
                                box_name: boxName || 'Box previo',
                                zone_name: zoneName,
                                row_id: r.id,
                            });
                        }
                        if (r.tractorId) {
                            const prevAsset = latestClosedIdByAsset.get(`t_${r.tractorId}`);
                            if (!prevAsset || salidaMs > prevAsset.salidaMs) {
                                latestClosedIdByAsset.set(`t_${r.tractorId}`, { id: r.id, salidaMs });
                            }
                        }
                        if (r.semiId) {
                            const prevAsset = latestClosedIdByAsset.get(`s_${r.semiId}`);
                            if (!prevAsset || salidaMs > prevAsset.salidaMs) {
                                latestClosedIdByAsset.set(`s_${r.semiId}`, { id: r.id, salidaMs });
                            }
                        }
                    }
                }
                const activos = [];
                const holds = [];
                for (const r of openRows) {
                    const boxInfo = r.boxId ? index.boxesMap.get(r.boxId) : null;
                    const zoneName = boxInfo?.zone_name || index.zonesMap.get(r.zoneId) || '';
                    const boxName = boxInfo?.box_name || '';
                    const tractorPlate = r.tractorId ? index.tractoresMap.get(r.tractorId) || '' : '';
                    const semiPlate = r.semiId ? index.semisMap.get(r.semiId) || '' : '';
                    const virtualUnit = this.resolveVirtualUnit(index, r.tractorId, r.semiId);
                    const usuariosIds = Array.isArray(r.usuariosIds) ? r.usuariosIds : [];
                    const usuariosNombres = usuariosIds.map((uid) => index.usersMap.get(uid) || 'Operario');
                    const circuitNotes = notesByCircuito.get(r.circuitoId) || [];
                    const lastNote = circuitNotes.length > 0 ? circuitNotes[circuitNotes.length - 1] : null;
                    const prevClosed = latestClosedByCircuito.get(r.circuitoId) || null;
                    // 1. Filas PREASIGNADO (pendiente_at solamente) -> proyectadas en holds[]
                    if (this.isPendingRow(r)) {
                        const activeUnfinalized = (r.tractorId && activeUnfinalizedByAsset.get(`t_${r.tractorId}`)) ||
                            (r.semiId && activeUnfinalizedByAsset.get(`s_${r.semiId}`)) ||
                            null;
                        const ubicacionBox = activeUnfinalized?.box_name || prevClosed?.box_name || null;
                        const ubicacionZone = activeUnfinalized?.zone_name || prevClosed?.zone_name || null;
                        holds.push({
                            hold_id: r.id,
                            circuito_id: r.circuitoId,
                            unidad_id: virtualUnit.unidad_id,
                            n_ute: virtualUnit.n_ute,
                            tractor_id: r.tractorId,
                            tractor_plate: tractorPlate,
                            semi_id: r.semiId,
                            semi_plate: semiPlate,
                            tractor_n: r.tractorN,
                            semi_n: r.semiN,
                            modalidad_tracking: this.resolveModalidad(r.tractorId, r.semiId),
                            zone_id: r.zoneId,
                            zone_name: zoneName,
                            box_id: r.boxId,
                            box_name: boxName,
                            orden: 1,
                            usuarios_ids: usuariosIds,
                            usuarios_nombres: usuariosNombres,
                            nota_planificacion: lastNote?.texto || null,
                            notes: circuitNotes,
                            proceso_origen_id: null,
                            created_at: r.pendienteAt.toISOString(),
                            updated_at: r.updatedAt.toISOString(),
                            salida_previa_at: prevClosed?.salida_at || null,
                            salida_origen_box: ubicacionBox,
                            salida_origen_zone: ubicacionZone,
                            ultima_tarea: lastNote?.texto || null,
                            ultima_tarea_usuario: lastNote?.usuario || null,
                            ultima_tarea_at: lastNote?.timestamp || null,
                            en_proceso_activo: Boolean(activeUnfinalized),
                            ubicacion_actual_box: ubicacionBox,
                            ubicacion_actual_zone: ubicacionZone,
                        });
                        continue;
                    }
                    // 2. Filas FINALIZÓ / TERMINADO (salida_at IS NOT NULL):
                    // Permanece visible únicamente si ni su circuito ni su activo físico tienen PREASIGNADO ni estadía activa,
                    // proyectando como máximo la salida más reciente (0 duplicaciones).
                    if (r.salidaAt) {
                        if (circuitosConPasoAbierto.has(r.circuitoId)) {
                            continue;
                        }
                        if (r.tractorId && assetsConPasoAbierto.has(`t_${r.tractorId}`)) {
                            continue;
                        }
                        if (r.semiId && assetsConPasoAbierto.has(`s_${r.semiId}`)) {
                            continue;
                        }
                        const bestClosed = latestClosedIdByCircuito.get(r.circuitoId);
                        if (bestClosed && bestClosed.id !== r.id) {
                            continue;
                        }
                        if (r.tractorId && latestClosedIdByAsset.get(`t_${r.tractorId}`)?.id !== r.id) {
                            continue;
                        }
                        if (r.semiId && latestClosedIdByAsset.get(`s_${r.semiId}`)?.id !== r.id) {
                            continue;
                        }
                    }
                    // 3. Filas operativas visibles (ESPERANDO A SER INGRESADO A BOX / TRABAJANDO / FINALIZÓ) -> activos[]
                    activos.push({
                        proceso_id: r.id,
                        circuito_id: r.circuitoId,
                        unidad_id: virtualUnit.unidad_id,
                        n_ute: virtualUnit.n_ute,
                        tractor_id: r.tractorId,
                        tractor_plate: tractorPlate,
                        semi_id: r.semiId,
                        semi_plate: semiPlate,
                        tractor_n: r.tractorN,
                        semi_n: r.semiN,
                        modalidad_tracking: this.resolveModalidad(r.tractorId, r.semiId),
                        box_id: r.boxId || '',
                        box_name: boxName,
                        zone_id: r.zoneId,
                        zone_name: zoneName,
                        estado_proceso: this.resolveEstado(r.llegadaZonaAt, r.ingresoBoxAt, r.salidaAt),
                        etapa_ciclo: 'ACTIVO_HOT',
                        pendiente_at: r.pendienteAt.toISOString(),
                        llegada_at: (r.llegadaZonaAt || r.pendienteAt).toISOString(),
                        inicio_at: r.ingresoBoxAt ? r.ingresoBoxAt.toISOString() : null,
                        salida_at: r.salidaAt ? r.salidaAt.toISOString() : null,
                        circuito_cerrado_at: r.circuitoCerradoAt ? r.circuitoCerradoAt.toISOString() : null,
                        usuarios_ids: usuariosIds,
                        usuarios_nombres: usuariosNombres,
                        notes: circuitNotes,
                        salida_previa_at: prevClosed && prevClosed.row_id !== r.id ? prevClosed.salida_at : null,
                        salida_origen_box: prevClosed && prevClosed.row_id !== r.id ? prevClosed.box_name : null,
                        salida_origen_zone: prevClosed && prevClosed.row_id !== r.id ? prevClosed.zone_name : null,
                        ultima_tarea: lastNote?.texto || null,
                        ultima_tarea_usuario: lastNote?.usuario || null,
                        ultima_tarea_at: lastNote?.timestamp || null,
                    });
                }
                const etag = this.computeEtag({
                    activos,
                    holds,
                    zones: catalog.zones,
                    boxes: catalog.boxes,
                });
                this.cache = {
                    activos,
                    holds,
                    catalog,
                    etag,
                    updatedAt: Date.now(),
                };
                return this.cache;
            }
            finally {
                this.refreshingPromise = null;
            }
        })();
        return this.refreshingPromise;
    }
    async getBoardSnapshot() {
        if (!this.cache) {
            return this.hydrateBoard(true);
        }
        return this.cache;
    }
    invalidate(forceCatalog = false) {
        if (forceCatalog) {
            this.lastCatalogRefresh = 0;
            this.cachedCatalog = null;
            this.runtimeIndex = null;
        }
        this.cache = null;
    }
    /**
     * Sweep semanal hacia base.procesos_cold (circuitos con circuito_cerrado_at <= now() - retencion).
     */
    async ejecutarSweepSemanalCold(retencion = '7 days') {
        const res = await index_js_1.pool.query(`SELECT archived_rows, archived_circuits FROM base.fn_archivar_circuitos_semanal($1::interval);`, [retencion]);
        const row = res.rows[0];
        return {
            archivedRows: Number(row?.archived_rows || 0),
            archivedCircuits: Number(row?.archived_circuits || 0),
        };
    }
    /**
     * Inicia el job ligero de barrido semanal automático (al arranque + chequeo diario con advisory lock).
     */
    startWeeklyColdSweepScheduler() {
        if (this.sweepTimer)
            return;
        const runSafe = async () => {
            try {
                const res = await this.ejecutarSweepSemanalCold('7 days');
                if (res.archivedRows > 0) {
                    console.log(`[Sweep Semanal Cold] Archivadas ${res.archivedRows} filas (${res.archivedCircuits} circuitos > 7 días) hacia base.procesos_cold.`);
                }
            }
            catch (err) {
                console.warn('[Sweep Semanal Cold] Advertencia en barrido programado:', err instanceof Error ? err.message : String(err));
            }
        };
        // Primer chequeo no bloqueante a los 15s del arranque + cada 24 hs
        setTimeout(() => void runSafe(), 15_000).unref();
        this.sweepTimer = setInterval(() => void runSafe(), WEEKLY_SWEEP_INTERVAL_MS);
        this.sweepTimer.unref();
    }
    async fetchNotesMapByCircuitos(circuitoIds, usersMap) {
        const map = new Map();
        if (circuitoIds.length === 0)
            return map;
        const uniqueIds = Array.from(new Set(circuitoIds));
        const rows = await index_js_1.db
            .select({
            id: schema_js_1.procesosNotas.id,
            circuitoId: schema_js_1.procesosNotas.circuitoId,
            usuarioId: schema_js_1.procesosNotas.usuarioId,
            location: schema_js_1.procesosNotas.location,
            texto: schema_js_1.procesosNotas.texto,
            createdAt: schema_js_1.procesosNotas.createdAt,
            editedAt: schema_js_1.procesosNotas.editedAt,
        })
            .from(schema_js_1.procesosNotas)
            .where((0, drizzle_orm_1.inArray)(schema_js_1.procesosNotas.circuitoId, uniqueIds))
            .orderBy((0, drizzle_orm_1.asc)(schema_js_1.procesosNotas.createdAt));
        for (const r of rows) {
            const dto = this.mapNotaRow(r, usersMap);
            const list = map.get(r.circuitoId);
            if (list)
                list.push(dto);
            else
                map.set(r.circuitoId, [dto]);
        }
        return map;
    }
    /**
     * Consulta C2 On-Demand paginada de estadías finalizadas (une ventana reciente en base.procesos + store semanal base.procesos_cold).
     */
    async getFinalizados(limit = 50, offset = 0) {
        const { index } = await this.ensureRuntimeIndex();
        const res = await index_js_1.pool.query(`
      SELECT
        id, circuito_id, tractor_id, semi_id, tractor_n, semi_n,
        zone_id, pendiente_at, llegada_zona_at, box_id, ingreso_box_at,
        usuarios_ids, salida_at, circuito_cerrado_at,
        'ACTIVO_HOT'::text AS etapa_origen
      FROM base.procesos
      WHERE salida_at IS NOT NULL
      UNION ALL
      SELECT
        id, circuito_id, tractor_id, semi_id, tractor_n, semi_n,
        zone_id, pendiente_at, llegada_zona_at, box_id, ingreso_box_at,
        usuarios_ids, salida_at, circuito_cerrado_at,
        'HISTORICO_COLD'::text AS etapa_origen
      FROM base.procesos_cold
      WHERE salida_at IS NOT NULL
      ORDER BY salida_at DESC
      LIMIT $1 OFFSET $2;
      `, [limit, offset]);
        const circuitoIds = res.rows.map((r) => String(r.circuito_id));
        const notesMap = await this.fetchNotesMapByCircuitos(circuitoIds, index.usersMap);
        return res.rows.map((r) => {
            const boxInfo = r.box_id ? index.boxesMap.get(String(r.box_id)) : null;
            const zoneId = r.zone_id ? String(r.zone_id) : boxInfo?.zone_id || '';
            const zoneName = boxInfo?.zone_name || (zoneId ? index.zonesMap.get(zoneId) || '' : '');
            const tractorId = r.tractor_id ? String(r.tractor_id) : null;
            const semiId = r.semi_id ? String(r.semi_id) : null;
            const virtualUnit = this.resolveVirtualUnit(index, tractorId, semiId);
            const usuariosIds = Array.isArray(r.usuarios_ids) ? r.usuarios_ids : [];
            const notes = notesMap.get(String(r.circuito_id)) || [];
            return {
                proceso_id: String(r.id),
                circuito_id: String(r.circuito_id),
                unidad_id: virtualUnit.unidad_id,
                n_ute: virtualUnit.n_ute,
                tractor_id: tractorId,
                tractor_plate: tractorId ? index.tractoresMap.get(tractorId) || '' : '',
                semi_id: semiId,
                semi_plate: semiId ? index.semisMap.get(semiId) || '' : '',
                tractor_n: r.tractor_n ? String(r.tractor_n) : null,
                semi_n: r.semi_n ? String(r.semi_n) : null,
                modalidad_tracking: this.resolveModalidad(tractorId, semiId),
                box_id: r.box_id ? String(r.box_id) : '',
                box_name: boxInfo?.box_name || '',
                zone_id: zoneId,
                zone_name: zoneName,
                estado_proceso: 'FINALIZADO',
                etapa_ciclo: r.etapa_origen === 'HISTORICO_COLD' ? 'HISTORICO_COLD' : 'ACTIVO_HOT',
                pendiente_at: new Date(String(r.pendiente_at)).toISOString(),
                llegada_at: new Date(String(r.llegada_zona_at || r.pendiente_at)).toISOString(),
                inicio_at: r.ingreso_box_at ? new Date(String(r.ingreso_box_at)).toISOString() : null,
                salida_at: r.salida_at ? new Date(String(r.salida_at)).toISOString() : null,
                circuito_cerrado_at: r.circuito_cerrado_at
                    ? new Date(String(r.circuito_cerrado_at)).toISOString()
                    : null,
                usuarios_ids: usuariosIds,
                usuarios_nombres: usuariosIds.map((uid) => index.usersMap.get(uid) || 'Operario'),
                notes,
            };
        });
    }
    /**
     * Reconstruye la trayectoria cronológica completa (C2 On-Demand) de un tractor/semi/unidad virtual.
     * Cumple /db-clean-views: `timeline` expone 0 UUIDs sustitutos (solo datos naturales de negocio).
     */
    async getTrayectoriaUnidad(params) {
        const startedAt = node_perf_hooks_1.performance.now();
        const { index } = await this.ensureRuntimeIndex();
        let tId = params.tractorId || null;
        let sId = params.semiId || null;
        if (!tId && !sId && params.unidadId) {
            const u = index.unidadById.get(params.unidadId);
            if (u) {
                tId = u.tractor_id;
                sId = u.semi_id;
            }
        }
        if (!tId && !sId) {
            return {
                historial: [],
                ubicacion_actual: [],
                recorrido_programado: [],
                timeline: [],
                eventos: [],
                queryMs: 0,
            };
        }
        const hotConds = [];
        const coldConds = [];
        if (tId) {
            hotConds.push((0, drizzle_orm_1.eq)(schema_js_1.procesos.tractorId, tId));
            coldConds.push((0, drizzle_orm_1.eq)(schema_js_1.procesosCold.tractorId, tId));
        }
        if (sId) {
            hotConds.push((0, drizzle_orm_1.eq)(schema_js_1.procesos.semiId, sId));
            coldConds.push((0, drizzle_orm_1.eq)(schema_js_1.procesosCold.semiId, sId));
        }
        const filterHot = hotConds.length === 1 ? hotConds[0] : (0, drizzle_orm_1.or)(...hotConds);
        const filterCold = coldConds.length === 1 ? coldConds[0] : (0, drizzle_orm_1.or)(...coldConds);
        const [coldRows, hotRows] = await Promise.all([
            index_js_1.db.select().from(schema_js_1.procesosCold).where(filterCold).orderBy((0, drizzle_orm_1.asc)(schema_js_1.procesosCold.pendienteAt)),
            index_js_1.db.select().from(schema_js_1.procesos).where(filterHot).orderBy((0, drizzle_orm_1.asc)(schema_js_1.procesos.pendienteAt)),
        ]);
        const allCircuitoIds = [
            ...coldRows.map((r) => r.circuitoId),
            ...hotRows.map((r) => r.circuitoId),
        ];
        const notesMap = await this.fetchNotesMapByCircuitos(allCircuitoIds, index.usersMap);
        const mapToCard = (r, etapa) => {
            const boxInfo = r.boxId ? index.boxesMap.get(r.boxId) : null;
            const zoneId = r.zoneId || boxInfo?.zone_id || '';
            const zoneName = boxInfo?.zone_name || (zoneId ? index.zonesMap.get(zoneId) || '' : '');
            const virtualUnit = this.resolveVirtualUnit(index, r.tractorId, r.semiId);
            const uIds = Array.isArray(r.usuariosIds) ? r.usuariosIds : [];
            const notes = notesMap.get(r.circuitoId) || [];
            return {
                proceso_id: r.id,
                circuito_id: r.circuitoId,
                unidad_id: virtualUnit.unidad_id,
                n_ute: virtualUnit.n_ute,
                tractor_id: r.tractorId,
                tractor_plate: r.tractorId ? index.tractoresMap.get(r.tractorId) || '' : '',
                semi_id: r.semiId,
                semi_plate: r.semiId ? index.semisMap.get(r.semiId) || '' : '',
                tractor_n: r.tractorN,
                semi_n: r.semiN,
                modalidad_tracking: this.resolveModalidad(r.tractorId, r.semiId),
                box_id: r.boxId || '',
                box_name: boxInfo?.box_name || '',
                zone_id: zoneId,
                zone_name: zoneName,
                estado_proceso: this.resolveEstado(r.llegadaZonaAt, r.ingresoBoxAt, r.salidaAt),
                etapa_ciclo: etapa,
                pendiente_at: r.pendienteAt.toISOString(),
                llegada_at: (r.llegadaZonaAt || r.pendienteAt).toISOString(),
                inicio_at: r.ingresoBoxAt ? r.ingresoBoxAt.toISOString() : null,
                salida_at: r.salidaAt ? r.salidaAt.toISOString() : null,
                circuito_cerrado_at: r.circuitoCerradoAt ? r.circuitoCerradoAt.toISOString() : null,
                usuarios_ids: uIds,
                usuarios_nombres: uIds.map((uid) => index.usersMap.get(uid) || 'Operario'),
                notes,
            };
        };
        const historial = [
            ...coldRows.map((r) => mapToCard(r, 'HISTORICO_COLD')),
            ...hotRows
                .filter((r) => Boolean(r.salidaAt || r.circuitoCerradoAt))
                .map((r) => mapToCard(r, r.circuitoCerradoAt ? 'HISTORICO_COLD' : 'ACTIVO_HOT')),
        ];
        const ubicacionActual = hotRows
            .filter((r) => !r.circuitoCerradoAt && !r.salidaAt && !this.isPendingRow(r))
            .map((r) => mapToCard(r, 'ACTIVO_HOT'));
        const pendingHotRows = hotRows.filter((r) => !r.circuitoCerradoAt && this.isPendingRow(r));
        const recorridoProgramado = pendingHotRows.map((r) => {
            const card = mapToCard(r, 'PLANIFICADO_HOLD');
            const lastNote = card.notes.length > 0 ? card.notes[card.notes.length - 1] : null;
            return {
                hold_id: r.id,
                circuito_id: r.circuitoId,
                unidad_id: card.unidad_id,
                n_ute: card.n_ute,
                tractor_id: r.tractorId,
                tractor_plate: card.tractor_plate,
                semi_id: r.semiId,
                semi_plate: card.semi_plate,
                modalidad_tracking: card.modalidad_tracking,
                zone_id: card.zone_id,
                zone_name: card.zone_name,
                box_id: r.boxId,
                box_name: card.box_name,
                orden: 1,
                usuarios_ids: card.usuarios_ids,
                usuarios_nombres: card.usuarios_nombres,
                nota_planificacion: lastNote?.texto || null,
                notes: card.notes,
                created_at: r.pendienteAt.toISOString(),
                updated_at: r.updatedAt.toISOString(),
            };
        });
        const diffMin = (a, b) => {
            if (!a || !b)
                return null;
            const ms = new Date(b).getTime() - new Date(a).getTime();
            return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 60000) : null;
        };
        const toCleanStep = (c, etapa) => ({
            etapa_ciclo: etapa,
            estado_proceso: c.estado_proceso,
            box_name: c.box_name || 'Sin Box asignado',
            zone_name: c.zone_name,
            orden: null,
            llegada_at: c.llegada_at,
            inicio_at: c.inicio_at,
            salida_at: c.salida_at,
            duracion_espera_min: diffMin(c.llegada_at, c.inicio_at),
            duracion_trabajo_min: diffMin(c.inicio_at, c.salida_at),
            duracion_total_min: diffMin(c.llegada_at, c.salida_at),
            usuarios_nombres: c.usuarios_nombres,
            nota_planificacion: null,
            notes_count: c.notes.length,
            ultima_nota: c.notes.length > 0 ? c.notes[c.notes.length - 1].texto : null,
        });
        const timeline = [
            ...historial.map((c) => toCleanStep(c, c.etapa_ciclo === 'HISTORICO_COLD' ? 'HISTORICO_COLD' : 'ACTIVO_HOT')),
            ...ubicacionActual.map((c) => toCleanStep(c, 'ACTIVO_HOT')),
            ...recorridoProgramado.map((h) => ({
                etapa_ciclo: 'PLANIFICADO_HOLD',
                estado_proceso: 'PREASIGNADO',
                box_name: h.box_name || 'Sin Box asignado',
                zone_name: h.zone_name,
                orden: h.orden,
                llegada_at: null,
                inicio_at: null,
                salida_at: null,
                duracion_espera_min: null,
                duracion_trabajo_min: null,
                duracion_total_min: null,
                usuarios_nombres: h.usuarios_nombres,
                nota_planificacion: h.nota_planificacion,
                notes_count: h.notes ? h.notes.length : 0,
                ultima_nota: h.notes && h.notes.length > 0 ? h.notes[h.notes.length - 1].texto : null,
            })),
        ];
        const queryMs = Number((node_perf_hooks_1.performance.now() - startedAt).toFixed(2));
        return {
            historial,
            ubicacion_actual: ubicacionActual,
            recorrido_programado: recorridoProgramado,
            timeline,
            eventos: [],
            queryMs,
        };
    }
    /**
     * Consulta C2 On-Demand de detalle enriquecido (vencimientos + marca/modelo) para vista Deployed.
     */
    async getUnidadDetalleDeployed(params) {
        const tr = (params.tractorPlate || '').trim();
        const sm = (params.semiPlate || '').trim();
        const ute = (params.nUte || '').trim();
        if (!tr && !sm && !ute)
            return null;
        const res = await index_js_1.pool.query(`
      SELECT
        COALESCE(u.n_ute, pu.n_ute, '') AS n_ute,
        COALESCE(bt.dominio, pt.patente, '') AS tractor,
        COALESCE(pt.marca, '') AS marca_tr,
        COALESCE(pt.modelo, '') AS modelo_tr,
        pt.vtv AS vtv_tr,
        pt.mas AS mas_tr,
        COALESCE(bs.dominio, ps.patente, '') AS semi,
        COALESCE(ps.marca, '') AS marca_semi,
        COALESCE(ps.cisternado, '') AS cisternado,
        ps.vtv AS vtv_semi,
        ps.mas AS mas_semi,
        COALESCE(ps.esp_es, '') AS esp_es,
        COALESCE(ps.vi, '') AS vi,
        COALESCE(ps.ve, '') AS ve,
        COALESCE(su.denominacion, 'GENERAL') AS servicio,
        COALESCE(pu.estado, 'disponible') AS estado_operativo
      FROM base.unidades u
      LEFT JOIN public.unidades pu ON pu.id = u.id
      LEFT JOIN base.tractores bt ON bt.id = u.tractor_id
      LEFT JOIN public.tractores pt ON pt.id = u.tractor_id
      LEFT JOIN base.semis bs ON bs.id = u.semi_id
      LEFT JOIN public.semis ps ON ps.id = u.semi_id
      LEFT JOIN public.servicios_unidades su ON su.id = pu.servicio_id
      WHERE ($1 <> '' AND COALESCE(bt.dominio, pt.patente, '') = $1)
         OR ($2 <> '' AND COALESCE(bs.dominio, ps.patente, '') = $2)
         OR ($3 <> '' AND COALESCE(u.n_ute, pu.n_ute, '') = $3)
      LIMIT 1;
      `, [tr, sm, ute]);
        return res.rows[0] || null;
    }
    /**
     * Encuentra el circuito_id abierto de un activo físico (si existe) para heredar el hilo del circuito.
     */
    async findOpenCircuitoId(tx, tractorId, semiId) {
        const conds = [];
        if (tractorId)
            conds.push((0, drizzle_orm_1.eq)(schema_js_1.procesos.tractorId, tractorId));
        if (semiId)
            conds.push((0, drizzle_orm_1.eq)(schema_js_1.procesos.semiId, semiId));
        if (conds.length === 0)
            return null;
        const existing = await tx
            .select({ circuitoId: schema_js_1.procesos.circuitoId })
            .from(schema_js_1.procesos)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(schema_js_1.procesos.circuitoCerradoAt), conds.length === 1 ? conds[0] : (0, drizzle_orm_1.or)(...conds)))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.procesos.pendienteAt))
            .limit(1);
        return existing.length > 0 ? existing[0].circuitoId : null;
    }
    async assertSinProcesoActivoColision(tx, params) {
        const conds = [];
        if (params.tractorId)
            conds.push((0, drizzle_orm_1.eq)(schema_js_1.procesos.tractorId, params.tractorId));
        if (params.semiId)
            conds.push((0, drizzle_orm_1.eq)(schema_js_1.procesos.semiId, params.semiId));
        if (conds.length === 0)
            return;
        const existing = await tx
            .select({ id: schema_js_1.procesos.id, boxName: schema_js_1.boxes.boxName })
            .from(schema_js_1.procesos)
            .leftJoin(schema_js_1.boxes, (0, drizzle_orm_1.eq)(schema_js_1.procesos.boxId, schema_js_1.boxes.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(schema_js_1.procesos.salidaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.circuitoCerradoAt), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNotNull)(schema_js_1.procesos.llegadaZonaAt), (0, drizzle_orm_1.isNotNull)(schema_js_1.procesos.ingresoBoxAt)), (0, drizzle_orm_1.ne)(schema_js_1.procesos.id, params.excludeProcesoId), conds.length === 1 ? conds[0] : (0, drizzle_orm_1.or)(...conds)))
            .limit(1);
        if (existing.length > 0) {
            const boxName = existing[0].boxName || 'otro Box';
            throw new ConflictError(`No se puede reabrir el proceso porque la unidad ya tiene una estadía activa en ${boxName}.`);
        }
    }
    /**
     * Registra llegada directa a un Box (pendiente_at = llegada_zona_at = now(), box_id = p_box_id).
     */
    async registrarLlegadaBox(input) {
        const { index } = await this.ensureRuntimeIndex();
        const res = await index_js_1.db.transaction(async (tx) => {
            const { tractorId, semiId } = await this.resolvePhysicalAssets(tx, input);
            const boxRow = await tx
                .select({ id: schema_js_1.boxes.id, zoneId: schema_js_1.boxes.zoneId, boxName: schema_js_1.boxes.boxName })
                .from(schema_js_1.boxes)
                .where((0, drizzle_orm_1.eq)(schema_js_1.boxes.id, input.boxId))
                .limit(1);
            if (boxRow.length === 0) {
                throw new NotFoundError(`El box (${input.boxId}) no existe en base.boxes`);
            }
            const openCircuitoId = (await this.findOpenCircuitoId(tx, tractorId, semiId)) || node_crypto_1.default.randomUUID();
            // Cerrar cualquier estadía activa previa del mismo tractor/semi (mantiene fila en el circuito)
            const assetConds = [];
            if (tractorId)
                assetConds.push((0, drizzle_orm_1.eq)(schema_js_1.procesos.tractorId, tractorId));
            if (semiId)
                assetConds.push((0, drizzle_orm_1.eq)(schema_js_1.procesos.semiId, semiId));
            await tx
                .update(schema_js_1.procesos)
                .set({
                salidaAt: (0, drizzle_orm_1.sql) `GREATEST(now(), COALESCE(${schema_js_1.procesos.ingresoBoxAt}, ${schema_js_1.procesos.llegadaZonaAt}, ${schema_js_1.procesos.pendienteAt}))`,
                updatedAt: (0, drizzle_orm_1.sql) `now()`,
            })
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(schema_js_1.procesos.salidaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.circuitoCerradoAt), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNotNull)(schema_js_1.procesos.llegadaZonaAt), (0, drizzle_orm_1.isNotNull)(schema_js_1.procesos.ingresoBoxAt)), assetConds.length === 1 ? assetConds[0] : (0, drizzle_orm_1.or)(...assetConds)));
            const now = new Date();
            const [created] = await tx
                .insert(schema_js_1.procesos)
                .values({
                circuitoId: openCircuitoId,
                tractorId,
                semiId,
                zoneId: boxRow[0].zoneId,
                boxId: input.boxId,
                pendienteAt: now,
                llegadaZonaAt: now,
                usuariosIds: input.usuariosIds || [],
            })
                .returning();
            if (input.notaTexto && input.notaTexto.trim()) {
                const isCoord = !input.notaUsuarioId;
                await tx.insert(schema_js_1.procesosNotas).values({
                    circuitoId: openCircuitoId,
                    procesoId: created.id,
                    usuarioId: isCoord ? null : input.notaUsuarioId,
                    location: isCoord ? 'Coordinación' : boxRow[0].boxName,
                    texto: input.notaTexto.trim(),
                });
            }
            const virtualUnit = this.resolveVirtualUnit(index, created.tractorId, created.semiId);
            return {
                ...created,
                proceso_id: created.id,
                unidad_id: virtualUnit.unidad_id,
                tractor_id: created.tractorId,
                semi_id: created.semiId,
                box_id: created.boxId,
                llegada_at: (created.llegadaZonaAt || created.pendienteAt).toISOString(),
                inicio_at: created.ingresoBoxAt ? created.ingresoBoxAt.toISOString() : null,
                salida_at: created.salidaAt ? created.salidaAt.toISOString() : null,
            };
        });
        this.invalidate();
        await this.hydrateBoard();
        return res;
    }
    /**
     * Actualiza estado in-place sobre base.procesos (1 solo UPDATE por transición, mismo UUID).
     */
    async actualizarProceso(procesoId, patch) {
        const { index } = await this.ensureRuntimeIndex();
        const updated = await index_js_1.db.transaction(async (tx) => {
            const lockedRes = await tx.execute((0, drizzle_orm_1.sql) `SELECT * FROM base.procesos WHERE id = ${procesoId}::uuid FOR UPDATE`);
            if (lockedRes.rows.length === 0) {
                // Fallback: si se solicita REABRIR o REINTEGRAR_A_PREASIGNADO sobre un registro ya en procesos_cold (> 7 días)
                if (patch.action === 'REABRIR' || patch.action === 'REINTEGRAR_A_PREASIGNADO') {
                    const coldRes = await tx.execute((0, drizzle_orm_1.sql) `SELECT * FROM base.procesos_cold WHERE id = ${procesoId}::uuid FOR UPDATE`);
                    if (coldRes.rows.length > 0) {
                        const c = coldRes.rows[0];
                        const tractorId = c.tractor_id || null;
                        const semiId = c.semi_id || null;
                        if (patch.action === 'REINTEGRAR_A_PREASIGNADO') {
                            let targetZoneId = patch.zoneId || c.zone_id || null;
                            if (!targetZoneId && patch.boxId) {
                                const b = index.boxesMap.get(patch.boxId);
                                targetZoneId = b?.zone_id || null;
                            }
                            if (!targetZoneId)
                                throw new NotFoundError('No se pudo determinar la zona destino.');
                            const [ins] = await tx
                                .insert(schema_js_1.procesos)
                                .values({
                                circuitoId: String(c.circuito_id),
                                tractorId,
                                semiId,
                                zoneId: targetZoneId,
                                boxId: null,
                                pendienteAt: new Date(),
                                usuariosIds: [],
                            })
                                .returning();
                            return {
                                movedToHold: ins,
                                hold_id: ins.id,
                                proceso_id: ins.id,
                                zone_id: targetZoneId,
                                archived_from_finalizado: true,
                            };
                        }
                        await this.assertSinProcesoActivoColision(tx, {
                            excludeProcesoId: procesoId,
                            tractorId,
                            semiId,
                        });
                        const targetEstado = patch.targetEstado || (c.ingreso_box_at ? 'INICIO' : 'LLEGADA');
                        const nextBoxId = patch.boxId || c.box_id || null;
                        const nextZoneId = (nextBoxId && index.boxesMap.get(nextBoxId)?.zone_id) ||
                            c.zone_id;
                        const pendDate = new Date(String(c.pendiente_at));
                        const llegDate = new Date(String(c.llegada_zona_at || c.pendiente_at));
                        const nextIngDate = targetEstado === 'LLEGADA'
                            ? null
                            : c.ingreso_box_at
                                ? new Date(String(c.ingreso_box_at))
                                : new Date(Math.max(Date.now(), llegDate.getTime()));
                        const [reopened] = await tx
                            .insert(schema_js_1.procesos)
                            .values({
                            id: String(c.id),
                            circuitoId: String(c.circuito_id),
                            tractorId,
                            semiId,
                            tractorN: c.tractor_n || null,
                            semiN: c.semi_n || null,
                            zoneId: nextZoneId,
                            boxId: nextBoxId,
                            pendienteAt: pendDate,
                            llegadaZonaAt: llegDate,
                            ingresoBoxAt: nextIngDate,
                            salidaAt: null,
                            circuitoCerradoAt: null,
                            usuariosIds: patch.usuariosIds !== undefined
                                ? patch.usuariosIds
                                : Array.isArray(c.usuarios_ids)
                                    ? c.usuarios_ids
                                    : [],
                        })
                            .returning();
                        await tx.delete(schema_js_1.procesosCold).where((0, drizzle_orm_1.eq)(schema_js_1.procesosCold.id, procesoId));
                        const vu = this.resolveVirtualUnit(index, reopened.tractorId, reopened.semiId);
                        return {
                            ...reopened,
                            proceso_id: reopened.id,
                            unidad_id: vu.unidad_id,
                            tractor_id: reopened.tractorId,
                            semi_id: reopened.semiId,
                            llegada_at: (reopened.llegadaZonaAt || reopened.pendienteAt).toISOString(),
                            inicio_at: reopened.ingresoBoxAt ? reopened.ingresoBoxAt.toISOString() : null,
                            salida_at: null,
                        };
                    }
                }
                throw new NotFoundError('Proceso no encontrado en base.procesos ni en base.procesos_cold');
            }
            const current = lockedRes.rows[0];
            // 1. EGRESO PLANTA (ARCHIVAR): cierra el circuito completo (retención 7 días antes del sweep semanal a cold)
            if (patch.action === 'ARCHIVAR') {
                const closedRows = await tx
                    .update(schema_js_1.procesos)
                    .set({
                    salidaAt: (0, drizzle_orm_1.sql) `COALESCE(${schema_js_1.procesos.salidaAt}, GREATEST(now(), COALESCE(${schema_js_1.procesos.ingresoBoxAt}, ${schema_js_1.procesos.llegadaZonaAt}, ${schema_js_1.procesos.pendienteAt})))`,
                    circuitoCerradoAt: (0, drizzle_orm_1.sql) `now()`,
                    updatedAt: (0, drizzle_orm_1.sql) `now()`,
                })
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.procesos.circuitoId, current.circuito_id), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.circuitoCerradoAt)))
                    .returning();
                return {
                    archivedToCold: closedRows[0] || current,
                    circuito_id: current.circuito_id,
                    closed_rows: closedRows.length,
                };
            }
            // 2. REVERTIR A HOLD (PREASIGNADO): UPDATE in-place en base.procesos (mismo UUID, 0 deletes!)
            if (patch.action === 'REVERTIR_A_HOLD') {
                if (current.salida_at) {
                    throw new ConflictError('No se puede revertir a pendiente un proceso ya finalizado.');
                }
                const targetZoneId = patch.zoneId || current.zone_id;
                // Multi-PREASIGNADO: solo impide duplicar un PREASIGNADO en la MISMA zona destino
                const assetConds = [];
                if (current.tractor_id)
                    assetConds.push((0, drizzle_orm_1.eq)(schema_js_1.procesos.tractorId, current.tractor_id));
                if (current.semi_id)
                    assetConds.push((0, drizzle_orm_1.eq)(schema_js_1.procesos.semiId, current.semi_id));
                if (assetConds.length > 0) {
                    const otherPendingSameZone = await tx
                        .select({ id: schema_js_1.procesos.id })
                        .from(schema_js_1.procesos)
                        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.ne)(schema_js_1.procesos.id, current.id), (0, drizzle_orm_1.eq)(schema_js_1.procesos.zoneId, targetZoneId), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.llegadaZonaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.ingresoBoxAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.salidaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.circuitoCerradoAt), assetConds.length === 1 ? assetConds[0] : (0, drizzle_orm_1.or)(...assetConds)))
                        .limit(1);
                    if (otherPendingSameZone.length > 0) {
                        throw new ConflictError('La unidad ya posee una tarjeta PREASIGNADO en esta misma zona.');
                    }
                }
                const [reverted] = await tx
                    .update(schema_js_1.procesos)
                    .set({
                    llegadaZonaAt: null,
                    ingresoBoxAt: null,
                    salidaAt: null,
                    boxId: null,
                    zoneId: targetZoneId,
                    updatedAt: (0, drizzle_orm_1.sql) `now()`,
                })
                    .where((0, drizzle_orm_1.eq)(schema_js_1.procesos.id, current.id))
                    .returning();
                return { revertedToHold: reverted, hold_id: reverted.id };
            }
            // 3. DESPRENDER PREASIGNADO EN NUEVA ZONA (desde FINALIZÓ, activo u otro PREASIGNADO — Multi-Preasignado)
            if (patch.action === 'REINTEGRAR_A_PREASIGNADO') {
                let targetZoneId = patch.zoneId || null;
                if (!targetZoneId && patch.boxId) {
                    targetZoneId = index.boxesMap.get(patch.boxId)?.zone_id || null;
                }
                if (!targetZoneId)
                    targetZoneId = current.zone_id;
                const assetConds = [];
                if (current.tractor_id)
                    assetConds.push((0, drizzle_orm_1.eq)(schema_js_1.procesos.tractorId, current.tractor_id));
                if (current.semi_id)
                    assetConds.push((0, drizzle_orm_1.eq)(schema_js_1.procesos.semiId, current.semi_id));
                // Multi-PREASIGNADO: solo reutiliza si ya existe un PREASIGNADO en la MISMA zona destino
                const existingPendingSameZone = assetConds.length > 0
                    ? await tx
                        .select({ id: schema_js_1.procesos.id })
                        .from(schema_js_1.procesos)
                        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.procesos.zoneId, targetZoneId), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.llegadaZonaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.ingresoBoxAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.salidaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.circuitoCerradoAt), assetConds.length === 1 ? assetConds[0] : (0, drizzle_orm_1.or)(...assetConds)))
                        .limit(1)
                    : [];
                let holdRow;
                if (existingPendingSameZone.length > 0) {
                    const [upd] = await tx
                        .update(schema_js_1.procesos)
                        .set({
                        zoneId: targetZoneId,
                        boxId: null,
                        circuitoId: current.circuito_id,
                        updatedAt: (0, drizzle_orm_1.sql) `now()`,
                    })
                        .where((0, drizzle_orm_1.eq)(schema_js_1.procesos.id, existingPendingSameZone[0].id))
                        .returning();
                    holdRow = upd;
                }
                else {
                    const [ins] = await tx
                        .insert(schema_js_1.procesos)
                        .values({
                        circuitoId: current.circuito_id,
                        tractorId: current.tractor_id,
                        semiId: current.semi_id,
                        zoneId: targetZoneId,
                        boxId: null,
                        pendienteAt: new Date(),
                        usuariosIds: [],
                    })
                        .returning();
                    holdRow = ins;
                }
                // Si el proceso origen estaba cerrado (circuito_cerrado_at), reabrir el circuito
                if (current.circuito_cerrado_at) {
                    await tx
                        .update(schema_js_1.procesos)
                        .set({ circuitoCerradoAt: null })
                        .where((0, drizzle_orm_1.eq)(schema_js_1.procesos.id, current.id));
                }
                return {
                    movedToHold: holdRow,
                    hold_id: holdRow.id,
                    proceso_id: holdRow.id,
                    zone_id: targetZoneId,
                    archived_from_finalizado: Boolean(current.salida_at),
                };
            }
            // 4. Transiciones estándar in-place (INICIAR, DESHACER_INICIO, FINALIZAR, REABRIR, cambio de box/usuarios)
            const updates = {
                updatedAt: (0, drizzle_orm_1.sql) `now()`,
            };
            if (patch.boxId) {
                const bInfo = index.boxesMap.get(patch.boxId);
                updates.boxId = patch.boxId;
                if (bInfo)
                    updates.zoneId = bInfo.zone_id;
            }
            else if (patch.zoneId) {
                updates.zoneId = patch.zoneId;
            }
            if (patch.usuariosIds !== undefined) {
                updates.usuariosIds = patch.usuariosIds;
            }
            let pendingHold = null;
            let lastNoteText = null;
            if (patch.action === 'REABRIR') {
                if (current.salida_at || current.circuito_cerrado_at) {
                    await this.assertSinProcesoActivoColision(tx, {
                        excludeProcesoId: procesoId,
                        tractorId: current.tractor_id,
                        semiId: current.semi_id,
                    });
                }
                const targetEstado = patch.targetEstado || (current.ingreso_box_at ? 'INICIO' : 'LLEGADA');
                updates.salidaAt = null;
                updates.circuitoCerradoAt = null;
                if (!current.llegada_zona_at) {
                    updates.llegadaZonaAt = (0, drizzle_orm_1.sql) `GREATEST(now(), ${schema_js_1.procesos.pendienteAt})`;
                }
                if (targetEstado === 'LLEGADA') {
                    updates.ingresoBoxAt = null;
                }
                else if (!current.ingreso_box_at) {
                    updates.ingresoBoxAt = (0, drizzle_orm_1.sql) `GREATEST(now(), COALESCE(${schema_js_1.procesos.llegadaZonaAt}, ${schema_js_1.procesos.pendienteAt}))`;
                }
            }
            else if (patch.action === 'INICIAR') {
                if (current.salida_at) {
                    throw new ConflictError('No se puede iniciar directamente un proceso ya terminado; reabrilo primero desde Terminado.');
                }
                if (!current.box_id && !patch.boxId) {
                    throw new ConflictError('Debe asignarse un Box antes de confirmar ingreso_box_at (TRABAJANDO).');
                }
                if (!current.llegada_zona_at) {
                    updates.llegadaZonaAt = (0, drizzle_orm_1.sql) `GREATEST(now(), ${schema_js_1.procesos.pendienteAt})`;
                }
                if (!current.ingreso_box_at) {
                    updates.ingresoBoxAt = (0, drizzle_orm_1.sql) `GREATEST(now(), COALESCE(${schema_js_1.procesos.llegadaZonaAt}, ${schema_js_1.procesos.pendienteAt}))`;
                }
            }
            else if (patch.action === 'DESHACER_INICIO') {
                updates.ingresoBoxAt = null;
                updates.salidaAt = null;
                if (!current.llegada_zona_at) {
                    updates.llegadaZonaAt = current.pendiente_at;
                }
            }
            else if (patch.action === 'FINALIZAR') {
                if (!current.salida_at) {
                    updates.salidaAt = (0, drizzle_orm_1.sql) `GREATEST(now(), COALESCE(${schema_js_1.procesos.ingresoBoxAt}, ${schema_js_1.procesos.llegadaZonaAt}, ${schema_js_1.procesos.pendienteAt}))`;
                }
                // Consultar si ya existe un PREASIGNADO pendiente en este circuito para emitir alerta Socket.IO
                const [holdRows, noteRows] = await Promise.all([
                    tx
                        .select()
                        .from(schema_js_1.procesos)
                        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.procesos.circuitoId, current.circuito_id), (0, drizzle_orm_1.ne)(schema_js_1.procesos.id, current.id), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.llegadaZonaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.ingresoBoxAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.salidaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.circuitoCerradoAt)))
                        .limit(1),
                    tx
                        .select({ texto: schema_js_1.procesosNotas.texto })
                        .from(schema_js_1.procesosNotas)
                        .where((0, drizzle_orm_1.eq)(schema_js_1.procesosNotas.circuitoId, current.circuito_id))
                        .orderBy((0, drizzle_orm_1.desc)(schema_js_1.procesosNotas.createdAt))
                        .limit(1),
                ]);
                if (noteRows.length > 0) {
                    lastNoteText = noteRows[0].texto.trim();
                }
                if (holdRows.length > 0) {
                    const hr = holdRows[0];
                    const bInfo = hr.boxId ? index.boxesMap.get(hr.boxId) : null;
                    pendingHold = {
                        id: hr.id,
                        zone_id: hr.zoneId,
                        zone_name: bInfo?.zone_name || index.zonesMap.get(hr.zoneId) || '',
                        box_id: hr.boxId,
                        box_name: bInfo?.box_name || '',
                        orden: 1,
                        usuarios_ids: Array.isArray(hr.usuariosIds) ? hr.usuariosIds : [],
                    };
                }
            }
            const [row] = await tx
                .update(schema_js_1.procesos)
                .set(updates)
                .where((0, drizzle_orm_1.eq)(schema_js_1.procesos.id, procesoId))
                .returning();
            const vu = this.resolveVirtualUnit(index, row.tractorId, row.semiId);
            const boxInfo = row.boxId ? index.boxesMap.get(row.boxId) : null;
            return {
                ...row,
                proceso_id: row.id,
                unidad_id: vu.unidad_id,
                tractor_id: row.tractorId,
                semi_id: row.semiId,
                box_name: boxInfo?.box_name || '',
                llegada_at: (row.llegadaZonaAt || row.pendienteAt).toISOString(),
                inicio_at: row.ingresoBoxAt ? row.ingresoBoxAt.toISOString() : null,
                salida_at: row.salidaAt ? row.salidaAt.toISOString() : null,
                ultima_tarea: lastNoteText,
                pending_hold: pendingHold,
            };
        });
        this.invalidate();
        await this.hydrateBoard();
        return updated;
    }
    /**
     * Gestión de Notas Normalizadas por Circuito (base.procesos_notas - Opción C).
     * 0 PL/pgSQL complejo, 0 duplicación en Doble Carta, retorno retrocompatible { notes: [...] }.
     */
    async agregarNota(procesoId, usuarioId, texto, location) {
        const cleanText = texto.trim();
        if (!cleanText)
            throw new ConflictError('El texto de la nota no puede estar vacío.');
        const { index } = await this.ensureRuntimeIndex();
        const res = await index_js_1.db.transaction(async (tx) => {
            const procRows = await tx
                .select({ id: schema_js_1.procesos.id, circuitoId: schema_js_1.procesos.circuitoId, boxId: schema_js_1.procesos.boxId })
                .from(schema_js_1.procesos)
                .where((0, drizzle_orm_1.eq)(schema_js_1.procesos.id, procesoId))
                .limit(1);
            let circuitoId = procRows.length > 0 ? procRows[0].circuitoId : null;
            let boxId = procRows.length > 0 ? procRows[0].boxId : null;
            let linkedProcesoId = procRows.length > 0 ? procRows[0].id : null;
            if (!circuitoId) {
                const coldRows = await tx
                    .select({ circuitoId: schema_js_1.procesosCold.circuitoId, boxId: schema_js_1.procesosCold.boxId })
                    .from(schema_js_1.procesosCold)
                    .where((0, drizzle_orm_1.eq)(schema_js_1.procesosCold.id, procesoId))
                    .limit(1);
                if (coldRows.length === 0) {
                    throw new NotFoundError(`Proceso ${procesoId} no encontrado.`);
                }
                circuitoId = coldRows[0].circuitoId;
                boxId = coldRows[0].boxId;
                linkedProcesoId = null;
            }
            const isCoord = !usuarioId || location === 'Coordinación';
            const resolvedLocation = isCoord
                ? 'Coordinación'
                : location || (boxId ? index.boxesMap.get(boxId)?.box_name : null) || 'Box';
            await tx.insert(schema_js_1.procesosNotas).values({
                circuitoId,
                procesoId: linkedProcesoId,
                usuarioId: isCoord ? null : usuarioId,
                location: resolvedLocation,
                texto: cleanText,
            });
            const allNotes = await tx
                .select()
                .from(schema_js_1.procesosNotas)
                .where((0, drizzle_orm_1.eq)(schema_js_1.procesosNotas.circuitoId, circuitoId))
                .orderBy((0, drizzle_orm_1.asc)(schema_js_1.procesosNotas.createdAt));
            return {
                notes: allNotes.map((n) => this.mapNotaRow(n, index.usersMap)),
            };
        });
        this.invalidate();
        await this.hydrateBoard();
        return res;
    }
    async editarNota(procesoId, noteId, _usuarioId, nuevoTexto) {
        const cleanText = nuevoTexto.trim();
        if (!cleanText)
            throw new ConflictError('El texto editado no puede estar vacío.');
        const { index } = await this.ensureRuntimeIndex();
        const res = await index_js_1.db.transaction(async (tx) => {
            const [updatedNote] = await tx
                .update(schema_js_1.procesosNotas)
                .set({
                texto: cleanText,
                editedAt: new Date(),
            })
                .where((0, drizzle_orm_1.eq)(schema_js_1.procesosNotas.id, noteId))
                .returning();
            if (!updatedNote) {
                throw new NotFoundError(`Nota ${noteId} no encontrada.`);
            }
            const allNotes = await tx
                .select()
                .from(schema_js_1.procesosNotas)
                .where((0, drizzle_orm_1.eq)(schema_js_1.procesosNotas.circuitoId, updatedNote.circuitoId))
                .orderBy((0, drizzle_orm_1.asc)(schema_js_1.procesosNotas.createdAt));
            return {
                procesoId,
                notes: allNotes.map((n) => this.mapNotaRow(n, index.usersMap)),
            };
        });
        this.invalidate();
        await this.hydrateBoard();
        return res;
    }
    async eliminarNota(procesoId, noteId) {
        const { index } = await this.ensureRuntimeIndex();
        const res = await index_js_1.db.transaction(async (tx) => {
            const [deletedNote] = await tx
                .delete(schema_js_1.procesosNotas)
                .where((0, drizzle_orm_1.eq)(schema_js_1.procesosNotas.id, noteId))
                .returning();
            if (!deletedNote) {
                throw new NotFoundError(`Nota ${noteId} no encontrada.`);
            }
            const allNotes = await tx
                .select()
                .from(schema_js_1.procesosNotas)
                .where((0, drizzle_orm_1.eq)(schema_js_1.procesosNotas.circuitoId, deletedNote.circuitoId))
                .orderBy((0, drizzle_orm_1.asc)(schema_js_1.procesosNotas.createdAt));
            return {
                procesoId,
                notes: allNotes.map((n) => this.mapNotaRow(n, index.usersMap)),
            };
        });
        this.invalidate();
        await this.hydrateBoard();
        return res;
    }
    /**
     * Gestión de PREASIGNADO (ahora unificado directamente en base.procesos con llegada_zona_at = NULL).
     */
    async crearHold(input) {
        const { index } = await this.ensureRuntimeIndex();
        const result = await index_js_1.db.transaction(async (tx) => {
            const { tractorId, semiId } = await this.resolvePhysicalAssets(tx, input);
            let targetZoneId = input.zoneId;
            if (input.boxId) {
                const bInfo = index.boxesMap.get(input.boxId);
                if (bInfo)
                    targetZoneId = bInfo.zone_id;
            }
            // Heredar circuito_id si el tractor/semi ya tiene un circuito abierto (Doble Carta con notas compartidas)
            let openCircuitoId = await this.findOpenCircuitoId(tx, tractorId, semiId);
            if (!openCircuitoId && input.procesoOrigenId) {
                const orig = await tx
                    .select({ circuitoId: schema_js_1.procesos.circuitoId })
                    .from(schema_js_1.procesos)
                    .where((0, drizzle_orm_1.eq)(schema_js_1.procesos.id, input.procesoOrigenId))
                    .limit(1);
                if (orig.length > 0)
                    openCircuitoId = orig[0].circuitoId;
            }
            const circuitoId = openCircuitoId || node_crypto_1.default.randomUUID();
            const assetConds = [];
            if (tractorId)
                assetConds.push((0, drizzle_orm_1.eq)(schema_js_1.procesos.tractorId, tractorId));
            if (semiId)
                assetConds.push((0, drizzle_orm_1.eq)(schema_js_1.procesos.semiId, semiId));
            // Anti-duplicación en misma zona: impedir crear un PREASIGNADO si el activo ya está activo en esa misma targetZoneId
            if (assetConds.length > 0) {
                const activeSameZone = await tx
                    .select({ id: schema_js_1.procesos.id })
                    .from(schema_js_1.procesos)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.procesos.zoneId, targetZoneId), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNotNull)(schema_js_1.procesos.llegadaZonaAt), (0, drizzle_orm_1.isNotNull)(schema_js_1.procesos.ingresoBoxAt)), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.salidaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.circuitoCerradoAt), assetConds.length === 1 ? assetConds[0] : (0, drizzle_orm_1.or)(...assetConds)))
                    .limit(1);
                if (activeSameZone.length > 0) {
                    throw new ConflictError('La unidad ya se encuentra activa en esta zona; preasignala en otra zona.');
                }
            }
            // Multi-PREASIGNADO: permite múltiples cards PREASIGNADO en distintas zonas (cualquier card puede desprender otra).
            // Solo evita duplicar una segunda tarjeta PREASIGNADO dentro de la MISMA zona destino.
            const existingPendingSameZone = await tx
                .select({ id: schema_js_1.procesos.id })
                .from(schema_js_1.procesos)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.procesos.zoneId, targetZoneId), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.llegadaZonaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.ingresoBoxAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.salidaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.circuitoCerradoAt), assetConds.length === 1 ? assetConds[0] : (0, drizzle_orm_1.or)(...assetConds)))
                .limit(1);
            let holdRow;
            if (existingPendingSameZone.length > 0) {
                const [updated] = await tx
                    .update(schema_js_1.procesos)
                    .set({
                    zoneId: targetZoneId,
                    boxId: input.boxId ?? null,
                    circuitoId,
                    ...(input.usuariosIds ? { usuariosIds: input.usuariosIds } : {}),
                    updatedAt: (0, drizzle_orm_1.sql) `now()`,
                })
                    .where((0, drizzle_orm_1.eq)(schema_js_1.procesos.id, existingPendingSameZone[0].id))
                    .returning();
                holdRow = updated;
            }
            else {
                const [created] = await tx
                    .insert(schema_js_1.procesos)
                    .values({
                    circuitoId,
                    tractorId,
                    semiId,
                    zoneId: targetZoneId,
                    boxId: input.boxId || null,
                    pendienteAt: new Date(),
                    usuariosIds: input.usuariosIds || [],
                })
                    .returning();
                holdRow = created;
            }
            if (input.notaPlanificacion && input.notaPlanificacion.trim()) {
                await tx.insert(schema_js_1.procesosNotas).values({
                    circuitoId,
                    procesoId: holdRow.id,
                    usuarioId: null,
                    location: 'Coordinación',
                    texto: input.notaPlanificacion.trim(),
                });
            }
            return holdRow;
        });
        this.invalidate();
        await this.hydrateBoard();
        return result;
    }
    async actualizarHold(holdId, patch) {
        const { index } = await this.ensureRuntimeIndex();
        const updated = await index_js_1.db.transaction(async (tx) => {
            const updates = {
                updatedAt: (0, drizzle_orm_1.sql) `now()`,
            };
            if (patch.zoneId !== undefined)
                updates.zoneId = patch.zoneId;
            if (patch.boxId !== undefined) {
                updates.boxId = patch.boxId;
                if (patch.boxId) {
                    const bInfo = index.boxesMap.get(patch.boxId);
                    if (bInfo)
                        updates.zoneId = bInfo.zone_id;
                }
            }
            if (patch.usuariosIds !== undefined)
                updates.usuariosIds = patch.usuariosIds;
            const [row] = await tx
                .update(schema_js_1.procesos)
                .set(updates)
                .where((0, drizzle_orm_1.eq)(schema_js_1.procesos.id, holdId))
                .returning();
            if (!row) {
                throw new NotFoundError(`Preasignación ${holdId} no encontrada en base.procesos.`);
            }
            if (patch.notaPlanificacion && patch.notaPlanificacion.trim()) {
                await tx.insert(schema_js_1.procesosNotas).values({
                    circuitoId: row.circuitoId,
                    procesoId: row.id,
                    usuarioId: null,
                    location: 'Coordinación',
                    texto: patch.notaPlanificacion.trim(),
                });
            }
            return row;
        });
        this.invalidate();
        await this.hydrateBoard();
        return updated;
    }
    async eliminarHold(holdId) {
        await index_js_1.db.transaction(async (tx) => {
            const [deleted] = await tx
                .delete(schema_js_1.procesos)
                .where((0, drizzle_orm_1.eq)(schema_js_1.procesos.id, holdId))
                .returning();
            // Si el circuito quedó únicamente con pasos ya finalizados y el coordinador dio egreso a la preasignación, cerrar circuito
            if (deleted) {
                const remainingOpen = await tx
                    .select({ id: schema_js_1.procesos.id })
                    .from(schema_js_1.procesos)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.procesos.circuitoId, deleted.circuitoId), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.salidaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.circuitoCerradoAt)))
                    .limit(1);
                if (remainingOpen.length === 0) {
                    await tx
                        .update(schema_js_1.procesos)
                        .set({ circuitoCerradoAt: (0, drizzle_orm_1.sql) `now()` })
                        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.procesos.circuitoId, deleted.circuitoId), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.circuitoCerradoAt)));
                }
            }
        });
        this.invalidate();
        await this.hydrateBoard();
    }
    /**
     * Activa una tarjeta PREASIGNADO -> ESPERANDO A SER INGRESADO A BOX (llegada_zona_at) o TRABAJANDO (ingreso_box_at)
     * mediante 1 solo UPDATE in-place preservando el mismo UUID!
     */
    async activarHold(holdId, boxId, iniciarInmediato = false, _actorUsuarioId) {
        const { index } = await this.ensureRuntimeIndex();
        const res = await index_js_1.db.transaction(async (tx) => {
            const locked = await tx.execute((0, drizzle_orm_1.sql) `SELECT * FROM base.procesos WHERE id = ${holdId}::uuid FOR UPDATE`);
            if (locked.rows.length === 0) {
                throw new NotFoundError(`Preasignación (${holdId}) no encontrada en base.procesos`);
            }
            const hold = locked.rows[0];
            let targetBoxId = boxId || hold.box_id || null;
            if (!targetBoxId) {
                const firstZoneBox = Array.from(index.boxesMap.entries()).find(([, b]) => b.zone_id === hold.zone_id);
                if (firstZoneBox)
                    targetBoxId = firstZoneBox[0];
            }
            if (!targetBoxId) {
                throw new ConflictError('Debe seleccionar un Box válido para confirmar el ingreso desde PREASIGNADO.');
            }
            const boxInfo = index.boxesMap.get(targetBoxId);
            if (!boxInfo) {
                throw new NotFoundError(`El Box indicado (${targetBoxId}) no existe en base.boxes.`);
            }
            // Cerrar cualquier estadía activa previa no finalizada del mismo activo (si venía de Doble Carta)
            const assetConds = [];
            if (hold.tractor_id)
                assetConds.push((0, drizzle_orm_1.eq)(schema_js_1.procesos.tractorId, hold.tractor_id));
            if (hold.semi_id)
                assetConds.push((0, drizzle_orm_1.eq)(schema_js_1.procesos.semiId, hold.semi_id));
            if (assetConds.length > 0) {
                await tx
                    .update(schema_js_1.procesos)
                    .set({
                    salidaAt: (0, drizzle_orm_1.sql) `GREATEST(now(), COALESCE(${schema_js_1.procesos.ingresoBoxAt}, ${schema_js_1.procesos.llegadaZonaAt}, ${schema_js_1.procesos.pendienteAt}))`,
                    updatedAt: (0, drizzle_orm_1.sql) `now()`,
                })
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.ne)(schema_js_1.procesos.id, hold.id), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.salidaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.circuitoCerradoAt), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNotNull)(schema_js_1.procesos.llegadaZonaAt), (0, drizzle_orm_1.isNotNull)(schema_js_1.procesos.ingresoBoxAt)), assetConds.length === 1 ? assetConds[0] : (0, drizzle_orm_1.or)(...assetConds)));
            }
            const [activated] = await tx
                .update(schema_js_1.procesos)
                .set({
                zoneId: boxInfo.zone_id,
                boxId: targetBoxId,
                llegadaZonaAt: (0, drizzle_orm_1.sql) `GREATEST(now(), ${schema_js_1.procesos.pendienteAt})`,
                ingresoBoxAt: iniciarInmediato
                    ? (0, drizzle_orm_1.sql) `GREATEST(clock_timestamp(), ${schema_js_1.procesos.pendienteAt})`
                    : null,
                updatedAt: (0, drizzle_orm_1.sql) `now()`,
            })
                .where((0, drizzle_orm_1.eq)(schema_js_1.procesos.id, hold.id))
                .returning();
            const vu = this.resolveVirtualUnit(index, activated.tractorId, activated.semiId);
            const circuitNotes = await this.fetchNotesMapByCircuitos([activated.circuitoId], index.usersMap);
            return {
                ...activated,
                id: activated.id,
                proceso_id: activated.id,
                unidad_id: vu.unidad_id,
                tractor_id: activated.tractorId,
                semi_id: activated.semiId,
                box_id: activated.boxId,
                llegada_at: (activated.llegadaZonaAt || activated.pendienteAt).toISOString(),
                inicio_at: activated.ingresoBoxAt ? activated.ingresoBoxAt.toISOString() : null,
                salida_at: activated.salidaAt ? activated.salidaAt.toISOString() : null,
                notes: circuitNotes.get(activated.circuitoId) || [],
            };
        });
        this.invalidate();
        await this.hydrateBoard();
        return res;
    }
    /**
     * Autenticación de usuario de taller (base.usuarios_taller / auth.users).
     */
    async loginUsuarioTaller(nombreUsuario, password) {
        const cleanUser = nombreUsuario.trim();
        const res = await index_js_1.pool.query(`SELECT base.fn_login_usuario_taller($1::text, $2::text) AS auth_result;`, [cleanUser, password]);
        const authRes = res.rows[0]?.auth_result || {};
        if (!authRes.authenticated) {
            return {
                authenticated: false,
                error: authRes.error ||
                    'Acceso denegado: ingreso delimitado exclusivamente a usuarios registrados en base.usuarios_taller.',
            };
        }
        return {
            authenticated: true,
            user: {
                id: String(authRes.id),
                auth_user_id: authRes.auth_user_id ? String(authRes.auth_user_id) : String(authRes.id),
                email: String(authRes.email || ''),
                nombre_usuario: String(authRes.nombre_usuario),
                box_id: authRes.box_id ? String(authRes.box_id) : null,
                box_name: String(authRes.box_name || ''),
                zone_id: authRes.zone_id ? String(authRes.zone_id) : null,
                zone_name: String(authRes.zone_name || ''),
            },
        };
    }
    async verificarAccesoTaller(userId) {
        const cleanId = (userId || '').trim();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId)) {
            return { authorized: false, error: 'Identificador de sesión inválido' };
        }
        const res = await index_js_1.pool.query(`SELECT base.fn_verificar_acceso_taller($1::uuid) AS verify_result;`, [cleanId]);
        const verifyRes = res.rows[0]?.verify_result || {};
        if (!verifyRes.authorized || !verifyRes.user) {
            return {
                authorized: false,
                error: verifyRes.error || 'Acceso denegado: el usuario no figura en base.usuarios_taller.',
            };
        }
        return { authorized: true, user: verifyRes.user };
    }
    async loginUserCoordinacion(nombreUsuario, password) {
        const cleanUser = nombreUsuario.trim();
        const res = await index_js_1.pool.query(`SELECT base.fn_login_user_coordinacion($1::text, $2::text) AS auth_result;`, [cleanUser, password]);
        const authRes = res.rows[0]?.auth_result || {};
        if (!authRes.authenticated) {
            return {
                authenticated: false,
                error: authRes.error ||
                    'Acceso denegado: ingreso delimitado a usuarios registrados en base.user_coordinacion.',
            };
        }
        return {
            authenticated: true,
            user: {
                id: String(authRes.id),
                auth_user_id: authRes.auth_user_id ? String(authRes.auth_user_id) : String(authRes.id),
                email: String(authRes.email || ''),
                nombre_usuario: String(authRes.nombre_usuario),
                box_id: authRes.box_id ? String(authRes.box_id) : null,
                box_name: String(authRes.box_name || ''),
                zone_id: authRes.zone_id ? String(authRes.zone_id) : null,
                zone_name: String(authRes.zone_name || ''),
                rol: 'coordinacion',
            },
        };
    }
    async verificarAccesoCoordinacion(userId) {
        const cleanId = (userId || '').trim();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId)) {
            return { authorized: false, error: 'Identificador de sesión inválido' };
        }
        const res = await index_js_1.pool.query(`SELECT base.fn_verificar_acceso_coordinacion($1::uuid) AS verify_result;`, [cleanId]);
        const verifyRes = res.rows[0]?.verify_result || {};
        if (!verifyRes.authorized || !verifyRes.user) {
            return {
                authorized: false,
                error: verifyRes.error || 'Acceso denegado: el usuario no figura en base.user_coordinacion.',
            };
        }
        return { authorized: true, user: verifyRes.user };
    }
}
exports.hotRamBaseService = new HotRamBaseService();
