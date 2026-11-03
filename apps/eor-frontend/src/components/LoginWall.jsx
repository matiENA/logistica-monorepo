import React, { useState, useEffect } from 'react';
import { Truck, Lock, User, AlertCircle, Sun, Moon, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const LoginWall = () => {
  const { login } = useAuth();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSlowNotice, setShowSlowNotice] = useState(false);

  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark';
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const toggleDarkMode = () => {
    setIsDarkMode((prev) => !prev);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    const uClean = usuario.trim();
    const pClean = password.trim();

    if (!uClean || !pClean) {
      setErrorMsg('Por favor, complete usuario y contraseña.');
      return;
    }

    setIsSubmitting(true);
    setShowSlowNotice(false);

    // Aviso si el servidor demora más de 2.5s
    const slowTimer = setTimeout(() => {
      setShowSlowNotice(true);
    }, 2500);

    try {
      const result = await login(uClean, pClean);
      clearTimeout(slowTimer);

      if (!result.success) {
        setErrorMsg(result.error || 'Credenciales incorrectas. Acceso denegado.');
      }
    } catch (err) {
      clearTimeout(slowTimer);
      setErrorMsg('Error de red al conectar con el servidor.');
    } finally {
      setIsSubmitting(false);
      setShowSlowNotice(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-app)',
        padding: '1.5rem',
        position: 'relative',
        transition: 'background-color 0.2s ease',
      }}
    >
      {/* Botón Flotante para Alternar Modo Oscuro en Login */}
      <button
        onClick={toggleDarkMode}
        style={{
          position: 'absolute',
          top: '1.25rem',
          right: '1.25rem',
          padding: '0.5rem',
          borderRadius: 'var(--radius-md)',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'var(--shadow-sm)',
        }}
        title={isDarkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      >
        {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      {/* Tarjeta Central de Login Wall (Bloqueante) */}
      <div
        style={{
          width: '100%',
          maxWidth: '380px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          padding: '2.25rem 2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
          animation: 'fadeIn 0.3s ease-out',
        }}
      >
        {/* Cabecera Corporativa EOR */}
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: '60px',
              height: '60px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--primary-solid)',
              color: 'var(--on-primary-solid)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem',
              boxShadow: '0 8px 16px -4px rgba(25, 64, 126, 0.35)',
            }}
          >
            <Truck size={30} />
          </div>

          <h1
            style={{
              fontSize: '1.45rem',
              fontWeight: 900,
              letterSpacing: '-0.02em',
              color: 'var(--text-main)',
              lineHeight: 1.2,
            }}
          >
            Diagramas EOR
          </h1>
          <p
            style={{
              fontSize: '0.72rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: 'var(--text-muted)',
              marginTop: '0.35rem',
            }}
          >
            🔒 Acceso Restringido
          </p>
        </div>

        {/* Formulario de Acceso */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Campo Usuario */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '0.68rem',
                fontWeight: 900,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--text-muted)',
                marginBottom: '0.35rem',
              }}
            >
              Usuario
            </label>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                backgroundColor: 'var(--bg-surface-muted)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.65rem 0.85rem',
              }}
            >
              <User size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <input
                type="text"
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                placeholder="ID de Usuario"
                autoFocus
                autoComplete="username"
                disabled={isSubmitting}
                style={{
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  color: 'var(--text-main)',
                }}
              />
            </div>
          </div>

          {/* Campo Contraseña */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '0.68rem',
                fontWeight: 900,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--text-muted)',
                marginBottom: '0.35rem',
              }}
            >
              Contraseña
            </label>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                backgroundColor: 'var(--bg-surface-muted)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.65rem 0.85rem',
              }}
            >
              <Lock size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                disabled={isSubmitting}
                style={{
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  color: 'var(--text-main)',
                }}
              />
            </div>
          </div>

          {/* Banner de Error */}
          {errorMsg && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.65rem 0.85rem',
                backgroundColor: 'var(--novedad-a-bg)',
                border: '1px solid var(--novedad-a-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--novedad-a-text)',
                fontSize: '0.78rem',
                fontWeight: 700,
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Aviso de Espera de Red */}
          {showSlowNotice && (
            <p
              style={{
                fontSize: '0.72rem',
                color: 'var(--text-muted)',
                textAlign: 'center',
                fontStyle: 'italic',
              }}
            >
              Conectando con el servidor seguro...
            </p>
          )}

          {/* Botón de Ingreso */}
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              marginTop: '0.5rem',
              width: '100%',
              padding: '0.85rem',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--primary-solid)',
              color: 'var(--on-primary-solid)',
              fontSize: '0.9rem',
              fontWeight: 900,
              letterSpacing: '0.02em',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              boxShadow: '0 4px 12px rgba(25, 64, 126, 0.25)',
              opacity: isSubmitting ? 0.75 : 1,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {isSubmitting ? (
              <>
                <span className="spinner-pulse" style={{ width: '16px', height: '16px' }} />
                <span>Verificando...</span>
              </>
            ) : (
              <>
                <span>Ingresar al Sistema</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        {/* Pie de Seguridad */}
        <div style={{ textAlign: 'center', borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            EOR Logística • Sesión protegida
          </p>
        </div>
      </div>
    </div>
  );
};
