-- ============================================================================
-- 🚀 FUNCIÓN CANÓNICA: panol.register_unit_work_order
-- Registra una nueva OT para un tractor o semi de forma atómica:
-- Si existe una OT activa previa para ese vehículo, la consolida a Cold Storage
-- como 'INCOMPLETA', y luego inserta el nuevo índice en unit_work_orders.
-- ============================================================================

CREATE OR REPLACE FUNCTION panol.register_unit_work_order(
    p_tractor_id UUID,
    p_semi_id UUID,
    p_work_order_id UUID
)
RETURNS UUID AS $$
DECLARE
    prev_wo RECORD;
    v_uwo_id UUID;
BEGIN
    -- 1. Buscar órdenes previas activas para el tractor o semi
    FOR prev_wo IN 
        SELECT DISTINCT uwo.work_order_id as id
        FROM panol.unit_work_orders uwo
        JOIN panol.work_orders wo ON uwo.work_order_id = wo.id
        WHERE wo.status = 'ACTIVA'
          AND wo.id != p_work_order_id
          AND (
            (p_tractor_id IS NOT NULL AND uwo.tractor_id = p_tractor_id)
            OR
            (p_semi_id IS NOT NULL AND uwo.semi_id = p_semi_id)
          )
    LOOP
        -- Consolidar orden previa como INCOMPLETA (purga de work_orders y unit_work_orders)
        PERFORM panol.consolidate_work_order_to_cold(prev_wo.id, 'INCOMPLETA');
    END LOOP;

    -- 2. Limpiar cualquier fila residual de unit_work_orders para estos IDs antes del insert
    IF p_tractor_id IS NOT NULL THEN
        DELETE FROM panol.unit_work_orders WHERE tractor_id = p_tractor_id;
    END IF;
    IF p_semi_id IS NOT NULL THEN
        DELETE FROM panol.unit_work_orders WHERE semi_id = p_semi_id;
    END IF;

    -- 3. Insertar la nueva relación canónica
    INSERT INTO panol.unit_work_orders (tractor_id, semi_id, work_order_id)
    VALUES (p_tractor_id, p_semi_id, p_work_order_id)
    RETURNING id INTO v_uwo_id;

    RETURN v_uwo_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.register_unit_work_order(
    p_tractor_id UUID,
    p_semi_id UUID,
    p_work_order_id UUID
)
RETURNS UUID AS $$
BEGIN
    RETURN panol.register_unit_work_order(p_tractor_id, p_semi_id, p_work_order_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION panol.register_unit_work_order(UUID, UUID, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_unit_work_order(UUID, UUID, UUID) TO anon, authenticated, service_role;
