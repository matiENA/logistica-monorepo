-- ============================================================================
-- PROYECTO: rsvajuxihvmpmrmlcbul (Supabase)
-- ESQUEMA: panol & public
-- OBJETIVO: Vistas SQL y Realtime para el Tablero Kanban de Coordinación (/coordinacion)
--   1. Habilitar Supabase Realtime sobre panol.work_order_tasks y panol.work_orders
--   2. panol.v_coord_kanban_progreso: pares por public.unidades + promedio flexible + último registro EN_CURSO
--   3. panol.v_coord_kanban_terminados: últimos 7 días de work_orders_cold + work_orders COMPLETADA
--   4. panol.v_coord_unit_tasks: detalle de tareas vivas para el modal desplegable de Coordinación
-- ============================================================================

-- 1. HABILITAR SUPABASE REALTIME EN TABLAS OPERATIVAS DE PAÑOL (IDEMPOTENTE)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'panol' AND tablename = 'work_order_tasks'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE panol.work_order_tasks;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'panol' AND tablename = 'work_orders'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE panol.work_orders;
    END IF;
END $$;

-- 2. LIMPIAR VISTAS PREVIAS SI EXISTEN
DROP VIEW IF EXISTS public.v_coord_unit_tasks CASCADE;
DROP VIEW IF EXISTS panol.v_coord_unit_tasks CASCADE;
DROP VIEW IF EXISTS public.v_coord_kanban_terminados CASCADE;
DROP VIEW IF EXISTS panol.v_coord_kanban_terminados CASCADE;
DROP VIEW IF EXISTS public.v_coord_kanban_progreso CASCADE;
DROP VIEW IF EXISTS panol.v_coord_kanban_progreso CASCADE;

