-- ============================================================================
-- PROYECTO: rsvajuxihvmpmrmlcbul (Supabase)
-- ESQUEMA: panol
-- OBJETIVO: 
--   1. Limpieza de panol.unit_work_orders:
--      - Eliminar definitivamente las columnas 'vehicle_id' y 'vehicle_type'.
--      - Eliminar el trigger y función de sincronización trg_sync_uwo_vehicles.
--      - Eliminar índices y restricciones asociadas a vehicle_id / vehicle_type.
--      - Establecer restricciones de unicidad específicas:
--        unique_unit_work_order_tractor (tractor_id, work_order_id)
--        unique_unit_work_order_semi (semi_id, work_order_id)
--   2. Normalizar todas las vistas SQL que hacían referencia a vehicle_id / vehicle_type.
-- ============================================================================

-- A. DROP DE VISTAS DEPENDIENTES EN CASCADA
DROP VIEW IF EXISTS public.v_taller_unit_tasks CASCADE;
DROP VIEW IF EXISTS panol.v_taller_unit_tasks CASCADE;
DROP VIEW IF EXISTS public.v_operario_tasks CASCADE;
DROP VIEW IF EXISTS panol.v_operario_tasks CASCADE;
DROP VIEW IF EXISTS public.v_ots_anteriores CASCADE;
DROP VIEW IF EXISTS panol.v_ots_anteriores CASCADE;
DROP VIEW IF EXISTS public.v_boxes_en_vivo CASCADE;
DROP VIEW IF EXISTS panol.v_boxes_en_vivo CASCADE;
DROP VIEW IF EXISTS public.v_tablero_coordinacion CASCADE;
DROP VIEW IF EXISTS panol.v_tablero_coordinacion CASCADE;
DROP VIEW IF EXISTS public.v_flota_busqueda CASCADE;
DROP VIEW IF EXISTS panol.v_flota_busqueda CASCADE;
DROP VIEW IF EXISTS public.v_staff_holds CASCADE;
DROP VIEW IF EXISTS panol.v_staff_holds CASCADE;

-- B. ELIMINAR TRIGGER Y FUNCIÓN DE SINCRONIZACIÓN LEGACY
DROP TRIGGER IF EXISTS trg_sync_uwo_vehicles ON panol.unit_work_orders;
DROP FUNCTION IF EXISTS panol.sync_unit_work_orders_vehicle_fields();

-- C. ELIMINAR ÍNDICES Y RESTRICCIONES LEGACY DE vehicle_id / vehicle_type
DROP INDEX IF EXISTS panol.idx_uwo_vehicle;
ALTER TABLE panol.unit_work_orders DROP CONSTRAINT IF EXISTS unique_unit_work_order;
ALTER TABLE panol.unit_work_orders DROP CONSTRAINT IF EXISTS unit_work_orders_vehicle_type_check;

-- D. ELIMINAR COLUMNAS vehicle_id Y vehicle_type
ALTER TABLE panol.unit_work_orders DROP COLUMN IF EXISTS vehicle_id CASCADE;
ALTER TABLE panol.unit_work_orders DROP COLUMN IF EXISTS vehicle_type CASCADE;

-- E. AGREGAR NUEVAS RESTRICCIONES DE UNICIDAD NORMALIZADAS
ALTER TABLE panol.unit_work_orders
    DROP CONSTRAINT IF EXISTS unique_unit_work_order_tractor,
    ADD CONSTRAINT unique_unit_work_order_tractor UNIQUE (tractor_id, work_order_id);

ALTER TABLE panol.unit_work_orders
    DROP CONSTRAINT IF EXISTS unique_unit_work_order_semi,
    ADD CONSTRAINT unique_unit_work_order_semi UNIQUE (semi_id, work_order_id);

CREATE INDEX IF NOT EXISTS idx_uwo_tractor ON panol.unit_work_orders(tractor_id);
CREATE INDEX IF NOT EXISTS idx_uwo_semi ON panol.unit_work_orders(semi_id);
CREATE INDEX IF NOT EXISTS idx_uwo_work_order ON panol.unit_work_orders(work_order_id);

-- F. RECREAR VISTAS SQL NORMALIZADAS CON EL NUEVO ESQUEMA

-- 1. Vista General de Taller (Timeline y tareas vivas)
CREATE OR REPLACE VIEW panol.v_taller_unit_tasks AS
SELECT 
    uwo.id AS unit_wo_id,
    CASE WHEN uwo.tractor_id IS NOT NULL THEN 'TRACTOR' ELSE 'SEMI' END AS vehicle_type,
    COALESCE(uwo.tractor_id, uwo.semi_id) AS vehicle_id,
    uwo.tractor_id,
    uwo.semi_id,
    wo.id AS work_order_id,
    wo.ot_number,
    wo.avg AS progress_percentage,
    wo.status AS wo_status,
    wot.id AS task_id,
    wot.task_index,
    wot.sector_task,
    COALESCE(substring(wot.sector_task from '^\[([^\]]+)\]'), 'GENERAL') AS sector,
    trim(regexp_replace(wot.sector_task, '^\[[^\]]+\]\s*', '')) AS description,
    wot.ubicacion,
    wot.worker_id,
    wot.worker_id AS assigned_staff_id,
    s.name AS operario,
    s.name AS assigned_staff_name,
    s.op_code AS assigned_op_code,
    wot.estado AS task_estado,
    wot.porcentaje AS task_porcentaje,
    wot.empezo,
    wot.termino
