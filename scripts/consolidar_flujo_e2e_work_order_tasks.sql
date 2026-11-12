-- ============================================================================
-- 🚀 MIGRACIÓN CANÓNICA: CONSOLIDACIÓN END-TO-END DE WORK_ORDER_TASKS,
--    COLD STORAGE, SUPERCEDE, CÁLCULO DE PROMEDIOS E ÍNDICES ÚNICOS
-- Fecha: 11 de Noviembre de 2026
-- ============================================================================

BEGIN;

-- 1. ESTRUCTURA Y COLUMNAS EN panol.staff_holds
ALTER TABLE panol.staff_holds
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tractor_work_order_id UUID REFERENCES panol.work_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS semi_work_order_id UUID REFERENCES panol.work_orders(id) ON DELETE SET NULL;

-- 2. ÍNDICES ÚNICOS ESTRICTOS EN panol.unit_work_orders (DATOS IRREPETIBLES POR VEHÍCULO)
-- Dropear restricciones anteriores si existen
ALTER TABLE panol.unit_work_orders DROP CONSTRAINT IF EXISTS unique_unit_work_order_tractor;
ALTER TABLE panol.unit_work_orders DROP CONSTRAINT IF EXISTS unique_unit_work_order_semi;
DROP INDEX IF EXISTS panol.uq_uwo_active_tractor;
DROP INDEX IF EXISTS panol.uq_uwo_active_semi;

CREATE UNIQUE INDEX uq_uwo_active_tractor 
ON panol.unit_work_orders(tractor_id) WHERE tractor_id IS NOT NULL;

CREATE UNIQUE INDEX uq_uwo_active_semi 
ON panol.unit_work_orders(semi_id) WHERE semi_id IS NOT NULL;

