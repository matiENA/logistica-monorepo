-- ============================================================================
-- PROYECTO: rsvajuxihvmpmrmlcbul (Supabase)
-- ESQUEMA: panol
-- OBJETIVO: Eliminar columnas legacy no declaradas en la última modificación (CASCADE)
-- ============================================================================

-- 1. ELIMINAR COLUMNAS LEGACY DE panol.work_order_tasks (CASCADE)
ALTER TABLE panol.work_order_tasks
    DROP COLUMN IF EXISTS assigned_box CASCADE,
    DROP COLUMN IF EXISTS status CASCADE,
    DROP COLUMN IF EXISTS assigned_at CASCADE,
    DROP COLUMN IF EXISTS started_at CASCADE,
    DROP COLUMN IF EXISTS finished_at CASCADE,
    DROP COLUMN IF EXISTS metadata CASCADE,
    DROP COLUMN IF EXISTS estimated_hours CASCADE,
    DROP COLUMN IF EXISTS actual_hours CASCADE;

-- 2. ELIMINAR COLUMNAS LEGACY DE panol.work_orders (CASCADE)
ALTER TABLE panol.work_orders
    DROP COLUMN IF EXISTS unidad_id CASCADE,
    DROP COLUMN IF EXISTS applied_to CASCADE,
    DROP COLUMN IF EXISTS progress_percentage CASCADE,
    DROP COLUMN IF EXISTS coordination_meta CASCADE,
    DROP COLUMN IF EXISTS source_channel CASCADE,
    DROP COLUMN IF EXISTS priority CASCADE,
    DROP COLUMN IF EXISTS notes CASCADE,
    DROP COLUMN IF EXISTS mechanic_id CASCADE,
    DROP COLUMN IF EXISTS tractor_id CASCADE,
    DROP COLUMN IF EXISTS semi_id CASCADE,
    DROP COLUMN IF EXISTS patente CASCADE,
    DROP COLUMN IF EXISTS tasks_snapshot CASCADE;

-- 3. ACTUALIZAR FUNCIONES Y TRIGGERS PARA REMOVER REFERENCIAS A COLUMNAS LEGACY
CREATE OR REPLACE FUNCTION panol.consolidate_completed_work_order(target_wo_id UUID)
RETURNS JSONB AS $$
DECLARE
    tasks_json JSONB;