FROM panol.unit_work_orders uwo
JOIN panol.work_orders wo ON uwo.work_order_id = wo.id
LEFT JOIN panol.work_order_tasks wot ON wot.work_order_id = wo.id
LEFT JOIN panol.staff s ON wot.worker_id = s.id
WHERE wo.status = 'ACTIVA';

-- 2. Vista Específica para Operario / Box
CREATE OR REPLACE VIEW panol.v_operario_tasks AS
SELECT 
    wot.id AS task_id,
    wot.work_order_id,
    wo.ot_number,
    CASE WHEN uwo.tractor_id IS NOT NULL THEN 'TRACTOR' ELSE 'SEMI' END AS vehicle_type,
    COALESCE(uwo.tractor_id, uwo.semi_id) AS vehicle_id,
    uwo.tractor_id,
    uwo.semi_id,
    wot.task_index,
    wot.sector_task,
    wot.ubicacion,
    wot.worker_id,
    wot.worker_id AS assigned_staff_id,
    s.name AS operario,
    s.name AS assigned_staff_name,
    s.op_code AS assigned_op_code,
    wot.estado,
    wot.porcentaje,
    wot.empezo,
    wot.termino
FROM panol.work_order_tasks wot
JOIN panol.work_orders wo ON wot.work_order_id = wo.id
JOIN panol.unit_work_orders uwo ON uwo.work_order_id = wo.id
LEFT JOIN panol.staff s ON wot.worker_id = s.id;

-- 3. Vista de Órdenes Históricas (OTs Anteriores)
CREATE OR REPLACE VIEW panol.v_ots_anteriores AS
SELECT 
    CASE WHEN uwo.tractor_id IS NOT NULL THEN 'TRACTOR' ELSE 'SEMI' END AS vehicle_type,
    COALESCE(uwo.tractor_id, uwo.semi_id) AS vehicle_id,
    uwo.tractor_id,
    uwo.semi_id,
    wo.id AS work_order_id,
    wo.ot_number,
    wo.avg,
    wo.status,
    to_char(wo.close_date, 'DD/MM') AS date_label,
    wo.close_date
FROM panol.unit_work_orders uwo
JOIN panol.work_orders wo ON uwo.work_order_id = wo.id
WHERE wo.status = 'COMPLETADA' AND wo.close_date >= NOW() - INTERVAL '180 days';

-- 4. Vista Bahías en Vivo
CREATE OR REPLACE VIEW panol.v_boxes_en_vivo AS
SELECT 
    wot.ubicacion AS box_number,
    CASE WHEN uwo.tractor_id IS NOT NULL THEN 'TRACTOR' ELSE 'SEMI' END AS vehicle_type,
    COALESCE(t.patente, sm.patente, ''::text) AS patente,
    COALESCE(t.marca, sm.marca, ''::text) AS marca,
    wo.ot_number,
    wo.id AS work_order_id,
    wot.id AS active_task_id,
    wot.task_index,
    wot.sector_task,
    COALESCE(substring(wot.sector_task from '^\[([^\]]+)\]'), 'GENERAL') AS sector,
    trim(regexp_replace(wot.sector_task, '^\[[^\]]+\]\s*', '')) AS descripcion,
    s.id AS staff_id,
    s.id AS worker_id,
    s.name AS operario_nombre,
    s.op_code AS legajo,
    wot.empezo,
    ROUND(EXTRACT(EPOCH FROM (NOW() - wot.empezo)) / 60) AS minutos_en_curso
FROM panol.work_order_tasks wot
JOIN panol.work_orders wo ON wot.work_order_id = wo.id
JOIN panol.unit_work_orders uwo ON uwo.work_order_id = wo.id
LEFT JOIN panol.staff s ON wot.worker_id = s.id
LEFT JOIN public.tractores t ON uwo.tractor_id = t.id
LEFT JOIN public.semis sm ON uwo.semi_id = sm.id
WHERE wot.estado = 'EN_CURSO' AND wot.ubicacion IS NOT NULL;

-- 5. Vista Tablero de Coordinación
CREATE OR REPLACE VIEW panol.v_tablero_coordinacion AS
SELECT 
    wo.id AS work_order_id,
    wo.ot_number,
    wo.entry_date,
    wo.status AS ot_status,
    wo.avg AS progress_percentage,
    u.id AS unidad_id,
    u.n_ute,
    COALESCE(t.patente, ''::text) AS tractor,
    COALESCE(t.marca, ''::text) AS marca_tr,
    COALESCE(s.patente, ''::text) AS semi,
    COALESCE(s.marca, ''::text) AS marca_semi,
    COALESCE(su.denominacion, 'GENERAL'::text) AS servicio,
    COALESCE(u.estado, 'disponible'::text) AS estado_unidad
