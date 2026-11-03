import React, { useState, useMemo } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { X, Search, Truck, AlertTriangle, Check, UserMinus, ShieldAlert, ArrowRight } from 'lucide-react';
import { useAvailableUnits, useAssignUnit } from '../hooks/useAssignUnit';
import { showLegacyToast } from '@/utils/clipboard';
import { PatenteMercosur } from '@/components/common/PatenteMercosur';

export const UnitAssignModal = ({ isOpen, onClose, driver }) => {
  const [search, setSearch] = useState('');
  const [servicio, setServicio] = useState('TODOS');
  const [unitToConfirm, setUnitToConfirm] = useState(null);
  const [isUnassignConfirmOpen, setIsUnassignConfirmOpen] = useState(false);

  const { data: units, isLoading } = useAvailableUnits(servicio, { enabled: Boolean(isOpen) });
  const assignMutation = useAssignUnit();

  const avatarFallback = driver?.nombre
    ? `https://ui-avatars.com/api/?name=${encodeURIComponent(driver.nombre)}&background=2563eb&color=fff&size=80`
    : '';

  const filteredUnits = useMemo(() => {
    if (!units) return [];
    if (!search.trim()) return units;
    const q = search.toLowerCase().trim();
    return units.filter((u) => {
      const matchTr = u.tractor && u.tractor.toLowerCase().includes(q);
      const matchSe = u.semi && u.semi.toLowerCase().includes(q);
      const matchUte = u.n_ute && String(u.n_ute).toLowerCase().includes(q);
      const matchCh = u.chofer_nombre && u.chofer_nombre.toLowerCase().includes(q);
      return matchTr || matchSe || matchUte || matchCh;
    });
  }, [units, search]);

  if (!driver) return null;

  // Asignación con Optimistic UI: actualización inmediata en memoria (<16 ms) y cierre instantáneo
  const handleAssign = (unit) => {
    if (!unit) return;
    try {
      showLegacyToast(`Asignando ${unit.tractor || unit.semi || 'unidad'} a ${driver.nombre}...`, 'success');
      assignMutation.mutate({
        choferId: driver.chofer_id || driver.id,
        choferNombre: driver.nombre,
        unidadId: unit.unidad_id,
        tractor: unit.tractor,
        semi: unit.semi,
        n_ute: unit.n_ute,
        esDesasignar: false,
      });
      setUnitToConfirm(null);
      onClose();
    } catch (err) {
      showLegacyToast(`❌ ${err.message}`, 'error');
    }
  };

  // Desasignación con Optimistic UI: liberación inmediata en memoria y cierre instantáneo
  const handleUnassign = () => {
    try {
      showLegacyToast(`Desasignando unidad de ${driver.nombre}...`, 'success');
      assignMutation.mutate({
        choferId: driver.chofer_id || driver.id,
        choferNombre: driver.nombre,
        esDesasignar: true,
      });
      setIsUnassignConfirmOpen(false);
      onClose();
    } catch (err) {
      showLegacyToast(`❌ ${err.message}`, 'error');
    }
  };

  const tieneUnidadAsignada = Boolean(driver.tractor || driver.semi || driver.n_ute);
  const servicios = ['TODOS', 'LIVIANO', 'METANOL', 'CAMPO', 'GLP', 'TDS', 'EURO'];

  return (
    <>
      {/* 1. MODAL PRINCIPAL: LISTA DE ASIGNACIÓN */}
      <Transition show={isOpen} as={React.Fragment}>
        <Dialog as="div" className="modal-dialog-root" onClose={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999 }}>
          {/* Backdrop */}
          <TransitionChild
            as={React.Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(3px)' }} />
          </TransitionChild>

          <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
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
                  maxWidth: '720px',
                  backgroundColor: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: 'var(--shadow-lg)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  maxHeight: '90vh',
                  overflow: 'hidden',
                }}
              >
                {/* Header Modal */}
                <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                    <div style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '50%',
                      overflow: 'hidden',
                      flexShrink: 0,
                      border: '2px solid var(--primary)',
                      backgroundColor: 'var(--bg-surface-muted)'
                    }}>
                      <img
                        src={driver.foto || avatarFallback}
                        alt={driver.nombre}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => { e.target.src = avatarFallback; }}
                      />
                    </div>
                    <div>
                      <DialogTitle style={{ fontSize: '1.15rem', fontWeight: 900, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                        <Truck size={20} style={{ color: 'var(--primary)' }} />
                        <span>Asignar Unidad Operativa</span>
                      </DialogTitle>
                      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0.15rem 0 0 0' }}>
                        Chofer: <strong style={{ color: 'var(--text-main)' }}>{driver.nombre}</strong>
                        {driver.dni ? ` • DNI: ${driver.dni}` : ''}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={onClose}
                    className="btn-icon-square"
                    style={{ width: '32px', height: '32px' }}
                    title="Cerrar"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Unidad actual asignada + Botón Desasignar con PatenteMercosur */}
                <div style={{ padding: '0.75rem 1.5rem', backgroundColor: 'var(--bg-surface-muted)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Asignación actual:</span>
                    {tieneUnidadAsignada ? (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {driver.n_ute && (
                          <span className="chip-badge chip-ute">
                            UTE {driver.n_ute}
                          </span>
                        )}
                        {driver.tractor && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-muted)' }}>TRAC:</span>
                            <PatenteMercosur patente={driver.tractor} fieldLabel="Tractor" />
                          </div>
                        )}
                        {driver.semi && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-muted)' }}>SEMI:</span>
                            <PatenteMercosur patente={driver.semi} fieldLabel="Semi" />
                          </div>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin unidad asignada</span>
                    )}
                  </div>

                  {tieneUnidadAsignada && (
                    <button
                      onClick={() => setIsUnassignConfirmOpen(true)}
                      disabled={assignMutation.isPending}
                      className="unit-modal-unassign-btn"
                      style={{
                        padding: '0.35rem 0.75rem',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.75rem',
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        cursor: 'pointer',
                        backgroundColor: 'rgba(239, 68, 68, 0.12)',
                        color: '#dc2626',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                      }}
                    >
                      <UserMinus size={13} />
                      <span>Desasignar Unidad</span>
                    </button>
                  )}
                </div>

                {/* Barra de Filtros */}
                <div style={{ padding: '0.75rem 1.5rem', display: 'flex', gap: '0.75rem', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div className="filter-search-box" style={{ flex: 1 }}>
                    <Search size={15} className="filter-search-icon" />
                    <input
                      type="text"
                      placeholder="Filtrar por tractor, semi, UTE o chofer..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="filter-search-input"
                      autoFocus
                    />
                  </div>

                  <select
                    value={servicio}
                    onChange={(e) => setServicio(e.target.value)}
                    className="filter-search-input"
                    style={{ width: '130px', paddingLeft: '0.65rem' }}
                  >
                    {servicios.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                {/* Lista Scrollable de Unidades */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {isLoading ? (
                    <div style={{ padding: '3rem', textAlign: 'center' }}>
                      <div className="spinner-pulse" />
                      <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cargando unidades operativas...</p>
                    </div>
                  ) : filteredUnits.length === 0 ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      No se encontraron unidades con los filtros especificados.
                    </div>
                  ) : (
                    filteredUnits.map((u) => {
                      const esLaActual = (u.tractor && u.tractor === driver.tractor) || (u.n_ute && String(u.n_ute) === String(driver.n_ute));
                      const tieneAlertaDocs = u.alerta_vtv_tractor === 'VENCIDO' || u.alerta_vtv_semi === 'VENCIDO';
                      const ocupadoPorOtro = u.chofer_nombre && u.chofer_nombre !== driver.nombre;

                      return (
                        <div
                          key={u.unidad_id || u.n_ute}
                          style={{
                            padding: '0.75rem 1rem',
                            borderRadius: 'var(--radius-md)',
                            border: esLaActual ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                            backgroundColor: esLaActual ? 'var(--primary-light)' : 'var(--bg-surface)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '1rem',
                            transition: 'background-color 0.15s ease',
                          }}
                        >
                          {/* Info de la Unidad */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>
                                UTE: {u.n_ute || '—'}
                              </span>
                              <span className="chip-badge chip-service">
                                {u.servicio || 'GENERAL'}
                              </span>
                              {tieneAlertaDocs && (
                                <span className="alert-mini-pill alert-red" title="VTV o MAS Vencido">
                                  <ShieldAlert size={11} />
                                  <span>VTV</span>
                                </span>
                              )}
                            </div>

                            {/* Patentes Mercosur 1:1 en cada fila de unidad */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-muted)' }}>TRAC:</span>
                                <PatenteMercosur patente={u.tractor} fieldLabel="Tractor" />
                              </div>
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-muted)' }}>SEMI:</span>
                                <PatenteMercosur patente={u.semi} fieldLabel="Semi" />
                              </div>
                            </div>

                            {ocupadoPorOtro && (
                              <div style={{ fontSize: '0.72rem', color: '#b45309', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                <span>⚠️ Asignado a:</span>
                                <strong>{u.chofer_nombre}</strong>
                              </div>
                            )}
                          </div>

                          {/* Botón Acción Asignar: Abre el diálogo de confirmación */}
                          <div>
                            {esLaActual ? (
                              <span className="badge-vtv AL_DIA" style={{ minWidth: 'auto', padding: '0 0.6rem' }}>
                                Asignada
                              </span>
                            ) : (
                              <button
                                onClick={() => setUnitToConfirm(u)}
                                disabled={assignMutation.isPending}
                                style={{
                                  padding: '0.45rem 0.95rem',
                                  borderRadius: 'var(--radius-sm)',
                                  fontSize: '0.78rem',
                                  fontWeight: 800,
                                  backgroundColor: 'var(--primary-solid)',
                                  color: 'var(--on-primary-solid)',
                                  border: 'none',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.3rem',
                                  boxShadow: 'var(--shadow-sm)',
                                  transition: 'transform 0.15s ease',
                                }}
                              >
                                <span>Asignar</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Footer */}
                <div style={{ padding: '0.85rem 1.5rem', borderTop: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-surface-muted)', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={onClose}
                    style={{
                      padding: '0.45rem 1rem',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--text-main)',
                      border: '1px solid var(--border-strong)',
                      cursor: 'pointer',
                    }}
                  >
                    Cerrar
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>

      {/* 2. POP-UP DE CONFIRMACIÓN DE ASIGNACIÓN (CONTROL DE USUARIO: FOTO + CHOFER -> FLECHA -> PATENTES) */}
      <Transition show={Boolean(unitToConfirm)} as={React.Fragment}>
        <Dialog
          as="div"
          className="modal-confirm-dialog-root"
          onClose={() => !assignMutation.isPending && setUnitToConfirm(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 10050 }}
        >
          {/* Backdrop Blur Oscuro */}
          <TransitionChild
            as={React.Fragment}
            enter="ease-out duration-150"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.72)', backdropFilter: 'blur(4px)' }} />
          </TransitionChild>

          <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
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
                  maxWidth: '540px',
                  backgroundColor: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-lg, 16px)',
                  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)',
                  border: '1px solid var(--border-subtle)',
                  overflow: 'hidden',
                }}
              >
                {/* Header del Pop-up */}
                <div style={{ padding: '1.1rem 1.4rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <DialogTitle style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.45rem', margin: 0 }}>
                    <Truck size={19} style={{ color: 'var(--primary)' }} />
                    <span>Confirmar Asignación de Unidad</span>
                  </DialogTitle>
                  <button
                    onClick={() => setUnitToConfirm(null)}
                    disabled={assignMutation.isPending}
                    className="btn-icon-square"
                    style={{ width: '28px', height: '28px' }}
                    title="Cerrar"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Body del Pop-up */}
                <div style={{ padding: '1.35rem 1.4rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                    ¿Confirmás la asignación operativa de esta unidad al conductor seleccionado?
                  </p>

                  {/* FLOW BOX: FOTO + NOMBRE CHOFER  --->  FLECHA  --->  PATENTES 1:1 */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.85rem',
                    padding: '1.15rem 1.25rem',
                    backgroundColor: 'var(--bg-surface-muted)',
                    borderRadius: 'var(--radius-md, 12px)',
                    border: '1px solid var(--border-subtle)',
                    boxShadow: 'var(--shadow-sm)'
                  }}>
                    {/* Lado Chofer: Foto + Nombre */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0 }}>
                      <div style={{
                        width: '52px',
                        height: '52px',
                        borderRadius: '50%',
                        overflow: 'hidden',
                        flexShrink: 0,
                        border: '2px solid var(--primary)',
                        boxShadow: '0 2px 8px rgba(37, 99, 235, 0.25)',
                        backgroundColor: 'var(--bg-surface)'
                      }}>
                        <img
                          src={driver.foto || avatarFallback}
                          alt={driver.nombre}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e) => { e.target.src = avatarFallback; }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: '0.15rem' }}>
                        <span style={{ fontSize: '0.92rem', fontWeight: 900, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {driver.nombre}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                          {driver.dni ? `DNI: ${driver.dni}` : (driver.servicio || 'Conductor')}
                        </span>
                      </div>
                    </div>

                    {/* Flecha conectora central */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--primary-light)',
                      color: 'var(--primary)',
                      flexShrink: 0,
                      boxShadow: '0 1px 3px rgba(37, 99, 235, 0.15)'
                    }}>
                      <ArrowRight size={20} strokeWidth={2.6} />
                    </div>

                    {/* Lado Unidad / Patentes con diseño 1:1 */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem', flex: 1, minWidth: 0 }}>
                      {unitToConfirm?.n_ute && (
                        <span className="chip-badge chip-ute" style={{ height: '20px', fontSize: '0.65rem' }}>
                          UTE {unitToConfirm.n_ute}
                        </span>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', alignItems: 'flex-end' }}>
                        {unitToConfirm?.tractor && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-muted)' }}>TRAC:</span>
                            <PatenteMercosur patente={unitToConfirm.tractor} fieldLabel="Tractor" />
                          </div>
                        )}
                        {unitToConfirm?.semi && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-muted)' }}>SEMI:</span>
                            <PatenteMercosur patente={unitToConfirm.semi} fieldLabel="Semi" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Alerta de Reasignación si la unidad estaba ocupada por otro */}
                  {unitToConfirm?.chofer_nombre && unitToConfirm.chofer_nombre !== driver.nombre && (
                    <div style={{
                      padding: '0.75rem 0.95rem',
                      backgroundColor: 'rgba(245, 158, 11, 0.12)',
                      border: '1px solid rgba(245, 158, 11, 0.4)',
                      borderRadius: 'var(--radius-sm, 8px)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem',
                      fontSize: '0.8rem',
                      color: '#b45309',
                      lineHeight: 1.35
                    }}>
                      <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                      <span>
                        Atención: Esta unidad está asignada a <strong>{unitToConfirm.chofer_nombre}</strong>. Al confirmar, será reasignada a <strong>{driver.nombre}</strong>.
                      </span>
                    </div>
                  )}
                </div>

                {/* Footer de Acciones del Pop-up */}
                <div style={{
                  padding: '0.95rem 1.4rem',
                  borderTop: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-surface-muted)',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '0.75rem'
                }}>
                  <button
                    onClick={() => setUnitToConfirm(null)}
                    disabled={assignMutation.isPending}
                    style={{
                      padding: '0.5rem 1rem',
                      borderRadius: 'var(--radius-sm, 6px)',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--text-main)',
                      border: '1px solid var(--border-strong)',
                      cursor: 'pointer'
                    }}
                  >
                    Cancelar
                  </button>

                  <button
                    onClick={() => handleAssign(unitToConfirm)}
                    disabled={assignMutation.isPending}
                    style={{
                      padding: '0.5rem 1.25rem',
                      borderRadius: 'var(--radius-sm, 6px)',
                      fontSize: '0.82rem',
                      fontWeight: 800,
                      backgroundColor: 'var(--primary-solid)',
                      color: 'var(--on-primary-solid)',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      boxShadow: 'var(--shadow-sm)'
                    }}
                  >
                    {assignMutation.isPending ? (
                      <>
                        <span className="spinner-pulse" style={{ width: '13px', height: '13px', borderWidth: '2px' }} />
                        <span>Asignando...</span>
                      </>
                    ) : (
                      <>
                        <Check size={15} strokeWidth={2.8} />
                        <span>Confirmar Asignación</span>
                      </>
                    )}
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>

      {/* 3. POP-UP DE CONFIRMACIÓN DE DESASIGNACIÓN */}
      <Transition show={isUnassignConfirmOpen} as={React.Fragment}>
        <Dialog
          as="div"
          className="modal-unassign-dialog-root"
          onClose={() => !assignMutation.isPending && setIsUnassignConfirmOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 10050 }}
        >
          <TransitionChild
            as={React.Fragment}
            enter="ease-out duration-150"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.72)', backdropFilter: 'blur(4px)' }} />
          </TransitionChild>

          <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
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
                  maxWidth: '480px',
                  backgroundColor: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-lg, 16px)',
                  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)',
                  border: '1px solid var(--border-subtle)',
                  overflow: 'hidden',
                }}
              >
                <div style={{ padding: '1.1rem 1.4rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <DialogTitle style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.45rem', margin: 0 }}>
                    <UserMinus size={19} style={{ color: '#dc2626' }} />
                    <span>Confirmar Desasignación</span>
                  </DialogTitle>
                  <button
                    onClick={() => setIsUnassignConfirmOpen(false)}
                    disabled={assignMutation.isPending}
                    className="btn-icon-square"
                    style={{ width: '28px', height: '28px' }}
                    title="Cerrar"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div style={{ padding: '1.35rem 1.4rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                    ¿Confirmás desasignar la unidad operativa de <strong>{driver.nombre}</strong>? El chofer quedará disponible sin unidad asignada.
                  </p>

                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.85rem 1rem',
                    backgroundColor: 'var(--bg-surface-muted)',
                    borderRadius: 'var(--radius-md, 10px)',
                    border: '1px solid var(--border-subtle)'
                  }}>
                    <div style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '50%',
                      overflow: 'hidden',
                      flexShrink: 0,
                      border: '2px solid #dc2626'
                    }}>
                      <img
                        src={driver.foto || avatarFallback}
                        alt={driver.nombre}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => { e.target.src = avatarFallback; }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ fontSize: '0.88rem', fontWeight: 900, color: 'var(--text-main)' }}>{driver.nombre}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem', flexWrap: 'wrap' }}>
                        {driver.tractor && <PatenteMercosur patente={driver.tractor} fieldLabel="Tractor" />}
                        {driver.semi && <PatenteMercosur patente={driver.semi} fieldLabel="Semi" />}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{
                  padding: '0.95rem 1.4rem',
                  borderTop: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--bg-surface-muted)',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '0.75rem'
                }}>
                  <button
                    onClick={() => setIsUnassignConfirmOpen(false)}
                    disabled={assignMutation.isPending}
                    style={{
                      padding: '0.5rem 1rem',
                      borderRadius: 'var(--radius-sm, 6px)',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      backgroundColor: 'var(--bg-surface)',
                      color: 'var(--text-main)',
                      border: '1px solid var(--border-strong)',
                      cursor: 'pointer'
                    }}
                  >
                    Cancelar
                  </button>

                  <button
                    onClick={handleUnassign}
                    disabled={assignMutation.isPending}
                    style={{
                      padding: '0.5rem 1.25rem',
                      borderRadius: 'var(--radius-sm, 6px)',
                      fontSize: '0.82rem',
                      fontWeight: 800,
                      backgroundColor: '#dc2626',
                      color: '#ffffff',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem'
                    }}
                  >
                    {assignMutation.isPending ? (
                      <>
                        <span className="spinner-pulse" style={{ width: '13px', height: '13px', borderWidth: '2px' }} />
                        <span>Desasignando...</span>
                      </>
                    ) : (
                      <>
                        <UserMinus size={15} />
                        <span>Confirmar Desasignación</span>
                      </>
                    )}
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>
    </>
  );
};
