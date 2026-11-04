# Auditoría Global de Rendimiento, Cuotas y Escalabilidad DB — 2026-11-04T09:38:09.294Z

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

### Tamaño de la base y versión

| db | size | version |
| --- | --- | --- |
| postgres | 45 MB | PostgreSQL 17.6 on aarch64-unknown-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit |

### Parámetros relevantes de rendimiento, timeouts y logs

| name | setting | unit |
| --- | --- | --- |
| default_transaction_isolation | read committed |  |
| idle_in_transaction_session_timeout | 15000 | ms |
| log_connections | off |  |
| log_disconnections | off |  |
| log_min_duration_statement | -1 | ms |
| log_statement | ddl |  |
| max_connections | 60 |  |
| shared_buffers | 28672 | 8kB |
| statement_timeout | 15000 | ms |
| synchronous_commit | on |  |
| track_io_timing | off |  |
| work_mem | 2184 | kB |

### Top relaciones por tamaño (incluye todos los esquemas de usuario)

| schema | tabla | filas_est | total | indices | seq_scan | idx_scan | ins | upd | del | dead | ult_autovacuum |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| public | choferes_km_mensual | 3780 | 8648 kB | 1120 kB | 7766 | 1216938 | 3876 | 54463 | 186 | 169 | 2026-11-02 |
| public | diagramas | 2518 | 6360 kB | 776 kB | 2238 | 39331808 | 2914 | 207069 | 584 | 285 | 2026-11-02 |
| panol | items | 7345 | 4056 kB | 1688 kB | 711 | 176593 | 7345 | 7409 | 0 | 12 | 2026-10-20 |
| public | choferes | 271 | 1776 kB | 144 kB | 240933 | 5739579 | 414 | 1338989 | 202 | 0 | 2026-11-03 |
| panol | work_order_tasks | 276 | 1384 kB | 648 kB | 306 | 58332 | 4201 | 5031 | 3925 | 93 | 2026-10-20 |
| public | seguridad_vial_incidentes_ijl | 2834 | 1136 kB | 744 kB | 22 | 3027 | 2834 | 0 | 88 | 44 | 2026-10-20 |
| public | seguridad_vial | 2430 | 1096 kB | 584 kB | 458 | 133629 | 2430 | 926 | 100 | 50 | 2026-10-30 |
| public | cisternas_km | 1568 | 1064 kB | 584 kB | 391 | 199093 | 1732 | 195881 | 1 | 0 | 2026-11-03 |
| panol | unit_work_orders | 292 | 632 kB | 424 kB | 784 | 387643 | 1816 | 1544 | 1523 | 42 | 2026-10-20 |
| panol | work_orders | 298 | 536 kB | 232 kB | 9169 | 340917 | 1364 | 4280 | 1065 | 51 | 2026-10-20 |
| storage | objects | 293 | 520 kB | 296 kB | 43 | 5072 | 593 | 21 | 0 | 9 | 2026-10-29 |
| public | unidades | 267 | 472 kB | 224 kB | 119107 | 5303817 | 738 | 1196907 | 491 | 0 | 2026-11-03 |
| public | chofer_documentacion | 261 | 328 kB | 120 kB | 98287 | 191613 | 309 | 16814 | 45 | 80 | 2026-10-19 |
| public | semis | 286 | 296 kB | 136 kB | 249397 | 893169 | 649 | 20057 | 783 | 33 | 2026-11-02 |
| public | tractores | 343 | 280 kB | 152 kB | 354233 | 916498 | 605 | 22182 | 603 | 80 | 2026-11-02 |
| public | chofer_observaciones | 0 | 256 kB | 232 kB | 738 | 17236 | 51601 | 762 | 51601 | 0 | 2026-11-02 |
| panol | stock_movements | 12 | 256 kB | 224 kB | 21599 | 22047 | 71 | 90 | 57 | 42 | 2026-10-20 |
| panol | work_orders_cold | 0 | 240 kB | 136 kB | 7261 | 1141 | 534 | 1 | 494 | 0 | 2026-10-20 |
| panol | orders | 5 | 232 kB | 200 kB | 13034 | 22567 | 36 | 64 | 29 | 21 | 2026-10-20 |
| public | movimientos | 179 | 216 kB | 160 kB | 72618 | 599639 | 327197 | 38 | 326958 | 0 | 2026-11-03 |
| auth | users | -1 | 208 kB | 192 kB | 1720 | 121 | 28 | 3 | 0 | 19 |  |
| panol | staff_holds | 15 | 200 kB | 152 kB | 3486 | 217 | 71 | 21 | 53 | 7 | 2026-10-22 |
| public | novedades | 33 | 184 kB | 128 kB | 82061 | 86494 | 118 | 181 | 75 | 14 | 2026-10-30 |
| panol | staff | 71 | 128 kB | 80 kB | 6218 | 50399 | 72 | 149 | 1 | 9 |  |
| public | eor_sync_queue | 2 | 112 kB | 64 kB | 6825 | 65 | 4645 | 132 | 3406 | 0 | 2026-10-30 |
| realtime | subscription | 0 | 104 kB | 48 kB | 1184818 | 131613 | 2842 | 36 | 2821 | 15 | 2026-11-02 |
| panol | order_items_legacy_backup | 0 | 96 kB | 80 kB | 2687 | 157 | 38 | 9 | 38 | 38 |  |
| auth | scim_users | -1 | 88 kB | 80 kB | 24 | 3 | 0 | 0 | 0 | 0 |  |
| auth | one_time_tokens | -1 | 88 kB | 80 kB | 14 | 2 | 0 | 0 | 0 | 0 |  |
| public | dash_menciones | -1 | 80 kB | 64 kB | 21 | 128030 | 2 | 0 | 2 | 2 |  |

