#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
  GESTOR DE ESTADOS OPERATIVOS EN GOOGLE DRIVE (PERSISTENCIA MULTI-ENTORNO)
================================================================================
Descripción:
  Centraliza la lectura y escritura de los estados operativos mensuales en la
  carpeta compartida de Google Drive:
    Folder ID: 18E_m8Ye5dp5xv2oCmYhEm8Ts7eeA7y8- ('ruteos reportes')
    URL: https://drive.google.com/drive/folders/18E_m8Ye5dp5xv2oCmYhEm8Ts7eeA7y8-

  Permite que tanto el entorno local (n8n en localhost:5678) como Render Cloud
  (servicio en la nube cuando la PC del usuario esté inactiva) compartan la
  misma fuente de verdad para el tracking de Col H, vacíos y seguimiento celeste.

Estructura compacta:
  - Almacena ÚNICAMENTE celdas con merge activo (sin filas vacías).
  - Incluye el texto de Columna H (tracking_text) para detección O(1) de cambios.
  - Soporte híbrido: si Google Drive falla por cuota o red, recurre
    transparentemente a la caché local en disco sin detener el flujo.
================================================================================
"""

import os
import sys
import json
import io
import time
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, Tuple, List

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

from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload, MediaIoBaseDownload
from googleapiclient.errors import HttpError
from credentials_helper import get_google_credentials

# Carpeta de Google Drive compartida por defecto
DEFAULT_DRIVE_FOLDER_ID = "18E_m8Ye5dp5xv2oCmYhEm8Ts7eeA7y8-"
DRIVE_FOLDER_ID = os.getenv("DRIVE_FOLDER_REPORTES_ID", DEFAULT_DRIVE_FOLDER_ID)

BASE_DIR = Path(__file__).resolve().parent
LOCAL_CACHE_DIR = BASE_DIR / "cache_drive_states"
LOCAL_CACHE_DIR.mkdir(parents=True, exist_ok=True)

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.file"
]


class DriveStateManager:
    """Administra la sincronización bidireccional de JSON de estado con Google Drive."""

    def __init__(self, folder_id: str = DRIVE_FOLDER_ID):
        self.folder_id = folder_id
        self._creds = get_google_credentials(scopes=SCOPES)
        self._service = build("drive", "v3", credentials=self._creds)
        self._file_id_cache: Dict[str, str] = {}
        self._memory_cache: Dict[str, Dict[str, Any]] = {}
        self._cache_ts: Dict[str, float] = {}

    @staticmethod
    def get_monthly_filename(month_name: str, year: int = 2026) -> str:
        """Genera el nombre canónico del archivo de estado mensual."""
        clean_month = month_name.lower().split()[0].replace("-", "_")
        clean_month = clean_month.replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u")
        return f"estado_operativo_{clean_month}_{year}.json"

    def get_file_metadata(self, filename: str) -> Optional[Dict[str, Any]]:
        """Busca un archivo por nombre dentro de la carpeta objetivo de Google Drive."""
        query = f"'{self.folder_id}' in parents and name = '{filename}' and trashed = false"
        try:
            res = self._service.files().list(
                q=query,
                spaces="drive",
                fields="files(id, name, mimeType, modifiedTime, md5Checksum, size)",
                supportsAllDrives=True,
                includeItemsFromAllDrives=True
            ).execute()
            files = res.get("files", [])
            if files:
                file_info = files[0]
                self._file_id_cache[filename] = file_info["id"]
                return file_info
            return None
        except Exception as e:
            print(f"[WARN drive_state_manager] Error buscando {filename} en Drive: {e}")
            return None

    def read_json_from_drive(
        self,
        filename: str,
        max_cache_age_seconds: int = 300
    ) -> Optional[Dict[str, Any]]:
        """
        Lee el archivo JSON desde Google Drive.
        Utiliza memoria o caché local en disco si tiene menos de `max_cache_age_seconds`
        para garantizar lecturas ultrarrápidas (< 2 ms) en ciclos frecuentes de 2 minutos.
        """
        now = time.time()
        # 1. Chequeo de memoria
        if filename in self._memory_cache and (now - self._cache_ts.get(filename, 0)) < max_cache_age_seconds:
            return self._memory_cache[filename]

        local_file = LOCAL_CACHE_DIR / filename

        # 2. Chequeo de frescura de caché local en disco
        if local_file.exists():
            file_age = now - local_file.stat().st_mtime
            if file_age < max_cache_age_seconds:
                try:
                    with open(local_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        self._memory_cache[filename] = data
                        self._cache_ts[filename] = now
                        return data
                except Exception:
                    pass

        # 3. Búsqueda en Google Drive
        meta = self.get_file_metadata(filename)
        if not meta:
            # Si no existe en Drive pero existe en local, fallback
            if local_file.exists():
                try:
                    with open(local_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        self._memory_cache[filename] = data
                        self._cache_ts[filename] = now
                        return data
                except Exception:
                    pass
            return None

        file_id = meta["id"]
        try:
            request = self._service.files().get_media(fileId=file_id, supportsAllDrives=True)
            fh = io.BytesIO()
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()

            content_bytes = fh.getvalue()
            content_str = content_bytes.decode("utf-8")
            data = json.loads(content_str)

            # Actualizar memoria y caché local
            self._memory_cache[filename] = data
            self._cache_ts[filename] = now
            with open(local_file, "w", encoding="utf-8") as f:
                f.write(content_str)

            return data
        except Exception as e:
            print(f"[WARN drive_state_manager] Error descargando {filename} de Drive ({file_id}): {e}")
            if local_file.exists():
                try:
                    with open(local_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        self._memory_cache[filename] = data
                        self._cache_ts[filename] = now
                        return data
                except Exception:
                    pass
            return None

    def save_json_to_drive(
        self,
        filename: str,
        data: Dict[str, Any],
        caller: str = "local_n8n"
    ) -> Optional[str]:
        """
        Guarda o actualiza un archivo JSON en la carpeta de Google Drive y actualiza la caché local.
        Retorna el fileId del archivo en Drive (o 'local_cached' si falló por cuota remota).
        """
        # Actualizar metadatos
        now_iso = datetime.utcnow().isoformat() + "Z"
        if "metadata" not in data:
            data["metadata"] = {}
        data["metadata"]["ultima_actualizacion"] = now_iso
        data["metadata"]["origen_escritura"] = caller

        celdas = data.get("celdas_merge", {})
        total_cells = sum(len(c_dict) for c_dict in celdas.values() if isinstance(c_dict, dict))
        data["metadata"]["total_celdas_activas"] = total_cells

        content_str = json.dumps(data, indent=2, ensure_ascii=False)
        content_bytes = content_str.encode("utf-8")
        media = MediaIoBaseUpload(io.BytesIO(content_bytes), mimetype="application/json", resumable=False)

        local_file = LOCAL_CACHE_DIR / filename
        # 1. Guardar en memoria y local inmediatamente
        self._memory_cache[filename] = data
        self._cache_ts[filename] = time.time()
        try:
            with open(local_file, "w", encoding="utf-8") as f:
                f.write(content_str)
        except Exception as e:
            print(f"[WARN drive_state_manager] Error guardando copia local de {filename}: {e}")

        # 2. Determinar si ya existe en Drive
        file_id = self._file_id_cache.get(filename)
        if not file_id:
            meta = self.get_file_metadata(filename)
            file_id = meta["id"] if meta else None

        try:
            if file_id:
                # Actualizar archivo existente en Drive
                updated_file = self._service.files().update(
                    fileId=file_id,
                    media_body=media,
                    fields="id, name, modifiedTime, md5Checksum",
                    supportsAllDrives=True
                ).execute()
                print(f"[DRIVE] [OK] Estado remoto '{filename}' actualizado con exito en Google Drive (ID: {file_id}).")
                return updated_file.get("id")
            else:
                # Crear nuevo archivo en la carpeta
                file_metadata = {
                    "name": filename,
                    "parents": [self.folder_id],
                    "mimeType": "application/json"
                }
                new_file = self._service.files().create(
                    body=file_metadata,
                    media_body=media,
                    fields="id, name, modifiedTime",
                    supportsAllDrives=True
                ).execute()
                new_id = new_file.get("id")
                self._file_id_cache[filename] = new_id
                print(f"[DRIVE] [OK] Archivo '{filename}' creado con exito en Google Drive (ID: {new_id}).")
                return new_id
        except HttpError as e:
            err_str = str(e)
            if "storageQuotaExceeded" in err_str:
                print(
                    f"[DRIVE-INFO] ℹ️ Subida a Google Drive pausada: la Service Account no tiene cuota propia de creación.\n"
                    f"             El archivo '{filename}' ya fue persistido correctamente en disco local:\n"
                    f"             -> {local_file}\n"
                    f"             Para habilitar sincronización remota continua (con Render Cloud), arrastre o suba ese archivo\n"
                    f"             a la carpeta de Drive: https://drive.google.com/drive/folders/{self.folder_id}\n"
                    f"             Una vez subido una vez por su usuario, el sistema lo actualizará automáticamente sin límite."
                )
            else:
                print(f"[DRIVE-WARN] Error HTTP guardando {filename} en Google Drive: {e}")
            return "local_cached"
        except Exception as e:
            print(f"[ERROR drive_state_manager] Error guardando {filename} en Google Drive: {e}")
            return "local_cached"

    def get_or_create_monthly_state(self, month_name: str, year: int = 2026) -> Dict[str, Any]:
        """Obtiene el estado mensual de Drive/local o crea una estructura base."""
        filename = self.get_monthly_filename(month_name, year)
        state = self.read_json_from_drive(filename)
        if state and isinstance(state, dict) and "celdas_merge" in state:
            return state

        # Inicializar estructura canónica
        state = {
            "metadata": {
                "mes_nombre": f"{month_name.capitalize()} {year}",
                "ultima_actualizacion": datetime.utcnow().isoformat() + "Z",
                "origen_escritura": "inicial",
                "total_celdas_activas": 0
            },
            "ultimo_estado_tractores": {},
            "celdas_merge": {}
        }
        self.save_json_to_drive(filename, state, caller="init")
        return state

    def get_octubre_frozen_state(self) -> Dict[str, Any]:
        """Obtiene el estado congelado de Octubre 2026 de forma ultrarrápida (< 1 ms)."""
        filename = self.get_monthly_filename("Octubre", 2026)
        state = self.read_json_from_drive(filename, max_cache_age_seconds=86400 * 30)
        if state and "ultimo_estado_tractores" in state:
            return state
        # Fallback a local
        local_path = LOCAL_CACHE_DIR / filename
        if local_path.exists():
            with open(local_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return {"metadata": {"mes_nombre": "Octubre 2026"}, "ultimo_estado_tractores": {}, "celdas_merge": {}}

    @staticmethod
    def compute_cell_hash(vacio_header: str, tracking_text: str, borde_doble: bool, color_celeste: bool) -> str:
        """Calcula el hash SHA-256 de los atributos de la celda con merge."""
        raw = f"{vacio_header.strip()}|{tracking_text.strip()}|{borde_doble}|{color_celeste}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()
