"""
Interfaz Interactiva de Control y Verificación de Viajes Cordillera.
Soporta:
1. CONF. DE VIAJE: Sincronización basada en Columna V ('sujeto a seguimiento') agrupada por TD hacia CONF. DE VIAJE (fila 5+).
2. SEGURIDA VIAL: Sincronización basada en paradas en localidades de Cordillera.
"""
import streamlit as st
import pandas as pd
import json
import time
from datetime import datetime
from pathlib import Path

from config import (
    DEFAULT_SPREADSHEET_ID,
    SEGURIDAD_VIAL_SPREADSHEET_ID,
    CONF_SPREADSHEET_ID,
    SOURCE_SHEET_NAME,
    TARGET_SHEET_NAME,
    CORDILLERA_LOCATIONS,
    TARGET_COLUMNS_HEADERS,
    TARGET_COLUMNS_LETTERS,
    CONF_SOURCE_SHEET_NAME,
    CONF_TARGET_SHEET_NAME,
    CONF_START_ROW,
    CONF_COLUMN_MAPPINGS
)
from sync_manager import SyncManager

# Configuración de página de Streamlit
st.set_page_config(
    page_title="Viajes Cordillera - Centro de Control",
    page_icon="🏔️",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Inicializar SyncManager
@st.cache_resource
def get_sync_manager():
    return SyncManager()

manager = get_sync_manager()

# Sidebar: Encabezado y Navegación
st.sidebar.image("https://img.icons8.com/color/96/mountain.png", width=64)
st.sidebar.title("Viajes Cordillera")

modulo = st.sidebar.radio(
    "📌 Módulo Activo:",
    [
        "⭐ CONF. DE VIAJE (Sujeto a Seguimiento)",
        "🏔️ SEGURIDA VIAL (Filtro Cordillera)"
    ],
    index=0
)

st.sidebar.divider()

# ==============================================================================
# MÓDULO 1: CONF. DE VIAJE (Sujeto a Seguimiento)
# ==============================================================================
if modulo == "⭐ CONF. DE VIAJE (Sujeto a Seguimiento)":
    st.sidebar.markdown(f"**Origen:** `{CONF_SOURCE_SHEET_NAME}`")
    st.sidebar.markdown(f"**Destino:** `{CONF_TARGET_SHEET_NAME}` (fila {CONF_START_ROW}+)")
    st.sidebar.markdown(f"**Planilla:** [`{CONF_SPREADSHEET_ID[:15]}...`](https://docs.google.com/spreadsheets/d/{CONF_SPREADSHEET_ID}/edit) ↗️")
    st.sidebar.divider()

    # Disparador Manual
    st.sidebar.subheader("⚡ Disparador Manual")
    trigger_conf_sync = st.sidebar.button("🚀 Sincronizar CONF. DE VIAJE", type="primary", use_container_width=True)

    # Configuración periódica
    st.sidebar.subheader("⏱️ Sincronización Automática")
    auto_sync = st.sidebar.toggle("Activar auto-recarga periódica", value=False, key="auto_sync_conf")
    interval_mins = st.sidebar.selectbox("Intervalo de recarga", [1, 3, 5, 10, 15], index=2, key="interval_conf")

    st.sidebar.divider()
    st.sidebar.caption(f"Cuenta de Servicio: `ute-logistica`\nPlanilla: `{CONF_SPREADSHEET_ID}`")

    # Ejecución sincrónica si se presionó el botón
    if trigger_conf_sync:
        with st.spinner("Conectando con Google Sheets y sincronizando CONF. DE VIAJE..."):
            try:
                report = manager.run_sync_conf_viaje(write_to_sheet=True)
                st.toast("¡CONF. DE VIAJE sincronizado con éxito!", icon="✅")
                st.session_state["conf_report"] = report
            except Exception as e:
                st.error(f"Error durante la sincronización: {e}")

    # Cargar último estado conocido
    conf_report = st.session_state.get("conf_report")
    if not conf_report:
        conf_report = manager.load_latest_conf_viaje_state()

    # Si no hay datos previos, ofrecer carga inicial
    if not conf_report:
        st.info("👋 Aún no se ha realizado ninguna sincronización para **CONF. DE VIAJE**. Presiona el botón a continuación para obtener los datos actuales.")
        if st.button("📥 Ejecutar Primera Sincronización de CONF. DE VIAJE", type="primary"):
            with st.spinner("Procesando datos de UTE Cordillera..."):
                conf_report = manager.run_sync_conf_viaje(write_to_sheet=True)
                st.session_state["conf_report"] = conf_report
                st.rerun()
        st.stop()

    # Encabezado principal
    col_title, col_link = st.columns([3, 1])
    with col_title:
        st.title("⭐ CONF. DE VIAJE (Sujeto a Seguimiento)")
        st.markdown(
            f"Filtro inteligente por **Columna W** (`sujeto a seguimiento`) agrupado por viaje completo **TD (Col I)** ➔ Escrito a partir de **fila {CONF_START_ROW}**"
        )
    with col_link:
        st.markdown(
            f"""
            <div style="text-align: right; padding-top: 15px;">
                <a href="https://docs.google.com/spreadsheets/d/{CONF_SPREADSHEET_ID}/edit" target="_blank" style="text-decoration: none;">
                    <button style="background-color: #0f9d58; color: white; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-weight: bold;">
                        Abrir Planilla Google ↗️
                    </button>
                </a>
            </div>
            """,
            unsafe_allow_html=True
        )

    # Tarjetas de Métricas
    summary = conf_report.get("summary", {})
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("📦 Filas Escaneadas (UTE)", summary.get("total_rows_scanned", 0))
    m2.metric("🚛 Total Viajes (TD) Vistos", summary.get("total_trips_detected", 0))
    m3.metric("⚠️ Viajes en Seguimiento", summary.get("matching_trips_count", 0))
    m4.metric("📝 Filas en CONF. DE VIAJE", summary.get("matching_rows_count", 0), delta=f"{conf_report.get('elapsed_seconds', 0)}s de ejecución")

    st.divider()

    # Pestañas del módulo CONF. DE VIAJE
    t_copiados, t_otros, t_preview, t_n8n = st.tabs([
        "✅ Viajes en Seguimiento (Copiados)",
        "⚪ Otros Viajes (Sin Seguimiento)",
        "📋 Vista Previa Hoja CONF. DE VIAJE",
        "🔄 Integración n8n & Mapeo"
    ])

    headers_conf = conf_report.get("headers", [m[2] for m in CONF_COLUMN_MAPPINGS])

    # 1. VIAJES EN SEGUIMIENTO
    with t_copiados:
        trips_seg = conf_report.get("trips_seguimiento", [])
        st.subheader(f"Viajes con Seguimiento Activo ({len(trips_seg)} viaje(s) completo(s))")
        st.caption("Regla aplicada: El viaje completo (todas las filas de ese TD) se transfiere si al menos una fila contiene 'sujeto a seguimiento' en la Columna W (o Col V).")

        if not trips_seg:
            st.warning("No se encontraron viajes con la etiqueta 'sujeto a seguimiento' en la pestaña UTE Cordillera.")
        else:
            filas_resumen = []
            for t in trips_seg:
                filas_resumen.append({
                    "TD (Despacho)": t["td"],
                    "Tractor": t["tractor"],
                    "Chofer": t["chofer"],
                    "Terminal": t["terminal"],
                    "Fecha Planificada": t["fecha_planificada"],
                    "Localidades": " ➔ ".join(t["localidades"]),
                    "Total Filas": t["total_filas"],
                    "Motivo(s) Seguimiento": "; ".join(t.get("motivos_seguimiento", []))
                })

            df_resumen = pd.DataFrame(filas_resumen)
            st.dataframe(df_resumen, use_container_width=True, hide_index=True)

            st.divider()
            st.subheader("🔍 Desglose de Filas Mapeadas por Viaje")
            for t in trips_seg:
                with st.expander(f"🚛 TD **{t['td']}** | Tractor: **{t['tractor']}** | Chofer: **{t['chofer']}** ({t['total_filas']} filas)"):
                    st.markdown(f"**Terminal:** `{t['terminal']}` | **Fecha:** `{t['fecha_planificada']}`")
                    st.markdown(f"**Itinerario:** `{', '.join(t['localidades'])}`")
                    if t.get("motivos_seguimiento"):
                        st.info(f"**Alertas detectadas en Col W / Col V:** {'; '.join(t['motivos_seguimiento'])}")

                    df_trip_rows = pd.DataFrame(t["filas_mapeadas"], columns=headers_conf)
                    st.dataframe(df_trip_rows, use_container_width=True, hide_index=True)

    # 2. OTROS VIAJES
    with t_otros:
        trips_otros = conf_report.get("trips_otros", [])
        st.subheader(f"Viajes Sin Seguimiento ({len(trips_otros)} viajes)")
        st.caption("Estos viajes no poseen la marca 'sujeto a seguimiento' en la columna V.")

        filas_o = []
        for t in trips_otros:
            filas_o.append({
                "TD (Despacho)": t["td"],
                "Tractor": t["tractor"],
                "Chofer": t["chofer"],
                "Terminal": t["terminal"],
                "Fecha Planificada": t["fecha_planificada"],
                "Localidades": ", ".join(t["localidades"]),
                "Total Filas": t["total_filas"]
            })
        df_o = pd.DataFrame(filas_o)
        st.dataframe(df_o, use_container_width=True, hide_index=True)

    # 3. VISTA PREVIA
    with t_preview:
        st.subheader(f"Vista Previa de CONF. DE VIAJE (Desde Fila {CONF_START_ROW})")
        all_mapped_rows = []
        for t in trips_seg:
            all_mapped_rows.extend(t["filas_mapeadas"])

        if all_mapped_rows:
            df_preview_conf = pd.DataFrame(all_mapped_rows, columns=headers_conf)
            st.caption(f"Mostrando {len(all_mapped_rows)} filas transferidas exactamente como están escritas en Google Sheets (Columnas A a H).")
            st.dataframe(df_preview_conf, use_container_width=True, hide_index=True)
        else:
            st.info("No hay filas transferidas para mostrar.")

    # 4. INTEGRACIÓN N8N & MAPEO
    with t_n8n:
        st.subheader("🔄 Integración con n8n de Entorno Local")
        st.markdown(
            """
            Puedes automatizar este proceso directamente en tu **n8n local** (`http://localhost:5678`) importando el flujo preconfigurado.
            """
        )

        n8n_file_path = Path(__file__).parent / "n8n_workflow_conf_de_viaje.json"
        if n8n_file_path.exists():
            with open(n8n_file_path, "r", encoding="utf-8") as f:
                n8n_json_str = f.read()

            col_btn1, col_btn2 = st.columns([1, 2])
            with col_btn1:
                st.download_button(
                    label="⬇️ Descargar Workflow para n8n (.json)",
                    data=n8n_json_str,
                    file_name="n8n_workflow_conf_de_viaje.json",
                    mime="application/json",
                    type="primary",
                    use_container_width=True
                )
            with col_btn2:
                st.caption("💡 Para usarlo en n8n: Menú desplegable **Workflows** ➔ **Import from file...** o pega el JSON directamente en el lienzo.")

            with st.expander("📄 Ver contenido del Workflow JSON de n8n"):
                st.code(n8n_json_str, language="json")

        st.divider()
        st.subheader("🗺️ Mapeo de Columnas (UTE Cordillera ➔ CONF. DE VIAJE)")
        col_map_df = pd.DataFrame([
            {"Columna Origen (UTE)": src, "Columna Destino (CONF)": dst, "Campo": label}
            for src, dst, label in CONF_COLUMN_MAPPINGS
        ])
        st.dataframe(col_map_df, use_container_width=True, hide_index=True)

    if auto_sync:
        time.sleep(interval_mins * 60)
        st.rerun()

# ==============================================================================
# MÓDULO 2: SEGURIDA VIAL (Filtro Cordillera Histórico)
# ==============================================================================
else:
    st.sidebar.markdown(f"**Origen:** `{SOURCE_SHEET_NAME}`")
    st.sidebar.markdown(f"**Destino:** `{TARGET_SHEET_NAME}`")
    st.sidebar.markdown(f"**Planilla:** [`{SEGURIDAD_VIAL_SPREADSHEET_ID[:15]}...`](https://docs.google.com/spreadsheets/d/{SEGURIDAD_VIAL_SPREADSHEET_ID}/edit) ↗️")
    st.sidebar.divider()

    # Botón disparador (Trigger)
    st.sidebar.subheader("⚡ Disparador Manual")
    trigger_sync_sv = st.sidebar.button("🚀 Sincronizar SEGURIDA VIAL", type="primary", use_container_width=True)

    # Configuración periódica
    st.sidebar.subheader("⏱️ Sincronización Automática")
    auto_sync_sv = st.sidebar.toggle("Activar auto-recarga periódica", value=False, key="auto_sync_sv")
    interval_mins_sv = st.sidebar.selectbox("Intervalo de recarga", [1, 3, 5, 10, 15], index=2, key="interval_sv")

    st.sidebar.divider()
    st.sidebar.caption(f"Cuenta de Servicio: `ute-logistica`\nPlanilla: `{SEGURIDAD_VIAL_SPREADSHEET_ID}`")

    # Si se presionó el botón disparador, ejecutar sincronización en vivo
    if trigger_sync_sv:
        with st.spinner("Conectando con Google Sheets y sincronizando..."):
            try:
                report_sv = manager.run_sync(write_to_sheet=True)
                st.toast("¡Sincronización completada con éxito!", icon="✅")
                st.session_state["latest_report_sv"] = report_sv
            except Exception as e:
                st.error(f"Error durante la sincronización: {e}")

    # Cargar último estado conocido
    latest_report_sv = st.session_state.get("latest_report_sv")
    if not latest_report_sv:
        latest_report_sv = manager.load_latest_state()

    # Si no hay datos previos, ofrecer carga inicial
    if not latest_report_sv:
        st.info("👋 Aún no se ha realizado ninguna sincronización para **SEGURIDA VIAL** en esta sesión.")
        if st.button("📥 Realizar Primera Sincronización", type="primary"):
            with st.spinner("Procesando datos de Google Sheets..."):
                latest_report_sv = manager.run_sync(write_to_sheet=True)
                st.session_state["latest_report_sv"] = latest_report_sv
                st.rerun()
        st.stop()

    # Encabezado principal
    col_title_sv, col_link_sv = st.columns([3, 1])
    with col_title_sv:
        st.title("🏔️ Monitor de SEGURIDA VIAL")
        st.markdown("Verificación en tiempo real de viajes clasificados y transferidos a **`SEGURIDA VIAL`**")
    with col_link_sv:
        st.markdown(
            f"""
            <div style="text-align: right; padding-top: 15px;">
                <a href="https://docs.google.com/spreadsheets/d/{SEGURIDAD_VIAL_SPREADSHEET_ID}/edit" target="_blank" style="text-decoration: none;">
                    <button style="background-color: #2b7de9; color: white; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-weight: bold;">
                        Abrir Planilla ↗️
                    </button>
                </a>
            </div>
            """,
            unsafe_allow_html=True
        )

    # Tarjetas de Métricas
    summary_sv = latest_report_sv.get("summary", {})
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("📦 Total Viajes Analizados (TD)", summary_sv.get("total_trips_detected", 0))
    m2.metric("🏔️ Viajes Cordillera Copiados", summary_sv.get("copied_trips_count", 0))
    m3.metric("📋 Filas en SEGURIDA VIAL", summary_sv.get("copied_rows_count", 0))
    m4.metric("⏱️ Última Sincronización", latest_report_sv.get("timestamp", "N/A"), delta=f"{latest_report_sv.get('elapsed_seconds', 0)}s de ejecución")

    st.divider()

    # Pestañas principales
    tab_copiados, tab_no_copiados, tab_preview, tab_config = st.tabs([
        "✅ Viajes Copiados a SEGURIDA VIAL",
        "❌ Viajes No Copiados (Otras Zonas)",
        "📋 Vista Previa de SEGURIDA VIAL",
        "⚙️ Parámetros y Locaciones"
    ])

    with tab_copiados:
        viajes_copiados = latest_report_sv.get("viajes_copiados", [])
        st.subheader(f"Viajes con Destino a Cordillera ({len(viajes_copiados)} viajes completos)")
        if not viajes_copiados:
            st.warning("No se encontraron viajes con destinos a localidades de Cordillera.")
        else:
            filas_resumen = []
            for v in viajes_copiados:
                filas_resumen.append({
                    "TD (Despacho)": v["td"],
                    "Tractor": v["tractor"],
                    "N° UT": v["ut"],
                    "Chofer": v["chofer"],
                    "🏔️ Paradas Cordillera": ", ".join(v["localidades_cordillera"]),
                    "📍 Todas las Paradas": " ➔ ".join(v["todas_las_localidades"]),
                    "Total Filas": v["total_filas"]
                })
            st.dataframe(pd.DataFrame(filas_resumen), use_container_width=True, hide_index=True)

    with tab_no_copiados:
        viajes_no_copiados = latest_report_sv.get("viajes_no_copiados", [])
        st.subheader(f"Viajes Excluidos ({len(viajes_no_copiados)} viajes)")
        filas_no = []
        for v in viajes_no_copiados:
            filas_no.append({
                "TD (Despacho)": v["td"],
                "Tractor": v["tractor"],
                "N° UT": v["ut"],
                "Chofer": v["chofer"],
                "Localidades del Viaje": ", ".join(v["localidades"]),
                "Total Filas": v["total_filas"]
            })
        st.dataframe(pd.DataFrame(filas_no), use_container_width=True, hide_index=True)

    with tab_preview:
        st.subheader("Hoja SEGURIDA VIAL")
        headers = latest_report_sv.get("target_headers", TARGET_COLUMNS_HEADERS)
        all_rows = []
        for v in viajes_copiados:
            all_rows.extend(v["filas_20_columnas"])
        if all_rows:
            st.dataframe(pd.DataFrame(all_rows, columns=headers), use_container_width=True, hide_index=True)
        else:
            st.info("No hay filas transferidas a mostrar.")

    with tab_config:
        st.subheader("⚙️ Configuración del Sistema")
        col_c1, col_c2 = st.columns(2)
        with col_c1:
            st.markdown("### 🏔️ Localidades de Cordillera (21)")
            st.dataframe(pd.DataFrame(CORDILLERA_LOCATIONS, columns=["Localidad"]), use_container_width=True, hide_index=True)
        with col_c2:
            st.markdown(f"### 📋 Columnas Declaradas ({len(TARGET_COLUMNS_LETTERS)})")
            st.dataframe(pd.DataFrame({"Letra": TARGET_COLUMNS_LETTERS, "Encabezado Semántico": TARGET_COLUMNS_HEADERS}), use_container_width=True, hide_index=True)

    if auto_sync_sv:
        time.sleep(interval_mins_sv * 60)
        st.rerun()
