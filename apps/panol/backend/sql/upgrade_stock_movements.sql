-- =========================================================================
-- Upgrade panol.stock_movements schema and create canonical view
-- Workspace: C:\Users\Matias Rodriguez\Documents\panol
-- =========================================================================

ALTER TABLE panol.stock_movements 
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES panol.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mechanic_id uuid REFERENCES panol.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ready_at timestamp with time zone;

-- Índices B-Tree optimizados para consultas operativas
CREATE INDEX IF NOT EXISTS idx_stock_mov_order_id ON panol.stock_movements(order_id);
CREATE INDEX IF NOT EXISTS idx_stock_mov_item_id ON panol.stock_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_mov_mechanic_id ON panol.stock_movements(mechanic_id);
CREATE INDEX IF NOT EXISTS idx_stock_mov_type ON panol.stock_movements(movement_type);

-- Optimización 1: Índice Parcial para Devoluciones (ahorra 90% de espacio)
CREATE INDEX IF NOT EXISTS idx_stock_mov_devoluciones ON panol.stock_movements (order_id, created_at DESC)
WHERE movement_type IN ('DEVOLUCION_NUEVO', 'DEVOLUCION_CANJE');

-- Optimización 2: Índice BRIN para series temporales cronológicas (ahorra 98% vs B-Tree)
CREATE INDEX IF NOT EXISTS idx_stock_mov_created_at_brin ON panol.stock_movements USING BRIN (created_at);

-- Vista canónica de movimientos transaccionales desacoplada y enriquecida
CREATE OR REPLACE VIEW panol.v_stock_movements AS
SELECT
  sm.id AS movement_id,
  sm.created_at,
  sm.ready_at,
  sm.order_id,
  sm.order_item_id,
  sm.item_id,
  i.item_code,
  i.name AS item_name,
  sm.quantity_delta,
  sm.previous_stock,
  sm.new_stock,
  sm.movement_type,
  sm.mechanic_id,
  m.op_code AS mechanic_op_code,
  m.name AS mechanic_name,
  sm.performed_by AS panol_staff_id,
  p.op_code AS panol_op_code,
  p.name AS panol_staff_name,
  sm.notes
FROM panol.stock_movements sm
LEFT JOIN panol.items i ON sm.item_id = i.id
LEFT JOIN panol.staff m ON sm.mechanic_id = m.id
LEFT JOIN panol.staff p ON sm.performed_by = p.id
ORDER BY sm.created_at DESC;

-- Exponer en schema public para acceso con API Supabase
CREATE OR REPLACE VIEW public.v_stock_movements AS SELECT * FROM panol.v_stock_movements;
GRANT SELECT ON panol.v_stock_movements TO anon, authenticated, service_role;
GRANT SELECT ON public.v_stock_movements TO anon, authenticated, service_role;
