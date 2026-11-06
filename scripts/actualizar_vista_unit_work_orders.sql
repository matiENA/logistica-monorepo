-- ==============================================================================
-- 🚀 MIGRACIÓN SQL: ACTUALIZACIÓN CANÓNICA DE VISTA UNIT_WORK_ORDERS Y V_FLOTA_BUSQUEDA
-- Indexada por claves foráneas de public.unidades (tractor_id, semi_id)
-- Vinculada con panol.unit_work_orders y panol.work_orders (status = 'ACTIVA')
-- Mantiene compatibilidad ordinal de columnas (1..13) y añade tractor_id, semi_id (14..17)
-- Fecha: 2026-11-05
-- ==============================================================================

BEGIN;

CREATE OR REPLACE VIEW panol.v_flota_busqueda AS
WITH u_coupled AS (
    SELECT 
        u.id AS unidad_id,
        COALESCE(u.n_ute, '') AS n_ute,
        COALESCE(t.patente, '') AS tractor,
        COALESCE(t.marca, '') AS marca_tr,
        t.id AS tractor_id,
        COALESCE(s.patente, '') AS semi,
        COALESCE(s.marca, '') AS marca_semi,
        s.id AS semi_id,
        COALESCE(su.denominacion, 'GENERAL') AS servicio,
        COALESCE(u.estado, 'disponible') AS estado_unidad
    FROM public.unidades u
    LEFT JOIN public.tractores t ON u.tractor_id = t.id
    LEFT JOIN public.semis s ON u.semi_id = s.id
    LEFT JOIN public.servicios_unidades su ON u.servicio_id = su.id
),
uncoupled_tractors AS (
    SELECT 
        NULL::uuid AS unidad_id,
        ''::text AS n_ute,
        COALESCE(t.patente, '') AS tractor,
        COALESCE(t.marca, '') AS marca_tr,
        t.id AS tractor_id,
        ''::text AS semi,
        ''::text AS marca_semi,
        NULL::uuid AS semi_id,
        'GENERAL'::text AS servicio,
        'disponible'::text AS estado_unidad
    FROM public.tractores t
    WHERE t.id NOT IN (SELECT tractor_id FROM public.unidades WHERE tractor_id IS NOT NULL)
      AND t.id IN (
          SELECT uwo.tractor_id 
          FROM panol.unit_work_orders uwo 
          JOIN panol.work_orders wo ON uwo.work_order_id = wo.id 
          WHERE wo.status = 'ACTIVA' AND uwo.tractor_id IS NOT NULL
      )
),
uncoupled_semis AS (
    SELECT 
        NULL::uuid AS unidad_id,
        ''::text AS n_ute,
        ''::text AS tractor,
        ''::text AS marca_tr,
        NULL::uuid AS tractor_id,
        COALESCE(s.patente, '') AS semi,
        COALESCE(s.marca, '') AS marca_semi,
        s.id AS semi_id,
        'GENERAL'::text AS servicio,
        'disponible'::text AS estado_unidad
    FROM public.semis s
    WHERE s.id NOT IN (SELECT semi_id FROM public.unidades WHERE semi_id IS NOT NULL)
      AND s.id IN (
          SELECT uwo.semi_id 
          FROM panol.unit_work_orders uwo 
          JOIN panol.work_orders wo ON uwo.work_order_id = wo.id 
          WHERE wo.status = 'ACTIVA' AND uwo.semi_id IS NOT NULL
      )
),
all_fleet AS (
    SELECT * FROM u_coupled
    UNION ALL
    SELECT * FROM uncoupled_tractors
    UNION ALL
    SELECT * FROM uncoupled_semis
)
SELECT 
    f.unidad_id,
    f.n_ute,
    f.tractor,
    f.marca_tr,
    f.semi,
    f.marca_semi,
    f.servicio,
    f.estado_unidad,
    COALESCE(wot.work_order_id, wos.work_order_id) AS active_work_order_id,
    COALESCE(wot.ot_number, wos.ot_number, '') AS active_ot_number,
    COALESCE(wot.status, wos.status, 'DISPONIBLE') AS active_ot_status,
    COALESCE(wot.ot_number, '') AS tractor_ot,
    COALESCE(wos.ot_number, '') AS semi_ot,
    f.tractor_id,
    f.semi_id,
    wot.work_order_id AS tractor_wo_id,
    wos.work_order_id AS semi_wo_id
FROM all_fleet f
LEFT JOIN LATERAL (
    SELECT wo.id AS work_order_id, wo.ot_number, wo.status
    FROM panol.unit_work_orders uwo
    JOIN panol.work_orders wo ON uwo.work_order_id = wo.id
    WHERE uwo.tractor_id = f.tractor_id AND wo.status = 'ACTIVA'
    ORDER BY wo.created_at DESC
    LIMIT 1
) wot ON f.tractor_id IS NOT NULL
LEFT JOIN LATERAL (
    SELECT wo.id AS work_order_id, wo.ot_number, wo.status
    FROM panol.unit_work_orders uwo
    JOIN panol.work_orders wo ON uwo.work_order_id = wo.id
    WHERE uwo.semi_id = f.semi_id AND wo.status = 'ACTIVA'
    ORDER BY wo.created_at DESC
    LIMIT 1
) wos ON f.semi_id IS NOT NULL
WHERE COALESCE(f.tractor, '') <> '' OR COALESCE(f.semi, '') <> '';

-- 2. Crear / Actualizar vista canónica y alias públicos
CREATE OR REPLACE VIEW panol.v_unit_work_orders AS 
SELECT * FROM panol.v_flota_busqueda;

CREATE OR REPLACE VIEW public.v_flota_busqueda AS 
SELECT * FROM panol.v_flota_busqueda;

CREATE OR REPLACE VIEW public.v_unit_work_orders AS 
SELECT * FROM panol.v_flota_busqueda;

-- 3. Habilitar security_invoker para consistencia RLS
ALTER VIEW panol.v_flota_busqueda SET (security_invoker = true);
ALTER VIEW panol.v_unit_work_orders SET (security_invoker = true);
ALTER VIEW public.v_flota_busqueda SET (security_invoker = true);
ALTER VIEW public.v_unit_work_orders SET (security_invoker = true);

-- 4. Permisos SELECT
GRANT SELECT ON panol.v_flota_busqueda TO anon, authenticated, service_role;
GRANT SELECT ON panol.v_unit_work_orders TO anon, authenticated, service_role;
GRANT SELECT ON public.v_flota_busqueda TO anon, authenticated, service_role;
GRANT SELECT ON public.v_unit_work_orders TO anon, authenticated, service_role;

COMMIT;
