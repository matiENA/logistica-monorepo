# Auditoría Global de Rendimiento, Cuotas y Escalabilidad DB — 2026-11-03T18:42:28.186Z

## 1. Estimación de Cuotas y Proyección de Escalabilidad (Supabase & Render)

> Proyección calculada sobre día 27 de 30 del ciclo.

| metrica | actual | limite_free | pct_actual | proy_fin_mes | escala_5x | escala_20x | estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Egress (Uncached) | 0.17 GB | 5 GB | 3.4% | 0.19 GB (3.8%) | 0.94 GB  | 3.78 GB  | 🟢 Holgado |
| Database Size | 30.12 MB | 500 MB | 6.0% | 33.47 MB (6.7%) | 50.20 MB  | 100.40 MB  | 🟢 Holgado |
| Log Ingestion | 0.14 GB | 1 GB | 14.0% | 0.16 GB (15.6%) | 0.78 GB  | 3.11 GB 🚨 BLOQUEO | 🟡 Monitorear |
| Log Query | 2.10 GB | 100 GB | 2.1% | 2.33 GB (2.3%) | 4.67 GB  | 11.67 GB  | 🟢 Holgado |
| Realtime Messages | 0.05 M msgs | 2 M msgs | 2.5% | 0.06 M msgs (2.8%) | 0.28 M msgs  | 1.11 M msgs  | 🟢 Holgado |

## 2. Diagnóstico Relacional de Base de Datos (PostgreSQL / Supabase)

> ❌ No se encontró DATABASE_URL ni SUPABASE_DB_URL (especificá --url o --env)

## 3. Diagnóstico Estático de Código Multi-Proyecto

> Proyectos analizados: dash-frontend, eor-frontend, panol, node_backend

### Tablas referenciadas en código

| tabla | menciones |
| --- | --- |
| choferes | 14 |
| chofer_documentacion | 11 |
| unidades | 8 |
| movimientos | 7 |
| chofer_observaciones | 4 |
| usuarios_auth | 4 |
| novedades | 3 |
| tractores | 3 |
| semis | 3 |
| view_individual_chofer | 2 |
| view_diagrama_mensual | 2 |
| diagramas | 2 |
| servicios_unidades | 2 |
| servicios_choferes | 2 |
| view_diaria_operativa | 1 |
| view_flota_operativa | 1 |
| view_calendario_diagrama_km | 1 |
| view_cards_diarias | 1 |
| view_movimientos | 1 |
| view_inducciones_recientes | 1 |
| view_dashboard_kpis | 1 |
| view_calendario_km | 1 |

### SELECT * / .select("*") — 74 ocurrencias

