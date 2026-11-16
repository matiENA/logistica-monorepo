-- ==============================================================================
-- Migración: Soporte de Roles en Usuarios DASH (Lector / Operador / Admin)
-- Permite usuarios sin permisos de edición (rol = 'lector' / 'viewer' / 'consulta')
-- ==============================================================================

-- 1. Agregar columna 'rol' en tabla base public.dash si no existe
ALTER TABLE public.dash 
ADD COLUMN IF NOT EXISTS rol text NOT NULL DEFAULT 'operador';

-- 2. Asegurar que roles existentes sean consistentes
UPDATE public.dash 
SET rol = 'admin' 
WHERE UPPER(TRIM(nombre)) IN ('ADMIN', 'TRANSER') AND (rol IS NULL OR rol = 'operador');

-- 3. Actualizar vista pública view_dash_usuarios para exponer el rol real
CREATE OR REPLACE VIEW public.view_dash_usuarios AS
SELECT 
    id,
    upper(TRIM(BOTH FROM nombre)) AS usuario,
    COALESCE(rol, 'operador'::text) AS rol
FROM public.dash;

-- 4. Permisos de seguridad y RLS
GRANT SELECT ON public.view_dash_usuarios TO anon, authenticated, service_role;
ALTER VIEW public.view_dash_usuarios SET (security_invoker = true);
