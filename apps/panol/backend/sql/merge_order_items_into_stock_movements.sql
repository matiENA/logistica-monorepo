-- =========================================================================
-- Migración: Fusión Transaccional de order_items en stock_movements (Alternativa B)
-- panol.orders queda como el Índice Maestro del pedido
-- panol.stock_movements absorbe todas las líneas, movimientos y estados
-- =========================================================================

-- 1. Ampliar columnas en panol.stock_movements
ALTER TABLE panol.stock_movements
  ADD COLUMN IF NOT EXISTS quantity numeric DEFAULT 1,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'PENDIENTE',
  ADD COLUMN IF NOT EXISTS exchange_status text,
  ADD COLUMN IF NOT EXISTS panol_confirmation text,
  ADD COLUMN IF NOT EXISTS delivered_qty numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS returned_qty numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS return_notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- 2. Permitir previous_stock y new_stock NULL para filas que nacen en estado PENDIENTE
ALTER TABLE panol.stock_movements ALTER COLUMN previous_stock DROP NOT NULL;
ALTER TABLE panol.stock_movements ALTER COLUMN new_stock DROP NOT NULL;
ALTER TABLE panol.stock_movements ALTER COLUMN quantity_delta SET DEFAULT 0;

-- 3. Sincronizar datos desde panol.order_items a las filas de stock_movements existentes
UPDATE panol.stock_movements sm
SET
  quantity = COALESCE(oi.quantity, 1),
  status = COALESCE(oi.status, 'LISTO'),
  exchange_status = oi.exchange_status,
  panol_confirmation = oi.panol_confirmation,
  delivered_qty = COALESCE(oi.delivered_qty, oi.quantity, 1),
  returned_qty = COALESCE(oi.returned_qty, 0),
  return_notes = oi.return_notes,
  notes = COALESCE(sm.notes, oi.notes)
FROM panol.order_items oi
WHERE sm.order_item_id = oi.id;

-- 4. Migrar filas de panol.order_items que aún no tenían fila en stock_movements (ej. pedidos PENDIENTE)
INSERT INTO panol.stock_movements (
  id,
  order_id,
  item_id,
  mechanic_id,
  quantity,
  quantity_delta,
  status,
  movement_type,
  exchange_status,
  panol_confirmation,
  delivered_qty,
  returned_qty,
  return_notes,
  notes,
  created_at,
  updated_at
)
SELECT
  oi.id,
  oi.order_id,
  oi.item_id,
  o.mechanic_id,
  oi.quantity,
  CASE WHEN oi.status IN ('LISTO', 'ENTREGADO') THEN -oi.quantity ELSE 0 END,
  COALESCE(oi.status, 'PENDIENTE'),
  CASE 
    WHEN oi.status = 'DEVOLUCION' THEN 'DEVOLUCION_NUEVO'
    WHEN oi.status = 'DEVUELTO' THEN 'DEVOLUCION_CANJE'
    WHEN oi.status IN ('LISTO', 'ENTREGADO') THEN 'PEDIDO_LISTO'
    ELSE 'SOLICITUD'
  END,
  oi.exchange_status,
  oi.panol_confirmation,
  oi.delivered_qty,
  oi.returned_qty,
  oi.return_notes,
  oi.notes,
  oi.created_at,
  oi.updated_at
FROM panol.order_items oi
JOIN panol.orders o ON oi.order_id = o.id
WHERE NOT EXISTS (
  SELECT 1 FROM panol.stock_movements sm WHERE sm.order_item_id = oi.id OR sm.id = oi.id
);

-- 5. Eliminar vistas dependientes antes de transformar order_items
DROP VIEW IF EXISTS public.v_monitor_pedidos CASCADE;
DROP VIEW IF EXISTS panol.v_monitor_pedidos CASCADE;
DROP VIEW IF EXISTS public.v_devoluciones_pendientes CASCADE;
DROP VIEW IF EXISTS panol.v_devoluciones_pendientes CASCADE;
DROP VIEW IF EXISTS public.v_pedidos_canjes_consolidada CASCADE;
DROP VIEW IF EXISTS panol.v_pedidos_canjes_consolidada CASCADE;
DROP VIEW IF EXISTS public.v_stock_movements CASCADE;
DROP VIEW IF EXISTS panol.v_stock_movements CASCADE;
DROP VIEW IF EXISTS public.panol_order_items CASCADE;

