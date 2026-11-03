const db = require('../utils/db');

async function inspect() {
  console.log('--- INSPECTING SUPABASE POSTGRESQL ---');
  const schemas = await db.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('public', 'panol');");
  console.log('Schemas:', schemas.rows.map(r => r.schema_name));

  const tables = await db.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN ('public', 'panol') ORDER BY table_schema, table_name;");
  console.log('\nTables:');
  tables.rows.forEach(r => console.log(` - ${r.table_schema}.${r.table_name}`));

  const views = await db.query("SELECT table_schema, table_name FROM information_schema.views WHERE table_schema IN ('public', 'panol') ORDER BY table_schema, table_name;");
  console.log('\nViews:');
  views.rows.forEach(r => console.log(` - ${r.table_schema}.${r.table_name}`));

  process.exit(0);
}

inspect().catch(err => {
  console.error('Error inspecting db:', err);
  process.exit(1);
});
