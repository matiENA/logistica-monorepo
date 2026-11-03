const db = require('../utils/db');

async function exposeViewsInPublic() {
  const client = await db.getClient();
  try {
    console.log('🔗 Creando vistas espejo en esquema public para visibilidad total en el Table Editor de Supabase...');
    await client.query('BEGIN');

    // Vistas operativas en public
    await client.query(`
      CREATE OR REPLACE VIEW public.v_monitor_pedidos AS 
      SELECT * FROM panol.v_monitor_pedidos;

      CREATE OR REPLACE VIEW public.v_taller_tareas_activas AS 
      SELECT * FROM panol.v_taller_tareas_activas;

      CREATE OR REPLACE VIEW public.v_flota_busqueda AS 
      SELECT * FROM panol.v_flota_busqueda;

      CREATE OR REPLACE VIEW public.v_tablero_coordinacion AS 
      SELECT * FROM panol.v_tablero_coordinacion;
    `);

    // Vistas espejo de las tablas en public para que aparezcan en el Table Editor de public
    await client.query(`
      CREATE OR REPLACE VIEW public.panol_orders AS 
      SELECT * FROM panol.orders;

      CREATE OR REPLACE VIEW public.panol_order_items AS 
      SELECT * FROM panol.order_items;

      CREATE OR REPLACE VIEW public.panol_items AS 
      SELECT * FROM panol.items;

      CREATE OR REPLACE VIEW public.panol_work_orders AS 
      SELECT * FROM panol.work_orders;

      CREATE OR REPLACE VIEW public.panol_work_order_tasks AS 
      SELECT * FROM panol.work_order_tasks;

      CREATE OR REPLACE VIEW public.panol_staff AS 
      SELECT * FROM panol.staff;

      CREATE OR REPLACE VIEW public.panol_stock_movements AS 
      SELECT * FROM panol.stock_movements;
    `);

    // Otorgar permisos de lectura y escritura al rol anon y authenticated de Supabase
    await client.query(`
      GRANT USAGE ON SCHEMA panol TO anon, authenticated, service_role;
      GRANT ALL ON ALL TABLES IN SCHEMA panol TO anon, authenticated, service_role;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA panol TO anon, authenticated, service_role;
      GRANT ALL ON ALL ROUTINES IN SCHEMA panol TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA panol GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA panol GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    `);

    await client.query('COMMIT');
    console.log('✅ Vistas espejo y permisos otorgados exitosamente en public y panol.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error exponiendo vistas en public:', err);
    throw err;
  } finally {
    client.release();
  }
}

exposeViewsInPublic()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
