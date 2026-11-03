"""
Configuración centralizada para la sincronización de Viajes Cordillera hacia SEGURIDA VIAL.
"""
import os
import re
from pathlib import Path

# Directorio raíz del proyecto
BASE_DIR = Path(__file__).resolve().parent

try:
    from config_operativas import load_config
    _operativas_cfg = load_config()
    _mes_act = _operativas_cfg.get("mes_actual", {})
except Exception:
    _mes_act = {}

# Búsqueda inteligente del archivo de credenciales de Google Service Account
def resolve_credentials_file() -> str:
    # 1. Variable de entorno explícita
    env_file = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE")
    if env_file and Path(env_file).exists():
        return env_file

    # 2. Archivo en la carpeta local del proyecto o subcarpeta gs account
    for json_file in BASE_DIR.glob("*adminsdk*.json"):
        return str(json_file)
    project_gs = BASE_DIR / "gs account"
    if project_gs.exists():
        for json_file in project_gs.glob("*.json"):
            return str(json_file)

    # 3. Carpeta 'gs account' en el Escritorio del usuario actual
    desktop_gs = Path.home() / "Desktop" / "gs account"
    if desktop_gs.exists():
        for json_file in desktop_gs.glob("*.json"):
            return str(json_file)

    # 4. Ruta predeterminada histórica si existe
    default_path = Path(r"C:\Users\Matias Rodriguez\Desktop\gs account\ute-logistica-firebase-adminsdk-fbsvc-04f3a4a36e.json")
    if default_path.exists():
        return str(default_path)

    return None

SERVICE_ACCOUNT_FILE = resolve_credentials_file()

# IDs de Google Spreadsheet según el módulo correspondiente
SEGURIDAD_VIAL_SPREADSHEET_ID = os.getenv(
    "SEGURIDAD_VIAL_SPREADSHEET_ID",
    _mes_act.get("ruteos_id", "1oIadEZE1vXCOaTjj8USAOAYVwibY5XMfmCaJbp0bqZE")
)

CONF_SPREADSHEET_ID = os.getenv(
    "CONF_SPREADSHEET_ID",
    os.getenv("SPREADSHEET_ID", _mes_act.get("conf_viaje_id", "1bK99AJp7O1jluupQeM5lsH8Gu5QfT--HXWTNzMft9tU"))
)

# ID del Google Spreadsheet principal por compatibilidad histórica
DEFAULT_SPREADSHEET_ID = SEGURIDAD_VIAL_SPREADSHEET_ID

# Carpeta raíz en Google Drive (Ruteos LIVIANO)
DRIVE_ROOT_FOLDER_ID = os.getenv(
    "DRIVE_ROOT_FOLDER_ID",
    "1qpXukDfaovrVltV74NL9WpBzr1Ig916z"
)

# Nombres de las pestañas
SOURCE_SHEET_NAME = os.getenv("SOURCE_SHEET_NAME", _mes_act.get("tab_ruteos", "Ruteos"))
TARGET_SHEET_NAME = os.getenv("TARGET_SHEET_NAME", "SEGURIDA VIAL")

# Columnas declaradas a extraer (en orden específico requerido por el usuario)
TARGET_COLUMNS_LETTERS = [
    "A", "B", "C", "D", "H", "I", "J", "K", "L",
    "N", "S", "T", "X", "AD", "AE", "AF", "AG",
    "AI", "AJ", "AK", "AL", "AP"
]

# Encabezados limpios y descriptivos para la fila 1 de SEGURIDA VIAL
TARGET_COLUMNS_HEADERS = [
    "TRACTOR",
    "N° UT",
    "SEMI",
    "CHOFER",
    "TRACKING",
    "Marca Temp - Respuesta",
    "VIAJE",
    "LLEGADA A PLANTA",
    "TD",
    "FACTURACIÓN",
    "LLEGADA(ETA)",
    "EVENTO (ETA)",
    "VACIO",
    "DESTINO",
    "PRODUCTO",
    "CANTIDAD",
    "CISTERNADO SUGERIDO",
    "CARGA TOTAL",
    "CISTERNADO",
    "FECHA PLANIFICADA",
    "Localidad de Ruteo",
    "Estado"
]

# Columna clave / índice que agrupa el viaje completo
INDEX_COLUMN_LETTER = "L"

# Localidades de Cordillera declaradas
CORDILLERA_LOCATIONS = [
    "JUNIN",
    "PDA",
    "SAN MARTIN",
    "ALUMINE",
    "BARILOCHE",
    "BOLSON",
    "LAGO PUELO",
    "VILLA LA ANGOSTURA",
    "EL HOYO",
    "EPUYEN",
    "MASCARDI",
    "CUSHAMEN",
    "CAVIAHUE",
    "CHOLAR",
    "HUECU",
    "LAS LAJAS",
    "LONCOPUE",
    "ZAPALA",
    "ANDACOLLO",
    "CHOSMALAL",
    "VILLA PEHUENIA"
]

