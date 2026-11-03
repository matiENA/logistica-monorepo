const db = require('../utils/db');

async function main() {
  const r = await db.query(`
    SELECT conname, pg_get_constraintdef(c.oid) as def
    FROM pg_constraint c 
    JOIN pg_namespace n ON n.oid = c.connamespace 
    WHERE n.nspname = 'panol' AND conrelid = 'panol.staff_holds'::regclass;
  `);
  console.log('--- Constraints on panol.staff_holds ---');
  console.table(r.rows);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
