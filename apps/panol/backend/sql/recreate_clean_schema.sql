-- ============================================================================
-- PROYECTO: rsvajuxihvmpmrmlcbul (Supabase)
-- ESQUEMA: panol
-- OBJETIVO: Reset limpio completo de las 3 tablas (unit_work_orders, work_orders, work_order_tasks)
--           Eliminar datos y columnas residuales.
--           Eliminar definitivamente 'sector' y 'description' (solo queda 'sector_task').
-- ============================================================================

-- 0. Limpiar referencias foráneas previas antes del DROP
UPDATE panol.orders SET work_order_id = NULL WHERE work_order_id IS NOT NULL;
UPDATE panol.staff_holds SET work_order_id = NULL WHERE work_order_id IS NOT NULL;

-- 1. ELIMINAR TABLAS PREVIAS CON CASCADE
DROP TABLE IF EXISTS panol.work_order_tasks CASCADE;
DROP TABLE IF EXISTS panol.unit_work_orders CASCADE;
DROP TABLE IF EXISTS panol.work_orders CASCADE;

-- 2. CREAR TABLA: panol.work_orders (Nivel Intermedio - Cabecera OT)
CREATE TABLE panol.work_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ot_number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'ACTIVA' CHECK (status IN ('ACTIVA', 'COMPLETADA', 'CANCELADA')),
    avg NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    json_format JSONB DEFAULT '[]'::jsonb, -- Array JSON con IDs de tareas (en activa) o Snapshot consolidado (en completada)
    entry_date TIMESTAMPTZ DEFAULT NOW(),
    close_date TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wo_ot_number ON panol.work_orders(ot_number);
CREATE INDEX idx_wo_status ON panol.work_orders(status);
CREATE INDEX idx_wo_close_date ON panol.work_orders(close_date);

-- 3. CREAR TABLA: panol.unit_work_orders (Nivel Superior - Vínculo Unidad - OT)
CREATE TABLE panol.unit_work_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('TRACTOR', 'SEMI')),
    vehicle_id UUID NOT NULL,
    work_order_id UUID NOT NULL REFERENCES panol.work_orders(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_unit_work_order UNIQUE (vehicle_id, work_order_id)
);

CREATE INDEX idx_uwo_vehicle ON panol.unit_work_orders(vehicle_id);
CREATE INDEX idx_uwo_work_order ON panol.unit_work_orders(work_order_id);

-- 4. CREAR TABLA: panol.work_order_tasks (Nivel Inferior - Tareas Vivas)
-- NOTA: 'sector' y 'description' SE HAN ELIMINADO DEFINITIVAMENTE.
CREATE TABLE panol.work_order_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES panol.work_orders(id) ON DELETE CASCADE,
    task_index INTEGER NOT NULL,
    sector_task TEXT NOT NULL,           -- e.g. '[Carroceria] Colocar Imagen Puertas'
    ubicacion TEXT NULL,                 -- Box / Ubicación
    operario TEXT NULL,                  -- Nombre del operario
    assigned_staff_id UUID NULL REFERENCES panol.staff(id) ON DELETE SET NULL,
    asignado TIMESTAMPTZ NULL,
    empezo TIMESTAMPTZ NULL,
    termino TIMESTAMPTZ NULL,
    estado TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'EN_CURSO', 'TERMINADO', 'COMPLETADA', 'DESCARTADA')),
    porcentaje NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_task_index_per_order UNIQUE (work_order_id, task_index)
);

CREATE INDEX idx_wot_wo_id ON panol.work_order_tasks(work_order_id);
CREATE INDEX idx_wot_estado ON panol.work_order_tasks(estado);

-- 5. RE-VINCULAR RESTRICCIONES FORÁNEAS EXTERNAS
ALTER TABLE panol.orders
    DROP CONSTRAINT IF EXISTS fk_orders_work_order,
    ADD CONSTRAINT fk_orders_work_order FOREIGN KEY (work_order_id) REFERENCES panol.work_orders(id) ON DELETE SET NULL;

ALTER TABLE panol.staff_holds
    DROP CONSTRAINT IF EXISTS fk_staff_holds_work_order,
    ADD CONSTRAINT fk_staff_holds_work_order FOREIGN KEY (work_order_id) REFERENCES panol.work_orders(id) ON DELETE CASCADE;