```text
[eor-frontend] src/api/apiClient.js:187  let query = supabase.from('view_flota_operativa').select('*');
[eor-frontend] src/api/apiClient.js:240  .select('*')
[eor-frontend] src/api/apiClient.js:385  let query = supabase.from('view_diagrama_mensual').select('*').eq('mes_tab', mesTab);
[eor-frontend] src/api/apiClient.js:487  .select('*')
[eor-frontend] src/api/apiClient.js:522  .select('*')
[eor-frontend] src/legacy/diagramas/DiagramaModule.jsx:19  .select('*')
[eor-frontend] src/legacy/inducciones/InduccionesModule.jsx:12  .select('*');
[eor-frontend] src/legacy/metricas/MetricasModule.jsx:20  .select('*')
[panol] backend/index.js:2018  'SELECT * FROM panol.v_staff_holds WHERE op_code = ANY($1::text[]) OR staff_id::text = ANY($1::text[]) ORDER B
[panol] backend/index.js:2064  'SELECT * FROM panol.v_staff_holds WHERE op_code = ANY($1::text[]) OR staff_id::text = ANY($1::text[]) ORDER B
[panol] backend/index.js:2433  const qRes = await db.query('SELECT * FROM panol.v_monitor_pedidos ORDER BY created_at DESC LIMIT 50;');
[panol] backend/index.js:2492  const qRes = await db.query('SELECT * FROM panol.v_devoluciones_pendientes ORDER BY order_created_at DESC;');
[panol] backend/index.js:2515  'SELECT * FROM panol.v_staff_holds WHERE op_code = ANY($1::text[]) OR staff_id::text = ANY($1::text[]) ORDER B
[panol] backend/index.js:2561  'SELECT * FROM panol.v_staff_holds WHERE op_code = ANY($1::text[]) OR staff_id::text = ANY($1::text[]) ORDER B
[panol] backend/index.js:2657  'SELECT * FROM panol.v_staff_holds WHERE staff_id = $1 ORDER BY created_at DESC;',
[panol] backend/index.js:2739  'SELECT * FROM panol.v_staff_holds WHERE staff_id = $1 ORDER BY created_at DESC;',
[panol] backend/scripts/create-devoluciones-view.js:71  SELECT * FROM panol.v_devoluciones_pendientes;
[panol] backend/scripts/expose-public-views.js:12  SELECT * FROM panol.v_monitor_pedidos;
[panol] backend/scripts/expose-public-views.js:15  SELECT * FROM panol.v_taller_tareas_activas;
[panol] backend/scripts/expose-public-views.js:18  SELECT * FROM panol.v_flota_busqueda;
[panol] backend/scripts/expose-public-views.js:21  SELECT * FROM panol.v_tablero_coordinacion;
[panol] backend/scripts/expose-public-views.js:27  SELECT * FROM panol.orders;
[panol] backend/scripts/expose-public-views.js:30  SELECT * FROM panol.order_items;
[panol] backend/scripts/expose-public-views.js:33  SELECT * FROM panol.items;
[panol] backend/scripts/expose-public-views.js:36  SELECT * FROM panol.work_orders;
[panol] backend/scripts/expose-public-views.js:39  SELECT * FROM panol.work_order_tasks;
[panol] backend/scripts/expose-public-views.js:42  SELECT * FROM panol.staff;
[panol] backend/scripts/expose-public-views.js:45  SELECT * FROM panol.stock_movements;
[panol] backend/scripts/migrate-schema-improvements.js:117  CREATE OR REPLACE VIEW public.v_monitor_pedidos AS SELECT * FROM panol.v_monitor_pedidos;
[panol] backend/scripts/migrate-schema-improvements.js:174  CREATE OR REPLACE VIEW public.v_devoluciones_pendientes AS SELECT * FROM panol.v_devoluciones_pendientes;
[panol] backend/scripts/migrate-staff-holds.js:45  SELECT * FROM panol.v_staff_holds;
[panol] backend/scripts/migrate-staff-holds.js:51  const test = await db.query('SELECT * FROM panol.v_staff_holds LIMIT 5;');
[panol] backend/scripts/migrate-vehicle-ids-and-ordernumber.js:161  CREATE OR REPLACE VIEW public.v_monitor_pedidos AS SELECT * FROM panol.v_monitor_pedidos;
[panol] backend/scripts/migrate-vehicle-ids-and-ordernumber.js:162  CREATE OR REPLACE VIEW public.v_taller_tareas_activas AS SELECT * FROM panol.v_taller_tareas_activas;
[panol] backend/scripts/migrate-vehicle-ids-and-ordernumber.js:163  CREATE OR REPLACE VIEW public.panol_orders AS SELECT * FROM panol.orders;
[panol] backend/scripts/migrate-vehicle-ids-and-ordernumber.js:164  CREATE OR REPLACE VIEW public.panol_work_orders AS SELECT * FROM panol.work_orders;
[panol] backend/scripts/test-integration.js:42  const boardRes = await db.query('SELECT * FROM panol.v_tablero_coordinacion LIMIT 3;');
[panol] backend/scripts/test-integration.js:53  const monitorRes = await db.query('SELECT * FROM panol.v_monitor_pedidos LIMIT 3;');
[panol] backend/scripts/update-v-flota.js:42  SELECT * FROM panol.v_flota_busqueda;
[panol] backend/scripts/verify-views.js:8  const resMonitor = await db.query('SELECT * FROM panol.v_monitor_pedidos LIMIT 5');
```

### Polling (refetchInterval / setInterval) — 17 ocurrencias

