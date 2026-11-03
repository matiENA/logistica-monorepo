"""
test_ruteos_movimientos.py
Pruebas unitarias para la lógica de limpieza de destino, deduplicación y cálculo de columnas.
"""
import unittest
from sync_ruteos_movimientos import clean_destino, format_note_destinos, get_day_columns

class TestRuteosMovimientos(unittest.TestCase):

    def test_clean_destino_standard(self):
        """Verifica la eliminación del prefijo operativo y conservación del código de cliente y razón social."""
        raw = "2000146470-YP01-01-24 - 31349 - RIO NEUQUEN COMBUSTIBLES S.A."
        expected = "31349 - RIO NEUQUEN COMBUSTIBLES S.A."
        self.assertEqual(clean_destino(raw), expected)

    def test_clean_destino_variants(self):
        """Verifica variantes con códigos alfanuméricos y formatos con 2 o 3 partes."""
        raw1 = "SRL2000111782-YP01-01-24 - 01578 - PETROZAPALA SACI"
        self.assertEqual(clean_destino(raw1), "01578 - PETROZAPALA SACI")

        raw2 = "01578 - PETROZAPALA SACI"
        self.assertEqual(clean_destino(raw2), "01578 - PETROZAPALA SACI")

        raw3 = "PETROZAPALA SACI"
        self.assertEqual(clean_destino(raw3), "PETROZAPALA SACI")

        self.assertEqual(clean_destino(""), "")
        self.assertEqual(clean_destino(None), "")

    def test_deduplicate_destinos(self):
        """Verifica que si un destino se repite idéntico, solo se ponga uno."""
        destinos = [
            "2000146470-YP01-01-24 - 31349 - RIO NEUQUEN COMBUSTIBLES S.A.",
            "2000146470-YP01-01-24 - 31349 - RIO NEUQUEN COMBUSTIBLES S.A.",
            "2000146470-YP01-01-24 - 31349 - RIO NEUQUEN COMBUSTIBLES S.A."
        ]
        note = format_note_destinos(destinos)
        self.assertEqual(note, "31349 - RIO NEUQUEN COMBUSTIBLES S.A.")

    def test_multiple_unique_destinos(self):
        """Verifica que destinos distintos se ordenen y presenten como lista sin repetir idénticos."""
        destinos = [
            "2000146470-YP01-01-24 - 31349 - RIO NEUQUEN COMBUSTIBLES S.A.",
            "2000136436-YP01-01-24 - 01804 - DEL PARQUE SRL",
            "2000146470-YP01-01-24 - 31349 - RIO NEUQUEN COMBUSTIBLES S.A."
        ]
        note = format_note_destinos(destinos)
        expected = "• 31349 - RIO NEUQUEN COMBUSTIBLES S.A.\n• 01804 - DEL PARQUE SRL"
        self.assertEqual(note, expected)

    def test_day_columns_calculation(self):
        """Verifica la fórmula canónica de doble columna por día operativo."""
        # Día 1: AE (30), AG (32)
        col1_d1, col2_d1 = get_day_columns(1)
        self.assertEqual(col1_d1, (30, "AE"))
        self.assertEqual(col2_d1, (32, "AG"))

        # Día 2: AR (43), AT (45)
        col1_d2, col2_d2 = get_day_columns(2)
        self.assertEqual(col1_d2, (43, "AR"))
        self.assertEqual(col2_d2, (45, "AT"))

        # Día 3: BE (56), BG (58)
        col1_d3, col2_d3 = get_day_columns(3)
        self.assertEqual(col1_d3, (56, "BE"))
        self.assertEqual(col2_d3, (58, "BG"))

        # Día 31: PE (420), PG (422)
        col1_d31, col2_d31 = get_day_columns(31)
        self.assertEqual(col1_d31, (420, "PE"))
        self.assertEqual(col2_d31, (422, "PG"))

if __name__ == '__main__':
    unittest.main()
