-- ============================================================================
-- PROYECTO: rsvajuxihvmpmrmlcbul (Supabase)
-- ESQUEMA: panol
-- OBJETIVO: Reingeniería completa en 3 niveles (unit_work_orders, work_orders, work_order_tasks)
--          + Eliminación de v_taller_tareas_activas CASCADE
--          + Capa de Vistas por Rol/Perfil
--          + Automatización de avg, mapeo json_format y consolidación 100%
-- ============================================================================

-- 0. ELIMINAR VISTA PREVIA SOLICITADA POR EL USUARIO
DROP VIEW IF EXISTS panol.v_taller_tareas_activas CASCADE;
DROP VIEW IF EXISTS public.v_taller_tareas_activas CASCADE;

-- 1. TABLA SUPERIOR (NIVEL 1): panol.unit_work_orders
-- Vínculo directo y desacoplado entre el vehículo (tractor o semi) y la orden de trabajo
CREATE TABLE IF NOT EXISTS panol.unit_work_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('TRACTOR', 'SEMI')),
    vehicle_id UUID NOT NULL,
    work_order_id UUID NOT NULL REFERENCES panol.work_orders(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_unit_work_order UNIQUE (vehicle_id, work_order_id)
);

CREATE INDEX IF NOT EXISTS idx_uwo_vehicle ON panol.unit_work_orders(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_uwo_work_order ON panol.unit_work_orders(work_order_id);

-- 2. TABLA INTERMEDIA (NIVEL 2): panol.work_orders
-- Asegurar columnas requeridas: ot_number, avg, json_format (mapa de IDs), status, close_date
ALTER TABLE panol.work_orders 
    ADD COLUMN IF NOT EXISTS avg NUMERIC(5,2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS json_format JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS close_date TIMESTAMPTZ;

-- Asegurar que unidad_id sea NULLABLE
ALTER TABLE panol.work_orders 
    ALTER COLUMN unidad_id DROP NOT NULL;

-- Sincronizar datos históricos si existían
UPDATE panol.work_orders 
SET avg = progress_percentage 
WHERE (avg IS NULL OR avg = 0.00) AND progress_percentage > 0;

UPDATE panol.work_orders 
SET json_format = tasks_snapshot 
WHERE (json_format IS NULL OR json_format = '[]'::jsonb) AND tasks_snapshot IS NOT NULL AND tasks_snapshot != '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_wo_ot_number ON panol.work_orders(ot_number);
CREATE INDEX IF NOT EXISTS idx_wo_status ON panol.work_orders(status);
CREATE INDEX IF NOT EXISTS idx_wo_close_date ON panol.work_orders(close_date);

-- 3. TABLA INFERIOR (NIVEL 3): panol.work_order_tasks
-- Asegurar columnas de ejecución atómica: sector_task, ubicacion, operario, asignado, empezo, termino, estado, porcentaje
ALTER TABLE panol.work_order_tasks
    ADD COLUMN IF NOT EXISTS sector_task TEXT,
    ADD COLUMN IF NOT EXISTS ubicacion TEXT,
    ADD COLUMN IF NOT EXISTS operario TEXT,
    ADD COLUMN IF NOT EXISTS asignado TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS empezo TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS termino TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'PENDIENTE',
    ADD COLUMN IF NOT EXISTS porcentaje NUMERIC(5,2) DEFAULT 0.00;

-- Sincronizar columnas preexistentes
UPDATE panol.work_order_tasks 
SET sector_task = '[' || COALESCE(sector, 'GENERAL') || '] ' || COALESCE(description, '') 
WHERE sector_task IS NULL;

UPDATE panol.work_order_tasks 
SET ubicacion = assigned_box 
WHERE ubicacion IS NULL AND assigned_box IS NOT NULL;

UPDATE panol.work_order_tasks 
SET empezo = started_at 
WHERE empezo IS NULL AND started_at IS NOT NULL;

UPDATE panol.work_order_tasks 
SET termino = finished_at 
WHERE termino IS NULL AND finished_at IS NOT NULL;

UPDATE panol.work_order_tasks 
SET estado = status 
WHERE estado IS NULL AND status IS NOT NULL;

UPDATE panol.work_order_tasks 
SET porcentaje = CASE 
    WHEN estado IN ('TERMINADO', 'COMPLETADA') OR termino IS NOT NULL THEN 100.00 
    WHEN estado = 'EN_CURSO' OR empezo IS NOT NULL THEN 50.00 
    ELSE 0.00 
END
WHERE porcentaje IS NULL OR porcentaje = 0.00;

CREATE INDEX IF NOT EXISTS idx_wot_wo_id ON panol.work_order_tasks(work_order_id);
CREATE INDEX IF NOT EXISTS idx_wot_estado ON panol.work_order_tasks(estado);

-- 4. POBLAR unit_work_orders CON DATOS HISTÓRICOS DE work_orders
-- Si existían tractores o semis asignados en work_orders, crear los enlaces en unit_work_orders
INSERT INTO panol.unit_work_orders (vehicle_type, vehicle_id, work_order_id)
SELECT 'TRACTOR', tractor_id, id 
FROM panol.work_orders 
WHERE tractor_id IS NOT NULL 
ON CONFLICT (vehicle_id, work_order_id) DO NOTHING;

INSERT INTO panol.unit_work_orders (vehicle_type, vehicle_id, work_order_id)
SELECT 'SEMI', semi_id, id 
FROM panol.work_orders 
WHERE semi_id IS NOT NULL 
ON CONFLICT (vehicle_id, work_order_id) DO NOTHING;

-- 5. FUNCIÓN ATÓMICA DE CONSOLIDACIÓN AL 100%
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
        progress_percentage = 100.00,
        close_date = COALESCE(close_date, NOW()),
        json_format = COALESCE(tasks_json, '[]'::jsonb),
        tasks_snapshot = COALESCE(tasks_json, '[]'::jsonb),
        updated_at = NOW()
    WHERE id = target_wo_id;

    -- Purgar tareas activas de la tabla caliente
    DELETE FROM panol.work_order_tasks
    WHERE work_order_id = target_wo_id;

    RETURN COALESCE(tasks_json, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. TRIGGER DE RECÁLCULO AUTOMÁTICO DE 'avg' Y MAPEO DE 'json_format'
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
            progress_percentage = computed_avg,
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

-- 7. CAPA DE VISTAS SQL POR ROL / PERFIL DE USUARIO
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
    wot.sector,
    wot.description,
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

-- Exponer vistas en esquema public para acceso directo de clientes si aplica
CREATE OR REPLACE VIEW public.v_taller_unit_tasks AS SELECT * FROM panol.v_taller_unit_tasks;
CREATE OR REPLACE VIEW public.v_operario_tasks AS SELECT * FROM panol.v_operario_tasks;
CREATE OR REPLACE VIEW public.v_ots_anteriores AS SELECT * FROM panol.v_ots_anteriores;
