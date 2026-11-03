import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { UserCheck, Calendar, Phone, CheckCircle, Clock } from 'lucide-react';

export const InduccionesModule = () => {
  const { data: inducciones, isLoading, isError, error } = useQuery({
    queryKey: ['inducciones_recientes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('view_inducciones_recientes')
        .select('*');
      if (error) throw error;
      return data || [];
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Sin fecha';
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
      return dateStr;
    } catch (_) {
      return dateStr;
    }
  };

  return (
    <div className="module-container">
      <div className="module-header">
        <div>
          <h2 className="module-title">Inducciones y Nuevos Ingresos</h2>
          <p className="module-subtitle">Seguimiento de exámenes de chofer, habilitaciones y fecha de ingreso</p>
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center' }}>
          <div className="spinner-pulse" />
          <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)' }}>Cargando inducciones recientes...</p>
        </div>
      ) : isError ? (
        <div style={{ padding: '2rem', color: '#dc2626' }}>Error: {error?.message}</div>
      ) : (inducciones || []).length === 0 ? (
        <div style={{ padding: '4rem 2rem', textAlign: 'center', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--border-strong)' }}>
          <UserCheck size={40} style={{ color: 'var(--text-muted)', margin: '0 auto 0.75rem auto' }} />
          <h4 style={{ fontWeight: 800 }}>No hay inducciones activas registradas</h4>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Las novedades clasificadas como Examen Chofer o Inducción aparecerán aquí automáticamente.</p>
        </div>
      ) : (
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Conductor</th>
                <th>Servicio</th>
                <th>Fecha Inducción / Examen</th>
                <th>Teléfono</th>
                <th>Detalle / Estado</th>
                <th style={{ textAlign: 'center' }}>Resolución</th>
              </tr>
            </thead>
            <tbody>
              {inducciones.map((ind) => (
                <tr key={ind.novedad_id}>
                  <td style={{ fontWeight: 800 }}>{ind.chofer_nombre}</td>
                  <td>
                    <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{ind.servicio || 'S/A'}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600 }}>
                      <Calendar size={14} style={{ color: 'var(--text-muted)' }} />
                      <span>{formatDate(ind.fecha_induccion)}</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem' }}>
                      <Phone size={13} style={{ color: 'var(--text-muted)' }} />
                      <span>{ind.chofer_telefono || 'S/D'}</span>
                    </div>
                  </td>
                  <td style={{ maxWidth: '350px' }}>
                    {ind.detalle || <span style={{ color: 'var(--text-muted)' }}>-</span>}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {ind.resuelto ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: '#059669', fontWeight: 700, fontSize: '0.78rem' }}>
                        <CheckCircle size={14} /> Resuelto
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: '#d97706', fontWeight: 700, fontSize: '0.78rem' }}>
                        <Clock size={14} /> Pendiente
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
