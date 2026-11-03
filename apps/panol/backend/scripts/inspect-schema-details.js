const db = require('../utils/db');

async function run() {
  const res = await db.query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'panol'
    ORDER BY table_name, ordinal_position;
  `);
  const tables = {};
  for (const r of res.rows) {
    if (!tables[r.table_name]) tables[r.table_name] = [];
    tables[r.table_name].push(`${r.column_name} (${r.data_type})`);
  }
  for (const [t, cols] of Object.entries(tables)) {
    console.log(`\n=== ${t} ===\n${cols.join(', ')}`);
  }

  // Also check foreign keys
  const fks = await db.query(`
    SELECT
      tc.table_schema, 
      tc.table_name, 
      kcu.column_name, 
      ccu.table_schema AS foreign_table_schema,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name 
    FROM information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'panol';
  `);
  console.log('\n=== FOREIGN KEYS ===');
  for (const fk of fks.rows) {
    console.log(`${fk.table_name}.${fk.column_name} -> ${fk.foreign_table_schema}.${fk.foreign_table_name}.${fk.foreign_column_name}`);
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
