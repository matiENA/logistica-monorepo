"""
Servicio de filtrado y mapeo de UTE Cordillera hacia CONF. DE VIAJE.

Regla de negocio:
- Clave de control: Columna F ('Marca Temp - Respuesta') con símbolo ⚠️.
- Todo el viaje agrupa por número de TD en la Columna I.
- Si alguna fila de un TD contiene '⚠️' en la Columna F,
  se transfiere el VIAJE COMPLETO (todas las filas con ese mismo TD).
- Los registros se mapean a 10 columnas específicas (A a J) y se escriben
  a partir de la fila 5 de CONF. DE VIAJE.
"""
import re
from typing import List, Dict, Any, Set
from config import (
    CONF_COLUMN_INDICES,
    CONF_COLUMN_MAPPINGS,
    CONF_FILTER_KEY_INDEX,
    CONF_FILTER_SYMBOL,
    CONF_TRIP_ID_INDEX
)

def clean_client_name(text: str) -> str:
    """
    Limpia el código de contrato y número de estación del destino para extraer el nombre limpio del cliente.
    Ejemplo: '2000121341-YP01-01-24 - 00029 - NEUQUEN PETRO OESTE' -> 'NEUQUEN PETRO OESTE'
    Ejemplo: 'SRL2000111782-YP01-01-24 - 01578 - PETROZAPALA SACI' -> 'PETROZAPALA SACI'
    """
    if not text:
        return ""
    parts = re.split(r'\s+-\s+', text.strip())
    if len(parts) >= 3:
        return ' - '.join(parts[2:]).strip()
    elif len(parts) == 2:
        return parts[1].strip()
    return text.strip()

