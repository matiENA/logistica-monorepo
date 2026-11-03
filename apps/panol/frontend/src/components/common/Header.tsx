import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { LogOut, Monitor, Smartphone, Wrench, GitFork } from 'lucide-react';

export const Header: React.FC = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isLocal = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );

  return (
    <header className="h-[52px] bg-panol-header-bg border-b border-panol-border px-5 flex items-center justify-between shrink-0 z-50">
      {/* Brand & Operario */}
      <div className="flex items-center gap-4">
        <div className="text-lg font-black tracking-wider text-panol-text">
          TALLER
        </div>

        <div className="w-[1px] h-6 bg-panol-border hidden sm:block" />

        {user ? (
          <div className="hidden sm:flex flex-col text-xs">
            <span className="text-[10px] text-panol-text-dim font-bold uppercase tracking-wider">
              OPERARIO CONECTADO
            </span>
            <span className="font-semibold text-panol-text">
              {user.name} ({user.op_code})
            </span>
          </div>
        ) : (
          <div className="hidden sm:flex flex-col text-xs">
            <span className="text-[10px] text-panol-text-dim font-bold uppercase tracking-wider">
              SESIÓN INVITADO
            </span>
            <span className="font-semibold text-panol-text-muted">Sin identificar</span>
          </div>
        )}

        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold border ${
          isLocal 
            ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800' 
            : 'bg-blue-950/60 text-blue-400 border-blue-800'
        }`}>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>{isLocal ? 'LOCAL / DESARROLLO' : 'RENDER PRODUCCIÓN'}</span>
        </div>
      </div>

      {/* Navegación Rápida entre Módulos */}
      <nav className="flex items-center gap-1">
        <NavLink
          to="/"
          className={({ isActive }) =>
            `flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-colors ${
              isActive
                ? 'bg-panol-blue-primary text-white shadow-sm'
                : 'text-panol-text-muted hover:text-panol-text hover:bg-panol-card-bg'
            }`
          }
        >
          <Wrench className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Terminal</span>
        </NavLink>

        <NavLink
          to="/panol"
          className={({ isActive }) =>
            `flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-colors ${
              isActive
                ? 'bg-panol-blue-primary text-white shadow-sm'
                : 'text-panol-text-muted hover:text-panol-text hover:bg-panol-card-bg'
            }`
          }
        >
          <Monitor className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Pañol</span>
        </NavLink>

        <NavLink
          to="/mobile"
          className={({ isActive }) =>
            `flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-colors ${
              isActive
                ? 'bg-panol-blue-primary text-white shadow-sm'
                : 'text-panol-text-muted hover:text-panol-text hover:bg-panol-card-bg'
            }`
          }
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Móvil</span>
        </NavLink>

        {/* Coordinación: Passthrough hacia el HTML intacto */}
        <a
          href="/coordinacion"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold text-panol-text-muted hover:text-amber-400 hover:bg-panol-card-bg transition-colors"
          title="Acceso al módulo de Coordinación en diseño"
        >
          <GitFork className="w-3.5 h-3.5 text-amber-500" />
          <span className="hidden md:inline">Coordinación (HTML)</span>
        </a>

        <div className="w-[1px] h-5 bg-panol-border mx-1" />

        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-bold text-panol-red hover:bg-red-950/30 transition-colors"
          title="Cerrar sesión"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Salir</span>
        </button>
      </nav>
    </header>
  );
};
