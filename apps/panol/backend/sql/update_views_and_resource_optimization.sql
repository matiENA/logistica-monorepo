-- ============================================================================
-- PROYECTO: Pañol Logistics (Supabase)
-- ESQUEMA: panol / public
-- OBJETIVO: Actualizar vistas de tareas para incluir staff asignado
--           y crear vista analítica de optimización/balance de recursos.
-- ============================================================================

-- 0. Dropear vistas existentes para permitir reordenamiento de columnas
DROP VIEW IF EXISTS public.v_taller_unit_tasks CASCADE;
DROP VIEW IF EXISTS panol.v_taller_unit_tasks CASCADE;

DROP VIEW IF EXISTS public.v_operario_tasks CASCADE;
DROP VIEW IF EXISTS panol.v_operario_tasks CASCADE;

DROP VIEW IF EXISTS public.v_recursos_operarios CASCADE;
DROP VIEW IF EXISTS panol.v_recursos_operarios CASCADE;

-- 1. Actualizar panol.v_taller_unit_tasks con datos de personal asignado
CREATE VIEW panol.v_taller_unit_tasks AS
SELECT 
    uwo.id AS unit_wo_id,
    uwo.vehicle_type,
    uwo.vehicle_id,
    wo.id AS work_order_id,
    wo.ot_number,
    wo.avg AS progress_percentage,
    wo.status AS wo_status,
    wo.json_format AS task_ids_map,
    wot.id AS task_id,
    wot.task_index,
    wot.sector_task,
    COALESCE(substring(wot.sector_task from '^\[([^\]]+)\]'), 'GENERAL') AS sector,
    trim(regexp_replace(wot.sector_task, '^\[[^\]]+\]\s*', '')) AS description,
    wot.ubicacion,
    wot.operario,
    wot.assigned_staff_id,
    s.name AS assigned_staff_name,
    s.op_code AS assigned_op_code,
    wot.estado AS task_estado,
    wot.porcentaje AS task_porcentaje,
    wot.empezo,
    wot.termino
FROM panol.unit_work_orders uwo
JOIN panol.work_orders wo ON uwo.work_order_id = wo.id
LEFT JOIN panol.work_order_tasks wot ON wot.work_order_id = wo.id
LEFT JOIN panol.staff s ON wot.assigned_staff_id = s.id
WHERE wo.status = 'ACTIVA';

CREATE VIEW public.v_taller_unit_tasks AS 
SELECT * FROM panol.v_taller_unit_tasks;

-- 2. Actualizar panol.v_operario_tasks con datos de personal asignado
CREATE VIEW panol.v_operario_tasks AS
SELECT 
    wot.id AS task_id,
    wot.work_order_id,
    wo.ot_number,
    uwo.vehicle_type,
    uwo.vehicle_id,
    wot.task_index,
    wot.sector_task,
    wot.ubicacion,
    wot.operario,
    wot.assigned_staff_id,
    s.name AS assigned_staff_name,
    s.op_code AS assigned_op_code,
    wot.estado,
    wot.porcentaje,
    wot.empezo,
    wot.termino
FROM panol.work_order_tasks wot
JOIN panol.work_orders wo ON wot.work_order_id = wo.id
JOIN panol.unit_work_orders uwo ON uwo.work_order_id = wo.id
LEFT JOIN panol.staff s ON wot.assigned_staff_id = s.id;

CREATE VIEW public.v_operario_tasks AS 
SELECT * FROM panol.v_operario_tasks;

-- 3. Crear vista analítica panol.v_recursos_operarios (Optimización y Balance de Carga)
CREATE VIEW panol.v_recursos_operarios AS
SELECT 
    s.id AS staff_id,
    s.op_code,
    s.name AS staff_name,
    s.role,
    s.default_boxes,
    s.is_active,
    COUNT(wot.id) FILTER (WHERE wot.estado = 'EN_CURSO') AS tareas_en_curso,
    COUNT(wot.id) FILTER (WHERE wot.estado = 'PENDIENTE') AS tareas_pendientes,
    COUNT(wot.id) FILTER (WHERE wot.estado IN ('TERMINADO', 'COMPLETADA') AND wot.termino >= CURRENT_DATE) AS tareas_terminadas_hoy,
    MAX(wot.ubicacion) FILTER (WHERE wot.estado = 'EN_CURSO') AS box_actual
FROM panol.staff s
LEFT JOIN panol.work_order_tasks wot ON wot.assigned_staff_id = s.id
WHERE s.is_active = true
GROUP BY s.id, s.op_code, s.name, s.role, s.default_boxes, s.is_active;

CREATE VIEW public.v_recursos_operarios AS 
SELECT * FROM panol.v_recursos_operarios;
