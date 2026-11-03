const db = require('../utils/db');
const otsManager = require('../otsManagerService');

async function runIntegrationTests() {
  console.log('--- 1. Testing Database Health ---');
  const health = await db.checkHealth();
  console.log('Health:', health);
  if (!health.ok) throw new Error('Database is not healthy');

  console.log('\n--- 2. Testing Fleet & OTs via otsManagerService ---');
  const unitResult = await otsManager.findUnitOrOt({ query: 'AG225MN', type: 'TRACTOR' });
  console.log('findUnitOrOt by tractor AG225MN:', {
    success: unitResult.success,
    tractor: unitResult.unit,
    ot: unitResult.ot,
    semi: unitResult.semi,
    semiOt: unitResult.semiOt,
    marca: unitResult.marca,
    marcaSemi: unitResult.marcaSemi
  });
  if (!unitResult.success || unitResult.unit !== 'AG225MN') {
    throw new Error('Failed to find unit AG225MN');
  }

  const otResult = await otsManager.findUnitOrOt({ query: '11604', type: 'OT' });
  console.log('findUnitOrOt by semi OT 11604:', {
    success: otResult.success,
    tractor: otResult.unit,
    ot: otResult.ot,
    semi: otResult.semi,
    semiOt: otResult.semiOt
  });
  if (!otResult.success || otResult.semiOt !== '11604') {
    throw new Error('Failed to find unit by semi OT 11604');
  }

  const cat = await otsManager.getFleetSearchCatalog(null, null);
  console.log(`getFleetSearchCatalog: ${cat.count} total pairs, ${cat.tractors.length} tractors, ${cat.semis.length} semis, ${cat.allOts.length} active OTs.`);
  if (cat.count < 100) throw new Error('Expected at least 100 units from Supabase public.unidades');

  console.log('\n--- 3. Testing Supabase Views ---');
  const boardRes = await db.query('SELECT * FROM panol.v_tablero_coordinacion LIMIT 3;');
  console.log(`panol.v_tablero_coordinacion: returned ${boardRes.rows.length} rows.`);
  if (boardRes.rows.length > 0) {
    console.log('Sample Tablero Row:', {
      ot: boardRes.rows[0].ot_number,
      tractor: boardRes.rows[0].tractor,
      semi: boardRes.rows[0].semi,
      servicio: boardRes.rows[0].servicio
    });
  }

  const monitorRes = await db.query('SELECT * FROM panol.v_monitor_pedidos LIMIT 3;');
  console.log(`panol.v_monitor_pedidos: returned ${monitorRes.rows.length} rows.`);
  if (monitorRes.rows.length > 0) {
    const row = monitorRes.rows[0];
    console.log('Sample Monitor Row:', {
      reqCode: row.req_code,
      tractor: row.tractor,
      semi: row.semi,
      mechanic: row.mechanic_name,
      status: row.order_status,
      itemsCount: (row.items || []).length
    });
  }

  console.log('\n--- 4. Testing Table Counts ---');
  const counts = await Promise.all([
    db.query('SELECT count(*) FROM panol.staff'),
    db.query('SELECT count(*) FROM panol.items'),
    db.query('SELECT count(*) FROM panol.work_orders'),
    db.query('SELECT count(*) FROM panol.work_order_tasks'),
    db.query('SELECT count(*) FROM panol.orders'),
    db.query('SELECT count(*) FROM panol.order_items'),
    db.query('SELECT count(*) FROM panol.stock_movements')
  ]);

  console.log({
    staff: counts[0].rows[0].count,
    items: counts[1].rows[0].count,
    work_orders: counts[2].rows[0].count,
    work_order_tasks: counts[3].rows[0].count,
    orders: counts[4].rows[0].count,
    order_items: counts[5].rows[0].count,
    stock_movements: counts[6].rows[0].count
  });

  console.log('\n ALL INTEGRATION TESTS PASSED SUCCESSFULLY! ');
  process.exit(0);
}

runIntegrationTests().catch(err => {
  console.error(' Integration test failed:', err);
  process.exit(1);
});
