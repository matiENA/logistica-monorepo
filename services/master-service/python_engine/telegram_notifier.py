#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
  MÓDULO DE NOTIFICACIONES TELEGRAM PARA OPERATIVAS DIARIAS
================================================================================
Permite notificar alertas de fallos o confirmaciones de ejecución a un chat
o canal de Telegram sin dependencias externas (usa urllib nativo de Python).
"""

import os
import sys
import json
import html
import urllib.request
import urllib.parse
from datetime import datetime
from typing import Optional

# Configurar UTF-8 para consola en Windows
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


def send_telegram_message(text: str, parse_mode: str = "HTML") -> bool:
    """
    Envía un mensaje formateado a Telegram.
    Requiere las variables de entorno TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID.
    """
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "").strip()

    if not token or not chat_id:
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = json.dumps({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode,
        "disable_web_page_preview": True
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except Exception as e:
        print(f"[TELEGRAM] ⚠️ Error al enviar mensaje: {e}", file=sys.stderr)
        return False


def clean_error_message(raw_err: str) -> str:
    """
    Detecta y sanitiza respuestas HTML crudas (ej. errores 502/503 de Google Front End con tags y estilos CSS)
    transformándolas en mensajes legibles y claros para Telegram.
    """
    if not raw_err:
        return "Error no especificado"

    lower_err = raw_err.lower()

    # Error HTTP 502 Bad Gateway de Google
    if "502" in lower_err and ("that’s an error" in lower_err or "that's an error" in lower_err or "bad gateway" in lower_err or "<!doctype html>" in lower_err):
        return (
            "⚠️ Google Sheets API - HTTP 502 (Bad Gateway)\n"
            "El servidor proxy de Google encontró un error temporal y no pudo procesar la solicitud.\n"
            "Detalle: Micro-corte o saturación temporal en la red de Google Cloud.\n"
            "Acción: El sistema reintentará automáticamente con backoff exponencial."
        )

    # Error HTTP 503 Service Unavailable
    if "503" in lower_err and ("unavailable" in lower_err or "backend error" in lower_err or "that’s an error" in lower_err):
        return (
            "⚠️ Google Sheets API - HTTP 503 (Service Unavailable)\n"
            "El servicio de Google Sheets está temporalmente sobrecargado o en mantenimiento breve.\n"
            "Acción: El sistema reintentará en el próximo ciclo programado."
        )

    # Timeout de conexión
    if "timed out" in lower_err or "timeout" in lower_err:
        return (
            "⚠️ Timeout de Conexión con Google Sheets\n"
            "La consulta excedió el tiempo límite sin recibir respuesta del servidor.\n"
            "Acción: Reintentando en la siguiente ventana de polling."
        )

    # Si contiene etiquetas de estilo o HTML complejo, limpiar etiquetas y conservar solo texto
    if "<style" in lower_err or "<html" in lower_err:
        lines = [
            line.strip() for line in raw_err.splitlines()
            if line.strip() and not line.strip().startswith(("{", "}", "@", "<style", "</style", "background:", "width:", "height:", "display:"))
        ]
        cleaned = "\n".join(lines[:12])
        return cleaned or raw_err[:400]

    return raw_err


def notify_task_result(
    task_name: str,
    success: bool,
    duration: float,
    error_msg: str = "",
    output_preview: str = ""
) -> bool:
    """
    Notifica el resultado de una tarea operativa.
    Por defecto notifica SOLO SI HAY ERROR (para evitar saturación).
    Si TELEGRAM_NOTIFY_ALL es true, notifica también las ejecuciones exitosas.
    """
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        return False

    notify_all = os.getenv("TELEGRAM_NOTIFY_ALL", "false").lower() in ("true", "1", "yes")

    now_str = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

    if not success:
        raw_err = (error_msg or output_preview or "Error no especificado").strip()
        sanitized = clean_error_message(raw_err)
        clean_err = html.escape(sanitized)
        if len(clean_err) > 1000:
            clean_err = clean_err[-1000:]

        msg = (
            f"🚨 <b>FALLO EN OPERATIVA DIARIA</b>\n"
            f"━━━━━━━━━━━━━━━━━━━\n"
            f"⚙️ <b>Tarea:</b> <code>{task_name}</code>\n"
            f"⏱️ <b>Duración:</b> {duration}s\n"
            f"📅 <b>Fecha:</b> {now_str}\n"
            f"❌ <b>Error:</b>\n"
            f"<pre>{clean_err}</pre>"
        )
        return send_telegram_message(msg)

    elif notify_all:
        msg = (
            f"✅ <b>OPERATIVA COMPLETADA</b>\n"
            f"━━━━━━━━━━━━━━━━━━━\n"
            f"⚙️ <b>Tarea:</b> <code>{task_name}</code>\n"
            f"⏱️ <b>Duración:</b> {duration}s\n"
            f"📅 <b>Fecha:</b> {now_str}"
        )
        return send_telegram_message(msg)

    return False


if __name__ == "__main__":
    test_msg = sys.argv[1] if len(sys.argv) > 1 else "🧪 Mensaje de prueba desde terminal local."
    print("Probando envío a Telegram...")
    res = send_telegram_message(f"<b>Test de Notificación:</b>\n{test_msg}")
    if res:
        print("✅ Mensaje enviado exitosamente.")
    else:
        print("⚠️ No se pudo enviar el mensaje. Verifica TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID.")