# Conversor de letras de columna de Excel a índice 0-based
def col_letter_to_index(col_letter: str) -> int:
    """Convierte letras de columna (A -> 0, B -> 1, Z -> 25, AA -> 26, etc.) a índice 0-based."""
    idx = 0
    for char in col_letter.strip().upper():
        idx = idx * 26 + (ord(char) - ord('A') + 1)
    return idx - 1

# Índices 0-based de las columnas objetivo
TARGET_COLUMNS_INDICES = [col_letter_to_index(c) for c in TARGET_COLUMNS_LETTERS]
INDEX_COLUMN_0BASED = col_letter_to_index(INDEX_COLUMN_LETTER) # 11 (Col L)
LOCALITY_COLUMN_0BASED = col_letter_to_index("AL")             # 37 (Col AL)
DESTINATION_COLUMN_0BASED = col_letter_to_index("AD")          # 29 (Col AD)

# Expresión regular para coincidencia exacta de palabras límite
# Maneja mayúsculas, minúsculas y tildes comunes
def build_location_regex():
    """Construye un patrón regex compilado para detectar las locaciones con límite de palabra."""
    escaped_patterns = []
    for loc in CORDILLERA_LOCATIONS:
        # Permite variantes con o sin tilde si aplican
        pat = re.escape(loc)
        escaped_patterns.append(pat)
    pattern_str = r'\b(' + '|'.join(escaped_patterns) + r')\b'
    return re.compile(pattern_str, re.IGNORECASE)

LOCATION_REGEX = build_location_regex()

# Archivo local de persistencia para el estado de la última sincronización
STATE_FILE = BASE_DIR / "last_sync_result.json"

# Intervalo por defecto de sincronización periódica (en segundos)
DEFAULT_SYNC_INTERVAL_SECONDS = 300  # 5 minutos

# ==============================================================================
# CONFIGURACIÓN ESPECÍFICA: UTE Cordillera ➡️ CONF. DE VIAJE (Alerta ⚠️)
# ==============================================================================
CONF_SOURCE_SHEET_NAME = os.getenv(
    "CONF_SOURCE_SHEET_NAME",
    os.getenv("CONF_SOURCE_TAB", _mes_act.get("tab_conf_source", "UTE Cordillera Noviembre 26"))
)
CONF_TARGET_SHEET_NAME = os.getenv(
    "CONF_TARGET_SHEET_NAME",
    os.getenv("CONF_TARGET_TAB", _mes_act.get("tab_conf_target", "CONF. DE VIAJE NOVIEMBRE 26"))
)
CONF_START_ROW = 5  # Los datos se escriben a partir de la fila 5

# Mapeo de columnas: (Columna Origen en UTE Cordillera, Columna Destino en CONF. DE VIAJE, Título Semántico)
# T -> A, D -> B, I -> C, A -> D, G -> E, U -> F, N -> G (limpiado), Q -> H, K -> I, L -> J
CONF_COLUMN_MAPPINGS = [
    ("T", "A", "FECHA PLANIFICADA"),
    ("D", "B", "Chofer"),
    ("I", "C", "N° DE DESPACHO"),
    ("A", "D", "TRACTOR"),
    ("G", "E", "TERMINAL"),
    ("U", "F", "Localidad de Ruteo"),
    ("N", "G", "CLIENTE"),
    ("Q", "H", "Configuración "),
    ("K", "I", "Llegada a ETA"),
    ("L", "J", "Cambio de cisternado / Derivación"),
]

# Índices 0-based calculados para el mapeo: [(origen_idx, destino_idx, nombre), ...]
CONF_COLUMN_INDICES = [
    (col_letter_to_index(src), col_letter_to_index(dst), label)
    for src, dst, label in CONF_COLUMN_MAPPINGS
]

# Clave de filtrado (Col F) y símbolo buscado
CONF_FILTER_KEY_COL = "F"
CONF_FILTER_KEY_INDEX = col_letter_to_index(CONF_FILTER_KEY_COL)  # 5 (Col F: Marca Temp - Respuesta)
CONF_FILTER_SYMBOL = "⚠️"

# Columna índice de agrupación por viaje (Col I = TD)
CONF_TRIP_ID_COL = "I"
CONF_TRIP_ID_INDEX = col_letter_to_index(CONF_TRIP_ID_COL)  # 8

# Archivo de persistencia de estado para CONF. DE VIAJE
CONF_STATE_FILE = BASE_DIR / "last_sync_conf_viaje.json"

