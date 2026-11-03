"""
Servicio de filtrado y agregación de Viajes Cordillera.
Aplica la regla de negocio: viaje completo por TD (columna L) ante cualquier
parada en localidades de Cordillera.
"""
from typing import List, Dict, Any, Tuple
import re

from config import (
    TARGET_COLUMNS_LETTERS,
    TARGET_COLUMNS_HEADERS,
    TARGET_COLUMNS_INDICES,
    INDEX_COLUMN_0BASED,
    LOCALITY_COLUMN_0BASED,
    DESTINATION_COLUMN_0BASED,
    CORDILLERA_LOCATIONS,
    LOCATION_REGEX
)

class CordilleraFilterService:
    def __init__(self, location_regex=LOCATION_REGEX):
        self.location_regex = location_regex

    def check_cordillera_match(self, locality_str: str, destination_str: str = "") -> List[str]:
        """
        Verifica si la localidad (o secundariamente el destino) contiene alguna
        de las localidades de Cordillera. Retorna la lista de locaciones encontradas.
        """
        matches = set()
        
        # 1. Búsqueda principal en Localidad de Ruteo (Col AL)
        if locality_str:
            for match in self.location_regex.finditer(locality_str):
                matches.add(match.group(0).upper())
                
        # 2. Búsqueda complementaria en DESTINO (Col AD) si no hubo match en AL
        # o para detectar menciones explícitas de la localidad
        if destination_str and not matches:
            for match in self.location_regex.finditer(destination_str):
                # Descartar falsos positivos si es parte de una razón social sin localidad real
                found_word = match.group(0).upper()
                matches.add(found_word)
                
        return sorted(list(matches))

    def process_ruteos(self, raw_rows: List[List[str]]) -> Dict[str, Any]:
        """
        Procesa todas las filas leídas de la pestaña Ruteos.
        Agrupa por TD (Columna L), evalúa si alguna fila tiene destino Cordillera,
        y separa en viajes_copiados y viajes_no_copiados.
        """
        if not raw_rows:
            return {
                "summary": {
                    "total_rows_scanned": 0,
                    "total_trips_detected": 0,
                    "copied_trips_count": 0,
                    "copied_rows_count": 0,
                    "not_copied_trips_count": 0,
                    "cordillera_locations_found": []
                },
                "viajes_copiados": [],
                "viajes_no_copiados": [],
                "target_headers": TARGET_COLUMNS_HEADERS,
                "rows_to_write": []
            }

        # Detección de filas de cabecera vs filas de datos
        # Las primeras 3 filas suelen contener metadatos/headers (Fila 1 a Fila 3)
        start_row_idx = 0
        for i, row in enumerate(raw_rows[:5]):
            td_val = row[INDEX_COLUMN_0BASED].strip().upper() if len(row) > INDEX_COLUMN_0BASED else ""
            if td_val in ["TD", "Nº DE DESPACHO", "N° DE DESPACHO", "DESPACHO"]:
                start_row_idx = i + 1
                break

        # Agrupar filas de datos por TD preservando el orden de aparición
        td_order = []
        td_groups = {}

        for row_idx, row in enumerate(raw_rows[start_row_idx:], start=start_row_idx + 1):
            if not row or not any(cell.strip() for cell in row):
                continue

            td_val = row[INDEX_COLUMN_0BASED].strip() if len(row) > INDEX_COLUMN_0BASED else ""
            
            # Descartar filas sin TD válido (separadores de terminal o filas vacías)
            if not td_val or td_val.upper() in ["TD", "Nº DE DESPACHO", "N° DE DESPACHO"]:
                continue

            if td_val not in td_groups:
                td_groups[td_val] = []
                td_order.append(td_val)

            td_groups[td_val].append((row_idx, row))

        # Analizar cada viaje (TD)
        viajes_copiados = []
        viajes_no_copiados = []
        rows_to_write = []
        all_cordillera_locations_found = set()

        for td in td_order:
            group = td_groups[td]
            
            # Extraer información del viaje
            tractor = ""
            ut = ""
            chofer = ""
            tracking_list = []
            localidades_del_viaje = []
            matched_locations_in_trip = set()
            match_details = []

            for row_idx, row in group:
                r_tractor = row[0].strip() if len(row) > 0 else ""
                r_ut = row[1].strip() if len(row) > 1 else ""
                r_chofer = row[3].strip() if len(row) > 3 else ""
                r_tracking = row[7].strip() if len(row) > 7 else ""
                r_dest = row[DESTINATION_COLUMN_0BASED].strip() if len(row) > DESTINATION_COLUMN_0BASED else ""
                r_loc = row[LOCALITY_COLUMN_0BASED].strip() if len(row) > LOCALITY_COLUMN_0BASED else ""

                if r_tractor and not tractor:
                    tractor = r_tractor
                if r_ut and not ut:
                    ut = r_ut
                if r_chofer and not chofer and r_chofer.lower() != "autorizado":
                    chofer = r_chofer
                if r_tracking:
                    tracking_list.append(r_tracking)
                if r_loc and r_loc not in localidades_del_viaje:
                    localidades_del_viaje.append(r_loc)

                # Verificar si esta fila tiene localidad de cordillera
                row_matches = self.check_cordillera_match(r_loc, r_dest)
                if row_matches:
                    for m in row_matches:
                        matched_locations_in_trip.add(m)
                        all_cordillera_locations_found.add(m)
                    match_details.append({
                        "row_index": row_idx,
                        "localidad": r_loc,
                        "destino": r_dest,
                        "matches": row_matches
                    })

            # Si chofer sigue vacío, tomar el que haya
            if not chofer:
                for _, row in group:
                    c = row[3].strip() if len(row) > 3 else ""
                    if c:
                        chofer = c
                        break

            latest_tracking = tracking_list[0] if tracking_list else ""

            # REGLA FUNDAMENTAL:
            # Si al menos UNA fila tiene localidad de cordillera, se transfieren TODAS las filas de este TD
            if matched_locations_in_trip:
                trip_cols_rows = []
                for row_idx, row in group:
                    # Extraer exactamente las columnas declaradas (A a V)
                    row_cols = [
                        row[c_idx] if c_idx < len(row) else ""
                        for c_idx in TARGET_COLUMNS_INDICES
                    ]
                    trip_cols_rows.append(row_cols)
                    rows_to_write.append(row_cols)

                viajes_copiados.append({
                    "td": td,
                    "tractor": tractor,
                    "ut": ut,
                    "chofer": chofer,
                    "total_filas": len(group),
                    "localidades_cordillera": sorted(list(matched_locations_in_trip)),
                    "todas_las_localidades": localidades_del_viaje,
                    "ultimo_tracking": latest_tracking,
                    "detalles_coincidencia": match_details,
                    "filas_20_columnas": trip_cols_rows,
                    "filas_columnas": trip_cols_rows
                })
            else:
                viajes_no_copiados.append({
                    "td": td,
                    "tractor": tractor,
                    "ut": ut,
                    "chofer": chofer,
                    "total_filas": len(group),
                    "localidades": localidades_del_viaje,
                    "ultimo_tracking": latest_tracking
                })

        summary = {
            "total_rows_scanned": len(raw_rows),
            "total_trips_detected": len(td_order),
            "copied_trips_count": len(viajes_copiados),
            "copied_rows_count": len(rows_to_write),
            "not_copied_trips_count": len(viajes_no_copiados),
            "cordillera_locations_found": sorted(list(all_cordillera_locations_found))
        }

        return {
            "summary": summary,
            "viajes_copiados": viajes_copiados,
            "viajes_no_copiados": viajes_no_copiados,
            "target_headers": TARGET_COLUMNS_HEADERS,
            "rows_to_write": rows_to_write
        }
