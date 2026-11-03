"""
Pruebas unitarias para el servicio ConfViajeService (UTE Cordillera ➡️ CONF. DE VIAJE).
"""
import unittest
from config import col_letter_to_index, CONF_COLUMN_MAPPINGS
from conf_viaje_service import ConfViajeService, clean_client_name

class TestConfViajeService(unittest.TestCase):
    def setUp(self):
        self.service = ConfViajeService()

    def test_column_mappings(self):
        """Verifica que las 10 columnas declaradas tengan los índices correctos."""
        expected_mappings = [
            ("T", 19, "A", 0),
            ("D", 3,  "B", 1),
            ("I", 8,  "C", 2),
            ("A", 0,  "D", 3),
            ("G", 6,  "E", 4),
            ("U", 20, "F", 5),
            ("N", 13, "G", 6),
            ("Q", 16, "H", 7),
            ("K", 10, "I", 8),
            ("L", 11, "J", 9),
        ]
        for src_letter, src_idx, dst_letter, dst_idx in expected_mappings:
            self.assertEqual(col_letter_to_index(src_letter), src_idx)
            self.assertEqual(col_letter_to_index(dst_letter), dst_idx)

    def test_clean_client_name(self):
        """Verifica la limpieza del campo DESTINO para obtener el nombre del cliente."""
        # Casos explícitos del diagrama
        self.assertEqual(
            clean_client_name("2000121341-YP01-01-24 - 00029 - NEUQUEN PETRO OESTE"),
            "NEUQUEN PETRO OESTE"
        )
        self.assertEqual(
            clean_client_name("SRL2000111782-YP01-01-24 - 01578 - PETROZAPALA SACI"),
            "PETROZAPALA SACI"
        )
        # Con sufijo de tipo societario
        self.assertEqual(
            clean_client_name("2000121341-YP01-01-24 - 00029 - NEUQUEN PETRO OESTE SRL"),
            "NEUQUEN PETRO OESTE SRL"
        )
        # Casos límite
        self.assertEqual(clean_client_name(""), "")
        self.assertEqual(clean_client_name(None), "")
        self.assertEqual(clean_client_name("PETRO OESTE"), "PETRO OESTE")

    def test_is_match_cell(self):
        """Verifica la detección robusta e insensible a mayúsculas de 'sujeto a seguimiento'."""
        self.assertTrue(self.service.is_match_cell("sujeto a seguimiento"))
        self.assertTrue(self.service.is_match_cell("SUJETO A SEGUIMIENTO"))
        self.assertTrue(self.service.is_match_cell("  Sujeto A Seguimiento  "))
        self.assertTrue(self.service.is_match_cell("Alerta: sujeto a seguimiento especial"))
        self.assertFalse(self.service.is_match_cell("normal"))
        self.assertFalse(self.service.is_match_cell(""))
        self.assertFalse(self.service.is_match_cell(None))

    def test_map_row(self):
        """Verifica la extracción, limpieza de cliente y posición exacta de las 10 columnas."""
        mock_row = [""] * 25
        mock_row[19] = "2026-10-01"                                                    # Col T -> Dest Col A (0)
        mock_row[3]  = "JUAN PEREZ"                                                    # Col D -> Dest Col B (1)
        mock_row[8]  = "123456"                                                        # Col I -> Dest Col C (2)
        mock_row[0]  = "TRACTOR-01"                                                    # Col A -> Dest Col D (3)
        mock_row[6]  = "TERMINAL DOCK"                                                 # Col G -> Dest Col E (4)
        mock_row[20] = "BARILOCHE"                                                     # Col U -> Dest Col F (5)
        mock_row[13] = "2000121341-YP01-01-24 - 00029 - NEUQUEN PETRO OESTE"          # Col N -> Dest Col G (6, limpio)
        mock_row[16] = "C1;C2"                                                         # Col Q -> Dest Col H (7)
        mock_row[10] = "02/10/2026 10:00"                                              # Col K -> Dest Col I (8)
        mock_row[11] = "EVENTO-ETA"                                                    # Col L -> Dest Col J (9)

        mapped = self.service.map_row(mock_row)
        self.assertEqual(len(mapped), 10)
        self.assertEqual(mapped[0], "2026-10-01")
        self.assertEqual(mapped[1], "JUAN PEREZ")
        self.assertEqual(mapped[2], "123456")
        self.assertEqual(mapped[3], "TRACTOR-01")
        self.assertEqual(mapped[4], "TERMINAL DOCK")
        self.assertEqual(mapped[5], "BARILOCHE")
        self.assertEqual(mapped[6], "NEUQUEN PETRO OESTE")
        self.assertEqual(mapped[7], "C1;C2")
        self.assertEqual(mapped[8], "02/10/2026 10:00")
        self.assertEqual(mapped[9], "EVENTO-ETA")

    def test_trip_grouping_and_full_transfer(self):
        """
        Regla de Oro:
        Si una sola fila de un TD contiene 'sujeto a seguimiento' en Col W (o Col V),
        se deben transferir TODAS las filas de ese viaje completo a CONF. DE VIAJE.
        """
        def make_row(td, tractor, chofer, col_w="", col_v="#ffffff"):
            row = [""] * 26
            row[0] = tractor     # Col A
            row[3] = chofer      # Col D
            row[6] = "PLANTA 1"  # Col G
            row[8] = td          # Col I (TD)
            row[10] = "02/10"    # Col K
            row[11] = "ETA"      # Col L
            row[13] = "2000-01 - 001 - CLIENTE TEST" # Col N
            row[16] = "C1"       # Col Q
            row[19] = "01/10"    # Col T
            row[20] = "ZAPALA"   # Col U
            row[21] = col_v      # Col V (Color/Estado)
            row[22] = col_w      # Col W (Sujeto a seguimiento)
            return row

        headers = ["TRACTOR", "N° UT", "SEMI", "CHOFER", "TRACKING", "", "VIAJE", "", "TD", "", "LLEGADA", "EVENTO", "", "DESTINO", "", "", "CISTERNADO", "", "", "FECHA", "LOCALIDAD", "ESTADO", "SEGUIMIENTO"]
        
        raw_rows = [
            headers,
            # Viaje 1 (TD 2001): 3 filas, solo la fila 1 tiene 'sujeto a seguimiento' en Col W
            make_row("2001", "TRK-A", "CHOFER 1", col_w="sujeto a seguimiento"),
            make_row("2001", "TRK-A", "", col_w=""),
            make_row("2001", "TRK-A", "", col_w=""),

            # Viaje 2 (TD 2002): 2 filas, ninguna tiene seguimiento
            make_row("2002", "TRK-B", "CHOFER 2", col_w=""),
            make_row("2002", "TRK-B", "", col_w=""),

            # Viaje 3 (TD 2003): 2 filas, la SEGUNDA fila tiene 'sujeto a seguimiento' en Col W
            make_row("2003", "TRK-C", "CHOFER 3", col_w=""),
            make_row("2003", "TRK-C", "", col_w="SUJETO A SEGUIMIENTO"),
        ]

        result = self.service.process_rows(raw_rows)
        summary = result["summary"]

        self.assertEqual(summary["total_trips_detected"], 3)
        self.assertEqual(summary["matching_trips_count"], 2)  # TD 2001 y TD 2003
        self.assertEqual(summary["non_matching_trips_count"], 1)  # TD 2002
        self.assertIn("2001", summary["matching_tds"])
        self.assertIn("2003", summary["matching_tds"])
        self.assertNotIn("2002", summary["matching_tds"])

        # Las filas escritas deben ser 3 (de 2001) + 2 (de 2003) = 5 filas en total
        self.assertEqual(summary["matching_rows_count"], 5)
        self.assertEqual(len(result["rows_to_write"]), 5)

        # Verificar viaje 2001
        trip_2001 = next(t for t in result["trips_seguimiento"] if t["td"] == "2001")
        self.assertEqual(trip_2001["total_filas"], 3)
        self.assertEqual(len(trip_2001["filas_mapeadas"]), 3)
        self.assertEqual(len(trip_2001["filas_mapeadas"][0]), 10)
        self.assertEqual(trip_2001["filas_mapeadas"][0][6], "CLIENTE TEST")

        # Verificar viaje 2003
        trip_2003 = next(t for t in result["trips_seguimiento"] if t["td"] == "2003")
        self.assertEqual(trip_2003["total_filas"], 2)
        self.assertEqual(len(trip_2003["filas_mapeadas"]), 2)
        self.assertEqual(len(trip_2003["filas_mapeadas"][0]), 10)

if __name__ == "__main__":
    unittest.main()
