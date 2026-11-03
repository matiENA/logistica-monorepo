const db = require('../utils/db');

async function run() {
  const currentDb = await db.query('SELECT current_database(), current_user, version();');
  console.log('=== DB INFO ===', currentDb.rows[0]);

  // Check schemas in this database
  const schemas = await db.query(`
    SELECT schema_name 
    FROM information_schema.schemata 
    WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast');
  `);
  console.log('\n=== SCHEMAS ===', schemas.rows.map(r => r.schema_name));

  // Check tables in public vs panol
  const tables = await db.query(`
    SELECT table_schema, table_name, table_type
    FROM information_schema.tables 
    WHERE table_schema IN ('panol', 'public')
    ORDER BY table_schema, table_name;
  `);
  console.log('\n=== TABLES & VIEWS ===');
  for (const t of tables.rows) {
    console.log(`${t.table_schema}.${t.table_name} (${t.table_type})`);
  }

  // Check panol.orders columns specifically
  const ordersCols = await db.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'panol' AND table_name = 'orders';
  `);
  console.log('\n=== panol.orders COLUMNS ===', ordersCols.rows.map(r => r.column_name));

  // Check if public has orders or if user is looking at public
  const publicTables = await db.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public';
  `);
  console.log('\n=== public TABLES ===', publicTables.rows.map(r => r.table_name));
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
