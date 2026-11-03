import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Login } from './pages/Login';
import { TerminalTaller } from './pages/TerminalTaller';
import { MonitorPanol } from './pages/MonitorPanol';
import { MonitorCoordinacion } from './pages/MonitorCoordinacion';
import { AppMobile } from './pages/AppMobile';
import { useAuthStore } from './stores/authStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireUser?: boolean;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requireUser = true }) => {
  const { isDeviceAuthorized, user } = useAuthStore();
  const location = useLocation();

  // 1. Capa 1: Si el dispositivo NO está autorizado en el sistema (90 días), pedir clave de sistema
  if (!isDeviceAuthorized) {
    return <Navigate to={`/login?step=sistema&next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  // 2. Capa 2: Si la ruta requiere un operario identificado y no hay sesión activa, pedir operario
  if (requireUser && (!user || !user.id || user.id === 'staff-default')) {
    return <Navigate to={`/login?step=usuario&next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  return <>{children}</>;
};

export const App: React.FC = () => {
  const location = useLocation();

  React.useEffect(() => {
    const path = location.pathname;
    let title = 'Taller';
    if (path.startsWith('/panol')) {
      title = 'Pañol';
    } else if (path.startsWith('/coordinacion') || path.startsWith('/wireframe')) {
      title = 'Coordinación';
    } else if (path.startsWith('/login')) {
      title = 'Acceso';
    } else if (path.startsWith('/mobile') || path.startsWith('/m')) {
      title = 'Taller';
    } else {
      title = 'Taller';
    }
    document.title = title;
    try {
      if (window.top && window.top !== window) {
        window.top.document.title = title;
      }
    } catch (e) {}
  }, [location.pathname]);

  return (
    <>
      <Toaster theme="dark" position="top-right" richColors />
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Terminal Taller requiere operario identificado */}
        <Route path="/" element={<ProtectedRoute requireUser={true}><TerminalTaller /></ProtectedRoute>} />
        <Route path="/terminal" element={<Navigate to="/" replace />} />
        {/* Monitor Pañol y Coordinación sólo requieren autorización de sistema/dispositivo (90 días) */}
        <Route path="/panol" element={<ProtectedRoute requireUser={false}><MonitorPanol /></ProtectedRoute>} />
        <Route path="/coordinacion" element={<ProtectedRoute requireUser={false}><MonitorCoordinacion /></ProtectedRoute>} />
        <Route path="/wireframe" element={<Navigate to="/coordinacion" replace />} />
        <Route path="/mobile" element={<ProtectedRoute requireUser={true}><AppMobile /></ProtectedRoute>} />
        <Route path="/m" element={<Navigate to="/mobile" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
};

export default App;