-- ============================================================================
-- 3. VISTA: panol.v_coord_kanban_progreso
-- Agrupa OTs ACTIVAS (con al menos 1 tarea en work_order_tasks) usando
-- public.unidades como índice de acople Tractor + Semi, soportando también
-- vehículos que se trabajan solos.
-- ============================================================================
CREATE OR REPLACE VIEW panol.v_coord_kanban_progreso AS
WITH active_vehicle_ots AS (
    SELECT DISTINCT ON (COALESCE(uwo.tractor_id, uwo.semi_id))
        uwo.id AS uwo_id,
        uwo.tractor_id,
        uwo.semi_id,
        wo.id AS work_order_id,
        wo.ot_number,
        wo.avg,
        wo.entry_date,
        wo.updated_at
    FROM panol.unit_work_orders uwo
    JOIN panol.work_orders wo ON wo.id = uwo.work_order_id
    WHERE wo.status = 'ACTIVA'
      AND EXISTS (
          SELECT 1 FROM panol.work_order_tasks wot
          WHERE wot.work_order_id = wo.id
      )
    ORDER BY COALESCE(uwo.tractor_id, uwo.semi_id), wo.entry_date DESC
),
tractor_ots AS (
    SELECT * FROM active_vehicle_ots WHERE tractor_id IS NOT NULL
),
semi_ots AS (
    SELECT * FROM active_vehicle_ots WHERE semi_id IS NOT NULL
),
paired_from_unidades AS (
    SELECT
        u.id AS unidad_id,
        u.n_ute,
        u.estado AS estado_unidad,
        u.tractor_id AS u_tractor_id,
        u.semi_id AS u_semi_id,
        tr.work_order_id AS tractor_wo_id,
        tr.ot_number AS tractor_ot,
        tr.avg AS tractor_avg,
        tr.entry_date AS tractor_entry_date,
        sm.work_order_id AS semi_wo_id,
        sm.ot_number AS semi_ot,
        sm.avg AS semi_avg,
        sm.entry_date AS semi_entry_date
    FROM public.unidades u
    LEFT JOIN tractor_ots tr ON tr.tractor_id = u.tractor_id
    LEFT JOIN semi_ots sm ON sm.semi_id = u.semi_id
    WHERE tr.work_order_id IS NOT NULL OR sm.work_order_id IS NOT NULL
),
solo_tractors AS (
    SELECT
        NULL::uuid AS unidad_id,
        NULL::text AS n_ute,
        'taller'::text AS estado_unidad,
        tr.tractor_id AS u_tractor_id,
        NULL::uuid AS u_semi_id,
        tr.work_order_id AS tractor_wo_id,
        tr.ot_number AS tractor_ot,
        tr.avg AS tractor_avg,
        tr.entry_date AS tractor_entry_date,
        NULL::uuid AS semi_wo_id,
        NULL::text AS semi_ot,
        NULL::numeric AS semi_avg,
        NULL::timestamptz AS semi_entry_date
    FROM tractor_ots tr
    WHERE NOT EXISTS (
        SELECT 1 FROM public.unidades u WHERE u.tractor_id = tr.tractor_id
    )
),
solo_semis AS (
    SELECT
        NULL::uuid AS unidad_id,
        NULL::text AS n_ute,
        'taller'::text AS estado_unidad,
        NULL::uuid AS u_tractor_id,
        sm.semi_id AS u_semi_id,
        NULL::uuid AS tractor_wo_id,
        NULL::text AS tractor_ot,
        NULL::numeric AS tractor_avg,
        NULL::timestamptz AS tractor_entry_date,
        sm.work_order_id AS semi_wo_id,
        sm.ot_number AS semi_ot,
        sm.avg AS semi_avg,
        sm.entry_date AS semi_entry_date
    FROM semi_ots sm
    WHERE NOT EXISTS (
        SELECT 1 FROM public.unidades u WHERE u.semi_id = sm.semi_id
    )
),
all_cards AS (
    SELECT * FROM paired_from_unidades
    UNION ALL
    SELECT * FROM solo_tractors
    UNION ALL
    SELECT * FROM solo_semis
)
SELECT
    COALESCE(c.unidad_id::text, c.tractor_wo_id::text, c.semi_wo_id::text) AS card_id,
    c.unidad_id,
    c.n_ute,
    c.estado_unidad,
    -- Datos Tractor
    c.u_tractor_id AS tractor_id,
    COALESCE(t.patente, '') AS tractor_plate,
    COALESCE(t.marca, '') AS tractor_brand,
    c.tractor_wo_id,
    COALESCE(c.tractor_ot, '') AS tractor_ot,
    c.tractor_avg,
    -- Datos Semi
    c.u_semi_id AS semi_id,
    COALESCE(s.patente, '') AS semi_plate,
    COALESCE(s.marca, '') AS semi_brand,
    c.semi_wo_id,
    COALESCE(c.semi_ot, '') AS semi_ot,
    c.semi_avg,
    -- Porcentaje promedio no estricto (divide por 2 sólo si ambos tienen OT activa)
    ROUND(
        (COALESCE(c.tractor_avg, 0) + COALESCE(c.semi_avg, 0))::numeric
        / GREATEST(num_nonnulls(c.tractor_wo_id, c.semi_wo_id), 1),
        0
    )::integer AS combined_avg,
    -- Última tarea EN_CURSO (determina columna, operario y default_boxes)
    (latest_active.task_id IS NOT NULL) AS has_active_task,
    latest_active.task_id AS active_task_id,
    latest_active.sector_task AS active_sector_task,
    latest_active.task_sector AS active_task_sector,
    latest_active.ubicacion AS active_task_ubicacion,
    latest_active.empezo AS active_empezo,
    latest_active.worker_id,
    COALESCE(latest_active.worker_name, '') AS worker_name,
    COALESCE(latest_active.worker_op_code, '') AS worker_op_code,
    COALESCE(latest_active.worker_role, '') AS worker_role,
    COALESCE(latest_active.worker_default_boxes, ARRAY[]::text[]) AS worker_default_boxes,
    -- Métricas de tareas del par
    COALESCE(counts.total_tasks, 0)::integer AS total_tasks,
    COALESCE(counts.in_progress_tasks, 0)::integer AS in_progress_tasks,
    COALESCE(counts.completed_tasks, 0)::integer AS completed_tasks,
    GREATEST(c.tractor_entry_date, c.semi_entry_date) AS latest_entry_date
