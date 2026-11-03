import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { Truck, Users, AlertTriangle, CheckCircle, Clock } from 'lucide-react';

/**
 * 📦 MODULO DE MÉTRICAS (LEGACY)
 * Archivador histórico: Retirado de la navegación principal el 29/09/2026.
 * Preservado para referencia o futura reincorporación en un panel estadístico dedicado.
 * 
 * Dependencia de Base de Datos:
 * Vista PostgreSQL 'public.view_dashboard_kpis'
 */
export const MetricasModule = () => {
  const { data: kpi, isLoading, isError, error } = useQuery({
    queryKey: ['view_dashboard_kpis'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('view_dashboard_kpis')
        .select('*')
        .single();
      if (error) throw error;
      return data || {};
    },
    staleTime: 1000 * 60 * 3, // 3 min en RAM
    gcTime: 1000 * 60 * 20,
  });

  if (isLoading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <div className="spinner-pulse" />
        <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)' }}>Calculando métricas del sistema en Postgres...</p>
      </div>
    );
  }

  if (isError) {
    return <div style={{ padding: '2rem', color: '#dc2626' }}>Error cargando métricas: {error?.message}</div>;
  }

  return (
    <div className="module-container">
      <div className="module-header">
        <div>
          <h2 className="module-title">Métricas Operativas y Disponibilidad (Legacy)</h2>
          <p className="module-subtitle">Indicadores globales precalculados en Supabase PostgreSQL</p>
        </div>
      </div>

      {/* Grid de KPIs */}
      <div className="kpi-grid">
        {/* Unidades Circulando */}
        <div className="kpi-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="kpi-label">Flota Circulando</span>
            <Truck size={20} style={{ color: 'var(--status-circulando)' }} />
          </div>
          <div className="kpi-value" style={{ color: 'var(--status-circulando)' }}>
            {kpi.unidades_circulando || 0}
          </div>
          <span className="kpi-subtext">De un total de {kpi.total_unidades || 0} unidades registradas</span>
        </div>

        {/* Unidades Disponibles */}
        <div className="kpi-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="kpi-label">Unidades Disponibles</span>
            <Truck size={20} style={{ color: 'var(--status-disponible)' }} />
          </div>
          <div className="kpi-value" style={{ color: 'var(--status-disponible)' }}>
            {kpi.unidades_disponibles || 0}
          </div>
          <span className="kpi-subtext">Listas para asignación de viaje</span>
        </div>

        {/* Choferes en Ruta */}
        <div className="kpi-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="kpi-label">Conductores Activos</span>
            <Users size={20} style={{ color: 'var(--primary)' }} />
          </div>
          <div className="kpi-value" style={{ color: 'var(--primary)' }}>
            {kpi.choferes_circulando || 0}
          </div>
          <span className="kpi-subtext">De {kpi.total_choferes || 0} conductores en catálogo</span>
        </div>

        {/* Novedades Pendientes */}
        <div className="kpi-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="kpi-label">Novedades Pendientes</span>
            <Clock size={20} style={{ color: '#d97706' }} />
          </div>
          <div className="kpi-value" style={{ color: '#d97706' }}>
            {kpi.novedades_pendientes || 0}
          </div>
          <span className="kpi-subtext">{kpi.novedades_resueltas || 0} resueltas históricamente</span>
        </div>

        {/* Alertas VTV Críticas */}
        <div className="kpi-card" style={{ borderColor: '#fca5a5' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="kpi-label" style={{ color: '#dc2626' }}>VTV Vencidas</span>
            <AlertTriangle size={20} style={{ color: '#dc2626' }} />
          </div>
          <div className="kpi-value" style={{ color: '#dc2626' }}>
            {kpi.alertas_vtv_vencidas || 0}
          </div>
          <span className="kpi-subtext">{kpi.alertas_vtv_por_vencer || 0} vencen en los próximos 15 días</span>
        </div>
      </div>
    </div>
  );
};