class ConfViajeService:
    def __init__(
        self,
        filter_symbol: str = CONF_FILTER_SYMBOL,
        filter_col_idx: int = CONF_FILTER_KEY_INDEX,
        trip_id_col_idx: int = CONF_TRIP_ID_INDEX,
        column_indices: list = CONF_COLUMN_INDICES
    ):
        self.filter_symbol = filter_symbol
        self.filter_col_idx = filter_col_idx
        self.trip_id_col_idx = trip_id_col_idx
        self.column_indices = column_indices
        self.headers = [item[2] for item in CONF_COLUMN_MAPPINGS]

    def is_match_cell(self, cell_value: str) -> bool:
        """Verifica si el contenido de la celda contiene el símbolo de alerta ⚠️ o ⚠."""
        if not cell_value:
            return False
        val = str(cell_value)
        return "⚠️" in val or "\u26a0" in val

    def map_row(self, row: List[str]) -> List[str]:
        """
        Mapea una fila de UTE Cordillera a las 10 columnas destino en CONF. DE VIAJE:
        T ➔ A: FECHA PLANIFICADA
        D ➔ B: Chofer
        I ➔ C: N° DE DESPACHO (TD)
        A ➔ D: TRACTOR
        G ➔ E: TERMINAL
        U ➔ F: Localidad de Ruteo
        N ➔ G: CLIENTE (limpiado)
        Q ➔ H: Configuración 
        K ➔ I: Llegada a ETA
        L ➔ J: Cambio de cisternado / Derivación
        """
        mapped = []
        for src_idx, _, _ in self.column_indices:
            val = row[src_idx].strip() if src_idx < len(row) else ""
            if src_idx == 13:  # Col N (DESTINO -> CLIENTE)
                val = clean_client_name(val)
            mapped.append(val)
        return mapped

    def process_rows(self, raw_rows: List[List[str]]) -> Dict[str, Any]:
        """
        Procesa las filas brutas de UTE Cordillera.
        1. Identifica qué TDs tienen al menos una fila con el símbolo ⚠️ en Col F.
        2. Agrupa y extrae todas las filas de los viajes identificados.
        3. Realiza la transformación y mapeo a las 10 columnas destino.
        """
        if not raw_rows:
            return {
                "summary": {
                    "total_rows_scanned": 0,
                    "total_trips_detected": 0,
                    "matching_trips_count": 0,
                    "matching_rows_count": 0,
                    "non_matching_trips_count": 0,
                    "matching_tds": []
                },
                "trips_alerta": [],
                "trips_seguimiento": [],
                "trips_otros": [],
                "rows_to_write": [],
                "headers": self.headers
            }

        # Detectar inicio de datos (ignorar cabecera si la fila 0 contiene nombres de columnas)
        start_row_idx = 0
        first_row_val = raw_rows[0][self.trip_id_col_idx].strip().upper() if len(raw_rows[0]) > self.trip_id_col_idx else ""
        if first_row_val in ["TD", "Nº DE DESPACHO", "N° DE DESPACHO", "DESPACHO"]:
            start_row_idx = 1

        # 1. Agrupar filas por TD en orden de aparición y detectar cuáles tienen el símbolo ⚠️ en Col F
        td_order: List[str] = []
        td_groups: Dict[str, List[tuple]] = {}
        matching_tds: Set[str] = set()

        for row_idx, row in enumerate(raw_rows[start_row_idx:], start=start_row_idx + 1):
            if not row or not any(str(c).strip() for c in row):
                continue

            td_val = row[self.trip_id_col_idx].strip() if len(row) > self.trip_id_col_idx else ""
            if not td_val or td_val.upper() in ["TD", "Nº DE DESPACHO", "N° DE DESPACHO"]:
                continue

            if td_val not in td_groups:
                td_groups[td_val] = []
                td_order.append(td_val)

            # Verificar si esta fila tiene el símbolo ⚠️ en Col F
            col_f_val = row[self.filter_col_idx].strip() if len(row) > self.filter_col_idx else ""
            has_match = self.is_match_cell(col_f_val)
            if has_match:
                matching_tds.add(td_val)

            td_groups[td_val].append((row_idx, row, col_f_val, has_match))

        # 2. Separar viajes con alerta vs otros y mapear columnas
        trips_alerta = []
        trips_otros = []
        rows_to_write = []

        for td in td_order:
            group = td_groups[td]

            # Información principal del viaje
            tractor = ""
            chofer = ""
            terminal = ""
            fecha = ""
            localidades = []
            matched_notes = []

            for row_idx, row, col_f, has_match in group:
                r_tractor = row[0].strip() if len(row) > 0 else ""
                r_chofer = row[3].strip() if len(row) > 3 else ""
                r_terminal = row[6].strip() if len(row) > 6 else ""
                r_fecha = row[19].strip() if len(row) > 19 else ""
                r_loc = row[20].strip() if len(row) > 20 else ""

                if r_tractor and not tractor:
                    tractor = r_tractor
                if r_chofer and not chofer:
                    chofer = r_chofer
                if r_terminal and not terminal:
                    terminal = r_terminal
                if r_fecha and not fecha:
                    fecha = r_fecha
                if r_loc and r_loc not in localidades:
                    localidades.append(r_loc)
                if has_match and col_f:
                    matched_notes.append(f"Fila {row_idx}: '{col_f}'")

            is_trip_match = td in matching_tds

            if is_trip_match:
                mapped_trip_rows = []
                for row_idx, row, _, _ in group:
                    mapped_row = self.map_row(row)
                    mapped_trip_rows.append(mapped_row)
                    rows_to_write.append(mapped_row)

                trip_obj = {
                    "td": td,
                    "tractor": tractor,
                    "chofer": chofer,
                    "terminal": terminal,
                    "fecha_planificada": fecha,
                    "localidades": localidades,
                    "total_filas": len(group),
                    "motivos_alerta": matched_notes,
                    "filas_mapeadas": mapped_trip_rows
                }
                trips_alerta.append(trip_obj)
            else:
                trips_otros.append({
                    "td": td,
                    "tractor": tractor,
                    "chofer": chofer,
                    "terminal": terminal,
                    "fecha_planificada": fecha,
                    "localidades": localidades,
                    "total_filas": len(group)
                })

        summary = {
            "total_rows_scanned": len(raw_rows),
            "total_trips_detected": len(td_order),
            "matching_trips_count": len(trips_alerta),
            "matching_rows_count": len(rows_to_write),
            "non_matching_trips_count": len(trips_otros),
            "matching_tds": sorted(list(matching_tds))
        }

        return {
            "summary": summary,
            "trips_alerta": trips_alerta,
            "trips_seguimiento": trips_alerta,  # Alias retrocompatible
            "trips_otros": trips_otros,
            "rows_to_write": rows_to_write,
            "headers": self.headers
        }
