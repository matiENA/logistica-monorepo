-- ==============================================================================
-- 🛠️ REMEDIACIÓN: Permisos de mutación para EOR Frontend en Supabase
-- Causa: El hardening revocó UPDATE a 'anon' y limitó pol_write_operational a 'authenticated'.
-- Como EOR usa login desacoplado (fn_auth_login en localStorage sin JWT de GoTrue),
-- las peticiones del browser corren bajo el rol 'anon'.
-- ==============================================================================

BEGIN;

-- 1. Conceder privilegios DML en tablas operativas que muta eor-frontend
GRANT UPDATE ON TABLE public.diagramas TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.novedades TO anon, authenticated;
GRANT UPDATE ON TABLE public.choferes TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.chofer_documentacion TO anon, authenticated;

-- 2. Asegurar que 'authenticated' también tenga los permisos que faltaban del hardening
GRANT INSERT, UPDATE, DELETE ON TABLE public.diagramas TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.chofer_documentacion TO authenticated;

-- 3. Actualizar políticas RLS de escritura para permitir 'anon' en estas tablas operativas
DROP POLICY IF EXISTS pol_write_operational ON public.diagramas;
CREATE POLICY pol_write_operational ON public.diagramas 
  FOR ALL TO anon, authenticated, service_role 
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS pol_write_operational ON public.novedades;
CREATE POLICY pol_write_operational ON public.novedades 
  FOR ALL TO anon, authenticated, service_role 
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS pol_write_operational ON public.choferes;
CREATE POLICY pol_write_operational ON public.choferes 
  FOR ALL TO anon, authenticated, service_role 
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS pol_write_operational ON public.chofer_documentacion;
CREATE POLICY pol_write_operational ON public.chofer_documentacion 
  FOR ALL TO anon, authenticated, service_role 
  USING (true) WITH CHECK (true);

COMMIT;