-- 3. FUNCIÓN RPC: review_staff_hold
CREATE OR REPLACE FUNCTION public.review_staff_hold(p_hold_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE panol.staff_holds
    SET reviewed_at = NOW()
    WHERE id = p_hold_id;
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.review_staff_hold(UUID) TO anon, authenticated, service_role;

-- 4. FUNCIÓN CANÓNICA: consolidate_work_order_to_cold
CREATE OR REPLACE FUNCTION panol.consolidate_work_order_to_cold(
    target_wo_id UUID,
    p_status TEXT DEFAULT 'COMPLETADA'
)
RETURNS JSONB AS $$
DECLARE
    tasks_json JSONB;
    v_tractor_id UUID;
    v_semi_id UUID;
    v_ot_number TEXT;
    v_entry_date TIMESTAMPTZ;
    v_avg NUMERIC(5,2);
    v_total_tasks INT;
    v_done_tasks INT;
BEGIN
    -- 4.1. Obtener datos de la cabecera
    SELECT ot_number, entry_date INTO v_ot_number, v_entry_date
    FROM panol.work_orders WHERE id = target_wo_id;
    
    IF v_ot_number IS NULL THEN
        SELECT tasks_snapshot INTO tasks_json FROM panol.work_orders_cold WHERE id = target_wo_id;
        RETURN COALESCE(tasks_json, '[]'::jsonb);
    END IF;

    -- 4.2. Obtener tractor y semi asociados desde unit_work_orders
    SELECT tractor_id INTO v_tractor_id
    FROM panol.unit_work_orders WHERE work_order_id = target_wo_id AND tractor_id IS NOT NULL LIMIT 1;

    SELECT semi_id INTO v_semi_id
    FROM panol.unit_work_orders WHERE work_order_id = target_wo_id AND semi_id IS NOT NULL LIMIT 1;

    -- 4.3. Calcular métricas reales de tareas
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE termino IS NOT NULL OR estado IN ('TERMINADO', 'COMPLETADA') OR porcentaje = 100.00),
        COALESCE(ROUND(AVG(porcentaje), 2), 0.00)
    INTO v_total_tasks, v_done_tasks, v_avg
    FROM panol.work_order_tasks
    WHERE work_order_id = target_wo_id;

    IF p_status = 'COMPLETADA' THEN
        v_avg := 100.00;
    ELSIF v_total_tasks > 0 AND v_done_tasks > 0 THEN
        v_avg := ROUND((v_done_tasks::numeric / v_total_tasks::numeric) * 100.00, 2);
    END IF;

    -- 4.4. Serializar tareas en snapshot JSONB canónico
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', wot.id,
            'taskIndex', wot.task_index,
            'task_index', wot.task_index,
            'rubro', COALESCE(
                CASE 
                    WHEN position(']' in wot.sector_task) > 0 THEN NULLIF(split_part(split_part(wot.sector_task, ']', 1), '[', 2), '')
                    ELSE 'GENERAL'
                END, 
                'GENERAL'
            ),
            'desc', CASE 
                WHEN position(']' in wot.sector_task) > 0 THEN trim(substring(wot.sector_task from position(']' in wot.sector_task) + 1))
                ELSE trim(COALESCE(wot.sector_task, ''))
            END,
            'descripcion', CASE 
                WHEN position(']' in wot.sector_task) > 0 THEN trim(substring(wot.sector_task from position(']' in wot.sector_task) + 1))
                ELSE trim(COALESCE(wot.sector_task, ''))
            END,
            'sectorTask', wot.sector_task,
            'box', COALESCE(wot.ubicacion, ''),
            'ubicacion', COALESCE(wot.ubicacion, ''),
            'operario', COALESCE(s.name, ''),
            'worker_id', wot.worker_id,
            'opCode', COALESCE(s.op_code, ''),
            'asignado', to_char(wot.asignado, 'DD/MM HH24:MI'),
            'empezo', to_char(wot.empezo, 'DD/MM HH24:MI'),
            'termino', to_char(wot.termino, 'DD/MM HH24:MI'),
            'estado', wot.estado,
            'porcentaje', wot.porcentaje,
            'isTerminado', (wot.termino IS NOT NULL OR wot.estado IN ('TERMINADO', 'COMPLETADA') OR wot.porcentaje = 100.00)
        ) ORDER BY wot.task_index ASC
    ) INTO tasks_json
    FROM panol.work_order_tasks wot
    LEFT JOIN panol.staff s ON wot.worker_id = s.id
    WHERE wot.work_order_id = target_wo_id;

    tasks_json := COALESCE(tasks_json, '[]'::jsonb);

    -- 4.5. Insertar o actualizar en panol.work_orders_cold
    INSERT INTO panol.work_orders_cold (
        id, ot_number, tractor_id, semi_id, status, avg, entry_date, close_date, tasks_snapshot, created_at
    ) VALUES (
        target_wo_id, v_ot_number, v_tractor_id, v_semi_id, p_status, v_avg, v_entry_date, NOW(), tasks_json, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        tractor_id = COALESCE(EXCLUDED.tractor_id, panol.work_orders_cold.tractor_id),
        semi_id = COALESCE(EXCLUDED.semi_id, panol.work_orders_cold.semi_id),
        status = EXCLUDED.status,
        avg = EXCLUDED.avg,
        close_date = EXCLUDED.close_date,
        tasks_snapshot = EXCLUDED.tasks_snapshot;

    -- 4.6. Purgar staff_holds asociados
    DELETE FROM panol.staff_holds
    WHERE tractor_work_order_id = target_wo_id OR semi_work_order_id = target_wo_id;

    -- 4.7. Eliminar de la tabla caliente panol.work_orders (cascada limpia work_order_tasks y unit_work_orders)
    DELETE FROM panol.work_orders
    WHERE id = target_wo_id;

    RETURN tasks_json;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. TRIGGER & FUNCIÓN: sync_work_order_avg (EMPAQUETADO INMEDIATO AL 100%)
CREATE OR REPLACE FUNCTION panol.sync_work_order_avg()
RETURNS TRIGGER AS $$
DECLARE
    target_wo_id UUID;
    computed_avg NUMERIC(5,2);
    total_tasks INT;
    done_tasks INT;
BEGIN
    target_wo_id := COALESCE(NEW.work_order_id, OLD.work_order_id);
    IF target_wo_id IS NULL THEN RETURN NEW; END IF;

    IF NOT EXISTS (SELECT 1 FROM panol.work_orders WHERE id = target_wo_id) THEN
        RETURN NEW;
    END IF;

    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE termino IS NOT NULL OR estado IN ('TERMINADO', 'COMPLETADA') OR porcentaje = 100.00),
        COALESCE(ROUND(AVG(porcentaje), 2), 0.00)
    INTO total_tasks, done_tasks, computed_avg
    FROM panol.work_order_tasks
    WHERE work_order_id = target_wo_id;

    -- Regla 1: Al llegar al 100% (todas las tareas terminadas), transferir a cold storage
    IF total_tasks > 0 AND done_tasks = total_tasks THEN
        PERFORM panol.consolidate_work_order_to_cold(target_wo_id, 'COMPLETADA');
    ELSIF total_tasks > 0 THEN
        UPDATE panol.work_orders
        SET 
            avg = computed_avg,
            updated_at = NOW()
        WHERE id = target_wo_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_wot_sync_avg ON panol.work_order_tasks;