FROM all_cards c
LEFT JOIN public.tractores t ON t.id = c.u_tractor_id
LEFT JOIN public.semis s ON s.id = c.u_semi_id
LEFT JOIN LATERAL (
    SELECT
        wot.id AS task_id,
        wot.sector_task,
        UPPER(TRIM(COALESCE(substring(wot.sector_task from '^\[([^\]]+)\]'), 'GENERAL'))) AS task_sector,
        wot.ubicacion,
        wot.empezo,
        wot.worker_id,
        st.name AS worker_name,
        st.op_code AS worker_op_code,
        UPPER(TRIM(st.role)) AS worker_role,
        st.default_boxes AS worker_default_boxes
    FROM panol.work_order_tasks wot
    LEFT JOIN panol.staff st ON st.id = wot.worker_id
    WHERE wot.work_order_id IN (c.tractor_wo_id, c.semi_wo_id)
      AND wot.estado = 'EN_CURSO'
    ORDER BY wot.empezo DESC NULLS LAST, wot.updated_at DESC
    LIMIT 1
) latest_active ON true
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) AS total_tasks,
        COUNT(*) FILTER (WHERE wot.estado = 'EN_CURSO') AS in_progress_tasks,
        COUNT(*) FILTER (WHERE wot.estado IN ('TERMINADO', 'COMPLETADA') OR wot.porcentaje = 100) AS completed_tasks
    FROM panol.work_order_tasks wot
    WHERE wot.work_order_id IN (c.tractor_wo_id, c.semi_wo_id)
) counts ON true;

CREATE OR REPLACE VIEW public.v_coord_kanban_progreso AS
SELECT * FROM panol.v_coord_kanban_progreso;

