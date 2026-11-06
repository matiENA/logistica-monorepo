-- ==============================================================================
-- 🚀 ACTUALIZACIÓN: fn_trg_sync_documentacion (Enrutamiento a eor_sync_queue)
-- Conecta los inputs de vencimientos guardados en public.chofer_documentacion 
-- hacia las rutas exactas de Google Sheets que extrae la Partición 10 (VENCIMIENTOS)
-- y la Partición 11 (PERIODICOS).
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.fn_trg_sync_documentacion()
RETURNS TRIGGER AS $$
DECLARE
    v_nombre TEXT;
    v_dni TEXT;
    v_cuil TEXT;
    v_usuario TEXT;
BEGIN
    -- La cola de sincronización es EXCLUSIVA de operaciones del frontend (requiere actualizado_por)
    IF NEW.actualizado_por IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT nombre INTO v_nombre FROM public.choferes WHERE id = NEW.chofer_id LIMIT 1;
    v_dni := COALESCE(NEW.dni, SUBSTRING(regexp_replace(NEW.cuil, '\D', '', 'g') FROM 3 FOR 8));
    v_cuil := COALESCE(NEW.cuil, NEW.dni);
    v_usuario := NEW.actualizado_por;

    -- 1. Vencimiento Periódico modificado -> Hoja PERIODICOS Columna I (Partición 11)
    IF (OLD.venc_periodico IS DISTINCT FROM NEW.venc_periodico) AND NEW.venc_periodico IS NOT NULL THEN
        INSERT INTO public.eor_sync_queue (
            entidad, destino_sheet, tipo_operacion, chofer_id, chofer_nombre, dni_cuil,
            datos_nuevos, datos_previos, usuario
        ) VALUES (
            'DOCUMENTACION', 'PERIODICOS', 'UPDATE', NEW.chofer_id, v_nombre, v_cuil,
            jsonb_build_object('campo', 'venc_periodico', 'valor', NEW.venc_periodico, 'columna', 'I'),
            jsonb_build_object('valor_previo', OLD.venc_periodico),
            v_usuario
        );
    END IF;

    -- 2. Licencia Nacional modificada -> Hoja VENCIMIENTOS Columna E (Partición 10)
    IF (OLD.venc_licencia_nacional IS DISTINCT FROM NEW.venc_licencia_nacional) AND NEW.venc_licencia_nacional IS NOT NULL THEN
        INSERT INTO public.eor_sync_queue (
            entidad, destino_sheet, tipo_operacion, chofer_id, chofer_nombre, dni_cuil,
            datos_nuevos, datos_previos, usuario
        ) VALUES (
            'DOCUMENTACION', 'VENCIMIENTOS', 'UPDATE', NEW.chofer_id, v_nombre, v_dni,
            jsonb_build_object('campo', 'venc_licencia_nacional', 'valor', NEW.venc_licencia_nacional, 'columna', 'E'),
            jsonb_build_object('valor_previo', OLD.venc_licencia_nacional),
            v_usuario
        );
    END IF;

    -- 3. Cargas Peligrosas modificada -> Hoja VENCIMIENTOS Columna D (Partición 10)
    IF (OLD.venc_cargas_peligrosas IS DISTINCT FROM NEW.venc_cargas_peligrosas) AND NEW.venc_cargas_peligrosas IS NOT NULL THEN
        INSERT INTO public.eor_sync_queue (
            entidad, destino_sheet, tipo_operacion, chofer_id, chofer_nombre, dni_cuil,
            datos_nuevos, datos_previos, usuario
        ) VALUES (
            'DOCUMENTACION', 'VENCIMIENTOS', 'UPDATE', NEW.chofer_id, v_nombre, v_dni,
            jsonb_build_object('campo', 'venc_cargas_peligrosas', 'valor', NEW.venc_cargas_peligrosas, 'columna', 'D'),
            jsonb_build_object('valor_previo', OLD.venc_cargas_peligrosas),
            v_usuario
        );
    END IF;

    -- 4. Psicofísico modificado -> Hoja VENCIMIENTOS Columna F (Partición 10)
    IF (OLD.venc_psicofisico IS DISTINCT FROM NEW.venc_psicofisico) AND NEW.venc_psicofisico IS NOT NULL THEN
        INSERT INTO public.eor_sync_queue (
            entidad, destino_sheet, tipo_operacion, chofer_id, chofer_nombre, dni_cuil,
            datos_nuevos, datos_previos, usuario
        ) VALUES (
            'DOCUMENTACION', 'VENCIMIENTOS', 'UPDATE', NEW.chofer_id, v_nombre, v_dni,
            jsonb_build_object('campo', 'venc_psicofisico', 'valor', NEW.venc_psicofisico, 'columna', 'F'),
            jsonb_build_object('valor_previo', OLD.venc_psicofisico),
            v_usuario
        );
    END IF;

    -- 5. Observaciones modificadas -> Hoja VENCIMIENTOS Columna G (Partición 10)
    IF (OLD.obs_documentacion IS DISTINCT FROM NEW.obs_documentacion) AND NEW.obs_documentacion IS NOT NULL THEN
        INSERT INTO public.eor_sync_queue (
            entidad, destino_sheet, tipo_operacion, chofer_id, chofer_nombre, dni_cuil,
            datos_nuevos, datos_previos, usuario
        ) VALUES (
            'DOCUMENTACION', 'VENCIMIENTOS', 'UPDATE', NEW.chofer_id, v_nombre, v_dni,
            jsonb_build_object('campo', 'obs_documentacion', 'valor', NEW.obs_documentacion, 'columna', 'G'),
            jsonb_build_object('valor_previo', OLD.obs_documentacion),
            v_usuario
        );
    END IF;

    -- Resetear para que futuras actualizaciones de background/ETL no hereden este valor
    NEW.actualizado_por := NULL;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Falla en fn_trg_sync_documentacion: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
