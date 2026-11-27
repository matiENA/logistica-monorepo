-- ==============================================================================
-- 🛠️ REMEDIACIÓN INTEGRAL DE VISTAS: Fusión Multi-Mes y Zona Horaria Argentina
-- 1. fn_personal_retorno + view_personal_retorno: fusión multi-mes (p_fecha -2..+4)
--    para no perder filas al existir meses futuros (ej. Dic-26 junto a Nov-26)
--    y cubrir cruces de fin/inicio de mes, usando fecha Argentina.
-- 2. view_calendario_diagrama_km_12m: dinamizar año vigente (sin 2026 hardcodeado).
-- 3. view_flota_operativa, view_movimientos, view_diaria_operativa,
--    view_dash_novedades y view_dashboard_kpis: unificar a fecha Argentina
--    (America/Argentina/Buenos_Aires) evitando desfases entre 21:00 y 23:59 ART.
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 1. fn_personal_retorno y view_personal_retorno (Fusión Multi-Mes + TZ Argentina)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.fn_personal_retorno(
    p_fecha date DEFAULT (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
)
 RETURNS TABLE(
    chofer_id uuid,
    nombre text,
    dni text,
    servicio text,
    n_ute text,
    tractor text,
    semi text,
    codigo_ayer text,
    codigo_hoy text,
    codigo_manana text,
    retorna_cuando text,
    fecha_retorno date,
    dias_para_retorno integer,
    estado_capacitacion text
 )
 LANGUAGE plpgsql
 STABLE
AS $function$
    DECLARE
        v_m2_dt DATE := (p_fecha - INTERVAL '2 days')::date;
        v_p4_dt DATE := (p_fecha + INTERVAL '4 days')::date;
        v_m2 TEXT := v_m2_dt::text;
        v_m1 TEXT := (p_fecha - INTERVAL '1 day')::date::text;
        v_0  TEXT := p_fecha::text;
        v_p1 TEXT := (p_fecha + INTERVAL '1 day')::date::text;
        v_p2 TEXT := (p_fecha + INTERVAL '2 days')::date::text;
        v_p3 TEXT := (p_fecha + INTERVAL '3 days')::date::text;
        v_p4 TEXT := v_p4_dt::text;
        v_mes_min DATE := date_trunc('month', v_m2_dt)::date;
        v_mes_max DATE := date_trunc('month', v_p4_dt)::date;
    BEGIN
        RETURN QUERY
        WITH codigos AS (
            SELECT
                c.id AS q_chofer_id,
                c.nombre AS q_nombre,
                cd.dni AS q_dni,
                COALESCE(sc.denominacion, 'GENERAL') AS q_servicio,
                u.n_ute AS q_n_ute,
                t.patente AS q_tractor,
                s.patente AS q_semi,
                cd.estado_capacitacion AS q_estado_capacitacion,
                UPPER(TRIM(COALESCE(d.dias ->> v_m2, '-'))) AS code_m2,
                UPPER(TRIM(COALESCE(d.dias ->> v_m1, '-'))) AS code_m1,
                UPPER(TRIM(COALESCE(d.dias ->> v_0,  '-'))) AS code_0,
                UPPER(TRIM(COALESCE(d.dias ->> v_p1, '-'))) AS code_p1,
                UPPER(TRIM(COALESCE(d.dias ->> v_p2, '-'))) AS code_p2,
                UPPER(TRIM(COALESCE(d.dias ->> v_p3, '-'))) AS code_p3,
                UPPER(TRIM(COALESCE(d.dias ->> v_p4, '-'))) AS code_p4
            FROM public.choferes c
            LEFT JOIN public.chofer_documentacion cd ON cd.chofer_id = c.id
            LEFT JOIN public.servicios_choferes sc ON c.servicio_id = sc.id
            LEFT JOIN public.movimientos m ON m.id_chofer = c.id
            LEFT JOIN public.unidades u ON COALESCE(c.unidad_id, m.id_unidad) = u.id
            LEFT JOIN public.tractores t ON u.tractor_id = t.id
            LEFT JOIN public.semis s ON u.semi_id = s.id
            LEFT JOIN LATERAL (
                SELECT jsonb_object_agg(kv.key, kv.value) AS dias
                FROM (
                    SELECT sub_d.dias
                    FROM public.diagramas sub_d
                    WHERE sub_d.chofer_id = c.id
                      AND make_date(sub_d.anio, sub_d.mes_numero, 1) BETWEEN v_mes_min AND v_mes_max
                ) meses,
                LATERAL jsonb_each_text(meses.dias) kv(key, value)
            ) d ON true
            WHERE LOWER(TRIM(c.nombre)) NOT IN (
                'campo', 'abast', 'glp', 'grales', 'grales.', 'liviano',
                'metanol', 'pasivo en base', 'ypf', 'apellido y nombre',
                'personal activo', 'chofer', 'choferes', 'vacante', '-', '1'
              ) AND LENGTH(TRIM(c.nombre)) > 2
        ),
        evaluados AS (
            SELECT
                codigos.*,
                (code_m2 ~ '[A-Za-z]') AS nov_m2,
                (code_m1 ~ '[A-Za-z]') AS nov_m1,
                (code_0  ~ '[A-Za-z]') AS nov_0,
                (code_p1 ~ '[A-Za-z]') AS nov_p1,
                (code_p2 ~ '[A-Za-z]') AS nov_p2,
                (code_p3 ~ '[A-Za-z]') AS nov_p3,
                (code_p4 ~ '[A-Za-z]') AS nov_p4
            FROM codigos
        ),
        clasificados AS (
            SELECT
                evaluados.q_chofer_id,
                evaluados.q_nombre,
                evaluados.q_dni,
                evaluados.q_servicio,
                evaluados.q_n_ute,
                evaluados.q_tractor,
                evaluados.q_semi,
                evaluados.code_m1 AS q_code_ayer,
                evaluados.code_0  AS q_code_hoy,
                evaluados.code_p1 AS q_code_manana,
                CASE
                    WHEN evaluados.nov_m2 AND NOT evaluados.nov_m1 THEN 'AYER'
                    WHEN evaluados.nov_m1 AND NOT evaluados.nov_0 THEN 'HOY'
                    WHEN evaluados.nov_0 AND NOT evaluados.nov_p1 THEN 'MAÑANA'
                    WHEN evaluados.nov_0 AND evaluados.nov_p1 AND NOT evaluados.nov_p2 THEN 'EN 2 DÍAS'
                    WHEN evaluados.nov_0 AND evaluados.nov_p1 AND evaluados.nov_p2 AND NOT evaluados.nov_p3 THEN 'EN 3 DÍAS'
                    WHEN evaluados.nov_0 AND evaluados.nov_p1 AND evaluados.nov_p2 AND evaluados.nov_p3 AND NOT evaluados.nov_p4 THEN 'EN 4 DÍAS'
                    ELSE NULL
                END AS q_retorna_cuando,
                CASE
                    WHEN evaluados.nov_m2 AND NOT evaluados.nov_m1 THEN (p_fecha - INTERVAL '1 day')::date
                    WHEN evaluados.nov_m1 AND NOT evaluados.nov_0 THEN p_fecha
                    WHEN evaluados.nov_0 AND NOT evaluados.nov_p1 THEN (p_fecha + INTERVAL '1 day')::date
                    WHEN evaluados.nov_0 AND evaluados.nov_p1 AND NOT evaluados.nov_p2 THEN (p_fecha + INTERVAL '2 days')::date
                    WHEN evaluados.nov_0 AND evaluados.nov_p1 AND evaluados.nov_p2 AND NOT evaluados.nov_p3 THEN (p_fecha + INTERVAL '3 days')::date
                    WHEN evaluados.nov_0 AND evaluados.nov_p1 AND evaluados.nov_p2 AND evaluados.nov_p3 AND NOT evaluados.nov_p4 THEN (p_fecha + INTERVAL '4 days')::date
                    ELSE NULL
                END AS q_fecha_retorno,
                CASE
                    WHEN evaluados.nov_m2 AND NOT evaluados.nov_m1 THEN -1
                    WHEN evaluados.nov_m1 AND NOT evaluados.nov_0 THEN 0
                    WHEN evaluados.nov_0 AND NOT evaluados.nov_p1 THEN 1
                    WHEN evaluados.nov_0 AND evaluados.nov_p1 AND NOT evaluados.nov_p2 THEN 2
                    WHEN evaluados.nov_0 AND evaluados.nov_p1 AND evaluados.nov_p2 AND NOT evaluados.nov_p3 THEN 3
                    WHEN evaluados.nov_0 AND evaluados.nov_p1 AND evaluados.nov_p2 AND evaluados.nov_p3 AND NOT evaluados.nov_p4 THEN 4
                    ELSE NULL
                END AS q_dias_para_retorno,
                evaluados.q_estado_capacitacion
            FROM evaluados
        )
        SELECT
            clasificados.q_chofer_id,
            clasificados.q_nombre,
            clasificados.q_dni,
            clasificados.q_servicio,
            clasificados.q_n_ute,
            clasificados.q_tractor,
            clasificados.q_semi,
            clasificados.q_code_ayer,
            clasificados.q_code_hoy,
            clasificados.q_code_manana,
            clasificados.q_retorna_cuando,
            clasificados.q_fecha_retorno,
            clasificados.q_dias_para_retorno,
            clasificados.q_estado_capacitacion
        FROM clasificados
        WHERE clasificados.q_retorna_cuando IS NOT NULL;
    END;
$function$;

CREATE OR REPLACE VIEW public.view_personal_retorno WITH (security_invoker = true) AS
SELECT * FROM public.fn_personal_retorno((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date);

GRANT EXECUTE ON FUNCTION public.fn_personal_retorno(DATE) TO anon, authenticated, service_role, postgres;
GRANT SELECT ON public.view_personal_retorno TO anon, authenticated, service_role, postgres;

-- ==============================================================================
-- 2. view_calendario_diagrama_km_12m (Año dinámico Argentina, sin 2026 hardcodeado)
-- ==============================================================================
CREATE OR REPLACE VIEW public.view_calendario_diagrama_km_12m WITH (security_invoker = true) AS
 SELECT COALESCE(d.id, gen_random_uuid()) AS diagrama_id,
    COALESCE(d.chofer_id, ck.chofer_id) AS chofer_id,
    COALESCE(d.mes_tab, ck.mes_tab) AS mes_tab,
    COALESCE(d.anio, ck.anio) AS anio,
    COALESCE(d.mes_numero, ck.mes_numero) AS mes_numero,
    COALESCE(d.tira_dias, ''::text) AS tira_dias,
    COALESCE(d.contabilizador, '{}'::jsonb) AS contabilizador,
    COALESCE(ck.km_mes_total, (0)::numeric) AS km_mes_total,
    COALESCE(ck.cant_viajes, 0) AS cant_viajes_mes,
    COALESCE(ck.dias_km, '{}'::jsonb) AS dias_km,
    sv.icm,
    sv.isp,
    COALESCE(sv.cant_infracciones, 0) AS cant_infracciones,
    COALESCE(sv.tiempo_conduccion_horas, (0)::numeric) AS tiempo_conduccion_horas
   FROM ((public.diagramas d
     FULL JOIN public.choferes_km_mensual ck ON (((ck.chofer_id = d.chofer_id) AND (ck.mes_tab = d.mes_tab))))
     LEFT JOIN public.seguridad_vial sv ON (((sv.chofer_id = COALESCE(d.chofer_id, ck.chofer_id)) AND (sv.anio = COALESCE(d.anio, ck.anio)) AND (sv.mes_numero = COALESCE(d.mes_numero, ck.mes_numero)))))
  WHERE (COALESCE(d.anio, ck.anio) = (EXTRACT(year FROM (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))::integer);

GRANT SELECT ON public.view_calendario_diagrama_km_12m TO anon, authenticated, service_role, postgres;

-- ==============================================================================
-- 3. view_flota_operativa (TZ Argentina)
-- ==============================================================================
CREATE OR REPLACE VIEW public.view_flota_operativa WITH (security_invoker = true) AS
 SELECT u.id AS unidad_id,
    COALESCE(u.n_ute, ''::text) AS n_ute,
    COALESCE(t.patente, ''::text) AS tractor,
    COALESCE(s.patente, ''::text) AS semi,
    c.id AS chofer_id,
    COALESCE(c.nombre, ''::text) AS chofer_nombre,
    COALESCE(c.nombre, ''::text) AS nom,
    COALESCE(diag.dia_codigo, '-'::text) AS dia_diagrama,
    t.vtv AS vtv_tr,
    t.mas AS mas_tr,
    s.vtv AS vtv_semi,
    s.mas AS mas_semi,
    COALESCE(su.denominacion, 'GENERAL'::text) AS servicio,
    COALESCE(su.denominacion, 'GENERAL'::text) AS srv,
    t.id AS tractor_id,
    t.marca AS marca_tr,
    t.modelo AS modelo_tr,
    s.id AS semi_id,
    s.marca AS marca_semi,
    s.cisternado,
    s.esp_es,
    s.vi,
    s.ve,
    COALESCE(u.estado, 'disponible'::text) AS estado_unidad,
    NULL::text AS ot_activa,
    COALESCE(c.estado, 'disponible'::text) AS estado_chofer,
    c.foto
   FROM ((((((public.unidades u
     LEFT JOIN public.servicios_unidades su ON ((u.servicio_id = su.id)))
     LEFT JOIN public.tractores t ON ((u.tractor_id = t.id)))
     LEFT JOIN public.semis s ON ((u.semi_id = s.id)))
     LEFT JOIN public.movimientos m ON ((u.id = m.id_unidad)))
     LEFT JOIN public.choferes c ON ((m.id_chofer = c.id)))
     LEFT JOIN LATERAL (
         SELECT (d.dias ->> (((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)::text)) AS dia_codigo
           FROM public.diagramas d
          WHERE ((d.chofer_id = c.id)
            AND (d.anio = (EXTRACT(year FROM (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))::integer)
            AND (d.mes_numero = (EXTRACT(month FROM (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))::integer))
         LIMIT 1
     ) diag ON (true));

GRANT SELECT ON public.view_flota_operativa TO anon, authenticated, service_role, postgres;

-- ==============================================================================
-- 4. view_movimientos (TZ Argentina)
-- ==============================================================================
CREATE OR REPLACE VIEW public.view_movimientos WITH (security_invoker = true) AS
 SELECT m.id AS movimiento_id,
    u.id AS unidad_id,
    u.n_ute,
    u.estado AS unidad_estado,
    u.fecha_acople,
    su.denominacion AS servicio_unidad,
    t.id AS tractor_id,
    t.patente AS tractor,
    t.marca AS marca_tr,
    t.modelo AS modelo_tr,
    t.vtv AS vtv_tr,
    t.mas AS mas_tr,
    s.id AS semi_id,
    s.patente AS semi,
    s.marca AS marca_semi,
    s.cisternado,
    s.esp_es,
    s.vi,
    s.ve,
    s.vtv AS vtv_semi,
    s.mas AS mas_semi,
    c.id AS chofer_id,
    c.nombre AS chofer_nombre,
    cd.dni AS chofer_dni,
    cd.cuil AS chofer_cuil,
    cd.telefono AS chofer_telefono,
    c.foto AS chofer_foto,
    c.estado AS chofer_estado,
    COALESCE(sc.denominacion, su.denominacion, 'GENERAL'::text) AS chofer_servicio,
    COALESCE((d.dias ->> (((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)::text)), '-'::text) AS dia_diagrama,
        CASE
            WHEN (((t.vtv IS NOT NULL) AND (t.vtv < (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))
               OR ((s.vtv IS NOT NULL) AND (s.vtv < (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))
               OR ((t.mas IS NOT NULL) AND (t.mas < (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))
               OR ((s.mas IS NOT NULL) AND (s.mas < (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))) THEN 'VENCIDO'::text
            WHEN (((t.vtv IS NOT NULL) AND (t.vtv <= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + '15 days'::interval)))
               OR ((s.vtv IS NOT NULL) AND (s.vtv <= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + '15 days'::interval)))
               OR ((t.mas IS NOT NULL) AND (t.mas <= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + '15 days'::interval)))
               OR ((s.mas IS NOT NULL) AND (s.mas <= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + '15 days'::interval)))) THEN 'POR_VENCER'::text
            WHEN ((t.id IS NOT NULL) OR (s.id IS NOT NULL)) THEN 'AL_DIA'::text
            ELSE 'S_D'::text
        END AS alerta_vencimientos_unidad,
    m.actualizado_el
   FROM ((((((((public.movimientos m
     JOIN public.unidades u ON ((m.id_unidad = u.id)))
     JOIN public.choferes c ON ((m.id_chofer = c.id)))
     LEFT JOIN public.chofer_documentacion cd ON ((cd.chofer_id = c.id)))
     LEFT JOIN public.tractores t ON ((u.tractor_id = t.id)))
     LEFT JOIN public.semis s ON ((u.semi_id = s.id)))
     LEFT JOIN public.servicios_unidades su ON ((u.servicio_id = su.id)))
     LEFT JOIN public.servicios_choferes sc ON ((c.servicio_id = sc.id)))
     LEFT JOIN LATERAL (
         SELECT diag.dias
           FROM public.diagramas diag
          WHERE ((diag.chofer_id = c.id)
            AND (diag.anio = (EXTRACT(year FROM (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))::integer)
            AND (diag.mes_numero = (EXTRACT(month FROM (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))::integer))
          ORDER BY diag.actualizado_el DESC
         LIMIT 1
     ) d ON (true))
  ORDER BY u.n_ute, t.patente;

GRANT SELECT ON public.view_movimientos TO anon, authenticated, service_role, postgres;

-- ==============================================================================
-- 5. view_diaria_operativa (TZ Argentina completa en alertas y diagramas)
-- ==============================================================================
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
            WHEN (((cd.venc_periodico IS NOT NULL) AND (cd.venc_periodico < (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))
               OR ((cd.venc_licencia_nacional IS NOT NULL) AND (cd.venc_licencia_nacional < (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))
               OR ((cd.venc_cargas_peligrosas IS NOT NULL) AND (cd.venc_cargas_peligrosas < (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))
               OR ((cd.apto_medico_venc IS NOT NULL) AND (cd.apto_medico_venc < (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))) THEN 'VENCIDO'::text
            WHEN (((cd.venc_periodico IS NOT NULL) AND (cd.venc_periodico <= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + '30 days'::interval)))
               OR ((cd.venc_licencia_nacional IS NOT NULL) AND (cd.venc_licencia_nacional <= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + '30 days'::interval)))
               OR ((cd.venc_cargas_peligrosas IS NOT NULL) AND (cd.venc_cargas_peligrosas <= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + '30 days'::interval)))
               OR ((cd.apto_medico_venc IS NOT NULL) AND (cd.apto_medico_venc <= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + '30 days'::interval)))) THEN 'POR_VENCER'::text
            ELSE 'AL_DIA'::text
        END AS alerta_docs_chofer,
        CASE
            WHEN (((t.vtv IS NOT NULL) AND (t.vtv < (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))
               OR ((s.vtv IS NOT NULL) AND (s.vtv < (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))
               OR ((t.mas IS NOT NULL) AND (t.mas < (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))
               OR ((s.mas IS NOT NULL) AND (s.mas < (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))) THEN 'VENCIDO'::text
            WHEN (((t.vtv IS NOT NULL) AND (t.vtv <= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + '15 days'::interval)))
               OR ((s.vtv IS NOT NULL) AND (s.vtv <= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + '15 days'::interval)))
               OR ((t.mas IS NOT NULL) AND (t.mas <= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + '15 days'::interval)))
               OR ((s.mas IS NOT NULL) AND (s.mas <= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + '15 days'::interval)))) THEN 'POR_VENCER'::text
            WHEN ((t.id IS NOT NULL) OR (s.id IS NOT NULL)) THEN 'AL_DIA'::text
            ELSE 'S_D'::text
        END AS alerta_docs_unidad,
    COALESCE(diag.dia_codigo, '-'::text) AS dia_codigo,
    COALESCE(diag.dia_fecha, (((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)::text)) AS dia_fecha,
    diag.diagrama_tipo,
    c.actualizado_el,
    cd.nivel_prioridad
   FROM ((((((public.choferes c
     LEFT JOIN public.chofer_documentacion cd ON ((cd.chofer_id = c.id)))
     LEFT JOIN public.servicios_choferes sc ON ((c.servicio_id = sc.id)))
     LEFT JOIN public.unidades u ON ((c.unidad_id = u.id)))
     LEFT JOIN public.tractores t ON ((u.tractor_id = t.id)))
     LEFT JOIN public.semis s ON ((u.semi_id = s.id)))
     LEFT JOIN LATERAL (
         SELECT COALESCE(
                NULLIF(NULLIF((d.dias ->> (((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)::text)), '-'::text), ''::text),
                ( SELECT kv.value
                   FROM jsonb_each_text(d.dias) kv(key, value)
                  WHERE (kv.value <> ALL (ARRAY['-'::text, ''::text, 'null'::text, '0'::text]))
                  ORDER BY kv.key DESC
                 LIMIT 1),
                '-'::text) AS dia_codigo,
            COALESCE(
                CASE
                    WHEN ((d.dias ->> (((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)::text)) <> ALL (ARRAY['-'::text, ''::text, 'null'::text])) THEN (((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)::text)
                    ELSE NULL::text
                END,
                ( SELECT kv.key
                   FROM jsonb_each_text(d.dias) kv(key, value)
                  WHERE (kv.value <> ALL (ARRAY['-'::text, ''::text, 'null'::text, '0'::text]))
                  ORDER BY kv.key DESC
                 LIMIT 1),
                (((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)::text)) AS dia_fecha,
            d.diagrama_tipo
           FROM public.diagramas d
          WHERE (d.chofer_id = c.id)
            AND (make_date(d.anio, d.mes_numero, 1) <= date_trunc('month', (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))
          ORDER BY d.anio DESC, d.mes_numero DESC
         LIMIT 1
     ) diag ON (true))
  WHERE ((lower(TRIM(BOTH FROM c.nombre)) <> ALL (ARRAY['campo'::text, 'abast'::text, 'glp'::text, 'grales'::text, 'grales.'::text, 'liviano'::text, 'metanol'::text, 'pasivo en base'::text, 'ypf'::text, 'apellido y nombre'::text, 'personal activo'::text, 'chofer'::text, 'choferes'::text, 'vacante'::text, '-'::text, '1'::text])) AND (length(TRIM(BOTH FROM c.nombre)) > 2));

GRANT SELECT ON public.view_diaria_operativa TO anon, authenticated, service_role, postgres;

-- ==============================================================================
-- 6. view_dash_novedades (TZ Argentina en ventana de resueltas)
-- ==============================================================================
CREATE OR REPLACE VIEW public.view_dash_novedades WITH (security_invoker = true) AS
 SELECT n.id,
    n.id AS card_id,
    tn.codigo AS tipo_novedad,
    tn.codigo AS tipo,
    tn.id AS tipo_novedad_id,
    tn.titulo AS tipo_novedad_titulo,
    tn.bg_color AS tipo_bg_color,
    tn.text_color AS tipo_text_color,
    COALESCE(tn.requiere_fecha_objetivo, false) AS requiere_fecha_objetivo,
    COALESCE(tn.imprime_nota_movimientos, false) AS imprime_nota_movimientos,
    n.fecha_objetivo,
    n.fecha_objetivo AS fecha,
    n.fecha_resolucion,
    n.detalle,
    n.resuelto,
    COALESCE(n.prioridad, 'media'::text) AS prioridad,
    n.creado_el,
    n.creado_el AS "timestamp",
    n.creado_por_id,
    COALESCE(d_user.nombre, 'DASH'::text) AS creador,
    COALESCE(d_user.nombre, 'DASH'::text) AS usuario,
    c.id AS chofer_id,
    upper(TRIM(BOTH FROM COALESCE(c.nombre, ''::text))) AS nom,
    upper(TRIM(BOTH FROM COALESCE(c.nombre, ''::text))) AS chofer_nombre,
    COALESCE(c.estado, 'disponible'::text) AS chofer_estado,
    cd.telefono AS chofer_telefono,
    c.foto,
    u.id AS unidad_id,
    upper(TRIM(BOTH FROM COALESCE(t.patente, ''::text))) AS tractor,
    upper(TRIM(BOTH FROM COALESCE(s.patente, ''::text))) AS semi,
    s.cisternado,
    COALESCE(u.n_ute, 'S/D'::text) AS n_ute,
    upper(TRIM(BOTH FROM COALESCE(sc.denominacion, su.denominacion, 'S/A'::text))) AS srv,
    upper(TRIM(BOTH FROM COALESCE(sc.denominacion, su.denominacion, 'S/A'::text))) AS servicio,
    c.servicio_id AS servicio_chofer_id,
    t.vtv AS vtv_tr,
    t.mas AS mas_tr,
    s.vtv AS vtv_semi,
    s.mas AS mas_semi,
    s.esp_es,
    s.vi,
    s.ve,
        CASE
            WHEN (tn.codigo = 'LIBRES'::text) THEN COALESCE(term.codigo, ''::text)
            ELSE ''::text
        END AS terminal,
        CASE
            WHEN (tn.codigo = 'LIBRES'::text) THEN n.terminal_id
            ELSE NULL::uuid
        END AS terminal_id,
        CASE
            WHEN (tn.codigo = 'LIBRES'::text) THEN term.nombre
            ELSE NULL::text
        END AS terminal_nombre,
    COALESCE(( SELECT array_agg(m.usuario_nombre) AS array_agg
           FROM public.dash_menciones m
          WHERE (m.novedad_id = n.id)), ARRAY[]::text[]) AS menciones
   FROM ((((((((((public.novedades n
     JOIN public.tipos_novedad tn ON ((n.tipo_novedad_id = tn.id)))
     LEFT JOIN public.choferes c ON ((n.chofer_id = c.id)))
     LEFT JOIN public.servicios_choferes sc ON ((c.servicio_id = sc.id)))
     LEFT JOIN public.chofer_documentacion cd ON ((cd.chofer_id = c.id)))
     LEFT JOIN public.unidades u ON ((n.unidad_id = u.id)))
     LEFT JOIN public.tractores t ON ((u.tractor_id = t.id)))
     LEFT JOIN public.semis s ON ((u.semi_id = s.id)))
     LEFT JOIN public.servicios_unidades su ON ((u.servicio_id = su.id)))
     LEFT JOIN public.terminales term ON ((n.terminal_id = term.id)))
     LEFT JOIN public.dash d_user ON ((n.creado_por_id = d_user.id)))
  WHERE ((NOT n.resuelto) OR (n.fecha_resolucion >= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - '14 days'::interval)));

GRANT SELECT ON public.view_dash_novedades TO anon, authenticated, service_role, postgres;

-- ==============================================================================
-- 7. view_dashboard_kpis (TZ Argentina en alertas VTV)
-- ==============================================================================
CREATE OR REPLACE VIEW public.view_dashboard_kpis WITH (security_invoker = true) AS
 SELECT ( SELECT count(*) AS count
           FROM public.unidades) AS total_unidades,
    ( SELECT count(*) AS count
           FROM public.unidades
          WHERE (unidades.estado = 'circulando'::text)) AS unidades_circulando,
    ( SELECT count(*) AS count
           FROM public.unidades
          WHERE (unidades.estado = 'disponible'::text)) AS unidades_disponibles,
    ( SELECT count(*) AS count
           FROM public.unidades
          WHERE (unidades.estado = 'taller'::text)) AS unidades_taller,
    ( SELECT count(*) AS count
           FROM public.choferes) AS total_choferes,
    ( SELECT count(*) AS count
           FROM public.choferes
          WHERE (choferes.estado = 'circulando'::text)) AS choferes_circulando,
    ( SELECT count(*) AS count
           FROM public.choferes
          WHERE (choferes.estado = 'franco'::text)) AS choferes_franco,
    ( SELECT count(*) AS count
           FROM public.novedades
          WHERE (novedades.resuelto = false)) AS novedades_pendientes,
    ( SELECT count(*) AS count
           FROM public.novedades
          WHERE (novedades.resuelto = true)) AS novedades_resueltas,
    (( SELECT count(*) AS count
           FROM public.tractores
          WHERE ((tractores.vtv IS NOT NULL) AND (tractores.vtv < (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))) + ( SELECT count(*) AS count
           FROM public.semis
          WHERE ((semis.vtv IS NOT NULL) AND (semis.vtv < (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)))) AS alertas_vtv_vencidas,
    (( SELECT count(*) AS count
           FROM public.tractores
          WHERE ((tractores.vtv IS NOT NULL) AND ((tractores.vtv >= (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date) AND (tractores.vtv <= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + '15 days'::interval))))) + ( SELECT count(*) AS count
           FROM public.semis
          WHERE ((semis.vtv IS NOT NULL) AND ((semis.vtv >= (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date) AND (semis.vtv <= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + '15 days'::interval)))))) AS alertas_vtv_por_vencer;

GRANT SELECT ON public.view_dashboard_kpis TO anon, authenticated, service_role, postgres;

COMMIT;
