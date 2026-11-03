const db = require('../utils/db');

async function run() {
  console.log('🚀 Executing schema improvements for panol.orders & panol.work_orders...');

  // 1. Añadir columna ot_number en panol.orders si no existe
  await db.query(`
    ALTER TABLE panol.orders ADD COLUMN IF NOT EXISTS ot_number TEXT;
  `);
  console.log('✅ panol.orders.ot_number ensured.');

  // 2. Poblar ot_number en panol.orders existentes a partir de notes o work_orders
  await db.query(`
    UPDATE panol.orders o
    SET ot_number = COALESCE(
      wo.ot_number,
      substring(o.notes from 'OT(?:\s*Original)?:\s*([0-9]+)'),
      ''
    )
    FROM panol.work_orders wo
    WHERE o.work_order_id = wo.id AND (o.ot_number IS NULL OR o.ot_number = '');
  `);

  await db.query(`
    UPDATE panol.orders
    SET ot_number = COALESCE(substring(notes from 'OT(?:\s*Original)?:\s*([0-9]+)'), '')
    WHERE (ot_number IS NULL OR ot_number = '') AND notes LIKE '%OT%';
  `);
  console.log('✅ ot_number backfilled on existing orders.');

  // 3. Asegurar que panol.work_orders tiene tractor_id y semi_id
  await db.query(`
    ALTER TABLE panol.work_orders ADD COLUMN IF NOT EXISTS tractor_id UUID REFERENCES public.tractores(id);
    ALTER TABLE panol.work_orders ADD COLUMN IF NOT EXISTS semi_id UUID REFERENCES public.semis(id);
  `);

  // 4. Poblar tractor_id y semi_id en work_orders desde unidades si estaban vacíos
  await db.query(`
    UPDATE panol.work_orders wo
    SET 
      tractor_id = COALESCE(wo.tractor_id, u.tractor_id),
      semi_id = COALESCE(wo.semi_id, u.semi_id)
    FROM public.unidades u
    WHERE wo.unidad_id = u.id AND (wo.tractor_id IS NULL OR wo.semi_id IS NULL);
  `);
  console.log('✅ panol.work_orders tractor_id & semi_id backfilled.');

  // 5. Recrear panol.v_monitor_pedidos para vincular directamente tractor_id y semi_id sin depender de unidad_id
  await db.query(`
    DROP VIEW IF EXISTS public.v_monitor_pedidos CASCADE;
    DROP VIEW IF EXISTS panol.v_monitor_pedidos CASCADE;

    CREATE OR REPLACE VIEW panol.v_monitor_pedidos AS
    SELECT 
      o.id AS order_id,
      o.order_number,
      o.req_code,
      o.order_type,
      o.parent_order_id,
      o.created_at,
      o.status AS order_status,
      COALESCE(o.box_number, '01') AS box_number,
      o.notes AS order_notes,
      s.id AS mechanic_id,
      COALESCE(s.name, 'MECÁNICO') AS mechanic_name,
      s.op_code AS mechanic_op_code,
      sp.id AS panol_staff_id,
      sp.name AS panol_staff_name,
      wo.id AS work_order_id,
      COALESCE(o.ot_number, wo.ot_number, substring(o.notes from 'OT(?:\s*Original)?:\s*([0-9]+)'), '') AS ot_number,
      COALESCE(o.tractor_id, wo.tractor_id, u.tractor_id) AS tractor_id,
      COALESCE(o.semi_id, wo.semi_id, u.semi_id) AS semi_id,
      COALESCE(o.unidad_id, wo.unidad_id) AS unidad_id,
      COALESCE(t.patente, '') AS tractor,
      COALESCE(t.marca, '') AS marca_tr,
      COALESCE(sem.patente, '') AS semi,
      COALESCE(sem.marca, '') AS marca_semi,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'order_item_id', oi.id,
            'item_id', i.id,
            'name', i.name,
            'code', i.item_code,
            'qty', oi.quantity,
            'delivered_qty', COALESCE(oi.delivered_qty, 0),
            'returned_qty', COALESCE(oi.returned_qty, 0),
            'location', i.location,
            'requires_exchange', i.requires_exchange,
            'status', oi.status,
            'exchange_status', oi.exchange_status,
            'notes', oi.notes,
            'return_notes', oi.return_notes
          ) ORDER BY oi.created_at
        ) FILTER (WHERE oi.id IS NOT NULL),
        '[]'::jsonb
      ) AS items
    FROM panol.orders o
    LEFT JOIN panol.staff s ON o.mechanic_id = s.id
    LEFT JOIN panol.staff sp ON o.panol_staff_id = sp.id
    LEFT JOIN panol.work_orders wo ON o.work_order_id = wo.id
    LEFT JOIN public.unidades u ON COALESCE(o.unidad_id, wo.unidad_id) = u.id
    LEFT JOIN public.tractores t ON COALESCE(o.tractor_id, wo.tractor_id, u.tractor_id) = t.id
    LEFT JOIN public.semis sem ON COALESCE(o.semi_id, wo.semi_id, u.semi_id) = sem.id
    LEFT JOIN panol.order_items oi ON oi.order_id = o.id
    LEFT JOIN panol.items i ON oi.item_id = i.id
    GROUP BY 
      o.id, o.order_number, o.req_code, o.order_type, o.parent_order_id, o.created_at, 
      o.status, o.box_number, o.notes, o.ot_number,
      s.id, s.name, s.op_code, sp.id, sp.name, 
      wo.id, wo.ot_number,
      COALESCE(o.tractor_id, wo.tractor_id, u.tractor_id),
      COALESCE(o.semi_id, wo.semi_id, u.semi_id),
      COALESCE(o.unidad_id, wo.unidad_id),
      t.patente, t.marca, sem.patente, sem.marca;

    CREATE OR REPLACE VIEW public.v_monitor_pedidos AS SELECT * FROM panol.v_monitor_pedidos;
  `);
  console.log('✅ panol.v_monitor_pedidos & public.v_monitor_pedidos updated.');

  // 6. Recrear panol.v_devoluciones_pendientes para poblar ot_number, box_number, tractor, semi de forma robusta
  await db.query(`
    DROP VIEW IF EXISTS public.v_devoluciones_pendientes CASCADE;
    DROP VIEW IF EXISTS panol.v_devoluciones_pendientes CASCADE;

    CREATE OR REPLACE VIEW panol.v_devoluciones_pendientes AS
    SELECT 
      o.id AS order_id,
      o.order_number,
      o.req_code,
      COALESCE(o.box_number, '01') AS box_number,
      o.status AS order_status,
      o.created_at AS order_created_at,
      s.id AS mechanic_id,
      COALESCE(s.name, 'MECÁNICO') AS mechanic_name,
      s.op_code AS mechanic_op_code,
      sp.id AS panol_staff_id,
      sp.name AS panol_staff_name,
      wo.id AS work_order_id,
      COALESCE(o.ot_number, wo.ot_number, substring(o.notes from 'OT(?:\s*Original)?:\s*([0-9]+)'), '--') AS ot_number,
      COALESCE(t.patente, '') AS tractor,
      COALESCE(t.marca, '') AS marca_tr,
      COALESCE(sem.patente, '') AS semi,
      COALESCE(sem.marca, '') AS marca_semi,
      oi.id AS order_item_id,
      oi.item_id,
      i.name AS item_name,
      i.item_code,
      i.location,
      i.requires_exchange,
      oi.quantity AS requested_qty,
      COALESCE(oi.delivered_qty, oi.quantity) AS delivered_qty,
      COALESCE(oi.returned_qty, 0) AS returned_qty,
      oi.status AS item_status,
      oi.exchange_status,
      COALESCE(oi.panol_confirmation, '') AS panol_confirmation,
      oi.notes AS item_notes,
      oi.return_notes
    FROM panol.order_items oi
    JOIN panol.orders o ON oi.order_id = o.id
    JOIN panol.items i ON oi.item_id = i.id
    LEFT JOIN panol.staff s ON o.mechanic_id = s.id
    LEFT JOIN panol.staff sp ON o.panol_staff_id = sp.id
    LEFT JOIN panol.work_orders wo ON o.work_order_id = wo.id
    LEFT JOIN public.unidades u ON COALESCE(o.unidad_id, wo.unidad_id) = u.id
    LEFT JOIN public.tractores t ON COALESCE(o.tractor_id, wo.tractor_id, u.tractor_id) = t.id
    LEFT JOIN public.semis sem ON COALESCE(o.semi_id, wo.semi_id, u.semi_id) = sem.id
    WHERE (
      i.requires_exchange = true 
      OR (oi.exchange_status IS NOT NULL AND oi.exchange_status != '' AND oi.exchange_status != 'NO_APLICA')
      OR oi.status IN ('DEVOLUCION PENDIENTE', 'DEVUELTO', 'EN_CAMBIO')
    );

    CREATE OR REPLACE VIEW public.v_devoluciones_pendientes AS SELECT * FROM panol.v_devoluciones_pendientes;
  `);
  console.log('✅ panol.v_devoluciones_pendientes & public.v_devoluciones_pendientes updated.');

  // 7. Otorgar permisos
  await db.query(`
    GRANT USAGE ON SCHEMA panol TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA panol TO anon, authenticated, service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA panol TO anon, authenticated, service_role;
    GRANT SELECT ON public.v_monitor_pedidos TO anon, authenticated, service_role;
    GRANT SELECT ON public.v_devoluciones_pendientes TO anon, authenticated, service_role;
  `);
  console.log('✅ Permissions granted.');
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
