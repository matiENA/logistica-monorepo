const db = require('../utils/db');

async function checkViews() {
  const v1 = await db.query("SELECT pg_get_viewdef('panol.v_monitor_pedidos', true);");
  console.log('=== panol.v_monitor_pedidos definition ===\n', v1.rows[0]?.pg_get_viewdef);
  const v2 = await db.query("SELECT pg_get_viewdef('panol.v_tablero_coordinacion', true);");
  console.log('\n=== panol.v_tablero_coordinacion definition ===\n', v2.rows[0]?.pg_get_viewdef);
  process.exit(0);
}

checkViews().catch(e => { console.error(e); process.exit(1); });
