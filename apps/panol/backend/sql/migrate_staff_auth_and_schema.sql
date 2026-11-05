-- ============================================================================
-- PROYECTO: rsvajuxihvmpmrmlcbul (Supabase)
-- ESQUEMAS: panol / public
-- OBJETIVO: 
--   1. Eliminar 'app_access' e 'is_active' de panol.staff (rezagos de Google Sheets).
--   2. Vincular panol.staff con auth.users de Supabase (auth_user_id).
--   3. Recrear panol.v_recursos_operarios actualizada.
--   4. Crear nuevas vistas de alto rendimiento:
--      - panol.v_boxes_en_vivo
--      - panol.v_pedidos_canjes_consolidada
--      - panol.v_kpis_taller_diario
-- ============================================================================

-- 1. ELIMINAR COLUMNAS RESIDUALES DE GOOGLE SHEETS EN panol.staff
ALTER TABLE panol.staff DROP COLUMN IF EXISTS app_access CASCADE;
ALTER TABLE panol.staff DROP COLUMN IF EXISTS is_active CASCADE;

-- 2. VINCULAR panol.staff CON Supabase Auth (auth.users)
ALTER TABLE panol.staff ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_staff_auth_user_id ON panol.staff(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_staff_op_code ON panol.staff(op_code);

-- 3. RECREAR VISTA: panol.v_recursos_operarios (SIN filtro is_active)
DROP VIEW IF EXISTS public.v_recursos_operarios CASCADE;
DROP VIEW IF EXISTS panol.v_recursos_operarios CASCADE;

CREATE OR REPLACE VIEW panol.v_recursos_operarios AS
SELECT 
    s.id AS staff_id,
    s.op_code,
    s.name AS staff_name,
    s.role,
    s.default_boxes,
    s.auth_user_id,
    count(wot.id) FILTER (WHERE wot.estado = 'EN_CURSO') AS tareas_en_curso,
    count(wot.id) FILTER (WHERE wot.estado = 'PENDIENTE') AS tareas_pendientes,
    count(wot.id) FILTER (WHERE wot.estado IN ('TERMINADO', 'COMPLETADA') AND wot.termino >= CURRENT_DATE) AS tareas_terminadas_hoy,
    max(wot.ubicacion) FILTER (WHERE wot.estado = 'EN_CURSO') AS box_actual
FROM panol.staff s
LEFT JOIN panol.work_order_tasks wot ON wot.assigned_staff_id = s.id
GROUP BY s.id, s.op_code, s.name, s.role, s.default_boxes, s.auth_user_id;

CREATE OR REPLACE VIEW public.v_recursos_operarios AS 
SELECT * FROM panol.v_recursos_operarios;

-- 4. NUEVA VISTA 1: panol.v_boxes_en_vivo (Monitor Operativo de Bahías en Tiempo Real)
DROP VIEW IF EXISTS public.v_boxes_en_vivo CASCADE;
DROP VIEW IF EXISTS panol.v_boxes_en_vivo CASCADE;

CREATE OR REPLACE VIEW panol.v_boxes_en_vivo AS
SELECT 
    wot.ubicacion AS box_number,
    uwo.vehicle_type,
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
    s.name AS operario_nombre,
    s.op_code AS legajo,
    wot.empezo,
    ROUND(EXTRACT(EPOCH FROM (NOW() - wot.empezo)) / 60) AS minutos_en_curso
FROM panol.work_order_tasks wot
JOIN panol.work_orders wo ON wot.work_order_id = wo.id
JOIN panol.unit_work_orders uwo ON uwo.work_order_id = wo.id
LEFT JOIN panol.staff s ON wot.assigned_staff_id = s.id
LEFT JOIN public.tractores t ON (uwo.vehicle_type = 'TRACTOR' AND uwo.vehicle_id = t.id)
LEFT JOIN public.semis sm ON (uwo.vehicle_type = 'SEMI' AND uwo.vehicle_id = sm.id)
WHERE wot.estado = 'EN_CURSO' AND wot.ubicacion IS NOT NULL;

CREATE OR REPLACE VIEW public.v_boxes_en_vivo AS 
SELECT * FROM panol.v_boxes_en_vivo;

-- 5. NUEVA VISTA 2: panol.v_pedidos_canjes_consolidada (Control de Repuestos con Canje Pendiente)
DROP VIEW IF EXISTS public.v_pedidos_canjes_consolidada CASCADE;
DROP VIEW IF EXISTS panol.v_pedidos_canjes_consolidada CASCADE;

CREATE OR REPLACE VIEW panol.v_pedidos_canjes_consolidada AS
SELECT 
    o.id AS order_id,
    o.order_number,
    o.req_code,
    o.box_number,
    s.id AS mechanic_id,
    s.op_code AS legajo_mecanico,
    s.name AS nombre_mecanico,
    i.id AS item_id,
    i.item_code,
    i.name AS item_name,
    oi.id AS order_item_id,
    oi.quantity AS cantidad_solicitada,
    COALESCE(oi.delivered_qty, 0::numeric) AS cantidad_entregada,
    COALESCE(oi.returned_qty, 0::numeric) AS cantidad_devuelta,
    (COALESCE(oi.delivered_qty, 0::numeric) - COALESCE(oi.returned_qty, 0::numeric)) AS saldo_pendiente_canje,
    oi.exchange_status,
    oi.status AS item_status,
    o.created_at AS fecha_pedido
FROM panol.orders o
JOIN panol.order_items oi ON oi.order_id = o.id
JOIN panol.items i ON oi.item_id = i.id
LEFT JOIN panol.staff s ON o.mechanic_id = s.id
WHERE i.requires_exchange = true 
  AND oi.status IN ('LISTO', 'ENTREGADO', 'DEVOLUCION PENDIENTE')
  AND (COALESCE(oi.delivered_qty, 0::numeric) > COALESCE(oi.returned_qty, 0::numeric));

CREATE OR REPLACE VIEW public.v_pedidos_canjes_consolidada AS 
SELECT * FROM panol.v_pedidos_canjes_consolidada;

-- 6. NUEVA VISTA 3: panol.v_kpis_taller_diario (Productividad y Métricas de Rendimiento Diario)
DROP VIEW IF EXISTS public.v_kpis_taller_diario CASCADE;
DROP VIEW IF EXISTS panol.v_kpis_taller_diario CASCADE;

CREATE OR REPLACE VIEW panol.v_kpis_taller_diario AS
SELECT 
    CURRENT_DATE AS fecha,
    COUNT(wot.id) FILTER (WHERE wot.estado = 'EN_CURSO') AS tareas_en_curso,
    COUNT(wot.id) FILTER (WHERE wot.estado IN ('TERMINADO', 'COMPLETADA') AND wot.termino >= CURRENT_DATE) AS tareas_cerradas_hoy,
    ROUND(AVG(EXTRACT(EPOCH FROM (wot.termino - wot.empezo)) / 60) FILTER (WHERE wot.termino >= CURRENT_DATE), 1) AS promedio_minutos_por_tarea,
    COUNT(DISTINCT wot.assigned_staff_id) FILTER (WHERE wot.empezo >= CURRENT_DATE) AS operarios_activos_hoy
FROM panol.work_order_tasks wot;

CREATE OR REPLACE VIEW public.v_kpis_taller_diario AS 
SELECT * FROM panol.v_kpis_taller_diario;

-- 7. RECREAR VISTA panol_staff EN public PARA SUPABASE JS
CREATE OR REPLACE VIEW public.panol_staff AS 
SELECT * FROM panol.staff;
