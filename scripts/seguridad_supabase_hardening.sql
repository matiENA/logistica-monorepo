-- ==============================================================================
-- 🛡️ HARDENING Y DELIMITACIÓN DE SEGURIDAD EN SUPABASE / POSTGRESQL 17
-- Proyectos: DASH | EOR | PAÑOL | BACKEND
-- Objetivo:
--   1. Eliminar vistas sin seguridad (security_invoker = true en todas las vistas).
--   2. Habilitar RLS en todas las tablas base de public y panol.
--   3. Revocar privilegios destructivos y de mutación a 'anon'.
--   4. Delimitar accesos de usuarios (anon vs authenticated vs service_role).
--   5. Proteger 'usuarios_auth' e implementar login seguro vía RPC fn_auth_login.
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- FASE 1: HABILITAR ROW LEVEL SECURITY (RLS) EN TODAS LAS TABLAS BASE
-- ==============================================================================

-- 1.1 Esquema 'panol'
ALTER TABLE IF EXISTS panol.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS panol.order_items_legacy_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS panol.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS panol.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS panol.staff_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS panol.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS panol.unit_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS panol.work_order_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS panol.work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS panol.work_orders_cold ENABLE ROW LEVEL SECURITY;

-- 1.2 Esquema 'public'
ALTER TABLE IF EXISTS public.chofer_documentacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.chofer_observaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.choferes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.choferes_km_mensual ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cisternas_km ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.dash ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.dash_menciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.diagramas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.eor ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.eor_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.log_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.novedades ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.panol ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.seguridad_vial ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.seguridad_vial_incidentes_ijl ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.semis ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.servicios_choferes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.servicios_unidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.terminales ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tipos_novedad ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tractores ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.unidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.usuarios_auth ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- FASE 2: TODAS LAS VISTAS CON SEGURIDAD (SECURITY_INVOKER = TRUE)
-- ==============================================================================

-- 2.1 Vistas de panol
ALTER VIEW IF EXISTS panol.order_items SET (security_invoker = true);
ALTER VIEW IF EXISTS panol.v_coord_kanban_progreso SET (security_invoker = true);
ALTER VIEW IF EXISTS panol.v_coord_kanban_terminados SET (security_invoker = true);
ALTER VIEW IF EXISTS panol.v_coord_unit_tasks SET (security_invoker = true);
ALTER VIEW IF EXISTS panol.v_devoluciones_pendientes SET (security_invoker = true);
ALTER VIEW IF EXISTS panol.v_flota_busqueda SET (security_invoker = true);
ALTER VIEW IF EXISTS panol.v_monitor_pedidos SET (security_invoker = true);
ALTER VIEW IF EXISTS panol.v_staff_holds SET (security_invoker = true);
ALTER VIEW IF EXISTS panol.v_stock_movements SET (security_invoker = true);
ALTER VIEW IF EXISTS panol.v_tablero_coordinacion SET (security_invoker = true);

-- 2.2 Vistas de public
ALTER VIEW IF EXISTS public.panol_items SET (security_invoker = true);
ALTER VIEW IF EXISTS public.panol_order_items SET (security_invoker = true);
ALTER VIEW IF EXISTS public.panol_orders SET (security_invoker = true);
ALTER VIEW IF EXISTS public.panol_staff SET (security_invoker = true);
ALTER VIEW IF EXISTS public.panol_stock_movements SET (security_invoker = true);
ALTER VIEW IF EXISTS public.panol_work_order_tasks SET (security_invoker = true);
ALTER VIEW IF EXISTS public.panol_work_orders SET (security_invoker = true);
ALTER VIEW IF EXISTS public.v_coord_kanban_progreso SET (security_invoker = true);
ALTER VIEW IF EXISTS public.v_coord_kanban_terminados SET (security_invoker = true);
ALTER VIEW IF EXISTS public.v_coord_unit_tasks SET (security_invoker = true);
ALTER VIEW IF EXISTS public.v_staff_holds SET (security_invoker = true);
ALTER VIEW IF EXISTS public.v_stock_movements SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_calendario_diagrama_km SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_calendario_diagrama_km_12m SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_calendario_diagrama_km_2m SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_cards_diarias SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_dash_flota SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_dash_novedades SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_dash_usuarios SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_dashboard_kpis SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_diagrama_mensual SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_diaria_operativa SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_flota_operativa SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_individual_chofer SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_movimientos SET (security_invoker = true);
ALTER VIEW IF EXISTS public.view_personal_retorno SET (security_invoker = true);

-- ==============================================================================
-- FASE 3: PURGA DE PRIVILEGIOS DESTRUCTIVOS DEL ROL 'ANON'
-- ==============================================================================

-- Revocar permisos masivos en esquemas
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA panol FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA panol FROM anon;

-- Proteger estrictamente usuarios_auth para que 'anon' jamás pueda volcar contraseñas
REVOKE ALL ON TABLE public.usuarios_auth FROM anon, public;

