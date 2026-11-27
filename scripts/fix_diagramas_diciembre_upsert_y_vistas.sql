-- ==============================================================================
-- 🛠️ REMEDIACIÓN INTEGRAL: Mes Diciembre (y meses futuros) en Diagramas EOR
-- 1. Habilitar INSERT en public.diagramas para anon/authenticated (fallback UPSERT)
-- 2. Actualizar trigger fn_trg_sync_diagramas para soportar INSERT OR UPDATE
-- 3. Blindar view_diaria_operativa para no leer meses futuros (ej. Dic-26 en Nov)
-- 4. Dinamizar view_calendario_diagrama_km_2m (sin meses hardcoded Sep-26/Oct-26)
-- ==============================================================================

BEGIN;

-- 1. Permisos DML para UPSERT desde fallback PostgREST
GRANT INSERT, UPDATE ON TABLE public.diagramas TO anon, authenticated;

-- 2. Trigger de sincronización a Google Sheets (INSERT OR UPDATE)
CREATE OR REPLACE FUNCTION public.fn_trg_sync_diagramas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_nombre TEXT;
    v_usuario TEXT;
BEGIN
    -- La cola de sincronización es EXCLUSIVA de operaciones del frontend (requiere actualizado_por)
    IF NEW.actualizado_por IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' OR (OLD.tira_dias IS DISTINCT FROM NEW.tira_dias) THEN
        SELECT nombre INTO v_nombre FROM public.choferes WHERE id = NEW.chofer_id LIMIT 1;
        v_usuario := NEW.actualizado_por;

        INSERT INTO public.eor_sync_queue (
            entidad, destino_sheet, tipo_operacion, chofer_id, chofer_nombre,
            datos_nuevos, datos_previos, usuario
        ) VALUES (
            'DIAGRAMA', NEW.mes_tab, 'UPDATE', NEW.chofer_id, v_nombre,
            jsonb_build_object('mes_tab', NEW.mes_tab, 'tira_dias', NEW.tira_dias),
            jsonb_build_object('tira_dias_previa', CASE WHEN TG_OP = 'INSERT' THEN '' ELSE OLD.tira_dias END),
            v_usuario
        );
    END IF;

    -- Resetear para que futuras actualizaciones de background/ETL no hereden este valor
    NEW.actualizado_por := NULL;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Falla en fn_trg_sync_diagramas: %', SQLERRM;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_diagramas ON public.diagramas;
CREATE TRIGGER trg_sync_diagramas
    BEFORE INSERT OR UPDATE ON public.diagramas
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_trg_sync_diagramas();

