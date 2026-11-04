-- ==============================================================================
-- MIGRACIÓN / ACTUALIZACIÓN: fn_personal_retorno con JOIN a movimientos
-- Optimización del container VUELVE (Dash & EOR)
-- Resuelve tractor/semi asociando movimientos(id_chofer, id_unidad) y choferes.unidad_id
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.fn_personal_retorno(p_fecha date DEFAULT CURRENT_DATE)
 RETURNS TABLE(
    chofer_id uuid,
    nombre text,
    dni text,
    servicio text,
    diagrama_tipo text,
    n_ute text,
    tractor text,
    semi text,
    codigo_ayer text,
    codigo_hoy text,
    codigo_manana text,
    retorna_cuando text,
    fecha_retorno date,
    dias_para_retorno integer
 )
 LANGUAGE plpgsql
 STABLE
AS $function$
    DECLARE
        v_m1 TEXT := (p_fecha - INTERVAL '1 day')::date::text;
        v_0  TEXT := p_fecha::text;
        v_p1 TEXT := (p_fecha + INTERVAL '1 day')::date::text;
        v_p2 TEXT := (p_fecha + INTERVAL '2 days')::date::text;
        v_p3 TEXT := (p_fecha + INTERVAL '3 days')::date::text;
        v_p4 TEXT := (p_fecha + INTERVAL '4 days')::date::text;
    BEGIN
        RETURN QUERY
        WITH codigos AS (
            SELECT 
                c.id AS q_chofer_id,
                c.nombre AS q_nombre,
                cd.dni AS q_dni,
                COALESCE(sc.denominacion, 'GENERAL') AS q_servicio,
                d.diagrama_tipo AS q_diagrama_tipo,
                u.n_ute AS q_n_ute,
                t.patente AS q_tractor,
                s.patente AS q_semi,
                UPPER(TRIM(COALESCE(d.dias->>v_m1, '-'))) AS code_m1,
                UPPER(TRIM(COALESCE(d.dias->>v_0,  '-'))) AS code_0,
                UPPER(TRIM(COALESCE(d.dias->>v_p1, '-'))) AS code_p1,
                UPPER(TRIM(COALESCE(d.dias->>v_p2, '-'))) AS code_p2,
                UPPER(TRIM(COALESCE(d.dias->>v_p3, '-'))) AS code_p3,
                UPPER(TRIM(COALESCE(d.dias->>v_p4, '-'))) AS code_p4
            FROM public.choferes c
            LEFT JOIN public.chofer_documentacion cd ON cd.chofer_id = c.id
            LEFT JOIN public.servicios_choferes sc ON c.servicio_id = sc.id
            LEFT JOIN public.movimientos m ON m.id_chofer = c.id
            LEFT JOIN public.unidades u ON COALESCE(c.unidad_id, m.id_unidad) = u.id
            LEFT JOIN public.tractores t ON u.tractor_id = t.id
            LEFT JOIN public.semis s ON u.semi_id = s.id
            LEFT JOIN LATERAL (
                SELECT sub_d.dias, sub_d.diagrama_tipo FROM public.diagramas sub_d
                WHERE sub_d.chofer_id = c.id 
                ORDER BY sub_d.anio DESC, sub_d.mes_numero DESC 
                LIMIT 1
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
                evaluados.q_diagrama_tipo,
                evaluados.q_n_ute,
                evaluados.q_tractor,
                evaluados.q_semi,
                evaluados.code_m1 AS q_code_ayer,
                evaluados.code_0  AS q_code_hoy,
                evaluados.code_p1 AS q_code_manana,
                CASE 
                    WHEN evaluados.nov_m1 AND NOT evaluados.nov_0 THEN 'HOY'
                    WHEN evaluados.nov_0 AND NOT evaluados.nov_p1 THEN 'MAÑANA'
                    WHEN evaluados.nov_0 AND evaluados.nov_p1 AND NOT evaluados.nov_p2 THEN 'EN 2 DÍAS'
                    WHEN evaluados.nov_0 AND evaluados.nov_p1 AND evaluados.nov_p2 AND NOT evaluados.nov_p3 THEN 'EN 3 DÍAS'
                    WHEN evaluados.nov_0 AND evaluados.nov_p1 AND evaluados.nov_p2 AND evaluados.nov_p3 AND NOT evaluados.nov_p4 THEN 'EN 4 DÍAS'
                    ELSE NULL
                END AS q_retorna_cuando,
                CASE 
                    WHEN evaluados.nov_m1 AND NOT evaluados.nov_0 THEN p_fecha
                    WHEN evaluados.nov_0 AND NOT evaluados.nov_p1 THEN (p_fecha + INTERVAL '1 day')::date
                    WHEN evaluados.nov_0 AND evaluados.nov_p1 AND NOT evaluados.nov_p2 THEN (p_fecha + INTERVAL '2 days')::date
                    WHEN evaluados.nov_0 AND evaluados.nov_p1 AND evaluados.nov_p2 AND NOT evaluados.nov_p3 THEN (p_fecha + INTERVAL '3 days')::date
                    WHEN evaluados.nov_0 AND evaluados.nov_p1 AND evaluados.nov_p2 AND evaluados.nov_p3 AND NOT evaluados.nov_p4 THEN (p_fecha + INTERVAL '4 days')::date
                    ELSE NULL
                END AS q_fecha_retorno,
                CASE 
                    WHEN evaluados.nov_m1 AND NOT evaluados.nov_0 THEN 0
                    WHEN evaluados.nov_0 AND NOT evaluados.nov_p1 THEN 1
                    WHEN evaluados.nov_0 AND evaluados.nov_p1 AND NOT evaluados.nov_p2 THEN 2
                    WHEN evaluados.nov_0 AND evaluados.nov_p1 AND evaluados.nov_p2 AND NOT evaluados.nov_p3 THEN 3
                    WHEN evaluados.nov_0 AND evaluados.nov_p1 AND evaluados.nov_p2 AND evaluados.nov_p3 AND NOT evaluados.nov_p4 THEN 4
                    ELSE NULL
                END AS q_dias_para_retorno
            FROM evaluados
        )
        SELECT 
            clasificados.q_chofer_id,
            clasificados.q_nombre,
            clasificados.q_dni,
            clasificados.q_servicio,
            clasificados.q_diagrama_tipo,
            clasificados.q_n_ute,
            clasificados.q_tractor,
            clasificados.q_semi,
            clasificados.q_code_ayer,
            clasificados.q_code_hoy,
            clasificados.q_code_manana,
            clasificados.q_retorna_cuando,
            clasificados.q_fecha_retorno,
            clasificados.q_dias_para_retorno
        FROM clasificados 
        WHERE clasificados.q_retorna_cuando IS NOT NULL;
    END;
$function$;
