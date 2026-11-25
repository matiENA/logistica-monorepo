import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { PlaneacionKanbanPage } from './pages/PlaneacionKanbanPage';
import { TallerLoginTerminalPage } from './pages/TallerLoginTerminalPage';

export const App: React.FC = () => {
  const location = useLocation();
  const isTallerRoute =
    location.pathname.startsWith('/taller') || location.pathname.startsWith('/login');

  if (isTallerRoute) {
    return (
      <>
        <Toaster position="top-right" richColors />
        <Routes>
          <Route path="/taller/*" element={<TallerLoginTerminalPage />} />
          <Route path="/login/*" element={<Navigate to="/taller" replace />} />
        </Routes>
      </>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col bg-[#EDEDED] text-zinc-950 overflow-hidden">
      <Toaster position="top-right" richColors />
      <Routes>
        <Route path="/coordinacion/*" element={<PlaneacionKanbanPage />} />
        <Route path="*" element={<Navigate to="/coordinacion" replace />} />
      </Routes>
    </div>
  );
};

export default App;