-- ==============================================================================
-- FASE 4: CONCESIÓN DE PRIVILEGIOS DELIMITADOS (LEAST PRIVILEGE)
-- ==============================================================================

-- 4.1 'anon' (Visitantes no autenticados en Supabase PostgREST)
-- Solo lectura de vistas operativas y tablas canónicas que las componen
GRANT SELECT ON TABLE
  public.view_cards_diarias,
  public.view_dash_flota,
  public.view_dash_novedades,
  public.view_dash_usuarios,
  public.view_dashboard_kpis,
  public.view_diagrama_mensual,
  public.view_diaria_operativa,
  public.view_flota_operativa,
  public.view_individual_chofer,
  public.view_movimientos,
  public.view_personal_retorno,
  public.view_calendario_diagrama_km,
  public.view_calendario_diagrama_km_2m,
  public.view_calendario_diagrama_km_12m
TO anon;

GRANT SELECT ON TABLE
  public.chofer_documentacion,
  public.chofer_observaciones,
  public.choferes,
  public.choferes_km_mensual,
  public.cisternas_km,
  public.diagramas,
  public.movimientos,
  public.novedades,
  public.semis,
  public.servicios_choferes,
  public.servicios_unidades,
  public.terminales,
  public.tipos_novedad,
  public.tractores,
  public.unidades,
  panol.unit_work_orders,
  panol.work_orders
TO anon;

-- 4.2 'authenticated' (Operadores y supervisores con sesión válida)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA panol TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA panol TO authenticated;

-- Permisos de mutación controlados para roles autenticados
GRANT INSERT, UPDATE, DELETE ON TABLE
  public.movimientos,
  public.novedades,
  public.choferes,
  public.unidades,
  public.chofer_observaciones,
  public.eor_sync_queue,
  public.terminales,
  public.tipos_novedad
TO authenticated;

GRANT INSERT, UPDATE, DELETE ON TABLE
  panol.items,
  panol.orders,
  panol.order_items_legacy_backup,
  panol.staff,
  panol.staff_holds,
  panol.stock_movements,
  panol.unit_work_orders,
  panol.work_order_tasks,
  panol.work_orders,
  panol.work_orders_cold
TO authenticated;

-- 4.3 'service_role' (Servicios backend Render, Node.js Gateway, Python APScheduler)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA panol TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA panol TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA panol TO service_role;

-- ==============================================================================
-- FASE 5: REEMPLAZO DE POLÍTICAS RLS BLANKET POR POLÍTICAS GRANULARES
-- ==============================================================================

-- 5.1 Eliminar políticas previas 'Permitir todo...'
DROP POLICY IF EXISTS "Permitir todo panol items" ON panol.items;
DROP POLICY IF EXISTS "Permitir todo panol order_items" ON panol.order_items_legacy_backup;
DROP POLICY IF EXISTS "Permitir todo panol orders" ON panol.orders;
DROP POLICY IF EXISTS "Permitir todo panol staff" ON panol.staff;
DROP POLICY IF EXISTS "Permitir todo panol staff_holds" ON panol.staff_holds;
DROP POLICY IF EXISTS "Permitir todo panol stock_movements" ON panol.stock_movements;
DROP POLICY IF EXISTS "Permitir todo en chofer_documentacion" ON public.chofer_documentacion;
DROP POLICY IF EXISTS "Permitir todo en chofer_observaciones" ON public.chofer_observaciones;
DROP POLICY IF EXISTS "Permitir todo en choferes" ON public.choferes;
DROP POLICY IF EXISTS "Permitir todo en choferes_km_mensual" ON public.choferes_km_mensual;
DROP POLICY IF EXISTS "Permitir todo en cisternas_km" ON public.cisternas_km;
DROP POLICY IF EXISTS "Permitir lectura dash" ON public.dash;
DROP POLICY IF EXISTS "Permitir todo en dash_menciones" ON public.dash_menciones;
DROP POLICY IF EXISTS "Permitir todo en diagramas" ON public.diagramas;
DROP POLICY IF EXISTS "Permitir lectura eor" ON public.eor;
DROP POLICY IF EXISTS "Permitir todo en eor_sync_queue" ON public.eor_sync_queue;
DROP POLICY IF EXISTS "Permitir todo en log_queries" ON public.log_queries;
DROP POLICY IF EXISTS "Permitir todo en movimientos" ON public.movimientos;
DROP POLICY IF EXISTS "Permitir todo en novedades" ON public.novedades;
DROP POLICY IF EXISTS "Permitir acceso panol" ON public.panol;
DROP POLICY IF EXISTS "Permitir todo en semis" ON public.semis;
DROP POLICY IF EXISTS "Permitir todo en servicios_choferes" ON public.servicios_choferes;
DROP POLICY IF EXISTS "Permitir todo en servicios_unidades" ON public.servicios_unidades;
DROP POLICY IF EXISTS "Lectura publica terminales" ON public.terminales;
DROP POLICY IF EXISTS "Modificacion terminales authenticated" ON public.terminales;
DROP POLICY IF EXISTS "Lectura pública de tipos_novedad" ON public.tipos_novedad;
DROP POLICY IF EXISTS "Modificación tipos_novedad" ON public.tipos_novedad;
DROP POLICY IF EXISTS "Permitir todo en tractores" ON public.tractores;
DROP POLICY IF EXISTS "Permitir todo en unidades" ON public.unidades;
DROP POLICY IF EXISTS "Permitir todo en usuarios_auth" ON public.usuarios_auth;

