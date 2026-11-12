-- ==============================================================================
-- 🚀 MIGRACIÓN SQL: PURGA LIMPIA DE ÓRDENES HISTÓRICAS PARA REINICIO DESDE CERO
-- Limpia panol.work_order_tasks, panol.unit_work_orders y panol.work_orders.
-- Fecha: 2026-11-11
-- ==============================================================================

BEGIN;

-- 1. Purgar tareas vivas
TRUNCATE TABLE panol.work_order_tasks CASCADE;

-- 2. Purgar vínculos de órdenes con tractores/semis
TRUNCATE TABLE panol.unit_work_orders CASCADE;

-- 3. Limpiar referencias en staff_holds si quedara alguna activa
UPDATE panol.staff_holds 
SET work_order_id = NULL, 
    tractor_work_order_id = NULL, 
    semi_work_order_id = NULL;

-- 4. Purgar cabeceras de órdenes de trabajo
DELETE FROM panol.work_orders;

COMMIT;
