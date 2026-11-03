const db = require('../utils/db');

async function main() {
  console.log('🐘 Migrating panol.staff_holds and creating views...');

  // 1. Allow work_order_id to be NULL in panol.staff_holds
  await db.query(`
    ALTER TABLE panol.staff_holds ALTER COLUMN work_order_id DROP NOT NULL;
  `);

  // 2. Add tractor_id, semi_id, ot_number, semi_ot to panol.staff_holds if they don't exist
  await db.query(`
    ALTER TABLE panol.staff_holds
      ADD COLUMN IF NOT EXISTS tractor_id UUID REFERENCES public.tractores(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS semi_id UUID REFERENCES public.semis(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS ot_number TEXT,
      ADD COLUMN IF NOT EXISTS semi_ot TEXT,
      ADD COLUMN IF NOT EXISTS tractor_plate TEXT,
      ADD COLUMN IF NOT EXISTS semi_plate TEXT;
  `);

  // 3. Create or replace panol.v_staff_holds view
  await db.query(`
    CREATE OR REPLACE VIEW panol.v_staff_holds AS
    SELECT 
      sh.id AS hold_id,
      sh.staff_id,
      s.op_code,
      s.name AS staff_name,
      sh.work_order_id,
      COALESCE(wo.ot_number, sh.ot_number, '') AS tractor_ot,
      COALESCE(sh.semi_ot, '') AS semi_ot,
      COALESCE(t.patente, sh.tractor_plate, '') AS tractor_plate,
      COALESCE(t.marca, '') AS tractor_brand,
      COALESCE(sm.patente, sh.semi_plate, '') AS semi_plate,
      COALESCE(sm.marca, '') AS semi_brand,
      sh.created_at
    FROM panol.staff_holds sh
    JOIN panol.staff s ON sh.staff_id = s.id
    LEFT JOIN panol.work_orders wo ON sh.work_order_id = wo.id
    LEFT JOIN public.tractores t ON COALESCE(wo.tractor_id, sh.tractor_id) = t.id
    LEFT JOIN public.semis sm ON COALESCE(wo.semi_id, sh.semi_id) = sm.id;

    CREATE OR REPLACE VIEW public.v_staff_holds AS
    SELECT * FROM panol.v_staff_holds;
  `);

  console.log('✅ panol.v_staff_holds created successfully.');

  // Quick check
  const test = await db.query('SELECT * FROM panol.v_staff_holds LIMIT 5;');
  console.log('v_staff_holds rows count:', test.rows.length);

  process.exit(0);
}

main().catch(e => {
  console.error('❌ Error during staff_holds migration:', e);
  process.exit(1);
});
