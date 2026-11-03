"""
Punto de entrada CLI para la sincronización de Viajes Cordillera hacia SEGURIDA VIAL.
"""
import argparse
import sys
import time
from datetime import datetime

# Configurar salida UTF-8 para consola de Windows
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from config import (
    DEFAULT_SPREADSHEET_ID,
    SEGURIDAD_VIAL_SPREADSHEET_ID,
    CONF_SPREADSHEET_ID,
    CONF_SOURCE_SHEET_NAME,
    CONF_TARGET_SHEET_NAME,
    SERVICE_ACCOUNT_FILE,
    DEFAULT_SYNC_INTERVAL_SECONDS
)
from sync_manager import SyncManager

def run_once(manager: SyncManager, write_to_sheet: bool = True):
    print("=" * 70)
    print("  INICIANDO SINCRONIZACIÓN DE VIAJES CORDILLERA")
    print(f"  Planilla ID: {manager.spreadsheet_id}")
    print(f"  Fecha/Hora:  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    try:
        report = manager.run_sync(write_to_sheet=write_to_sheet)
        summary = report["summary"]

        print("\n[OK] Sincronización completada con éxito.")
        print(f"     - Filas escaneadas en Ruteos:   {summary['total_rows_scanned']}")
        print(f"     - Total de viajes (TD) vistos:  {summary['total_trips_detected']}")
        print(f"     - Viajes Cordillera copiados:   {summary['copied_trips_count']}")
        print(f"     - Filas escritas en SEGURIDA:   {summary['copied_rows_count']}")
        print(f"     - Viajes de otras zonas (no):   {summary['not_copied_trips_count']}")
        print(f"     - Locaciones detectadas:        {', '.join(summary['cordillera_locations_found'])}")
        print(f"     - Tiempo transcurrido:          {report['elapsed_seconds']} s")

        if report["viajes_copiados"]:
            print("\n--- Desglose de Viajes Copiados a SEGURIDA VIAL ---")
            for v in report["viajes_copiados"]:
                locs_c = ", ".join(v["localidades_cordillera"])
                locs_all = ", ".join(v["todas_las_localidades"])
                print(f"  * TD {v['td']} | Trk: {v['tractor']} | Chf: {v['chofer']} | Filas: {v['total_filas']}")
                print(f"    -> Cordillera: [{locs_c}] | Paradas del viaje: [{locs_all}]")

        return report
    except Exception as e:
        print(f"\n[ERROR] Falló la sincronización: {e}", file=sys.stderr)
        sys.exit(1)

def run_once_conf_viaje(manager: SyncManager, write_to_sheet: bool = True):
    print("=" * 70)
    print("  INICIANDO SINCRONIZACION UTE Cordillera -> CONF. DE VIAJE")
    print("  Criterio: Columna F con símbolo ⚠️ agrupado por TD (Col I)")
    print(f"  Planilla ID:     {manager.spreadsheet_id}")
    print(f"  Pestaña Origen:  {CONF_SOURCE_SHEET_NAME}")
    print(f"  Pestaña Destino: {CONF_TARGET_SHEET_NAME}")
    print(f"  Fecha/Hora:      {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    try:
        report = manager.run_sync_conf_viaje(write_to_sheet=write_to_sheet)
        summary = report["summary"]

        print(f"\n[OK] Sincronización de {CONF_TARGET_SHEET_NAME} completada con éxito.")
        print(f"     - Filas escaneadas en {CONF_SOURCE_SHEET_NAME}: {summary['total_rows_scanned']}")
        print(f"     - Total de viajes (TD) vistos:                 {summary['total_trips_detected']}")
        print(f"     - Viajes con Alerta ⚠️ (Col F):                {summary['matching_trips_count']}")
        print(f"     - Filas escritas en {CONF_TARGET_SHEET_NAME}:  {summary['matching_rows_count']}")
        print(f"     - TD(s) seleccionados:                         {', '.join(summary['matching_tds'])}")
        print(f"     - Tiempo transcurrido:                         {report['elapsed_seconds']} s")

        trips_list = report.get("trips_alerta") or report.get("trips_seguimiento") or []
        if trips_list:
            print(f"\n--- Desglose de Viajes Copiados a {CONF_TARGET_SHEET_NAME} (desde fila 5) ---")
            for t in trips_list:
                print(f"  * TD {t['td']} | Trk: {t['tractor']} | Chf: {t['chofer']} | Filas: {t['total_filas']}")
                print(f"    Terminal: {t['terminal']} | Fecha: {t['fecha_planificada']}")
                print(f"    Paradas: {', '.join(t['localidades'])}")
                for r in t["filas_mapeadas"]:
                    print(f"      -> {r}")

        return report
    except Exception as e:
        print(f"\n[ERROR] Falló la sincronización CONF. DE VIAJE: {e}", file=sys.stderr)
        sys.exit(1)


def run_daemon(manager: SyncManager, interval_seconds: int, write_to_sheet: bool = True):
    print("=" * 70)
    print("  MODO DAEMON (PERIÓDICO) ACTIVO")
    print(f"  Intervalo: {interval_seconds} segundos ({round(interval_seconds/60, 1)} minutos)")
    print("  Presiona Ctrl+C para detener.")
    print("=" * 70)

    iteration = 1
    while True:
        print(f"\n>>> Ciclo #{iteration} - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        try:
            run_once(manager, write_to_sheet=write_to_sheet)
        except Exception as e:
            print(f"[Error en ciclo #{iteration}]: {e}", file=sys.stderr)

        print(f"\nEsperando {interval_seconds} segundos hasta el próximo ciclo...")
        try:
            time.sleep(interval_seconds)
            iteration += 1
        except KeyboardInterrupt:
            print("\nDaemon detenido por el usuario.")
            break

def main():
    parser = argparse.ArgumentParser(
        description="Sincronizador de Viajes Cordillera desde Ruteos hacia SEGURIDA VIAL"
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Ejecuta una sola sincronización y finaliza"
    )
    parser.add_argument(
        "--daemon",
        action="store_true",
        help="Ejecuta en segundo plano de forma periódica"
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=DEFAULT_SYNC_INTERVAL_SECONDS,
        help=f"Intervalo en segundos para el modo daemon (por defecto: {DEFAULT_SYNC_INTERVAL_SECONDS})"
    )
    parser.add_argument(
        "--spreadsheet",
        type=str,
        default=None,
        help="ID del spreadsheet de Google Sheets (por defecto según el módulo seleccionado)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Procesa y muestra los viajes pero no escribe en Google Sheets"
    )

    parser.add_argument(
        "--conf-viaje",
        action="store_true",
        help=f"Ejecuta sincronización de {CONF_SOURCE_SHEET_NAME} hacia {CONF_TARGET_SHEET_NAME} (Filtro ⚠️ en Col F)"
    )
    parser.add_argument(
        "--seguridad-vial",
        action="store_true",
        help="Ejecuta sincronización de Ruteos hacia SEGURIDA VIAL (Filtro geográfico de Cordillera)"
    )

    args = parser.parse_args()
    write_to_sheet = not args.dry_run

    if args.conf_viaje:
        target_id = args.spreadsheet or CONF_SPREADSHEET_ID
        manager = SyncManager(spreadsheet_id=target_id)
        run_once_conf_viaje(manager, write_to_sheet=write_to_sheet)
    elif args.daemon:
        target_id = args.spreadsheet or SEGURIDAD_VIAL_SPREADSHEET_ID
        manager = SyncManager(spreadsheet_id=target_id)
        run_daemon(manager, interval_seconds=args.interval, write_to_sheet=write_to_sheet)
    elif args.seguridad_vial:
        target_id = args.spreadsheet or SEGURIDAD_VIAL_SPREADSHEET_ID
        manager = SyncManager(spreadsheet_id=target_id)
        run_once(manager, write_to_sheet=write_to_sheet)
    else:
        # Por defecto cuando se invoca con --once o sin flags específicos: SEGURIDA VIAL
        target_id = args.spreadsheet or SEGURIDAD_VIAL_SPREADSHEET_ID
        manager = SyncManager(spreadsheet_id=target_id)
        run_once(manager, write_to_sheet=write_to_sheet)


if __name__ == "__main__":
    main()
