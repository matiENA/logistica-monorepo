const db = require('../utils/db');

async function run() {
  const o = await db.query(`
    SELECT column_name, data_type, column_default 
    FROM information_schema.columns 
    WHERE table_schema = 'panol' AND table_name = 'orders'
    ORDER BY ordinal_position;
  `);
  console.log('=== panol.orders columns ===');
  console.table(o.rows);

  const wo = await db.query(`
    SELECT column_name, data_type, column_default 
    FROM information_schema.columns 
    WHERE table_schema = 'panol' AND table_name = 'work_orders'
    ORDER BY ordinal_position;
  `);
  console.log('\n=== panol.work_orders columns ===');
  console.table(wo.rows);

  const wot = await db.query(`
    SELECT column_name, data_type, column_default 
    FROM information_schema.columns 
    WHERE table_schema = 'panol' AND table_name = 'work_order_tasks'
    ORDER BY ordinal_position;
  `);
  console.log('\n=== panol.work_order_tasks columns ===');
  console.table(wot.rows);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
