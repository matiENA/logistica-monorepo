"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hotRamBaseService = exports.ForbiddenError = exports.NotFoundError = exports.ConflictError = void 0;
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
class ForbiddenError extends Error {
    statusCode = 403;
    constructor(message) {
        super(message);
        this.name = 'ForbiddenError';
    }
}
exports.ForbiddenError = ForbiddenError;
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
    /**
     * Verifica autorización de usuario de taller contra base.usuarios_taller.
     * Resolución O(1) en Hot RAM C1 con fallback DB si la caché de catálogo aún no se hidrató.
     */
    async isTallerUserAuthorized(userId) {
        const cleanId = (userId || '').trim();
        if (!cleanId)
            return false;
        if (this.runtimeIndex?.tallerUsersMetaMap.has(cleanId)) {
            return true;
        }
        const { index } = await this.ensureRuntimeIndex();
        if (index.tallerUsersMetaMap.has(cleanId)) {
            return true;
        }
        const check = await this.verificarAccesoTaller(cleanId);
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
    normalizeBoxEstado(raw) {
        if (typeof raw !== 'string')
            return null;
        const normalized = raw.trim().toLowerCase();
        if (normalized === 'adentro' || normalized === 'afuera') {
            return normalized;
        }
        return null;
    }
    /**
     * Construye el mapeo relacional O(1) en Hot RAM C1 para renderizado de /taller (TALLER YC.md):
     * - "RESERVADO EN BOX" -> "RESERVADO"
     * - "TRABAJANDO" -> denominación de la zona (zone_name)
     * - Mapeo de los boxes contenidos en la zona, cada uno dividido en `adentro` y `afuera`.
     */
    buildTallerZoneMaps(catalog, activos) {
        const map = new Map();
        const boxesByZone = new Map();
        const operariosByBox = new Map();
        for (const u of catalog.usuarios) {
            if (u.rol !== 'operario' || !u.box_id)
                continue;
            const list = operariosByBox.get(u.box_id);
            const entry = { id: u.id, nombre_usuario: u.nombre_usuario };
            if (list)
                list.push(entry);
            else
                operariosByBox.set(u.box_id, [entry]);
        }
        for (const list of operariosByBox.values()) {
            list.sort((a, b) => a.nombre_usuario.localeCompare(b.nombre_usuario, 'es', { sensitivity: 'base' }));
        }
        for (const b of catalog.boxes) {
            const list = boxesByZone.get(b.zone_id);
            if (list)
                list.push({ id: b.id, box_name: b.box_name });
            else
                boxesByZone.set(b.zone_id, [{ id: b.id, box_name: b.box_name }]);
        }
        for (const list of boxesByZone.values()) {
            list.sort((a, b) => a.box_name.localeCompare(b.box_name, 'es', { numeric: true, sensitivity: 'base' }));
        }
        const boxSlotLookup = new Map();
        for (const z of catalog.zones) {
            const zoneBoxes = boxesByZone.get(z.id) || [];
            const slots = zoneBoxes.map((b) => {
                const slot = {
                    box_id: b.id,
                    box_name: b.box_name,
                    operarios: operariosByBox.get(b.id) || [],
                    adentro: [],
                    afuera: [],
                };
                boxSlotLookup.set(b.id, slot);
                return slot;
            });
            map.set(z.id, {
                zone_id: z.id,
                zone_name: z.zone_name,
                etapa_labels: {
                    reservado: 'RESERVADO',
                    trabajando: z.zone_name,
                    terminado: 'TERMINADO',
                    pendiente: 'PENDIENTE',
                },
                boxes: slots,
                sin_box: {
                    adentro: [],
                    afuera: [],
                },
            });
        }
        for (const card of activos) {
            if (card.estado_proceso !== 'EN_PROCESO')
                continue;
            const zoneMap = map.get(card.zone_id);
            if (!zoneMap)
                continue;
            const bucket = card.estado === 'afuera' ? 'afuera' : 'adentro';
            const slot = card.box_id ? boxSlotLookup.get(card.box_id) : undefined;
            if (slot) {
                slot[bucket].push(card);
            }
            else {
                zoneMap.sin_box[bucket].push(card);
            }
        }
        return map;
    }
    isPendingRow(row) {
        return !row.llegadaZonaAt && !row.ingresoBoxAt && !row.salidaAt && !row.anuladoAt;
    }
    async resolveTallerActorMeta(actorUsuarioId, index) {
        const cleanId = (actorUsuarioId || '').trim();
        if (!cleanId)
            return null;
        const cached = index.tallerUsersMetaMap.get(cleanId);
        if (cached)
            return cached;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId)) {
            return null;
        }
        const res = await index_js_1.pool.query(`SELECT
         ut.id,
         ut.auth_user_id,
         ut.rol,
         ut.box_id,
         COALESCE(ut.zone_id, b.zone_id) AS zone_id
       FROM base.usuarios_taller ut
       LEFT JOIN base.boxes b ON b.id = ut.box_id
       WHERE ut.id = $1::uuid OR ut.auth_user_id = $1::uuid
       LIMIT 1;`, [cleanId]);
        if (res.rows.length === 0)
            return null;
        const row = res.rows[0];
        const meta = {
            id: String(row.id),
            rol: row.rol === 'encargado_zona' ? 'encargado_zona' : 'operario',
            zone_id: row.zone_id ? String(row.zone_id) : null,
            box_id: row.box_id ? String(row.box_id) : null,
        };
        index.tallerUsersMetaMap.set(meta.id, meta);
        if (row.auth_user_id) {
            index.tallerUsersMetaMap.set(String(row.auth_user_id), meta);
        }
        return meta;
    }
    async sanitizeAndValidateUsuariosIds(usuariosIds, targetZoneId, restrictToZone, index) {
        const resolved = new Set();
        for (const uid of usuariosIds) {
            const meta = index.tallerUsersMetaMap.get(uid) ??
                (await this.resolveTallerActorMeta(uid, index));
            if (!meta) {
                throw new ConflictError('Uno o más usuarios seleccionados no pertenecen a base.usuarios_taller.');
            }
            if (restrictToZone && (!meta.zone_id || meta.zone_id !== targetZoneId)) {
                throw new ForbiddenError('Permiso denegado: el encargado_zona solo puede asignar operarios pertenecientes a su zona.');
            }
            resolved.add(meta.id);
        }
        return Array.from(resolved);
    }
    buildRuntimeIndex(catalog, tractoresRows, semisRows, coordUsersRows, tallerUsersMetaRows) {
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
        const tallerUsersMetaMap = new Map();
        for (const ut of tallerUsersMetaRows) {
            const meta = {
                id: ut.id,
                rol: ut.rol === 'encargado_zona' ? 'encargado_zona' : 'operario',
                zone_id: ut.zone_id,
                box_id: ut.box_id,
            };
            tallerUsersMetaMap.set(ut.id, meta);
            if (ut.auth_user_id) {
                tallerUsersMetaMap.set(ut.auth_user_id, meta);
            }
        }
        const operariosByBoxMap = new Map();
        for (const u of catalog.usuarios) {
            if (u.rol !== 'operario' || !u.box_id)
                continue;
            const list = operariosByBoxMap.get(u.box_id);
            const entry = { id: u.id, nombre_usuario: u.nombre_usuario };
            if (list)
                list.push(entry);
            else
                operariosByBoxMap.set(u.box_id, [entry]);
        }
        for (const list of operariosByBoxMap.values()) {
            list.sort((a, b) => a.nombre_usuario.localeCompare(b.nombre_usuario, 'es', { sensitivity: 'base' }));
        }
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
            tallerUsersMetaMap,
            operariosByBoxMap,
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
                auth_user_id: schema_js_1.usuariosTaller.authUserId,
                nombre_usuario: schema_js_1.usuariosTaller.nombreUsuario,
                rol: schema_js_1.usuariosTaller.rol,
                box_id: schema_js_1.usuariosTaller.boxId,
                box_name: schema_js_1.boxes.boxName,
                zone_id: (0, drizzle_orm_1.sql) `COALESCE(${schema_js_1.usuariosTaller.zoneId}, ${schema_js_1.boxes.zoneId})`,
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
                zone_id: (0, drizzle_orm_1.sql) `COALESCE(${schema_js_1.userCoordinacion.zoneId}, ${schema_js_1.boxes.zoneId})`,
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
            usuarios: [
                ...tallerUsersRows.map((u) => ({
                    id: u.id,
                    nombre_usuario: u.nombre_usuario,
                    rol: (u.rol === 'encargado_zona' ? 'encargado_zona' : 'operario'),
                    box_id: u.box_id,
                    box_name: u.box_name,
                    zone_id: u.zone_id,
                })),
                ...coordUsersRows.map((c) => ({
                    id: c.id,
                    nombre_usuario: c.nombre_usuario,
                    rol: 'coordinacion',
                    box_id: c.box_id,
                    box_name: c.box_name,
                    zone_id: c.zone_id,
                })),
            ],
            unidades: unitsRows.map((u) => ({
                unidad_id: u.unidad_id,
                n_ute: u.n_ute || '',
                tractor_id: u.tractor_id,
                tractor_plate: u.tractor_id ? trMap.get(u.tractor_id) || '' : '',
                semi_id: u.semi_id,
                semi_plate: u.semi_id ? smMap.get(u.semi_id) || '' : '',
            })),
        };
        const index = this.buildRuntimeIndex(catalog, tractoresRows, semisRows, coordUsersRows.map((c) => ({ id: c.id, nombre_usuario: c.nombre_usuario })), tallerUsersRows.map((u) => ({
            id: u.id,
            auth_user_id: u.auth_user_id,
            rol: u.rol,
            zone_id: u.zone_id,
            box_id: u.box_id,
        })));
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
    mergeCircuitoNotes(circuitoId, parentCircuitoId, notesByCircuito) {
        const ownNotes = notesByCircuito.get(circuitoId) || [];
        if (!parentCircuitoId)
            return ownNotes;
        const parentNotes = notesByCircuito.get(parentCircuitoId) || [];
        if (parentNotes.length === 0)
            return ownNotes;
        if (ownNotes.length === 0)
            return parentNotes;
        return [...parentNotes, ...ownNotes].sort((a, b) => {
            const timeCmp = a.timestamp.localeCompare(b.timestamp);
            if (timeCmp !== 0)
                return timeCmp;
            return a.id.localeCompare(b.id);
        });
    }
    resolveCircuitoRenderMeta(index, c, parent) {
        const tractorPlate = c.tractorId ? index.tractoresMap.get(c.tractorId) || '' : '';
        const semiPlate = c.semiId ? index.semisMap.get(c.semiId) || '' : '';
        const virtualUnit = this.resolveVirtualUnit(index, c.tractorId, c.semiId);
        const esDesunido = Boolean(c.parentCircuitoId);
        let patenteCruzada = null;
        if (esDesunido && parent) {
            if (c.tractorId && !c.semiId) {
                patenteCruzada = parent.semiId ? index.semisMap.get(parent.semiId) || null : null;
            }
            else if (c.semiId && !c.tractorId) {
                patenteCruzada = parent.tractorId ? index.tractoresMap.get(parent.tractorId) || null : null;
            }
        }
        const grupoRender = c.parentCircuitoId || virtualUnit.unidad_id || c.id;
        return {
            tractorPlate,
            semiPlate,
            virtualUnit,
            esDesunido,
            patenteCruzada,
            grupoRender,
        };
    }
    /**
     * Hidratación Hot RAM C1 V3:
     * 1 único RTT paralelo sobre base.circuitos (abiertos + padres de desunión) + base.procesos + base.procesos_notas.
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
                // En warm hydrate: 1 único roundtrip paralelo (circuitos abiertos/padres + procesos + notas)
                const [catalogBundle, circuitoRows, openRows, openNotesRows] = await Promise.all([
                    shouldRefreshCatalog
                        ? this.fetchCatalogAndIndex()
                        : Promise.resolve({ catalog: this.cachedCatalog, index: this.runtimeIndex }),
                    index_js_1.db
                        .select({
                        id: schema_js_1.circuitos.id,
                        parentCircuitoId: schema_js_1.circuitos.parentCircuitoId,
                        tractorId: schema_js_1.circuitos.tractorId,
                        semiId: schema_js_1.circuitos.semiId,
                        tractorN: schema_js_1.circuitos.tractorN,
                        semiN: schema_js_1.circuitos.semiN,
                        ingresoAt: schema_js_1.circuitos.ingresoAt,
                        desunionAt: schema_js_1.circuitos.desunionAt,
                        egresoAt: schema_js_1.circuitos.egresoAt,
                        altaCoordId: schema_js_1.circuitos.altaCoordId,
                    })
                        .from(schema_js_1.circuitos)
                        .where((0, drizzle_orm_1.sql) `(${schema_js_1.circuitos.egresoAt} IS NULL AND ${schema_js_1.circuitos.desunionAt} IS NULL)
                  OR ${schema_js_1.circuitos.id} IN (
                    SELECT DISTINCT parent_circuito_id
                    FROM base.circuitos
                    WHERE egreso_at IS NULL
                      AND desunion_at IS NULL
                      AND parent_circuito_id IS NOT NULL
                  )`),
                    index_js_1.db
                        .select({
                        id: schema_js_1.procesos.id,
                        circuitoId: schema_js_1.procesos.circuitoId,
                        zoneId: schema_js_1.procesos.zoneId,
                        pendienteAt: schema_js_1.procesos.pendienteAt,
                        llegadaZonaAt: schema_js_1.procesos.llegadaZonaAt,
                        boxId: schema_js_1.procesos.boxId,
                        estado: schema_js_1.procesos.estado,
                        ingresoBoxAt: schema_js_1.procesos.ingresoBoxAt,
                        usuariosIds: schema_js_1.procesos.usuariosIds,
                        encargadoId: schema_js_1.procesos.encargadoId,
                        encargadoAt: schema_js_1.procesos.encargadoAt,
                        salidaAt: schema_js_1.procesos.salidaAt,
                        updatedAt: schema_js_1.procesos.updatedAt,
                    })
                        .from(schema_js_1.procesos)
                        .where((0, drizzle_orm_1.sql) `${schema_js_1.procesos.circuitoId} IN (SELECT id FROM base.circuitos WHERE egreso_at IS NULL AND desunion_at IS NULL)
                  AND ${schema_js_1.procesos.anuladoAt} IS NULL`)
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
                        .where((0, drizzle_orm_1.sql) `${schema_js_1.procesosNotas.circuitoId} IN (
                SELECT id FROM base.circuitos WHERE egreso_at IS NULL AND desunion_at IS NULL
                UNION
                SELECT parent_circuito_id FROM base.circuitos WHERE egreso_at IS NULL AND desunion_at IS NULL AND parent_circuito_id IS NOT NULL
              )`)
                        .orderBy((0, drizzle_orm_1.asc)(schema_js_1.procesosNotas.createdAt), (0, drizzle_orm_1.asc)(schema_js_1.procesosNotas.id)),
                ]);
                const { catalog, index } = catalogBundle;
                this.cachedCatalog = catalog;
                this.runtimeIndex = index;
                const circuitoById = new Map(circuitoRows.map((c) => [c.id, c]));
                const openCircuitos = circuitoRows.filter((c) => !c.egresoAt && !c.desunionAt);
                // Agrupar notas compartidas por circuito_id (disponibles en todas las cards del circuito, incl. Doble Carta y padres)
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
                const pasosCountByCircuito = new Map();
                const pasoActivoIdByCircuito = new Map();
                for (const r of openRows) {
                    const circ = circuitoById.get(r.circuitoId);
                    if (!circ)
                        continue;
                    pasosCountByCircuito.set(r.circuitoId, (pasosCountByCircuito.get(r.circuitoId) || 0) + 1);
                    const boxInfo = r.boxId ? index.boxesMap.get(r.boxId) : null;
                    const zoneName = boxInfo?.zone_name || index.zonesMap.get(r.zoneId) || '';
                    const boxName = boxInfo?.box_name || '';
                    if (!r.salidaAt) {
                        circuitosConPasoAbierto.add(r.circuitoId);
                        if (circ.tractorId)
                            assetsConPasoAbierto.add(`t_${circ.tractorId}`);
                        if (circ.semiId)
                            assetsConPasoAbierto.add(`s_${circ.semiId}`);
                        if (!this.isPendingRow(r)) {
                            pasoActivoIdByCircuito.set(r.circuitoId, r.id);
                            const activeData = {
                                box_name: boxName || 'Sin Box',
                                zone_name: zoneName,
                                llegada_at: (r.llegadaZonaAt || r.pendienteAt).toISOString(),
                                inicio_at: r.ingresoBoxAt ? r.ingresoBoxAt.toISOString() : null,
                                circuito_id: r.circuitoId,
                            };
                            if (circ.tractorId)
                                activeUnfinalizedByAsset.set(`t_${circ.tractorId}`, activeData);
                            if (circ.semiId)
                                activeUnfinalizedByAsset.set(`s_${circ.semiId}`, activeData);
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
                        if (circ.tractorId) {
                            const prevAsset = latestClosedIdByAsset.get(`t_${circ.tractorId}`);
                            if (!prevAsset || salidaMs > prevAsset.salidaMs) {
                                latestClosedIdByAsset.set(`t_${circ.tractorId}`, { id: r.id, salidaMs });
                            }
                        }
                        if (circ.semiId) {
                            const prevAsset = latestClosedIdByAsset.get(`s_${circ.semiId}`);
                            if (!prevAsset || salidaMs > prevAsset.salidaMs) {
                                latestClosedIdByAsset.set(`s_${circ.semiId}`, { id: r.id, salidaMs });
                            }
                        }
                    }
                }
                const activos = [];
                const holds = [];
                for (const r of openRows) {
                    const circ = circuitoById.get(r.circuitoId);
                    if (!circ)
                        continue;
                    const parentCirc = circ.parentCircuitoId ? circuitoById.get(circ.parentCircuitoId) || null : null;
                    const renderMeta = this.resolveCircuitoRenderMeta(index, circ, parentCirc);
                    const boxInfo = r.boxId ? index.boxesMap.get(r.boxId) : null;
                    const zoneName = boxInfo?.zone_name || index.zonesMap.get(r.zoneId) || '';
                    const boxName = boxInfo?.box_name || '';
                    const usuariosIds = Array.isArray(r.usuariosIds) ? r.usuariosIds : [];
                    const usuariosNombres = usuariosIds.map((uid) => index.usersMap.get(uid) || 'Operario');
                    const encargadoId = r.encargadoId || null;
                    const encargadoNombre = encargadoId ? index.usersMap.get(encargadoId) || null : null;
                    const encargadoAt = r.encargadoAt ? r.encargadoAt.toISOString() : null;
                    const circuitNotes = this.mergeCircuitoNotes(r.circuitoId, circ.parentCircuitoId, notesByCircuito);
                    const lastNote = circuitNotes.length > 0 ? circuitNotes[circuitNotes.length - 1] : null;
                    const prevClosed = latestClosedByCircuito.get(r.circuitoId) || null;
                    // 1. Filas PREASIGNADO (pendiente_at solamente) -> proyectadas en holds[]
                    if (this.isPendingRow(r)) {
                        const activeUnfinalized = (circ.tractorId && activeUnfinalizedByAsset.get(`t_${circ.tractorId}`)) ||
                            (circ.semiId && activeUnfinalizedByAsset.get(`s_${circ.semiId}`)) ||
                            null;
                        const ubicacionBox = activeUnfinalized?.box_name || prevClosed?.box_name || null;
                        const ubicacionZone = activeUnfinalized?.zone_name || prevClosed?.zone_name || null;
                        holds.push({
                            hold_id: r.id,
                            circuito_id: r.circuitoId,
                            parent_circuito_id: circ.parentCircuitoId,
                            es_desunido: renderMeta.esDesunido,
                            patente_cruzada: renderMeta.patenteCruzada,
                            grupo_render: renderMeta.grupoRender,
                            ingreso_at: circ.ingresoAt.toISOString(),
                            unidad_id: renderMeta.virtualUnit.unidad_id,
                            n_ute: renderMeta.virtualUnit.n_ute,
                            tractor_id: circ.tractorId,
                            tractor_plate: renderMeta.tractorPlate,
                            semi_id: circ.semiId,
                            semi_plate: renderMeta.semiPlate,
                            tractor_n: circ.tractorN,
                            semi_n: circ.semiN,
                            modalidad_tracking: this.resolveModalidad(circ.tractorId, circ.semiId),
                            zone_id: r.zoneId,
                            zone_name: zoneName,
                            box_id: r.boxId,
                            box_name: boxName,
                            estado: this.normalizeBoxEstado(r.estado),
                            orden: 1,
                            usuarios_ids: usuariosIds,
                            usuarios_nombres: usuariosNombres,
                            encargado_id: encargadoId,
                            encargado_nombre: encargadoNombre,
                            encargado_at: encargadoAt,
                            nota_planificacion: lastNote?.texto || null,
                            notes: circuitNotes,
                            notes_count: circuitNotes.length,
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
                        if (circ.tractorId && assetsConPasoAbierto.has(`t_${circ.tractorId}`)) {
                            continue;
                        }
                        if (circ.semiId && assetsConPasoAbierto.has(`s_${circ.semiId}`)) {
                            continue;
                        }
                        const bestClosed = latestClosedIdByCircuito.get(r.circuitoId);
                        if (bestClosed && bestClosed.id !== r.id) {
                            continue;
                        }
                        if (circ.tractorId && latestClosedIdByAsset.get(`t_${circ.tractorId}`)?.id !== r.id) {
                            continue;
                        }
                        if (circ.semiId && latestClosedIdByAsset.get(`s_${circ.semiId}`)?.id !== r.id) {
                            continue;
                        }
                    }
                    // 3. Filas operativas visibles (ESPERANDO A SER INGRESADO A BOX / TRABAJANDO / FINALIZÓ) -> activos[]
                    activos.push({
                        proceso_id: r.id,
                        circuito_id: r.circuitoId,
                        parent_circuito_id: circ.parentCircuitoId,
                        es_desunido: renderMeta.esDesunido,
                        patente_cruzada: renderMeta.patenteCruzada,
                        grupo_render: renderMeta.grupoRender,
                        ingreso_at: circ.ingresoAt.toISOString(),
                        desunion_at: circ.desunionAt ? circ.desunionAt.toISOString() : null,
                        egreso_at: circ.egresoAt ? circ.egresoAt.toISOString() : null,
                        incompleto: false,
                        unidad_id: renderMeta.virtualUnit.unidad_id,
                        n_ute: renderMeta.virtualUnit.n_ute,
                        tractor_id: circ.tractorId,
                        tractor_plate: renderMeta.tractorPlate,
                        semi_id: circ.semiId,
                        semi_plate: renderMeta.semiPlate,
                        tractor_n: circ.tractorN,
                        semi_n: circ.semiN,
                        modalidad_tracking: this.resolveModalidad(circ.tractorId, circ.semiId),
                        box_id: r.boxId || '',
                        box_name: boxName,
                        estado: this.normalizeBoxEstado(r.estado),
                        zone_id: r.zoneId,
                        zone_name: zoneName,
                        estado_proceso: this.resolveEstado(r.llegadaZonaAt, r.ingresoBoxAt, r.salidaAt),
                        etapa_ciclo: 'ACTIVO_HOT',
                        pendiente_at: r.pendienteAt.toISOString(),
                        llegada_at: (r.llegadaZonaAt || r.pendienteAt).toISOString(),
                        inicio_at: r.ingresoBoxAt ? r.ingresoBoxAt.toISOString() : null,
                        salida_at: r.salidaAt ? r.salidaAt.toISOString() : null,
                        circuito_cerrado_at: null,
                        usuarios_ids: usuariosIds,
                        usuarios_nombres: usuariosNombres,
                        encargado_id: encargadoId,
                        encargado_nombre: encargadoNombre,
                        encargado_at: encargadoAt,
                        notes: circuitNotes,
                        notes_count: circuitNotes.length,
                        salida_previa_at: prevClosed && prevClosed.row_id !== r.id ? prevClosed.salida_at : null,
                        salida_origen_box: prevClosed && prevClosed.row_id !== r.id ? prevClosed.box_name : null,
                        salida_origen_zone: prevClosed && prevClosed.row_id !== r.id ? prevClosed.zone_name : null,
                        ultima_tarea: lastNote?.texto || null,
                        ultima_tarea_usuario: lastNote?.usuario || null,
                        ultima_tarea_at: lastNote?.timestamp || null,
                    });
                }
                const circuitos_abiertos = openCircuitos.map((circ) => {
                    const parentCirc = circ.parentCircuitoId ? circuitoById.get(circ.parentCircuitoId) || null : null;
                    const renderMeta = this.resolveCircuitoRenderMeta(index, circ, parentCirc);
                    const circuitNotes = this.mergeCircuitoNotes(circ.id, circ.parentCircuitoId, notesByCircuito);
                    return {
                        circuito_id: circ.id,
                        parent_circuito_id: circ.parentCircuitoId,
                        unidad_id: renderMeta.virtualUnit.unidad_id,
                        n_ute: renderMeta.virtualUnit.n_ute,
                        tractor_id: circ.tractorId,
                        tractor_plate: renderMeta.tractorPlate,
                        semi_id: circ.semiId,
                        semi_plate: renderMeta.semiPlate,
                        tractor_n: circ.tractorN,
                        semi_n: circ.semiN,
                        modalidad_tracking: this.resolveModalidad(circ.tractorId, circ.semiId),
                        es_desunido: renderMeta.esDesunido,
                        patente_cruzada: renderMeta.patenteCruzada,
                        grupo_render: renderMeta.grupoRender,
                        ingreso_at: circ.ingresoAt.toISOString(),
                        alta_coord_id: circ.altaCoordId,
                        pasos_count: pasosCountByCircuito.get(circ.id) || 0,
                        paso_activo_id: pasoActivoIdByCircuito.get(circ.id) || null,
                        notes: circuitNotes,
                        notes_count: circuitNotes.length,
                    };
                });
                const tallerZoneMaps = this.buildTallerZoneMaps(catalog, activos);
                const etag = this.computeEtag({
                    activos,
                    holds,
                    circuitos_abiertos,
                    zones: catalog.zones,
                    boxes: catalog.boxes,
                });
                this.cache = {
                    activos,
                    holds,
                    circuitos_abiertos,
                    catalog,
                    tallerZoneMaps,
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
    async getTallerZoneMap(zoneId) {
        const snapshot = await this.getBoardSnapshot();
        const zoneMap = snapshot.tallerZoneMaps.get(zoneId) || null;
        return {
            zoneMap,
            etag: `${snapshot.etag.slice(0, -1)}-zonemap-${zoneId}"`,
            updatedAt: snapshot.updatedAt,
        };
    }
    trimNotesPreview(notes) {
        const list = notes || [];
        return {
            notes: list.length > 0 ? [list[list.length - 1]] : [],
            notes_count: list.length,
        };
    }
    /**
     * Proyección G1 Lite para /taller (/db-render-arch):
     * - Filtra activos y holds exclusivamente al zoneId del usuario.
     * - Envía solo la última nota como preview + notes_count (el historial completo pasa a C2 On-Demand).
     * - Conserva `llegada_at` en `activos` para RESERVADO, cálculo de duración en SALIDA y rollback optimista INICIO -> LLEGADA,
     *   pero omite `encargado_at` (G3 histórico/trayectoria) y los campos duplicados `ultima_tarea*` en `activos`.
     * - Conserva `ultima_tarea*` en `holds` (usado por `stageTz` en PENDIENTE), omitiendo `encargado_at`.
     * - Evita doble serialización de cards dentro de taller_zone_map (solo estructura de boxes y labels).
     * - Omite catalog (zonas/unidades/usuarios), ya que /taller lee los boxes desde taller_zone_map y no usa filtros ni botón Asignar.
     */
    buildLiteTallerBoardPayload(snapshot, zoneId) {
        const activos = snapshot.activos
            .filter((c) => c.zone_id === zoneId)
            .map((c) => {
            const trimmed = this.trimNotesPreview(c.notes);
            const lite = {
                ...c,
                notes: trimmed.notes,
                notes_count: c.notes_count ?? trimmed.notes_count,
            };
            delete lite.encargado_at;
            delete lite.ultima_tarea;
            delete lite.ultima_tarea_usuario;
            delete lite.ultima_tarea_at;
            return lite;
        });
        const holds = snapshot.holds
            .filter((h) => h.zone_id === zoneId)
            .map((h) => {
            const trimmed = this.trimNotesPreview(h.notes);
            const lite = {
                ...h,
                notes: trimmed.notes,
                notes_count: h.notes_count ?? trimmed.notes_count,
            };
            delete lite.encargado_at;
            return lite;
        });
        const rawZoneMap = snapshot.tallerZoneMaps.get(zoneId) ?? null;
        const taller_zone_map = rawZoneMap
            ? {
                zone_id: rawZoneMap.zone_id,
                zone_name: rawZoneMap.zone_name,
                etapa_labels: rawZoneMap.etapa_labels,
                boxes: rawZoneMap.boxes.map((b) => ({
                    box_id: b.box_id,
                    box_name: b.box_name,
                    operarios: b.operarios,
                    adentro: [],
                    afuera: [],
                })),
                sin_box: {
                    adentro: [],
                    afuera: [],
                },
            }
            : null;
        return { activos, holds, taller_zone_map };
    }
    /**
     * Proyección optimizada C1 para /coordinacion (/db-render-arch):
     * - Recorta `notes` de activos, holds y circuitos_abiertos a únicamente la última nota + `notes_count`
     *   (la cola completa se consulta On-Demand vía GET /api/planeacion/procesos/:id/notas).
     * - Omite `catalog.usuarios` (Coordinación no asigna operarios), conservando `zones`, `boxes` y `unidades`.
     */
    buildCoordinacionBoardPayload(snapshot) {
        const activos = snapshot.activos.map((c) => {
            const trimmed = this.trimNotesPreview(c.notes);
            return {
                ...c,
                notes: trimmed.notes,
                notes_count: c.notes_count ?? trimmed.notes_count,
            };
        });
        const holds = snapshot.holds.map((h) => {
            const trimmed = this.trimNotesPreview(h.notes);
            return {
                ...h,
                notes: trimmed.notes,
                notes_count: h.notes_count ?? trimmed.notes_count,
            };
        });
        const circuitos_abiertos = snapshot.circuitos_abiertos.map((circ) => {
            const trimmed = this.trimNotesPreview(circ.notes);
            return {
                ...circ,
                notes: trimmed.notes,
                notes_count: circ.notes_count ?? trimmed.notes_count,
            };
        });
        const catalog = {
            zones: snapshot.catalog.zones,
            boxes: snapshot.catalog.boxes,
            usuarios: [],
            unidades: snapshot.catalog.unidades,
        };
        return { activos, holds, circuitos_abiertos, catalog };
    }
    /**
     * Consulta C2 On-Demand de todas las notas de un proceso/hold/circuito (con fast-path C1 Hot RAM).
     */
    async getNotasProceso(procesoOrHoldOrCircuitoId) {
        if (this.cache) {
            const cachedActivo = this.cache.activos.find((a) => a.proceso_id === procesoOrHoldOrCircuitoId);
            if (cachedActivo)
                return cachedActivo.notes || [];
            const cachedHold = this.cache.holds.find((h) => h.hold_id === procesoOrHoldOrCircuitoId);
            if (cachedHold)
                return cachedHold.notes || [];
            const cachedCirc = this.cache.circuitos_abiertos.find((c) => c.circuito_id === procesoOrHoldOrCircuitoId);
            if (cachedCirc)
                return cachedCirc.notes || [];
        }
        const { index } = await this.ensureRuntimeIndex();
        const [hotRow] = await index_js_1.db
            .select({ circuitoId: schema_js_1.procesos.circuitoId })
            .from(schema_js_1.procesos)
            .where((0, drizzle_orm_1.eq)(schema_js_1.procesos.id, procesoOrHoldOrCircuitoId))
            .limit(1);
        let circuitoId = hotRow?.circuitoId || null;
        if (!circuitoId) {
            const [coldRow] = await index_js_1.db
                .select({ circuitoId: schema_js_1.procesosCold.circuitoId })
                .from(schema_js_1.procesosCold)
                .where((0, drizzle_orm_1.eq)(schema_js_1.procesosCold.id, procesoOrHoldOrCircuitoId))
                .limit(1);
            circuitoId = coldRow?.circuitoId || null;
        }
        if (!circuitoId) {
            const [directCirc] = await index_js_1.db
                .select({ id: schema_js_1.circuitos.id })
                .from(schema_js_1.circuitos)
                .where((0, drizzle_orm_1.eq)(schema_js_1.circuitos.id, procesoOrHoldOrCircuitoId))
                .limit(1);
            circuitoId = directCirc?.id || null;
        }
        if (!circuitoId) {
            throw new NotFoundError(`Proceso o circuito (${procesoOrHoldOrCircuitoId}) no encontrado.`);
        }
        const [circMeta] = await index_js_1.db
            .select({ parentCircuitoId: schema_js_1.circuitos.parentCircuitoId })
            .from(schema_js_1.circuitos)
            .where((0, drizzle_orm_1.eq)(schema_js_1.circuitos.id, circuitoId))
            .limit(1);
        const idsToFetch = circMeta?.parentCircuitoId
            ? [circuitoId, circMeta.parentCircuitoId]
            : [circuitoId];
        const notesMap = await this.fetchNotesMapByCircuitos(idsToFetch, index.usersMap);
        return this.mergeCircuitoNotes(circuitoId, circMeta?.parentCircuitoId, notesMap);
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
            .orderBy((0, drizzle_orm_1.asc)(schema_js_1.procesosNotas.createdAt), (0, drizzle_orm_1.asc)(schema_js_1.procesosNotas.id));
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
        p.id, p.circuito_id, c.parent_circuito_id, c.tractor_id, c.semi_id, c.tractor_n, c.semi_n,
        c.ingreso_at, c.desunion_at, c.egreso_at,
        p.zone_id, p.pendiente_at, p.llegada_zona_at, p.box_id, p.estado, p.ingreso_box_at,
        p.usuarios_ids, p.encargado_id, p.encargado_at, p.salida_at,
        'ACTIVO_HOT'::text AS etapa_origen
      FROM base.procesos p
      INNER JOIN base.circuitos c ON c.id = p.circuito_id
      WHERE p.salida_at IS NOT NULL
      UNION ALL
      SELECT
        p.id, p.circuito_id, c.parent_circuito_id, c.tractor_id, c.semi_id, c.tractor_n, c.semi_n,
        c.ingreso_at, c.desunion_at, c.egreso_at,
        p.zone_id, p.pendiente_at, p.llegada_zona_at, p.box_id, p.estado, p.ingreso_box_at,
        p.usuarios_ids, p.encargado_id, p.encargado_at, p.salida_at,
        'HISTORICO_COLD'::text AS etapa_origen
      FROM base.procesos_cold p
      INNER JOIN base.circuitos c ON c.id = p.circuito_id
      WHERE p.salida_at IS NOT NULL
      ORDER BY salida_at DESC
      LIMIT $1 OFFSET $2;
      `, [limit, offset]);
        const circuitoIds = new Set();
        const parentIds = new Set();
        for (const r of res.rows) {
            circuitoIds.add(String(r.circuito_id));
            if (r.parent_circuito_id)
                parentIds.add(String(r.parent_circuito_id));
        }
        const allNoteCircIds = Array.from(new Set([...circuitoIds, ...parentIds]));
        const [notesMap, parentRows] = await Promise.all([
            this.fetchNotesMapByCircuitos(allNoteCircIds, index.usersMap),
            parentIds.size > 0
                ? index_js_1.db
                    .select({
                    id: schema_js_1.circuitos.id,
                    tractorId: schema_js_1.circuitos.tractorId,
                    semiId: schema_js_1.circuitos.semiId,
                })
                    .from(schema_js_1.circuitos)
                    .where((0, drizzle_orm_1.inArray)(schema_js_1.circuitos.id, Array.from(parentIds)))
                : Promise.resolve([]),
        ]);
        const parentMap = new Map(parentRows.map((p) => [p.id, p]));
        return res.rows.map((r) => {
            const boxInfo = r.box_id ? index.boxesMap.get(String(r.box_id)) : null;
            const zoneId = r.zone_id ? String(r.zone_id) : boxInfo?.zone_id || '';
            const zoneName = boxInfo?.zone_name || (zoneId ? index.zonesMap.get(zoneId) || '' : '');
            const tractorId = r.tractor_id ? String(r.tractor_id) : null;
            const semiId = r.semi_id ? String(r.semi_id) : null;
            const parentId = r.parent_circuito_id ? String(r.parent_circuito_id) : null;
            const parentCirc = parentId ? parentMap.get(parentId) || null : null;
            const circId = String(r.circuito_id);
            const renderMeta = this.resolveCircuitoRenderMeta(index, { id: circId, parentCircuitoId: parentId, tractorId, semiId }, parentCirc);
            const usuariosIds = Array.isArray(r.usuarios_ids) ? r.usuarios_ids : [];
            const encargadoId = r.encargado_id ? String(r.encargado_id) : null;
            const encargadoNombre = encargadoId ? index.usersMap.get(encargadoId) || null : null;
            const encargadoAt = r.encargado_at ? new Date(String(r.encargado_at)).toISOString() : null;
            const notes = this.mergeCircuitoNotes(circId, parentId, notesMap);
            return {
                proceso_id: String(r.id),
                circuito_id: circId,
                parent_circuito_id: parentId,
                es_desunido: renderMeta.esDesunido,
                patente_cruzada: renderMeta.patenteCruzada,
                grupo_render: renderMeta.grupoRender,
                ingreso_at: new Date(String(r.ingreso_at)).toISOString(),
                desunion_at: r.desunion_at ? new Date(String(r.desunion_at)).toISOString() : null,
                egreso_at: r.egreso_at ? new Date(String(r.egreso_at)).toISOString() : null,
                incompleto: false,
                unidad_id: renderMeta.virtualUnit.unidad_id,
                n_ute: renderMeta.virtualUnit.n_ute,
                tractor_id: tractorId,
                tractor_plate: renderMeta.tractorPlate,
                semi_id: semiId,
                semi_plate: renderMeta.semiPlate,
                tractor_n: r.tractor_n ? String(r.tractor_n) : null,
                semi_n: r.semi_n ? String(r.semi_n) : null,
                modalidad_tracking: this.resolveModalidad(tractorId, semiId),
                box_id: r.box_id ? String(r.box_id) : '',
                box_name: boxInfo?.box_name || '',
                estado: this.normalizeBoxEstado(r.estado),
                zone_id: zoneId,
                zone_name: zoneName,
                estado_proceso: 'FINALIZADO',
                etapa_ciclo: r.etapa_origen === 'HISTORICO_COLD' ? 'HISTORICO_COLD' : 'ACTIVO_HOT',
                pendiente_at: new Date(String(r.pendiente_at)).toISOString(),
                llegada_at: new Date(String(r.llegada_zona_at || r.pendiente_at)).toISOString(),
                inicio_at: r.ingreso_box_at ? new Date(String(r.ingreso_box_at)).toISOString() : null,
                salida_at: r.salida_at ? new Date(String(r.salida_at)).toISOString() : null,
                circuito_cerrado_at: r.egreso_at ? new Date(String(r.egreso_at)).toISOString() : null,
                usuarios_ids: usuariosIds,
                usuarios_nombres: usuariosIds.map((uid) => index.usersMap.get(uid) || 'Operario'),
                encargado_id: encargadoId,
                encargado_nombre: encargadoNombre,
                encargado_at: encargadoAt,
                notes,
            };
        });
    }
    /**
     * Reconstruye la trayectoria cronológica completa (C2 On-Demand) de un tractor/semi/unidad virtual.
     * Incluye circuitos padre/hijos de desunión y pasos incompletos tras Baja.
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
        const circConds = [];
        if (tId)
            circConds.push((0, drizzle_orm_1.eq)(schema_js_1.circuitos.tractorId, tId));
        if (sId)
            circConds.push((0, drizzle_orm_1.eq)(schema_js_1.circuitos.semiId, sId));
        const filterCirc = circConds.length === 1 ? circConds[0] : (0, drizzle_orm_1.or)(...circConds);
        const matchedCircuitos = await index_js_1.db
            .select({
            id: schema_js_1.circuitos.id,
            parentCircuitoId: schema_js_1.circuitos.parentCircuitoId,
            tractorId: schema_js_1.circuitos.tractorId,
            semiId: schema_js_1.circuitos.semiId,
            tractorN: schema_js_1.circuitos.tractorN,
            semiN: schema_js_1.circuitos.semiN,
            ingresoAt: schema_js_1.circuitos.ingresoAt,
            desunionAt: schema_js_1.circuitos.desunionAt,
            egresoAt: schema_js_1.circuitos.egresoAt,
            archivedAt: schema_js_1.circuitos.archivedAt,
        })
            .from(schema_js_1.circuitos)
            .where(filterCirc)
            .orderBy((0, drizzle_orm_1.asc)(schema_js_1.circuitos.ingresoAt));
        if (matchedCircuitos.length === 0) {
            const queryMs = Number((node_perf_hooks_1.performance.now() - startedAt).toFixed(2));
            return {
                historial: [],
                ubicacion_actual: [],
                recorrido_programado: [],
                timeline: [],
                eventos: [],
                queryMs,
            };
        }
        const circById = new Map(matchedCircuitos.map((c) => [c.id, c]));
        const missingParentIds = Array.from(new Set(matchedCircuitos
            .map((c) => c.parentCircuitoId)
            .filter((pid) => Boolean(pid && !circById.has(pid)))));
        if (missingParentIds.length > 0) {
            const extraParents = await index_js_1.db
                .select({
                id: schema_js_1.circuitos.id,
                parentCircuitoId: schema_js_1.circuitos.parentCircuitoId,
                tractorId: schema_js_1.circuitos.tractorId,
                semiId: schema_js_1.circuitos.semiId,
                tractorN: schema_js_1.circuitos.tractorN,
                semiN: schema_js_1.circuitos.semiN,
                ingresoAt: schema_js_1.circuitos.ingresoAt,
                desunionAt: schema_js_1.circuitos.desunionAt,
                egresoAt: schema_js_1.circuitos.egresoAt,
                archivedAt: schema_js_1.circuitos.archivedAt,
            })
                .from(schema_js_1.circuitos)
                .where((0, drizzle_orm_1.inArray)(schema_js_1.circuitos.id, missingParentIds));
            for (const p of extraParents) {
                circById.set(p.id, p);
            }
        }
        const matchedIds = matchedCircuitos.map((c) => c.id);
        const allNoteIds = Array.from(circById.keys());
        const [coldRows, hotRows, notesMap] = await Promise.all([
            index_js_1.db
                .select({
                id: schema_js_1.procesosCold.id,
                circuitoId: schema_js_1.procesosCold.circuitoId,
                zoneId: schema_js_1.procesosCold.zoneId,
                pendienteAt: schema_js_1.procesosCold.pendienteAt,
                llegadaZonaAt: schema_js_1.procesosCold.llegadaZonaAt,
                boxId: schema_js_1.procesosCold.boxId,
                estado: schema_js_1.procesosCold.estado,
                ingresoBoxAt: schema_js_1.procesosCold.ingresoBoxAt,
                usuariosIds: schema_js_1.procesosCold.usuariosIds,
                encargadoId: schema_js_1.procesosCold.encargadoId,
                encargadoAt: schema_js_1.procesosCold.encargadoAt,
                salidaAt: schema_js_1.procesosCold.salidaAt,
                anuladoAt: schema_js_1.procesosCold.anuladoAt,
            })
                .from(schema_js_1.procesosCold)
                .where((0, drizzle_orm_1.inArray)(schema_js_1.procesosCold.circuitoId, matchedIds))
                .orderBy((0, drizzle_orm_1.asc)(schema_js_1.procesosCold.pendienteAt)),
            index_js_1.db
                .select({
                id: schema_js_1.procesos.id,
                circuitoId: schema_js_1.procesos.circuitoId,
                zoneId: schema_js_1.procesos.zoneId,
                pendienteAt: schema_js_1.procesos.pendienteAt,
                llegadaZonaAt: schema_js_1.procesos.llegadaZonaAt,
                boxId: schema_js_1.procesos.boxId,
                estado: schema_js_1.procesos.estado,
                ingresoBoxAt: schema_js_1.procesos.ingresoBoxAt,
                usuariosIds: schema_js_1.procesos.usuariosIds,
                encargadoId: schema_js_1.procesos.encargadoId,
                encargadoAt: schema_js_1.procesos.encargadoAt,
                salidaAt: schema_js_1.procesos.salidaAt,
                anuladoAt: schema_js_1.procesos.anuladoAt,
                updatedAt: schema_js_1.procesos.updatedAt,
            })
                .from(schema_js_1.procesos)
                .where((0, drizzle_orm_1.inArray)(schema_js_1.procesos.circuitoId, matchedIds))
                .orderBy((0, drizzle_orm_1.asc)(schema_js_1.procesos.pendienteAt)),
            this.fetchNotesMapByCircuitos(allNoteIds, index.usersMap),
        ]);
        const mapToCard = (r, etapa) => {
            const circ = circById.get(r.circuitoId);
            const parentCirc = circ.parentCircuitoId ? circById.get(circ.parentCircuitoId) || null : null;
            const renderMeta = this.resolveCircuitoRenderMeta(index, circ, parentCirc);
            const boxInfo = r.boxId ? index.boxesMap.get(r.boxId) : null;
            const zoneId = r.zoneId || boxInfo?.zone_id || '';
            const zoneName = boxInfo?.zone_name || (zoneId ? index.zonesMap.get(zoneId) || '' : '');
            const uIds = Array.isArray(r.usuariosIds) ? r.usuariosIds : [];
            const encargadoId = r.encargadoId || null;
            const encargadoNombre = encargadoId ? index.usersMap.get(encargadoId) || null : null;
            const encargadoAt = r.encargadoAt ? r.encargadoAt.toISOString() : null;
            const notes = this.mergeCircuitoNotes(r.circuitoId, circ.parentCircuitoId, notesMap);
            const incompleto = Boolean(r.anuladoAt || ((circ.egresoAt || circ.desunionAt) && !r.salidaAt));
            return {
                proceso_id: r.id,
                circuito_id: r.circuitoId,
                parent_circuito_id: circ.parentCircuitoId,
                es_desunido: renderMeta.esDesunido,
                patente_cruzada: renderMeta.patenteCruzada,
                grupo_render: renderMeta.grupoRender,
                ingreso_at: circ.ingresoAt.toISOString(),
                desunion_at: circ.desunionAt ? circ.desunionAt.toISOString() : null,
                egreso_at: circ.egresoAt ? circ.egresoAt.toISOString() : null,
                incompleto,
                unidad_id: renderMeta.virtualUnit.unidad_id,
                n_ute: renderMeta.virtualUnit.n_ute,
                tractor_id: circ.tractorId,
                tractor_plate: renderMeta.tractorPlate,
                semi_id: circ.semiId,
                semi_plate: renderMeta.semiPlate,
                tractor_n: circ.tractorN,
                semi_n: circ.semiN,
                modalidad_tracking: this.resolveModalidad(circ.tractorId, circ.semiId),
                box_id: r.boxId || '',
                box_name: boxInfo?.box_name || '',
                estado: this.normalizeBoxEstado(r.estado),
                zone_id: zoneId,
                zone_name: zoneName,
                estado_proceso: this.resolveEstado(r.llegadaZonaAt, r.ingresoBoxAt, r.salidaAt),
                etapa_ciclo: etapa,
                pendiente_at: r.pendienteAt.toISOString(),
                llegada_at: (r.llegadaZonaAt || r.pendienteAt).toISOString(),
                inicio_at: r.ingresoBoxAt ? r.ingresoBoxAt.toISOString() : null,
                salida_at: r.salidaAt ? r.salidaAt.toISOString() : null,
                anulado_at: r.anuladoAt ? r.anuladoAt.toISOString() : null,
                circuito_cerrado_at: circ.egresoAt ? circ.egresoAt.toISOString() : null,
                usuarios_ids: uIds,
                usuarios_nombres: uIds.map((uid) => index.usersMap.get(uid) || 'Operario'),
                encargado_id: encargadoId,
                encargado_nombre: encargadoNombre,
                encargado_at: encargadoAt,
                notes,
            };
        };
        const isCircClosed = (circuitoId) => {
            const c = circById.get(circuitoId);
            return Boolean(c?.egresoAt || c?.desunionAt);
        };
        const historial = [
            ...coldRows.map((r) => mapToCard(r, 'HISTORICO_COLD')),
            ...hotRows
                .filter((r) => Boolean(r.salidaAt) || Boolean(r.anuladoAt) || isCircClosed(r.circuitoId))
                .map((r) => mapToCard(r, isCircClosed(r.circuitoId) ? 'HISTORICO_COLD' : 'ACTIVO_HOT')),
        ];
        const ubicacionActual = hotRows
            .filter((r) => !isCircClosed(r.circuitoId) && !r.salidaAt && !r.anuladoAt && !this.isPendingRow(r))
            .map((r) => mapToCard(r, 'ACTIVO_HOT'));
        const pendingHotRows = hotRows.filter((r) => !isCircClosed(r.circuitoId) && !r.anuladoAt && this.isPendingRow(r));
        const recorridoProgramado = pendingHotRows.map((r) => {
            const card = mapToCard(r, 'PLANIFICADO_HOLD');
            const lastNote = card.notes.length > 0 ? card.notes[card.notes.length - 1] : null;
            return {
                hold_id: r.id,
                circuito_id: r.circuitoId,
                parent_circuito_id: card.parent_circuito_id,
                es_desunido: card.es_desunido,
                patente_cruzada: card.patente_cruzada,
                grupo_render: card.grupo_render,
                ingreso_at: card.ingreso_at,
                unidad_id: card.unidad_id,
                n_ute: card.n_ute,
                tractor_id: card.tractor_id,
                tractor_plate: card.tractor_plate,
                semi_id: card.semi_id,
                semi_plate: card.semi_plate,
                modalidad_tracking: card.modalidad_tracking,
                zone_id: card.zone_id,
                zone_name: card.zone_name,
                box_id: r.boxId,
                box_name: card.box_name,
                orden: 1,
                usuarios_ids: card.usuarios_ids,
                usuarios_nombres: card.usuarios_nombres,
                encargado_id: card.encargado_id ?? null,
                encargado_nombre: card.encargado_nombre ?? null,
                encargado_at: card.encargado_at ?? null,
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
            estado_box: c.estado,
            box_name: c.box_name || 'Sin Box asignado',
            zone_name: c.zone_name,
            orden: null,
            ingreso_at: c.ingreso_at ?? null,
            desunion_at: c.desunion_at ?? null,
            egreso_at: c.egreso_at ?? null,
            es_desunido: Boolean(c.es_desunido),
            patente_cruzada: c.patente_cruzada ?? null,
            incompleto: Boolean(c.incompleto),
            llegada_at: c.llegada_at,
            inicio_at: c.inicio_at,
            salida_at: c.salida_at,
            anulado_at: c.anulado_at ?? null,
            duracion_espera_min: diffMin(c.llegada_at, c.inicio_at),
            duracion_trabajo_min: diffMin(c.inicio_at, c.salida_at),
            duracion_total_min: diffMin(c.llegada_at, c.salida_at),
            usuarios_nombres: c.usuarios_nombres,
            encargado_nombre: c.encargado_nombre ?? null,
            encargado_at: c.encargado_at ?? null,
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
                estado_box: h.estado ?? null,
                box_name: h.box_name || 'Sin Box asignado',
                zone_name: h.zone_name,
                orden: h.orden,
                ingreso_at: h.ingreso_at ?? null,
                desunion_at: null,
                egreso_at: null,
                es_desunido: Boolean(h.es_desunido),
                patente_cruzada: h.patente_cruzada ?? null,
                incompleto: false,
                llegada_at: null,
                inicio_at: null,
                salida_at: null,
                anulado_at: null,
                duracion_espera_min: null,
                duracion_trabajo_min: null,
                duracion_total_min: null,
                usuarios_nombres: h.usuarios_nombres,
                encargado_nombre: h.encargado_nombre ?? null,
                encargado_at: h.encargado_at ?? null,
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
    async assertSinCircuitoAbiertoColision(tx, params) {
        const conds = [];
        if (params.tractorId)
            conds.push((0, drizzle_orm_1.eq)(schema_js_1.circuitos.tractorId, params.tractorId));
        if (params.semiId)
            conds.push((0, drizzle_orm_1.eq)(schema_js_1.circuitos.semiId, params.semiId));
        if (conds.length === 0)
            return;
        const existing = await tx
            .select({ id: schema_js_1.circuitos.id })
            .from(schema_js_1.circuitos)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(schema_js_1.circuitos.egresoAt), (0, drizzle_orm_1.isNull)(schema_js_1.circuitos.desunionAt), (0, drizzle_orm_1.ne)(schema_js_1.circuitos.id, params.excludeCircuitoId), conds.length === 1 ? conds[0] : (0, drizzle_orm_1.or)(...conds)))
            .limit(1);
        if (existing.length > 0) {
            throw new ConflictError('No se puede reabrir el circuito porque el tractor o semi ya ingresó en otro circuito abierto.');
        }
    }
    async assertSinProcesoActivoColision(tx, params) {
        const existing = await tx
            .select({ id: schema_js_1.procesos.id, boxName: schema_js_1.boxes.boxName })
            .from(schema_js_1.procesos)
            .leftJoin(schema_js_1.boxes, (0, drizzle_orm_1.eq)(schema_js_1.procesos.boxId, schema_js_1.boxes.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.procesos.circuitoId, params.circuitoId), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.salidaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.anuladoAt), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNotNull)(schema_js_1.procesos.llegadaZonaAt), (0, drizzle_orm_1.isNotNull)(schema_js_1.procesos.ingresoBoxAt)), (0, drizzle_orm_1.ne)(schema_js_1.procesos.id, params.excludeProcesoId)))
            .limit(1);
        if (existing.length > 0) {
            const boxName = existing[0].boxName || 'otro Box';
            throw new ConflictError(`No se puede reabrir el proceso porque el circuito ya tiene una estadía activa en ${boxName}.`);
        }
    }
    /**
     * Busca el circuito abierto del activo o crea uno nuevo en base.circuitos (retrocompatibilidad sin UI Alta/Baja).
     */
    async findOrCreateOpenCircuito(tx, input) {
        if (input.circuitoId) {
            const found = await tx
                .select({
                id: schema_js_1.circuitos.id,
                parentCircuitoId: schema_js_1.circuitos.parentCircuitoId,
                tractorId: schema_js_1.circuitos.tractorId,
                semiId: schema_js_1.circuitos.semiId,
                tractorN: schema_js_1.circuitos.tractorN,
                semiN: schema_js_1.circuitos.semiN,
                ingresoAt: schema_js_1.circuitos.ingresoAt,
                desunionAt: schema_js_1.circuitos.desunionAt,
                egresoAt: schema_js_1.circuitos.egresoAt,
            })
                .from(schema_js_1.circuitos)
                .where((0, drizzle_orm_1.eq)(schema_js_1.circuitos.id, input.circuitoId))
                .limit(1);
            if (found.length === 0) {
                throw new NotFoundError(`Circuito (${input.circuitoId}) no encontrado en base.circuitos.`);
            }
            if (found[0].egresoAt || found[0].desunionAt) {
                throw new ConflictError(`El circuito (${input.circuitoId}) ya se encuentra cerrado o desunido.`);
            }
            return found[0];
        }
        if (input.procesoOrigenId) {
            const origHot = await tx
                .select({ circuitoId: schema_js_1.procesos.circuitoId })
                .from(schema_js_1.procesos)
                .where((0, drizzle_orm_1.eq)(schema_js_1.procesos.id, input.procesoOrigenId))
                .limit(1);
            let origCircId = origHot[0]?.circuitoId || null;
            if (!origCircId) {
                const origCold = await tx
                    .select({ circuitoId: schema_js_1.procesosCold.circuitoId })
                    .from(schema_js_1.procesosCold)
                    .where((0, drizzle_orm_1.eq)(schema_js_1.procesosCold.id, input.procesoOrigenId))
                    .limit(1);
                origCircId = origCold[0]?.circuitoId || null;
            }
            if (origCircId) {
                const foundOrig = await tx
                    .select({
                    id: schema_js_1.circuitos.id,
                    parentCircuitoId: schema_js_1.circuitos.parentCircuitoId,
                    tractorId: schema_js_1.circuitos.tractorId,
                    semiId: schema_js_1.circuitos.semiId,
                    tractorN: schema_js_1.circuitos.tractorN,
                    semiN: schema_js_1.circuitos.semiN,
                    ingresoAt: schema_js_1.circuitos.ingresoAt,
                    desunionAt: schema_js_1.circuitos.desunionAt,
                    egresoAt: schema_js_1.circuitos.egresoAt,
                })
                    .from(schema_js_1.circuitos)
                    .where((0, drizzle_orm_1.eq)(schema_js_1.circuitos.id, origCircId))
                    .limit(1);
                if (foundOrig.length > 0) {
                    if (foundOrig[0].desunionAt) {
                        throw new ConflictError('El circuito origen fue desunido; seleccioná el circuito individual del tractor o semi.');
                    }
                    if (!foundOrig[0].egresoAt) {
                        return foundOrig[0];
                    }
                }
            }
        }
        const conds = [];
        if (input.tractorId)
            conds.push((0, drizzle_orm_1.eq)(schema_js_1.circuitos.tractorId, input.tractorId));
        if (input.semiId)
            conds.push((0, drizzle_orm_1.eq)(schema_js_1.circuitos.semiId, input.semiId));
        if (conds.length > 0) {
            const openMatches = await tx
                .select({
                id: schema_js_1.circuitos.id,
                parentCircuitoId: schema_js_1.circuitos.parentCircuitoId,
                tractorId: schema_js_1.circuitos.tractorId,
                semiId: schema_js_1.circuitos.semiId,
                tractorN: schema_js_1.circuitos.tractorN,
                semiN: schema_js_1.circuitos.semiN,
                ingresoAt: schema_js_1.circuitos.ingresoAt,
            })
                .from(schema_js_1.circuitos)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(schema_js_1.circuitos.egresoAt), (0, drizzle_orm_1.isNull)(schema_js_1.circuitos.desunionAt), conds.length === 1 ? conds[0] : (0, drizzle_orm_1.or)(...conds)));
            if (openMatches.length > 1) {
                throw new ConflictError('El tractor y el semi poseen circuitos abiertos separados por desunión; especificá circuitoId.');
            }
            if (openMatches.length === 1) {
                const match = openMatches[0];
                if (match.parentCircuitoId &&
                    input.tractorId &&
                    input.semiId &&
                    (!match.tractorId || !match.semiId)) {
                    throw new ConflictError('Uno de los activos está en un circuito individual por desunión; especificá circuitoId.');
                }
                return match;
            }
        }
        const validCoordId = input.coordUserId && this.runtimeIndex?.coordUserIds.has(input.coordUserId)
            ? input.coordUserId
            : null;
        const [created] = await tx
            .insert(schema_js_1.circuitos)
            .values({
            tractorId: input.tractorId,
            semiId: input.semiId,
            tractorN: input.tractorN ?? null,
            semiN: input.semiN ?? null,
            altaCoordId: validCoordId,
        })
            .returning({
            id: schema_js_1.circuitos.id,
            parentCircuitoId: schema_js_1.circuitos.parentCircuitoId,
            tractorId: schema_js_1.circuitos.tractorId,
            semiId: schema_js_1.circuitos.semiId,
            tractorN: schema_js_1.circuitos.tractorN,
            semiN: schema_js_1.circuitos.semiN,
            ingresoAt: schema_js_1.circuitos.ingresoAt,
        });
        return created;
    }
    async bajaCircuitoTx(tx, circuitoId, coordUserId) {
        const locked = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, parent_circuito_id, ingreso_at, desunion_at, egreso_at FROM base.circuitos WHERE id = ${circuitoId}::uuid FOR UPDATE`);
        if (locked.rows.length === 0) {
            throw new NotFoundError(`Circuito (${circuitoId}) no encontrado en base.circuitos.`);
        }
        const circ = locked.rows[0];
        if (circ.desunion_at) {
            throw new ConflictError('El circuito fue desunido; ejecutá la baja sobre los circuitos individuales del tractor o semi.');
        }
        if (circ.egreso_at) {
            return {
                circuito_id: circ.id,
                egreso_at: new Date(circ.egreso_at).toISOString(),
                already_closed: true,
                pasos_incompletos: 0,
            };
        }
        const validCoordId = coordUserId && this.runtimeIndex?.coordUserIds.has(coordUserId) ? coordUserId : null;
        // La Baja NO cierra artificialmente pasos abiertos: pasan a Cold incompletos (salida_at IS NULL).
        const [closed] = await tx
            .update(schema_js_1.circuitos)
            .set({
            egresoAt: (0, drizzle_orm_1.sql) `GREATEST(now(), ${schema_js_1.circuitos.ingresoAt})`,
            bajaCoordId: validCoordId,
            updatedAt: (0, drizzle_orm_1.sql) `now()`,
        })
            .where((0, drizzle_orm_1.eq)(schema_js_1.circuitos.id, circuitoId))
            .returning({
            id: schema_js_1.circuitos.id,
            egresoAt: schema_js_1.circuitos.egresoAt,
            bajaCoordId: schema_js_1.circuitos.bajaCoordId,
        });
        const incompleteCountRes = await tx
            .select({ id: schema_js_1.procesos.id })
            .from(schema_js_1.procesos)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.procesos.circuitoId, circuitoId), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.salidaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.anuladoAt)));
        return {
            circuito_id: closed.id,
            egreso_at: closed.egresoAt ? closed.egresoAt.toISOString() : new Date().toISOString(),
            baja_coord_id: closed.bajaCoordId,
            already_closed: false,
            pasos_incompletos: incompleteCountRes.length,
        };
    }
    /**
     * Alta explícita de circuito en planta (Coordinación).
     */
    async altaCircuito(input) {
        const { index } = await this.ensureRuntimeIndex();
        const created = await index_js_1.db.transaction(async (tx) => {
            const { tractorId, semiId } = await this.resolvePhysicalAssets(tx, input);
            const conds = [];
            if (tractorId)
                conds.push((0, drizzle_orm_1.eq)(schema_js_1.circuitos.tractorId, tractorId));
            if (semiId)
                conds.push((0, drizzle_orm_1.eq)(schema_js_1.circuitos.semiId, semiId));
            if (conds.length > 0) {
                const existing = await tx
                    .select({ id: schema_js_1.circuitos.id })
                    .from(schema_js_1.circuitos)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(schema_js_1.circuitos.egresoAt), (0, drizzle_orm_1.isNull)(schema_js_1.circuitos.desunionAt), conds.length === 1 ? conds[0] : (0, drizzle_orm_1.or)(...conds)))
                    .limit(1);
                if (existing.length > 0) {
                    throw new ConflictError('El tractor o semi ya posee un circuito abierto en planta.');
                }
            }
            const validCoordId = input.coordUserId && index.coordUserIds.has(input.coordUserId) ? input.coordUserId : null;
            const [row] = await tx
                .insert(schema_js_1.circuitos)
                .values({
                tractorId,
                semiId,
                tractorN: input.tractorN ?? null,
                semiN: input.semiN ?? null,
                altaCoordId: validCoordId,
            })
                .returning();
            if (input.notaTexto && input.notaTexto.trim()) {
                await tx.insert(schema_js_1.procesosNotas).values({
                    circuitoId: row.id,
                    procesoId: null,
                    usuarioId: null,
                    location: 'Coordinación',
                    texto: input.notaTexto.trim(),
                });
            }
            return row;
        });
        this.invalidate();
        const snapshot = await this.hydrateBoard();
        const dto = snapshot.circuitos_abiertos.find((c) => c.circuito_id === created.id);
        return (dto || {
            circuito_id: created.id,
            parent_circuito_id: created.parentCircuitoId,
            tractor_id: created.tractorId,
            semi_id: created.semiId,
            tractor_n: created.tractorN,
            semi_n: created.semiN,
            ingreso_at: created.ingresoAt.toISOString(),
        });
    }
    /**
     * Baja explícita de circuito en cualquier instancia (pasos abiertos quedan incompletos).
     */
    async bajaCircuito(circuitoId, coordUserId) {
        await this.ensureRuntimeIndex();
        const res = await index_js_1.db.transaction(async (tx) => this.bajaCircuitoTx(tx, circuitoId, coordUserId));
        this.invalidate();
        await this.hydrateBoard();
        return res;
    }
    /**
     * Desunión interna Tractor / Semi en 2 circuitos hijos bajo parent_circuito_id.
     */
    async desunirCircuito(circuitoId, mantenerEn = 'TRACTOR', coordUserId) {
        const { index } = await this.ensureRuntimeIndex();
        const validCoordId = coordUserId && index.coordUserIds.has(coordUserId) ? coordUserId : null;
        let res;
        try {
            res = await index_js_1.pool.query(`SELECT circuito_tractor_id, circuito_semi_id, moved_steps
         FROM base.fn_desunir_circuito($1::uuid, $2::text, $3::uuid);`, [circuitoId, mantenerEn, validCoordId]);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('NOT_FOUND:')) {
                throw new NotFoundError(msg.replace(/^.*NOT_FOUND:\s*/i, ''));
            }
            if (msg.includes('CONFLICT:')) {
                throw new ConflictError(msg.replace(/^.*CONFLICT:\s*/i, ''));
            }
            throw err;
        }
        const row = res.rows[0];
        this.invalidate();
        await this.hydrateBoard();
        return {
            parent_circuito_id: circuitoId,
            circuito_tractor_id: String(row.circuito_tractor_id),
            circuito_semi_id: String(row.circuito_semi_id),
            moved_steps: Number(row.moved_steps || 0),
        };
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
            const circ = await this.findOrCreateOpenCircuito(tx, {
                circuitoId: input.circuitoId,
                tractorId,
                semiId,
                coordUserId: input.origen === 'coordinacion' ? input.actorUsuarioId : null,
            });
            // Cerrar cualquier estadía activa previa dentro del mismo circuito (Doble Carta)
            await tx
                .update(schema_js_1.procesos)
                .set({
                salidaAt: (0, drizzle_orm_1.sql) `GREATEST(now(), COALESCE(${schema_js_1.procesos.ingresoBoxAt}, ${schema_js_1.procesos.llegadaZonaAt}, ${schema_js_1.procesos.pendienteAt}))`,
                updatedAt: (0, drizzle_orm_1.sql) `now()`,
            })
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.procesos.circuitoId, circ.id), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.salidaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.anuladoAt), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNotNull)(schema_js_1.procesos.llegadaZonaAt), (0, drizzle_orm_1.isNotNull)(schema_js_1.procesos.ingresoBoxAt))));
            const now = new Date();
            const [created] = await tx
                .insert(schema_js_1.procesos)
                .values({
                circuitoId: circ.id,
                zoneId: boxRow[0].zoneId,
                boxId: input.boxId,
                pendienteAt: now,
                llegadaZonaAt: now,
                usuariosIds: input.usuariosIds || [],
            })
                .returning();
            if (input.notaTexto && input.notaTexto.trim()) {
                const resolvedTallerUserId = input.origen === 'taller'
                    ? input.notaUsuarioId || input.actorUsuarioId || null
                    : input.notaUsuarioId || null;
                const isCoord = input.origen === 'coordinacion' || !resolvedTallerUserId;
                await tx.insert(schema_js_1.procesosNotas).values({
                    circuitoId: circ.id,
                    procesoId: created.id,
                    usuarioId: isCoord ? null : resolvedTallerUserId,
                    location: isCoord ? 'Coordinación' : boxRow[0].boxName,
                    texto: input.notaTexto.trim(),
                });
            }
            const virtualUnit = this.resolveVirtualUnit(index, circ.tractorId, circ.semiId);
            return {
                ...created,
                proceso_id: created.id,
                unidad_id: virtualUnit.unidad_id,
                tractor_id: circ.tractorId,
                semi_id: circ.semiId,
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
            const lockedRes = await tx.execute((0, drizzle_orm_1.sql) `SELECT
              id, circuito_id, zone_id, box_id, estado,
              pendiente_at, llegada_zona_at, ingreso_box_at, salida_at, anulado_at,
              usuarios_ids, encargado_id, encargado_at
            FROM base.procesos
            WHERE id = ${procesoId}::uuid
            FOR UPDATE`);
            if (lockedRes.rows.length === 0) {
                // Fallback: si se solicita REABRIR o REINTEGRAR_A_PREASIGNADO sobre un registro ya en procesos_cold (> 7 días)
                if (patch.action === 'REABRIR' || patch.action === 'REINTEGRAR_A_PREASIGNADO') {
                    const coldRes = await tx.execute((0, drizzle_orm_1.sql) `SELECT
                  id, circuito_id, zone_id, box_id, estado,
                  pendiente_at, llegada_zona_at, ingreso_box_at, salida_at, anulado_at,
                  usuarios_ids, encargado_id, encargado_at
                FROM base.procesos_cold
                WHERE id = ${procesoId}::uuid
                FOR UPDATE`);
                    if (coldRes.rows.length > 0) {
                        const c = coldRes.rows[0];
                        if (c.anulado_at && patch.action === 'REABRIR') {
                            throw new ConflictError('No se puede reabrir un proceso que fue deshecho.');
                        }
                        const circId = String(c.circuito_id);
                        const circLock = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, tractor_id, semi_id, desunion_at, egreso_at
                  FROM base.circuitos
                  WHERE id = ${circId}::uuid
                  FOR UPDATE`);
                        if (circLock.rows.length === 0) {
                            throw new NotFoundError(`Circuito (${circId}) no encontrado.`);
                        }
                        const circ = circLock.rows[0];
                        if (circ.desunion_at) {
                            throw new ConflictError('Este paso pertenece a un circuito que fue desunido; operá sobre el circuito individual del tractor o semi.');
                        }
                        if (circ.egreso_at) {
                            await this.assertSinCircuitoAbiertoColision(tx, {
                                excludeCircuitoId: circId,
                                tractorId: circ.tractor_id,
                                semiId: circ.semi_id,
                            });
                            await tx
                                .update(schema_js_1.circuitos)
                                .set({
                                egresoAt: null,
                                bajaCoordId: null,
                                archivedAt: null,
                                updatedAt: (0, drizzle_orm_1.sql) `now()`,
                            })
                                .where((0, drizzle_orm_1.eq)(schema_js_1.circuitos.id, circId));
                        }
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
                                circuitoId: circId,
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
                            circuitoId: circId,
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
                            circuitoId: circId,
                            zoneId: nextZoneId,
                            boxId: nextBoxId,
                            estado: targetEstado === 'LLEGADA'
                                ? null
                                : patch.estado !== undefined
                                    ? patch.estado
                                    : this.normalizeBoxEstado(c.estado) ?? 'adentro',
                            pendienteAt: pendDate,
                            llegadaZonaAt: llegDate,
                            ingresoBoxAt: nextIngDate,
                            salidaAt: null,
                            usuariosIds: patch.usuariosIds !== undefined
                                ? patch.usuariosIds
                                : Array.isArray(c.usuarios_ids)
                                    ? c.usuarios_ids
                                    : [],
                            encargadoId: c.encargado_id || null,
                            encargadoAt: c.encargado_at ? new Date(String(c.encargado_at)) : null,
                        })
                            .returning();
                        await tx.delete(schema_js_1.procesosCold).where((0, drizzle_orm_1.eq)(schema_js_1.procesosCold.id, procesoId));
                        const vu = this.resolveVirtualUnit(index, circ.tractor_id, circ.semi_id);
                        return {
                            ...reopened,
                            proceso_id: reopened.id,
                            unidad_id: vu.unidad_id,
                            tractor_id: circ.tractor_id,
                            semi_id: circ.semi_id,
                            llegada_at: (reopened.llegadaZonaAt || reopened.pendienteAt).toISOString(),
                            inicio_at: reopened.ingresoBoxAt ? reopened.ingresoBoxAt.toISOString() : null,
                            salida_at: null,
                        };
                    }
                }
                throw new NotFoundError('Proceso no encontrado en base.procesos ni en base.procesos_cold');
            }
            const current = lockedRes.rows[0];
            const circRows = await tx
                .select({
                id: schema_js_1.circuitos.id,
                tractorId: schema_js_1.circuitos.tractorId,
                semiId: schema_js_1.circuitos.semiId,
                desunionAt: schema_js_1.circuitos.desunionAt,
                egresoAt: schema_js_1.circuitos.egresoAt,
            })
                .from(schema_js_1.circuitos)
                .where((0, drizzle_orm_1.eq)(schema_js_1.circuitos.id, current.circuito_id))
                .limit(1);
            const currentCirc = circRows[0];
            // 1. EGRESO PLANTA / BAJA (ARCHIVAR): cierra el circuito en cualquier instancia; pasos abiertos pasan incompletos a Cold
            if (patch.action === 'ARCHIVAR') {
                const bajaRes = await this.bajaCircuitoTx(tx, current.circuito_id, patch.origen === 'coordinacion' ? patch.actorUsuarioId : null);
                return {
                    archivedToCold: current,
                    ...bajaRes,
                };
            }
            // 1b. DESHACER CARD (top-right X): cierra la fila individual con anulado_at preservando NULL en campos no completados, listo para Cold
            if (patch.action === 'DESHACER') {
                if (patch.origen === 'coordinacion') {
                    const isCoordOk = await this.isCoordinacionUserAuthorized(patch.actorUsuarioId);
                    if (!isCoordOk) {
                        throw new ForbiddenError('Permiso denegado: solo usuarios autorizados de Coordinación o encargados de zona pueden deshacer una card.');
                    }
                }
                else if (patch.origen === 'taller') {
                    const actorMeta = await this.resolveTallerActorMeta(patch.actorUsuarioId, index);
                    if (!actorMeta || actorMeta.rol !== 'encargado_zona') {
                        throw new ForbiddenError('Permiso denegado: solo usuarios de Coordinación o encargados de zona pueden deshacer una card.');
                    }
                    if (!actorMeta.zone_id || actorMeta.zone_id !== current.zone_id) {
                        throw new ForbiddenError('Permiso denegado: el encargado_zona solo puede deshacer cards dentro de su zona asignada.');
                    }
                }
                else {
                    throw new ForbiddenError('Permiso denegado: solo usuarios de Coordinación o encargados de zona pueden deshacer una card.');
                }
                if (current.anulado_at) {
                    throw new ConflictError('Esta card ya fue deshecha.');
                }
                if (current.salida_at) {
                    throw new ConflictError('No se puede deshacer una card ya finalizada.');
                }
                const [undone] = await tx
                    .update(schema_js_1.procesos)
                    .set({
                    anuladoAt: (0, drizzle_orm_1.sql) `GREATEST(now(), COALESCE(${schema_js_1.procesos.ingresoBoxAt}, ${schema_js_1.procesos.llegadaZonaAt}, ${schema_js_1.procesos.pendienteAt}))`,
                    updatedAt: (0, drizzle_orm_1.sql) `now()`,
                })
                    .where((0, drizzle_orm_1.eq)(schema_js_1.procesos.id, current.id))
                    .returning();
                return {
                    undoneProceso: undone,
                    proceso_id: undone.id,
                    circuito_id: undone.circuitoId,
                    anulado_at: undone.anuladoAt ? undone.anuladoAt.toISOString() : new Date().toISOString(),
                };
            }
            if (current.anulado_at) {
                throw new ConflictError('El proceso fue deshecho y no puede modificarse.');
            }
            // 2. REVERTIR A HOLD (PREASIGNADO): UPDATE in-place en base.procesos (mismo UUID, 0 deletes!)
            if (patch.action === 'REVERTIR_A_HOLD') {
                if (current.salida_at) {
                    throw new ConflictError('No se puede revertir a pendiente un proceso ya finalizado.');
                }
                const targetZoneId = patch.zoneId || current.zone_id;
                const otherPendingSameZone = await tx
                    .select({ id: schema_js_1.procesos.id })
                    .from(schema_js_1.procesos)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.ne)(schema_js_1.procesos.id, current.id), (0, drizzle_orm_1.eq)(schema_js_1.procesos.circuitoId, current.circuito_id), (0, drizzle_orm_1.eq)(schema_js_1.procesos.zoneId, targetZoneId), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.llegadaZonaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.ingresoBoxAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.salidaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.anuladoAt)))
                    .limit(1);
                if (otherPendingSameZone.length > 0) {
                    throw new ConflictError('El circuito ya posee una tarjeta PREASIGNADO en esta misma zona.');
                }
                const [reverted] = await tx
                    .update(schema_js_1.procesos)
                    .set({
                    llegadaZonaAt: null,
                    ingresoBoxAt: null,
                    salidaAt: null,
                    boxId: null,
                    estado: null,
                    zoneId: targetZoneId,
                    updatedAt: (0, drizzle_orm_1.sql) `now()`,
                })
                    .where((0, drizzle_orm_1.eq)(schema_js_1.procesos.id, current.id))
                    .returning();
                return { revertedToHold: reverted, hold_id: reverted.id };
            }
            // 3. DESPRENDER PREASIGNADO EN NUEVA ZONA (desde FINALIZÓ, activo u otro PREASIGNADO — Multi-Preasignado)
            if (patch.action === 'REINTEGRAR_A_PREASIGNADO') {
                if (currentCirc?.desunionAt) {
                    throw new ConflictError('El circuito fue desunido; creá la preasignación sobre el circuito individual correspondiente.');
                }
                if (currentCirc?.egresoAt) {
                    await this.assertSinCircuitoAbiertoColision(tx, {
                        excludeCircuitoId: current.circuito_id,
                        tractorId: currentCirc.tractorId,
                        semiId: currentCirc.semiId,
                    });
                    await tx
                        .update(schema_js_1.circuitos)
                        .set({
                        egresoAt: null,
                        bajaCoordId: null,
                        archivedAt: null,
                        updatedAt: (0, drizzle_orm_1.sql) `now()`,
                    })
                        .where((0, drizzle_orm_1.eq)(schema_js_1.circuitos.id, current.circuito_id));
                }
                let targetZoneId = patch.zoneId || null;
                if (!targetZoneId && patch.boxId) {
                    targetZoneId = index.boxesMap.get(patch.boxId)?.zone_id || null;
                }
                if (!targetZoneId)
                    targetZoneId = current.zone_id;
                const existingPendingSameZone = await tx
                    .select({ id: schema_js_1.procesos.id })
                    .from(schema_js_1.procesos)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.procesos.circuitoId, current.circuito_id), (0, drizzle_orm_1.eq)(schema_js_1.procesos.zoneId, targetZoneId), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.llegadaZonaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.ingresoBoxAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.salidaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.anuladoAt)))
                    .limit(1);
                let holdRow;
                if (existingPendingSameZone.length > 0) {
                    const [upd] = await tx
                        .update(schema_js_1.procesos)
                        .set({
                        zoneId: targetZoneId,
                        boxId: null,
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
                        zoneId: targetZoneId,
                        boxId: null,
                        pendienteAt: new Date(),
                        usuariosIds: [],
                    })
                        .returning();
                    holdRow = ins;
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
            if (patch.origen === 'taller') {
                const actorMeta = await this.resolveTallerActorMeta(patch.actorUsuarioId, index);
                if (patch.zoneId !== undefined && patch.zoneId !== current.zone_id) {
                    throw new ForbiddenError('Permiso denegado: usuarios de taller no pueden reasignar zone_id entre zonas.');
                }
                const currentUsers = Array.isArray(current.usuarios_ids) ? current.usuarios_ids : [];
                const currentUsersSet = new Set(currentUsers);
                const patchUsersArr = patch.usuariosIds ?? [];
                const selfId = actorMeta?.id || patch.actorUsuarioId || null;
                const isSameUsersList = patch.usuariosIds !== undefined &&
                    new Set(patchUsersArr).size === currentUsersSet.size &&
                    patchUsersArr.every((uid) => currentUsersSet.has(uid));
                const isSelfStartAdd = patch.action === 'INICIAR' &&
                    currentUsers.every((uid) => patchUsersArr.includes(uid)) &&
                    patchUsersArr.every((uid) => currentUsersSet.has(uid) || (selfId !== null && uid === selfId));
                const isEditingUsuarios = patch.usuariosIds !== undefined && !isSameUsersList && !isSelfStartAdd;
                const actorOwnBoxInZone = actorMeta?.rol === 'operario' &&
                    actorMeta.box_id &&
                    index.boxesMap.get(actorMeta.box_id)?.zone_id === current.zone_id
                    ? actorMeta.box_id
                    : null;
                const isSelfBoxStartOrReopen = (patch.action === 'INICIAR' || patch.action === 'REABRIR') &&
                    actorOwnBoxInZone !== null &&
                    patch.boxId === actorOwnBoxInZone;
                const isEditingBox = patch.boxId !== undefined &&
                    patch.boxId !== current.box_id &&
                    !isSelfBoxStartOrReopen;
                const isOperarioBoxTransfer = actorMeta?.rol === 'operario' &&
                    !patch.action &&
                    Boolean(current.ingreso_box_at) &&
                    !current.salida_at &&
                    patch.boxId !== undefined &&
                    patch.boxId !== current.box_id;
                if (isOperarioBoxTransfer && !isEditingUsuarios) {
                    if (!actorMeta.zone_id || actorMeta.zone_id !== current.zone_id) {
                        throw new ForbiddenError('Permiso denegado: el operario solo puede mover cards dentro de su zona asignada.');
                    }
                    const targetBoxInfo = index.boxesMap.get(patch.boxId);
                    if (!targetBoxInfo || targetBoxInfo.zone_id !== actorMeta.zone_id) {
                        throw new ForbiddenError('Permiso denegado: el box destino no pertenece a la zona del operario.');
                    }
                    if (currentCirc?.egresoAt || currentCirc?.desunionAt) {
                        throw new ConflictError('No se puede mover una card de un circuito cerrado o desunido.');
                    }
                    // 1. Cerrar la fila actual en base.procesos antes del INSERT para liberar uq_procesos_activo
                    const [closedRow] = await tx
                        .update(schema_js_1.procesos)
                        .set({
                        salidaAt: (0, drizzle_orm_1.sql) `GREATEST(now(), COALESCE(${schema_js_1.procesos.ingresoBoxAt}, ${schema_js_1.procesos.llegadaZonaAt}, ${schema_js_1.procesos.pendienteAt}))`,
                        updatedAt: (0, drizzle_orm_1.sql) `now()`,
                    })
                        .where((0, drizzle_orm_1.eq)(schema_js_1.procesos.id, current.id))
                        .returning({ salidaAt: schema_js_1.procesos.salidaAt });
                    // 2. Insertar nueva fila asignada al box destino
                    const boxOps = (index.operariosByBoxMap.get(patch.boxId) || []).map((o) => o.id);
                    const nextUsuarios = actorMeta.box_id === patch.boxId
                        ? Array.from(new Set([...boxOps, actorMeta.id]))
                        : boxOps;
                    const newRowTs = new Date(Math.max(Date.now(), closedRow?.salidaAt ? closedRow.salidaAt.getTime() : 0));
                    const nextEstado = (patch.estado !== undefined
                        ? patch.estado
                        : this.normalizeBoxEstado(current.estado)) ?? 'adentro';
                    const [newRow] = await tx
                        .insert(schema_js_1.procesos)
                        .values({
                        circuitoId: current.circuito_id,
                        zoneId: targetBoxInfo.zone_id,
                        boxId: patch.boxId,
                        estado: nextEstado,
                        pendienteAt: newRowTs,
                        llegadaZonaAt: newRowTs,
                        ingresoBoxAt: newRowTs,
                        salidaAt: null,
                        usuariosIds: nextUsuarios,
                        encargadoId: null,
                        encargadoAt: null,
                    })
                        .returning();
                    const vu = this.resolveVirtualUnit(index, currentCirc?.tractorId ?? null, currentCirc?.semiId ?? null);
                    return {
                        ...newRow,
                        proceso_id: newRow.id,
                        closed_proceso_id: current.id,
                        reassigned_new_row: true,
                        unidad_id: vu.unidad_id,
                        tractor_id: currentCirc?.tractorId ?? null,
                        semi_id: currentCirc?.semiId ?? null,
                        box_name: targetBoxInfo.box_name,
                        estado: this.normalizeBoxEstado(newRow.estado),
                        encargado_id: null,
                        encargado_nombre: null,
                        encargado_at: null,
                        llegada_at: (newRow.llegadaZonaAt || newRow.pendienteAt).toISOString(),
                        inicio_at: newRow.ingresoBoxAt ? newRow.ingresoBoxAt.toISOString() : null,
                        salida_at: null,
                        ultima_tarea: null,
                        pending_hold: null,
                    };
                }
                if (isEditingUsuarios || isEditingBox) {
                    if (!actorMeta || actorMeta.rol !== 'encargado_zona') {
                        throw new ForbiddenError('Permiso denegado: solo el rol encargado_zona puede editar usuarios_ids o box_id en procesos.');
                    }
                    if (!actorMeta.zone_id || actorMeta.zone_id !== current.zone_id) {
                        throw new ForbiddenError('Permiso denegado: el encargado_zona solo puede editar procesos dentro de su zona asignada.');
                    }
                    if (patch.boxId) {
                        const targetBoxInfo = index.boxesMap.get(patch.boxId);
                        if (!targetBoxInfo || targetBoxInfo.zone_id !== actorMeta.zone_id) {
                            throw new ForbiddenError('Permiso denegado: el box destino no pertenece a la zona del encargado.');
                        }
                    }
                    updates.encargadoId = actorMeta.id;
                    updates.encargadoAt = (0, drizzle_orm_1.sql) `now()`;
                }
                if (!patch.boxId &&
                    (patch.action === 'INICIAR' || patch.action === 'REABRIR') &&
                    actorOwnBoxInZone) {
                    updates.boxId = actorOwnBoxInZone;
                }
                // Auto-asignación de operarios del box cuando encargado_zona hace drop en un box
                const isEncargadoDropInBox = actorMeta?.rol === 'encargado_zona' &&
                    (patch.action === 'INICIAR' ||
                        (patch.action === 'REABRIR' && patch.targetEstado === 'INICIO') ||
                        (patch.boxId !== undefined && patch.boxId !== current.box_id));
                if (isEncargadoDropInBox) {
                    const resolvedBoxId = patch.boxId || current.box_id;
                    if (resolvedBoxId && patch.usuariosIds === undefined) {
                        const boxOps = index.operariosByBoxMap.get(resolvedBoxId) || [];
                        updates.usuariosIds = boxOps.map((o) => o.id);
                    }
                    updates.encargadoId = actorMeta.id;
                    updates.encargadoAt = (0, drizzle_orm_1.sql) `now()`;
                }
                // Jerarquía 1 (encargado_zona): edición in-place en contenedor zona actualiza la row y su tz
                const isEncargadoZoneContainerEdit = actorMeta?.rol === 'encargado_zona' &&
                    !patch.action &&
                    Boolean(current.ingreso_box_at) &&
                    !current.salida_at &&
                    (isEditingBox || (patch.estado !== undefined && patch.estado !== current.estado));
                if (isEncargadoZoneContainerEdit) {
                    if (!actorMeta.zone_id || actorMeta.zone_id !== current.zone_id) {
                        throw new ForbiddenError('Permiso denegado: el encargado_zona solo puede editar procesos dentro de su zona asignada.');
                    }
                    updates.ingresoBoxAt = (0, drizzle_orm_1.sql) `GREATEST(now(), COALESCE(${schema_js_1.procesos.llegadaZonaAt}, ${schema_js_1.procesos.pendienteAt}))`;
                    updates.encargadoId = actorMeta.id;
                    updates.encargadoAt = (0, drizzle_orm_1.sql) `now()`;
                }
            }
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
                const effectiveZoneId = updates.zoneId || current.zone_id;
                updates.usuariosIds = await this.sanitizeAndValidateUsuariosIds(patch.usuariosIds, effectiveZoneId, patch.origen === 'taller', index);
            }
            if (patch.estado !== undefined) {
                updates.estado = patch.estado;
            }
            let pendingHold = null;
            let lastNoteText = null;
            if (patch.action === 'REABRIR') {
                if (currentCirc?.desunionAt) {
                    throw new ConflictError('Este paso pertenece a un circuito que fue desunido; operá sobre el circuito individual correspondiente.');
                }
                if (currentCirc?.egresoAt) {
                    await this.assertSinCircuitoAbiertoColision(tx, {
                        excludeCircuitoId: current.circuito_id,
                        tractorId: currentCirc.tractorId,
                        semiId: currentCirc.semiId,
                    });
                    await tx
                        .update(schema_js_1.circuitos)
                        .set({
                        egresoAt: null,
                        bajaCoordId: null,
                        archivedAt: null,
                        updatedAt: (0, drizzle_orm_1.sql) `now()`,
                    })
                        .where((0, drizzle_orm_1.eq)(schema_js_1.circuitos.id, current.circuito_id));
                }
                if (current.salida_at || currentCirc?.egresoAt) {
                    await this.assertSinProcesoActivoColision(tx, {
                        excludeProcesoId: procesoId,
                        circuitoId: current.circuito_id,
                    });
                }
                const targetEstado = patch.targetEstado || (current.ingreso_box_at ? 'INICIO' : 'LLEGADA');
                updates.salidaAt = null;
                if (!current.llegada_zona_at) {
                    updates.llegadaZonaAt = (0, drizzle_orm_1.sql) `GREATEST(now(), ${schema_js_1.procesos.pendienteAt})`;
                }
                if (targetEstado === 'LLEGADA') {
                    updates.ingresoBoxAt = null;
                    updates.estado = null;
                }
                else {
                    if (!current.ingreso_box_at) {
                        updates.ingresoBoxAt = (0, drizzle_orm_1.sql) `GREATEST(now(), COALESCE(${schema_js_1.procesos.llegadaZonaAt}, ${schema_js_1.procesos.pendienteAt}))`;
                    }
                    updates.estado =
                        patch.estado !== undefined
                            ? patch.estado
                            : this.normalizeBoxEstado(current.estado) ?? 'adentro';
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
                updates.estado =
                    patch.estado !== undefined
                        ? patch.estado
                        : this.normalizeBoxEstado(current.estado) ?? 'adentro';
            }
            else if (patch.action === 'DESHACER_INICIO') {
                updates.ingresoBoxAt = null;
                updates.salidaAt = null;
                updates.estado = null;
                if (!current.llegada_zona_at) {
                    updates.llegadaZonaAt = current.pendiente_at;
                }
            }
            else if (patch.action === 'FINALIZAR') {
                if (!current.salida_at) {
                    updates.salidaAt = (0, drizzle_orm_1.sql) `GREATEST(now(), COALESCE(${schema_js_1.procesos.ingresoBoxAt}, ${schema_js_1.procesos.llegadaZonaAt}, ${schema_js_1.procesos.pendienteAt}))`;
                }
                const [holdRows, noteRows] = await Promise.all([
                    tx
                        .select({
                        id: schema_js_1.procesos.id,
                        zoneId: schema_js_1.procesos.zoneId,
                        boxId: schema_js_1.procesos.boxId,
                        usuariosIds: schema_js_1.procesos.usuariosIds,
                    })
                        .from(schema_js_1.procesos)
                        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.procesos.circuitoId, current.circuito_id), (0, drizzle_orm_1.ne)(schema_js_1.procesos.id, current.id), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.llegadaZonaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.ingresoBoxAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.salidaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.anuladoAt)))
                        .limit(1),
                    tx
                        .select({ texto: schema_js_1.procesosNotas.texto })
                        .from(schema_js_1.procesosNotas)
                        .where((0, drizzle_orm_1.eq)(schema_js_1.procesosNotas.circuitoId, current.circuito_id))
                        .orderBy((0, drizzle_orm_1.desc)(schema_js_1.procesosNotas.createdAt), (0, drizzle_orm_1.desc)(schema_js_1.procesosNotas.id))
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
            const vu = this.resolveVirtualUnit(index, currentCirc?.tractorId ?? null, currentCirc?.semiId ?? null);
            const boxInfo = row.boxId ? index.boxesMap.get(row.boxId) : null;
            return {
                ...row,
                proceso_id: row.id,
                unidad_id: vu.unidad_id,
                tractor_id: currentCirc?.tractorId ?? null,
                semi_id: currentCirc?.semiId ?? null,
                box_name: boxInfo?.box_name || '',
                estado: this.normalizeBoxEstado(row.estado),
                encargado_id: row.encargadoId || null,
                encargado_nombre: row.encargadoId ? index.usersMap.get(row.encargadoId) || null : null,
                encargado_at: row.encargadoAt ? row.encargadoAt.toISOString() : null,
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
     * Acepta procesoId, holdId o circuitoId directo; incluye notas heredadas del padre en hijos desunidos.
     */
    async agregarNota(procesoOrCircuitoId, usuarioId, texto, location) {
        const cleanText = texto.trim();
        if (!cleanText)
            throw new ConflictError('El texto de la nota no puede estar vacío.');
        const { index } = await this.ensureRuntimeIndex();
        const res = await index_js_1.db.transaction(async (tx) => {
            const procRows = await tx
                .select({ id: schema_js_1.procesos.id, circuitoId: schema_js_1.procesos.circuitoId, boxId: schema_js_1.procesos.boxId })
                .from(schema_js_1.procesos)
                .where((0, drizzle_orm_1.eq)(schema_js_1.procesos.id, procesoOrCircuitoId))
                .limit(1);
            let circuitoId = procRows.length > 0 ? procRows[0].circuitoId : null;
            let boxId = procRows.length > 0 ? procRows[0].boxId : null;
            let linkedProcesoId = procRows.length > 0 ? procRows[0].id : null;
            if (!circuitoId) {
                const coldRows = await tx
                    .select({ circuitoId: schema_js_1.procesosCold.circuitoId, boxId: schema_js_1.procesosCold.boxId })
                    .from(schema_js_1.procesosCold)
                    .where((0, drizzle_orm_1.eq)(schema_js_1.procesosCold.id, procesoOrCircuitoId))
                    .limit(1);
                if (coldRows.length > 0) {
                    circuitoId = coldRows[0].circuitoId;
                    boxId = coldRows[0].boxId;
                    linkedProcesoId = null;
                }
            }
            if (!circuitoId) {
                const directCirc = await tx
                    .select({ id: schema_js_1.circuitos.id })
                    .from(schema_js_1.circuitos)
                    .where((0, drizzle_orm_1.eq)(schema_js_1.circuitos.id, procesoOrCircuitoId))
                    .limit(1);
                if (directCirc.length > 0) {
                    circuitoId = directCirc[0].id;
                    linkedProcesoId = null;
                }
            }
            if (!circuitoId) {
                throw new NotFoundError(`Proceso o circuito ${procesoOrCircuitoId} no encontrado.`);
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
            const [circMeta] = await tx
                .select({ parentCircuitoId: schema_js_1.circuitos.parentCircuitoId })
                .from(schema_js_1.circuitos)
                .where((0, drizzle_orm_1.eq)(schema_js_1.circuitos.id, circuitoId))
                .limit(1);
            const idsToFetch = circMeta?.parentCircuitoId
                ? [circuitoId, circMeta.parentCircuitoId]
                : [circuitoId];
            const allNotes = await tx
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
                .where((0, drizzle_orm_1.inArray)(schema_js_1.procesosNotas.circuitoId, idsToFetch))
                .orderBy((0, drizzle_orm_1.asc)(schema_js_1.procesosNotas.createdAt), (0, drizzle_orm_1.asc)(schema_js_1.procesosNotas.id));
            return {
                procesoId: procesoOrCircuitoId,
                circuitoId,
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
            const [circMeta] = await tx
                .select({ parentCircuitoId: schema_js_1.circuitos.parentCircuitoId })
                .from(schema_js_1.circuitos)
                .where((0, drizzle_orm_1.eq)(schema_js_1.circuitos.id, updatedNote.circuitoId))
                .limit(1);
            const idsToFetch = circMeta?.parentCircuitoId
                ? [updatedNote.circuitoId, circMeta.parentCircuitoId]
                : [updatedNote.circuitoId];
            const allNotes = await tx
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
                .where((0, drizzle_orm_1.inArray)(schema_js_1.procesosNotas.circuitoId, idsToFetch))
                .orderBy((0, drizzle_orm_1.asc)(schema_js_1.procesosNotas.createdAt), (0, drizzle_orm_1.asc)(schema_js_1.procesosNotas.id));
            return {
                procesoId,
                circuitoId: updatedNote.circuitoId,
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
            const [circMeta] = await tx
                .select({ parentCircuitoId: schema_js_1.circuitos.parentCircuitoId })
                .from(schema_js_1.circuitos)
                .where((0, drizzle_orm_1.eq)(schema_js_1.circuitos.id, deletedNote.circuitoId))
                .limit(1);
            const idsToFetch = circMeta?.parentCircuitoId
                ? [deletedNote.circuitoId, circMeta.parentCircuitoId]
                : [deletedNote.circuitoId];
            const allNotes = await tx
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
                .where((0, drizzle_orm_1.inArray)(schema_js_1.procesosNotas.circuitoId, idsToFetch))
                .orderBy((0, drizzle_orm_1.asc)(schema_js_1.procesosNotas.createdAt), (0, drizzle_orm_1.asc)(schema_js_1.procesosNotas.id));
            return {
                procesoId,
                circuitoId: deletedNote.circuitoId,
                notes: allNotes.map((n) => this.mapNotaRow(n, index.usersMap)),
            };
        });
        this.invalidate();
        await this.hydrateBoard();
        return res;
    }
    /**
     * Gestión de PREASIGNADO (en base.procesos vinculado por FK a base.circuitos).
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
            const circ = await this.findOrCreateOpenCircuito(tx, {
                circuitoId: input.circuitoId,
                procesoOrigenId: input.procesoOrigenId,
                tractorId,
                semiId,
            });
            // Anti-duplicación en misma zona: impedir crear un PREASIGNADO si el circuito ya está activo en esa misma targetZoneId
            const activeSameZone = await tx
                .select({ id: schema_js_1.procesos.id })
                .from(schema_js_1.procesos)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.procesos.circuitoId, circ.id), (0, drizzle_orm_1.eq)(schema_js_1.procesos.zoneId, targetZoneId), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNotNull)(schema_js_1.procesos.llegadaZonaAt), (0, drizzle_orm_1.isNotNull)(schema_js_1.procesos.ingresoBoxAt)), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.salidaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.anuladoAt)))
                .limit(1);
            if (activeSameZone.length > 0) {
                throw new ConflictError('La unidad ya se encuentra activa en esta zona; preasignala en otra zona.');
            }
            // Multi-PREASIGNADO: permite múltiples cards PREASIGNADO en distintas zonas del circuito
            const existingPendingSameZone = await tx
                .select({ id: schema_js_1.procesos.id })
                .from(schema_js_1.procesos)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.procesos.circuitoId, circ.id), (0, drizzle_orm_1.eq)(schema_js_1.procesos.zoneId, targetZoneId), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.llegadaZonaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.ingresoBoxAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.salidaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.anuladoAt)))
                .limit(1);
            let holdRow;
            if (existingPendingSameZone.length > 0) {
                const [updated] = await tx
                    .update(schema_js_1.procesos)
                    .set({
                    zoneId: targetZoneId,
                    boxId: input.boxId ?? null,
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
                    circuitoId: circ.id,
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
                    circuitoId: circ.id,
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
            const lockedRes = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, circuito_id, zone_id, box_id, usuarios_ids, anulado_at
            FROM base.procesos
            WHERE id = ${holdId}::uuid
            FOR UPDATE`);
            if (lockedRes.rows.length === 0) {
                throw new NotFoundError(`Preasignación ${holdId} no encontrada en base.procesos.`);
            }
            const current = lockedRes.rows[0];
            if (current.anulado_at) {
                throw new ConflictError('No se puede editar una preasignación deshecha.');
            }
            const updates = {
                updatedAt: (0, drizzle_orm_1.sql) `now()`,
            };
            if (patch.origen === 'taller') {
                const actorMeta = await this.resolveTallerActorMeta(patch.actorUsuarioId, index);
                if (patch.zoneId !== undefined && patch.zoneId !== current.zone_id) {
                    throw new ForbiddenError('Permiso denegado: usuarios de taller no pueden reasignar zone_id entre zonas.');
                }
                const isEditingBox = patch.boxId !== undefined && patch.boxId !== current.box_id;
                const isEditingUsuarios = patch.usuariosIds !== undefined;
                if (isEditingBox || isEditingUsuarios) {
                    if (!actorMeta || actorMeta.rol !== 'encargado_zona') {
                        throw new ForbiddenError('Permiso denegado: solo el rol encargado_zona puede editar usuarios_ids o box_id en preasignaciones.');
                    }
                    if (!actorMeta.zone_id || actorMeta.zone_id !== current.zone_id) {
                        throw new ForbiddenError('Permiso denegado: el encargado_zona solo puede editar preasignaciones dentro de su zona asignada.');
                    }
                    if (patch.boxId) {
                        const targetBoxInfo = index.boxesMap.get(patch.boxId);
                        if (!targetBoxInfo || targetBoxInfo.zone_id !== actorMeta.zone_id) {
                            throw new ForbiddenError('Permiso denegado: el box destino no pertenece a la zona del encargado.');
                        }
                    }
                    updates.encargadoId = actorMeta.id;
                    updates.encargadoAt = (0, drizzle_orm_1.sql) `now()`;
                }
            }
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
            if (patch.usuariosIds !== undefined) {
                const effectiveZoneId = updates.zoneId || current.zone_id;
                updates.usuariosIds = await this.sanitizeAndValidateUsuariosIds(patch.usuariosIds, effectiveZoneId, patch.origen === 'taller', index);
            }
            const [row] = await tx
                .update(schema_js_1.procesos)
                .set(updates)
                .where((0, drizzle_orm_1.eq)(schema_js_1.procesos.id, holdId))
                .returning();
            if (!row) {
                throw new NotFoundError(`Preasignación ${holdId} no encontrada en base.procesos.`);
            }
            if (patch.notaPlanificacion && patch.notaPlanificacion.trim()) {
                const isTallerOrigen = patch.origen === 'taller' && Boolean(patch.actorUsuarioId);
                let notaUsuarioId = null;
                let notaLocation = 'Coordinación';
                if (isTallerOrigen) {
                    const actorMeta = await this.resolveTallerActorMeta(patch.actorUsuarioId, index);
                    notaUsuarioId = actorMeta?.id || patch.actorUsuarioId || null;
                    const boxName = (row.boxId ? index.boxesMap.get(row.boxId)?.box_name : null) ||
                        (actorMeta?.box_id ? index.boxesMap.get(actorMeta.box_id)?.box_name : null);
                    notaLocation = boxName || index.zonesMap.get(row.zoneId) || 'Box';
                }
                await tx.insert(schema_js_1.procesosNotas).values({
                    circuitoId: row.circuitoId,
                    procesoId: row.id,
                    usuarioId: notaUsuarioId,
                    location: notaLocation,
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
            // Si el circuito quedó sin pasos abiertos (vacío o solo con pasos ya finalizados), cerrar el circuito en base.circuitos
            if (deleted) {
                const remainingOpen = await tx
                    .select({ id: schema_js_1.procesos.id })
                    .from(schema_js_1.procesos)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.procesos.circuitoId, deleted.circuitoId), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.salidaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.anuladoAt)))
                    .limit(1);
                if (remainingOpen.length === 0) {
                    await tx
                        .update(schema_js_1.circuitos)
                        .set({
                        egresoAt: (0, drizzle_orm_1.sql) `GREATEST(now(), ${schema_js_1.circuitos.ingresoAt})`,
                        updatedAt: (0, drizzle_orm_1.sql) `now()`,
                    })
                        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.circuitos.id, deleted.circuitoId), (0, drizzle_orm_1.isNull)(schema_js_1.circuitos.egresoAt), (0, drizzle_orm_1.isNull)(schema_js_1.circuitos.desunionAt)));
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
    async activarHold(holdId, boxId, iniciarInmediato = false, actorUsuarioId, estado) {
        const { index } = await this.ensureRuntimeIndex();
        const actorMeta = actorUsuarioId
            ? await this.resolveTallerActorMeta(actorUsuarioId, index)
            : null;
        const res = await index_js_1.db.transaction(async (tx) => {
            const locked = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, circuito_id, zone_id, box_id, estado, usuarios_ids, pendiente_at, anulado_at
            FROM base.procesos
            WHERE id = ${holdId}::uuid
            FOR UPDATE`);
            if (locked.rows.length === 0) {
                throw new NotFoundError(`Preasignación (${holdId}) no encontrada en base.procesos`);
            }
            const hold = locked.rows[0];
            if (hold.anulado_at) {
                throw new ConflictError('No se puede activar una preasignación deshecha.');
            }
            const [circ] = await tx
                .select({
                id: schema_js_1.circuitos.id,
                parentCircuitoId: schema_js_1.circuitos.parentCircuitoId,
                tractorId: schema_js_1.circuitos.tractorId,
                semiId: schema_js_1.circuitos.semiId,
                desunionAt: schema_js_1.circuitos.desunionAt,
                egresoAt: schema_js_1.circuitos.egresoAt,
            })
                .from(schema_js_1.circuitos)
                .where((0, drizzle_orm_1.eq)(schema_js_1.circuitos.id, hold.circuito_id))
                .limit(1);
            if (!circ || circ.egresoAt || circ.desunionAt) {
                throw new ConflictError('No se puede activar una preasignación cuyo circuito está cerrado o desunido.');
            }
            const actorOwnBoxInZone = actorMeta?.rol === 'operario' &&
                actorMeta.box_id &&
                index.boxesMap.get(actorMeta.box_id)?.zone_id === hold.zone_id
                ? actorMeta.box_id
                : null;
            let targetBoxId = actorOwnBoxInZone || boxId || hold.box_id || null;
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
            // Cerrar cualquier estadía activa previa no finalizada del mismo circuito (Doble Carta)
            await tx
                .update(schema_js_1.procesos)
                .set({
                salidaAt: (0, drizzle_orm_1.sql) `GREATEST(now(), COALESCE(${schema_js_1.procesos.ingresoBoxAt}, ${schema_js_1.procesos.llegadaZonaAt}, ${schema_js_1.procesos.pendienteAt}))`,
                updatedAt: (0, drizzle_orm_1.sql) `now()`,
            })
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.procesos.circuitoId, hold.circuito_id), (0, drizzle_orm_1.ne)(schema_js_1.procesos.id, hold.id), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.salidaAt), (0, drizzle_orm_1.isNull)(schema_js_1.procesos.anuladoAt), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNotNull)(schema_js_1.procesos.llegadaZonaAt), (0, drizzle_orm_1.isNotNull)(schema_js_1.procesos.ingresoBoxAt))));
            const existingUsers = Array.isArray(hold.usuarios_ids) ? hold.usuarios_ids : [];
            const boxOperariosIds = (index.operariosByBoxMap.get(targetBoxId) || []).map((o) => o.id);
            const nextUsuariosIds = iniciarInmediato && actorMeta?.rol === 'encargado_zona'
                ? boxOperariosIds
                : iniciarInmediato && actorMeta?.rol === 'operario' && !existingUsers.includes(actorMeta.id)
                    ? [...existingUsers, actorMeta.id]
                    : existingUsers;
            const [activated] = await tx
                .update(schema_js_1.procesos)
                .set({
                zoneId: boxInfo.zone_id,
                boxId: targetBoxId,
                estado: iniciarInmediato ? estado ?? 'adentro' : null,
                usuariosIds: nextUsuariosIds,
                ...(actorMeta?.rol === 'encargado_zona'
                    ? {
                        encargadoId: actorMeta.id,
                        encargadoAt: (0, drizzle_orm_1.sql) `now()`,
                    }
                    : {}),
                llegadaZonaAt: (0, drizzle_orm_1.sql) `GREATEST(now(), ${schema_js_1.procesos.pendienteAt})`,
                ingresoBoxAt: iniciarInmediato
                    ? (0, drizzle_orm_1.sql) `GREATEST(clock_timestamp(), ${schema_js_1.procesos.pendienteAt})`
                    : null,
                updatedAt: (0, drizzle_orm_1.sql) `now()`,
            })
                .where((0, drizzle_orm_1.eq)(schema_js_1.procesos.id, hold.id))
                .returning();
            const vu = this.resolveVirtualUnit(index, circ.tractorId, circ.semiId);
            const idsToFetch = circ.parentCircuitoId
                ? [activated.circuitoId, circ.parentCircuitoId]
                : [activated.circuitoId];
            const notesMap = await this.fetchNotesMapByCircuitos(idsToFetch, index.usersMap);
            const mergedNotes = this.mergeCircuitoNotes(activated.circuitoId, circ.parentCircuitoId, notesMap);
            return {
                ...activated,
                id: activated.id,
                proceso_id: activated.id,
                unidad_id: vu.unidad_id,
                tractor_id: circ.tractorId,
                semi_id: circ.semiId,
                box_id: activated.boxId,
                estado: this.normalizeBoxEstado(activated.estado),
                llegada_at: (activated.llegadaZonaAt || activated.pendienteAt).toISOString(),
                inicio_at: activated.ingresoBoxAt ? activated.ingresoBoxAt.toISOString() : null,
                salida_at: activated.salidaAt ? activated.salidaAt.toISOString() : null,
                notes: mergedNotes,
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
                rol: (authRes.rol === 'encargado_zona' ? 'encargado_zona' : 'operario'),
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
        const rawUser = verifyRes.user;
        return {
            authorized: true,
            user: {
                ...rawUser,
                rol: (rawUser.rol === 'encargado_zona' ? 'encargado_zona' : 'operario'),
            },
        };
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
