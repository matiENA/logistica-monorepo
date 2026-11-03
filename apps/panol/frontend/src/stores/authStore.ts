import { create } from 'zustand';
import { StaffUser } from '../types';

interface AuthState {
  token: string | null;
  deviceToken: string | null;
  isDeviceAuthorized: boolean;
  user: StaffUser | null;
  activeBox: string;
  isAuthenticated: boolean;

  // Acciones de autenticación en 2 capas (Dispositivo 90D vs Operario)
  authorizeDevice: (token: string) => void;
  deauthorizeDevice: () => void;
  loginUser: (user: StaffUser) => void;
  logoutUser: () => void;

  // Métodos retrocompatibles
  login: (token: string, user: StaffUser) => void;
  logout: () => void;
  setActiveBox: (box: string) => void;
}

export const useAuthStore = create<AuthState>((set) => {
  const savedToken = typeof window !== 'undefined' 
    ? (localStorage.getItem('sys_device_token') || localStorage.getItem('sys_auth_token')) 
    : null;
  
  const savedDeviceOk = typeof window !== 'undefined'
    ? (localStorage.getItem('sys_device_ok') === '1' || localStorage.getItem('sys_auth_ok') === '1' || !!savedToken)
    : false;

  const savedUserJson = typeof window !== 'undefined' ? localStorage.getItem('sys_auth_user') : null;
  let savedUser: StaffUser | null = null;
  try {
    savedUser = savedUserJson ? JSON.parse(savedUserJson) : null;
  } catch (e) {
    savedUser = null;
  }

  const savedBox = typeof window !== 'undefined' ? localStorage.getItem('sys_active_box') || '01' : '01';

  return {
    token: savedToken,
    deviceToken: savedToken,
    isDeviceAuthorized: savedDeviceOk,
    user: savedUser,
    activeBox: savedBox,
    isAuthenticated: Boolean(savedDeviceOk && savedUser && savedUser.id),

    authorizeDevice: (token: string) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('sys_device_token', token);
        localStorage.setItem('sys_auth_token', token);
        localStorage.setItem('sys_device_ok', '1');
        localStorage.setItem('sys_auth_ok', '1');
      }
      set((state) => ({
        token,
        deviceToken: token,
        isDeviceAuthorized: true,
        isAuthenticated: Boolean(state.user && state.user.id),
      }));
    },

    deauthorizeDevice: () => {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('sys_device_token');
        localStorage.removeItem('sys_auth_token');
        localStorage.removeItem('sys_device_ok');
        localStorage.removeItem('sys_auth_ok');
        localStorage.removeItem('sys_auth_user');
      }
      set({
        token: null,
        deviceToken: null,
        isDeviceAuthorized: false,
        user: null,
        isAuthenticated: false,
      });
    },

    loginUser: (user: StaffUser) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('sys_auth_user', JSON.stringify(user));
        localStorage.removeItem('panol_cached_holds');
        localStorage.removeItem('mechanic_op');
      }
      const box = user.default_boxes?.[0] || '01';
      if (typeof window !== 'undefined') {
        localStorage.setItem('sys_active_box', box);
      }
      set({
        user,
        activeBox: box,
        isAuthenticated: true,
      });
    },

    logoutUser: () => {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('sys_auth_user');
        localStorage.removeItem('panol_cached_holds');
        localStorage.removeItem('mechanic_op');
      }
      // Mantiene el dispositivo autorizado
      set({
        user: null,
        isAuthenticated: false,
      });
    },

    login: (token, user) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('sys_device_token', token);
        localStorage.setItem('sys_auth_token', token);
        localStorage.setItem('sys_device_ok', '1');
        localStorage.setItem('sys_auth_ok', '1');
        localStorage.setItem('sys_auth_user', JSON.stringify(user));
        localStorage.removeItem('panol_cached_holds');
        localStorage.removeItem('mechanic_op');
      }
      const box = user.default_boxes?.[0] || '01';
      if (typeof window !== 'undefined') {
        localStorage.setItem('sys_active_box', box);
      }
      set({
        token,
        deviceToken: token,
        isDeviceAuthorized: true,
        user,
        activeBox: box,
        isAuthenticated: true,
      });
    },

    logout: () => {
      // Cierre de sesión de operario manteniendo dispositivo verificado por 90 días
      if (typeof window !== 'undefined') {
        localStorage.removeItem('sys_auth_user');
        localStorage.removeItem('panol_cached_holds');
        localStorage.removeItem('mechanic_op');
      }
      set({
        user: null,
        isAuthenticated: false,
      });
    },

    setActiveBox: (box) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('sys_active_box', box);
      }
      set({ activeBox: box });
    },
  };
});
