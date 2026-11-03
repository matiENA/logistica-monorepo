const db = require('../utils/db');

async function run() {
  const res = await db.query(`
    SELECT viewname, definition 
    FROM pg_views 
    WHERE schemaname = 'panol';
  `);
  for (const r of res.rows) {
    console.log(`\n=== ${r.viewname} ===`);
    console.log(r.definition);
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
