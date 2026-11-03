import React, { useState, useEffect } from 'react';
import { Sun, Moon, Filter, Truck, LogIn, LogOut, UserCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { LoginModal } from '../../components/LoginModal';

export const HeaderNav = ({ activeTab, onSelectTab, onToggleMobileFilters, isDarkMode, onToggleDarkMode, pendingCount }) => {
  const [argentinaTime, setArgentinaTime] = useState('--:--');
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const { user, isAuthenticated, logout } = useAuth();

  useEffect(() => {
    const updateClock = () => {
      try {
        const now = new Date();
        const options = { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false };
        setArgentinaTime(new Intl.DateTimeFormat('es-AR', options).format(now));
      } catch (_) {
        const now = new Date();
        setArgentinaTime(now.toTimeString().substring(0, 5));
      }
    };
    updateClock();
    const interval = setInterval(updateClock, 10000);
    return () => clearInterval(interval);
  }, []);

  const modules = [
    { id: 'diaria', label: 'Diaria' },
    { id: 'individual', label: 'Individual' },
    { id: 'flota', label: 'Flota' },
  ];

  return (
    <>
      <header className="app-header">
        {/* 1. Identidad de Marca */}
        <div className="header-brand">
          <div className="brand-badge">
            <Truck size={20} />
          </div>
          <div>
            <h1 className="brand-title">EOR</h1>
            <p className="brand-subtitle">Logística & Diagramas</p>
          </div>
        </div>

        {/* 2. Selector de Módulos Central (3 Pestañas) */}
        <nav className="nav-modules" aria-label="Módulos Principales">
          {modules.map((m) => {
            const isActive = activeTab === m.id;
            return (
              <button
                key={m.id}
                onClick={() => onSelectTab(m.id)}
                className={`nav-tab-btn ${isActive ? 'active' : ''}`}
              >
                <span>{m.label}</span>
                {m.badge && <span className="nav-badge-pill">{m.badge}</span>}
              </button>
            );
          })}
        </nav>

        {/* 3. Acciones a la Derecha: Reloj, Auth, Modo Oscuro y Filtros Mobile */}
        <div className="header-actions">
          {/* Reloj Argentina */}
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.9rem', padding: '0 0.25rem' }}>
            {argentinaTime}
          </div>

          {/* Autenticación: Login / Sesión Activa */}
          {isAuthenticated && user ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.25rem 0.6rem',
                backgroundColor: 'var(--bg-app)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <UserCheck size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-main)' }}>
                {user.usuario}
              </span>
              <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: 600 }}>
                ({user.rol})
              </span>
              <button
                onClick={logout}
                className="btn-logout-icon"
                title="Cerrar Sesión"
              >
                <LogOut size={13} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsLoginModalOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.35rem 0.75rem',
                fontSize: '0.75rem',
                fontWeight: 800,
                backgroundColor: 'var(--primary-solid)',
                color: 'var(--on-primary-solid)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                boxShadow: 'var(--shadow-sm)',
                transition: 'opacity 0.15s ease',
              }}
              title="Iniciar Sesión Operativa"
            >
              <LogIn size={13} />
              <span>Ingresar</span>
            </button>
          )}

          {/* Botón Filtros (solo visible en pantallas chicas cuando está en vista 'diaria') */}
          {activeTab === 'diaria' && (
            <button
              onClick={onToggleMobileFilters}
              className="btn-mobile-filters"
              title="Abrir Filtros"
            >
              <Filter size={15} />
              <span>Filtros</span>
            </button>
          )}

          {/* Switch Modo Oscuro */}
          <button
            onClick={onToggleDarkMode}
            className="btn-icon-square"
            title={isDarkMode ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro'}
          >
            {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      {/* Modal de Autenticación */}
      <LoginModal isOpen={isLoginModalOpen} onClose={() => setIsLoginModalOpen(false)} />
    </>
  );
};
