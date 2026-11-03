const db = require('../utils/db');

async function inspectColumns() {
  const query = `
    SELECT 
      table_name, 
      column_name, 
      data_type, 
      is_nullable,
      column_default
    FROM information_schema.columns 
    WHERE table_schema = 'panol'
    ORDER BY table_name, ordinal_position;
  `;
  const res = await db.query(query);
  const byTable = {};
  res.rows.forEach(r => {
    if (!byTable[r.table_name]) byTable[r.table_name] = [];
    byTable[r.table_name].push(`${r.column_name} (${r.data_type}${r.is_nullable === 'NO' ? ' NOT NULL' : ''}${r.column_default ? ' DEFAULT ' + r.column_default : ''})`);
  });

  for (const [table, cols] of Object.entries(byTable)) {
    console.log(`\n=== panol.${table} ===`);
    cols.forEach(c => console.log(`  - ${c}`));
  }

  process.exit(0);
}

inspectColumns().catch(e => { console.error(e); process.exit(1); });
