const db = require('../utils/db');

async function migrate() {
  const client = await db.getClient();
  try {
    console.log('🚀 Iniciando migración de esquema y vistas en panol...');
    await client.query('BEGIN');

    // 1. ALTER panol.orders (campos para devoluciones/canjes y normalización)
    console.log('1. Actualizando panol.orders...');
    await client.query(`
      ALTER TABLE panol.orders 
        ADD COLUMN IF NOT EXISTS order_type VARCHAR(30) DEFAULT 'PEDIDO',
        ADD COLUMN IF NOT EXISTS parent_order_id UUID REFERENCES panol.orders(id) ON DELETE SET NULL;
    `);

    // 2. ALTER panol.order_items (cantidades devueltas/entregadas)
    console.log('2. Actualizando panol.order_items...');
    await client.query(`
      ALTER TABLE panol.order_items 
        ADD COLUMN IF NOT EXISTS delivered_qty NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS returned_qty NUMERIC DEFAULT 0;
    `);

    // 3. ALTER panol.work_orders (prioridad y notas)
    console.log('3. Actualizando panol.work_orders...');
    await client.query(`
      ALTER TABLE panol.work_orders 
        ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'MEDIA',
        ADD COLUMN IF NOT EXISTS notes TEXT,
        ADD COLUMN IF NOT EXISTS mechanic_id UUID REFERENCES panol.staff(id) ON DELETE SET NULL;
    `);

    // 4. ALTER panol.work_order_tasks (horas estimadas/reales)
    console.log('4. Actualizando panol.work_order_tasks...');
    await client.query(`
      ALTER TABLE panol.work_order_tasks 
        ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(5,2),
        ADD COLUMN IF NOT EXISTS actual_hours NUMERIC(5,2);
    `);

    // 5. ALTER panol.items (stock mínimo)
    console.log('5. Actualizando panol.items...');
    await client.query(`
      ALTER TABLE panol.items 
        ADD COLUMN IF NOT EXISTS stock_min NUMERIC DEFAULT 0;
    `);

    // 6. CREAR/ACTUALIZAR VISTA: panol.v_monitor_pedidos
    console.log('6. Reemplazando panol.v_monitor_pedidos...');
    await client.query(`DROP VIEW IF EXISTS panol.v_monitor_pedidos CASCADE;`);
    await client.query(`
      CREATE VIEW panol.v_monitor_pedidos AS
      SELECT 
        o.id AS order_id,
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
      LEFT JOIN public.tractores t ON u.tractor_id = t.id
      LEFT JOIN public.semis sem ON u.semi_id = sem.id
      LEFT JOIN panol.order_items oi ON oi.order_id = o.id
      LEFT JOIN panol.items i ON oi.item_id = i.id
      GROUP BY 
        o.id, o.req_code, o.order_type, o.parent_order_id, o.created_at, o.status, o.box_number, o.notes,
        s.id, s.name, s.op_code, sp.id, sp.name, wo.id, wo.ot_number,
        COALESCE(o.unidad_id, wo.unidad_id), t.patente, t.marca, sem.patente, sem.marca;
    `);

    // 7. CREAR VISTA: panol.v_taller_tareas_activas
    console.log('7. Creando panol.v_taller_tareas_activas...');
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
      LEFT JOIN public.tractores t ON u.tractor_id = t.id
      LEFT JOIN public.semis s ON u.semi_id = s.id
      LEFT JOIN panol.staff st ON wot.assigned_staff_id = st.id;
    `);

    // 8. CREAR VISTA: panol.v_flota_busqueda
    console.log('8. Creando panol.v_flota_busqueda...');
    await client.query(`DROP VIEW IF EXISTS panol.v_flota_busqueda CASCADE;`);
    await client.query(`
      CREATE VIEW panol.v_flota_busqueda AS
      SELECT 
        u.id AS unidad_id,
        u.n_ute,
        COALESCE(t.patente, ''::text) AS tractor,
        COALESCE(t.marca, ''::text) AS marca_tr,
        COALESCE(s.patente, ''::text) AS semi,
        COALESCE(s.marca, ''::text) AS marca_semi,
        COALESCE(su.denominacion, 'GENERAL'::text) AS servicio,
        COALESCE(u.estado, 'disponible'::text) AS estado_unidad,
        wo.id AS active_work_order_id,
        wo.ot_number AS active_ot_number,
        wo.status AS active_ot_status
      FROM public.unidades u
      LEFT JOIN public.tractores t ON u.tractor_id = t.id
      LEFT JOIN public.semis s ON u.semi_id = s.id
      LEFT JOIN public.servicios_unidades su ON u.servicio_id = su.id
      LEFT JOIN LATERAL (
        SELECT id, ot_number, status
        FROM panol.work_orders 
        WHERE unidad_id = u.id AND status IN ('ABIERTA', 'ACTIVA', 'EN_PROCESO', 'ESPERA_REPUESTO')
        ORDER BY created_at DESC
        LIMIT 1
      ) wo ON true;
    `);

    // 9. ÍNDICES DE RENDIMIENTO (B-TREE)
    console.log('9. Asegurando índices de alto rendimiento...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON panol.order_items(order_id);
      CREATE INDEX IF NOT EXISTS idx_order_items_item_id ON panol.order_items(item_id);
      CREATE INDEX IF NOT EXISTS idx_orders_work_order_id ON panol.orders(work_order_id);
      CREATE INDEX IF NOT EXISTS idx_orders_mechanic_id ON panol.orders(mechanic_id);
      CREATE INDEX IF NOT EXISTS idx_work_order_tasks_wo_id ON panol.work_order_tasks(work_order_id);
      CREATE INDEX IF NOT EXISTS idx_work_orders_unidad_id ON panol.work_orders(unidad_id);
      CREATE INDEX IF NOT EXISTS idx_work_orders_ot_number ON panol.work_orders(ot_number);
      CREATE INDEX IF NOT EXISTS idx_items_code ON panol.items(item_code);
    `);

    await client.query('COMMIT');
    console.log('✅ Migración ejecutada exitosamente y confirmada (COMMIT).');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en la migración, se ejecutó ROLLBACK:', err);
    throw err;
  } finally {
    client.release();
  }
}

migrate()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
