#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_bajas_movimientos.py
Pruebas unitarias para la lógica de cálculo de columnas de chofer,
normalización de nombres, formato de notas y resolución mensual.
"""

import unittest
from datetime import date
from sync_bajas_movimientos import (
    get_col_chofer,
    index_to_col_letter,
    normalizar_texto,
    format_baja_note,
    resolver_hoja_para_fecha,
    OCTUBRE_MOV_ID,
    OCTUBRE_TAB_NAME,
    NOVIEMBRE_MOV_ID,
    NOVIEMBRE_TAB_NAME
)


class TestBajasMovimientos(unittest.TestCase):

    def test_col_chofer_formula(self):
        """Verifica la fórmula exacta de columna de chofer para los 31 días operativos."""
        # Día 1: Columna 27 (AB)
        self.assertEqual(get_col_chofer(1), 27)
        self.assertEqual(index_to_col_letter(27), "AB")

        # Día 2: Columna 40 (AO)
        self.assertEqual(get_col_chofer(2), 40)
        self.assertEqual(index_to_col_letter(40), "AO")

        # Día 3: Columna 53 (BB)
        self.assertEqual(get_col_chofer(3), 53)
        self.assertEqual(index_to_col_letter(53), "BB")

        # Día 15: Columna 27 + 13 * 14 = 209
        self.assertEqual(get_col_chofer(15), 209)

        # Día 31: Columna 27 + 13 * 30 = 417
        self.assertEqual(get_col_chofer(31), 417)
        self.assertEqual(index_to_col_letter(417), "PB")

    def test_normalizar_texto(self):
        """Verifica eliminación de acentos, mayúsculas y limpieza de nombres."""
        self.assertEqual(normalizar_texto("SEPÚLVEDA, Javier Marcelo"), "SEPULVEDA JAVIER MARCELO")
        self.assertEqual(normalizar_texto("  BURgOs   José  Luis  "), "BURGOS JOSE LUIS")
        self.assertEqual(normalizar_texto("YAÑEZ SERGIO"), "YANEZ SERGIO")
        self.assertEqual(normalizar_texto(""), "")
        self.assertEqual(normalizar_texto(None), "")

    def test_format_baja_note(self):
        """Verifica el formato del texto para el hover note de Google Sheets."""
        # Con detalle
        nota1 = format_baja_note("Baja / Término de diagrama", "2026-11-03", "SE BAJA MARTES 3/11")
        self.assertIn("⚠️ BAJA / TÉRMINO DE DIAGRAMA (Hasta: 03/11/2026)", nota1)
        self.assertIn("Detalle: SE BAJA MARTES 3/11", nota1)

        # Sin detalle
        nota2 = format_baja_note("BAJA_DIAGRAMA", "2026-10-31", "")
        self.assertEqual(nota2, "⚠️ BAJA_DIAGRAMA (Hasta: 31/10/2026)")

    def test_resolver_hoja_para_fecha(self):
        """Verifica la resolución dinámica de spreadsheet y pestaña según el mes."""
        dummy_config = {
            "mes_actual": {
                "nombre": "Octubre 2026",
                "movimientos_id": OCTUBRE_MOV_ID,
                "tab_movimientos": OCTUBRE_TAB_NAME
            },
            "mes_anterior": {}
        }

        # Fecha de Octubre -> Planilla Octubre
        sheet_oct, tab_oct = resolver_hoja_para_fecha(date(2026, 10, 31), dummy_config)
        self.assertEqual(sheet_oct, OCTUBRE_MOV_ID)
        self.assertEqual(tab_oct, OCTUBRE_TAB_NAME)

        # Fecha de Noviembre -> Planilla Noviembre
        sheet_nov, tab_nov = resolver_hoja_para_fecha(date(2026, 11, 2), dummy_config)
        self.assertEqual(sheet_nov, NOVIEMBRE_MOV_ID)
        self.assertEqual(tab_nov, NOVIEMBRE_TAB_NAME)


if __name__ == "__main__":
    unittest.main()
