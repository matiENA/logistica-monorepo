import React, { useState } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { X, Plus, Calendar, Truck, User, AlignLeft } from 'lucide-react';
import { useCreateCard } from './useDailyCards';

export const DailyCardModal = ({ isOpen, onClose }) => {
  const [formData, setFormData] = useState({
    nom: '',
    tractor: '',
    semi: '',
    n_ute: '',
    srv: 'LIVIANO',
    tipo_novedad: 'CERTIFICACION_UNIDAD',
    fecha_objetivo: new Date().toISOString().substring(0, 10),
    detalle: '',
  });

  const createCard = useCreateCard();

  const handleSubmit = (e) => {
    e.preventDefault();
    createCard.mutate(formData, {
      onSuccess: () => {
        onClose();
        setFormData({
          nom: '',
          tractor: '',
          semi: '',
          n_ute: '',
          srv: 'LIVIANO',
          tipo_novedad: 'CERTIFICACION_UNIDAD',
          fecha_objetivo: new Date().toISOString().substring(0, 10),
          detalle: '',
        });
      },
    });
  };

  const tipos = [
    { id: 'LIBRES', label: 'Libres' },
    { id: 'CERTIFICACION_UNIDAD', label: 'Certificación de Unidad' },
    { id: 'REPARACION', label: 'Reparaciones Requeridas' },
    { id: 'BAJA_DIAGRAMA', label: 'Baja / Término Diagrama' },
    { id: 'EXAMEN_CHOFER', label: 'Examen Chofer' },
    { id: 'EN_SERVICIO', label: 'En Servicio' },
  ];

  return (
    <Transition show={isOpen}>
      <Dialog onClose={onClose} style={{ position: 'relative', zIndex: 100 }}>
        {/* Backdrop */}
        <TransitionChild
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="drawer-backdrop" />
        </TransitionChild>

        <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <TransitionChild
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
                borderRadius: 'var(--radius-lg)',
                padding: '1.5rem',
                border: '1px solid var(--border-subtle)',
                boxShadow: 'var(--shadow-lg)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                <DialogTitle style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  Reportar Nueva Novedad
                </DialogTitle>
                <button onClick={onClose} className="btn-icon-square" style={{ width: '32px', height: '32px' }}>
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Tipo de Novedad */}
                <div>
                  <label className="filter-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Clasificación</label>
                  <select
                    value={formData.tipo_novedad}
                    onChange={(e) => setFormData({ ...formData, tipo_novedad: e.target.value })}
                    className="filter-search-input"
                    style={{ paddingLeft: '0.75rem' }}
                  >
                    {tipos.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </div>

                {/* Chofer */}
                <div>
                  <label className="filter-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Conductor</label>
                  <input
                    type="text"
                    required
                    placeholder="Nombre completo del chofer"
                    value={formData.nom}
                    onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
                    className="filter-search-input"
                    style={{ paddingLeft: '0.75rem' }}
                  />
                </div>

                {/* Tractor y Semi */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="filter-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Tractor (Patente)</label>
                    <input
                      type="text"
                      placeholder="Ej: AG484BE"
                      value={formData.tractor}
                      onChange={(e) => setFormData({ ...formData, tractor: e.target.value.toUpperCase() })}
                      className="filter-search-input"
                      style={{ paddingLeft: '0.75rem' }}
                    />
                  </div>
                  <div>
                    <label className="filter-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Semi (Patente)</label>
                    <input
                      type="text"
                      placeholder="Ej: LEM786"
                      value={formData.semi}
                      onChange={(e) => setFormData({ ...formData, semi: e.target.value.toUpperCase() })}
                      className="filter-search-input"
                      style={{ paddingLeft: '0.75rem' }}
                    />
                  </div>
                </div>

                {/* Servicio y Fecha Objetivo */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="filter-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Servicio</label>
                    <select
                      value={formData.srv}
                      onChange={(e) => setFormData({ ...formData, srv: e.target.value })}
                      className="filter-search-input"
                      style={{ paddingLeft: '0.75rem' }}
                    >
                      <option value="LIVIANO">LIVIANO</option>
                      <option value="METANOL">METANOL</option>
                      <option value="CAMPO">CAMPO</option>
                      <option value="GLP">GLP</option>
                      <option value="TDS">TDS</option>
                      <option value="EURO">EURO</option>
                    </select>
                  </div>
                  <div>
                    <label className="filter-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Fecha Objetivo</label>
                    <input
                      type="date"
                      value={formData.fecha_objetivo}
                      onChange={(e) => setFormData({ ...formData, fecha_objetivo: e.target.value })}
                      className="filter-search-input"
                      style={{ paddingLeft: '0.75rem' }}
                    />
                  </div>
                </div>

                {/* Detalle */}
                <div>
                  <label className="filter-label" style={{ display: 'block', marginBottom: '0.4rem' }}>Detalle / Observación</label>
                  <textarea
                    rows={3}
                    placeholder="Comentarios u observaciones de la novedad..."
                    value={formData.detalle}
                    onChange={(e) => setFormData({ ...formData, detalle: e.target.value })}
                    className="filter-search-input"
                    style={{ paddingLeft: '0.75rem', resize: 'vertical' }}
                  />
                </div>

                {/* Acciones Modal */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.75rem' }}>
                  <button
                    type="button"
                    onClick={onClose}
                    className="filter-chip-btn"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={createCard.isPending}
                    style={{
                      padding: '0.55rem 1.25rem',
                      backgroundColor: 'var(--primary-solid)',
                      color: 'var(--on-primary-solid)',
                      borderRadius: 'var(--radius-md)',
                      fontWeight: 800,
                      fontSize: '0.85rem',
                    }}
                  >
                    {createCard.isPending ? 'Guardando...' : 'Crear Novedad'}
                  </button>
                </div>
              </form>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
};
