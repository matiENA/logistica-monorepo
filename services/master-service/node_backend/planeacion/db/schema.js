"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.procesosColdRelations = exports.procesosNotasRelations = exports.procesosRelations = exports.circuitosRelations = exports.unidadesRelations = exports.usuariosTallerRelations = exports.boxesRelations = exports.zonesRelations = exports.procesosCold = exports.procesosNotas = exports.procesos = exports.circuitos = exports.unidades = exports.semis = exports.tractores = exports.userCoordinacion = exports.usuariosTaller = exports.boxes = exports.zones = exports.baseSchema = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const drizzle_orm_1 = require("drizzle-orm");
exports.baseSchema = (0, pg_core_1.pgSchema)('base');
exports.zones = exports.baseSchema.table('zones', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    zoneName: (0, pg_core_1.text)('zone_name').notNull().unique(),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
exports.boxes = exports.baseSchema.table('boxes', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    zoneId: (0, pg_core_1.uuid)('zone_id')
        .notNull()
        .references(() => exports.zones.id, { onDelete: 'restrict' }),
    boxName: (0, pg_core_1.text)('box_name').notNull().unique(),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
exports.usuariosTaller = exports.baseSchema.table('usuarios_taller', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    nombreUsuario: (0, pg_core_1.text)('nombre_usuario').notNull().unique(),
    password: (0, pg_core_1.text)('password').notNull(),
    rol: (0, pg_core_1.text)('rol').notNull().default('operario'),
    zoneId: (0, pg_core_1.uuid)('zone_id').references(() => exports.zones.id, { onDelete: 'set null' }),
    boxId: (0, pg_core_1.uuid)('box_id').references(() => exports.boxes.id, { onDelete: 'set null' }),
    authUserId: (0, pg_core_1.uuid)('auth_user_id'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
exports.userCoordinacion = exports.baseSchema.table('user_coordinacion', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    nombreUsuario: (0, pg_core_1.text)('nombre_usuario').notNull().unique(),
    password: (0, pg_core_1.text)('password').notNull(),
    zoneId: (0, pg_core_1.uuid)('zone_id').references(() => exports.zones.id, { onDelete: 'set null' }),
    boxId: (0, pg_core_1.uuid)('box_id').references(() => exports.boxes.id, { onDelete: 'set null' }),
    authUserId: (0, pg_core_1.uuid)('auth_user_id'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
exports.tractores = exports.baseSchema.table('tractores', {
    id: (0, pg_core_1.uuid)('id').primaryKey(),
    dominio: (0, pg_core_1.text)('dominio').notNull().unique(),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
exports.semis = exports.baseSchema.table('semis', {
    id: (0, pg_core_1.uuid)('id').primaryKey(),
    dominio: (0, pg_core_1.text)('dominio').unique(),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
// Índice virtual de acople Tractor + Semi (n_ute). No se almacena como FK en base.procesos.
exports.unidades = exports.baseSchema.table('unidades', {
    id: (0, pg_core_1.uuid)('id').primaryKey(),
    nUte: (0, pg_core_1.text)('n_ute'),
    tractorId: (0, pg_core_1.uuid)('tractor_id').references(() => exports.tractores.id, { onDelete: 'set null' }),
    semiId: (0, pg_core_1.uuid)('semi_id').references(() => exports.semis.id, { onDelete: 'set null' }),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
// Tabla Maestra de Circuitos V3 (base.circuitos):
// Cabecera del ciclo Alta (ingreso_at) -> Recorridos -> Baja (egreso_at) y Desunión en 2 circuitos hijos.
exports.circuitos = exports.baseSchema.table('circuitos', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    parentCircuitoId: (0, pg_core_1.uuid)('parent_circuito_id').references(() => exports.circuitos.id, {
        onDelete: 'restrict',
    }),
    tractorId: (0, pg_core_1.uuid)('tractor_id').references(() => exports.tractores.id, { onDelete: 'set null' }),
    semiId: (0, pg_core_1.uuid)('semi_id').references(() => exports.semis.id, { onDelete: 'set null' }),
    tractorN: (0, pg_core_1.text)('tractor_n'),
    semiN: (0, pg_core_1.text)('semi_n'),
    ingresoAt: (0, pg_core_1.timestamp)('ingreso_at', { withTimezone: true }).notNull().defaultNow(),
    desunionAt: (0, pg_core_1.timestamp)('desunion_at', { withTimezone: true }),
    egresoAt: (0, pg_core_1.timestamp)('egreso_at', { withTimezone: true }),
    altaCoordId: (0, pg_core_1.uuid)('alta_coord_id').references(() => exports.userCoordinacion.id, { onDelete: 'set null' }),
    bajaCoordId: (0, pg_core_1.uuid)('baja_coord_id').references(() => exports.userCoordinacion.id, { onDelete: 'set null' }),
    archivedAt: (0, pg_core_1.timestamp)('archived_at', { withTimezone: true }),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
// Tabla Única Operativa V3 (base.procesos):
// Unifica PREASIGNADO (pendiente_at), ESPERANDO A SER INGRESADO A BOX (llegada_zona_at),
// TRABAJANDO (ingreso_box_at) y FINALIZÓ (salida_at), vinculada por FK a base.circuitos.
exports.procesos = exports.baseSchema.table('procesos', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    circuitoId: (0, pg_core_1.uuid)('circuito_id')
        .notNull()
        .references(() => exports.circuitos.id, { onDelete: 'restrict' }),
    zoneId: (0, pg_core_1.uuid)('zone_id')
        .notNull()
        .references(() => exports.zones.id, { onDelete: 'restrict' }),
    orden: (0, pg_core_1.smallint)('orden'),
    pendienteAt: (0, pg_core_1.timestamp)('pendiente_at', { withTimezone: true }).notNull().defaultNow(),
    llegadaZonaAt: (0, pg_core_1.timestamp)('llegada_zona_at', { withTimezone: true }),
    boxId: (0, pg_core_1.uuid)('box_id').references(() => exports.boxes.id, { onDelete: 'restrict' }),
    estado: (0, pg_core_1.text)('estado').$type(),
    ingresoBoxAt: (0, pg_core_1.timestamp)('ingreso_box_at', { withTimezone: true }),
    usuariosIds: (0, pg_core_1.uuid)('usuarios_ids').array().notNull().default([]),
    encargadoId: (0, pg_core_1.uuid)('encargado_id').references(() => exports.usuariosTaller.id, { onDelete: 'set null' }),
    encargadoAt: (0, pg_core_1.timestamp)('encargado_at', { withTimezone: true }),
    salidaAt: (0, pg_core_1.timestamp)('salida_at', { withTimezone: true }),
    anuladoAt: (0, pg_core_1.timestamp)('anulado_at', { withTimezone: true }),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
// Notas Normalizadas por Circuito (base.procesos_notas - Opción C):
// Compartidas automáticamente en Doble Carta y heredadas por hijos tras desunión.
exports.procesosNotas = exports.baseSchema.table('procesos_notas', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    circuitoId: (0, pg_core_1.uuid)('circuito_id')
        .notNull()
        .references(() => exports.circuitos.id, { onDelete: 'cascade' }),
    procesoId: (0, pg_core_1.uuid)('proceso_id').references(() => exports.procesos.id, { onDelete: 'set null' }),
    usuarioId: (0, pg_core_1.uuid)('usuario_id'),
    location: (0, pg_core_1.text)('location').notNull().default('Coordinación'),
    texto: (0, pg_core_1.text)('texto').notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: (0, pg_core_1.timestamp)('edited_at', { withTimezone: true }),
});
// Store Histórico Semanal (base.procesos_cold):
// Recibe en batch semanal los pasos (completos o incompletos) de circuitos cerrados >= 7 días.
exports.procesosCold = exports.baseSchema.table('procesos_cold', {
    id: (0, pg_core_1.uuid)('id').primaryKey(),
    circuitoId: (0, pg_core_1.uuid)('circuito_id')
        .notNull()
        .references(() => exports.circuitos.id, { onDelete: 'restrict' }),
    zoneId: (0, pg_core_1.uuid)('zone_id').references(() => exports.zones.id, { onDelete: 'set null' }),
    orden: (0, pg_core_1.smallint)('orden'),
    pendienteAt: (0, pg_core_1.timestamp)('pendiente_at', { withTimezone: true }).notNull(),
    llegadaZonaAt: (0, pg_core_1.timestamp)('llegada_zona_at', { withTimezone: true }),
    boxId: (0, pg_core_1.uuid)('box_id').references(() => exports.boxes.id, { onDelete: 'set null' }),
    estado: (0, pg_core_1.text)('estado').$type(),
    ingresoBoxAt: (0, pg_core_1.timestamp)('ingreso_box_at', { withTimezone: true }),
    usuariosIds: (0, pg_core_1.uuid)('usuarios_ids').array().notNull().default([]),
    encargadoId: (0, pg_core_1.uuid)('encargado_id').references(() => exports.usuariosTaller.id, { onDelete: 'set null' }),
    encargadoAt: (0, pg_core_1.timestamp)('encargado_at', { withTimezone: true }),
    salidaAt: (0, pg_core_1.timestamp)('salida_at', { withTimezone: true }),
    anuladoAt: (0, pg_core_1.timestamp)('anulado_at', { withTimezone: true }),
    archivedAt: (0, pg_core_1.timestamp)('archived_at', { withTimezone: true }).notNull().defaultNow(),
});
// Relaciones Drizzle
exports.zonesRelations = (0, drizzle_orm_1.relations)(exports.zones, ({ many }) => ({
    boxes: many(exports.boxes),
    procesos: many(exports.procesos),
    procesosCold: many(exports.procesosCold),
}));
exports.boxesRelations = (0, drizzle_orm_1.relations)(exports.boxes, ({ one, many }) => ({
    zone: one(exports.zones, {
        fields: [exports.boxes.zoneId],
        references: [exports.zones.id],
    }),
    usuarios: many(exports.usuariosTaller),
    procesos: many(exports.procesos),
    procesosCold: many(exports.procesosCold),
}));
exports.usuariosTallerRelations = (0, drizzle_orm_1.relations)(exports.usuariosTaller, ({ one }) => ({
    defaultBox: one(exports.boxes, {
        fields: [exports.usuariosTaller.boxId],
        references: [exports.boxes.id],
    }),
    zone: one(exports.zones, {
        fields: [exports.usuariosTaller.zoneId],
        references: [exports.zones.id],
    }),
}));
exports.unidadesRelations = (0, drizzle_orm_1.relations)(exports.unidades, ({ one }) => ({
    tractor: one(exports.tractores, {
        fields: [exports.unidades.tractorId],
        references: [exports.tractores.id],
    }),
    semi: one(exports.semis, {
        fields: [exports.unidades.semiId],
        references: [exports.semis.id],
    }),
}));
exports.circuitosRelations = (0, drizzle_orm_1.relations)(exports.circuitos, ({ one, many }) => ({
    parent: one(exports.circuitos, {
        fields: [exports.circuitos.parentCircuitoId],
        references: [exports.circuitos.id],
        relationName: 'circuito_parent',
    }),
    children: many(exports.circuitos, { relationName: 'circuito_parent' }),
    tractor: one(exports.tractores, {
        fields: [exports.circuitos.tractorId],
        references: [exports.tractores.id],
    }),
    semi: one(exports.semis, {
        fields: [exports.circuitos.semiId],
        references: [exports.semis.id],
    }),
    altaCoord: one(exports.userCoordinacion, {
        fields: [exports.circuitos.altaCoordId],
        references: [exports.userCoordinacion.id],
    }),
    bajaCoord: one(exports.userCoordinacion, {
        fields: [exports.circuitos.bajaCoordId],
        references: [exports.userCoordinacion.id],
    }),
    procesos: many(exports.procesos),
    procesosCold: many(exports.procesosCold),
    notas: many(exports.procesosNotas),
}));
exports.procesosRelations = (0, drizzle_orm_1.relations)(exports.procesos, ({ one, many }) => ({
    circuito: one(exports.circuitos, {
        fields: [exports.procesos.circuitoId],
        references: [exports.circuitos.id],
    }),
    zone: one(exports.zones, {
        fields: [exports.procesos.zoneId],
        references: [exports.zones.id],
    }),
    box: one(exports.boxes, {
        fields: [exports.procesos.boxId],
        references: [exports.boxes.id],
    }),
    encargado: one(exports.usuariosTaller, {
        fields: [exports.procesos.encargadoId],
        references: [exports.usuariosTaller.id],
    }),
    notas: many(exports.procesosNotas),
}));
exports.procesosNotasRelations = (0, drizzle_orm_1.relations)(exports.procesosNotas, ({ one }) => ({
    circuito: one(exports.circuitos, {
        fields: [exports.procesosNotas.circuitoId],
        references: [exports.circuitos.id],
    }),
    proceso: one(exports.procesos, {
        fields: [exports.procesosNotas.procesoId],
        references: [exports.procesos.id],
    }),
}));
exports.procesosColdRelations = (0, drizzle_orm_1.relations)(exports.procesosCold, ({ one }) => ({
    circuito: one(exports.circuitos, {
        fields: [exports.procesosCold.circuitoId],
        references: [exports.circuitos.id],
    }),
    zone: one(exports.zones, {
        fields: [exports.procesosCold.zoneId],
        references: [exports.zones.id],
    }),
    box: one(exports.boxes, {
        fields: [exports.procesosCold.boxId],
        references: [exports.boxes.id],
    }),
    encargado: one(exports.usuariosTaller, {
        fields: [exports.procesosCold.encargadoId],
        references: [exports.usuariosTaller.id],
    }),
}));