-- ============================================================================
-- 4. VISTA: panol.v_coord_kanban_terminados
-- Fuente: panol.work_orders_cold + panol.work_orders (COMPLETADA) en ventana de 7 días.
-- Empareja por public.unidades cuando corresponde y extrae la última tarea terminada
-- del snapshot para determinar la columna de sector.
-- ============================================================================
CREATE OR REPLACE VIEW panol.v_coord_kanban_terminados AS
WITH raw_closed AS (
    SELECT
        woc.id AS work_order_id,
        woc.ot_number,
        woc.tractor_id,
        woc.semi_id,
        woc.status,
        woc.avg,
        woc.entry_date,
        woc.close_date,
        COALESCE(woc.tasks_snapshot, '[]'::jsonb) AS tasks_snapshot
    FROM panol.work_orders_cold woc
    WHERE woc.close_date >= (NOW() - INTERVAL '7 days')

    UNION ALL

    SELECT
        wo.id AS work_order_id,
        wo.ot_number,
        uwo.tractor_id,
        uwo.semi_id,
        wo.status,
        wo.avg,
        wo.entry_date,
        COALESCE(wo.close_date, wo.updated_at) AS close_date,
        COALESCE(wo.tasks_snapshot, '[]'::jsonb) AS tasks_snapshot
    FROM panol.work_orders wo
    JOIN panol.unit_work_orders uwo ON uwo.work_order_id = wo.id
    WHERE wo.status IN ('COMPLETADA', 'CERRADA', 'INCOMPLETA')
      AND COALESCE(wo.close_date, wo.updated_at) >= (NOW() - INTERVAL '7 days')
      AND NOT EXISTS (
          SELECT 1 FROM panol.work_orders_cold woc2 WHERE woc2.ot_number = wo.ot_number
      )
),
dedup_closed AS (
    SELECT DISTINCT ON (COALESCE(tractor_id, semi_id), ot_number)
        *
    FROM raw_closed
    ORDER BY COALESCE(tractor_id, semi_id), ot_number, close_date DESC
),
tractor_closed AS (
    SELECT DISTINCT ON (tractor_id) *
    FROM dedup_closed
    WHERE tractor_id IS NOT NULL
    ORDER BY tractor_id, close_date DESC
),
semi_closed AS (
    SELECT DISTINCT ON (semi_id) *
    FROM dedup_closed
    WHERE semi_id IS NOT NULL
    ORDER BY semi_id, close_date DESC
),
paired_closed AS (
    SELECT
        u.id AS unidad_id,
        u.n_ute,
        u.estado AS estado_unidad,
        u.tractor_id AS u_tractor_id,
        u.semi_id AS u_semi_id,
        tr.work_order_id AS tractor_wo_id,
        tr.ot_number AS tractor_ot,
        tr.avg AS tractor_avg,
        tr.close_date AS tractor_close_date,
        tr.tasks_snapshot AS tractor_snapshot,
        sm.work_order_id AS semi_wo_id,
        sm.ot_number AS semi_ot,
        sm.avg AS semi_avg,
        sm.close_date AS semi_close_date,
        sm.tasks_snapshot AS semi_snapshot
    FROM public.unidades u
    LEFT JOIN tractor_closed tr ON tr.tractor_id = u.tractor_id
    LEFT JOIN semi_closed sm ON sm.semi_id = u.semi_id
    WHERE tr.work_order_id IS NOT NULL OR sm.work_order_id IS NOT NULL
),
solo_tr_closed AS (
    SELECT
        NULL::uuid AS unidad_id,
        NULL::text AS n_ute,
        'terminado'::text AS estado_unidad,
        tr.tractor_id AS u_tractor_id,
        NULL::uuid AS u_semi_id,
        tr.work_order_id AS tractor_wo_id,
        tr.ot_number AS tractor_ot,
        tr.avg AS tractor_avg,
        tr.close_date AS tractor_close_date,
        tr.tasks_snapshot AS tractor_snapshot,
        NULL::uuid AS semi_wo_id,
        NULL::text AS semi_ot,
        NULL::numeric AS semi_avg,
        NULL::timestamptz AS semi_close_date,
        '[]'::jsonb AS semi_snapshot
    FROM tractor_closed tr
    WHERE NOT EXISTS (
        SELECT 1 FROM public.unidades u WHERE u.tractor_id = tr.tractor_id
    )
),
solo_sm_closed AS (
    SELECT
        NULL::uuid AS unidad_id,
        NULL::text AS n_ute,
        'terminado'::text AS estado_unidad,
        NULL::uuid AS u_tractor_id,
        sm.semi_id AS u_semi_id,
        NULL::uuid AS tractor_wo_id,
        NULL::text AS tractor_ot,
        NULL::numeric AS tractor_avg,
        NULL::timestamptz AS tractor_close_date,
        '[]'::jsonb AS tractor_snapshot,
        sm.work_order_id AS semi_wo_id,
        sm.ot_number AS semi_ot,
        sm.avg AS semi_avg,
        sm.close_date AS semi_close_date,
        sm.tasks_snapshot AS semi_snapshot
    FROM semi_closed sm
    WHERE NOT EXISTS (
        SELECT 1 FROM public.unidades u WHERE u.semi_id = sm.semi_id
    )
),
all_closed_cards AS (
    SELECT * FROM paired_closed
    UNION ALL
    SELECT * FROM solo_tr_closed
    UNION ALL
    SELECT * FROM solo_sm_closed
)
SELECT
    COALESCE(c.unidad_id::text, c.tractor_wo_id::text, c.semi_wo_id::text) || '-closed' AS card_id,
    c.unidad_id,
    c.n_ute,
    c.estado_unidad,
    c.u_tractor_id AS tractor_id,
    COALESCE(t.patente, '') AS tractor_plate,
    COALESCE(t.marca, '') AS tractor_brand,
    c.tractor_wo_id,
    COALESCE(c.tractor_ot, '') AS tractor_ot,
    c.tractor_avg,
    COALESCE(c.tractor_snapshot, '[]'::jsonb) AS tractor_snapshot,
    c.u_semi_id AS semi_id,
    COALESCE(s.patente, '') AS semi_plate,
    COALESCE(s.marca, '') AS semi_brand,
    c.semi_wo_id,
    COALESCE(c.semi_ot, '') AS semi_ot,
    c.semi_avg,
    COALESCE(c.semi_snapshot, '[]'::jsonb) AS semi_snapshot,
    ROUND(
        (COALESCE(c.tractor_avg, 0) + COALESCE(c.semi_avg, 0))::numeric
        / GREATEST(num_nonnulls(c.tractor_wo_id, c.semi_wo_id), 1),
        0
    )::integer AS combined_avg,
    (last_snap.task_sector IS NOT NULL) AS has_active_task,
    last_snap.sector_task AS active_sector_task,
    last_snap.task_sector AS active_task_sector,
    last_snap.ubicacion AS active_task_ubicacion,
    last_snap.termino AS active_termino,
    last_snap.worker_id,
    COALESCE(last_snap.worker_name, '') AS worker_name,
    COALESCE(last_snap.worker_op_code, '') AS worker_op_code,
    COALESCE(last_snap.worker_role, '') AS worker_role,
    COALESCE(last_snap.worker_default_boxes, ARRAY[]::text[]) AS worker_default_boxes,
    (jsonb_array_length(COALESCE(c.tractor_snapshot, '[]'::jsonb)) + jsonb_array_length(COALESCE(c.semi_snapshot, '[]'::jsonb)))::integer AS total_tasks,
    0::integer AS in_progress_tasks,
    (jsonb_array_length(COALESCE(c.tractor_snapshot, '[]'::jsonb)) + jsonb_array_length(COALESCE(c.semi_snapshot, '[]'::jsonb)))::integer AS completed_tasks,
    GREATEST(c.tractor_close_date, c.semi_close_date) AS close_date
