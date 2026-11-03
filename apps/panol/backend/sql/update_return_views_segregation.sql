-- 1. Vista de Devoluciones Pendientes con segregación estricta entre CANJE y NUEVO
CREATE OR REPLACE VIEW panol.v_devoluciones_pendientes AS
 SELECT o.id AS order_id,
    o.order_number,
    o.req_code,
    COALESCE(o.box_number, '01'::text) AS box_number,
    COALESCE(o.ot_number, wo.ot_number, substring(o.notes, 'OT(?:\s*Original)?:\s*([0-9]+)'::text), ''::text) AS ot_number,
    o.status AS order_status,
    o.order_type,
    o.created_at AS order_created_at,
    COALESCE(sm.ready_at, o.ready_at) AS ready_at,
    o.unidad_id,
    COALESCE(o.tractor_id, u.tractor_id) AS tractor_id,
    COALESCE(t.patente, ''::text) AS tractor,
    COALESCE(t.marca, ''::text) AS tractor_brand,
    COALESCE(o.semi_id, u.semi_id) AS semi_id,
    COALESCE(sem.patente, ''::text) AS semi,
    COALESCE(sem.marca, ''::text) AS semi_brand,
    s.id AS mechanic_id,
    COALESCE(s.name, 'MECÁNICO'::text) AS mechanic_name,
    s.op_code AS mechanic_op_code,
    sp.id AS panol_staff_id,
    sp.name AS panol_staff_name,
    sp.op_code AS panol_op_code,
    i.id AS item_id,
    i.item_code,
    i.name AS item_name,
    COALESCE(i.brand, ''::text) AS brand,
    COALESCE(i.category, 'REPUESTOS'::text) AS category,
    COALESCE(i.location, 'S/D'::text) AS location,
    COALESCE(i.stock, 0::numeric) AS stock_actual,
    COALESCE(i.stock, 0::numeric) + COALESCE(sm.returned_qty, sm.delivered_qty, sm.quantity, 1::numeric) AS stock_post_reintegro,
    COALESCE(i.requires_exchange, false) AS requires_exchange,
    sm.id,
    sm.id AS order_item_id,
    sm.id AS movement_id,
    CASE
        WHEN sm.status = 'DEVOLUCION PENDIENTE'::text OR sm.movement_type = 'DEVOLUCION_NUEVO'::text OR sm.status = 'DEVOLUCION'::text THEN 'NUEVO'::text
        WHEN i.requires_exchange = true OR sm.exchange_status IS NOT NULL THEN 'CANJE'::text
        ELSE 'NUEVO'::text
    END AS tipo_devolucion,
    CASE
        WHEN sm.status = 'DEVOLUCION PENDIENTE'::text OR sm.movement_type = 'DEVOLUCION_NUEVO'::text OR sm.status = 'DEVOLUCION'::text THEN 'NUEVO'::text
        WHEN i.requires_exchange = true OR sm.exchange_status IS NOT NULL THEN 'CANJE'::text
        ELSE 'NUEVO'::text
    END AS return_type,
    CASE
        WHEN sm.status = 'DEVOLUCION PENDIENTE'::text OR sm.movement_type = 'DEVOLUCION_NUEVO'::text OR sm.status = 'DEVOLUCION'::text THEN true
        ELSE false
    END AS es_devolucion_nueva,
    CASE
        WHEN (i.requires_exchange = true OR sm.exchange_status IS NOT NULL) AND sm.status <> 'DEVOLUCION PENDIENTE'::text AND sm.movement_type <> 'DEVOLUCION_NUEVO'::text THEN true
        ELSE false
    END AS es_canje,
    sm.quantity AS requested_qty,
    COALESCE(sm.delivered_qty, sm.quantity) AS delivered_qty,
    COALESCE(sm.returned_qty, 0::numeric) AS returned_qty,
    CASE
        WHEN sm.status = 'DEVOLUCION PENDIENTE'::text THEN COALESCE(sm.returned_qty, sm.delivered_qty, sm.quantity, 1::numeric)
        ELSE COALESCE(sm.returned_qty, 0::numeric)
    END AS cantidad_a_devolver,
    COALESCE(sm.delivered_qty, sm.quantity) - COALESCE(sm.returned_qty, 0::numeric) AS saldo_pendiente,
    sm.quantity_delta,
    sm.status AS item_status,
    sm.movement_type,
    sm.exchange_status,
    sm.panol_confirmation,
    sm.notes AS item_notes,
    sm.return_notes,
    TRIM(BOTH FROM regexp_replace(COALESCE(sm.return_notes, sm.notes, ''::text), '^(DEVOLUCIÓN SOLICITADA POR TALLER|SOLICITUD DEVOLUCIÓN NUEVA|SOLICITUD DEVOLUCIÓN NUEVA PARCIAL):\s*'::text, ''::text, 'i'::text)) AS motivo_devolucion,
    o.notes AS order_notes,
    sm.created_at AS movement_created_at,
    sm.updated_at
   FROM panol.orders o
     JOIN panol.stock_movements sm ON sm.order_id = o.id
     JOIN panol.items i ON sm.item_id = i.id
     LEFT JOIN panol.staff s ON o.mechanic_id = s.id
     LEFT JOIN panol.staff sp ON COALESCE(sm.performed_by, o.panol_staff_id) = sp.id
     LEFT JOIN panol.work_orders wo ON o.work_order_id = wo.id
     LEFT JOIN unidades u ON o.unidad_id = u.id
     LEFT JOIN tractores t ON COALESCE(o.tractor_id, u.tractor_id) = t.id
     LEFT JOIN semis sem ON COALESCE(o.semi_id, u.semi_id) = sem.id
  WHERE (
    -- Caso 1: Solicitud de Devolución de Repuesto Nuevo (sin uso)
    (sm.status = 'DEVOLUCION PENDIENTE'::text AND sm.movement_type <> 'DEVOLUCION_CANJE'::text)
    OR
    -- Caso 2: Devolución de Repuesto Anterior (Canje pendiente de confirmación de Pañol)
    (
      (i.requires_exchange = true OR sm.exchange_status IS NOT NULL)
      AND (sm.panol_confirmation IS NULL OR sm.panol_confirmation !~~ '%OK%'::text)
      AND (sm.status = ANY (ARRAY['LISTO'::text, 'ENTREGADO'::text, 'EN_CAMBIO'::text]))
      AND sm.status <> 'DEVOLUCION PENDIENTE'::text
      AND sm.movement_type <> 'DEVOLUCION_NUEVO'::text
    )
  )
  ORDER BY sm.updated_at DESC, o.created_at DESC;

