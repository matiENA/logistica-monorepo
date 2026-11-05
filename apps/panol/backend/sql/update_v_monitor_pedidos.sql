CREATE OR REPLACE VIEW panol.v_monitor_pedidos AS
 SELECT o.id AS order_id,
    o.order_number,
    o.req_code,
    o.order_type,
    o.parent_order_id,
    o.created_at,
    o.ready_at,
    o.status AS order_status,
    COALESCE(o.box_number, '01'::text) AS box_number,
    o.notes AS order_notes,
    s.id AS mechanic_id,
    COALESCE(s.name, 'MECÁNICO'::text) AS mechanic_name,
    s.op_code AS mechanic_op_code,
    sp.id AS panol_staff_id,
    sp.name AS panol_staff_name,
    wo.id AS work_order_id,
    COALESCE(o.ot_number, wo.ot_number, substring(o.notes, 'OT(?:\s*Original)?:\s*([0-9]+)'::text), ''::text) AS ot_number,
    COALESCE(o.tractor_id, u.tractor_id) AS tractor_id,
    COALESCE(o.semi_id, u.semi_id) AS semi_id,
    o.unidad_id,
    COALESCE(t.patente, ''::text) AS tractor,
    COALESCE(t.marca, ''::text) AS marca_tr,
    COALESCE(sem.patente, ''::text) AS semi,
    COALESCE(sem.marca, ''::text) AS marca_semi,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'order_item_id', sm.id,
        'id', sm.id,
        'item_id', i.id,
        'name', i.name,
        'code', i.item_code,
        'qty', sm.quantity,
        'delivered_qty', COALESCE(sm.delivered_qty, 0::numeric),
        'returned_qty', COALESCE(sm.returned_qty, 0::numeric),
        'location', i.location,
        'requires_exchange', i.requires_exchange,
        'status', sm.status,
        'exchange_status', sm.exchange_status,
        'panol_confirmation', sm.panol_confirmation,
        'notes', sm.notes,
        'return_notes', sm.return_notes
      ) ORDER BY sm.created_at) FILTER (WHERE sm.id IS NOT NULL), '[]'::jsonb
    ) AS items
   FROM panol.orders o
     LEFT JOIN panol.staff s ON o.mechanic_id = s.id
     LEFT JOIN panol.staff sp ON o.panol_staff_id = sp.id
     LEFT JOIN panol.work_orders wo ON o.work_order_id = wo.id
     LEFT JOIN unidades u ON o.unidad_id = u.id
     LEFT JOIN tractores t ON COALESCE(o.tractor_id, u.tractor_id) = t.id
     LEFT JOIN semis sem ON COALESCE(o.semi_id, u.semi_id) = sem.id
     LEFT JOIN panol.stock_movements sm ON sm.order_id = o.id
     LEFT JOIN panol.items i ON sm.item_id = i.id
  GROUP BY o.id, o.order_number, o.req_code, o.order_type, o.parent_order_id, o.created_at, o.ready_at, o.status, o.box_number, o.notes, o.ot_number, s.id, s.name, s.op_code, sp.id, sp.name, wo.id, wo.ot_number, o.tractor_id, o.semi_id, o.unidad_id, u.tractor_id, u.semi_id, t.patente, t.marca, sem.patente, sem.marca;
