const db = require('../utils/db');

async function run() {
  const q = await db.query(`
    SELECT o.id, o.req_code, o.box_number, o.notes, o.tractor_id, o.semi_id, o.work_order_id, i.name, oi.exchange_status, o.created_at
    FROM panol.orders o
    JOIN panol.order_items oi ON oi.order_id = o.id
    JOIN panol.items i ON oi.item_id = i.id
    WHERE upper(i.name) LIKE '%BATERIA 12V X 100%'
    ORDER BY o.created_at DESC;
  `);
  console.log('--- ORDERS CONTAINING BATERIA 12V X 100 ---');
  console.table(q.rows);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
