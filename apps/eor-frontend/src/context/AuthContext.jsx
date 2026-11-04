import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../api/supabaseClient';
import { apiClient } from '../api/apiClient';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Carga inicial y validación de sesión persistida
  useEffect(() => {
    try {
      const token = localStorage.getItem('eor_session_token');
      const usuarioActivo = localStorage.getItem('usuarioActivo');
      const rol = localStorage.getItem('eor_session_role') || 'operador';

      if (token && usuarioActivo) {
        setUser({
          usuario: usuarioActivo.toUpperCase(),
          rol: rol.toLowerCase(),
          token,
        });
      }
    } catch (e) {
      console.error('Error restaurando sesión:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Inicia sesión validando credenciales vía backend seguro o RPC fn_auth_login
   */
  const login = async (usuario, password) => {
    try {
      const uClean = String(usuario || '').trim();
      const pClean = String(password || '').trim();

      if (!uClean || !pClean) {
        return { success: false, error: 'Complete usuario y contraseña.' };
      }

      let data = null;

      // 1. Intento primario vía API Gateway Backend (Hot RAM / Pooler Postgres nativo)
      try {
        const res = await apiClient.fetchJson('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ usuario: uClean, password: pClean }),
          timeoutMs: 6000
        });
        if (res && res.success) {
          data = res;
        }
      } catch (errApi) {
        console.warn('⚠️ [AuthContext] Fallback a RPC Supabase:', errApi.message);
      }

      // 2. Fallback secundario vía RPC seguro 'fn_auth_login' en Supabase
      if (!data) {
        try {
          const { data: rpcRes, error: rpcErr } = await supabase.rpc('fn_auth_login', {
            p_usuario: uClean,
            p_password: pClean
          });
          if (rpcErr) throw rpcErr;
          if (rpcRes && rpcRes.success) {
            data = rpcRes;
          } else if (rpcRes && rpcRes.error) {
            return { success: false, error: rpcRes.error };
          }
        } catch (sbErr) {
          console.error('Error en autenticación fallback:', sbErr.message);
        }
      }

      if (!data) {
        return { success: false, error: 'Usuario o contraseña incorrectos o servidor no disponible.' };
      }

      const token = data.token || ('auth_' + data.id + '_' + Date.now());
      const usuarioNom = String(data.usuario).toUpperCase();
      const userRol = data.rol || 'operador';

      // Persistencia en localStorage compatible con legacy y nuevo frontend
      localStorage.setItem('eor_session_token', token);
      localStorage.setItem('eor_session_role', userRol);
      localStorage.setItem('usuarioActivo', usuarioNom);

      const authUser = {
        id: data.id,
        usuario: usuarioNom,
        rol: userRol,
        token,
      };

      setUser(authUser);
      return { success: true, user: authUser };
    } catch (err) {
      console.error('Error crítico en login:', err);
      return { success: false, error: 'Error inesperado al iniciar sesión.' };
    }
  };

  /**
   * Cierra sesión purgando el almacenamiento local
   */
  const logout = () => {
    localStorage.removeItem('eor_session_token');
    localStorage.removeItem('eor_session_role');
    localStorage.removeItem('usuarioActivo');
    setUser(null);

    // Limpieza de parámetros de ruta (ej. si estaba en detalle de un chofer)
    try {
      const url = new URL(window.location);
      if (url.searchParams.has('chofer')) {
        url.searchParams.delete('chofer');
        window.history.replaceState({}, '', url);
      }
    } catch (_) {}
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe ser utilizado dentro de un AuthProvider');
  }
  return context;
};
