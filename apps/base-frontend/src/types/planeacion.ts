export type EstadoProceso = 'PREASIGNADO' | 'EN_ESPERA' | 'EN_PROCESO' | 'FINALIZADO';

export interface ProcesoNota {
  id?: string;
  usuario_id: string | null;
  usuario?: string | null;
  location?: string | null;
  texto: string;
  timestamp: string;
  edited_at?: string | null;
}

export interface UsuarioTallerSession {
  id: string;
  auth_user_id?: string;
  email?: string;
  nombre_usuario: string;
  box_id: string | null;
  box_name: string;
  zone_id: string | null;
  zone_name: string;
  rol?: 'taller' | 'coordinacion';
}

export interface UsuarioCoordinacionSession {
  id: string;
  auth_user_id?: string;
  email?: string;
  nombre_usuario: string;
  box_id: string | null;
  box_name: string;
  zone_id: string | null;
  zone_name: string;
  rol: 'coordinacion';
}

export interface PlaneacionHold {
  hold_id: string;
  unidad_id: string | null;
  n_ute: string;
  tractor_id: string | null;
  tractor_plate: string;
  semi_id: string | null;
  semi_plate: string;
  modalidad_tracking: 'EQUIPO_ACOPLADO' | 'SOLO_TRACTOR' | 'SOLO_SEMI' | 'UNIDAD';
  zone_id: string;
  zone_name: string;
  box_id: string | null;
  box_name: string;
  orden: number;
  usuarios_ids: string[];
  usuarios_nombres: string[];
  nota_planificacion: string | null;
  notes?: ProcesoNota[];
  proceso_origen_id?: string | null;
  created_at: string;
  updated_at: string;
  salida_previa_at?: string | null;
  salida_origen_box?: string | null;
  salida_origen_zone?: string | null;
  ultima_tarea?: string | null;
  ultima_tarea_usuario?: string | null;
  ultima_tarea_at?: string | null;
  en_proceso_activo?: boolean;
  ubicacion_actual_box?: string | null;
  ubicacion_actual_zone?: string | null;
}

export interface PlaneacionCard {
  proceso_id: string;
  unidad_id: string | null;
  n_ute: string;
  tractor_id: string | null;
  tractor_plate: string;
  semi_id: string | null;
  semi_plate: string;
  modalidad_tracking: 'EQUIPO_ACOPLADO' | 'SOLO_TRACTOR' | 'SOLO_SEMI' | 'UNIDAD';
  box_id: string;
  box_name: string;
  zone_id: string;
  zone_name: string;
  estado_proceso: EstadoProceso;
  llegada_at: string;
  inicio_at: string | null;
  salida_at: string | null;
  usuarios_ids: string[];
  usuarios_nombres: string[];
  notes: ProcesoNota[];
  salida_previa_at?: string | null;
  salida_origen_box?: string | null;
  salida_origen_zone?: string | null;
  ultima_tarea?: string | null;
  ultima_tarea_usuario?: string | null;
  ultima_tarea_at?: string | null;
  en_proceso_activo?: boolean;
  ubicacion_actual_box?: string | null;
  ubicacion_actual_zone?: string | null;
  etapa_ciclo?: 'HISTORICO_COLD' | 'ACTIVO_HOT' | 'PLANIFICADO_HOLD';
  hold_id?: string;
  orden?: number;
}

export interface PlaneacionUnidadDetalle {
  n_ute: string;
  tractor: string;
  marca_tr: string;
  modelo_tr: string;
  vtv_tr: string | null;
  mas_tr: string | null;
  semi: string;
  marca_semi: string;
  cisternado: string;
  vtv_semi: string | null;
  mas_semi: string | null;
  esp_es: string;
  vi: string;
  ve: string;
  servicio: string;
  estado_operativo: string;
}

export interface PlaneacionCatalog {
  zones: Array<{ id: string; zone_name: string }>;
  boxes: Array<{ id: string; box_name: string; zone_id: string; zone_name: string }>;
  usuarios: Array<{ id: string; nombre_usuario: string; box_id: string | null; box_name: string | null }>;
  unidades: Array<{
    unidad_id: string;
    n_ute: string;
    tractor_id: string | null;
    tractor_plate: string;
    semi_id: string | null;
    semi_plate: string;
  }>;
}

export interface BoardResponse {
  success: boolean;
  activos: PlaneacionCard[];
  holds?: PlaneacionHold[];
  catalog: PlaneacionCatalog;
  updatedAt: number;
}

export interface TrayectoriaStep {
  etapa_ciclo: 'HISTORICO_COLD' | 'ACTIVO_HOT' | 'PLANIFICADO_HOLD';
  estado_proceso: EstadoProceso;
  box_name: string;
  zone_name: string;
  orden: number | null;
  llegada_at: string | null;
  inicio_at: string | null;
  salida_at: string | null;
  duracion_espera_min: number | null;
  duracion_trabajo_min: number | null;
  duracion_total_min: number | null;
  usuarios_nombres: string[];
  nota_planificacion: string | null;
  notes_count: number;
  ultima_nota: string | null;
}

export interface ProcesoEvento {
  id: string;
  proceso_id: string | null;
  hold_id: string | null;
  box_name: string;
  zone_name: string;
  accion: string;
  etapa_origen: string;
  etapa_destino: string;
  llegada_at_snapshot: string | null;
  inicio_at_snapshot: string | null;
  salida_at_snapshot: string | null;
  actor_usuario_nombre: string | null;
  origen: string;
  metadata: Record<string, unknown>;
  evento_at: string;
}

export interface TrayectoriaResponse {
  success: boolean;
  historial: PlaneacionCard[];
  ubicacion_actual: PlaneacionCard[];
  recorrido_programado: PlaneacionHold[];
  timeline: TrayectoriaStep[];
  eventos?: ProcesoEvento[];
  queryMs: number;
}