```text
[dash-frontend] src/components/layout/Header.tsx:41  const interval = setInterval(actualizarReloj, 1000);
[dash-frontend] src/hooks/useAutoScroll.ts:46  const interval = setInterval(() => {
[eor-frontend] src/features/diaria/hooks/useDailyDrivers.js:230  refetchInterval: isEnabled ? 60000 : false, // Sondeo de respaldo cada 60s solo en pestaña activa
[eor-frontend] src/features/navigation/HeaderNav.jsx:23  const interval = setInterval(updateClock, 10000);
[panol] backend/index.js:754  setInterval(checkAutoDeliveredOrders, 10000);
[panol] backend/index.js:2972  setInterval(async () => {
[panol] backend/index.js:3019  setInterval(() => {
[panol] backend/taskSyncService.js:401  autoSyncIntervalTimer = setInterval(async () => {
[panol] frontend/src/pages/AppMobile.tsx:93  interval = setInterval(() => {
[panol] frontend/src/pages/MonitorPanol.tsx:258  const interval = setInterval(updateClock, 1000);
[node_backend] bot/public/js/botApp.js:93  setInterval(cargarMetricas, 30000); // Refresco periódico cada 30s
[node_backend] cache/builder.js:1783  setInterval(() => {
[node_backend] cache/builder.js:1800  setInterval(async () => {
[node_backend] cache/builder.js:1823  setInterval(async () => {
[node_backend] cache/builder.js:1846  setInterval(async () => {
[node_backend] novedades.js:300  return setInterval(async () => {
[node_backend] routes/syncQueue.js:136  setInterval(async () => {
```

### Polling sin pausa en background (falta refetchIntervalInBackground: false) — 1 ocurrencias

```text
[eor-frontend] src/features/diaria/hooks/useDailyDrivers.js:230  refetchInterval: isEnabled ? 60000 : false, // Sondeo de respaldo cada 60s solo en pestaña activa
```

### Llamada directa cliente frontend a Supabase PostgREST — 40 ocurrencias

