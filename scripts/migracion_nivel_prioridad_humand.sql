-- ==============================================================================
-- 🚀 MIGRACIÓN: Incorporar nivel_prioridad en chofer_documentacion y vistas
-- Origen: Seguimiento Humand-01 (Control Pendientes)
-- ==============================================================================

BEGIN;

-- 1. Agregar columna nivel_prioridad a chofer_documentacion
ALTER TABLE public.chofer_documentacion 
ADD COLUMN IF NOT EXISTS nivel_prioridad TEXT;

-- 2. Índice para acelerar filtros y consultas por prioridad
CREATE INDEX IF NOT EXISTS idx_chofer_doc_nivel_prioridad 
ON public.chofer_documentacion(nivel_prioridad);

-- 3. Actualizar view_diaria_operativa incorporando cd.nivel_prioridad
CREATE OR REPLACE VIEW public.view_diaria_operativa WITH (security_invoker = true) AS
SELECT c.id AS chofer_id,
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
  COALESCE(sc.denominacion, 'GENERAL'::text) AS servicio,
  c.estado AS estado_chofer,
  cd.id AS doc_id,
  cd.venc_licencia_nacional,
  cd.venc_psicofisico,
  cd.venc_cargas_peligrosas,
  cd.venc_periodico,
  cd.venc_curso_shell,
  cd.venc_manejo_def,
  cd.apto_medico_venc,
  COALESCE(cd.apto_medico_estado, 'Activo'::text) AS apto_medico_estado,
  cd.avalado_contratos,
  cd.obs_documentacion,
  u.id AS unidad_id,
  u.n_ute,
  COALESCE(u.estado, 'disponible'::text) AS estado_unidad,
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
      WHEN cd.venc_periodico IS NOT NULL AND cd.venc_periodico < CURRENT_DATE OR cd.venc_licencia_nacional IS NOT NULL AND cd.venc_licencia_nacional < CURRENT_DATE OR cd.venc_cargas_peligrosas IS NOT NULL AND cd.venc_cargas_peligrosas < CURRENT_DATE OR cd.apto_medico_venc IS NOT NULL AND cd.apto_medico_venc < CURRENT_DATE THEN 'VENCIDO'::text
      WHEN cd.venc_periodico IS NOT NULL AND cd.venc_periodico <= (CURRENT_DATE + '30 days'::interval) OR cd.venc_licencia_nacional IS NOT NULL AND cd.venc_licencia_nacional <= (CURRENT_DATE + '30 days'::interval) OR cd.venc_cargas_peligrosas IS NOT NULL AND cd.venc_cargas_peligrosas <= (CURRENT_DATE + '30 days'::interval) OR cd.apto_medico_venc IS NOT NULL AND cd.apto_medico_venc <= (CURRENT_DATE + '30 days'::interval) THEN 'POR_VENCER'::text
      ELSE 'AL_DIA'::text
  END AS alerta_docs_chofer,
  CASE
      WHEN t.vtv IS NOT NULL AND t.vtv < CURRENT_DATE OR s.vtv IS NOT NULL AND s.vtv < CURRENT_DATE OR t.mas IS NOT NULL AND t.mas < CURRENT_DATE OR s.mas IS NOT NULL AND s.mas < CURRENT_DATE THEN 'VENCIDO'::text
      WHEN t.vtv IS NOT NULL AND t.vtv <= (CURRENT_DATE + '15 days'::interval) OR s.vtv IS NOT NULL AND s.vtv <= (CURRENT_DATE + '15 days'::interval) OR t.mas IS NOT NULL AND t.mas <= (CURRENT_DATE + '15 days'::interval) OR s.mas IS NOT NULL AND s.mas <= (CURRENT_DATE + '15 days'::interval) THEN 'POR_VENCER'::text
      WHEN t.id IS NOT NULL OR s.id IS NOT NULL THEN 'AL_DIA'::text
      ELSE 'S_D'::text
  END AS alerta_docs_unidad,
  COALESCE(diag.dia_codigo, '-'::text) AS dia_codigo,
  COALESCE(diag.dia_fecha, CURRENT_DATE::text) AS dia_fecha,
  diag.diagrama_tipo,
  c.actualizado_el,
  cd.nivel_prioridad
FROM choferes c
  LEFT JOIN chofer_documentacion cd ON cd.chofer_id = c.id
  LEFT JOIN servicios_choferes sc ON c.servicio_id = sc.id
  LEFT JOIN unidades u ON c.unidad_id = u.id
  LEFT JOIN tractores t ON u.tractor_id = t.id
  LEFT JOIN semis s ON u.semi_id = s.id
  LEFT JOIN LATERAL ( SELECT COALESCE(NULLIF(NULLIF(d.dias ->> CURRENT_DATE::text, '-'::text), ''::text), ( SELECT kv.value
                FROM jsonb_each_text(d.dias) kv(key, value)
                WHERE kv.value <> ALL (ARRAY['-'::text, ''::text, 'null'::text, '0'::text])
                ORDER BY kv.key DESC
              LIMIT 1), '-'::text) AS dia_codigo,
          COALESCE(
              CASE
                  WHEN (d.dias ->> CURRENT_DATE::text) <> ALL (ARRAY['-'::text, ''::text, 'null'::text]) THEN CURRENT_DATE::text
                  ELSE NULL::text
              END, ( SELECT kv.key
                FROM jsonb_each_text(d.dias) kv(key, value)
                WHERE kv.value <> ALL (ARRAY['-'::text, ''::text, 'null'::text, '0'::text])
                ORDER BY kv.key DESC
              LIMIT 1), CURRENT_DATE::text) AS dia_fecha,
          d.diagrama_tipo
        FROM diagramas d
        WHERE d.chofer_id = c.id
        ORDER BY d.anio DESC, d.mes_numero DESC
      LIMIT 1) diag ON true
WHERE (lower(TRIM(BOTH FROM c.nombre)) <> ALL (ARRAY['campo'::text, 'abast'::text, 'glp'::text, 'grales'::text, 'grales.'::text, 'liviano'::text, 'metanol'::text, 'pasivo en base'::text, 'ypf'::text, 'apellido y nombre'::text, 'personal activo'::text, 'chofer'::text, 'choferes'::text, 'vacante'::text, '-'::text, '1'::text])) AND length(TRIM(BOTH FROM c.nombre)) > 2;

-- 4. Recrear view_individual_chofer incorporando cd.nivel_prioridad
CREATE OR REPLACE VIEW public.view_individual_chofer WITH (security_invoker = true) AS
SELECT 
  chofer_id, nombre, legajo, dni, cuil, telefono, telef_corp, email,
  domicilio, localidad, telefono_emergencia, empresa, foto, servicio,
  estado_chofer, doc_id, venc_licencia_nacional, venc_psicofisico,
  venc_cargas_peligrosas, venc_periodico, venc_curso_shell, venc_manejo_def,
  apto_medico_venc, apto_medico_estado, avalado_contratos, obs_documentacion,
  unidad_id, n_ute, estado_unidad, tractor, marca_tr, modelo_tr, vtv_tr,
  mas_tr, semi, marca_semi, cisternado, esp_es, vi, ve, vtv_semi,
  mas_semi, alerta_docs_chofer, alerta_docs_unidad, dia_codigo, dia_fecha,
  diagrama_tipo, actualizado_el, nivel_prioridad
FROM public.view_diaria_operativa;

GRANT SELECT ON public.view_individual_chofer TO anon, authenticated, service_role;
GRANT SELECT ON public.view_diaria_operativa TO anon, authenticated, service_role;

COMMIT;
