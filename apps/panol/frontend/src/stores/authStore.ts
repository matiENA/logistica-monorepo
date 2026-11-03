import { create } from 'zustand';
import { StaffUser } from '../types';

interface AuthState {
  token: string | null;
  user: StaffUser | null;
  activeBox: string;
  isAuthenticated: boolean;
  login: (token: string, user: StaffUser) => void;
  logout: () => void;
  setActiveBox: (box: string) => void;
}

export const useAuthStore = create<AuthState>((set) => {
  const savedToken = typeof window !== 'undefined' ? localStorage.getItem('sys_auth_token') : null;
  const savedUserJson = typeof window !== 'undefined' ? localStorage.getItem('sys_auth_user') : null;
  const savedUser = savedUserJson ? JSON.parse(savedUserJson) : null;
  const savedBox = typeof window !== 'undefined' ? localStorage.getItem('sys_active_box') || '01' : '01';

  return {
    token: savedToken,
    user: savedUser,
    activeBox: savedBox,
    isAuthenticated: !!savedToken,

    login: (token, user) => {
      localStorage.setItem('sys_auth_token', token);
      localStorage.setItem('sys_auth_user', JSON.stringify(user));
      const box = user.default_boxes?.[0] || '01';
      localStorage.setItem('sys_active_box', box);
      set({ token, user, isAuthenticated: true, activeBox: box });
    },

    logout: () => {
      localStorage.removeItem('sys_auth_token');
      localStorage.removeItem('sys_auth_user');
      set({ token: null, user: null, isAuthenticated: false });
    },

    setActiveBox: (box) => {
      localStorage.setItem('sys_active_box', box);
      set({ activeBox: box });
    },
  };
});