-- 6. FUNCIÓN ATÓMICA DE CONSOLIDACIÓN AL 100%
CREATE OR REPLACE FUNCTION panol.consolidate_completed_work_order(target_wo_id UUID)
RETURNS JSONB AS $$
DECLARE
    tasks_json JSONB;
BEGIN
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', wot.id,
            'task_index', wot.task_index,
            'sector_task', wot.sector_task,
            'rubro', COALESCE(substring(wot.sector_task from '^\[([^\]]+)\]'), 'GENERAL'),
            'desc', trim(regexp_replace(wot.sector_task, '^\[[^\]]+\]\s*', '')),
            'descripcion', trim(regexp_replace(wot.sector_task, '^\[[^\]]+\]\s*', '')),
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

    UPDATE panol.work_orders
    SET 
        status = 'COMPLETADA',
        avg = 100.00,
        close_date = COALESCE(close_date, NOW()),
        json_format = COALESCE(tasks_json, '[]'::jsonb),
        updated_at = NOW()
    WHERE id = target_wo_id;

    DELETE FROM panol.work_order_tasks
    WHERE work_order_id = target_wo_id;

    RETURN COALESCE(tasks_json, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. TRIGGER DE RECÁLCULO AUTOMÁTICO DE 'avg' Y MAPEO DE 'json_format'
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
        PERFORM panol.consolidate_completed_work_order(target_wo_id);
    ELSIF total_tasks > 0 THEN
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

DROP TRIGGER IF EXISTS trg_wot_sync_avg ON panol.work_order_tasks;
CREATE TRIGGER trg_wot_sync_avg
AFTER INSERT OR UPDATE OF porcentaje, estado, empezo, termino OR DELETE ON panol.work_order_tasks
FOR EACH ROW EXECUTE FUNCTION panol.sync_work_order_avg();

-- 8. RECREAR VISTAS DE CONVENIENCIA EN public
CREATE OR REPLACE VIEW public.panol_work_orders AS 
SELECT * FROM panol.work_orders;

CREATE OR REPLACE VIEW public.panol_work_order_tasks AS 
SELECT * FROM panol.work_order_tasks;

-- 9. CAPA DE VISTAS SQL POR ROL / PERFIL DE USUARIO
-- Vista 1: Vista General de Taller (Timeline y tareas vivas)
CREATE OR REPLACE VIEW panol.v_taller_unit_tasks AS
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
    wot.estado AS task_estado,
    wot.porcentaje AS task_porcentaje,
    wot.empezo,
    wot.termino
FROM panol.unit_work_orders uwo
JOIN panol.work_orders wo ON uwo.work_order_id = wo.id
LEFT JOIN panol.work_order_tasks wot ON wot.work_order_id = wo.id
WHERE wo.status = 'ACTIVA';

-- Vista 2: Vista Específica para Operario / Box
CREATE OR REPLACE VIEW panol.v_operario_tasks AS
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
    wot.estado,
    wot.porcentaje,
    wot.empezo,
    wot.termino
FROM panol.work_order_tasks wot
JOIN panol.work_orders wo ON wot.work_order_id = wo.id
JOIN panol.unit_work_orders uwo ON uwo.work_order_id = wo.id;

-- Vista 3: Vista de Órdenes Históricas (OTs Anteriores Front)
CREATE OR REPLACE VIEW panol.v_ots_anteriores AS
SELECT 
    uwo.vehicle_type,
    uwo.vehicle_id,
    wo.id AS work_order_id,
    wo.ot_number,
    wo.avg,
    wo.status,
    to_char(wo.close_date, 'DD/MM') AS date_label,
    wo.close_date,
    wo.json_format
FROM panol.unit_work_orders uwo
JOIN panol.work_orders wo ON uwo.work_order_id = wo.id
WHERE wo.status = 'COMPLETADA' AND wo.close_date >= NOW() - INTERVAL '180 days';

CREATE OR REPLACE VIEW public.v_taller_unit_tasks AS SELECT * FROM panol.v_taller_unit_tasks;
CREATE OR REPLACE VIEW public.v_operario_tasks AS SELECT * FROM panol.v_operario_tasks;
CREATE OR REPLACE VIEW public.v_ots_anteriores AS SELECT * FROM panol.v_ots_anteriores;

-- 10. RECREAR OTRAS VISTAS DEPENDIENTES DEL ESQUEMA
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