### Ventana de pg_stat_statements

| desde | dealloc |
| --- | --- |
| 2026-09-22 06:32:32.328165-03 | 84 |

### Top sentencias por tiempo total acumulado

| calls | total_ms | mean_ms | rows | filas_x_call | rol | query |
| --- | --- | --- | --- | --- | --- | --- |
| 1584038 | 11867399.5 | 7.49 | 2710235 | 1.7 | supabase_admin | SELECT wal->>$5 as type, wal->>$6 as schema, wal->>$7 as table, COALESCE(wal->>$8, $9) as columns, COALESCE(wal->>$10, $11) as record, COALE |
| 33661 | 3562083.3 | 105.82 | 33661 | 1.0 | anon | WITH pgrst_source AS ( SELECT "public"."view_calendario_km"."id_chofer", "public"."view_calendario_km"."km_totales", "public"."view_calendar |
| 39487 | 1624145.3 | 41.13 | 39487 | 1.0 | anon | WITH pgrst_source AS (SELECT "pgrst_call".* FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "p_fecha" FROM json_to_record(pgrst |
| 1561 | 1003458.3 | 642.83 | 121758 | 78.0 | postgres | SELECT e.name, n.nspname AS schema, e.default_version, x.extversion AS installed_version, e.comment, ev.schema AS default_version_schema FRO |
| 2187 | 932131.6 | 426.21 | 582312 | 266.3 | postgres | SELECT * FROM public.view_individual_chofer ORDER BY nombre ASC |
| 7771 | 799112.5 | 102.83 | 7771 | 1.0 | anon | WITH pgrst_source AS ( SELECT "public"."view_calendario_km"."id_chofer", "public"."view_calendario_km"."km_totales", "public"."view_calendar |
| 14812 | 743668.5 | 50.21 | 14812 | 1.0 | anon | WITH pgrst_source AS ( SELECT "public"."view_flota_operativa".* FROM "public"."view_flota_operativa" LIMIT $1 OFFSET $2 ) SELECT $3::bigint  |
| 6906 | 454282.0 | 65.78 | 1823780 | 264.1 | postgres | SELECT * FROM public.view_flota_operativa ORDER BY tractor ASC NULLS LAST, semi ASC NULLS LAST |
| 7715 | 398681.9 | 51.68 | 7715 | 1.0 | anon | WITH pgrst_source AS ( SELECT "public"."view_dash_retorno".* FROM "public"."view_dash_retorno" LIMIT $1 OFFSET $2 ) SELECT $3::bigint AS tot |
| 8783 | 335342.4 | 38.18 | 8783 | 1.0 | anon | WITH pgrst_source AS ( SELECT "public"."view_diaria_operativa".* FROM "public"."view_diaria_operativa" ORDER BY "public"."view_diaria_operat |
| 512 | 311657.6 | 608.71 | 512 | 1.0 | postgres | SELECT (SELECT COALESCE(json_agg(json_build_object( $2, chofer_id, $3, mes_tab, $4, mes_numero, $5, anio, $6, tira_dias, $7, contabilizador  |
| 8428 | 297532.1 | 35.30 | 244030 | 29.0 | postgres | SELECT * FROM public.view_diaria_operativa ORDER BY nombre ASC LIMIT $1 OFFSET $2 |
| 2189 | 270027.5 | 123.36 | 162103 | 74.1 | postgres | SELECT * FROM public.view_personal_retorno ORDER BY fecha_retorno ASC, nombre ASC |
| 8074 | 253360.3 | 31.38 | 405470 | 50.2 | postgres | SELECT * FROM public.fn_personal_retorno($1::date) ORDER BY fecha_retorno ASC, nombre ASC |
| 465 | 223784.5 | 481.26 | 556140 | 1196.0 | authenticator | SELECT name FROM pg_timezone_names |
| 636 | 210692.6 | 331.28 | 636 | 1.0 | anon | WITH pgrst_source AS (SELECT "pgrst_call".* FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "p_fecha" FROM json_to_record(pgrst |
| 588 | 203659.0 | 346.36 | 1335348 | 2271.0 | postgres | SELECT * FROM public.view_diagrama_mensual ORDER BY chofer_nombre ASC |
| 80026 | 186166.9 | 2.33 | 80026 | 1.0 | pgbouncer | SELECT * FROM pgbouncer.get_auth($1) |
| 420 | 180779.9 | 430.43 | 953820 | 2271.0 | postgres | SELECT diagrama_id, chofer_id, mes_tab, anio, mes_numero, tira_dias, contabilizador, km_mes_total, cant_viajes_mes, dias_km FROM public.view |
| 2189 | 172393.9 | 78.75 | 582569 | 266.1 | postgres | SELECT * FROM public.view_diaria_operativa ORDER BY nombre ASC |
| 6329 | 142639.5 | 22.54 | 6308 | 1.0 | postgres | with base_table_info as ( select c.oid::int8 as id, nc.nspname as schema, c.relname as name, c.relkind, c.relrowsecurity as rls_enabled, c.r |
| 2038 | 141691.7 | 69.52 | 315130 | 154.6 | postgres | INSERT INTO public.movimientos (id_unidad, id_chofer, actualizado_el) SELECT id_unidad, id_chofer, NOW() FROM jsonb_to_recordset($1::jsonb)  |
| 157 | 129655.4 | 825.83 | 157 | 1.0 | postgres | SELECT (SELECT json_agg(json_build_object($1, id, $2, UPPER(TRIM(nombre)), $3, legajo)) FROM public.choferes WHERE nombre IS NOT NULL) AS ch |
| 29645 | 118356.8 | 3.99 | 29645 | 1.0 | anon | WITH pgrst_source AS ( SELECT "public"."view_diaria_operativa".* FROM "public"."view_diaria_operativa" ORDER BY "public"."view_diaria_operat |
| 167 | 118222.3 | 707.92 | 670505 | 4015.0 | postgres | SELECT diagrama_id, chofer_id, mes_tab, anio, mes_numero, tira_dias, contabilizador, km_mes_total, cant_viajes_mes, dias_km FROM public.view |

### Top sentencias por frecuencia (detecta polling / loops)

| calls | mean_ms | rows | filas_x_call | rol | query |
| --- | --- | --- | --- | --- | --- |
| 1584038 | 7.49 | 2710235 | 1.7 | supabase_admin | SELECT wal->>$5 as type, wal->>$6 as schema, wal->>$7 as table, COALESCE(wal->>$8, $9) as columns, COALESCE(wal->>$10, $11) as record, COALE |
| 178888 | 0.14 | 178888 | 1.0 | anon | select set_config('search_path', $1, true), set_config($2, $3, true), set_config($4, $5, true), set_config('role', $6, true), set_config('re |
| 102025 | 0.62 | 102025 | 1.0 | anon | select set_config('search_path', $1, true), set_config($2, $3, true), set_config('role', $4, true), set_config('request.jwt.claims', $5, tru |
| 80026 | 2.33 | 80026 | 1.0 | pgbouncer | SELECT * FROM pgbouncer.get_auth($1) |
| 63982 | 0.26 | 63982 | 1.0 | anon | WITH pgrst_source AS ( SELECT "public"."novedades".* FROM "public"."novedades" WHERE "public"."novedades"."resuelto" = $1 LIMIT $2 OFFSET $3 |
| 39487 | 41.13 | 39487 | 1.0 | anon | WITH pgrst_source AS (SELECT "pgrst_call".* FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "p_fecha" FROM json_to_record(pgrst |
| 36707 | 0.03 | 0 | 0.0 | postgres | SET statement_timeout='58s' |
| 36707 | 0.01 | 0 | 0.0 | postgres | SET idle_session_timeout='58s' |
| 33661 | 105.82 | 33661 | 1.0 | anon | WITH pgrst_source AS ( SELECT "public"."view_calendario_km"."id_chofer", "public"."view_calendario_km"."km_totales", "public"."view_calendar |
| 29645 | 3.99 | 29645 | 1.0 | anon | WITH pgrst_source AS ( SELECT "public"."view_diaria_operativa".* FROM "public"."view_diaria_operativa" ORDER BY "public"."view_diaria_operat |
| 28953 | 2.94 | 137232 | 4.7 | supabase_admin | select schemaname, tablename, format($2, schemaname, tablename)::regclass as oid from pg_publication_tables where pubname = $1 |
| 24214 | 0.16 | 24214 | 1.0 | anon | WITH pgrst_source AS ( SELECT "public"."chofer_documentacion".* FROM "public"."chofer_documentacion" WHERE "public"."chofer_documentacion"." |
| 23103 | 0.19 | 2024 | 0.1 | postgres | INSERT INTO panol.work_order_tasks ( id, work_order_id, task_index, sector_task, estado, porcentaje, created_at, updated_at ) VALUES ( gen_r |
| 16417 | 3.04 | 180587 | 11.0 | postgres | SELECT relname, n_tup_ins, n_tup_upd, n_tup_del FROM pg_stat_user_tables WHERE relname IN ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ORD |
| 15536 | 0.10 | 0 | 0.0 | authenticator | SET client_encoding = 'UTF8' |
| 15534 | 0.01 | 0 | 0.0 | authenticator | SET client_min_messages TO WARNING |
| 15375 | 0.23 | 0 | 0.0 | authenticator | BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY |
| 15271 | 0.00 | 0 | 0.0 | anon | COMMIT |
| 14812 | 50.21 | 14812 | 1.0 | anon | WITH pgrst_source AS ( SELECT "public"."view_flota_operativa".* FROM "public"."view_flota_operativa" LIMIT $1 OFFSET $2 ) SELECT $3::bigint  |
| 14007 | 4.86 | 97999 | 7.0 | postgres | SELECT relname, n_tup_ins, n_tup_upd, n_tup_del FROM pg_stat_user_tables WHERE relname IN ($1, $2, $3, $4, $5, $6, $7) ORDER BY relname ASC |
| 12384 | 0.05 | 0 | 0.0 | supabase_admin | SHOW transaction_read_only |
| 9135 | 8.97 | 9135 | 1.0 | postgres | SELECT COUNT(*) AS total FROM public.view_diaria_operativa |
| 9077 | 0.00 | 0 | 0.0 | supabase_storage_admin | BEGIN |
| 8783 | 38.18 | 8783 | 1.0 | anon | WITH pgrst_source AS ( SELECT "public"."view_diaria_operativa".* FROM "public"."view_diaria_operativa" ORDER BY "public"."view_diaria_operat |
| 8754 | 0.25 | 8754 | 1.0 | service_role | SELECT set_config('role', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt', $3, true), set_config('reques |

### Top sentencias por filas devueltas (proxy de egress)

| rows | calls | filas_x_call | rol | query |
| --- | --- | --- | --- | --- |
| 4700799 | 640 | 7345.0 | postgres | SELECT item_code, name, brand, category, requires_exchange, stock, location FROM panol.items WHERE is_active = $1 ORDER BY name |
| 3051399 | 6631 | 460.2 | postgres | SELECT id, servicio_id, patente, n_interno, marca, modelo, vtv, mas, estado FROM tractores ORDER BY patente ASC |
| 2710235 | 1584038 | 1.7 | supabase_admin | SELECT wal->>$5 as type, wal->>$6 as schema, wal->>$7 as table, COALESCE(wal->>$8, $9) as columns, COALESCE(wal->>$10, $11) as record, COALE |
| 2532000 | 2532 | 1000.0 | postgres | INSERT INTO public.movimientos_km (fecha, id_unidad, id_chofer, dominio, chofer_nombre, km_totales, hoja_ruta) VALUES ($1, $2, $3, $4, $5, $ |
| 2308400 | 6630 | 348.2 | postgres | SELECT id, servicio_id, patente, n_interno, marca, cisternado, esp_es, vi, ve, vtv, mas, estado FROM semis ORDER BY patente ASC |
| 1899211 | 6634 | 286.3 | postgres | SELECT id, n_ute, servicio_id, tractor_id, semi_id, fecha_acople, estado FROM unidades ORDER BY n_ute ASC |
| 1823780 | 6906 | 264.1 | postgres | SELECT * FROM public.view_flota_operativa ORDER BY tractor ASC NULLS LAST, semi ASC NULLS LAST |
| 1738432 | 6532 | 266.1 | postgres | SELECT id, nombre, legajo, servicio_id, estado, unidad_id, foto FROM choferes ORDER BY nombre ASC |
| 1731855 | 6557 | 264.1 | postgres | SELECT * FROM chofer_documentacion |
| 1335348 | 588 | 2271.0 | postgres | SELECT * FROM public.view_diagrama_mensual ORDER BY chofer_nombre ASC |
| 1238096 | 136 | 9103.6 | postgres | SELECT TO_CHAR(fecha, $2) AS fecha, dominio, chofer_nombre, km AS km_totales, hoja_ruta, id_chofer, id_unidad FROM view_calendario_km WHERE  |
| 1017864 | 6527 | 155.9 | postgres | SELECT * FROM movimientos |
| 953820 | 420 | 2271.0 | postgres | SELECT diagrama_id, chofer_id, mes_tab, anio, mes_numero, tira_dias, contabilizador, km_mes_total, cant_viajes_mes, dias_km FROM public.view |
| 756223 | 93 | 8131.4 | postgres | SELECT TO_CHAR(fecha, $2) AS fecha, dominio, chofer_nombre, km AS km_totales, hoja_ruta, id_chofer, id_unidad FROM view_calendario_km WHERE  |
| 696220 | 2646 | 263.1 | postgres | SELECT chofer_id, nombre, dni, servicio, foto, telefono, estado_chofer FROM public.view_individual_chofer ORDER BY nombre ASC |
| 670505 | 167 | 4015.0 | postgres | SELECT diagrama_id, chofer_id, mes_tab, anio, mes_numero, tira_dias, contabilizador, km_mes_total, cant_viajes_mes, dias_km FROM public.view |
| 582569 | 2189 | 266.1 | postgres | SELECT * FROM public.view_diaria_operativa ORDER BY nombre ASC |
| 582312 | 2187 | 266.3 | postgres | SELECT * FROM public.view_individual_chofer ORDER BY nombre ASC |
| 577067 | 2211 | 261.0 | postgres | SELECT chofer_id, nombre, legajo, dni, servicio, foto, telefono, estado_chofer FROM public.view_individual_chofer ORDER BY nombre ASC |
| 556140 | 465 | 1196.0 | authenticator | SELECT name FROM pg_timezone_names |

### Cache hit ratio (objetivo > 99%)

| tablas_pct | indices_pct |
| --- | --- |
| 100.00 | 100.00 |

### Tablas con más seq scans que index scans (> 300 filas)

_(sin filas)_

### Índices nunca usados (no PK / no UNIQUE)

| schema | tabla | indice | idx_scan | tam |
| --- | --- | --- | --- | --- |
| panol | items | idx_panol_items_upper_name | 0 | 472 kB |
| public | seguridad_vial | idx_seguridad_vial_icm | 0 | 160 kB |
| public | cisternas_km | idx_cisternas_km_estado | 0 | 48 kB |
| storage | objects | name_prefix_search | 0 | 40 kB |
| auth | one_time_tokens | one_time_tokens_token_hash_hash_idx | 0 | 32 kB |
| storage | objects | idx_objects_bucket_id_name | 0 | 32 kB |
| auth | one_time_tokens | one_time_tokens_relates_to_hash_idx | 0 | 32 kB |
| panol | stock_movements | idx_stock_mov_created_at_brin | 0 | 24 kB |
| public | novedades | idx_novedades_terminal_id | 0 | 16 kB |
| panol | work_orders_cold | idx_woc_status | 0 | 16 kB |
| panol | staff_holds | idx_staff_holds_staff_id | 0 | 16 kB |
| public | novedades | idx_novedades_creado_por_id | 0 | 16 kB |
| panol | work_order_tasks | idx_wot_worker_active | 0 | 16 kB |
| auth | users | users_is_anonymous_idx | 0 | 16 kB |
| panol | orders | idx_panol_orders_created_desc | 0 | 16 kB |
| public | eor_sync_queue | idx_eor_sync_estado | 0 | 16 kB |
| panol | stock_movements | idx_panol_stock_mov_order_id | 0 | 16 kB |
| panol | orders | idx_panol_orders_mechanic | 0 | 16 kB |
| auth | users | users_instance_id_idx | 0 | 16 kB |
| panol | order_items_legacy_backup | idx_panol_oi_item | 0 | 16 kB |

### Índices duplicados o redundantes que duplican PK / UNIQUE

| schema | tabla | indice_duplicado | tam | definicion |
| --- | --- | --- | --- | --- |
| auth | custom_oauth_providers | custom_oauth_providers_identifier_idx | 8192 bytes | CREATE INDEX custom_oauth_providers_identifier_idx ON auth.custom_oauth_providers USING btree (identifier) |
| auth | oauth_consents | oauth_consents_active_user_client_idx | 8192 bytes | CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents USING btree (user_id, client_id) WHERE (revoked_at IS NULL) |
| auth | users | idx_users_email | 16 kB | CREATE INDEX idx_users_email ON auth.users USING btree (email) |
| panol | orders | idx_panol_orders_req | 16 kB | CREATE INDEX idx_panol_orders_req ON panol.orders USING btree (req_code) |
| panol | staff | idx_panol_staff_op_code | 16 kB | CREATE INDEX idx_panol_staff_op_code ON panol.staff USING btree (op_code) |
| panol | staff | idx_staff_op_code | 16 kB | CREATE INDEX idx_staff_op_code ON panol.staff USING btree (op_code) |
| panol | staff_holds | idx_staff_holds_staff_tractor | 16 kB | CREATE UNIQUE INDEX idx_staff_holds_staff_tractor ON panol.staff_holds USING btree (staff_id, tractor_id) WHERE (tractor_id IS NOT NULL) |
| panol | staff_holds | idx_staff_holds_unique_tractor | 16 kB | CREATE UNIQUE INDEX idx_staff_holds_unique_tractor ON panol.staff_holds USING btree (staff_id, tractor_id) WHERE (tractor_id IS NOT NULL) |
| panol | unit_work_orders | idx_uwo_semi | 40 kB | CREATE INDEX idx_uwo_semi ON panol.unit_work_orders USING btree (semi_id) |
| panol | unit_work_orders | idx_uwo_tractor | 40 kB | CREATE INDEX idx_uwo_tractor ON panol.unit_work_orders USING btree (tractor_id) |
| panol | unit_work_orders | idx_uwo_work_order | 56 kB | CREATE INDEX idx_uwo_work_order ON panol.unit_work_orders USING btree (work_order_id) |
| panol | work_orders | idx_wo_ot_number | 40 kB | CREATE INDEX idx_wo_ot_number ON panol.work_orders USING btree (ot_number) |
| public | diagramas | idx_diagramas_chofer_anio_mes | 200 kB | CREATE INDEX idx_diagramas_chofer_anio_mes ON public.diagramas USING btree (chofer_id, anio DESC, mes_numero DESC) |
| public | unidades | idx_unidades_n_ute_unique | 32 kB | CREATE UNIQUE INDEX idx_unidades_n_ute_unique ON public.unidades USING btree (n_ute) WHERE (n_ute IS NOT NULL) |
| public | unidades | uq_unidades_n_ute | 40 kB | CREATE UNIQUE INDEX uq_unidades_n_ute ON public.unidades USING btree (n_ute) WHERE ((n_ute IS NOT NULL) AND (n_ute <> ''::text)) |
| storage | objects | idx_objects_bucket_id_name | 32 kB | CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C") |
| storage | objects | idx_objects_current_version | 40 kB | CREATE UNIQUE INDEX idx_objects_current_version ON storage.objects USING btree (bucket_id, name COLLATE "C") WHERE (archived_at IS NULL) |
| storage | objects | idx_objects_delete_markers | 8192 bytes | CREATE INDEX idx_objects_delete_markers ON storage.objects USING btree (bucket_id, name COLLATE "C") WHERE is_delete_marker |
| storage | objects | idx_objects_null_version | 40 kB | CREATE UNIQUE INDEX idx_objects_null_version ON storage.objects USING btree (bucket_id, name COLLATE "C") WHERE (NOT is_versioned) |

### FKs sin índice en la columna origen (riesgo de table locks y deletes lentos)

| tabla | fk | definicion |
| --- | --- | --- |
| auth.mfa_challenges | mfa_challenges_auth_factor_id_fkey | FOREIGN KEY (factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE |
| auth.oauth_authorizations | oauth_authorizations_client_id_fkey | FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE |
| auth.oauth_authorizations | oauth_authorizations_user_id_fkey | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| auth.saml_relay_states | saml_relay_states_flow_state_id_fkey | FOREIGN KEY (flow_state_id) REFERENCES auth.flow_state(id) ON DELETE CASCADE |
| storage.s3_multipart_uploads_parts | s3_multipart_uploads_parts_upload_id_fkey | FOREIGN KEY (upload_id) REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE |
| storage.s3_multipart_uploads_parts | s3_multipart_uploads_parts_bucket_id_fkey | FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id) |
| storage.vector_indexes | vector_indexes_bucket_id_fkey | FOREIGN KEY (bucket_id) REFERENCES storage.buckets_vectors(id) |

### Vistas con scans laterales JSONB (riesgo alto de CPU / latencia > 100ms)

| schema | vista | advertencia | largo_def |
| --- | --- | --- | --- |
| panol | v_coord_kanban_terminados | jsonb_each / jsonb_array_elements lateral scan | 11180 |
| public | view_diaria_operativa | jsonb_each / jsonb_array_elements lateral scan | 4146 |

### Integridad por tabla (PK, FK, UNIQUE, CHECK, RLS, Replica Identity)

| schema | tabla | pk | fk | uq | ck | rls | replica_identity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| auth | audit_log_entries | 1 | 0 | 0 | 0 | true | default |
| auth | custom_oauth_providers | 1 | 0 | 1 | 18 | false | default |
| auth | flow_state | 1 | 0 | 0 | 0 | true | default |
| auth | identities | 1 | 1 | 1 | 0 | true | default |
| auth | instances | 1 | 0 | 0 | 0 | true | default |
| auth | mfa_amr_claims | 1 | 1 | 1 | 0 | true | default |
| auth | mfa_challenges | 1 | 1 | 0 | 0 | true | default |
| auth | mfa_factors | 1 | 1 | 1 | 0 | true | default |
| auth | mfa_recovery_code_sets | 1 | 2 | 2 | 1 | false | default |
| auth | mfa_recovery_codes | 1 | 1 | 0 | 0 | false | default |
| auth | oauth_authorizations | 1 | 2 | 2 | 8 | false | default |
| auth | oauth_client_states | 1 | 0 | 0 | 0 | false | default |
| auth | oauth_clients | 1 | 0 | 0 | 4 | false | default |
| auth | oauth_consents | 1 | 2 | 1 | 3 | false | default |
| auth | one_time_tokens | 1 | 1 | 0 | 1 | true | default |
| auth | refresh_tokens | 1 | 1 | 1 | 0 | true | default |
| auth | saml_providers | 1 | 1 | 1 | 3 | true | default |
| auth | saml_relay_states | 1 | 2 | 0 | 1 | true | default |
| auth | schema_migrations | 1 | 0 | 0 | 0 | true | default |
| auth | scim_tokens | 1 | 1 | 0 | 3 | false | default |
| auth | scim_users | 1 | 2 | 0 | 0 | false | default |
| auth | sessions | 1 | 2 | 0 | 1 | true | default |
| auth | sso_domains | 1 | 1 | 0 | 1 | true | default |
| auth | sso_providers | 1 | 0 | 0 | 1 | true | default |
| auth | users | 1 | 0 | 1 | 1 | true | default |
| auth | webauthn_challenges | 1 | 1 | 0 | 1 | false | default |
| auth | webauthn_credentials | 1 | 1 | 0 | 0 | false | default |
| panol | items | 1 | 0 | 1 | 1 | true | default |
| panol | order_items_legacy_backup | 1 | 2 | 0 | 1 | true | default |
| panol | orders | 1 | 7 | 1 | 0 | true | default |
| panol | staff | 1 | 1 | 1 | 0 | true | default |
| panol | staff_holds | 1 | 6 | 0 | 0 | true | default |
| panol | stock_movements | 1 | 5 | 0 | 0 | true | default |
| panol | unit_work_orders | 1 | 3 | 3 | 1 | true | default |
| panol | work_order_tasks | 1 | 2 | 1 | 1 | true | default |
| panol | work_orders | 1 | 0 | 1 | 1 | true | default |
| panol | work_orders_cold | 1 | 2 | 0 | 0 | true | default |
| public | chofer_documentacion | 1 | 1 | 1 | 0 | true | default |
| public | chofer_observaciones | 1 | 2 | 0 | 0 | true | default |
| public | choferes | 1 | 2 | 0 | 1 | true | full |
| public | choferes_km_mensual | 1 | 1 | 1 | 0 | true | default |
| public | cisternas_km | 1 | 4 | 0 | 1 | true | default |
| public | dash | 1 | 1 | 0 | 0 | true | default |
| public | dash_menciones | 1 | 2 | 1 | 0 | true | default |
| public | diagramas | 1 | 1 | 0 | 0 | true | full |
| public | eor | 1 | 1 | 0 | 0 | true | default |
| public | eor_sync_queue | 1 | 1 | 0 | 3 | true | default |
| public | log_queries | 1 | 0 | 0 | 0 | true | default |
| public | movimientos | 1 | 2 | 2 | 0 | true | full |
| public | novedades | 1 | 5 | 0 | 0 | true | default |
| public | panol | 1 | 1 | 0 | 0 | true | default |
| public | seguridad_vial | 1 | 1 | 1 | 0 | true | default |
| public | seguridad_vial_incidentes_ijl | 1 | 1 | 1 | 0 | true | default |
| public | semis | 1 | 1 | 1 | 1 | true | default |
| public | servicios_choferes | 1 | 1 | 1 | 0 | true | default |
| public | servicios_unidades | 1 | 0 | 1 | 0 | true | default |
| public | terminales | 1 | 0 | 1 | 0 | true | default |
| public | tipos_novedad | 1 | 0 | 1 | 0 | true | default |
| public | tractores | 1 | 1 | 1 | 1 | true | default |
| public | unidades | 1 | 3 | 0 | 1 | true | full |
| public | usuarios_auth | 1 | 0 | 1 | 0 | true | default |
| realtime | messages_2026_10_30 | 1 | 0 | 0 | 1 | false | default |
| realtime | messages_2026_10_31 | 1 | 0 | 0 | 1 | false | default |
| realtime | messages_2026_11_01 | 1 | 0 | 0 | 1 | false | default |
| realtime | messages_2026_11_02 | 1 | 0 | 0 | 1 | false | default |
| realtime | messages_2026_11_03 | 1 | 0 | 0 | 1 | false | default |
| realtime | messages_2026_11_04 | 1 | 0 | 0 | 1 | false | default |
| realtime | messages_2026_11_05 | 1 | 0 | 0 | 1 | false | default |
| realtime | schema_migrations | 1 | 0 | 0 | 0 | false | default |
| realtime | subscription | 1 | 0 | 0 | 1 | false | default |
| storage | bucket_lifecycle_states | 1 | 1 | 0 | 4 | true | default |
| storage | buckets | 1 | 0 | 0 | 5 | true | default |
| storage | buckets_analytics | 1 | 0 | 0 | 0 | true | default |
| storage | buckets_vectors | 1 | 0 | 0 | 0 | true | default |
| storage | lifecycle_abandoned_artifacts | 1 | 0 | 0 | 0 | true | default |
| storage | migrations | 1 | 0 | 1 | 0 | true | default |
| storage | objects | 1 | 1 | 0 | 0 | true | default |
| storage | s3_multipart_uploads | 1 | 1 | 0 | 0 | true | default |
| storage | s3_multipart_uploads_parts | 1 | 2 | 0 | 0 | true | default |
| storage | vector_indexes | 1 | 1 | 0 | 0 | true | default |
| vault | secrets | 1 | 0 | 0 | 0 | false | default |

### Tablas publicadas en Realtime (genera replicación continua de WAL)

| pubname | schemaname | tablename |
| --- | --- | --- |
| supabase_realtime | panol | work_order_tasks |
| supabase_realtime | panol | work_orders |
| supabase_realtime | public | choferes |
| supabase_realtime | public | choferes_km_mensual |
| supabase_realtime | public | diagramas |
| supabase_realtime | public | movimientos |
| supabase_realtime | public | novedades |
| supabase_realtime | public | unidades |
| supabase_realtime_messages_publication | realtime | messages_2026_10_30 |
| supabase_realtime_messages_publication | realtime | messages_2026_10_31 |
| supabase_realtime_messages_publication | realtime | messages_2026_11_01 |
| supabase_realtime_messages_publication | realtime | messages_2026_11_02 |
| supabase_realtime_messages_publication | realtime | messages_2026_11_03 |
| supabase_realtime_messages_publication | realtime | messages_2026_11_04 |
| supabase_realtime_messages_publication | realtime | messages_2026_11_05 |

### Triggers activos de esquemas de usuario

| schema | tabla | trigger_name | momento | eventos | accion |
| --- | --- | --- | --- | --- | --- |
| panol | order_items | trg_order_items_view_io | INSTEAD OF | UPDATE,INSERT,DELETE | EXECUTE FUNCTION panol.trg_order_items_view_sync() |
| panol | unit_work_orders | trg_uwo_supersede_active_ot | BEFORE | UPDATE,INSERT | EXECUTE FUNCTION panol.handle_supersede_active_ot() |
| panol | work_order_tasks | trg_wot_sync_avg | AFTER | DELETE,UPDATE,INSERT | EXECUTE FUNCTION panol.sync_work_order_avg() |
| panol | work_orders | trg_autoclean_completed_holds | AFTER | UPDATE | EXECUTE FUNCTION panol.fn_autoclean_completed_holds() |
| public | chofer_documentacion | trg_sync_documentacion | BEFORE | UPDATE | EXECUTE FUNCTION fn_trg_sync_documentacion() |
| public | choferes | trg_sync_asignacion | BEFORE | UPDATE | EXECUTE FUNCTION fn_trg_sync_asignacion() |
| public | choferes_km_mensual | trg_protect_choferes_km_mensual | BEFORE | UPDATE | EXECUTE FUNCTION trg_protect_choferes_km_mensual() |
| public | dash | trg_sync_dash_auth | BEFORE | INSERT | EXECUTE FUNCTION sync_auth_user_for_satellite() |
| public | diagramas | trg_sync_diagramas | BEFORE | UPDATE | EXECUTE FUNCTION fn_trg_sync_diagramas() |
| public | eor | trg_sync_eor_auth | BEFORE | INSERT | EXECUTE FUNCTION sync_auth_user_for_satellite() |
| public | movimientos | trg_movimientos_sync | AFTER | INSERT,DELETE,UPDATE | EXECUTE FUNCTION fn_trg_movimientos_sync() |
| public | panol | trg_sync_panol_auth | BEFORE | INSERT | EXECUTE FUNCTION sync_auth_user_for_panol() |
| realtime | subscription | tr_check_filters | BEFORE | UPDATE,INSERT | EXECUTE FUNCTION realtime.subscription_check_filters() |
| storage | buckets | enforce_bucket_name_length_trigger | BEFORE | UPDATE,INSERT | EXECUTE FUNCTION storage.enforce_bucket_name_length() |
| storage | buckets | enforce_versioning_status_transition | BEFORE | UPDATE | EXECUTE FUNCTION storage.enforce_versioning_status_transition() |
| storage | buckets | protect_active_lifecycle_states | BEFORE | DELETE | EXECUTE FUNCTION storage.protect_active_lifecycle_states() |
| storage | buckets | protect_bucket_control_insert | BEFORE | INSERT | EXECUTE FUNCTION storage.protect_bucket_control_columns('service_role') |
| storage | buckets | protect_bucket_control_update | BEFORE | UPDATE | EXECUTE FUNCTION storage.protect_bucket_control_columns() |
| storage | buckets | protect_bucket_control_update_role | AFTER | UPDATE | EXECUTE FUNCTION storage.enforce_bucket_lifecycle_service_role('service_role') |
| storage | buckets | protect_buckets_delete | BEFORE | DELETE | EXECUTE FUNCTION storage.protect_delete() |
| storage | buckets | wake_lifecycle_on_policy_write | AFTER | UPDATE,INSERT | EXECUTE FUNCTION storage.wake_lifecycle_state() |
| storage | buckets | wake_lifecycle_on_versioning_enable | AFTER | UPDATE | EXECUTE FUNCTION storage.wake_lifecycle_state() |
| storage | objects | protect_objects_delete | BEFORE | DELETE | EXECUTE FUNCTION storage.protect_delete() |
| storage | objects | update_objects_updated_at | BEFORE | UPDATE | EXECUTE FUNCTION storage.update_updated_at_column() |

### Vistas y vistas materializadas activas

| schema | vista | tipo | largo_def |
| --- | --- | --- | --- |
| extensions | pg_stat_statements | view | 1847 |
| extensions | pg_stat_statements_info | view | 113 |
| panol | order_items | view | 237 |
| panol | v_coord_kanban_progreso | view | 8692 |
| panol | v_coord_kanban_terminados | view | 11180 |
| panol | v_coord_unit_tasks | view | 1447 |
| panol | v_devoluciones_pendientes | view | 4663 |
| panol | v_flota_busqueda | view | 5104 |
| panol | v_monitor_pedidos | view | 3265 |
| panol | v_staff_holds | view | 1179 |
| panol | v_stock_movements | view | 915 |
| panol | v_tablero_coordinacion | view | 863 |
| public | panol_items | view | 191 |
| public | panol_order_items | view | 233 |
| public | panol_orders | view | 304 |
| public | panol_staff | view | 133 |
| public | panol_stock_movements | view | 192 |
| public | panol_work_order_tasks | view | 223 |
| public | panol_work_orders | view | 137 |
| public | v_coord_kanban_progreso | view | 625 |
| public | v_coord_kanban_terminados | view | 642 |
| public | v_coord_unit_tasks | view | 412 |
| public | v_staff_holds | view | 377 |
| public | v_stock_movements | view | 506 |
| public | view_calendario_diagrama_km | view | 1020 |
| public | view_calendario_diagrama_km_12m | view | 1063 |
| public | view_calendario_diagrama_km_2m | view | 1215 |
| public | view_cards_diarias | view | 749 |
| public | view_dash_flota | view | 381 |
| public | view_dash_novedades | view | 3032 |
| public | view_dash_usuarios | view | 99 |
| public | view_dashboard_kpis | view | 1780 |
| public | view_diagrama_mensual | view | 385 |
| public | view_diaria_operativa | view | 4146 |
| public | view_flota_operativa | view | 2133 |
| public | view_individual_chofer | view | 1905 |
| public | view_movimientos | view | 2391 |
| public | view_personal_retorno | view | 443 |
| vault | decrypted_secrets | view | 387 |

### Conexiones activas por aplicación y estado

| app | usuario | estado | n | max_en_estado |
| --- | --- | --- | --- | --- |
| PostgREST 14.5 | authenticator | idle | 2 | 42 days 23:57:11.66872 |
| (sin nombre) | supabase_admin | idle | 1 | 20:50:13.962655 |
| pg_cron scheduler | supabase_admin |  | 1 |  |
| (sin nombre) | pgbouncer | idle | 1 | -00:00:06.270761 |
| postgres_exporter | supabase_admin | idle | 1 | 00:00:34.800721 |
| Supavisor (auth_query) | pgbouncer | idle | 1 | -00:00:11.502019 |
| pg_net 0.20.4 | postgres | idle | 1 | 43 days 00:03:04.176438 |

### Transacciones abiertas > 30 s

_(sin filas)_

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
| novedades | 3 |
| usuarios_auth | 3 |
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

### RPC / upsert compuestas — 6 ocurrencias

```text
[eor-frontend] src/api/apiClient.js:146  const { data, error } = await supabase.rpc('fn_km_por_fecha', { p_fecha: fIso });
[eor-frontend] src/api/apiClient.js:166  const { data, error } = await supabase.rpc('fn_personal_retorno', { p_fecha: fechaTarget });
[eor-frontend] src/api/apiClient.js:565  const { data, error } = await supabase.rpc('fn_asignar_unidad_chofer', {
[eor-frontend] src/api/apiClient.js:596  const { data, error } = await supabase.rpc('fn_desunir_unidad_chofer', {
[eor-frontend] src/context/AuthContext.jsx:63  const { data: rpcRes, error: rpcErr } = await supabase.rpc('fn_auth_login', {
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
