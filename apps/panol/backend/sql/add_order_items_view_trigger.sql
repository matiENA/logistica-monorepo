-- =========================================================================
-- Trigger INSTEAD OF para la VISTA panol.order_items
-- Garantiza 100% retrocompatibilidad si alguna herramienta externa o script
-- realiza INSERT, UPDATE o DELETE sobre panol.order_items
-- Redirigiéndolo transparentemente a panol.stock_movements
-- =========================================================================

CREATE OR REPLACE FUNCTION panol.trg_order_items_view_sync()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO panol.stock_movements (
      id, order_id, item_id, quantity, status, exchange_status, panol_confirmation,
      notes, return_notes, delivered_qty, returned_qty, created_at, updated_at
    ) VALUES (
      COALESCE(NEW.id, gen_random_uuid()), NEW.order_id, NEW.item_id, COALESCE(NEW.quantity, 1),
      COALESCE(NEW.status, 'PENDIENTE'), NEW.exchange_status, NEW.panol_confirmation,
      NEW.notes, NEW.return_notes, COALESCE(NEW.delivered_qty, 0), COALESCE(NEW.returned_qty, 0),
      COALESCE(NEW.created_at, now()), COALESCE(NEW.updated_at, now())
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE panol.stock_movements SET
      order_id = NEW.order_id,
      item_id = NEW.item_id,
      quantity = NEW.quantity,
      status = NEW.status,
      exchange_status = NEW.exchange_status,
      panol_confirmation = NEW.panol_confirmation,
      notes = NEW.notes,
      return_notes = NEW.return_notes,
      delivered_qty = NEW.delivered_qty,
      returned_qty = NEW.returned_qty,
      updated_at = now()
    WHERE id = OLD.id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM panol.stock_movements WHERE id = OLD.id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_items_view_io ON panol.order_items;

CREATE TRIGGER trg_order_items_view_io
INSTEAD OF INSERT OR UPDATE OR DELETE ON panol.order_items
FOR EACH ROW EXECUTE FUNCTION panol.trg_order_items_view_sync();
