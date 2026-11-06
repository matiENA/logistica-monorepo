-- ==============================================================================
-- 🚀 MIGRACIÓN SQL: ACTUALIZACIÓN CANÓNICA DE V_STAFF_HOLDS CON V_UNIT_WORK_ORDERS
-- Vincula panol.staff_holds con panol.v_unit_work_orders para renderizado dinámico
-- Elimina desincronización de OTs y patentes en Unidades en Puesto (Taller / Coordinación)
-- Mantiene compatibilidad ordinal de columnas (1..20) y agrega unidad_id, n_ute (21..22)
-- Fecha: 2026-11-05
-- ==============================================================================

BEGIN;

CREATE OR REPLACE VIEW panol.v_staff_holds AS
SELECT 
    sh.id AS hold_id,
    sh.staff_id,
    s.op_code,
    s.name AS staff_name,
    COALESCE(uwo.tractor_wo_id, sh.tractor_work_order_id) AS tractor_work_order_id,
    COALESCE(uwo.semi_wo_id, sh.semi_work_order_id) AS semi_work_order_id,
    COALESCE(uwo.tractor_ot, wo_tr.ot_number, sh.ot_number, ''::text) AS tractor_ot,
    COALESCE(uwo.semi_ot, wo_sm.ot_number, sh.semi_ot, ''::text) AS semi_ot,
    COALESCE(wo_tr.status, 'ACTIVA'::text) AS tractor_ot_status,
    COALESCE(wo_sm.status, 'ACTIVA'::text) AS semi_ot_status,
    COALESCE(sh.tractor_id, uwo.tractor_id) AS tractor_id,
    COALESCE(uwo.tractor, t.patente, sh.tractor_plate, ''::text) AS tractor_plate,
    COALESCE(uwo.marca_tr, t.marca, ''::text) AS tractor_brand,
    COALESCE(sh.semi_id, uwo.semi_id) AS semi_id,
    COALESCE(uwo.semi, sm.patente, sh.semi_plate, ''::text) AS semi_plate,
    COALESCE(uwo.marca_semi, sm.marca, ''::text) AS semi_brand,
    COALESCE(sh.source, 'MANUAL'::text) AS source,
    sh.reviewed_at,
    (COALESCE(sh.source, 'MANUAL'::text) = 'COORDINACION'::text AND sh.reviewed_at IS NULL) AS is_coord_assigned,
    sh.created_at,
    uwo.unidad_id,
    uwo.n_ute
FROM panol.staff_holds sh
JOIN panol.staff s ON sh.staff_id = s.id
LEFT JOIN panol.v_unit_work_orders uwo ON (
    (sh.tractor_id IS NOT NULL AND uwo.tractor_id = sh.tractor_id)
    OR
    (sh.tractor_id IS NULL AND sh.semi_id IS NOT NULL AND uwo.semi_id = sh.semi_id)
)
LEFT JOIN panol.work_orders wo_tr ON COALESCE(uwo.tractor_wo_id, sh.tractor_work_order_id) = wo_tr.id
LEFT JOIN panol.work_orders wo_sm ON COALESCE(uwo.semi_wo_id, sh.semi_work_order_id) = wo_sm.id
LEFT JOIN public.tractores t ON COALESCE(sh.tractor_id, uwo.tractor_id) = t.id
LEFT JOIN public.semis sm ON COALESCE(sh.semi_id, uwo.semi_id) = sm.id;

-- 2. Actualizar vista espejo pública
CREATE OR REPLACE VIEW public.v_staff_holds AS 
SELECT * FROM panol.v_staff_holds;

-- 3. Habilitar security_invoker para consistencia RLS
ALTER VIEW panol.v_staff_holds SET (security_invoker = true);
ALTER VIEW public.v_staff_holds SET (security_invoker = true);

-- 4. Permisos SELECT
GRANT SELECT ON panol.v_staff_holds TO anon, authenticated, service_role;
GRANT SELECT ON public.v_staff_holds TO anon, authenticated, service_role;

COMMIT;