FROM all_closed_cards c
LEFT JOIN public.tractores t ON t.id = c.u_tractor_id
LEFT JOIN public.semis s ON s.id = c.u_semi_id
LEFT JOIN LATERAL (
    SELECT
        elem->>'sector_task' AS sector_task,
        UPPER(TRIM(COALESCE(
            NULLIF(elem->>'rubro', ''),
            NULLIF(elem->>'sector', ''),
            substring(COALESCE(elem->>'sector_task', '') from '^\[([^\]]+)\]'),
            'GENERAL'
        ))) AS task_sector,
        COALESCE(elem->>'ubicacion', elem->>'box', '') AS ubicacion,
        elem->>'termino' AS termino,
        st.id AS worker_id,
        COALESCE(st.name, NULLIF(elem->>'operario', ''), NULLIF(elem->>'assigned_staff_name', '')) AS worker_name,
        COALESCE(st.op_code, '') AS worker_op_code,
        UPPER(TRIM(COALESCE(st.role, ''))) AS worker_role,
        COALESCE(st.default_boxes, ARRAY[]::text[]) AS worker_default_boxes
    FROM jsonb_array_elements(
        COALESCE(c.tractor_snapshot, '[]'::jsonb) || COALESCE(c.semi_snapshot, '[]'::jsonb)
    ) AS elem
    LEFT JOIN panol.staff st ON (
        (elem->>'worker_id' IS NOT NULL AND elem->>'worker_id' ~* '^[0-9a-f-]{36}$' AND st.id = (elem->>'worker_id')::uuid)
        OR (elem->>'operario' IS NOT NULL AND UPPER(TRIM(st.name)) = UPPER(TRIM(elem->>'operario')))
    )
    ORDER BY
        COALESCE(elem->>'termino', elem->>'empezo', '') DESC NULLS LAST,
        (CASE WHEN COALESCE(elem->>'operario', '') <> '' THEN 1 ELSE 2 END) ASC
    LIMIT 1
) last_snap ON true;

CREATE OR REPLACE VIEW public.v_coord_kanban_terminados AS
SELECT * FROM panol.v_coord_kanban_terminados;

