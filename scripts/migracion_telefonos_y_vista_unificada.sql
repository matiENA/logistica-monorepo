-- ==============================================================================
-- 🚀 MIGRACIÓN: TELEFONOS CORPORATIVOS (telef_corp) + VISTA UNIFICADA CANÓNICA
-- Proyectos: EOR | DASH | BACKEND MASTER
-- Fecha: 2026-11-05
-- ==============================================================================

BEGIN;

-- 1. Agregar columna telef_corp a chofer_documentacion
ALTER TABLE public.chofer_documentacion 
ADD COLUMN IF NOT EXISTS telef_corp TEXT;

-- Índice para búsquedas por teléfono corporativo
CREATE INDEX IF NOT EXISTS idx_chofer_doc_telef_corp 
ON public.chofer_documentacion(telef_corp);

-- 2. Eliminar vistas previas para reconstrucción limpia y sin conflictos de tipos/dependencias
DROP VIEW IF EXISTS public.view_individual_chofer CASCADE;
DROP VIEW IF EXISTS public.view_diaria_operativa CASCADE;

-- 3. VISTA UNIFICADA CANÓNICA (DIARIA + INDIVIDUAL)
-- Concentra en un único JOIN canónico:
-- Chofer + Documentación completa (telefono personal + telef_corp) + Unidad + Diagrama vigente + Semáforos de Alertas
CREATE OR REPLACE VIEW public.view_diaria_operativa WITH (security_invoker = true) AS
SELECT 
    c.id AS chofer_id,
    c.nombre,
    c.legajo,
    cd.dni,
    cd.cuil,
    cd.telefono,
    cd.telef_corp,
    cd.email,
    cd.domicilio,
    cd.localidad,
    cd.telefono_emergencia,
    cd.empresa,
    c.foto,
    COALESCE(sc.denominacion, 'GENERAL') AS servicio,
    c.estado AS estado_chofer,
    cd.id AS doc_id,
    cd.venc_licencia_nacional,
    cd.venc_psicofisico,
    cd.venc_cargas_peligrosas,
    cd.venc_periodico,
    cd.venc_curso_shell,
    cd.venc_manejo_def,
    cd.apto_medico_venc,
    COALESCE(cd.apto_medico_estado, 'Activo') AS apto_medico_estado,
    cd.avalado_contratos,
    cd.obs_documentacion,
    u.id AS unidad_id,
    u.n_ute,
    COALESCE(u.estado, 'disponible') AS estado_unidad,
    t.patente AS tractor,
    t.marca AS marca_tr,
    t.modelo AS modelo_tr,
    t.vtv AS vtv_tr,
    t.mas AS mas_tr,
    s.patente AS semi,
    s.marca AS marca_semi,
    s.cisternado,
    s.esp_es,
    s.vi,
    s.ve,
    s.vtv AS vtv_semi,
    s.mas AS mas_semi,
    CASE
        WHEN (((cd.venc_periodico IS NOT NULL) AND (cd.venc_periodico < CURRENT_DATE)) OR ((cd.venc_licencia_nacional IS NOT NULL) AND (cd.venc_licencia_nacional < CURRENT_DATE)) OR ((cd.venc_cargas_peligrosas IS NOT NULL) AND (cd.venc_cargas_peligrosas < CURRENT_DATE)) OR ((cd.apto_medico_venc IS NOT NULL) AND (cd.apto_medico_venc < CURRENT_DATE))) THEN 'VENCIDO'
        WHEN (((cd.venc_periodico IS NOT NULL) AND (cd.venc_periodico <= (CURRENT_DATE + '30 days'::interval))) OR ((cd.venc_licencia_nacional IS NOT NULL) AND (cd.venc_licencia_nacional <= (CURRENT_DATE + '30 days'::interval))) OR ((cd.venc_cargas_peligrosas IS NOT NULL) AND (cd.venc_cargas_peligrosas <= (CURRENT_DATE + '30 days'::interval))) OR ((cd.apto_medico_venc IS NOT NULL) AND (cd.apto_medico_venc <= (CURRENT_DATE + '30 days'::interval)))) THEN 'POR_VENCER'
        ELSE 'AL_DIA'
    END AS alerta_docs_chofer,
    CASE
        WHEN (((t.vtv IS NOT NULL) AND (t.vtv < CURRENT_DATE)) OR ((s.vtv IS NOT NULL) AND (s.vtv < CURRENT_DATE)) OR ((t.mas IS NOT NULL) AND (t.mas < CURRENT_DATE)) OR ((s.mas IS NOT NULL) AND (s.mas < CURRENT_DATE))) THEN 'VENCIDO'
        WHEN (((t.vtv IS NOT NULL) AND (t.vtv <= (CURRENT_DATE + '15 days'::interval))) OR ((s.vtv IS NOT NULL) AND (s.vtv <= (CURRENT_DATE + '15 days'::interval))) OR ((t.mas IS NOT NULL) AND (t.mas <= (CURRENT_DATE + '15 days'::interval))) OR ((s.mas IS NOT NULL) AND (s.mas <= (CURRENT_DATE + '15 days'::interval)))) THEN 'POR_VENCER'
        WHEN ((t.id IS NOT NULL) OR (s.id IS NOT NULL)) THEN 'AL_DIA'
        ELSE 'S_D'
    END AS alerta_docs_unidad,
    COALESCE(diag.dia_codigo, '-') AS dia_codigo,
    COALESCE(diag.dia_fecha, (CURRENT_DATE)::text) AS dia_fecha,
    diag.diagrama_tipo,
    c.actualizado_el