BEGIN
    -- Empaquetar todas las tareas en JSONB ordenado
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', wot.id,
            'task_index', wot.task_index,
            'sector_task', wot.sector_task,
            'rubro', wot.sector,
            'desc', wot.description,
            'descripcion', wot.description,
            'ubicacion', wot.ubicacion,
            'box', wot.ubicacion,
            'operario', COALESCE(wot.operario, ''),
            'empezo', to_char(wot.empezo, 'DD/MM HH24:MI'),
            'termino', to_char(wot.termino, 'DD/MM HH24:MI'),
            'estado', wot.estado,
            'porcentaje', 100.00,
            'isTerminado', true
        ) ORDER BY wot.task_index ASC
    ) INTO tasks_json
    FROM panol.work_order_tasks wot
    WHERE wot.work_order_id = target_wo_id;

    -- Actualizar cabecera de la orden
    UPDATE panol.work_orders
    SET 
        status = 'COMPLETADA',
        avg = 100.00,
        close_date = COALESCE(close_date, NOW()),
        json_format = COALESCE(tasks_json, '[]'::jsonb),
        updated_at = NOW()
    WHERE id = target_wo_id;

    -- Purgar tareas activas de la tabla caliente
    DELETE FROM panol.work_order_tasks
    WHERE work_order_id = target_wo_id;

    RETURN COALESCE(tasks_json, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION panol.sync_work_order_avg()
RETURNS TRIGGER AS $$
DECLARE
    target_wo_id UUID;
    order_status TEXT;
    computed_avg NUMERIC(5,2);
    total_tasks INT;
    done_tasks INT;
    task_ids_arr JSONB;
BEGIN
    target_wo_id := COALESCE(NEW.work_order_id, OLD.work_order_id);
    IF target_wo_id IS NULL THEN RETURN NEW; END IF;

    -- Si la orden ya está completada, no sobreescribir con 0
    SELECT status INTO order_status FROM panol.work_orders WHERE id = target_wo_id;
    IF order_status = 'COMPLETADA' THEN
        RETURN NEW;
    END IF;

    SELECT 
        COALESCE(ROUND(AVG(porcentaje), 2), 0.00),
        COUNT(*),
        COUNT(*) FILTER (WHERE porcentaje = 100.00 OR estado IN ('TERMINADO', 'COMPLETADA')),
        COALESCE(jsonb_agg(id ORDER BY task_index ASC), '[]'::jsonb)
    INTO computed_avg, total_tasks, done_tasks, task_ids_arr
    FROM panol.work_order_tasks
    WHERE work_order_id = target_wo_id;

    IF total_tasks > 0 AND done_tasks = total_tasks THEN
        -- Si todas las tareas están al 100%, consolidar automáticamente
        PERFORM panol.consolidate_completed_work_order(target_wo_id);
    ELSIF total_tasks > 0 THEN
        -- Actualizar avg y mantener json_format con las IDs como vía/mapeo para app taller
        UPDATE panol.work_orders
        SET 
            avg = computed_avg,
            json_format = task_ids_arr,
            updated_at = NOW()
        WHERE id = target_wo_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. RECREAR VISTAS DE CONVENIENCIA EN public
CREATE OR REPLACE VIEW public.panol_work_orders AS 
SELECT * FROM panol.work_orders;

CREATE OR REPLACE VIEW public.panol_work_order_tasks AS 
SELECT * FROM panol.work_order_tasks;

-- 5. RECREAR VISTAS ADAPTADAS AL MODELO DE 3 NIVELES (unit_work_orders)
-- A) panol.v_staff_holds
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
LEFT JOIN panol.unit_work_orders uwo_tr ON uwo_tr.work_order_id = wo.id AND uwo_tr.vehicle_type = 'TRACTOR'
LEFT JOIN panol.unit_work_orders uwo_sm ON uwo_sm.work_order_id = wo.id AND uwo_sm.vehicle_type = 'SEMI'
LEFT JOIN tractores t ON COALESCE(uwo_tr.vehicle_id, sh.tractor_id) = t.id
LEFT JOIN semis sm ON COALESCE(uwo_sm.vehicle_id, sh.semi_id) = sm.id;

CREATE OR REPLACE VIEW public.v_staff_holds AS SELECT * FROM panol.v_staff_holds;

-- B) panol.v_monitor_pedidos
CREATE OR REPLACE VIEW panol.v_monitor_pedidos AS
SELECT 
    o.id AS order_id,
    o.order_number,
    o.req_code,
    o.order_type,
    o.parent_order_id,
    o.created_at,
    o.status AS order_status,
    COALESCE(o.box_number, '01'::text) AS box_number,
    o.notes AS order_notes,
    s.id AS mechanic_id,
    COALESCE(s.name, 'MECÁNICO'::text) AS mechanic_name,
    s.op_code AS mechanic_op_code,
    sp.id AS panol_staff_id,
    sp.name AS panol_staff_name,
    wo.id AS work_order_id,
    COALESCE(o.ot_number, wo.ot_number, substring(o.notes from 'OT(?:\s*Original)?:\s*([0-9]+)'), ''::text) AS ot_number,
    COALESCE(o.tractor_id, u.tractor_id) AS tractor_id,
    COALESCE(o.semi_id, u.semi_id) AS semi_id,
    o.unidad_id,
    COALESCE(t.patente, ''::text) AS tractor,
    COALESCE(t.marca, ''::text) AS marca_tr,
    COALESCE(sem.patente, ''::text) AS semi,
    COALESCE(sem.marca, ''::text) AS marca_semi,
    COALESCE(jsonb_agg(
        jsonb_build_object(
            'order_item_id', oi.id, 
            'item_id', i.id, 
            'name', i.name, 
            'code', i.item_code, 
            'qty', oi.quantity, 
            'delivered_qty', COALESCE(oi.delivered_qty, 0::numeric), 
            'returned_qty', COALESCE(oi.returned_qty, 0::numeric), 
            'location', i.location, 
            'requires_exchange', i.requires_exchange, 
            'status', oi.status, 
            'exchange_status', oi.exchange_status, 
            'notes', oi.notes, 
            'return_notes', oi.return_notes
        ) ORDER BY oi.created_at
    ) FILTER (WHERE oi.id IS NOT NULL), '[]'::jsonb) AS items
