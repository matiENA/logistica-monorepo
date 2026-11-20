import { create } from 'zustand';
import { VistaTab, SesionUsuario, Novedad, TerminalItem, ServicioChoferItem, TipoNovedadItem } from '../types/dash';

interface DashState {
  // Navegación de Vistas
  vistaActual: VistaTab;
  setVistaActual: (vista: VistaTab) => void;

  // Modo Cartelera / TV
  modoCartelera: boolean;
  modoCarteleraOrigen: 'manual' | 'idle';
  vistaPreviaAntesDeCartelera: VistaTab | null;
  setModoCartelera: (activo: boolean, options?: { persistir?: boolean; origen?: 'manual' | 'idle' }) => void;
  toggleModoCartelera: () => void;

  // Modo Oscuro / Claro
  darkMode: boolean;
  toggleDarkMode: () => void;
  setDarkMode: (isDark: boolean) => void;

  // Autenticación de Usuario
  sesion: SesionUsuario | null;
  setSesion: (sesion: SesionUsuario | null) => void;
  cerrarSesion: () => void;

  // Filtros
  busqueda: string;
  setBusqueda: (busqueda: string) => void;
  filtroTerminal: string;
  setFiltroTerminal: (terminal: string) => void;

  // Modales y Edición
  modalNuevaAbierto: boolean;
  setModalNuevaAbierto: (abierto: boolean) => void;
  novedadEnEdicion: Novedad | null;
  setNovedadEnEdicion: (novedad: Novedad | null) => void;

  // Anchos proporcionales de columnas (Splitters)
  columnWidths: Record<string, number>;
  setColumnWidth: (colKey: string, weight: number) => void;
  resetColumnWidth: (colKey: string) => void;

  // Catálogo de Terminales
  terminales: TerminalItem[];
  setTerminales: (terminales: TerminalItem[]) => void;

  // Catálogo de Servicios de Choferes
  servicios: ServicioChoferItem[];
  setServicios: (servicios: ServicioChoferItem[]) => void;

  // Catálogo de Tipos de Novedad
  tiposNovedad: TipoNovedadItem[];
  setTiposNovedad: (tipos: TipoNovedadItem[]) => void;

  // Drag and Drop (Service Drop Overlay)
  activeDragCardId: string | number | null;
  setActiveDragCardId: (id: string | number | null) => void;
  overlayServiceAbierto: boolean;
  setOverlayServiceAbierto: (abierto: boolean) => void;
}

const getStoredSession = (): SesionUsuario | null => {
  try {
    const data = localStorage.getItem('dash_user');
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
};

const getStoredColumnWidths = (): Record<string, number> => {
  try {
    const str = localStorage.getItem('column_section_widths');
    return str ? JSON.parse(str) : {};
  } catch {
    return {};
  }
};

const getInitialDarkMode = (): boolean => {
  try {
    if (typeof window === 'undefined') return true;
    const theme = localStorage.getItem('theme');
    if (theme === 'light') return false;
    if (theme === 'dark') return true;
    return true; // Predeterminado Dark Mode
  } catch {
    return true;
  }
};

export const useDashStore = create<DashState>((set, get) => ({
  vistaActual: 'todas',
  setVistaActual: (vista) => set({ vistaActual: vista }),

  modoCartelera: typeof window !== 'undefined' ? localStorage.getItem('modo_cartelera') === 'true' : false,
  modoCarteleraOrigen: 'manual',
  vistaPreviaAntesDeCartelera: null,
  setModoCartelera: (activo, options) => {
    const persistir = options?.persistir ?? true;
    const origen = options?.origen ?? 'manual';

    if (persistir && typeof window !== 'undefined') {
      try {
        localStorage.setItem('modo_cartelera', activo ? 'true' : 'false');
        localStorage.setItem('vista_solida', activo ? 'true' : 'false');
      } catch {}
    }

    if (typeof document !== 'undefined') {
      if (activo) {
        document.documentElement.classList.add('modo-cartelera', 'vista-solida');
      } else {
        document.documentElement.classList.remove('modo-cartelera', 'vista-solida');
      }
    }

    set((state) => {
      if (activo) {
        const guardarVistaPrevia = origen === 'idle' && state.vistaActual !== 'todas';
        const vistaActual = guardarVistaPrevia ? 'todas' : state.vistaActual;
        const vistaPreviaAntesDeCartelera = guardarVistaPrevia
          ? state.vistaActual
          : origen === 'manual'
          ? null
          : state.vistaPreviaAntesDeCartelera;

        return {
          modoCartelera: true,
          modoCarteleraOrigen: origen,
          vistaActual,
          vistaPreviaAntesDeCartelera
        };
      }

      return {
        modoCartelera: false,
        modoCarteleraOrigen: 'manual',
        vistaActual: state.vistaPreviaAntesDeCartelera ?? state.vistaActual,
        vistaPreviaAntesDeCartelera: null
      };
    });
  },
  toggleModoCartelera: () => {
    const actual = get().modoCartelera;
    get().setModoCartelera(!actual, { persistir: true, origen: 'manual' });
  },

  darkMode: getInitialDarkMode(),
  toggleDarkMode: () =>
    set((state) => {
      const nuevo = !state.darkMode;
      try {
        localStorage.setItem('theme', nuevo ? 'dark' : 'light');
      } catch {}
      if (nuevo) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      return { darkMode: nuevo };
    }),
  setDarkMode: (nuevo: boolean) => {
    try {
      localStorage.setItem('theme', nuevo ? 'dark' : 'light');
    } catch {}
    if (nuevo) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    set({ darkMode: nuevo });
  },

  sesion: getStoredSession(),
  setSesion: (sesion) => {
    if (sesion) {
      localStorage.setItem('dash_user', JSON.stringify(sesion));
    } else {
      localStorage.removeItem('dash_user');
    }
    set({ sesion });
  },
  cerrarSesion: () => {
    localStorage.removeItem('dash_user');
    set({ sesion: null });
  },

  busqueda: '',
  setBusqueda: (busqueda) => set({ busqueda }),
  filtroTerminal: '',
  setFiltroTerminal: (filtroTerminal) => set({ filtroTerminal }),

  modalNuevaAbierto: false,
  setModalNuevaAbierto: (modalNuevaAbierto) => set({ modalNuevaAbierto }),
  novedadEnEdicion: null,
  setNovedadEnEdicion: (novedadEnEdicion) => set({ novedadEnEdicion, modalNuevaAbierto: !!novedadEnEdicion }),

  columnWidths: getStoredColumnWidths(),
  setColumnWidth: (colKey, weight) =>
    set((state) => {
      const updated = { ...state.columnWidths, [colKey]: weight };
      localStorage.setItem('column_section_widths', JSON.stringify(updated));
      return { columnWidths: updated };
    }),
  resetColumnWidth: (colKey) =>
    set((state) => {
      const updated = { ...state.columnWidths };
      delete updated[colKey];
      localStorage.setItem('column_section_widths', JSON.stringify(updated));
      return { columnWidths: updated };
    }),

  terminales: [],
  setTerminales: (terminales) => set({ terminales }),

  servicios: [],
  setServicios: (servicios) => set({ servicios }),

  tiposNovedad: [],
  setTiposNovedad: (tiposNovedad) => set({ tiposNovedad }),

  activeDragCardId: null,
  setActiveDragCardId: (id) => set({ activeDragCardId: id, overlayServiceAbierto: !!id }),
  overlayServiceAbierto: false,
  setOverlayServiceAbierto: (overlayServiceAbierto) => set({ overlayServiceAbierto })
}));
