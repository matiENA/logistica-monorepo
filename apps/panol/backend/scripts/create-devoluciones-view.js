const db = require('../utils/db');

async function createDevolucionesView() {
  const client = await db.getClient();
  try {
    console.log('🚀 Creando vista panol.v_devoluciones_pendientes en Supabase...');
    await client.query('BEGIN');

    await client.query(`DROP VIEW IF EXISTS public.v_devoluciones_pendientes CASCADE;`);
    await client.query(`DROP VIEW IF EXISTS panol.v_devoluciones_pendientes CASCADE;`);

    await client.query(`
      CREATE VIEW panol.v_devoluciones_pendientes AS
      SELECT 
        o.id AS order_id,
        o.order_number,
        o.req_code,
        o.box_number,
        o.status AS order_status,
        o.created_at AS order_created_at,
        -- Mecánico
        s.id AS mechanic_id,
        s.name AS mechanic_name,
        s.op_code AS mechanic_op_code,
        -- Pañolero asignado o auditor
        sp.id AS panol_staff_id,
        sp.name AS panol_staff_name,
        -- Orden de trabajo
        wo.id AS work_order_id,
        COALESCE(wo.ot_number, '') AS ot_number,
        -- Vehículos
        COALESCE(t.patente, '') AS tractor,
        COALESCE(t.marca, '') AS marca_tr,
        COALESCE(sem.patente, '') AS semi,
        COALESCE(sem.marca, '') AS marca_semi,
        -- Ítem de Pedido
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
      WHERE 
        (
          i.requires_exchange = true 
          OR (oi.exchange_status IS NOT NULL AND oi.exchange_status != '' AND oi.exchange_status != 'NO_APLICA')
          OR oi.status IN ('DEVOLUCION PENDIENTE', 'DEVUELTO', 'EN_CAMBIO')
        );
    `);

    // Crear vista espejo en public
    await client.query(`
      CREATE OR REPLACE VIEW public.v_devoluciones_pendientes AS 
      SELECT * FROM panol.v_devoluciones_pendientes;
    `);

    // Otorgar permisos
    await client.query(`
      GRANT SELECT ON panol.v_devoluciones_pendientes TO anon, authenticated, service_role;
      GRANT SELECT ON public.v_devoluciones_pendientes TO anon, authenticated, service_role;
    `);

    await client.query('COMMIT');
    console.log('✅ Vista panol.v_devoluciones_pendientes creada y expuesta exitosamente.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error creando vista devoluciones:', err);
    throw err;
  } finally {
    client.release();
  }
}

createDevolucionesView()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
