-- ============================================================================
-- PROYECTO: rsvajuxihvmpmrmlcbul (Supabase)
-- ESQUEMA: panol
-- OBJETIVO: Migración a Opción A
--   1. unit_work_orders: agregar tractor_id y semi_id como FKs directas (ON DELETE CASCADE)
--      con CHECK (num_nonnulls(tractor_id, semi_id) = 1) y sincronización automática.
--   2. work_orders: eliminar definitivamente la columna JSONB (json_format).
--   3. work_order_tasks: asociar con worker_id (FK a panol.staff) y eliminar operario/assigned_staff_id.
--   4. Simplificar trigger sync_work_order_avg sin borrado ni JSONB.
--   5. Recrear capa de vistas completa.
-- ============================================================================

-- A. DROP DE VISTAS DEPENDIENTES EN CASCADA
DROP VIEW IF EXISTS public.panol_work_order_tasks CASCADE;
DROP VIEW IF EXISTS public.panol_work_orders CASCADE;
DROP VIEW IF EXISTS public.v_taller_unit_tasks CASCADE;
DROP VIEW IF EXISTS panol.v_taller_unit_tasks CASCADE;
DROP VIEW IF EXISTS public.v_operario_tasks CASCADE;
DROP VIEW IF EXISTS panol.v_operario_tasks CASCADE;
DROP VIEW IF EXISTS public.v_ots_anteriores CASCADE;
DROP VIEW IF EXISTS panol.v_ots_anteriores CASCADE;
DROP VIEW IF EXISTS public.v_boxes_en_vivo CASCADE;
DROP VIEW IF EXISTS panol.v_boxes_en_vivo CASCADE;
DROP VIEW IF EXISTS public.v_recursos_operarios CASCADE;
DROP VIEW IF EXISTS panol.v_recursos_operarios CASCADE;
DROP VIEW IF EXISTS public.v_kpis_taller_diario CASCADE;
DROP VIEW IF EXISTS panol.v_kpis_taller_diario CASCADE;
DROP VIEW IF EXISTS public.v_tablero_coordinacion CASCADE;
DROP VIEW IF EXISTS panol.v_tablero_coordinacion CASCADE;
DROP VIEW IF EXISTS public.v_flota_busqueda CASCADE;
DROP VIEW IF EXISTS panol.v_flota_busqueda CASCADE;
DROP VIEW IF EXISTS public.v_staff_holds CASCADE;
DROP VIEW IF EXISTS panol.v_staff_holds CASCADE;
DROP VIEW IF EXISTS public.v_monitor_pedidos CASCADE;
DROP VIEW IF EXISTS panol.v_monitor_pedidos CASCADE;

-- B. TABLA: panol.work_orders (Eliminar json_format)
ALTER TABLE panol.work_orders DROP COLUMN IF EXISTS json_format CASCADE;

