import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../api/supabaseClient';

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
   * Inicia sesión validando credenciales contra la tabla 'usuarios_auth' de Supabase
   */
  const login = async (usuario, password) => {
    try {
      const uClean = String(usuario || '').trim();
      const pClean = String(password || '').trim();

      if (!uClean || !pClean) {
        return { success: false, error: 'Complete usuario y contraseña.' };
      }

      // Consulta directa a la tabla usuarios_auth
      const { data, error } = await supabase
        .from('usuarios_auth')
        .select('id, usuario, rol')
        .ilike('usuario', uClean)
        .eq('password', pClean)
        .maybeSingle();

      if (error) {
        console.error('Error consultando usuarios_auth en Supabase:', error.message);
        return { success: false, error: 'Error de conexión con el servidor.' };
      }

      if (!data) {
        return { success: false, error: 'Usuario o contraseña incorrectos.' };
      }

      const token = 'auth_' + data.id + '_' + Date.now();
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