-- ============================================================================
-- 5. VISTA: panol.v_coord_unit_tasks
-- Detalle de tareas por Orden de Trabajo para el modal desplegable de Coordinación.
-- ============================================================================
CREATE OR REPLACE VIEW panol.v_coord_unit_tasks AS
SELECT
    wot.id AS task_id,
    wot.work_order_id,
    wo.ot_number,
    wo.avg AS wo_avg,
    wo.status AS wo_status,
    CASE
        WHEN uwo.tractor_id IS NOT NULL THEN 'TRACTOR'
        ELSE 'SEMI'
    END AS vehicle_type,
    COALESCE(uwo.tractor_id, uwo.semi_id) AS vehicle_id,
    COALESCE(t.patente, s.patente, '') AS patente,
    wot.task_index,
    wot.sector_task,
    UPPER(TRIM(COALESCE(substring(wot.sector_task from '^\[([^\]]+)\]'), 'GENERAL'))) AS sector,
    TRIM(regexp_replace(wot.sector_task, '^\[[^\]]+\]\s*', '')) AS descripcion,
    COALESCE(wot.ubicacion, '') AS ubicacion,
    wot.worker_id,
    COALESCE(st.name, '') AS worker_name,
    COALESCE(st.op_code, '') AS worker_op_code,
    UPPER(TRIM(COALESCE(st.role, ''))) AS worker_role,
    COALESCE(st.default_boxes, ARRAY[]::text[]) AS worker_default_boxes,
    wot.asignado,
    wot.empezo,
    wot.termino,
    wot.estado,
    wot.porcentaje,
    wot.updated_at
FROM panol.work_order_tasks wot
JOIN panol.work_orders wo ON wo.id = wot.work_order_id
LEFT JOIN panol.unit_work_orders uwo ON uwo.work_order_id = wo.id
LEFT JOIN public.tractores t ON t.id = uwo.tractor_id
LEFT JOIN public.semis s ON s.id = uwo.semi_id
LEFT JOIN panol.staff st ON st.id = wot.worker_id
ORDER BY wot.work_order_id, wot.task_index ASC;

CREATE OR REPLACE VIEW public.v_coord_unit_tasks AS
SELECT * FROM panol.v_coord_unit_tasks;

-- ============================================================================
-- 6. FUNCIÓN RPC EN PUBLIC Y PANOL PARA ASIGNACIÓN DIRECTA DESDE EL FRONTEND
-- ============================================================================
CREATE OR REPLACE FUNCTION public.coord_assign_task(
    p_task_id UUID,
    p_ubicacion TEXT DEFAULT NULL,
    p_worker_id UUID DEFAULT NULL,
    p_update_ubicacion BOOLEAN DEFAULT FALSE,
    p_update_worker BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
    v_updated panol.work_order_tasks%ROWTYPE;
    v_has_resource BOOLEAN;
BEGIN
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

    RETURN to_jsonb(v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 7. PERMISOS PARA CLIENTE SUPABASE (anon & authenticated) Y RELOAD POSTGREST
-- ============================================================================
GRANT USAGE ON SCHEMA panol TO anon, authenticated;
GRANT SELECT ON panol.v_coord_kanban_progreso TO anon, authenticated;
GRANT SELECT ON public.v_coord_kanban_progreso TO anon, authenticated;
GRANT SELECT ON panol.v_coord_kanban_terminados TO anon, authenticated;
GRANT SELECT ON public.v_coord_kanban_terminados TO anon, authenticated;
GRANT SELECT ON panol.v_coord_unit_tasks TO anon, authenticated;
GRANT SELECT ON public.v_coord_unit_tasks TO anon, authenticated;
GRANT SELECT, UPDATE ON panol.work_order_tasks TO anon, authenticated;
GRANT SELECT, UPDATE ON public.panol_work_order_tasks TO anon, authenticated;
GRANT SELECT ON panol.staff TO anon, authenticated;
GRANT SELECT ON public.panol_staff TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coord_assign_task(UUID, TEXT, UUID, BOOLEAN, BOOLEAN) TO anon, authenticated;

DO $$
BEGIN
    EXECUTE 'ALTER ROLE authenticator SET pgrst.db_schemas = ''public, graphql_public, panol''';
    NOTIFY pgrst, 'reload config';
    NOTIFY pgrst, 'reload schema';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'No se pudo alterar pgrst.db_schemas en authenticator: %', SQLERRM;
END $$;
