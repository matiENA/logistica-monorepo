const db = require('../utils/db');

async function main() {
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_holds_staff_tractor 
    ON panol.staff_holds (staff_id, tractor_id) 
    WHERE tractor_id IS NOT NULL;
  `);
  console.log('✅ Unique index created.');
  process.exit(0);
}

main().catch(e => {
  console.error('❌ Error creating index:', e);
  process.exit(1);
});
