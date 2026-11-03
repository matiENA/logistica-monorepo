const db = require('../utils/db');

async function run() {
  const client = await db.getClient();
  try {
    console.log('🚀 Iniciando actualización de claves vehiculares (tractor_id, semi_id) y order_number...');
    await client.query('BEGIN');

    // 1. Agregar tractor_id y semi_id a panol.work_orders
    console.log('1. Agregando tractor_id y semi_id a panol.work_orders...');
    await client.query(`
      ALTER TABLE panol.work_orders
        ADD COLUMN IF NOT EXISTS tractor_id UUID REFERENCES public.tractores(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS semi_id UUID REFERENCES public.semis(id) ON DELETE SET NULL;
    `);

    // Poblar tractor_id y semi_id en las órdenes de trabajo existentes basándose en unidad_id y applied_to
    await client.query(`
      UPDATE panol.work_orders wo
      SET 
        tractor_id = CASE WHEN wo.applied_to = 'TRACTOR' OR wo.applied_to IS NULL THEN u.tractor_id ELSE NULL END,
        semi_id = CASE WHEN wo.applied_to = 'SEMI' THEN u.semi_id ELSE NULL END
      FROM public.unidades u
      WHERE wo.unidad_id = u.id AND (wo.tractor_id IS NULL AND wo.semi_id IS NULL);
    `);

    // 2. Agregar tractor_id, semi_id y order_number a panol.orders
    console.log('2. Agregando tractor_id, semi_id y order_number a panol.orders...');
    await client.query(`
      ALTER TABLE panol.orders
        ADD COLUMN IF NOT EXISTS tractor_id UUID REFERENCES public.tractores(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS semi_id UUID REFERENCES public.semis(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS order_number SERIAL;
    `);

    // Poblar tractor_id y semi_id en pedidos existentes a partir de su unidad_id
    await client.query(`
      UPDATE panol.orders o
      SET 
        tractor_id = COALESCE(o.tractor_id, u.tractor_id),
        semi_id = COALESCE(o.semi_id, u.semi_id)
      FROM public.unidades u
      WHERE o.unidad_id = u.id AND (o.tractor_id IS NULL OR o.semi_id IS NULL);
    `);

    // 3. Actualizar vistas panol.v_monitor_pedidos y panol.v_taller_tareas_activas
    console.log('3. Actualizando vistas con los nuevos IDs vehiculares...');
    await client.query(`DROP VIEW IF EXISTS public.v_monitor_pedidos CASCADE;`);
    await client.query(`DROP VIEW IF EXISTS panol.v_monitor_pedidos CASCADE;`);

    await client.query(`
      CREATE VIEW panol.v_monitor_pedidos AS
      SELECT 
        o.id AS order_id,
        o.order_number,
        o.req_code,
        o.order_type,
        o.parent_order_id,
        o.created_at,
        o.status AS order_status,
        o.box_number,
        o.notes AS order_notes,
        s.id AS mechanic_id,
        s.name AS mechanic_name,
        s.op_code AS mechanic_op_code,
        sp.id AS panol_staff_id,
        sp.name AS panol_staff_name,
        wo.id AS work_order_id,
        wo.ot_number,
        -- IDs vehiculares directos (independientes del acople)
        COALESCE(o.tractor_id, wo.tractor_id, u.tractor_id) AS tractor_id,
        COALESCE(o.semi_id, wo.semi_id, u.semi_id) AS semi_id,
        COALESCE(o.unidad_id, wo.unidad_id) AS unidad_id,
        COALESCE(t.patente, ''::text) AS tractor,
        COALESCE(t.marca, ''::text) AS marca_tr,
        COALESCE(sem.patente, ''::text) AS semi,
        COALESCE(sem.marca, ''::text) AS marca_semi,
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
            ) ORDER BY oi.created_at ASC
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
        o.id, o.order_number, o.req_code, o.order_type, o.parent_order_id, o.created_at, o.status, o.box_number, o.notes,
        s.id, s.name, s.op_code, sp.id, sp.name, wo.id, wo.ot_number,
        COALESCE(o.tractor_id, wo.tractor_id, u.tractor_id),
        COALESCE(o.semi_id, wo.semi_id, u.semi_id),
        COALESCE(o.unidad_id, wo.unidad_id),
        t.patente, t.marca, sem.patente, sem.marca;
    `);

    // Actualizar panol.v_taller_tareas_activas
    await client.query(`DROP VIEW IF EXISTS public.v_taller_tareas_activas CASCADE;`);
    await client.query(`DROP VIEW IF EXISTS panol.v_taller_tareas_activas CASCADE;`);

    await client.query(`
      CREATE VIEW panol.v_taller_tareas_activas AS
      SELECT 
        wot.id AS task_id,
        wot.work_order_id,
        wot.task_index,
        wot.sector,
        wot.description AS task_description,
        wot.status AS task_status,
        wot.assigned_box,
        wot.started_at,
        wot.finished_at,
        wot.estimated_hours,
        wot.actual_hours,
        wo.ot_number,
        wo.status AS ot_status,
        wo.priority AS ot_priority,
        wo.entry_date,
        wo.applied_to,
        -- IDs vehiculares directos
        COALESCE(wo.tractor_id, u.tractor_id) AS tractor_id,
        COALESCE(wo.semi_id, u.semi_id) AS semi_id,
        u.id AS unidad_id,
        u.n_ute,
        COALESCE(t.patente, ''::text) AS tractor,
        COALESCE(t.marca, ''::text) AS marca_tr,
        COALESCE(s.patente, ''::text) AS semi,
        COALESCE(s.marca, ''::text) AS marca_semi,
        st.id AS assigned_staff_id,
        st.name AS mechanic_name,
        st.op_code AS mechanic_op_code
      FROM panol.work_order_tasks wot
      JOIN panol.work_orders wo ON wot.work_order_id = wo.id
      LEFT JOIN public.unidades u ON wo.unidad_id = u.id
      LEFT JOIN public.tractores t ON COALESCE(wo.tractor_id, u.tractor_id) = t.id
      LEFT JOIN public.semis s ON COALESCE(wo.semi_id, u.semi_id) = s.id
      LEFT JOIN panol.staff st ON wot.assigned_staff_id = st.id;
    `);

    // 4. Re-crear vistas espejo en public
    await client.query(`
      CREATE OR REPLACE VIEW public.v_monitor_pedidos AS SELECT * FROM panol.v_monitor_pedidos;
      CREATE OR REPLACE VIEW public.v_taller_tareas_activas AS SELECT * FROM panol.v_taller_tareas_activas;
      CREATE OR REPLACE VIEW public.panol_orders AS SELECT * FROM panol.orders;
      CREATE OR REPLACE VIEW public.panol_work_orders AS SELECT * FROM panol.work_orders;
    `);

    await client.query('COMMIT');
    console.log('✅ Migración de tractor_id, semi_id y order_number ejecutada exitosamente.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en migración:', err);
    throw err;
  } finally {
    client.release();
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