CREATE TRIGGER trg_wot_sync_avg
AFTER INSERT OR UPDATE OF porcentaje, estado, empezo, termino OR DELETE ON panol.work_order_tasks
FOR EACH ROW EXECUTE FUNCTION panol.sync_work_order_avg();

-- 6. TRIGGER & FUNCIÓN: handle_supersede_active_ot (SUPERSEDE A INCOMPLETA ANTE NUEVA OT)
CREATE OR REPLACE FUNCTION panol.handle_supersede_active_ot()
RETURNS TRIGGER AS $$
DECLARE
    new_wo_status TEXT;
    prev_wo RECORD;
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
    END IF;

    SELECT status INTO new_wo_status FROM panol.work_orders WHERE id = NEW.work_order_id;
    IF new_wo_status IS NULL OR new_wo_status != 'ACTIVA' THEN
        RETURN NEW;
    END IF;

    -- Buscar órdenes previas activas vinculadas al mismo tractor o semi
    FOR prev_wo IN 
        SELECT DISTINCT uwo.work_order_id as id
        FROM panol.unit_work_orders uwo
        JOIN panol.work_orders wo ON uwo.work_order_id = wo.id
        WHERE wo.status = 'ACTIVA'
          AND wo.id != NEW.work_order_id
          AND (
            (NEW.tractor_id IS NOT NULL AND uwo.tractor_id = NEW.tractor_id)
            OR
            (NEW.semi_id IS NOT NULL AND uwo.semi_id = NEW.semi_id)
          )
    LOOP
        -- La orden previa pasa a Cold Storage como INCOMPLETA y se purga de work_orders
        PERFORM panol.consolidate_work_order_to_cold(prev_wo.id, 'INCOMPLETA');
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_uwo_supersede_active_ot ON panol.unit_work_orders;
CREATE TRIGGER trg_uwo_supersede_active_ot
BEFORE INSERT OR UPDATE ON panol.unit_work_orders
FOR EACH ROW EXECUTE FUNCTION panol.handle_supersede_active_ot();