-- 2. Vista de Devoluciones de Nuevos (Historial y Pendientes - NUNCA CANJES)
CREATE OR REPLACE VIEW panol.v_devoluciones_nuevas AS
 SELECT o.id AS order_id,
    o.order_number,
    o.req_code,
    COALESCE(o.box_number, '01'::text) AS box_number,
    COALESCE(o.ot_number, wo.ot_number, substring(o.notes, 'OT(?:\s*Original)?:\s*([0-9]+)'::text), ''::text) AS ot_number,
    o.status AS order_status,
    o.created_at AS order_created_at,
    COALESCE(sm.ready_at, o.ready_at) AS ready_at,
    o.unidad_id,
    COALESCE(t.patente, ''::text) AS tractor,
    COALESCE(t.marca, ''::text) AS tractor_brand,
    COALESCE(sem.patente, ''::text) AS semi,
    COALESCE(sem.marca, ''::text) AS semi_brand,
    s.id AS mechanic_id,
    COALESCE(s.name, 'MECÁNICO'::text) AS mechanic_name,
    s.op_code AS mechanic_op_code,
    sp.id AS panol_staff_id,
    sp.name AS panol_staff_name,
    sp.op_code AS panol_op_code,
    i.id AS item_id,
    i.item_code,
    i.name AS item_name,
    COALESCE(i.brand, ''::text) AS brand,
    COALESCE(i.category, 'REPUESTOS'::text) AS category,
    COALESCE(i.location, 'S/D'::text) AS location,
    COALESCE(i.stock, 0::numeric) AS stock_actual,
    COALESCE(i.stock, 0::numeric) + COALESCE(sm.returned_qty, sm.delivered_qty, sm.quantity, 1::numeric) AS stock_post_reintegro,
    sm.id,
    sm.id AS order_item_id,
    'NUEVO'::text AS tipo_devolucion,
    sm.quantity AS requested_qty,
    COALESCE(sm.delivered_qty, sm.quantity) AS delivered_qty,
    COALESCE(sm.returned_qty, sm.quantity) AS return_qty,
    sm.quantity_delta,
    sm.status AS item_status,
    sm.movement_type,
    sm.return_notes,
    TRIM(BOTH FROM regexp_replace(COALESCE(sm.return_notes, sm.notes, ''::text), '^(DEVOLUCIÓN SOLICITADA POR TALLER|SOLICITUD DEVOLUCIÓN NUEVA|SOLICITUD DEVOLUCIÓN NUEVA PARCIAL):\s*'::text, ''::text, 'i'::text)) AS motivo_devolucion,
    sm.created_at AS movement_created_at,
    sm.updated_at
   FROM panol.orders o
     JOIN panol.stock_movements sm ON sm.order_id = o.id
     JOIN panol.items i ON sm.item_id = i.id
     LEFT JOIN panol.staff s ON o.mechanic_id = s.id
     LEFT JOIN panol.staff sp ON COALESCE(sm.performed_by, o.panol_staff_id) = sp.id
     LEFT JOIN panol.work_orders wo ON o.work_order_id = wo.id
     LEFT JOIN unidades u ON o.unidad_id = u.id
     LEFT JOIN tractores t ON COALESCE(o.tractor_id, u.tractor_id) = t.id
     LEFT JOIN semis sem ON COALESCE(o.semi_id, u.semi_id) = sem.id
  WHERE sm.movement_type <> 'DEVOLUCION_CANJE'::text
    AND sm.status <> 'DEVUELTO'::text
    AND (
      sm.status = ANY (ARRAY['DEVOLUCION PENDIENTE'::text, 'DEVOLUCION'::text])
      OR sm.movement_type = 'DEVOLUCION_NUEVO'::text
      OR sm.return_notes ~~* '%DEVOLUCI%'::text
    )
  ORDER BY sm.updated_at DESC, o.created_at DESC;
