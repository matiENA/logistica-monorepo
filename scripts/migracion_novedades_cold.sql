-- ==============================================================================
-- MIGRACIÓN: COLD STORAGE PARA NOVEDADES (public.novedades_cold)
-- ==============================================================================
-- Arquitectura /db-render-arch (Partición Física Hot / Cold):
--   - Hot  (G1): public.novedades (activas + resueltas < 15 días)
--                Alimenta exclusivamente a view_cards_diarias y view_dash_novedades.
--   - Cold (G4): public.novedades_cold (resueltas >= 15 días desde creado_el)
--                0 vistas nuevas · 0 Realtime · 0 FKs hacia tablas calientes.
--                Preparada con periodo_mes ('YYYY-MM') y snapshot legible para
--                futura exportación mensual a archivos .json.
-- ==============================================================================

BEGIN;

-- 1. Crear tabla física de Cold Storage en public
CREATE TABLE IF NOT EXISTS public.novedades_cold (
    id bigint PRIMARY KEY,
    unidad_id uuid,
    chofer_id uuid,
    tipo_novedad_id uuid NOT NULL,
    terminal_id uuid,
    creado_por_id uuid,
    fecha_objetivo date,
    fecha_resolucion timestamptz,
    detalle text NOT NULL DEFAULT '',
    resuelto boolean NOT NULL DEFAULT true,
    prioridad text NOT NULL DEFAULT 'media',
    creado_el timestamptz NOT NULL,
    actualizado_el timestamptz NOT NULL,
    -- Snapshot desnormalizado autosuficiente para exportación mensual JSON (0 JOINs)
    tipo_novedad_codigo text NOT NULL DEFAULT '',
    tipo_novedad_titulo text NOT NULL DEFAULT '',
    chofer_nombre text NOT NULL DEFAULT '',
    n_ute text NOT NULL DEFAULT '',
    tractor_patente text NOT NULL DEFAULT '',
    terminal_codigo text NOT NULL DEFAULT '',
    creador_nombre text NOT NULL DEFAULT 'DASH',
    menciones text[] NOT NULL DEFAULT '{}'::text[],
    -- Metadatos Cold Storage
    periodo_mes text NOT NULL, -- 'YYYY-MM' en zona America/Argentina/Buenos_Aires
    archived_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Índices B-Tree para consultas On-Demand C2 y exportación mensual JSON
CREATE INDEX IF NOT EXISTS idx_novedades_cold_periodo_mes
    ON public.novedades_cold (periodo_mes, creado_el DESC);

CREATE INDEX IF NOT EXISTS idx_novedades_cold_archived_at
    ON public.novedades_cold (archived_at DESC);

-- 3. Seguridad RLS y revocación de acceso a anon
ALTER TABLE public.novedades_cold ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.novedades_cold FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.novedades_cold TO authenticated, service_role;

DROP POLICY IF EXISTS pol_novedades_cold_backend ON public.novedades_cold;
CREATE POLICY pol_novedades_cold_backend
    ON public.novedades_cold
    FOR ALL
    TO authenticated, service_role
    USING (true)
    WITH CHECK (true);

-- 4. Función RPC transaccional ACID: archiva resueltas con >= 15 días desde creado_el
--    Salvaguarda: exige sync_sheets_estado IN ('OMITIDO', 'LIMPIADO') para no archivar
--    novedades con limpieza hover pendiente en Google Sheets.
CREATE OR REPLACE FUNCTION public.fn_archivar_novedades_cold(
    p_retencion interval DEFAULT '15 days'::interval
)
RETURNS TABLE(
    archived_rows integer,
    oldest_creado_el timestamptz,
    newest_creado_el timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_rows integer := 0;
    v_oldest timestamptz := NULL;
    v_newest timestamptz := NULL;
BEGIN
    -- Lock transaccional (Supavisor 6543 safe, 0 WAL)
    IF NOT pg_try_advisory_xact_lock(hashtext('public.fn_archivar_novedades_cold')) THEN
        RETURN QUERY SELECT 0, NULL::timestamptz, NULL::timestamptz;
        RETURN;
    END IF;

    WITH candidatas AS (
        SELECT
            n.id,
            n.unidad_id,
            n.chofer_id,
            n.tipo_novedad_id,
            n.terminal_id,
            n.creado_por_id,
            n.fecha_objetivo,
            n.fecha_resolucion,
            COALESCE(n.detalle, '') AS detalle,
            COALESCE(n.resuelto, true) AS resuelto,
            COALESCE(n.prioridad, 'media') AS prioridad,
            n.creado_el,
            COALESCE(n.actualizado_el, n.creado_el) AS actualizado_el,
            COALESCE(tn.codigo, '') AS tipo_novedad_codigo,
            COALESCE(tn.titulo, '') AS tipo_novedad_titulo,
            UPPER(TRIM(COALESCE(c.nombre, ''))) AS chofer_nombre,
            COALESCE(u.n_ute, '') AS n_ute,
            UPPER(TRIM(COALESCE(t.patente, ''))) AS tractor_patente,
            COALESCE(term.codigo, '') AS terminal_codigo,
            COALESCE(d_user.nombre, 'DASH') AS creador_nombre,
            COALESCE((
                SELECT array_agg(m.usuario_nombre ORDER BY m.mencionado_el ASC)
                FROM public.dash_menciones m
                WHERE m.novedad_id = n.id
            ), '{}'::text[]) AS menciones,
            TO_CHAR(n.creado_el AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') AS periodo_mes
        FROM public.novedades n
        LEFT JOIN public.tipos_novedad tn ON n.tipo_novedad_id = tn.id
        LEFT JOIN public.choferes c ON n.chofer_id = c.id
        LEFT JOIN public.unidades u ON n.unidad_id = u.id
        LEFT JOIN public.tractores t ON u.tractor_id = t.id
        LEFT JOIN public.terminales term ON n.terminal_id = term.id
        LEFT JOIN public.dash d_user ON n.creado_por_id = d_user.id
        WHERE n.resuelto = true
          AND n.creado_el <= (now() - p_retencion)
          AND COALESCE(n.sync_sheets_estado, 'OMITIDO') IN ('OMITIDO', 'LIMPIADO')
    ),
    inserted AS (
        INSERT INTO public.novedades_cold (
            id, unidad_id, chofer_id, tipo_novedad_id, terminal_id, creado_por_id,
            fecha_objetivo, fecha_resolucion, detalle, resuelto, prioridad,
            creado_el, actualizado_el,
            tipo_novedad_codigo, tipo_novedad_titulo, chofer_nombre, n_ute,
            tractor_patente, terminal_codigo, creador_nombre, menciones,
            periodo_mes, archived_at
        )
        SELECT
            id, unidad_id, chofer_id, tipo_novedad_id, terminal_id, creado_por_id,
            fecha_objetivo, fecha_resolucion, detalle, resuelto, prioridad,
            creado_el, actualizado_el,
            tipo_novedad_codigo, tipo_novedad_titulo, chofer_nombre, n_ute,
            tractor_patente, terminal_codigo, creador_nombre, menciones,
            periodo_mes, now()
        FROM candidatas
        ON CONFLICT (id) DO NOTHING
        RETURNING id, creado_el
    ),
    deleted AS (
        DELETE FROM public.novedades n
        WHERE n.id IN (SELECT id FROM candidatas)
        RETURNING n.id
    )
    SELECT
        COUNT(i.id)::integer,
        MIN(i.creado_el),
        MAX(i.creado_el)
    INTO v_rows, v_oldest, v_newest
    FROM inserted i;

    RETURN QUERY SELECT COALESCE(v_rows, 0), v_oldest, v_newest;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_archivar_novedades_cold(interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_archivar_novedades_cold(interval) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_archivar_novedades_cold(interval) TO authenticated, service_role;

COMMIT;