-- C. TABLA: panol.unit_work_orders (FKs a tractores y semis)
ALTER TABLE panol.unit_work_orders 
    ADD COLUMN IF NOT EXISTS tractor_id UUID REFERENCES public.tractores(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS semi_id UUID REFERENCES public.semis(id) ON DELETE CASCADE;

-- Poblar tractor_id y semi_id desde vehicle_id existente
UPDATE panol.unit_work_orders
SET tractor_id = vehicle_id
WHERE vehicle_type = 'TRACTOR' AND tractor_id IS NULL;

UPDATE panol.unit_work_orders
SET semi_id = vehicle_id
WHERE vehicle_type = 'SEMI' AND semi_id IS NULL;

-- Restricción de exclusividad: exactamente un vehículo asociado
ALTER TABLE panol.unit_work_orders
    DROP CONSTRAINT IF EXISTS chk_unit_vehicle_exclusive,
    ADD CONSTRAINT chk_unit_vehicle_exclusive CHECK (num_nonnulls(tractor_id, semi_id) = 1);

CREATE INDEX IF NOT EXISTS idx_uwo_tractor ON panol.unit_work_orders(tractor_id);
CREATE INDEX IF NOT EXISTS idx_uwo_semi ON panol.unit_work_orders(semi_id);

-- Función y trigger de sincronización bidireccional para compatibilidad total
CREATE OR REPLACE FUNCTION panol.sync_unit_work_orders_vehicle_fields()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.tractor_id IS NOT NULL THEN
        NEW.vehicle_type := 'TRACTOR';
        NEW.vehicle_id := NEW.tractor_id;
    ELSIF NEW.semi_id IS NOT NULL THEN
        NEW.vehicle_type := 'SEMI';
        NEW.vehicle_id := NEW.semi_id;
    ELSIF NEW.vehicle_type = 'TRACTOR' AND NEW.vehicle_id IS NOT NULL THEN
        NEW.tractor_id := NEW.vehicle_id;
    ELSIF NEW.vehicle_type = 'SEMI' AND NEW.vehicle_id IS NOT NULL THEN
        NEW.semi_id := NEW.vehicle_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_uwo_vehicles ON panol.unit_work_orders;
CREATE TRIGGER trg_sync_uwo_vehicles
BEFORE INSERT OR UPDATE ON panol.unit_work_orders
FOR EACH ROW EXECUTE FUNCTION panol.sync_unit_work_orders_vehicle_fields();

-- D. TABLA: panol.work_order_tasks (worker_id FK)
ALTER TABLE panol.work_order_tasks
    ADD COLUMN IF NOT EXISTS worker_id UUID REFERENCES panol.staff(id) ON DELETE SET NULL;

-- Migrar datos de assigned_staff_id a worker_id si existían
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'panol' AND table_name = 'work_order_tasks' AND column_name = 'assigned_staff_id'
    ) THEN
        UPDATE panol.work_order_tasks SET worker_id = assigned_staff_id WHERE worker_id IS NULL;
        ALTER TABLE panol.work_order_tasks DROP COLUMN assigned_staff_id CASCADE;
    END IF;
END $$;

ALTER TABLE panol.work_order_tasks DROP COLUMN IF EXISTS operario CASCADE;

CREATE INDEX IF NOT EXISTS idx_wot_worker_id ON panol.work_order_tasks(worker_id);