FROM public.choferes c
LEFT JOIN public.chofer_documentacion cd ON cd.chofer_id = c.id
LEFT JOIN public.servicios_choferes sc ON c.servicio_id = sc.id
LEFT JOIN public.unidades u ON c.unidad_id = u.id
LEFT JOIN public.tractores t ON u.tractor_id = t.id
LEFT JOIN public.semis s ON u.semi_id = s.id
LEFT JOIN LATERAL (
    SELECT 
        COALESCE(NULLIF(NULLIF((d.dias ->> (CURRENT_DATE)::text), '-'), ''), (
            SELECT kv.value FROM jsonb_each_text(d.dias) kv(key, value)
            WHERE kv.value <> ALL (ARRAY['-', '', 'null', '0'])
            ORDER BY kv.key DESC LIMIT 1
        ), '-') AS dia_codigo,
        COALESCE(
            CASE WHEN ((d.dias ->> (CURRENT_DATE)::text) <> ALL (ARRAY['-', '', 'null'])) THEN (CURRENT_DATE)::text ELSE NULL END,
            (SELECT kv.key FROM jsonb_each_text(d.dias) kv(key, value) WHERE kv.value <> ALL (ARRAY['-', '', 'null', '0']) ORDER BY kv.key DESC LIMIT 1),
            (CURRENT_DATE)::text
        ) AS dia_fecha,
        d.diagrama_tipo
    FROM public.diagramas d
    WHERE d.chofer_id = c.id
    ORDER BY d.anio DESC, d.mes_numero DESC
    LIMIT 1
) diag ON true
WHERE lower(TRIM(c.nombre)) <> ALL (ARRAY['campo', 'abast', 'glp', 'grales', 'grales.', 'liviano', 'metanol', 'pasivo en base', 'ypf', 'apellido y nombre', 'personal activo', 'chofer', 'choferes', 'vacante', '-', '1'])
  AND length(TRIM(c.nombre)) > 2;

-- 4. VISTA INDIVIDUAL (CANÓNICAMENTE LA MISMA VISTA)
CREATE OR REPLACE VIEW public.view_individual_chofer WITH (security_invoker = true) AS
SELECT * FROM public.view_diaria_operativa;

-- 5. Permisos de lectura
GRANT SELECT ON public.view_diaria_operativa TO anon, authenticated, service_role;
GRANT SELECT ON public.view_individual_chofer TO anon, authenticated, service_role;

COMMIT;
