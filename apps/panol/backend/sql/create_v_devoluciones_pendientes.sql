-- =========================================================================
-- Vista: panol.v_devoluciones_pendientes y panol.v_devoluciones_nuevas
-- Conecta pedidos, líneas de repuestos y movimientos transaccionales (Alternativa B)
-- Diseñada para gestionar Devoluciones Nuevas (sin uso) y Canjes (usados)
-- =========================================================================

DROP VIEW IF EXISTS public.v_devoluciones_nuevas CASCADE;
DROP VIEW IF EXISTS panol.v_devoluciones_nuevas CASCADE;
DROP VIEW IF EXISTS public.v_devoluciones_pendientes CASCADE;
DROP VIEW IF EXISTS panol.v_devoluciones_pendientes CASCADE;

CREATE OR REPLACE VIEW panol.v_devoluciones_pendientes AS
SELECT
  -- 1. Identificadores maestros del pedido (Índice)
  o.id AS order_id,
  o.order_number,
  o.req_code,
  COALESCE(o.box_number, '01'::text) AS box_number,
  COALESCE(o.ot_number, wo.ot_number, substring(o.notes, 'OT(?:\s*Original)?:\s*([0-9]+)'::text), ''::text) AS ot_number,
  o.status AS order_status,
  o.order_type,
  o.created_at AS order_created_at,
  COALESCE(sm.ready_at, o.ready_at) AS ready_at,

  -- 2. Flota y Unidades (Tractor + Semi trailer + Marcas)
  o.unidad_id,
  COALESCE(o.tractor_id, u.tractor_id) AS tractor_id,
  COALESCE(t.patente, ''::text) AS tractor,
  COALESCE(t.marca, ''::text) AS tractor_brand,
  COALESCE(o.semi_id, u.semi_id) AS semi_id,
  COALESCE(sem.patente, ''::text) AS semi,
  COALESCE(sem.marca, ''::text) AS semi_brand,

  -- 3. Personal involucrado (Mecánico y Pañolero)
  s.id AS mechanic_id,
  COALESCE(s.name, 'MECÁNICO'::text) AS mechanic_name,
  s.op_code AS mechanic_op_code,
  sp.id AS panol_staff_id,
  sp.name AS panol_staff_name,
  sp.op_code AS panol_op_code,

  -- 4. Repuesto e Inventario
  i.id AS item_id,
  i.item_code,
  i.name AS item_name,
  COALESCE(i.brand, ''::text) AS brand,
  COALESCE(i.category, 'REPUESTOS'::text) AS category,
  COALESCE(i.location, 'S/D'::text) AS location,
  COALESCE(i.stock, 0::numeric) AS stock_actual,
  (COALESCE(i.stock, 0::numeric) + COALESCE(sm.returned_qty, sm.delivered_qty, sm.quantity, 1::numeric)) AS stock_post_reintegro,
  COALESCE(i.requires_exchange, false) AS requires_exchange,

  -- 5. Identificador Único Predeterminado (UUID de stock_movements)
  sm.id AS id,
  sm.id AS order_item_id,
  sm.id AS movement_id,

  -- 6. Tipificación de Devolución (Diferenciación entre Devolución Nueva y Canje Usado)
  CASE 
    WHEN sm.status = 'DEVOLUCION PENDIENTE' OR sm.movement_type = 'DEVOLUCION_NUEVO' OR sm.status = 'DEVOLUCION' THEN 'NUEVO'::text
    WHEN i.requires_exchange = true OR sm.exchange_status IS NOT NULL THEN 'CANJE'::text
    ELSE 'NUEVO'::text
  END AS tipo_devolucion,
  CASE 
    WHEN sm.status = 'DEVOLUCION PENDIENTE' OR sm.movement_type = 'DEVOLUCION_NUEVO' OR sm.status = 'DEVOLUCION' THEN 'NUEVO'::text
    WHEN i.requires_exchange = true OR sm.exchange_status IS NOT NULL THEN 'CANJE'::text
    ELSE 'NUEVO'::text
  END AS return_type,
  CASE 
    WHEN sm.status = 'DEVOLUCION PENDIENTE' OR sm.movement_type = 'DEVOLUCION_NUEVO' OR sm.status = 'DEVOLUCION' THEN true
    ELSE false
  END AS es_devolucion_nueva,
  CASE 
    WHEN i.requires_exchange = true AND sm.status <> 'DEVOLUCION PENDIENTE' THEN true
    ELSE false
  END AS es_canje,

  -- 7. Cantidades y Deltas
  sm.quantity AS requested_qty,
  COALESCE(sm.delivered_qty, sm.quantity) AS delivered_qty,
  COALESCE(sm.returned_qty, 0::numeric) AS returned_qty,
  CASE 
    WHEN sm.status = 'DEVOLUCION PENDIENTE' THEN COALESCE(sm.returned_qty, sm.delivered_qty, sm.quantity, 1::numeric)
    ELSE COALESCE(sm.returned_qty, 0::numeric)
  END AS cantidad_a_devolver,
  (COALESCE(sm.delivered_qty, sm.quantity) - COALESCE(sm.returned_qty, 0::numeric)) AS saldo_pendiente,
  sm.quantity_delta,

  -- 8. Trazabilidad, Estados y Motivos
  sm.status AS item_status,
  sm.movement_type,
  sm.exchange_status,
  sm.panol_confirmation,
  sm.notes AS item_notes,
  sm.return_notes,
  TRIM(REGEXP_REPLACE(COALESCE(sm.return_notes, sm.notes, ''::text), '^(DEVOLUCIÓN SOLICITADA POR TALLER|SOLICITUD DEVOLUCIÓN NUEVA|SOLICITUD DEVOLUCIÓN NUEVA PARCIAL):\s*'::text, ''::text, 'i'::text)) AS motivo_devolucion,
  o.notes AS order_notes,
  sm.created_at AS movement_created_at,
  sm.updated_at AS updated_at