FROM panol.orders o
LEFT JOIN panol.staff s ON o.mechanic_id = s.id
LEFT JOIN panol.staff sp ON o.panol_staff_id = sp.id
LEFT JOIN panol.work_orders wo ON o.work_order_id = wo.id
LEFT JOIN unidades u ON o.unidad_id = u.id
LEFT JOIN tractores t ON COALESCE(o.tractor_id, u.tractor_id) = t.id
LEFT JOIN semis sem ON COALESCE(o.semi_id, u.semi_id) = sem.id
LEFT JOIN panol.order_items oi ON oi.order_id = o.id
LEFT JOIN panol.items i ON oi.item_id = i.id
GROUP BY 
    o.id, o.order_number, o.req_code, o.order_type, o.parent_order_id, 
    o.created_at, o.status, o.box_number, o.notes, o.ot_number, 
    s.id, s.name, s.op_code, sp.id, sp.name, wo.id, wo.ot_number, 
    o.tractor_id, o.semi_id, o.unidad_id, u.tractor_id, u.semi_id, 
    t.patente, t.marca, sem.patente, sem.marca;

CREATE OR REPLACE VIEW public.v_monitor_pedidos AS SELECT * FROM panol.v_monitor_pedidos;

-- C) panol.v_flota_busqueda
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
FROM unidades u
LEFT JOIN tractores t ON u.tractor_id = t.id
LEFT JOIN semis s ON u.semi_id = s.id
LEFT JOIN servicios_unidades su ON u.servicio_id = su.id
LEFT JOIN LATERAL (
    SELECT wo.id AS work_order_id, wo.ot_number, wo.status
    FROM panol.unit_work_orders uwo
    JOIN panol.work_orders wo ON uwo.work_order_id = wo.id
    WHERE uwo.vehicle_id = t.id AND uwo.vehicle_type = 'TRACTOR' AND wo.status = 'ACTIVA'
    ORDER BY wo.created_at DESC
    LIMIT 1
) wot ON true
LEFT JOIN LATERAL (
    SELECT wo.id AS work_order_id, wo.ot_number, wo.status
    FROM panol.unit_work_orders uwo
    JOIN panol.work_orders wo ON uwo.work_order_id = wo.id
    WHERE uwo.vehicle_id = s.id AND uwo.vehicle_type = 'SEMI' AND wo.status = 'ACTIVA'
    ORDER BY wo.created_at DESC
    LIMIT 1
) wos ON true;

CREATE OR REPLACE VIEW public.v_flota_busqueda AS SELECT * FROM panol.v_flota_busqueda;

-- D) panol.v_tablero_coordinacion
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
LEFT JOIN tractores t ON uwo.vehicle_type = 'TRACTOR' AND uwo.vehicle_id = t.id
LEFT JOIN semis s ON uwo.vehicle_type = 'SEMI' AND uwo.vehicle_id = s.id
LEFT JOIN unidades u ON (u.tractor_id = t.id OR u.semi_id = s.id)
LEFT JOIN servicios_unidades su ON u.servicio_id = su.id
WHERE wo.status = 'ACTIVA';

CREATE OR REPLACE VIEW public.v_tablero_coordinacion AS SELECT * FROM panol.v_tablero_coordinacion;
