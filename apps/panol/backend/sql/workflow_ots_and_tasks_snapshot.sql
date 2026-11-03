-- ============================================================================
-- PROYECTO: rsvajuxihvmpmrmlcbul (Supabase)
-- ESQUEMA: panol
-- TABLA CABECERA (OID 41288): panol.work_orders
-- TABLA TAREAS   (OID 41315): panol.work_order_tasks
-- OBJETIVO: Implementación del Workflow Unificado de OTs y Tareas
--          con Snapshot JSONB para órdenes completadas (100%) y retención 180 días.
-- ============================================================================

-- 1. Asegurar esquema panol
CREATE SCHEMA IF NOT EXISTS panol;

-- 2. Asegurar columnas en panol.work_orders (OID 41288)
--    - patente: Permite asociar OTs directamente por dominio desde Google Sheets (Col D)
--    - tasks_snapshot: Almacena el snapshot binario JSONB de tareas completadas
--    - close_date: Fecha de cierre de la OT (usada para la ventana de 180 días)
ALTER TABLE panol.work_orders 
    ADD COLUMN IF NOT EXISTS patente TEXT,
    ADD COLUMN IF NOT EXISTS tasks_snapshot JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS close_date TIMESTAMPTZ;

-- Asegurar que unidad_id sea NULLABLE (permite registrar tractores o semis desacoplados)
ALTER TABLE panol.work_orders 
    ALTER COLUMN unidad_id DROP NOT NULL;

-- 3. Asegurar estructura de panol.work_order_tasks (OID 41315)
--    Tabla caliente para tareas activas (PENDIENTE, EN_CURSO)
CREATE TABLE IF NOT EXISTS panol.work_order_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id UUID NOT NULL REFERENCES panol.work_orders(id) ON DELETE CASCADE,
    task_index INTEGER NOT NULL,
    sector TEXT NOT NULL,
    description TEXT NOT NULL,
    assigned_staff_id UUID REFERENCES panol.staff(id) ON DELETE SET NULL,
    assigned_box TEXT,
    status TEXT NOT NULL DEFAULT 'PENDIENTE',
    assigned_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_task_per_order UNIQUE (work_order_id, task_index)
);

-- 4. Índices de aceleración para alto rendimiento (< 5ms)
CREATE INDEX IF NOT EXISTS idx_work_orders_ot_number ON panol.work_orders(ot_number);
CREATE INDEX IF NOT EXISTS idx_work_orders_patente ON panol.work_orders(patente);
CREATE INDEX IF NOT EXISTS idx_work_orders_unidad_id ON panol.work_orders(unidad_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON panol.work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_close_date ON panol.work_orders(close_date);

CREATE INDEX IF NOT EXISTS idx_work_order_tasks_wo_id ON panol.work_order_tasks(work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_order_tasks_status ON panol.work_order_tasks(status);
CREATE INDEX IF NOT EXISTS idx_work_order_tasks_staff ON panol.work_order_tasks(assigned_staff_id);

-- 5. Función Atómica de Consolidación al 100%:
--    Empaqueta todas las tareas activas de la OT en un snapshot JSONB ordenado,
--    actualiza la cabecera a 'COMPLETADA' con 100% de progreso y close_date,
--    y purga las filas de panol.work_order_tasks para mantener la tabla caliente vacía (< 100 filas).
CREATE OR REPLACE FUNCTION panol.consolidate_completed_work_order(target_wo_id UUID)
RETURNS JSONB AS $$
DECLARE
    tasks_json JSONB;
BEGIN
    -- Empaquetar todas las tareas de la orden en un array JSONB ordenado
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', wot.id,
            'task_index', wot.task_index,
            'rubro', wot.sector,
            'desc', wot.description,
            'descripcion', wot.description,
            'ubicacion', wot.assigned_box,
            'box', wot.assigned_box,
            'operario', COALESCE(s.name, ''),
            'empezo', to_char(wot.started_at, 'DD/MM HH24:MI'),
            'termino', to_char(wot.finished_at, 'DD/MM HH24:MI'),
            'started_at', wot.started_at,
            'finished_at', wot.finished_at,
            'estado', wot.status,
            'isTerminado', true
        ) ORDER BY wot.task_index ASC
    ) INTO tasks_json
    FROM panol.work_order_tasks wot
    LEFT JOIN panol.staff s ON wot.assigned_staff_id = s.id
    WHERE wot.work_order_id = target_wo_id;

    -- Actualizar cabecera de la orden con el snapshot, estado y fecha de cierre
    UPDATE panol.work_orders
    SET 
        status = 'COMPLETADA',
        progress_percentage = 100.00,
        close_date = COALESCE(close_date, NOW()),
        tasks_snapshot = COALESCE(tasks_json, '[]'::jsonb),
        updated_at = NOW()
    WHERE id = target_wo_id;

    -- Purgar las tareas activas de la tabla caliente para mantenerla ultra-liviana
    DELETE FROM panol.work_order_tasks
    WHERE work_order_id = target_wo_id;

    RETURN COALESCE(tasks_json, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Comentarios de documentación en el catálogo de PostgreSQL
COMMENT ON TABLE panol.work_orders IS 'Cabecera de órdenes de trabajo (OTs). Órdenes activas en status ACTIVA; órdenes al 100% conservan snapshot JSONB en tasks_snapshot.';
COMMENT ON COLUMN panol.work_orders.patente IS 'Dominio/Patente de la unidad (Col D en Google Sheets ots).';
COMMENT ON COLUMN panol.work_orders.tasks_snapshot IS 'Snapshot inmutable JSONB de las tareas completadas al 100%. Se conserva durante 180 días antes del archivado en frío.';
COMMENT ON TABLE panol.work_order_tasks IS 'Tabla caliente de tareas vivas (PENDIENTE, EN_CURSO). Al completarse la OT, se purga hacia tasks_snapshot.';
COMMENT ON FUNCTION panol.consolidate_completed_work_order IS 'Consolida atómicamente una OT completada al 100% en tasks_snapshot JSONB y purga panol.work_order_tasks.';
