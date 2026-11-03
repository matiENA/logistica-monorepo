const db = require('../utils/db');

async function run() {
  const updateRes = await db.query(`
    UPDATE panol.orders
    SET ot_number = trim(substring(notes from 'OT(?:\\s*Original)?:\\s*([0-9/ ]+?)(?:\\s*\\||$)'))
    WHERE (ot_number IS NULL OR ot_number = '') AND notes LIKE '%OT%';
  `);
  console.log('✅ Updated orders with extracted ot_number:', updateRes.rowCount);

  const check = await db.query(`
    SELECT req_code, ot_number, box_number, notes FROM panol.orders ORDER BY created_at DESC LIMIT 10;
  `);
  console.table(check.rows);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
