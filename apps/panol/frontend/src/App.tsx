import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Login } from './pages/Login';
import { TerminalTaller } from './pages/TerminalTaller';
import { MonitorPanol } from './pages/MonitorPanol';
import { AppMobile } from './pages/AppMobile';

export const App: React.FC = () => {
  return (
    <>
      <Toaster theme="dark" position="top-right" richColors />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<TerminalTaller />} />
        <Route path="/terminal" element={<Navigate to="/" replace />} />
        <Route path="/panol" element={<MonitorPanol />} />
        <Route path="/mobile" element={<AppMobile />} />
        <Route path="/m" element={<Navigate to="/mobile" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
};

export default App;
