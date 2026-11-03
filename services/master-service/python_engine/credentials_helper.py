"""
credentials_helper.py
Helper centralizado y resiliente para autenticación con Google Cloud en entornos locales y Cloud (Render).
Soporta:
1. Variable de entorno GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_CREDENTIALS_JSON (JSON string o Base64).
2. Variable de entorno GOOGLE_SERVICE_ACCOUNT_FILE / GOOGLE_APPLICATION_CREDENTIALS.
3. Archivos locales en ./gs account/, ./credentials.json, ./ute-logistica-key.json.
4. Rutas estándar en Desktop para compatibilidad local con Windows.
"""
import os
import json
import base64
import socket
from pathlib import Path
from typing import Optional, List
from google.oauth2.service_account import Credentials

# Prevenir caídas por timeout de 60s en llamadas pesadas a Google Sheets
socket.setdefaulttimeout(180)

DEFAULT_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]

BASE_DIR = Path(__file__).resolve().parent

def get_google_credentials(scopes: Optional[List[str]] = None) -> Credentials:
    """
    Obtiene las credenciales de Google Service Account priorizando variables de entorno de nube
    y retrocediendo limpiamente a archivos locales o de desarrollo.
    """
    scopes = scopes or DEFAULT_SCOPES

    # 1. Variable de entorno con el JSON en texto o base64 (Estándar de Render)
    raw_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON") or os.getenv("GOOGLE_CREDENTIALS_JSON")
    if raw_json and raw_json.strip():
        raw_str = raw_json.strip()
        # Eliminar posibles comillas externas
        if (raw_str.startswith("'") and raw_str.endswith("'")) or (raw_str.startswith('"') and raw_str.endswith('"')):
            raw_str = raw_str[1:-1].strip()

        info = None
        try:
            info = json.loads(raw_str)
        except Exception:
            try:
                decoded = base64.b64decode(raw_str).decode("utf-8")
                info = json.loads(decoded)
            except Exception as e:
                print(f"[credentials_helper] Advertencia: Error al parsear JSON desde GOOGLE_SERVICE_ACCOUNT_JSON: {e}")

        if info and isinstance(info, dict):
            if "private_key" in info and "\\n" in info["private_key"]:
                info["private_key"] = info["private_key"].replace("\\n", "\n")
            return Credentials.from_service_account_info(info, scopes=scopes)

    # 2. Variable de entorno con ruta de archivo
    file_env = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE") or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if file_env and Path(file_env).exists():
        return Credentials.from_service_account_file(file_env, scopes=scopes)

    # 3. Buscar en el directorio del proyecto
    local_candidates = [
        BASE_DIR / "credentials.json",
        BASE_DIR / "ute-logistica-key.json",
        BASE_DIR / "gs account"
    ]
    for cand in local_candidates:
        if cand.is_file():
            return Credentials.from_service_account_file(str(cand), scopes=scopes)
        if cand.is_dir():
            for f in cand.glob("*.json"):
                return Credentials.from_service_account_file(str(f), scopes=scopes)

    # 4. Búsqueda en rutas de desarrollo local (Desktop)
    desktop_candidates = [
        Path.home() / "Desktop" / "gs account",
        Path.home() / "Desktop"
    ]
    for folder in desktop_candidates:
        if folder.exists():
            for f in folder.glob("*adminsdk*.json"):
                return Credentials.from_service_account_file(str(f), scopes=scopes)
            for f in folder.glob("*.json"):
                if "ute-logistica" in f.name.lower() or "firebase" in f.name.lower():
                    return Credentials.from_service_account_file(str(f), scopes=scopes)

    # 5. Ruta predeterminada histórica si existe
    fallback_path = Path(r"C:\Users\Matias Rodriguez\Desktop\gs account\ute-logistica-firebase-adminsdk-fbsvc-04f3a4a36e.json")
    if fallback_path.exists():
        return Credentials.from_service_account_file(str(fallback_path), scopes=scopes)

    raise FileNotFoundError(
        "No se encontraron credenciales de Google Service Account. "
        "Configura la variable de entorno GOOGLE_SERVICE_ACCOUNT_JSON en Render o coloca el archivo credentials.json."
    )

def resolve_credentials_file() -> str:
    """Para compatibilidad con funciones que requieran la ruta del archivo."""
    file_env = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE") or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if file_env and Path(file_env).exists():
        return file_env

    # Si existe variable con el contenido JSON en memoria, guardarlo a disco para herramientas que requieran archivo físico
    raw_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON") or os.getenv("GOOGLE_CREDENTIALS_JSON")
    if raw_json and raw_json.strip():
        runtime_file = BASE_DIR / ".service_account_runtime.json"
        try:
            raw_str = raw_json.strip()
            if (raw_str.startswith("'") and raw_str.endswith("'")) or (raw_str.startswith('"') and raw_str.endswith('"')):
                raw_str = raw_str[1:-1].strip()
            try:
                decoded = base64.b64decode(raw_str).decode("utf-8")
                if "private_key" in decoded:
                    raw_str = decoded
            except Exception:
                pass
            if not runtime_file.exists() or runtime_file.stat().st_size == 0:
                runtime_file.write_text(raw_str, encoding="utf-8")
            return str(runtime_file)
        except Exception as e:
            print(f"[credentials_helper] Advertencia al escribir runtime JSON: {e}")

    candidates = [
        BASE_DIR / "credentials.json",
        BASE_DIR / "ute-logistica-key.json",
        BASE_DIR / "gs account"
    ]
    for cand in candidates:
        if cand.is_file():
            return str(cand)
        if cand.is_dir():
            for f in cand.glob("*.json"):
                return str(f)

    desktop_candidates = [
        Path.home() / "Desktop" / "gs account",
        Path.home() / "Desktop"
    ]
    for folder in desktop_candidates:
        if folder.exists():
            for f in folder.glob("*adminsdk*.json"):
                return str(f)
            for f in folder.glob("*.json"):
                if "ute-logistica" in f.name.lower() or "firebase" in f.name.lower():
                    return str(f)

    fallback_path = Path(r"C:\Users\Matias Rodriguez\Desktop\gs account\ute-logistica-firebase-adminsdk-fbsvc-04f3a4a36e.json")
    if fallback_path.exists():
        return str(fallback_path)

    return str(BASE_DIR / "credentials.json")

