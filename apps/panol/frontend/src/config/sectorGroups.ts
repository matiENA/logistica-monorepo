export type SectorColumnId =
  | 'INACTIVOS'
  | 'SERVICIOS'
  | 'ENA'
  | 'MOTORES'
  | 'VTV_MASS'
  | 'TALLER';

export interface SectorColumnConfig {
  id: SectorColumnId;
  /** Título principal en la cabecera de columna */
  title: string;
  /** Subtítulo opcional con los rubros incluidos en la agrupación Fase 1 */
  subtitle?: string;
  /** Roles de panol.staff (normalizados a UPPERCASE) que caen en esta columna */
  staffRoles: string[];
  /** Fallback por [SECTOR] de la tarea cuando el rol del operario no es específico */
  taskSectors: string[];
}

/**
 * Agrupación de Columnas — Fase 1 (Orden fijo de izquierda a derecha)
 * 1. HACIENDO NADA (Inactivos con OT activa pero sin tarea EN_CURSO)
 * 2. LUBRICENTRO · ENGRASE · LAVADERO · GOMERIA
 * 3. ENA
 * 4. MOTORES (incluye CHAPA Y PINTURA)
 * 5. VTV · MASS
 * 6. TALLER (unifica ELECTRICIDAD, MECANICA, MECANICO y TALLER)
 */
export const SECTOR_COLUMNS: SectorColumnConfig[] = [
  {
    id: 'INACTIVOS',
    title: 'haciendo nada',
    subtitle: 'INACTIVOS',
    staffRoles: [],
    taskSectors: [],
  },
  {
    id: 'SERVICIOS',
    title: 'lubri · engr · lav · gom',
    subtitle: 'LUBRICENTRO · ENGRASE · LAVADERO · GOMERIA',
    staffRoles: ['LUBRICENTRO', 'ENGRASE', 'LAVADERO', 'GOMERIA'],
    taskSectors: ['LUBRICENTRO', 'ENGRASE', 'LAVADERO', 'GOMERIA'],
  },
  {
    id: 'ENA',
    title: 'ena',
    subtitle: 'ENA',
    staffRoles: ['ENA'],
    taskSectors: ['ENA', 'SEGUIMIENTO SATELITAL'],
  },
  {
    id: 'MOTORES',
    title: 'motores',
    subtitle: 'MOTORES · CHAPA Y PINTURA',
    staffRoles: ['MOTORES', 'CHAPA Y PINTURA'],
    taskSectors: ['MOTORES', 'CARROCERIA', 'CHAPA Y PINTURA'],
  },
  {
    id: 'VTV_MASS',
    title: 'vtv · mass',
    subtitle: 'VTV · MASS',
    staffRoles: ['VTV', 'MASS', 'VIAL'],
    taskSectors: ['VTV', 'MASS', 'VIAL'],
  },
  {
    id: 'TALLER',
    title: 'taller',
    subtitle: 'ELECTRICIDAD · MECANICA',
    staffRoles: ['TALLER', 'MECANICO', 'ELECTRICIDAD', 'MECANICA'],
    taskSectors: ['MECANICA', 'ELECTRICIDAD', 'TALLER'],
  },
];

/**
 * Resuelve en qué columna del Kanban debe ubicarse una unidad.
 * Regla Fase 1:
 * - Si no tiene tarea activa (en PROGRESO) ni tarea terminada con operario/sector (en TERMINADOS) -> 'INACTIVOS'
 * - Prioridad 1: role del operario en panol.staff (worker_role)
 * - Prioridad 2 (fallback): [SECTOR] de la tarea activa (active_task_sector)
 * - Fallback final si tiene tarea activa pero ningún rol/rubro coincide -> 'TALLER'
 */
export function resolveSectorColumn(params: {
  hasActiveTask: boolean;
  workerRole?: string | null;
  taskSector?: string | null;
}): SectorColumnId {
  if (!params.hasActiveTask) {
    return 'INACTIVOS';
  }

  const cleanRole = (params.workerRole || '').trim().toUpperCase();
  if (cleanRole) {
    const matchedByRole = SECTOR_COLUMNS.find(
      (col) => col.id !== 'INACTIVOS' && col.staffRoles.includes(cleanRole)
    );
    if (matchedByRole) {
      return matchedByRole.id;
    }
  }

  const cleanTaskSector = (params.taskSector || '').trim().toUpperCase();
  if (cleanTaskSector) {
    const matchedBySector = SECTOR_COLUMNS.find(
      (col) => col.id !== 'INACTIVOS' && col.taskSectors.includes(cleanTaskSector)
    );
    if (matchedBySector) {
      return matchedBySector.id;
    }
  }

  return 'TALLER';
}

/**
 * Formatea el arreglo default_boxes de panol.staff para mostrar en la card retraída
 */
export function formatDefaultBoxes(boxes?: string[] | null, fallbackUbicacion?: string | null): string {
  if (Array.isArray(boxes) && boxes.length > 0) {
    const clean = boxes.map((b) => String(b || '').trim()).filter(Boolean);
    if (clean.length > 0) {
      return clean
        .map((b) => (/^\d+$/.test(b) ? `Box ${b}` : b))
        .join(' · ');
    }
  }
  if (fallbackUbicacion && fallbackUbicacion.trim()) {
    return fallbackUbicacion.trim();
  }
  return '—';
}