-- 7. ACTUALIZAR RPC: coord_assign_task (CON IMPRESIÓN EN STAFF_HOLDS Y ESTAMPA DE ASIGNADO)
CREATE OR REPLACE FUNCTION public.coord_assign_task(
    p_task_id UUID,
    p_ubicacion TEXT DEFAULT NULL,
    p_worker_id UUID DEFAULT NULL,
    p_update_ubicacion BOOLEAN DEFAULT FALSE,
    p_update_worker BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
    v_target_task panol.work_order_tasks%ROWTYPE;
    v_updated panol.work_order_tasks%ROWTYPE;
    v_has_resource BOOLEAN;
    
    v_wo_id UUID;
    v_wo_ot TEXT;
    v_tr_id UUID;
    v_sm_id UUID;
    v_pair_tr_id UUID;
    v_pair_sm_id UUID;
    v_tr_wo_id UUID;
    v_sm_wo_id UUID;
    v_tr_ot TEXT;
    v_sm_ot TEXT;
    v_tr_plate TEXT;
    v_sm_plate TEXT;
    v_existing_hold_id UUID;
BEGIN
    SELECT * INTO v_target_task FROM panol.work_order_tasks WHERE id = p_task_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Tarea no encontrada');
    END IF;

    v_has_resource := (p_update_ubicacion AND COALESCE(TRIM(p_ubicacion), '') <> '')
                   OR (p_update_worker AND p_worker_id IS NOT NULL);

    UPDATE panol.work_order_tasks wot
    SET
        ubicacion = CASE
            WHEN p_update_ubicacion THEN NULLIF(TRIM(COALESCE(p_ubicacion, '')), '')
            ELSE wot.ubicacion
        END,
        worker_id = CASE
            WHEN p_update_worker THEN p_worker_id
            ELSE wot.worker_id
        END,
        asignado = CASE
            WHEN v_has_resource AND wot.asignado IS NULL THEN NOW()
            ELSE wot.asignado
        END,
        updated_at = NOW()
    WHERE wot.id = p_task_id
    RETURNING * INTO v_updated;

    -- IMPRESIÓN EN panol.staff_holds AL ASIGNAR OPERARIO
    IF p_update_worker AND p_worker_id IS NOT NULL THEN
        v_wo_id := v_updated.work_order_id;
        
        SELECT ot_number INTO v_wo_ot FROM panol.work_orders WHERE id = v_wo_id;
        
        SELECT tractor_id, semi_id INTO v_tr_id, v_sm_id
        FROM panol.unit_work_orders
        WHERE work_order_id = v_wo_id
        LIMIT 1;

        IF v_tr_id IS NOT NULL THEN
            v_tr_wo_id := v_wo_id;
            v_tr_ot := v_wo_ot;
            SELECT patente INTO v_tr_plate FROM public.tractores WHERE id = v_tr_id;

            SELECT semi_id INTO v_pair_sm_id FROM public.unidades WHERE tractor_id = v_tr_id LIMIT 1;
            IF v_pair_sm_id IS NOT NULL THEN
                v_sm_id := v_pair_sm_id;
                SELECT patente INTO v_sm_plate FROM public.semis WHERE id = v_sm_id;
                SELECT uwo2.work_order_id, wo2.ot_number INTO v_sm_wo_id, v_sm_ot
                FROM panol.unit_work_orders uwo2
                JOIN panol.work_orders wo2 ON wo2.id = uwo2.work_order_id
                WHERE uwo2.semi_id = v_sm_id AND wo2.status = 'ACTIVA'
                ORDER BY wo2.entry_date DESC LIMIT 1;
            END IF;
        ELSIF v_sm_id IS NOT NULL THEN
            v_sm_wo_id := v_wo_id;
            v_sm_ot := v_wo_ot;
            SELECT patente INTO v_sm_plate FROM public.semis WHERE id = v_sm_id;

            SELECT tractor_id INTO v_pair_tr_id FROM public.unidades WHERE semi_id = v_sm_id LIMIT 1;
            IF v_pair_tr_id IS NOT NULL THEN
                v_tr_id := v_pair_tr_id;
                SELECT patente INTO v_tr_plate FROM public.tractores WHERE id = v_tr_id;
                SELECT uwo2.work_order_id, wo2.ot_number INTO v_tr_wo_id, v_tr_ot
                FROM panol.unit_work_orders uwo2
                JOIN panol.work_orders wo2 ON wo2.id = uwo2.work_order_id
                WHERE uwo2.tractor_id = v_tr_id AND wo2.status = 'ACTIVA'
                ORDER BY wo2.entry_date DESC LIMIT 1;
            END IF;
        END IF;

        -- Buscar hold existente para este operario
        SELECT id INTO v_existing_hold_id
        FROM panol.staff_holds
        WHERE staff_id = p_worker_id
          AND (
            (v_tr_id IS NOT NULL AND tractor_id = v_tr_id)
            OR (v_sm_id IS NOT NULL AND semi_id = v_sm_id)
            OR (v_wo_id IS NOT NULL AND (tractor_work_order_id = v_wo_id OR semi_work_order_id = v_wo_id))
          )
        LIMIT 1;

        IF v_existing_hold_id IS NOT NULL THEN
            UPDATE panol.staff_holds
            SET
                tractor_work_order_id = COALESCE(v_tr_wo_id, tractor_work_order_id),
                semi_work_order_id = COALESCE(v_sm_wo_id, semi_work_order_id),
                ot_number = COALESCE(v_tr_ot, ot_number),
                semi_ot = COALESCE(v_sm_ot, semi_ot),
                tractor_plate = COALESCE(v_tr_plate, tractor_plate),
                semi_plate = COALESCE(v_sm_plate, semi_plate),
                source = 'COORDINACION',
                reviewed_at = NULL
            WHERE id = v_existing_hold_id;
        ELSE
            INSERT INTO panol.staff_holds (
                staff_id,
                work_order_id,
                tractor_work_order_id,
                semi_work_order_id,
                tractor_id,
                semi_id,
                ot_number,
                semi_ot,
                tractor_plate,
                semi_plate,
                source,
                reviewed_at
            ) VALUES (
                p_worker_id,
                v_wo_id,
                v_tr_wo_id,
                v_sm_wo_id,
                v_tr_id,
                v_sm_id,
                v_tr_ot,
                v_sm_ot,
                v_tr_plate,
                v_sm_plate,
                'COORDINACION',
                NULL
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'task_id', v_updated.id,
        'ubicacion', v_updated.ubicacion,
        'worker_id', v_updated.worker_id,
        'asignado', v_updated.asignado
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.coord_assign_task(UUID, TEXT, UUID, BOOLEAN, BOOLEAN) TO anon, authenticated, service_role;

-- 8. VISTA: panol.v_staff_holds & public.v_staff_holds
DROP VIEW IF EXISTS public.v_staff_holds CASCADE;
DROP VIEW IF EXISTS panol.v_staff_holds CASCADE;

CREATE OR REPLACE VIEW panol.v_staff_holds AS
SELECT 
    sh.id AS hold_id,
    sh.id,
    sh.staff_id,
    s.op_code,
    s.name AS staff_name,
    sh.tractor_work_order_id,
    sh.semi_work_order_id,
    COALESCE(wo_tr.ot_number, sh.ot_number, '') AS tractor_ot,
    COALESCE(wo_sm.ot_number, sh.semi_ot, '') AS semi_ot,
    wo_tr.status AS tractor_ot_status,
    wo_sm.status AS semi_ot_status,
    sh.tractor_id,
    COALESCE(t.patente, sh.tractor_plate, '') AS tractor_plate,
    COALESCE(t.marca, '') AS tractor_brand,
    sh.semi_id,
    COALESCE(sm.patente, sh.semi_plate, '') AS semi_plate,
    COALESCE(sm.marca, '') AS semi_brand,
    COALESCE(sh.source, 'MANUAL') AS source,
    sh.reviewed_at,
    (COALESCE(sh.source, 'MANUAL') = 'COORDINACION' AND sh.reviewed_at IS NULL) AS is_coord_assigned,
    sh.created_at
FROM panol.staff_holds sh
JOIN panol.staff s ON sh.staff_id = s.id
LEFT JOIN panol.work_orders wo_tr ON sh.tractor_work_order_id = wo_tr.id
LEFT JOIN panol.work_orders wo_sm ON sh.semi_work_order_id = wo_sm.id
LEFT JOIN public.tractores t ON sh.tractor_id = t.id
LEFT JOIN public.semis sm ON sh.semi_id = sm.id;

CREATE OR REPLACE VIEW public.v_staff_holds AS SELECT * FROM panol.v_staff_holds;

ALTER VIEW panol.v_staff_holds SET (security_invoker = true);
ALTER VIEW public.v_staff_holds SET (security_invoker = true);
GRANT SELECT ON panol.v_staff_holds TO anon, authenticated, service_role;
GRANT SELECT ON public.v_staff_holds TO anon, authenticated, service_role;

-- 9. PERMISOS Y NOTIFICACIÓN A POSTGREST
GRANT SELECT, INSERT, UPDATE, DELETE ON panol.work_orders TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON panol.work_order_tasks TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON panol.unit_work_orders TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON panol.work_orders_cold TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON panol.staff_holds TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

COMMIT;