-- E. TRIGGERS Y FUNCIONES LIMPIAS (SIN JSONB NI BORRADOS DE TAREAS)
DROP FUNCTION IF EXISTS panol.consolidate_completed_work_order(UUID);
CREATE OR REPLACE FUNCTION panol.consolidate_completed_work_order(target_wo_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE panol.work_orders
    SET 
        status = 'COMPLETADA',
        avg = 100.00,
        close_date = COALESCE(close_date, NOW()),
        updated_at = NOW()
    WHERE id = target_wo_id;
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
BEGIN
    target_wo_id := COALESCE(NEW.work_order_id, OLD.work_order_id);
    IF target_wo_id IS NULL THEN RETURN NEW; END IF;

    SELECT status INTO order_status FROM panol.work_orders WHERE id = target_wo_id;
    IF order_status = 'COMPLETADA' THEN
        RETURN NEW;
    END IF;

    SELECT 
        COALESCE(ROUND(AVG(porcentaje), 2), 0.00),
        COUNT(*),
        COUNT(*) FILTER (WHERE porcentaje = 100.00 OR estado IN ('TERMINADO', 'COMPLETADA'))
    INTO computed_avg, total_tasks, done_tasks
    FROM panol.work_order_tasks
    WHERE work_order_id = target_wo_id;

    IF total_tasks > 0 AND done_tasks = total_tasks THEN
        UPDATE panol.work_orders
        SET 
            status = 'COMPLETADA',
            avg = 100.00,
            close_date = COALESCE(close_date, NOW()),
            updated_at = NOW()
        WHERE id = target_wo_id;
    ELSIF total_tasks > 0 THEN
        UPDATE panol.work_orders
        SET 
            avg = computed_avg,
            updated_at = NOW()
        WHERE id = target_wo_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wot_sync_avg ON panol.work_order_tasks;
CREATE TRIGGER trg_wot_sync_avg
AFTER INSERT OR UPDATE OF porcentaje, estado, empezo, termino OR DELETE ON panol.work_order_tasks
FOR EACH ROW EXECUTE FUNCTION panol.sync_work_order_avg();

-- F. RECREACIÓN DE TODAS LAS VISTAS
CREATE OR REPLACE VIEW public.panol_work_orders AS 
SELECT * FROM panol.work_orders;

CREATE OR REPLACE VIEW public.panol_work_order_tasks AS 
SELECT * FROM panol.work_order_tasks;

-- 1. Vista General de Taller (Timeline y tareas vivas)
CREATE OR REPLACE VIEW panol.v_taller_unit_tasks AS
SELECT 
    uwo.id AS unit_wo_id,
    uwo.vehicle_type,
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
    uwo.vehicle_type,
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
    uwo.vehicle_type,
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

-- 5. Vista Recursos Operarios
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
LEFT JOIN panol.work_order_tasks wot ON wot.worker_id = s.id
GROUP BY s.id, s.op_code, s.name, s.role, s.default_boxes, s.auth_user_id;

-- 6. Vista KPIs Taller Diario
CREATE OR REPLACE VIEW panol.v_kpis_taller_diario AS
SELECT 
    CURRENT_DATE AS fecha,
    count(id) FILTER (WHERE estado = 'EN_CURSO') AS tareas_en_curso,
    count(id) FILTER (WHERE estado IN ('TERMINADO', 'COMPLETADA') AND termino >= CURRENT_DATE) AS tareas_cerradas_hoy,
    round(avg(EXTRACT(EPOCH FROM (termino - empezo)) / 60) FILTER (WHERE termino >= CURRENT_DATE), 1) AS promedio_minutos_por_tarea,
    count(DISTINCT worker_id) FILTER (WHERE empezo >= CURRENT_DATE) AS operarios_activos_hoy
FROM panol.work_order_tasks wot;

-- 7. Vista Tablero de Coordinación
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

-- 8. Vista Búsqueda de Flota
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

-- 9. Vista Staff Holds
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

-- 10. Vista Monitor de Pedidos
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
LEFT JOIN public.unidades u ON o.unidad_id = u.id
LEFT JOIN public.tractores t ON COALESCE(o.tractor_id, u.tractor_id) = t.id
LEFT JOIN public.semis sem ON COALESCE(o.semi_id, u.semi_id) = sem.id
LEFT JOIN panol.order_items oi ON oi.order_id = o.id
LEFT JOIN panol.items i ON oi.item_id = i.id
GROUP BY 
    o.id, o.order_number, o.req_code, o.order_type, o.parent_order_id, o.created_at, 
    o.status, o.box_number, o.notes, o.ot_number, s.id, s.name, s.op_code, sp.id, 
    sp.name, wo.id, wo.ot_number, o.tractor_id, o.semi_id, o.unidad_id, u.tractor_id, 
    u.semi_id, t.patente, t.marca, sem.patente, sem.marca;

-- Public aliases
CREATE OR REPLACE VIEW public.v_taller_unit_tasks AS SELECT * FROM panol.v_taller_unit_tasks;
CREATE OR REPLACE VIEW public.v_operario_tasks AS SELECT * FROM panol.v_operario_tasks;
CREATE OR REPLACE VIEW public.v_ots_anteriores AS SELECT * FROM panol.v_ots_anteriores;
CREATE OR REPLACE VIEW public.v_boxes_en_vivo AS SELECT * FROM panol.v_boxes_en_vivo;
CREATE OR REPLACE VIEW public.v_recursos_operarios AS SELECT * FROM panol.v_recursos_operarios;
CREATE OR REPLACE VIEW public.v_kpis_taller_diario AS SELECT * FROM panol.v_kpis_taller_diario;
CREATE OR REPLACE VIEW public.v_tablero_coordinacion AS SELECT * FROM panol.v_tablero_coordinacion;
CREATE OR REPLACE VIEW public.v_flota_busqueda AS SELECT * FROM panol.v_flota_busqueda;
CREATE OR REPLACE VIEW public.v_staff_holds AS SELECT * FROM panol.v_staff_holds;
CREATE OR REPLACE VIEW public.v_monitor_pedidos AS SELECT * FROM panol.v_monitor_pedidos;