FROM panol.unit_work_orders uwo
JOIN panol.work_orders wo ON uwo.work_order_id = wo.id
LEFT JOIN public.tractores t ON uwo.tractor_id = t.id
LEFT JOIN public.semis s ON uwo.semi_id = s.id
LEFT JOIN public.unidades u ON (u.tractor_id = t.id OR u.semi_id = s.id)
LEFT JOIN public.servicios_unidades su ON u.servicio_id = su.id
WHERE wo.status = 'ACTIVA';

-- 6. Vista Búsqueda de Flota
CREATE OR REPLACE VIEW panol.v_flota_busqueda AS
SELECT 
    u.id AS unidad_id,
    u.n_ute,
    COALESCE(t.patente, ''::text) AS tractor,
    COALESCE(t.marca, ''::text) AS marca_tr,
    COALESCE(s.patente, ''::text) AS semi,
    COALESCE(s.marca, ''::text) AS marca_semi,
    COALESCE(su.denominacion, 'GENERAL'::text) AS servicio,
    COALESCE(u.estado, 'disponible'::text) AS estado_unidad,
    COALESCE(wot.work_order_id, wos.work_order_id) AS active_work_order_id,
    COALESCE(wot.ot_number, wos.ot_number) AS active_ot_number,
    COALESCE(wot.status, wos.status) AS active_ot_status,
    wot.ot_number AS tractor_ot,
    wos.ot_number AS semi_ot
FROM public.unidades u
LEFT JOIN public.tractores t ON u.tractor_id = t.id
LEFT JOIN public.semis s ON u.semi_id = s.id
LEFT JOIN public.servicios_unidades su ON u.servicio_id = su.id
LEFT JOIN LATERAL (
    SELECT wo.id AS work_order_id, wo.ot_number, wo.status
    FROM panol.unit_work_orders uwo
    JOIN panol.work_orders wo ON uwo.work_order_id = wo.id
    WHERE uwo.tractor_id = t.id AND wo.status = 'ACTIVA'
    ORDER BY wo.created_at DESC
    LIMIT 1
) wot ON TRUE
LEFT JOIN LATERAL (
    SELECT wo.id AS work_order_id, wo.ot_number, wo.status
    FROM panol.unit_work_orders uwo
    JOIN panol.work_orders wo ON uwo.work_order_id = wo.id
    WHERE uwo.semi_id = s.id AND wo.status = 'ACTIVA'
    ORDER BY wo.created_at DESC
    LIMIT 1
) wos ON TRUE;

-- 7. Vista Staff Holds
CREATE OR REPLACE VIEW panol.v_staff_holds AS
SELECT 
    sh.id AS hold_id,
    sh.staff_id,
    s.op_code,
    s.name AS staff_name,
    sh.work_order_id,
    COALESCE(wo.ot_number, sh.ot_number, ''::text) AS tractor_ot,
    COALESCE(sh.semi_ot, ''::text) AS semi_ot,
    COALESCE(t.patente, sh.tractor_plate, ''::text) AS tractor_plate,
    COALESCE(t.marca, ''::text) AS tractor_brand,
    COALESCE(sm.patente, sh.semi_plate, ''::text) AS semi_plate,
    COALESCE(sm.marca, ''::text) AS semi_brand,
    sh.created_at
FROM panol.staff_holds sh
JOIN panol.staff s ON sh.staff_id = s.id
LEFT JOIN panol.work_orders wo ON sh.work_order_id = wo.id
LEFT JOIN panol.unit_work_orders uwo_tr ON (uwo_tr.work_order_id = wo.id AND uwo_tr.tractor_id IS NOT NULL)
LEFT JOIN panol.unit_work_orders uwo_sm ON (uwo_sm.work_order_id = wo.id AND uwo_sm.semi_id IS NOT NULL)
LEFT JOIN public.tractores t ON (COALESCE(uwo_tr.tractor_id, sh.tractor_id) = t.id)
LEFT JOIN public.semis sm ON (COALESCE(uwo_sm.semi_id, sh.semi_id) = sm.id);

-- Vistas públicas correspondientes (alias)
CREATE OR REPLACE VIEW public.v_taller_unit_tasks AS SELECT * FROM panol.v_taller_unit_tasks;
CREATE OR REPLACE VIEW public.v_operario_tasks AS SELECT * FROM panol.v_operario_tasks;
CREATE OR REPLACE VIEW public.v_ots_anteriores AS SELECT * FROM panol.v_ots_anteriores;
CREATE OR REPLACE VIEW public.v_boxes_en_vivo AS SELECT * FROM panol.v_boxes_en_vivo;
CREATE OR REPLACE VIEW public.v_tablero_coordinacion AS SELECT * FROM panol.v_tablero_coordinacion;
CREATE OR REPLACE VIEW public.v_flota_busqueda AS SELECT * FROM panol.v_flota_busqueda;
CREATE OR REPLACE VIEW public.v_staff_holds AS SELECT * FROM panol.v_staff_holds;
