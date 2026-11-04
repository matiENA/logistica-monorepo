-- ==============================================================================
-- 🚀 CREACIÓN DE view_individual_chofer (COMPATIBILIDAD EOR + NODE GATEWAY)
-- Proyectos: EOR | DASH | BACKEND MASTER
-- Fecha: 2026-11-04
-- ==============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.view_individual_chofer WITH (security_invoker = true) AS
SELECT 
    c.id AS chofer_id,
    c.nombre,
    c.legajo,
    cd.dni,
    cd.cuil,
    cd.telefono,
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
    c.actualizado_el
FROM public.choferes c
LEFT JOIN public.chofer_documentacion cd ON cd.chofer_id = c.id
LEFT JOIN public.servicios_choferes sc ON c.servicio_id = sc.id
LEFT JOIN public.unidades u ON c.unidad_id = u.id
LEFT JOIN public.tractores t ON u.tractor_id = t.id
LEFT JOIN public.semis s ON u.semi_id = s.id;

GRANT SELECT ON public.view_individual_chofer TO anon, authenticated, service_role;

COMMIT;
