import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { PlaneacionShell } from './components/layout/PlaneacionShell';
import { PlaneacionKanbanPage } from './pages/PlaneacionKanbanPage';
import { TallerLoginTerminalPage } from './pages/TallerLoginTerminalPage';

const FutureModulePlaceholder: React.FC<{ title: string }> = ({ title }) => (
  <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 gap-2 p-6">
    <h2 className="text-lg font-extrabold text-zinc-900">{title}</h2>
    <p className="text-xs">Módulo planificado para la siguiente iteración de Planeación.</p>
  </div>
);

export const App: React.FC = () => {
  const location = useLocation();
  const isTallerRoute =
    location.pathname.startsWith('/taller') || location.pathname.startsWith('/login');

  if (isTallerRoute) {
    return (
      <Routes>
        <Route path="/taller/*" element={<TallerLoginTerminalPage />} />
        <Route path="/login/*" element={<Navigate to="/taller" replace />} />
      </Routes>
    );
  }

  // Ruta /coordinacion (coordinacion.html): sin navbar y sin web ui, vista limpia y directa
  const isCoordinacionRoute = location.pathname.startsWith('/coordinacion');
  if (isCoordinacionRoute) {
    return (
      <div className="h-screen w-full flex flex-col bg-[#EDEDED] text-zinc-950 overflow-hidden">
        <PlaneacionKanbanPage />
      </div>
    );
  }

  return (
    <PlaneacionShell>
      <Routes>
        <Route path="/" element={<PlaneacionKanbanPage />} />
        <Route path="/vencimientos" element={<FutureModulePlaceholder title="Matriz de Vencimientos" />} />
        <Route path="/cronologia" element={<FutureModulePlaceholder title="Cronología de Procesos" />} />
        <Route path="/config" element={<FutureModulePlaceholder title="Gestión de Boxes y Zonas" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </PlaneacionShell>
  );
};

export default App;