-- 6. Backup de la tabla física order_items y recreación como VISTA sobre stock_movements
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'panol' AND table_name = 'order_items' AND table_type = 'BASE TABLE'
  ) THEN
    ALTER TABLE panol.order_items RENAME TO order_items_legacy_backup;
  END IF;
END $$;

-- Vista de compatibilidad para panol.order_items
CREATE OR REPLACE VIEW panol.order_items AS
SELECT
  id,
  order_id,
  item_id,
  quantity,
  status,
  exchange_status,
  panol_confirmation,
  notes,
  return_notes,
  delivered_qty,
  returned_qty,
  created_at,
  updated_at
FROM panol.stock_movements;

CREATE OR REPLACE VIEW public.panol_order_items AS SELECT * FROM panol.order_items;

-- 7. Recrear panol.v_monitor_pedidos leyendo directamente de panol.stock_movements
CREATE OR REPLACE VIEW panol.v_monitor_pedidos AS
SELECT
  o.id AS order_id,
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
  COALESCE(
    jsonb_agg(
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
        'notes', sm.notes,
        'return_notes', sm.return_notes
      ) ORDER BY sm.created_at
    ) FILTER (WHERE sm.id IS NOT NULL),
    '[]'::jsonb
  ) AS items
FROM panol.orders o
LEFT JOIN panol.staff s ON o.mechanic_id = s.id
LEFT JOIN panol.staff sp ON o.panol_staff_id = sp.id
LEFT JOIN panol.work_orders wo ON o.work_order_id = wo.id
LEFT JOIN public.unidades u ON o.unidad_id = u.id
LEFT JOIN public.tractores t ON COALESCE(o.tractor_id, u.tractor_id) = t.id
LEFT JOIN public.semis sem ON COALESCE(o.semi_id, u.semi_id) = sem.id
LEFT JOIN panol.stock_movements sm ON sm.order_id = o.id
LEFT JOIN panol.items i ON sm.item_id = i.id
GROUP BY
  o.id, o.order_number, o.req_code, o.order_type, o.parent_order_id, o.created_at, o.ready_at,
  o.status, o.box_number, o.notes, o.ot_number, s.id, s.name, s.op_code, sp.id, sp.name,
  wo.id, wo.ot_number, o.tractor_id, o.semi_id, o.unidad_id, u.tractor_id, u.semi_id,
  t.patente, t.marca, sem.patente, sem.marca;

CREATE OR REPLACE VIEW public.v_monitor_pedidos AS SELECT * FROM panol.v_monitor_pedidos;

-- 8. Recrear panol.v_devoluciones_pendientes leyendo directamente de stock_movements
CREATE OR REPLACE VIEW panol.v_devoluciones_pendientes AS
SELECT
  o.id AS order_id,
  o.order_number,
  o.req_code,
  o.box_number,
  o.ot_number,
  t.patente AS tractor,
  s.id AS mechanic_id,
  s.name AS mechanic_name,
  s.op_code AS mechanic_op_code,
  i.id AS item_id,
  i.item_code,
  i.name AS item_name,
  i.location,
  i.requires_exchange,
  sm.id AS order_item_id,
  sm.id AS id,
  sm.quantity AS requested_qty,
  sm.delivered_qty,
  sm.returned_qty,
  sm.exchange_status,
  sm.notes AS item_notes,
  sm.return_notes,
  sm.panol_confirmation,
  sm.status AS item_status,
  o.status AS order_status,
  o.created_at AS order_created_at
