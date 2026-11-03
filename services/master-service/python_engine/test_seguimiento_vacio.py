"""
test_seguimiento_vacio.py
Pruebas unitarias para el nuevo workflow de Seguimiento de Vacío / Sin TD Nuevo.
"""
import unittest
from sync_seguimiento_vacio import (
    is_dispo_excluded,
    is_chofer_excluded,
    is_valid_vacio,
    is_color_9fc5e8,
    is_default_or_unpainted_bg,
    get_day_column_indices,
    TARGET_COLOR_RGB,
    CLEANUP_COLOR_RGB,
    CLEANUP_COLOR_HEX,
    is_valid_td
)

class TestSeguimientoVacio(unittest.TestCase):

    def test_chofer_excluded(self):
        """Verifica la exclusión si Chofer contiene el carácter '1' solitario."""
        self.assertTrue(is_chofer_excluded("1"))
        self.assertTrue(is_chofer_excluded(" 1 "))
        self.assertTrue(is_chofer_excluded("1\n"))

        self.assertFalse(is_chofer_excluded("10"))
        self.assertFalse(is_chofer_excluded("12"))
        self.assertFalse(is_chofer_excluded("ACOSTA CRISTHIAN GABRIEL"))
        self.assertFalse(is_chofer_excluded("HUENCHUMAN PEDRO LUIS"))
        self.assertFalse(is_chofer_excluded(""))
        self.assertFalse(is_chofer_excluded(None))

    def test_dispo_excluded_keywords(self):
        """Verifica que las localidades excluidas (solo dock sud y tds) sean correctamente detectadas."""
        excluded_cases = [
            "DOCK SUD",
            "dock sud",
            "Dock Sud",
            "TDS",
            "tds",
            "en viaje TDS",
            "TDS_base"
        ]
        for val in excluded_cases:
            self.assertTrue(is_dispo_excluded(val), f"Debería excluirse: {val}")

    def test_dispo_allowed_keywords(self):
        """Verifica que las localidades y estados permitidos (incluyendo TLC, TLP, TVM, PP) no sean excluidos."""
        allowed_cases = [
            "TLC",
            "tlc",
            "TLP",
            "tlp",
            "TVM",
            "tvm",
            "TLC-cm",
            "tlc-cm",
            "TLC-ute",
            "tlc-ute",
            "PP",
            "pp",
            "en viaje PP",
            "Mantenimiento",
            "Reparación",
            "en viaje EURO",
            "en viaje UTE",
            "Disponible",
            "No Disponible",
            "10",
            "16",
            "",
            None
        ]
        for val in allowed_cases:
            self.assertFalse(is_dispo_excluded(val), f"Debería permitirse: {val}")

    def test_is_valid_vacio(self):
        """Verifica la validación de reportes de vacío reales vs booleanos."""
        self.assertTrue(is_valid_vacio("01/10/2026 12:15"))
        self.assertTrue(is_valid_vacio("08/10/2026"))
        self.assertTrue(is_valid_vacio("VACIO"))
        self.assertTrue(is_valid_vacio("VACIO 4/10 8:10 hs"))

        self.assertFalse(is_valid_vacio("FALSE"))
        self.assertFalse(is_valid_vacio("TRUE"))
        self.assertFalse(is_valid_vacio("NO"))
        self.assertFalse(is_valid_vacio(""))
        self.assertFalse(is_valid_vacio(None))

    def test_day_column_indices(self):
        """Verifica los índices de columna de fecha, dispo y chofer para días operativos."""
        # Día 1: Fecha Col 30 (AE), Dispo Col 28 (AC), Chofer Col 27 (AB)
        col_date, col_dispo, col_chofer = get_day_column_indices(1)
        self.assertEqual(col_date, 30)
        self.assertEqual(col_dispo, 28)
        self.assertEqual(col_chofer, 27)

        # Día 2: Fecha Col 43 (AR), Dispo Col 41 (AP), Chofer Col 40 (AO)
        col_date, col_dispo, col_chofer = get_day_column_indices(2)
        self.assertEqual(col_date, 43)
        self.assertEqual(col_dispo, 41)
        self.assertEqual(col_chofer, 40)

        # Día 8: Fecha Col 121 (DR), Dispo Col 119 (DP), Chofer Col 118 (DO)
        col_date, col_dispo, col_chofer = get_day_column_indices(8)
        self.assertEqual(col_date, 121)
        self.assertEqual(col_dispo, 119)
        self.assertEqual(col_chofer, 118)

    def test_color_recognition(self):
        """Verifica la detección del color #9fc5e8 y de fondos por defecto."""
        # Color objetivo exacto
        self.assertTrue(is_color_9fc5e8(TARGET_COLOR_RGB))
        self.assertTrue(is_color_9fc5e8({"red": 0.6235, "green": 0.7725, "blue": 0.9098}))

        # Otros colores
        self.assertFalse(is_color_9fc5e8({"red": 1.0, "green": 0.0, "blue": 0.0})) # Rojo
        self.assertFalse(is_color_9fc5e8({"red": 0.0, "green": 1.0, "blue": 0.0})) # Verde
        self.assertFalse(is_color_9fc5e8(None))

        # Fondos por defecto
        self.assertTrue(is_default_or_unpainted_bg(None))
        self.assertTrue(is_default_or_unpainted_bg({"red": 1.0, "green": 1.0, "blue": 1.0})) # Blanco
        self.assertTrue(is_default_or_unpainted_bg({"red": 0.9607843, "green": 0.9686275, "blue": 0.9803922})) # Base tabla
        self.assertTrue(is_default_or_unpainted_bg(CLEANUP_COLOR_RGB)) # Limpieza #f5f7fa
        self.assertEqual(CLEANUP_COLOR_HEX, "#f5f7fa")
        self.assertFalse(is_default_or_unpainted_bg({"red": 0.7, "green": 0.2, "blue": 0.2})) # Color personalizado

    def test_is_valid_td(self):
        """Verifica que TDs provisionales COD-XXXX sean válidos y los no operativos se descarten."""
        self.assertTrue(is_valid_td("1299078"))
        self.assertTrue(is_valid_td("COD-2730951"))
        self.assertTrue(is_valid_td("cod-2730951"))
        self.assertFalse(is_valid_td("TD"))
        self.assertFalse(is_valid_td("#N/A"))
        self.assertFalse(is_valid_td("DIRECTO"))
        self.assertFalse(is_valid_td(""))


if __name__ == "__main__":
    unittest.main()