```text
[eor-frontend] src/api/apiClient.js:104  let query = supabase.from('view_diaria_operativa').select('*', { count: 'exact' });
[eor-frontend] src/api/apiClient.js:187  let query = supabase.from('view_flota_operativa').select('*');
[eor-frontend] src/api/apiClient.js:209  .from('view_individual_chofer')
[eor-frontend] src/api/apiClient.js:239  .from('view_individual_chofer')
[eor-frontend] src/api/apiClient.js:268  .from('view_calendario_diagrama_km')
[eor-frontend] src/api/apiClient.js:340  let query = supabase.from('view_cards_diarias').select('*', { count: 'exact' });
[eor-frontend] src/api/apiClient.js:385  let query = supabase.from('view_diagrama_mensual').select('*').eq('mes_tab', mesTab);
[eor-frontend] src/api/apiClient.js:418  let query = supabase.from('view_movimientos').select('*', { count: 'exact' });
[eor-frontend] src/features/individual/components/DriverProfileCard.jsx:64  .from('choferes-fotos')
[eor-frontend] src/features/individual/components/DriverProfileCard.jsx:77  .from('choferes-fotos')
[eor-frontend] src/features/individual/components/DriverProfileCard.jsx:88  .from('choferes')
[eor-frontend] src/features/individual/hooks/useCalendarDiagramaKm.js:213  .from('diagramas')
[eor-frontend] src/legacy/diagramas/DiagramaModule.jsx:18  .from('view_diagrama_mensual')
[eor-frontend] src/legacy/inducciones/InduccionesModule.jsx:11  .from('view_inducciones_recientes')
[eor-frontend] src/legacy/metricas/MetricasModule.jsx:19  .from('view_dashboard_kpis')
[node_backend] cache/builder.js:189  supabase.from('choferes').select('id, nombre, legajo, servicio_id, estado, unidad_id, foto').order('nombre', {
[node_backend] cache/builder.js:190  supabase.from('movimientos').select('*'),
[node_backend] cache/builder.js:200  supabase.from('view_calendario_km').select('fecha, dominio, chofer_nombre, km, hoja_ruta, id_chofer, id_unidad
[node_backend] cache/builder.js:1099  const { data: dbChoferes } = await supabase.from('choferes').select('dni, foto').not('foto', 'is', null);
[node_backend] routes/dash.js:179  let query = supabase.from('choferes').select('id, nombre, dni, legajo');
[node_backend] routes/dash.js:525  const { data: chDb } = await supabase.from('choferes').select('id, nombre').ilike('nombre', `%${body.nombre ||
[node_backend] routes/dash.js:618  await supabase.from('movimientos').delete().eq('id_chofer', targetChoferId);
[node_backend] routes/dash.js:619  await supabase.from('choferes').update({ unidad_id: null, estado: 'inactivo', actualizado_el: new Date().toISO
[node_backend] routes/dash.js:621  await supabase.from('movimientos').delete().or(`id_chofer.eq.${targetChoferId},id_unidad.eq.${targetUnidadId}`
[node_backend] routes/dash.js:622  await supabase.from('movimientos').insert([{ id_unidad: targetUnidadId, id_chofer: targetChoferId }]);
[node_backend] routes/dash.js:623  await supabase.from('choferes').update({ unidad_id: targetUnidadId, estado: 'circulando', actualizado_el: new 
[node_backend] routes/diagramas.js:164  const { data, error } = await supabase.from('choferes').select('id, nombre, legajo, c_servicio, diagrama_tipo,
[node_backend] routes/diagramas.js:283  let query = supabase.from('diagramas').select('*').eq('mes_tab', mesTab);
[node_backend] routes/diagramas.js:321  const { data, error } = await supabase.from('choferes').select('*').or(`id.eq.${idOrNombre},legajo.eq.${idOrNo
[node_backend] routes/fotos.js:32  .from('choferes-fotos')
[node_backend] routes/movimientos.js:253  supabase.from('choferes').select('id, nombre'),
[node_backend] routes/movimientos.js:269  await supabase.from('movimientos').delete().in('id_unidad', desunirUteIds);
[node_backend] routes/movimientos.js:270  await supabase.from('choferes').update({ unidad_id: null, estado: 'inactivo' }).in('unidad_id', desunirUteIds)
[node_backend] routes/movimientos.js:287  await supabase.from('movimientos').delete().or(`id_unidad.in.(${uIds.join(',')}),id_chofer.in.(${cIds.join(','
[node_backend] routes/movimientos.js:288  const { data: insData } = await supabase.from('movimientos').upsert(pareosInsert, { onConflict: 'id_unidad' })
[node_backend] routes/movimientos.js:292  await supabase.from('choferes').update({ unidad_id: item.id_unidad, estado: 'circulando' }).eq('id', item.id_c
[node_backend] routes/proxy.js:146  const { data: cDb } = await supabase.from('choferes').select('id').ilike('nombre', `%${body.chofer}%`).limit(1
[node_backend] routes/proxy.js:244  const { data: cDb } = await supabase.from('choferes').select('id').ilike('nombre', `%${body.nombre}%`).limit(1
[node_backend] sync/syncChoferesFotos.js:125  .from('choferes-fotos')
[node_backend] sync/syncChoferesFotos.js:137  .from('choferes-fotos')
```

### Suscripciones Realtime (postgres_changes / .channel) — 7 ocurrencias

```text
[eor-frontend] src/hooks/useRealtimeSync.js:45  .channel('schema-db-changes')
[eor-frontend] src/hooks/useRealtimeSync.js:47  'postgres_changes',
[eor-frontend] src/hooks/useRealtimeSync.js:55  'postgres_changes',
[eor-frontend] src/hooks/useRealtimeSync.js:69  'postgres_changes',
[eor-frontend] src/hooks/useRealtimeSync.js:82  'postgres_changes',
[eor-frontend] src/hooks/useRealtimeSync.js:90  'postgres_changes',
[eor-frontend] src/hooks/useRealtimeSync.js:104  'postgres_changes',
```

### Cache TTL (staleTime / gcTime / cacheTime / TTL) — 28 ocurrencias

```text
[eor-frontend] src/App.jsx:19  staleTime: 1000 * 60 * 2, // 2 min en RAM por defecto
[eor-frontend] src/App.jsx:20  gcTime: 1000 * 60 * 30,    // 30 min persistido en RAM
[eor-frontend] src/App.jsx:46  // Consulta ligera de badge para el encabezado (Hot RAM TTL 30s con fallback Supabase)
[eor-frontend] src/App.jsx:51  staleTime: 1000 * 60 * 3,
[eor-frontend] src/features/diaria/hooks/useDailyDrivers.js:228  staleTime: 1000 * 30,       // 30 seg en RAM (Realtime WebSockets sincroniza cambios inmediatos)
[eor-frontend] src/features/diaria/hooks/useDailyDrivers.js:229  gcTime: 1000 * 60 * 30,     // 30 min persistido en memoria
[eor-frontend] src/features/diaria/hooks/useDailyKm.js:43  staleTime: 1000 * 60 * 5, // 5 min en RAM
[eor-frontend] src/features/diaria/hooks/useDailyKm.js:44  gcTime: 1000 * 60 * 20,
[eor-frontend] src/features/diaria/useDailyCards.js:30  staleTime: 1000 * 60 * 3, // 3 minutos en memoria RAM
[eor-frontend] src/features/diaria/useDailyCards.js:31  gcTime: 1000 * 60 * 15,
[eor-frontend] src/features/flota/FlotaModule.jsx:87  staleTime: 1000 * 60 * 5, // 5 min en RAM
[eor-frontend] src/features/flota/FlotaModule.jsx:88  gcTime: 1000 * 60 * 30,
[eor-frontend] src/features/flota/hooks/useAssignUnit.js:21  staleTime: 1000 * 60 * 3, // 3 min en RAM
[eor-frontend] src/features/individual/hooks/useCalendarDiagramaKm.js:180  staleTime: 1000 * 30, // 30 segundos de frescura en RAM
[eor-frontend] src/features/individual/hooks/useCalendarDiagramaKm.js:182  gcTime: 1000 * 60 * 30,
[eor-frontend] src/features/individual/hooks/useDriverDocs.js:14  staleTime: 1000 * 60 * 10, // 10 min en RAM
[eor-frontend] src/features/individual/hooks/useDriverDocs.js:26  staleTime: 1000 * 60 * 10,
[eor-frontend] src/features/individual/hooks/useIndividualChofer.js:17  staleTime: 1000 * 30, // 30 seg de frescura
[eor-frontend] src/features/individual/hooks/useIndividualChofer.js:19  gcTime: 1000 * 60 * 30,
[eor-frontend] src/features/individual/IndividualModule.jsx:38  staleTime: 1000 * 60 * 30, // 30 min en RAM
[eor-frontend] src/legacy/diagramas/DiagramaModule.jsx:30  staleTime: 1000 * 60 * 10, // 10 min en RAM
[eor-frontend] src/legacy/diagramas/DiagramaModule.jsx:31  gcTime: 1000 * 60 * 60,
[eor-frontend] src/legacy/inducciones/InduccionesModule.jsx:16  staleTime: 1000 * 60 * 5,
[eor-frontend] src/legacy/inducciones/InduccionesModule.jsx:17  gcTime: 1000 * 60 * 30,
[eor-frontend] src/legacy/metricas/MetricasModule.jsx:25  staleTime: 1000 * 60 * 3, // 3 min en RAM
[eor-frontend] src/legacy/metricas/MetricasModule.jsx:26  gcTime: 1000 * 60 * 20,
[panol] frontend/src/main.tsx:12  staleTime: 1000 * 30, // 30 segundos
[node_backend] routes/views.js:825  // 13. GET /api/views/chofer-observaciones/:choferId — Observaciones de chofer con caché LRU C2 (TTL 5 min)
```

### Transacciones explícitas (BEGIN/COMMIT, getClient, db.transaction) — 18 ocurrencias

```text
[panol] backend/scripts/create-devoluciones-view.js:4  const client = await db.getClient();
[panol] backend/scripts/create-devoluciones-view.js:7  await client.query('BEGIN');
[panol] backend/scripts/create-devoluciones-view.js:80  await client.query('COMMIT');
[panol] backend/scripts/create-devoluciones-view.js:83  await client.query('ROLLBACK');
[panol] backend/scripts/expose-public-views.js:4  const client = await db.getClient();
[panol] backend/scripts/expose-public-views.js:7  await client.query('BEGIN');
[panol] backend/scripts/expose-public-views.js:58  await client.query('COMMIT');
[panol] backend/scripts/expose-public-views.js:61  await client.query('ROLLBACK');
[panol] backend/scripts/migrate-vehicle-ids-and-ordernumber.js:4  const client = await db.getClient();
[panol] backend/scripts/migrate-vehicle-ids-and-ordernumber.js:7  await client.query('BEGIN');
[panol] backend/scripts/migrate-vehicle-ids-and-ordernumber.js:167  await client.query('COMMIT');
[panol] backend/scripts/migrate-vehicle-ids-and-ordernumber.js:170  await client.query('ROLLBACK');
[panol] backend/scripts/run-migration-001.js:4  const client = await db.getClient();
[panol] backend/scripts/run-migration-001.js:7  await client.query('BEGIN');
[panol] backend/scripts/run-migration-001.js:191  await client.query('COMMIT');
[panol] backend/scripts/run-migration-001.js:194  await client.query('ROLLBACK');
[panol] backend/utils/db.js:98  async function getClient() {
[node_backend] utils/db.js:78  async function getClient() {
```

### Locks de fila (SELECT ... FOR UPDATE / SKIP LOCKED) — 0 ocurrencias

### Ráfagas async (Promise.all con map/forEach async) — 0 ocurrencias

### RPC / upsert compuestas — 5 ocurrencias

```text
[eor-frontend] src/api/apiClient.js:146  const { data, error } = await supabase.rpc('fn_km_por_fecha', { p_fecha: fIso });
[eor-frontend] src/api/apiClient.js:166  const { data, error } = await supabase.rpc('fn_personal_retorno', { p_fecha: fechaTarget });
[eor-frontend] src/api/apiClient.js:565  const { data, error } = await supabase.rpc('fn_asignar_unidad_chofer', {
[eor-frontend] src/api/apiClient.js:596  const { data, error } = await supabase.rpc('fn_desunir_unidad_chofer', {
[node_backend] routes/movimientos.js:288  const { data: insData } = await supabase.from('movimientos').upsert(pareosInsert, { onConflict: 'id_unidad' })
```

### Caché en Hot RAM (backend in-memory datasets) — 306 ocurrencias

```text
[node_backend] bot/engine.js:25  constructor(cacheDatosGlobales) {
[node_backend] bot/engine.js:26  this.cacheDatosGlobales = cacheDatosGlobales;
[node_backend] bot/engine.js:94  resultado = await toolsMap[fnName](fnArgs, this.cacheDatosGlobales);
[node_backend] bot/engine.js:147  const res = await toolsMap.resumen_flota({}, this.cacheDatosGlobales);
[node_backend] bot/engine.js:160  const res = await toolsMap.consultar_novedades({ solo_pendientes: true }, this.cacheDatosGlobales);
[node_backend] bot/engine.js:173  const res = await toolsMap.consultar_ut({ query: utNum }, this.cacheDatosGlobales);
[node_backend] bot/engine.js:192  const res = await toolsMap.consultar_chofer({ query: chName }, this.cacheDatosGlobales);
[node_backend] bot/routes.js:4  function createBotRouter(cacheDatosGlobales) {
[node_backend] bot/routes.js:6  const engine = new BotEngine(cacheDatosGlobales);
[node_backend] bot/routes.js:32  const diag = cacheDatosGlobales?.diagramas;
[node_backend] bot/routes.js:35  const novedades = cacheDatosGlobales?.novedades || [];
[node_backend] bot/routes.js:48  ultima_actualizacion: cacheDatosGlobales.ultimaActualizacion,
[node_backend] bot/tools.js:18  async function consultarChofer(args, cacheDatosGlobales) {
[node_backend] bot/tools.js:20  if (!query || !cacheDatosGlobales?.diagramas?.diagramas) {
[node_backend] bot/tools.js:26  const choferes = cacheDatosGlobales.diagramas.diagramas;
[node_backend] bot/tools.js:101  async function consultarUt(args, cacheDatosGlobales) {
[node_backend] bot/tools.js:103  if (!query || !cacheDatosGlobales?.diagramas) {
[node_backend] bot/tools.js:111  const utMap = cacheDatosGlobales.diagramas.utMap || {};
[node_backend] bot/tools.js:112  const utList = cacheDatosGlobales.diagramas.ut || [];
[node_backend] bot/tools.js:132  const novedadesUt = (cacheDatosGlobales.novedades || []).filter(n => {
[node_backend] bot/tools.js:167  async function resumenFlota(args, cacheDatosGlobales) {
[node_backend] bot/tools.js:169  const utList = cacheDatosGlobales?.diagramas?.ut || [];
[node_backend] bot/tools.js:197  const novedadesPendientes = (cacheDatosGlobales.novedades || []).filter(n => !n.resuelto).length;
[node_backend] bot/tools.js:212  async function consultarNovedades(args, cacheDatosGlobales) {
[node_backend] bot/tools.js:214  let novedades = cacheDatosGlobales?.novedades || [];
[node_backend] bot/tools.js:247  async function consultarAsistencia(args, cacheDatosGlobales) {
[node_backend] bot/tools.js:249  if (!chofer || !cacheDatosGlobales?.diagramas?.diagramas) {
[node_backend] bot/tools.js:254  const cObj = cacheDatosGlobales.diagramas.diagramas.find(c => limpiarTexto(c.nom).includes(q));
[node_backend] bot/tools.js:319  async function consultarViajes(args, cacheDatosGlobales) {
[node_backend] bot/tools.js:324  const nuevaSeccionViajes = cacheDatosGlobales?.diagramas?.nuevaSeccionViajes || {};
[node_backend] cache/builder.js:60  function emitirDatosSiCambiaron(io, cacheDatosGlobales, ioDash = null) {
[node_backend] cache/builder.js:62  const payload = buildSocketPayload(cacheDatosGlobales);
[node_backend] cache/builder.js:109  async function actualizarCacheDesdeSupabase(cacheDatosGlobales, io, ioDash, opciones = {}) {
[node_backend] cache/builder.js:114  if (!forceFull && cacheDatosGlobales.diagramas && cacheDatosGlobales.diagramas.diagramas?.length > 0) {
[node_backend] cache/builder.js:560  // 4. Asignación atómica a cacheDatosGlobales
[node_backend] cache/builder.js:561  const previoViajes = (cacheDatosGlobales.diagramas && cacheDatosGlobales.diagramas.nuevaSeccionViajes) || {};
[node_backend] cache/builder.js:563  cacheDatosGlobales.diagramas = {
[node_backend] cache/builder.js:585  cacheDatosGlobales.ut = catalogoUnidades;
[node_backend] cache/builder.js:586  cacheDatosGlobales.vencimientosObj = vencimientosObj;
[node_backend] cache/builder.js:587  cacheDatosGlobales.marcasTractores = marcasTractores;
```

### Wipe de tabla en ETL (DELETE FROM sin WHERE o TRUNCATE) — 12 ocurrencias

```text
[dash-frontend] src/components/kanban/NoveltyCard.tsx:255  <h3 className="font-extrabold text-black text-[14px] leading-tight uppercase truncate tracking-tight flex-1 pr
[dash-frontend] src/components/kanban/NoveltyCard.tsx:416  <span className="truncate max-w-[80px] font-black">{novedad.creador || novedad.usuario || 'OPERADOR'}</span>
[dash-frontend] src/components/kanban/NoveltyCard.tsx:525  } text-sm sm:text-base leading-tight uppercase truncate flex-1 pr-2 tracking-tight`}
[dash-frontend] src/components/kanban/QuickAddLibre.tsx:128  <div className="flex flex-col truncate pr-2">
[dash-frontend] src/components/kanban/QuickAddLibre.tsx:129  <span className="font-extrabold text-xs text-slate-800 dark:text-slate-200 truncate uppercase">
[dash-frontend] src/components/kanban/ReturnColumn.tsx:149  <span className="flex-1 truncate pr-1">Conductor</span>
[dash-frontend] src/components/kanban/ReturnColumn.tsx:179  <div className="flex flex-col truncate flex-1 min-w-0 pr-1">
[dash-frontend] src/components/kanban/ReturnColumn.tsx:180  <span className="font-black text-xs text-slate-900 dark:text-slate-100 truncate uppercase">
[dash-frontend] src/components/kanban/ReturnColumn.tsx:214  <div className="flex flex-col truncate flex-1 min-w-0 pr-1">
[dash-frontend] src/components/kanban/ReturnColumn.tsx:215  <span className="font-black text-xs text-slate-900 dark:text-slate-100 truncate uppercase">
[dash-frontend] src/components/modals/NoveltyModal.tsx:319  <h2 className="text-sm font-black uppercase tracking-wide text-center truncate mx-2 flex-1">
[panol] frontend/src/pages/MonitorPanol.tsx:804  <span className="px-2 py-0.5 rounded bg-[#0D2447] text-[#60A5FA] text-[9px] font-bold tracking-tight truncate 
```
