-- ==============================================================================
-- 🚀 MIGRACIÓN Y LIMPIEZA DE COLUMNA 'tipo_novedad' (TEXT) EN NOVEDADES Y VISTAS
-- Monorepo: DASH & EOR
-- Objetivo:
--   1. Asegurar que todas las novedades tengan su 'tipo_novedad_id' (UUID relacional).
--   2. Establecer 'tipo_novedad_id' como NOT NULL con FK a public.tipos_novedad(id).
--   3. Actualizar la vista 'view_dash_novedades' para realizar JOIN relacional con tipos_novedad
--      mediante tipo_novedad_id, proyectando código, título, colores y restricciones.
--   4. Recrear 'view_cards_diarias' sobre 'view_dash_novedades'.
--   5. Eliminar la columna de texto redundante 'tipo_novedad' de public.novedades.
-- ==============================================================================

BEGIN;

-- 1. Poblar tipo_novedad_id en filas huérfanas o nulas mapeando contra tipos_novedad
UPDATE public.novedades n
SET tipo_novedad_id = tn.id
FROM public.tipos_novedad tn
WHERE n.tipo_novedad_id IS NULL
  AND (n.tipo_novedad = tn.codigo OR n.tipo_novedad = tn.titulo);

-- 2. Establecer restricción NOT NULL en la clave foránea tipo_novedad_id
ALTER TABLE public.novedades 
  ALTER COLUMN tipo_novedad_id SET NOT NULL;

-- 3. Eliminar vistas dependientes temporalmente (CASCADE)
DROP VIEW IF EXISTS public.view_cards_diarias CASCADE;
DROP VIEW IF EXISTS public.view_dash_novedades CASCADE;

-- 4. Eliminar columna de texto redundante de la tabla física
ALTER TABLE public.novedades 
  DROP COLUMN IF EXISTS tipo_novedad;

-- 5. Recrear la vista canónica view_dash_novedades con JOIN relacional
CREATE VIEW public.view_dash_novedades AS
SELECT 
    n.id,
    n.id AS card_id,
    tn.codigo AS tipo_novedad,
    tn.codigo AS tipo,
    tn.id AS tipo_novedad_id,
    tn.titulo AS tipo_novedad_titulo,
    tn.bg_color AS tipo_bg_color,
    tn.text_color AS tipo_text_color,
    COALESCE(tn.requiere_fecha_objetivo, false) AS requiere_fecha_objetivo,
    COALESCE(tn.imprime_nota_movimientos, false) AS imprime_nota_movimientos,
    n.fecha_objetivo,
    n.fecha_objetivo AS fecha,
    n.fecha_resolucion,
    n.detalle,
    n.resuelto,
    COALESCE(n.prioridad, 'media'::text) AS prioridad,
    n.creado_el,
    n.creado_el AS "timestamp",
    n.creado_por_id,
    COALESCE(d_user.nombre, 'DASH'::text) AS creador,
    COALESCE(d_user.nombre, 'DASH'::text) AS usuario,
    c.id AS chofer_id,
    upper(TRIM(BOTH FROM COALESCE(c.nombre, ''::text))) AS nom,
    upper(TRIM(BOTH FROM COALESCE(c.nombre, ''::text))) AS chofer_nombre,
    COALESCE(c.estado, 'disponible'::text) AS chofer_estado,
    cd.telefono AS chofer_telefono,
    c.foto,
    u.id AS unidad_id,
    upper(TRIM(BOTH FROM COALESCE(t.patente, ''::text))) AS tractor,
    upper(TRIM(BOTH FROM COALESCE(s.patente, ''::text))) AS semi,
    s.cisternado,
    COALESCE(u.n_ute, 'S/D'::text) AS n_ute,
    upper(TRIM(BOTH FROM COALESCE(sc.denominacion, su.denominacion, 'S/A'::text))) AS srv,
    upper(TRIM(BOTH FROM COALESCE(sc.denominacion, su.denominacion, 'S/A'::text))) AS servicio,
    c.servicio_id AS servicio_chofer_id,
    t.vtv AS vtv_tr,
    t.mas AS mas_tr,
    s.vtv AS vtv_semi,
    s.mas AS mas_semi,
    s.esp_es,
    s.vi,
    s.ve,
    CASE
        WHEN (tn.codigo = 'LIBRES'::text) THEN COALESCE(term.codigo, ''::text)
        ELSE ''::text
    END AS terminal,
    CASE
        WHEN (tn.codigo = 'LIBRES'::text) THEN n.terminal_id
        ELSE NULL::uuid
    END AS terminal_id,
    CASE
        WHEN (tn.codigo = 'LIBRES'::text) THEN term.nombre
        ELSE NULL::text
    END AS terminal_nombre,
    COALESCE((
        SELECT array_agg(m.usuario_nombre)
        FROM dash_menciones m
        WHERE m.novedad_id = n.id
    ), ARRAY[]::text[]) AS menciones
FROM novedades n
JOIN tipos_novedad tn ON n.tipo_novedad_id = tn.id
LEFT JOIN choferes c ON n.chofer_id = c.id
LEFT JOIN servicios_choferes sc ON c.servicio_id = sc.id
LEFT JOIN chofer_documentacion cd ON cd.chofer_id = c.id
LEFT JOIN unidades u ON n.unidad_id = u.id
LEFT JOIN tractores t ON u.tractor_id = t.id
LEFT JOIN semis s ON u.semi_id = s.id
LEFT JOIN servicios_unidades su ON u.servicio_id = su.id
LEFT JOIN terminales term ON n.terminal_id = term.id
LEFT JOIN dash d_user ON n.creado_por_id = d_user.id
WHERE (NOT n.resuelto) OR (n.fecha_resolucion >= (CURRENT_DATE - '14 days'::interval));

-- 6. Recrear view_cards_diarias
CREATE VIEW public.view_cards_diarias AS
SELECT * FROM public.view_dash_novedades;

-- 7. Configuración de seguridad RLS e invocación segura
ALTER VIEW public.view_dash_novedades SET (security_invoker = true);
ALTER VIEW public.view_cards_diarias SET (security_invoker = true);

-- 8. Permisos a roles Supabase
GRANT SELECT ON public.view_dash_novedades TO anon, authenticated, service_role;
GRANT SELECT ON public.view_cards_diarias TO anon, authenticated, service_role;

COMMIT;
