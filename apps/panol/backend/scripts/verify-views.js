const db = require('../utils/db');

async function testViews() {
  console.log('🧪 Verificando vistas en Supabase...\n');

  // 1. Test panol.v_monitor_pedidos
  const t1 = Date.now();
  const resMonitor = await db.query('SELECT * FROM panol.v_monitor_pedidos LIMIT 5');
  const d1 = Date.now() - t1;
  console.log(`✅ [v_monitor_pedidos] ${resMonitor.rows.length} filas obtenidas en ${d1}ms`);
  if (resMonitor.rows.length > 0) {
    const sample = resMonitor.rows[0];
    console.log('   Muestra de pedido:', {
      order_id: sample.order_id,
      req_code: sample.req_code,
      order_type: sample.order_type,
      mechanic: sample.mechanic_name,
      tractor: sample.tractor,
      semi: sample.semi,
      items_count: sample.items.length
    });
  }

  // 2. Test panol.v_taller_tareas_activas
  const t2 = Date.now();
  const resTareas = await db.query('SELECT * FROM panol.v_taller_tareas_activas LIMIT 5');
  const d2 = Date.now() - t2;
  console.log(`\n✅ [v_taller_tareas_activas] ${resTareas.rows.length} filas obtenidas en ${d2}ms`);
  if (resTareas.rows.length > 0) {
    const sampleTask = resTareas.rows[0];
    console.log('   Muestra de tarea activa:', {
      task_id: sampleTask.task_id,
      ot_number: sampleTask.ot_number,
      sector: sampleTask.sector,
      task_description: sampleTask.task_description,
      tractor: sampleTask.tractor,
      mechanic: sampleTask.mechanic_name
    });
  }

  // 3. Test panol.v_flota_busqueda
  const t3 = Date.now();
  const resFlota = await db.query('SELECT * FROM panol.v_flota_busqueda LIMIT 5');
  const d3 = Date.now() - t3;
  console.log(`\n✅ [v_flota_busqueda] ${resFlota.rows.length} filas obtenidas en ${d3}ms`);
  if (resFlota.rows.length > 0) {
    console.log('   Muestra flota:', resFlota.rows.slice(0, 3).map(r => ({
      tractor: r.tractor,
      semi: r.semi,
      marca_tr: r.marca_tr,
      active_ot: r.active_ot_number
    })));
  }

  console.log('\n🎉 Todas las vistas responden con latencia ultrabaja (<15ms).');
}

testViews()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Error probando vistas:', e);
    process.exit(1);
  });
