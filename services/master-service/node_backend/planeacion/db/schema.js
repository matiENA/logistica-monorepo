"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.procesosColdRelations = exports.procesosNotasRelations = exports.procesosRelations = exports.unidadesRelations = exports.usuariosTallerRelations = exports.boxesRelations = exports.zonesRelations = exports.procesosCold = exports.procesosNotas = exports.procesos = exports.unidades = exports.semis = exports.tractores = exports.userCoordinacion = exports.usuariosTaller = exports.boxes = exports.zones = exports.baseSchema = void 0;
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
// Tabla Única Operativa V2 (base.procesos):
// Unifica PREASIGNADO (pendiente_at), ESPERANDO A SER INGRESADO A BOX (llegada_zona_at),
// TRABAJANDO (ingreso_box_at), FINALIZÓ (salida_at) y retención semanal post Egreso Planta (circuito_cerrado_at).
exports.procesos = exports.baseSchema.table('procesos', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    circuitoId: (0, pg_core_1.uuid)('circuito_id').notNull().defaultRandom(),
    tractorId: (0, pg_core_1.uuid)('tractor_id').references(() => exports.tractores.id, { onDelete: 'set null' }),
    semiId: (0, pg_core_1.uuid)('semi_id').references(() => exports.semis.id, { onDelete: 'set null' }),
    tractorN: (0, pg_core_1.text)('tractor_n'),
    semiN: (0, pg_core_1.text)('semi_n'),
    zoneId: (0, pg_core_1.uuid)('zone_id')
        .notNull()
        .references(() => exports.zones.id, { onDelete: 'restrict' }),
    pendienteAt: (0, pg_core_1.timestamp)('pendiente_at', { withTimezone: true }).notNull().defaultNow(),
    llegadaZonaAt: (0, pg_core_1.timestamp)('llegada_zona_at', { withTimezone: true }),
    boxId: (0, pg_core_1.uuid)('box_id').references(() => exports.boxes.id, { onDelete: 'restrict' }),
    ingresoBoxAt: (0, pg_core_1.timestamp)('ingreso_box_at', { withTimezone: true }),
    usuariosIds: (0, pg_core_1.uuid)('usuarios_ids').array().notNull().default([]),
    salidaAt: (0, pg_core_1.timestamp)('salida_at', { withTimezone: true }),
    circuitoCerradoAt: (0, pg_core_1.timestamp)('circuito_cerrado_at', { withTimezone: true }),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
// Notas Normalizadas por Circuito (base.procesos_notas - Opción C):
// Compartidas automáticamente en Doble Carta y cambios de zona sin duplicación JSONB.
exports.procesosNotas = exports.baseSchema.table('procesos_notas', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    circuitoId: (0, pg_core_1.uuid)('circuito_id').notNull(),
    procesoId: (0, pg_core_1.uuid)('proceso_id').references(() => exports.procesos.id, { onDelete: 'set null' }),
    usuarioId: (0, pg_core_1.uuid)('usuario_id'),
    location: (0, pg_core_1.text)('location').notNull().default('Coordinación'),
    texto: (0, pg_core_1.text)('texto').notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: (0, pg_core_1.timestamp)('edited_at', { withTimezone: true }),
});
// Store Histórico Semanal (base.procesos_cold):
// Recibe en batch semanal los circuitos con circuito_cerrado_at <= now() - interval '7 days'.
exports.procesosCold = exports.baseSchema.table('procesos_cold', {
    id: (0, pg_core_1.uuid)('id').primaryKey(),
    circuitoId: (0, pg_core_1.uuid)('circuito_id').notNull(),
    tractorId: (0, pg_core_1.uuid)('tractor_id').references(() => exports.tractores.id, { onDelete: 'set null' }),
    semiId: (0, pg_core_1.uuid)('semi_id').references(() => exports.semis.id, { onDelete: 'set null' }),
    tractorN: (0, pg_core_1.text)('tractor_n'),
    semiN: (0, pg_core_1.text)('semi_n'),
    zoneId: (0, pg_core_1.uuid)('zone_id').references(() => exports.zones.id, { onDelete: 'set null' }),
    pendienteAt: (0, pg_core_1.timestamp)('pendiente_at', { withTimezone: true }).notNull(),
    llegadaZonaAt: (0, pg_core_1.timestamp)('llegada_zona_at', { withTimezone: true }),
    boxId: (0, pg_core_1.uuid)('box_id').references(() => exports.boxes.id, { onDelete: 'set null' }),
    ingresoBoxAt: (0, pg_core_1.timestamp)('ingreso_box_at', { withTimezone: true }),
    usuariosIds: (0, pg_core_1.uuid)('usuarios_ids').array().notNull().default([]),
    salidaAt: (0, pg_core_1.timestamp)('salida_at', { withTimezone: true }),
    circuitoCerradoAt: (0, pg_core_1.timestamp)('circuito_cerrado_at', { withTimezone: true }).notNull(),
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
exports.procesosRelations = (0, drizzle_orm_1.relations)(exports.procesos, ({ one, many }) => ({
    tractor: one(exports.tractores, {
        fields: [exports.procesos.tractorId],
        references: [exports.tractores.id],
    }),
    semi: one(exports.semis, {
        fields: [exports.procesos.semiId],
        references: [exports.semis.id],
    }),
    zone: one(exports.zones, {
        fields: [exports.procesos.zoneId],
        references: [exports.zones.id],
    }),
    box: one(exports.boxes, {
        fields: [exports.procesos.boxId],
        references: [exports.boxes.id],
    }),
    notas: many(exports.procesosNotas),
}));
exports.procesosNotasRelations = (0, drizzle_orm_1.relations)(exports.procesosNotas, ({ one }) => ({
    proceso: one(exports.procesos, {
        fields: [exports.procesosNotas.procesoId],
        references: [exports.procesos.id],
    }),
}));
exports.procesosColdRelations = (0, drizzle_orm_1.relations)(exports.procesosCold, ({ one }) => ({
    tractor: one(exports.tractores, {
        fields: [exports.procesosCold.tractorId],
        references: [exports.tractores.id],
    }),
    semi: one(exports.semis, {
        fields: [exports.procesosCold.semiId],
        references: [exports.semis.id],
    }),
    zone: one(exports.zones, {
        fields: [exports.procesosCold.zoneId],
        references: [exports.zones.id],
    }),
    box: one(exports.boxes, {
        fields: [exports.procesosCold.boxId],
        references: [exports.boxes.id],
    }),
}));
