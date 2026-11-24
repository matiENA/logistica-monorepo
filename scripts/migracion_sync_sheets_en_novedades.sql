-- ==============================================================================
-- MIGRACIÓN: DASH SYNC TO SHEETS MULTI-NOVEDAD + ESTADO DIRECTO EN public.novedades
-- ==============================================================================
-- Alcance:
--   1. Habilitar imprime_nota_movimientos = true en public.tipos_novedad para
--      TODOS los tipos por UUID excepto LIBRES.
--   2. Agregar columnas de control y resiliencia sync_sheets_* directamente en
--      la tabla física public.novedades (0 tablas extra, 0 cambios en vistas).
--   3. Índice parcial ultracompacto (< 8 KB) solo sobre estados con trabajo activo.
--   4. Backfill inicial: marcar novedades activas elegibles como 'PENDIENTE'.
-- ==============================================================================

BEGIN;

-- 1. Habilitar impresión hover por UUID para todos los tipos excepto LIBRES
UPDATE public.tipos_novedad
SET imprime_nota_movimientos = CASE
    WHEN UPPER(TRIM(codigo)) = 'LIBRES' THEN false
    ELSE true
END
WHERE imprime_nota_movimientos IS DISTINCT FROM (UPPER(TRIM(codigo)) <> 'LIBRES');

-- 2. Columnas de estado y resiliencia directamente en la tabla física public.novedades
--    (NO se agregan a view_cards_diarias ni view_dash_novedades para mantener 0 egress extra)
ALTER TABLE public.novedades
    ADD COLUMN IF NOT EXISTS sync_sheets_estado text NOT NULL DEFAULT 'OMITIDO',
    ADD COLUMN IF NOT EXISTS sync_sheets_celdas jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS sync_sheets_hash text,
    ADD COLUMN IF NOT EXISTS sync_sheets_reintentos smallint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sync_sheets_error text,
    ADD COLUMN IF NOT EXISTS sync_sheets_at timestamptz;

ALTER TABLE public.novedades
    DROP CONSTRAINT IF EXISTS chk_novedades_sync_sheets_estado;

ALTER TABLE public.novedades
    ADD CONSTRAINT chk_novedades_sync_sheets_estado
    CHECK (sync_sheets_estado IN (
        'OMITIDO',
        'PENDIENTE',
        'PENDIENTE_LIMPIEZA',
        'PAUSADO',
        'PENDIENTE_TIPEO',
        'SINCRONIZADO',
        'LIMPIADO',
        'ERROR'
    ));

-- 3. Índice parcial ultracompacto solo para filas con sync pendiente / pausado / error
CREATE INDEX IF NOT EXISTS idx_novedades_sync_sheets_activos
    ON public.novedades (id DESC)
    WHERE sync_sheets_estado IN (
        'PENDIENTE',
        'PENDIENTE_LIMPIEZA',
        'PAUSADO',
        'PENDIENTE_TIPEO',
        'ERROR'
    );

-- 4. Backfill inicial: marcar como PENDIENTE las novedades activas elegibles (sin tocar actualizado_el)
UPDATE public.novedades n
SET sync_sheets_estado = 'PENDIENTE'
FROM public.tipos_novedad tn
WHERE n.tipo_novedad_id = tn.id
  AND tn.imprime_nota_movimientos = true
  AND UPPER(TRIM(tn.codigo)) <> 'LIBRES'
  AND n.resuelto = false
  AND n.chofer_id IS NOT NULL
  AND (
      n.fecha_objetivo IS NULL
      OR n.fecha_objetivo >= (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
  )
  AND n.sync_sheets_estado = 'OMITIDO';

COMMIT;