FROM panol.orders o
JOIN panol.stock_movements sm ON sm.order_id = o.id
JOIN panol.items i ON sm.item_id = i.id
LEFT JOIN panol.staff s ON o.mechanic_id = s.id
LEFT JOIN public.tractores t ON o.tractor_id = t.id
WHERE (
  (i.requires_exchange = true 
   AND (sm.panol_confirmation IS NULL OR sm.panol_confirmation NOT LIKE '%OK%') 
   AND sm.status IN ('PENDIENTE', 'LISTO', 'ENTREGADO', 'EN_CAMBIO'))
  OR
  (sm.status = 'DEVOLUCION PENDIENTE')
)
ORDER BY o.created_at DESC;

CREATE OR REPLACE VIEW public.v_devoluciones_pendientes AS SELECT * FROM panol.v_devoluciones_pendientes;

-- 9. Recrear panol.v_stock_movements enriquecida
CREATE OR REPLACE VIEW panol.v_stock_movements AS
SELECT
  sm.id AS movement_id,
  sm.id,
  sm.created_at,
  sm.ready_at,
  sm.order_id,
  o.order_number,
  o.req_code,
  o.box_number,
  sm.item_id,
  i.item_code,
  i.name AS item_name,
  sm.quantity,
  sm.quantity_delta,
  sm.previous_stock,
  sm.new_stock,
  sm.status,
  sm.movement_type,
  sm.exchange_status,
  sm.panol_confirmation,
  sm.returned_qty,
  sm.return_notes,
  sm.mechanic_id,
  m.op_code AS mechanic_op_code,
  m.name AS mechanic_name,
  sm.performed_by AS panol_staff_id,
  p.op_code AS panol_op_code,
  p.name AS panol_staff_name,
  sm.notes
FROM panol.stock_movements sm
LEFT JOIN panol.orders o ON sm.order_id = o.id
LEFT JOIN panol.items i ON sm.item_id = i.id
LEFT JOIN panol.staff m ON sm.mechanic_id = m.id
LEFT JOIN panol.staff p ON sm.performed_by = p.id
ORDER BY sm.created_at DESC;

CREATE OR REPLACE VIEW public.v_stock_movements AS SELECT * FROM panol.v_stock_movements;

-- 10. Recrear panol.v_pedidos_canjes_consolidada
CREATE OR REPLACE VIEW panol.v_pedidos_canjes_consolidada AS
SELECT 
    o.id AS order_id,
    o.order_number,
    o.req_code,
    o.box_number,
    s.id AS mechanic_id,
    s.op_code AS legajo_mecanico,
    s.name AS nombre_mecanico,
    i.id AS item_id,
    i.item_code,
    i.name AS item_name,
    sm.id AS order_item_id,
    sm.id AS id,
    sm.quantity AS cantidad_solicitada,
    COALESCE(sm.delivered_qty, sm.quantity) AS cantidad_entregada,
    COALESCE(sm.returned_qty, 0::numeric) AS cantidad_devuelta,
    (COALESCE(sm.delivered_qty, sm.quantity) - COALESCE(sm.returned_qty, 0::numeric)) AS saldo_pendiente_canje,
    sm.exchange_status,
    sm.status AS item_status,
    o.created_at AS fecha_pedido
FROM panol.orders o
JOIN panol.stock_movements sm ON sm.order_id = o.id
JOIN panol.items i ON sm.item_id = i.id
LEFT JOIN panol.staff s ON o.mechanic_id = s.id
WHERE i.requires_exchange = true 
  AND sm.status IN ('LISTO', 'ENTREGADO', 'DEVOLUCION PENDIENTE')
  AND (COALESCE(sm.delivered_qty, sm.quantity) > COALESCE(sm.returned_qty, 0::numeric));

CREATE OR REPLACE VIEW public.v_pedidos_canjes_consolidada AS SELECT * FROM panol.v_pedidos_canjes_consolidada;

-- 11. Permisos en todas las vistas recreadas
GRANT SELECT ON ALL TABLES IN SCHEMA panol TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
