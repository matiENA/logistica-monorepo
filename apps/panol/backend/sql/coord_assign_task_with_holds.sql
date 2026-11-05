-- ============================================================================
-- MIGRACIÓN: Impresión en staff_holds desde Coordinación y Detección de Origen
-- ============================================================================

-- 1. Agregar columnas a panol.staff_holds si no existen
ALTER TABLE panol.staff_holds
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Actualizar vistas panol.v_staff_holds y public.v_staff_holds
DROP VIEW IF EXISTS public.v_staff_holds CASCADE;
DROP VIEW IF EXISTS panol.v_staff_holds CASCADE;

CREATE OR REPLACE VIEW panol.v_staff_holds AS
SELECT 
    sh.id AS hold_id,
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

CREATE OR REPLACE VIEW public.v_staff_holds AS 
SELECT * FROM panol.v_staff_holds;

-- 3. Función RPC para marcar una unidad en puesto como revisada
CREATE OR REPLACE FUNCTION public.review_staff_hold(p_hold_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE panol.staff_holds
    SET reviewed_at = NOW()
    WHERE id = p_hold_id;
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Actualizar función RPC coord_assign_task con impresión en staff_holds
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
    v_old_worker_id UUID;
    v_has_resource BOOLEAN;
    
    -- Variables para impresión en staff_holds
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

    v_old_worker_id := v_target_task.worker_id;
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

    -- IMPRESIÓN EN panol.staff_holds
    -- A) Si se asigna un operario (p_update_worker = true y p_worker_id IS NOT NULL)
    IF p_update_worker AND p_worker_id IS NOT NULL THEN
        v_wo_id := v_updated.work_order_id;
        
        -- Obtener OT
        SELECT ot_number INTO v_wo_ot FROM panol.work_orders WHERE id = v_wo_id;
        
        -- Obtener vehículo asociado a la orden
        SELECT tractor_id, semi_id INTO v_tr_id, v_sm_id
        FROM panol.unit_work_orders
        WHERE work_order_id = v_wo_id
        LIMIT 1;

        -- Resolver si es tractor o semi y acoplar par desde public.unidades si existe
        IF v_tr_id IS NOT NULL THEN
            v_tr_wo_id := v_wo_id;
            v_tr_ot := v_wo_ot;
            SELECT patente INTO v_tr_plate FROM public.tractores WHERE id = v_tr_id;

            -- Buscar semi acoplado en unidades
            SELECT semi_id INTO v_pair_sm_id FROM public.unidades WHERE tractor_id = v_tr_id LIMIT 1;
            IF v_pair_sm_id IS NOT NULL THEN
                v_sm_id := v_pair_sm_id;
                SELECT patente INTO v_sm_plate FROM public.semis WHERE id = v_sm_id;
                -- Buscar OT activa del semi
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

            -- Buscar tractor acoplado en unidades
            SELECT tractor_id INTO v_pair_tr_id FROM public.unidades WHERE semi_id = v_sm_id LIMIT 1;
            IF v_pair_tr_id IS NOT NULL THEN
                v_tr_id := v_pair_tr_id;
                SELECT patente INTO v_tr_plate FROM public.tractores WHERE id = v_tr_id;
                -- Buscar OT activa del tractor
                SELECT uwo2.work_order_id, wo2.ot_number INTO v_tr_wo_id, v_tr_ot
                FROM panol.unit_work_orders uwo2
                JOIN panol.work_orders wo2 ON wo2.id = uwo2.work_order_id
                WHERE uwo2.tractor_id = v_tr_id AND wo2.status = 'ACTIVA'
                ORDER BY wo2.entry_date DESC LIMIT 1;
            END IF;
        END IF;

        -- Verificar si ya existe un hold para este operario con este vehículo
        SELECT id INTO v_existing_hold_id
        FROM panol.staff_holds
        WHERE staff_id = p_worker_id
          AND (
            (v_tr_id IS NOT NULL AND tractor_id = v_tr_id)
            OR
            (v_sm_id IS NOT NULL AND semi_id = v_sm_id)
          )
        LIMIT 1;

        IF v_existing_hold_id IS NOT NULL THEN
            UPDATE panol.staff_holds
            SET
                tractor_id = COALESCE(tractor_id, v_tr_id),
                semi_id = COALESCE(semi_id, v_sm_id),
                tractor_work_order_id = COALESCE(v_tr_wo_id, tractor_work_order_id),
                semi_work_order_id = COALESCE(v_sm_wo_id, semi_work_order_id),
                ot_number = COALESCE(v_tr_ot, ot_number),
                semi_ot = COALESCE(v_sm_ot, semi_ot),
                tractor_plate = COALESCE(v_tr_plate, tractor_plate),
                semi_plate = COALESCE(v_sm_plate, semi_plate)
            WHERE id = v_existing_hold_id;
        ELSE
            INSERT INTO panol.staff_holds (
                staff_id,
                tractor_id,
                semi_id,
                tractor_work_order_id,
                semi_work_order_id,
                ot_number,
                semi_ot,
                tractor_plate,
                semi_plate,
                source,
                reviewed_at
            ) VALUES (
                p_worker_id,
                v_tr_id,
                v_sm_id,
                v_tr_wo_id,
                v_sm_wo_id,
                v_tr_ot,
                v_sm_ot,
                v_tr_plate,
                v_sm_plate,
                'COORDINACION',
                NULL
            );
        END IF;
    END IF;

    -- B) Si se desasigna el operario anterior o cambia de operario
    IF p_update_worker AND v_old_worker_id IS NOT NULL AND (p_worker_id IS NULL OR p_worker_id <> v_old_worker_id) THEN
        -- Si al operario anterior ya no le queda ninguna otra tarea activa en esta orden
        IF NOT EXISTS (
            SELECT 1 FROM panol.work_order_tasks
            WHERE work_order_id = v_updated.work_order_id
              AND worker_id = v_old_worker_id
              AND id <> p_task_id
        ) THEN
            -- Eliminar el hold de coordinación si no fue cargado manualmente y no quedan tareas
            DELETE FROM panol.staff_holds
            WHERE staff_id = v_old_worker_id
              AND source = 'COORDINACION'
              AND reviewed_at IS NULL
              AND (tractor_work_order_id = v_updated.work_order_id OR semi_work_order_id = v_updated.work_order_id);
        END IF;
    END IF;

    RETURN to_jsonb(v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Permisos
GRANT EXECUTE ON FUNCTION public.review_staff_hold(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coord_assign_task(UUID, TEXT, UUID, BOOLEAN, BOOLEAN) TO anon, authenticated;
GRANT SELECT ON panol.v_staff_holds TO anon, authenticated;
GRANT SELECT ON public.v_staff_holds TO anon, authenticated;