FROM panol.orders o
JOIN panol.stock_movements sm ON sm.order_id = o.id
JOIN panol.items i ON sm.item_id = i.id
LEFT JOIN panol.staff s ON o.mechanic_id = s.id
LEFT JOIN panol.staff sp ON COALESCE(sm.performed_by, o.panol_staff_id) = sp.id
LEFT JOIN panol.work_orders wo ON o.work_order_id = wo.id
LEFT JOIN public.unidades u ON o.unidad_id = u.id
LEFT JOIN public.tractores t ON COALESCE(o.tractor_id, u.tractor_id) = t.id
LEFT JOIN public.semis sem ON COALESCE(o.semi_id, u.semi_id) = sem.id
WHERE (
  -- A. Devolución de repuesto nuevo solicitada por taller (pendiente de reintegro a stock)
  (sm.status = 'DEVOLUCION PENDIENTE')
  OR
  -- B. Canje de repuesto usado entregado pendiente de auditar por pañol
  (i.requires_exchange = true 
   AND (sm.panol_confirmation IS NULL OR sm.panol_confirmation NOT LIKE '%OK%') 
   AND sm.status IN ('LISTO', 'ENTREGADO', 'EN_CAMBIO'))
)
ORDER BY sm.updated_at DESC, o.created_at DESC;

-- Vista especializada: panol.v_devoluciones_nuevas (Pendientes e Historial de Repuestos Nuevos)
CREATE OR REPLACE VIEW panol.v_devoluciones_nuevas AS
SELECT
  o.id AS order_id,
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
  (COALESCE(i.stock, 0::numeric) + COALESCE(sm.returned_qty, sm.delivered_qty, sm.quantity, 1::numeric)) AS stock_post_reintegro,
  sm.id AS id,
  sm.id AS order_item_id,
  'NUEVO'::text AS tipo_devolucion,
  sm.quantity AS requested_qty,
  COALESCE(sm.delivered_qty, sm.quantity) AS delivered_qty,
  COALESCE(sm.returned_qty, sm.quantity) AS return_qty,
  sm.quantity_delta,
  sm.status AS item_status,
  sm.movement_type,
  sm.return_notes,
  TRIM(REGEXP_REPLACE(COALESCE(sm.return_notes, sm.notes, ''::text), '^(DEVOLUCIÓN SOLICITADA POR TALLER|SOLICITUD DEVOLUCIÓN NUEVA|SOLICITUD DEVOLUCIÓN NUEVA PARCIAL):\s*'::text, ''::text, 'i'::text)) AS motivo_devolucion,
  sm.created_at AS movement_created_at,
  sm.updated_at AS updated_at
FROM panol.orders o
JOIN panol.stock_movements sm ON sm.order_id = o.id
JOIN panol.items i ON sm.item_id = i.id
LEFT JOIN panol.staff s ON o.mechanic_id = s.id
LEFT JOIN panol.staff sp ON COALESCE(sm.performed_by, o.panol_staff_id) = sp.id
LEFT JOIN panol.work_orders wo ON o.work_order_id = wo.id
LEFT JOIN public.unidades u ON o.unidad_id = u.id
LEFT JOIN public.tractores t ON COALESCE(o.tractor_id, u.tractor_id) = t.id
LEFT JOIN public.semis sem ON COALESCE(o.semi_id, u.semi_id) = sem.id
WHERE sm.status IN ('DEVOLUCION PENDIENTE', 'DEVOLUCION')
   OR sm.movement_type = 'DEVOLUCION_NUEVO'
   OR sm.return_notes ILIKE '%DEVOLUCI%'
ORDER BY sm.updated_at DESC, o.created_at DESC;

-- Espejar en esquema public
CREATE OR REPLACE VIEW public.v_devoluciones_pendientes AS SELECT * FROM panol.v_devoluciones_pendientes;
CREATE OR REPLACE VIEW public.v_devoluciones_nuevas AS SELECT * FROM panol.v_devoluciones_nuevas;

-- Permisos
GRANT SELECT ON panol.v_devoluciones_pendientes TO anon, authenticated, service_role;
GRANT SELECT ON public.v_devoluciones_pendientes TO anon, authenticated, service_role;
GRANT SELECT ON panol.v_devoluciones_nuevas TO anon, authenticated, service_role;
GRANT SELECT ON public.v_devoluciones_nuevas TO anon, authenticated, service_role;