-- 3. Blindar view_diaria_operativa: solo leer hasta el mes operativo actual (Argentina)
--    para que la presencia de meses futuros planificados (ej. Dic-26) no tape el mes vigente.
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
            WHEN (((cd.venc_periodico IS NOT NULL) AND (cd.venc_periodico < CURRENT_DATE)) OR ((cd.venc_licencia_nacional IS NOT NULL) AND (cd.venc_licencia_nacional < CURRENT_DATE)) OR ((cd.venc_cargas_peligrosas IS NOT NULL) AND (cd.venc_cargas_peligrosas < CURRENT_DATE)) OR ((cd.apto_medico_venc IS NOT NULL) AND (cd.apto_medico_venc < CURRENT_DATE))) THEN 'VENCIDO'::text
            WHEN (((cd.venc_periodico IS NOT NULL) AND (cd.venc_periodico <= (CURRENT_DATE + '30 days'::interval))) OR ((cd.venc_licencia_nacional IS NOT NULL) AND (cd.venc_licencia_nacional <= (CURRENT_DATE + '30 days'::interval))) OR ((cd.venc_cargas_peligrosas IS NOT NULL) AND (cd.venc_cargas_peligrosas <= (CURRENT_DATE + '30 days'::interval))) OR ((cd.apto_medico_venc IS NOT NULL) AND (cd.apto_medico_venc <= (CURRENT_DATE + '30 days'::interval)))) THEN 'POR_VENCER'::text
            ELSE 'AL_DIA'::text
        END AS alerta_docs_chofer,
        CASE
            WHEN (((t.vtv IS NOT NULL) AND (t.vtv < CURRENT_DATE)) OR ((s.vtv IS NOT NULL) AND (s.vtv < CURRENT_DATE)) OR ((t.mas IS NOT NULL) AND (t.mas < CURRENT_DATE)) OR ((s.mas IS NOT NULL) AND (s.mas < CURRENT_DATE))) THEN 'VENCIDO'::text
            WHEN (((t.vtv IS NOT NULL) AND (t.vtv <= (CURRENT_DATE + '15 days'::interval))) OR ((s.vtv IS NOT NULL) AND (s.vtv <= (CURRENT_DATE + '15 days'::interval))) OR ((t.mas IS NOT NULL) AND (t.mas <= (CURRENT_DATE + '15 days'::interval))) OR ((s.mas IS NOT NULL) AND (s.mas <= (CURRENT_DATE + '15 days'::interval)))) THEN 'POR_VENCER'::text
            WHEN ((t.id IS NOT NULL) OR (s.id IS NOT NULL)) THEN 'AL_DIA'::text
            ELSE 'S_D'::text
        END AS alerta_docs_unidad,
    COALESCE(diag.dia_codigo, '-'::text) AS dia_codigo,
    COALESCE(diag.dia_fecha, (CURRENT_DATE)::text) AS dia_fecha,
    diag.diagrama_tipo,
    c.actualizado_el,
    cd.nivel_prioridad
   FROM ((((((public.choferes c
     LEFT JOIN public.chofer_documentacion cd ON ((cd.chofer_id = c.id)))
     LEFT JOIN public.servicios_choferes sc ON ((c.servicio_id = sc.id)))
     LEFT JOIN public.unidades u ON ((c.unidad_id = u.id)))
     LEFT JOIN public.tractores t ON ((u.tractor_id = t.id)))
     LEFT JOIN public.semis s ON ((u.semi_id = s.id)))
     LEFT JOIN LATERAL ( SELECT COALESCE(NULLIF(NULLIF((d.dias ->> (((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)::text)), '-'::text), ''::text), NULLIF(NULLIF((d.dias ->> (CURRENT_DATE)::text), '-'::text), ''::text), ( SELECT kv.value
                   FROM jsonb_each_text(d.dias) kv(key, value)
                  WHERE (kv.value <> ALL (ARRAY['-'::text, ''::text, 'null'::text, '0'::text]))
                  ORDER BY kv.key DESC
                 LIMIT 1), '-'::text) AS dia_codigo,
            COALESCE(
                CASE
                    WHEN ((d.dias ->> (((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)::text)) <> ALL (ARRAY['-'::text, ''::text, 'null'::text])) THEN (((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)::text)
                    WHEN ((d.dias ->> (CURRENT_DATE)::text) <> ALL (ARRAY['-'::text, ''::text, 'null'::text])) THEN (CURRENT_DATE)::text
                    ELSE NULL::text
                END, ( SELECT kv.key
                   FROM jsonb_each_text(d.dias) kv(key, value)
                  WHERE (kv.value <> ALL (ARRAY['-'::text, ''::text, 'null'::text, '0'::text]))
                  ORDER BY kv.key DESC
                 LIMIT 1), (((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)::text)) AS dia_fecha,
            d.diagrama_tipo
           FROM public.diagramas d
          WHERE (d.chofer_id = c.id)
            AND (make_date(d.anio, d.mes_numero, 1) <= date_trunc('month', (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))
          ORDER BY d.anio DESC, d.mes_numero DESC
         LIMIT 1) diag ON (true))
  WHERE ((lower(TRIM(BOTH FROM c.nombre)) <> ALL (ARRAY['campo'::text, 'abast'::text, 'glp'::text, 'grales'::text, 'grales.'::text, 'liviano'::text, 'metanol'::text, 'pasivo en base'::text, 'ypf'::text, 'apellido y nombre'::text, 'personal activo'::text, 'chofer'::text, 'choferes'::text, 'vacante'::text, '-'::text, '1'::text])) AND (length(TRIM(BOTH FROM c.nombre)) > 2));

-- 4. Dinamizar view_calendario_diagrama_km_2m (ventana mes actual + siguiente en Argentina)
CREATE OR REPLACE VIEW public.view_calendario_diagrama_km_2m WITH (security_invoker = true) AS
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
  WHERE make_date(COALESCE(d.anio, ck.anio), COALESCE(d.mes_numero, ck.mes_numero), 1)
        BETWEEN date_trunc('month', (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - interval '1 month')
            AND date_trunc('month', (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + interval '1 month');

COMMIT;
