#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_vacio_fechas.py
Pruebas unitarias para validar las reglas de Columna X, composición de notas
y el motor unificado de capas.
"""

import unittest
from sync_operativas_unificadas import (
    format_vacio_datetime,
    compose_final_note,
    clean_destino,
    format_tracking_text,
    is_dispo_excluded,
    is_chofer_excluded,
    is_valid_td,
    CLEANUP_COLOR_RGB,
    CLEANUP_COLOR_HEX,
    is_color_f5f7fa
)


class TestVacioFechasYCapas(unittest.TestCase):

    def test_format_vacio_dates_without_time(self):
        """Verifica que las fechas puras de Col X no se descarten y generen 'VACIO d/m hs'."""
        self.assertEqual(format_vacio_datetime("08/10/2026"), "VACIO 8/10 hs")
        self.assertEqual(format_vacio_datetime("09/10/2026"), "VACIO 9/10 hs")
        self.assertEqual(format_vacio_datetime("10/10/2026"), "VACIO 10/10 hs")
        self.assertEqual(format_vacio_datetime("8/10/26"), "VACIO 8/10 hs")
        self.assertEqual(format_vacio_datetime("8/10"), "VACIO 8/10 hs")

    def test_format_vacio_midnight_format(self):
        """Verifica que fechas con medianoche 0:00 no se descarten."""
        self.assertEqual(format_vacio_datetime("08/10/2026 0:00"), "VACIO 8/10 hs")
        self.assertEqual(format_vacio_datetime("09/10/2026 0:00"), "VACIO 9/10 hs")
        self.assertEqual(format_vacio_datetime("10/10/2026 0:00:00"), "VACIO 10/10 hs")

    def test_format_vacio_with_explicit_time(self):
        """Verifica que fechas con hora se formateen con hora y minutos."""
        self.assertEqual(format_vacio_datetime("4/10/2026 8:10:00"), "VACIO 4/10 8:10 hs")
        self.assertEqual(format_vacio_datetime("01/10/2026 12:15"), "VACIO 1/10 12:15 hs")
        self.assertEqual(format_vacio_datetime("5/10/26 23 HS"), "VACIO 5/10 23:00 hs")
        self.assertEqual(format_vacio_datetime("7/10 23:40"), "VACIO 7/10 23:40 hs")
        self.assertEqual(format_vacio_datetime("VACIO"), "VACIO")

    def test_format_vacio_exclusions(self):
        """Verifica que valores falsos o no vacíos se descarten."""
        for val in ["FALSE", "TRUE", "#N/A", "TLC", "TPH", "NO", "", None]:
            self.assertEqual(format_vacio_datetime(val), "", f"Fallo descartando: {val}")

    def test_compose_final_note_layering(self):
        """
        Verifica que VACÍO vaya en la primera línea si existe en Col X,
        seguido de una línea en blanco de separación, y debajo el tracking de Col H.
        """
        vacio_header = "VACIO 9/10 hs"
        tracking_body = "31349 - RIO NEUQUEN COMBUSTIBLES S.A.\n/14HS VACIO /8HS CAMINO AÑELO"

        res = compose_final_note(vacio_header, tracking_body)
        expected = "VACIO 9/10 hs\n\n31349 - RIO NEUQUEN COMBUSTIBLES S.A.\n/14HS VACIO /8HS CAMINO AÑELO"
        self.assertEqual(res, expected)

    def test_opcion_a_pure_col_h_without_bullets(self):
        """
        Verifica que bajo Opción A, no se generen viñetas (•) ni localidades de Col AL.
        La nota debe ser únicamente el tracking de Col H.
        """
        tracking_extra = ["13:03 llegando a El Parch e /12:07 Unzue /10:55 dero /10:03 Paso Guamini"]
        res = format_tracking_text([], tracking_extra)
        self.assertEqual(res, "13:03 llegando a El Parch e /12:07 Unzue /10:55 dero /10:03 Paso Guamini")
        self.assertNotIn("•", res)
        self.assertNotIn("NEUQUEN", res)
        self.assertNotIn("CATRIEL", res)

    def test_row_70_day_13_note_composition(self):
        """
        Simula el caso exacto reportado por el usuario (Row 70, Día 13):
        No debe contener bullets de localidades (• NEUQUEN, • CATRIEL), solo el tracking puro de Col H.
        """
        vacio_head = ""
        track_extra = ["13:03 llegando a El Parch e /12:07 Unzue /10:55 dero /10:03 Paso Guamini"]
        track_body = format_tracking_text([], track_extra)
        final_note = compose_final_note(vacio_head, track_body)

        self.assertEqual(final_note, "13:03 llegando a El Parch e /12:07 Unzue /10:55 dero /10:03 Paso Guamini")
        self.assertNotIn("• NEUQUEN", final_note)
        self.assertNotIn("• CATRIEL", final_note)

    def test_vacio_with_blank_line_separation(self):
        """
        Verifica que cuando coexisten VACÍO y tracking de Col H:
        - Fila 0: 'VACIO ...'
        - Fila 1: '' (línea vacía para distinguir claramente)
        - Fila 2+: párrafo de tracking de Col H
        """
        vacio_head = "VACIO 13/10 14:00 hs"
        track_body = "13:03 llegando a El Parch e /12:07 Unzue /10:55 dero"
        final_note = compose_final_note(vacio_head, track_body)

        lines = final_note.split("\n")
        self.assertEqual(len(lines), 3)
        self.assertEqual(lines[0], "VACIO 13/10 14:00 hs")
        self.assertEqual(lines[1], "")  # Espacio en blanco de separación
        self.assertEqual(lines[2], "13:03 llegando a El Parch e /12:07 Unzue /10:55 dero")

    def test_compose_final_note_without_col_x(self):
        """
        Si Col X no tiene vacío, la nota debe contener únicamente el tracking de Col H,
        sin inventar cabecera de VACÍO aunque Col H tenga texto con la palabra vacio.
        """
        vacio_header = ""
        tracking_body = "/14HS VACIO /8HS CAMINO AÑELO"

        res = compose_final_note(vacio_header, tracking_body)
        self.assertEqual(res, "/14HS VACIO /8HS CAMINO AÑELO")

    def test_dispo_exclusions(self):
        """Verifica que las localidades de prevención en Dispo se identifiquen correctamente (solo dock sud y tds)."""
        self.assertTrue(is_dispo_excluded("dock sud"))
        self.assertTrue(is_dispo_excluded("DOCK SUD"))
        self.assertTrue(is_dispo_excluded("tds"))
        self.assertTrue(is_dispo_excluded("TDS"))
        self.assertFalse(is_dispo_excluded("TLC-cm"))
        self.assertFalse(is_dispo_excluded("TLC"))
        self.assertFalse(is_dispo_excluded("PP"))
        self.assertFalse(is_dispo_excluded("No Disponible"))
        self.assertFalse(is_dispo_excluded("Mantenimiento"))
        self.assertFalse(is_dispo_excluded("Reparación"))
        self.assertFalse(is_dispo_excluded("ND"))
        self.assertFalse(is_dispo_excluded("en viaje CM"))
        self.assertFalse(is_dispo_excluded("Disponible"))
        self.assertFalse(is_dispo_excluded(""))
        self.assertFalse(is_dispo_excluded(None))

    def test_parse_day_from_cell_month_filtering(self):
        """Verifica que parse_day_from_cell filtre correctamente por mes objetivo."""
        from sync_operativas_unificadas import parse_day_from_cell
        # Strings con formato d/m/yyyy
        self.assertEqual(parse_day_from_cell("13/10/2026", expected_month=10), 13)
        self.assertEqual(parse_day_from_cell("28/09/2026", expected_month=10), None)
        self.assertEqual(parse_day_from_cell("28/09/2026", expected_month=9), 28)
        # Strings con formato d/m
        self.assertEqual(parse_day_from_cell("12/10", expected_month=10), 12)
        self.assertEqual(parse_day_from_cell("12/9", expected_month=10), None)

    def test_standby_unit_qualifies_without_trips_in_ruteos(self):
        """
        Verifica que unidades sin ningún viaje en Ruteos (como AG426OA fila 10)
        califiquen para pintado celeste si tienen chofer asignado y Dispo válida.
        """
        from sync_operativas_unificadas import is_default_or_unpainted_bg

        trk = "AG426OA"
        tractor_all_trips = {}  # 0 viajes en Ruteos
        tractors_vacio_sin_nuevo_td = {}

        # 1. Caso Fila 10 Día 13: Chofer asignado, Dispo vacía/None, celda vacía -> CALIFICA
        chofer_val = "GUTIERREZ SANHUEZA MARCELO ANDRES"
        dispo_val = ""
        cell_s1 = {"value": "", "note": "7:42 UTE", "bg": None}
        current_bg = cell_s1["bg"]

        tiene_chofer = bool(chofer_val and chofer_val.strip() and not is_chofer_excluded(chofer_val))
        dispo_valida = not is_dispo_excluded(dispo_val)
        slot1_vacio = not cell_s1["value"]
        bg_elegible = is_default_or_unpainted_bg(current_bg)

        es_vacio_reciente = (trk in tractors_vacio_sin_nuevo_td)
        es_standby_disponible = (trk not in tractor_all_trips) and tiene_chofer
        chofer_ok = (not is_chofer_excluded(chofer_val)) if es_vacio_reciente else tiene_chofer

        qualifies_day13 = (
            (es_vacio_reciente or es_standby_disponible)
            and chofer_ok
            and dispo_valida
            and slot1_vacio
            and bg_elegible
        )
        self.assertTrue(qualifies_day13, "AG426OA debió calificar en día 13")

        # 2. Caso Fila 10 Día 11: Chofer '1' y Dispo 'No Disponible' -> NO CALIFICA
        chofer_d11 = "1"
        dispo_d11 = "No Disponible"
        tiene_chofer_d11 = bool(chofer_d11 and chofer_d11.strip() and not is_chofer_excluded(chofer_d11))
        dispo_valida_d11 = not is_dispo_excluded(dispo_d11)
        es_standby_d11 = (trk not in tractor_all_trips) and tiene_chofer_d11
        qualifies_day11 = (
            (es_vacio_reciente or es_standby_d11)
            and tiene_chofer_d11
            and dispo_valida_d11
            and slot1_vacio
            and bg_elegible
        )
        self.assertFalse(qualifies_day11, "AG426OA NO debió calificar en día 11")

        # 3. Caso unidad sin chofer asignado (chofer vacío) -> NO CALIFICA
        chofer_vacio = ""
        tiene_chofer_vacio = bool(chofer_vacio and chofer_vacio.strip() and not is_chofer_excluded(chofer_vacio))
        es_standby_vacio = (trk not in tractor_all_trips) and tiene_chofer_vacio
        self.assertFalse(es_standby_vacio, "Unidad sin chofer no debe calificar como standby")

    def test_execution_shield_mutual_exclusion(self):
        """Verifica que ExecutionShield impida dos ejecuciones concurrentes."""
        from execution_shield import ExecutionShield, ShieldBlockedException, LOCK_FILE
        # Asegurar limpieza previa
        LOCK_FILE.unlink(missing_ok=True)

        with ExecutionShield("Test1"):
            self.assertTrue(LOCK_FILE.exists())
            # Un segundo intento debe detectar el bloqueo
            second_shield_blocked = False
            try:
                with ExecutionShield("Test2"):
                    pass
            except ShieldBlockedException:
                second_shield_blocked = True
            self.assertTrue(second_shield_blocked, "El segundo escudo debió ser bloqueado por el primero")

    def test_ignore_hold_annotation_without_td(self):
        """Verifica que filas en hold sin TD numérico no anulen el vacío del último viaje legítimo."""
        # Simulación de filas estilo Ruteos
        mock_ruteos = [
            # Fila 4354: Viaje real con TD y Vacío
            ["AD355XA"] + [""] * 10 + ["1298875"] + [""] * 11 + ["11/10/2026 12:06"],
            # Fila 4847: Anotación en hold por operarios (sin TD, sin Vacío)
            ["AD355XA"] + [""] * 10 + [""] + [""] * 11 + [""]
        ]

        tractor_all_trips = {}
        for r in mock_ruteos:
            trk = r[0]
            td = str(r[11]).strip()
            # Filtro canónico por TD numérico
            if not td or not td.isdigit():
                continue
            vac = format_vacio_datetime(r[23])
            if trk not in tractor_all_trips:
                tractor_all_trips[trk] = []
            tractor_all_trips[trk].append({"td": td, "has_vacio": bool(vac), "vacio_header": vac})

        self.assertIn("AD355XA", tractor_all_trips)
        self.assertEqual(len(tractor_all_trips["AD355XA"]), 1)
        last_trip = tractor_all_trips["AD355XA"][-1]
        self.assertEqual(last_trip["td"], "1298875")
        self.assertTrue(last_trip["has_vacio"])
        self.assertEqual(last_trip["vacio_header"], "VACIO 11/10 12:06 hs")

    def test_limpiar_vacio_strip_helpers(self):
        """Verifica que strip_vacio_header y strip_bullets limpien adecuadamente respetando Col H."""
        from limpiar_vacio import strip_vacio_header, strip_bullets

        # Caso con separación de doble línea \n\n
        note_with_blank = "VACIO 13/10 14:00 hs\n\n13:03 llegando a El Parch e /12:07 Unzue"
        self.assertEqual(strip_vacio_header(note_with_blank), "13:03 llegando a El Parch e /12:07 Unzue")

        # Caso con bullets de localidades obsoletas
        note_with_bullets = "• NEUQUEN\n• CATRIEL\n13:03 llegando a El Parch e /12:07 Unzue"
        self.assertEqual(strip_bullets(note_with_bullets), "13:03 llegando a El Parch e /12:07 Unzue")

        # Caso combinado con VACIO y bullets
        combo = "VACIO 13/10 hs\n\n• NEUQUEN\n13:03 llegando"
        no_vacio = strip_vacio_header(combo)
        self.assertEqual(no_vacio, "• NEUQUEN\n13:03 llegando")
        no_bullets = strip_bullets(no_vacio)
        self.assertEqual(no_bullets, "13:03 llegando")

    def test_is_valid_td(self):
        """Verifica la validación de TDs estándar, provisionales (COD-XXXX) y el descarte de inválidos."""
        # Válidos estándar
        self.assertTrue(is_valid_td("1299078"))
        self.assertTrue(is_valid_td("1310272"))
        self.assertTrue(is_valid_td("9409"))
        self.assertTrue(is_valid_td(123456))

        # Válidos provisionales
        self.assertTrue(is_valid_td("COD-2730951"))
        self.assertTrue(is_valid_td("COD-2733047"))
        self.assertTrue(is_valid_td("cod-2730951"))
        self.assertTrue(is_valid_td("COD_12345"))
        self.assertTrue(is_valid_td("COD 99999"))

        # Inválidos
        self.assertFalse(is_valid_td("TD"))
        self.assertFalse(is_valid_td("#N/A"))
        self.assertFalse(is_valid_td("DIRECTO"))
        self.assertFalse(is_valid_td("D157-D159"))
        self.assertFalse(is_valid_td("-"))
        self.assertFalse(is_valid_td(""))
        self.assertFalse(is_valid_td(None))
        self.assertFalse(is_valid_td("ABC-123"))

    def test_provisional_td_overrides_vacio_seguimiento(self):
        """
        Simula la unidad 335 (AG538QV):
        - Viaje previo: TD 1310272 con VACÍO
        - Nuevo viaje: TD provisional COD-2730951 sin VACÍO
        Verifica que el último viaje activo sea COD-2730951 y por ende NO califique para #9fc5e8.
        """
        mock_ruteos = [
            # Viaje anterior con Vacío
            ["AG538QV"] + ["335"] + [""] * 9 + ["1310272"] + [""] * 11 + ["20/10/2026 10:00"],
            # Nuevo viaje con TD provisional COD-2730951 (sin vacío)
            ["AG538QV"] + ["335"] + [""] * 9 + ["COD-2730951"] + [""] * 11 + [""]
        ]

        tractor_all_trips = {}
        for r in mock_ruteos:
            trk = r[0]
            td = str(r[11]).strip()
            if not is_valid_td(td):
                continue
            vac = format_vacio_datetime(r[23])
            if trk not in tractor_all_trips:
                tractor_all_trips[trk] = []
            tractor_all_trips[trk].append({"td": td, "has_vacio": bool(vac), "vacio_header": vac})

        self.assertIn("AG538QV", tractor_all_trips)
        self.assertEqual(len(tractor_all_trips["AG538QV"]), 2)
        last_trip = tractor_all_trips["AG538QV"][-1]
        self.assertEqual(last_trip["td"], "COD-2730951")
        self.assertFalse(last_trip["has_vacio"], "El nuevo viaje COD-2730951 no tiene vacío y debe ser el último viaje activo")

    def test_cleanup_color_f5f7fa(self):
        """Verifica que el color de limpieza sea #f5f7fa y sea reconocido correctamente."""
        self.assertEqual(CLEANUP_COLOR_HEX, "#f5f7fa")
        self.assertTrue(is_color_f5f7fa(CLEANUP_COLOR_RGB))
        # Debe coincidir con los valores RGB normalizados de #f5f7fa (245, 247, 250)
        self.assertAlmostEqual(CLEANUP_COLOR_RGB["red"], 245 / 255.0, places=4)
        self.assertAlmostEqual(CLEANUP_COLOR_RGB["green"], 247 / 255.0, places=4)
        self.assertAlmostEqual(CLEANUP_COLOR_RGB["blue"], 250 / 255.0, places=4)


if __name__ == "__main__":
    unittest.main()