-- 5.2 Políticas granulares para tablas operativas públicas
-- Lectura: anon, authenticated, service_role
-- Escritura: authenticated, service_role
DO $$
DECLARE
  t text;
  op_tables text[] := ARRAY[
    'choferes', 'unidades', 'semis', 'tractores', 'movimientos', 
    'novedades', 'diagramas', 'chofer_documentacion', 'chofer_observaciones', 
    'cisternas_km', 'choferes_km_mensual', 'servicios_choferes', 
    'servicios_unidades', 'terminales', 'tipos_novedad', 'seguridad_vial', 
    'seguridad_vial_incidentes_ijl'
  ];
BEGIN
  FOREACH t IN ARRAY op_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS pol_read_operational ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS pol_write_operational ON public.%I', t);
    
    EXECUTE format('CREATE POLICY pol_read_operational ON public.%I FOR SELECT TO anon, authenticated, service_role USING (true)', t);
    EXECUTE format('CREATE POLICY pol_write_operational ON public.%I FOR ALL TO authenticated, service_role USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- 5.3 Tablas administrativas / seguridad: Solo authenticated y service_role
DO $$
DECLARE
  t text;
  admin_tables text[] := ARRAY['usuarios_auth', 'eor_sync_queue', 'log_queries', 'dash_menciones', 'dash', 'eor', 'panol'];
BEGIN
  FOREACH t IN ARRAY admin_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS pol_admin_restricted ON public.%I', t);
    EXECUTE format('CREATE POLICY pol_admin_restricted ON public.%I FOR ALL TO authenticated, service_role USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- 5.4 Políticas para tablas de 'panol'
-- unit_work_orders y work_orders permiten SELECT a anon para que la vista v_flota_operativa funcione
DROP POLICY IF EXISTS pol_panol_uwo_read ON panol.unit_work_orders;
DROP POLICY IF EXISTS pol_panol_uwo_write ON panol.unit_work_orders;
CREATE POLICY pol_panol_uwo_read ON panol.unit_work_orders FOR SELECT TO anon, authenticated, service_role USING (true);
CREATE POLICY pol_panol_uwo_write ON panol.unit_work_orders FOR ALL TO authenticated, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS pol_panol_wo_read ON panol.work_orders;
DROP POLICY IF EXISTS pol_panol_wo_write ON panol.work_orders;
CREATE POLICY pol_panol_wo_read ON panol.work_orders FOR SELECT TO anon, authenticated, service_role USING (true);
CREATE POLICY pol_panol_wo_write ON panol.work_orders FOR ALL TO authenticated, service_role USING (true) WITH CHECK (true);

-- Demás tablas de panol: solo authenticated y service_role
DO $$
DECLARE
  t text;
  panol_internal text[] := ARRAY['items', 'orders', 'order_items_legacy_backup', 'staff', 'staff_holds', 'stock_movements', 'work_order_tasks', 'work_orders_cold'];
BEGIN
  FOREACH t IN ARRAY panol_internal LOOP
    EXECUTE format('DROP POLICY IF EXISTS pol_panol_internal ON panol.%I', t);
    EXECUTE format('CREATE POLICY pol_panol_internal ON panol.%I FOR ALL TO authenticated, service_role USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- ==============================================================================
-- FASE 6: RPC DE AUTENTICACIÓN SEGURA (SECURITY DEFINER)
-- ==============================================================================
-- Permite autenticar sin exponer la tabla 'usuarios_auth' a consultas SELECT directas
CREATE OR REPLACE FUNCTION public.fn_auth_login(p_usuario text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
BEGIN
  SELECT id, usuario, rol INTO v_user
  FROM public.usuarios_auth
  WHERE LOWER(TRIM(usuario)) = LOWER(TRIM(p_usuario))
    AND password = p_password
  LIMIT 1;

  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Credenciales inválidas');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_user.id,
    'usuario', UPPER(v_user.usuario),
    'rol', COALESCE(v_user.rol, 'operador'),
    'token', 'auth_' || v_user.id || '_' || EXTRACT(EPOCH FROM NOW())::bigint
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_auth_login(text, text) TO anon, authenticated, service_role;

COMMIT;
