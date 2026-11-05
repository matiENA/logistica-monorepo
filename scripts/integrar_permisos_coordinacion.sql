-- ==============================================================================
-- 🛡️ INTEGRACIÓN DE PERMISOS: VISTAS Y RPC DE COORDINACIÓN (SUPABASE / POSTGRESQL)
-- Integra las vistas del Tablero de Coordinación y panol_staff tras el hardening
-- ==============================================================================

BEGIN;

-- 1. CONCEDER SELECT A 'anon' Y 'authenticated' EN VISTAS DE COORDINACIÓN Y STAFF
GRANT SELECT ON TABLE
  public.v_coord_kanban_progreso,
  public.v_coord_kanban_terminados,
  public.v_coord_unit_tasks,
  public.panol_staff,
  public.v_staff_holds
TO anon, authenticated;

GRANT SELECT ON TABLE
  panol.v_coord_kanban_progreso,
  panol.v_coord_kanban_terminados,
  panol.v_coord_unit_tasks,
  panol.v_staff_holds
TO anon, authenticated;

-- 2. PRIVILEGIOS DE LECTURA EN TABLAS BASE NECESARIAS PARA SECURITY_INVOKER
GRANT SELECT ON TABLE
  panol.work_order_tasks,
  panol.staff,
  panol.work_orders_cold,
  panol.staff_holds
TO anon, authenticated;

-- 3. POLÍTICAS RLS DE LECTURA CONTROLADA EN SCHEMA PANOL
DROP POLICY IF EXISTS pol_panol_wot_read ON panol.work_order_tasks;
CREATE POLICY pol_panol_wot_read ON panol.work_order_tasks 
  FOR SELECT TO anon, authenticated, service_role 
  USING (true);

DROP POLICY IF EXISTS pol_panol_staff_read ON panol.staff;
CREATE POLICY pol_panol_staff_read ON panol.staff 
  FOR SELECT TO anon, authenticated, service_role 
  USING (true);

DROP POLICY IF EXISTS pol_panol_woc_read ON panol.work_orders_cold;
CREATE POLICY pol_panol_woc_read ON panol.work_orders_cold 
  FOR SELECT TO anon, authenticated, service_role 
  USING (true);

DROP POLICY IF EXISTS pol_panol_holds_read ON panol.staff_holds;
CREATE POLICY pol_panol_holds_read ON panol.staff_holds 
  FOR SELECT TO anon, authenticated, service_role 
  USING (true);

-- 4. CONCEDER EJECUCIÓN DEL RPC coord_assign_task Y review_staff_hold
GRANT EXECUTE ON FUNCTION public.coord_assign_task(UUID, TEXT, UUID, BOOLEAN, BOOLEAN) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_staff_hold(UUID) TO anon, authenticated, service_role;

COMMIT;
