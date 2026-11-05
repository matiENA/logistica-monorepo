-- ============================================================================
-- PROYECTO: rsvajuxihvmpmrmlcbul (Supabase)
-- ESQUEMA: panol
-- OBJETIVO: Reestructuración Relacional de panol.staff_holds y Vistas de Taller
-- ============================================================================

-- 1. Agregar columnas para claves foráneas explícitas de OTs
ALTER TABLE panol.staff_holds
  ADD COLUMN IF NOT EXISTS tractor_work_order_id UUID REFERENCES panol.work_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS semi_work_order_id UUID REFERENCES panol.work_orders(id) ON DELETE SET NULL;

-- 2. Eliminar restricción de unicidad defectuosa (staff_id, work_order_id)
ALTER TABLE panol.staff_holds DROP CONSTRAINT IF EXISTS unique_staff_hold;

-- 3. Crear índices únicos parciales por operario y vehículo para evitar duplicados
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_holds_unique_tractor
  ON panol.staff_holds (staff_id, tractor_id)
  WHERE tractor_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_holds_unique_semi
  ON panol.staff_holds (staff_id, semi_id)
  WHERE semi_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staff_holds_tr_wo ON panol.staff_holds(tractor_work_order_id);
CREATE INDEX IF NOT EXISTS idx_staff_holds_sm_wo ON panol.staff_holds(semi_work_order_id);

-- 4. Backfill / Migración de datos existentes en panol.staff_holds
UPDATE panol.staff_holds sh
SET tractor_work_order_id = wo.id
FROM panol.work_orders wo
WHERE sh.ot_number IS NOT NULL 
  AND sh.ot_number <> '' 
  AND wo.ot_number = sh.ot_number
  AND sh.tractor_work_order_id IS NULL;

UPDATE panol.staff_holds sh
SET semi_work_order_id = wo.id
FROM panol.work_orders wo
WHERE sh.semi_ot IS NOT NULL 
  AND sh.semi_ot <> '' 
  AND wo.ot_number = sh.semi_ot
  AND sh.semi_work_order_id IS NULL;

-- 5. Actualizar vistas panol.v_staff_holds y public.v_staff_holds
DROP VIEW IF EXISTS public.v_staff_holds CASCADE;
DROP VIEW IF EXISTS panol.v_staff_holds CASCADE;

CREATE OR REPLACE VIEW panol.v_staff_holds AS
SELECT 
    sh.id AS hold_id,
    sh.staff_id,
    s.op_code,
    s.name AS staff_name,
    sh.tractor_work_order_id,
    sh.semi_work_order_id,
    COALESCE(wo_tr.ot_number, sh.ot_number, '') AS tractor_ot,
    COALESCE(wo_sm.ot_number, sh.semi_ot, '') AS semi_ot,
    wo_tr.status AS tractor_ot_status,
    wo_sm.status AS semi_ot_status,
    sh.tractor_id,
    COALESCE(t.patente, sh.tractor_plate, '') AS tractor_plate,
    COALESCE(t.marca, '') AS tractor_brand,
    sh.semi_id,
    COALESCE(sm.patente, sh.semi_plate, '') AS semi_plate,
    COALESCE(sm.marca, '') AS semi_brand,
    sh.created_at
FROM panol.staff_holds sh
JOIN panol.staff s ON sh.staff_id = s.id
LEFT JOIN panol.work_orders wo_tr ON sh.tractor_work_order_id = wo_tr.id
LEFT JOIN panol.work_orders wo_sm ON sh.semi_work_order_id = wo_sm.id
LEFT JOIN public.tractores t ON sh.tractor_id = t.id
LEFT JOIN public.semis sm ON sh.semi_id = sm.id;

CREATE OR REPLACE VIEW public.v_staff_holds AS 
SELECT * FROM panol.v_staff_holds;

-- 6. Función y Trigger de Auto-liberación al completar OTs
CREATE OR REPLACE FUNCTION panol.fn_autoclean_completed_holds()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'COMPLETADA' AND (OLD.status IS DISTINCT FROM 'COMPLETADA') THEN
    DELETE FROM panol.staff_holds sh
    WHERE (sh.tractor_work_order_id = NEW.id OR sh.semi_work_order_id = NEW.id)
      AND (
        sh.tractor_work_order_id IS NULL OR 
        (SELECT status FROM panol.work_orders WHERE id = sh.tractor_work_order_id) = 'COMPLETADA'
      )
      AND (
        sh.semi_work_order_id IS NULL OR 
        (SELECT status FROM panol.work_orders WHERE id = sh.semi_work_order_id) = 'COMPLETADA'
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_autoclean_completed_holds ON panol.work_orders;
CREATE TRIGGER trg_autoclean_completed_holds
AFTER UPDATE OF status ON panol.work_orders
FOR EACH ROW
EXECUTE FUNCTION panol.fn_autoclean_completed_holds();
