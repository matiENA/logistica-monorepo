-- ==============================================================================
-- 🚀 MIGRACIÓN Y LIMPIEZA DE VISTAS EN SUPABASE / POSTGRESQL
-- Monorepo: DASH | EOR
-- Fecha: 2026-11-03 (Actualizado: 2026-11-16 - desacoplado de panol)
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 1. FASE DE LIMPIEZA: ELIMINACIÓN DE VISTAS OBSOLETAS Y HUÉRFANAS (0 USO)
-- ==============================================================================

-- 1.1 Vistas experimentales 'v_canon_*' en 'public' (no conectadas al frontend)
DROP VIEW IF EXISTS public.v_canon_chofer_operativo CASCADE;
DROP VIEW IF EXISTS public.v_canon_flota_estado CASCADE;
DROP VIEW IF EXISTS public.v_canon_novedades_activas CASCADE;

-- 1.2 Vistas redundantes / no consumidas en 'public'
DROP VIEW IF EXISTS public.view_dash_libres CASCADE;
DROP VIEW IF EXISTS public.view_dash_retorno CASCADE;

-- ==============================================================================
-- 2. FASE DE MERGE Y UNIFICACIÓN COMPARTIDA (DASH + EOR)
-- ==============================================================================

-- 2.1 MERGE DE NOVEDADES / CARDS DIARIAS (DASH <-> EOR)
-- Permite que EOR (apiClient / views.js) y DASH compartan el feed en vivo de novedades
DROP VIEW IF EXISTS public.view_cards_diarias CASCADE;
CREATE VIEW public.view_cards_diarias AS
SELECT * FROM public.view_dash_novedades;

-- 2.2 FLOTA OPERATIVA (DASH / EOR)
DROP VIEW IF EXISTS public.view_flota_operativa CASCADE;
CREATE VIEW public.view_flota_operativa AS
SELECT 
  u.id AS unidad_id,
  COALESCE(u.n_ute, '') AS n_ute,
  COALESCE(t.patente, '') AS tractor,
  COALESCE(s.patente, '') AS semi,
  c.id AS chofer_id,
  COALESCE(c.nombre, '') AS chofer_nombre,
  COALESCE(c.nombre, '') AS nom,
  COALESCE(diag.dia_codigo, '-') AS dia_diagrama,
  t.vtv AS vtv_tr,
  t.mas AS mas_tr,
  s.vtv AS vtv_semi,
  s.mas AS mas_semi,
  COALESCE(su.denominacion, 'GENERAL') AS servicio,
  COALESCE(su.denominacion, 'GENERAL') AS srv,
  t.id AS tractor_id,
  t.marca AS marca_tr,
  t.modelo AS modelo_tr,
  s.id AS semi_id,
  s.marca AS marca_semi,
  s.cisternado,
  s.esp_es,
  s.vi,
  s.ve,
  COALESCE(u.estado, 'disponible') AS estado_unidad,
  NULL::text AS ot_activa,
  COALESCE(c.estado, 'disponible') AS estado_chofer,
  c.foto
FROM public.unidades u
LEFT JOIN public.servicios_unidades su ON u.servicio_id = su.id
LEFT JOIN public.tractores t ON u.tractor_id = t.id
LEFT JOIN public.semis s ON u.semi_id = s.id
LEFT JOIN public.movimientos m ON u.id = m.id_unidad
LEFT JOIN public.choferes c ON m.id_chofer = c.id
LEFT JOIN LATERAL (
  SELECT (d.dias ->> CURRENT_DATE::text) AS dia_codigo
  FROM public.diagramas d
  WHERE d.chofer_id = c.id
    AND d.anio = EXTRACT(YEAR FROM CURRENT_DATE)::integer
    AND d.mes_numero = EXTRACT(MONTH FROM CURRENT_DATE)::integer
  LIMIT 1
) diag ON true;
ALTER VIEW public.view_flota_operativa SET (security_invoker = true);

-- 2.3 ALINEACIÓN DE view_dash_flota COMO PROYECCIÓN COMPATIBLE
DROP VIEW IF EXISTS public.view_dash_flota CASCADE;
CREATE VIEW public.view_dash_flota AS
SELECT 
  chofer_id,
  nom,
  tractor,
  semi,
  cisternado,
  n_ute,
  srv,
  servicio,
  chofer_id AS servicio_chofer_id,
  estado_chofer,
  estado_unidad,
  ot_activa,
  foto,
  unidad_id,
  vtv_tr,
  mas_tr,
  vtv_semi,
  mas_semi,
  esp_es,
  vi,
  ve
FROM public.view_flota_operativa
WHERE length(TRIM(nom)) > 2
ORDER BY nom;

-- ==============================================================================
-- 3. PERMISOS DE ACCESO EN SUPABASE (ROLES ANON, AUTHENTICATED, SERVICE_ROLE)
-- ==============================================================================
GRANT SELECT ON public.view_cards_diarias TO anon, authenticated, service_role;
GRANT SELECT ON public.view_flota_operativa TO anon, authenticated, service_role;
GRANT SELECT ON public.view_dash_flota TO anon, authenticated, service_role;

COMMIT;
