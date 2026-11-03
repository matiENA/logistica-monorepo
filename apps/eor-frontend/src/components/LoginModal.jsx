import React, { useState } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { X, Lock, User, AlertCircle, LogIn, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const LoginModal = ({ isOpen, onClose }) => {
  const { login } = useAuth();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!usuario.trim() || !password.trim()) {
      setErrorMsg('Por favor complete usuario y contraseña.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await login(usuario, password);
      if (result.success) {
        setIsSuccess(true);
        setTimeout(() => {
          setIsSuccess(false);
          setUsuario('');
          setPassword('');
          onClose();
        }, 700);
      } else {
        setErrorMsg(result.error || 'Acceso denegado');
      }
    } catch (err) {
      setErrorMsg('Error de conexión. Intente nuevamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setErrorMsg('');
    setIsSuccess(false);
    onClose();
  };

  return (
    <Transition show={isOpen} as={React.Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleClose}>
        {/* Backdrop desenfocado */}
        <TransitionChild
          as={React.Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.65)',
              backdropFilter: 'blur(4px)',
            }}
          />
        </TransitionChild>

        <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <TransitionChild
            as={React.Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <DialogPanel
              style={{
                width: '100%',
                maxWidth: '380px',
                backgroundColor: 'var(--bg-surface)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-subtle)',
                boxShadow: 'var(--shadow-lg)',
                padding: '1.75rem',
                color: 'var(--text-main)',
                position: 'relative',
              }}
            >
              {/* Botón Cerrar */}
              <button
                type="button"
                onClick={handleClose}
                style={{
                  position: 'absolute',
                  top: '1rem',
                  right: '1rem',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '0.25rem',
                  borderRadius: 'var(--radius-sm)',
                }}
                title="Cerrar"
              >
                <X size={18} />
              </button>

              {/* Cabecera del Modal */}
              <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                <div
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--primary-light)',
                    color: 'var(--primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 0.75rem',
                  }}
                >
                  <Lock size={24} />
                </div>
                <DialogTitle as="h3" style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  Ingreso Operativo
                </DialogTitle>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Autenticación integrada con Supabase
                </p>
              </div>

              {/* Mensajes de Estado */}
              {errorMsg && (
                <div
                  style={{
                    backgroundColor: 'var(--novedad-a-bg)',
                    border: '1px solid var(--novedad-a-border)',
                    color: 'var(--novedad-a-text)',
                    padding: '0.6rem 0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <AlertCircle size={16} shrink={0} />
                  <span>{errorMsg}</span>
                </div>
              )}

              {isSuccess && (
                <div
                  style={{
                    backgroundColor: 'var(--novedad-v-bg)',
                    border: '1px solid var(--novedad-v-border)',
                    color: 'var(--novedad-v-text)',
                    padding: '0.6rem 0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <CheckCircle2 size={16} shrink={0} />
                  <span>¡Sesión iniciada con éxito!</span>
                </div>
              )}

              {/* Formulario */}
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'var(--text-muted)',
                      marginBottom: '0.35rem',
                    }}
                  >
                    Usuario
                  </label>
                  <div style={{ position: 'relative' }}>
                    <div
                      style={{
                        position: 'absolute',
                        left: '0.75rem',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--text-muted)',
                        pointerEvents: 'none',
                      }}
                    >
                      <User size={16} />
                    </div>
                    <input
                      type="text"
                      value={usuario}
                      onChange={(e) => setUsuario(e.target.value)}
                      placeholder="Ej. TRANSER o M"
                      autoFocus
                      autoComplete="username"
                      disabled={isSubmitting || isSuccess}
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.75rem 0.6rem 2.25rem',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        backgroundColor: 'var(--bg-app)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--text-main)',
                        outline: 'none',
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'var(--text-muted)',
                      marginBottom: '0.35rem',
                    }}
                  >
                    Contraseña
                  </label>
                  <div style={{ position: 'relative' }}>
                    <div
                      style={{
                        position: 'absolute',
                        left: '0.75rem',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--text-muted)',
                        pointerEvents: 'none',
                      }}
                    >
                      <Lock size={16} />
                    </div>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      disabled={isSubmitting || isSuccess}
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.75rem 0.6rem 2.25rem',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        backgroundColor: 'var(--bg-app)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--text-main)',
                        outline: 'none',
                      }}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || isSuccess}
                  style={{
                    marginTop: '0.5rem',
                    padding: '0.7rem 1rem',
                    backgroundColor: 'var(--primary-solid)',
                    color: 'var(--on-primary-solid)',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    cursor: isSubmitting || isSuccess ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    boxShadow: 'var(--shadow-sm)',
                    opacity: isSubmitting || isSuccess ? 0.75 : 1,
                    transition: 'all 0.15s ease',
                  }}
                >
                  {isSubmitting ? (
                    <span>Validando credenciales...</span>
                  ) : (
                    <>
                      <LogIn size={16} />
                      <span>Ingresar al Sistema</span>
                    </>
                  )}
                </button>
              </form>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
};
