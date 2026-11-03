"""
Suite de pruebas unitarias y de integración para Viajes Cordillera.
"""
import unittest
from config import (
    col_letter_to_index,
    TARGET_COLUMNS_LETTERS,
    TARGET_COLUMNS_INDICES,
    TARGET_COLUMNS_HEADERS,
    CORDILLERA_LOCATIONS,
    LOCATION_REGEX
)
from filter_service import CordilleraFilterService

class TestViajesCordillera(unittest.TestCase):
    def setUp(self):
        self.service = CordilleraFilterService()

    def test_column_letter_to_index(self):
        self.assertEqual(col_letter_to_index("A"), 0)
        self.assertEqual(col_letter_to_index("B"), 1)
        self.assertEqual(col_letter_to_index("C"), 2)
        self.assertEqual(col_letter_to_index("D"), 3)
        self.assertEqual(col_letter_to_index("H"), 7)
        self.assertEqual(col_letter_to_index("I"), 8)
        self.assertEqual(col_letter_to_index("J"), 9)
        self.assertEqual(col_letter_to_index("K"), 10)
        self.assertEqual(col_letter_to_index("L"), 11)
        self.assertEqual(col_letter_to_index("N"), 13)
        self.assertEqual(col_letter_to_index("S"), 18)
        self.assertEqual(col_letter_to_index("T"), 19)
        self.assertEqual(col_letter_to_index("X"), 23)
        self.assertEqual(col_letter_to_index("AD"), 29)
        self.assertEqual(col_letter_to_index("AE"), 30)
        self.assertEqual(col_letter_to_index("AF"), 31)
        self.assertEqual(col_letter_to_index("AG"), 32)
        self.assertEqual(col_letter_to_index("AI"), 34)
        self.assertEqual(col_letter_to_index("AJ"), 35)
        self.assertEqual(col_letter_to_index("AK"), 36)
        self.assertEqual(col_letter_to_index("AL"), 37)
        self.assertEqual(col_letter_to_index("AP"), 41)
        self.assertEqual(len(TARGET_COLUMNS_INDICES), 22)
        self.assertEqual(len(TARGET_COLUMNS_HEADERS), 22)
        self.assertEqual(TARGET_COLUMNS_HEADERS[-1], "Estado")

    def test_cordillera_location_matching(self):
        # Coincidencias positivas
        self.assertIn("ZAPALA", self.service.check_cordillera_match("ZAPALA"))
        self.assertIn("JUNIN", self.service.check_cordillera_match("JUNIN DE LOS ANDES"))
        self.assertIn("PDA", self.service.check_cordillera_match("PDA"))
        self.assertIn("SAN MARTIN", self.service.check_cordillera_match("SAN MARTIN DE LOS ANDES"))
        self.assertIn("BARILOCHE", self.service.check_cordillera_match("SAN CARLOS DE BARILOCHE"))
        self.assertIn("BOLSON", self.service.check_cordillera_match("EL BOLSON"))
        self.assertIn("VILLA LA ANGOSTURA", self.service.check_cordillera_match("VILLA LA ANGOSTURA"))
        self.assertIn("CAVIAHUE", self.service.check_cordillera_match("CAVIAHUE"))
        self.assertIn("LAS LAJAS", self.service.check_cordillera_match("LAS LAJAS"))
        self.assertIn("LONCOPUE", self.service.check_cordillera_match("LONCOPUE"))
        self.assertIn("CHOSMALAL", self.service.check_cordillera_match("CHOSMALAL"))
        self.assertIn("VILLA PEHUENIA", self.service.check_cordillera_match("VILLA PEHUENIA"))

        # Casos no-cordillera
        self.assertEqual(self.service.check_cordillera_match("NEUQUEN"), [])
        self.assertEqual(self.service.check_cordillera_match("PLOTTIER"), [])
        self.assertEqual(self.service.check_cordillera_match("CIPOLLETTI"), [])
        self.assertEqual(self.service.check_cordillera_match("ROCA"), [])
        self.assertEqual(self.service.check_cordillera_match("CENTENARIO"), [])

    def test_complete_trip_by_td_logic(self):
        """
        Verifica la regla crítica: si un viaje (TD) tiene múltiples paradas y solo una
        es de Cordillera, se transfieren TODAS las filas de ese TD.
        """
        # Crear un mock de filas de Ruteos con 45 columnas
        def make_row(tractor, td, localidad, destino="", color="#34a853"):
            row = [""] * 45
            row[0] = tractor      # Col A
            row[1] = "10"         # Col B
            row[2] = "SEMI123"    # Col C
            row[3] = "CHOFER X"   # Col D
            row[11] = td          # Col L (TD)
            row[29] = destino     # Col AD
            row[37] = localidad   # Col AL (Localidad)
            row[41] = color       # Col AP (Estado / Color)
            return row

        header_row = [""] * 45
        header_row[11] = "TD"

        mock_rows = [
            header_row,
            # Viaje 1 (TD 1001): 3 paradas, solo la última es ZAPALA (Cordillera)
            make_row("TRK-1", "1001", "PLAZA HUINCUL", color="#34a853"),
            make_row("TRK-1", "1001", "CUTRAL CO", color="#34a853"),
            make_row("TRK-1", "1001", "ZAPALA", color="#34a853"),

            # Viaje 2 (TD 1002): 2 paradas, ninguna es cordillera
            make_row("TRK-2", "1002", "NEUQUEN"),
            make_row("TRK-2", "1002", "CENTENARIO"),

            # Viaje 3 (TD 1003): 2 paradas, primera es CAVIAHUE (Cordillera)
            make_row("TRK-3", "1003", "CAVIAHUE", color="#ffff00"),
            make_row("TRK-3", "1003", "LONCOPUE", color="#ffff00")
        ]

        result = self.service.process_ruteos(mock_rows)
        summary = result["summary"]

        # Debe haber 2 viajes copiados (TD 1001 y TD 1003) y 1 no copiado (TD 1002)
        self.assertEqual(summary["total_trips_detected"], 3)
        self.assertEqual(summary["copied_trips_count"], 2)
        self.assertEqual(summary["not_copied_trips_count"], 1)

        # En TD 1001, las 3 filas deben haberse copiado (incluso PLAZA HUINCUL y CUTRAL CO)
        trip_1001 = next(v for v in result["viajes_copiados"] if v["td"] == "1001")
        self.assertEqual(trip_1001["total_filas"], 3)
        self.assertIn("ZAPALA", trip_1001["localidades_cordillera"])
        self.assertEqual(len(trip_1001["filas_20_columnas"]), 3)
        # Cada fila debe tener 22 columnas y la última columna debe ser el color de AP (#34a853)
        for r in trip_1001["filas_20_columnas"]:
            self.assertEqual(len(r), 22)
            self.assertEqual(r[21], "#34a853")

        # En TD 1003, las 2 filas deben haberse copiado y tener el color de AP (#ffff00)
        trip_1003 = next(v for v in result["viajes_copiados"] if v["td"] == "1003")
        self.assertEqual(trip_1003["total_filas"], 2)
        for r in trip_1003["filas_20_columnas"]:
            self.assertEqual(len(r), 22)
            self.assertEqual(r[21], "#ffff00")

        # En TD 1002, debe estar en no copiados
        trip_1002 = next(v for v in result["viajes_no_copiados"] if v["td"] == "1002")
        self.assertEqual(trip_1002["total_filas"], 2)

        # Total filas a escribir en SEGURIDA VIAL = 3 (de 1001) + 2 (de 1003) = 5
        self.assertEqual(summary["copied_rows_count"], 5)
        self.assertEqual(len(result["rows_to_write"]), 5)

if __name__ == "__main__":
    unittest.main()
