import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { Calendar, Search } from 'lucide-react';

export const DiagramaModule = () => {
  const [mesTab, setMesTab] = useState('Sep-26');
  const [servicio, setServicio] = useState('TODOS');
  const [search, setSearch] = useState('');

  const mesesDisponibles = ['Sep-26', 'Ago-26', 'Jul-26', 'Jun-26', 'May-26', 'Abr-26'];
  const servicios = ['TODOS', 'LIVIANO', 'METANOL', 'CAMPO', 'GLP', 'TDS', 'EURO'];

  const { data: diagramas, isLoading, isError, error } = useQuery({
    queryKey: ['diagrama_mensual', mesTab, { servicio }],
    queryFn: async () => {
      let query = supabase
        .from('view_diagrama_mensual')
        .select('*')
        .eq('mes_tab', mesTab);

      if (servicio && servicio !== 'TODOS') {
        query = query.eq('servicio', servicio);
      }

      const { data, error } = await query.order('chofer_nombre');
      if (error) throw error;
      return data || [];
    },
    staleTime: 1000 * 60 * 10, // 10 min en RAM
    gcTime: 1000 * 60 * 60,
  });

  const filteredDiagramas = (diagramas || []).filter((d) => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    const matchNom = d.chofer_nombre && d.chofer_nombre.toLowerCase().includes(term);
    const matchTr = d.tractor && d.tractor.toLowerCase().includes(term);
    return matchNom || matchTr;
  });

  const getDayClass = (val) => {
    if (!val) return '';
    const v = val.trim().toUpperCase();
    if (v === 'F' || v.startsWith('F')) return 'franco';
    if (v === 'V' || v.startsWith('V')) return 'vacaciones';
    if (['E', 'ART', 'IND', 'S', 'A', 'P', 'MED'].some((k) => v.includes(k))) return 'ausencia';
    return 'work';
  };

  return (
    <div className="module-container">
      {/* Header */}
      <div className="module-header">
        <div>
          <h2 className="module-title">Grilla Operativa de Diagramas</h2>
          <p className="module-subtitle">Planificación mensual consolidada, rotaciones y días computados</p>
        </div>

        {/* Controles de Consulta */}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="filter-search-box" style={{ width: '220px' }}>
            <Search size={15} className="filter-search-icon" />
            <input
              type="text"
              placeholder="Buscar conductor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="filter-search-input"
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Calendar size={16} style={{ color: 'var(--primary)' }} />
            <select
              value={mesTab}
              onChange={(e) => setMesTab(e.target.value)}
              className="filter-search-input"
              style={{ width: '110px', paddingLeft: '0.75rem', fontWeight: 800 }}
            >
              {mesesDisponibles.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <select
            value={servicio}
            onChange={(e) => setServicio(e.target.value)}
            className="filter-search-input"
            style={{ width: '130px', paddingLeft: '0.75rem' }}
          >
            {servicios.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Grilla Mensual */}
      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center' }}>
          <div className="spinner-pulse" />
          <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)' }}>Cargando diagrama mensual en memoria RAM...</p>
        </div>
      ) : isError ? (
        <div style={{ padding: '2rem', color: '#dc2626' }}>Error: {error?.message}</div>
      ) : (
        <div className="data-table-wrapper">
          <table className="data-table diagrama-grid-table">
            <thead>
              <tr>
                <th style={{ minWidth: '180px' }}>Conductor</th>
                <th>Servicio</th>
                <th>Tractor</th>
                {/* Días 1 al 31 */}
                {Array.from({ length: 31 }, (_, i) => (
                  <th key={i + 1} style={{ textAlign: 'center', padding: '0.5rem 0.2rem' }}>{i + 1}</th>
                ))}
                <th style={{ textAlign: 'center' }}>Trab.</th>
                <th style={{ textAlign: 'center' }}>Francos</th>
              </tr>
            </thead>
            <tbody>
              {filteredDiagramas.map((d) => {
                const diasArray = (d.tira_dias || '').split(',');
                return (
                  <tr key={d.registro_id}>
                    <td style={{ fontWeight: 700 }}>{d.chofer_nombre}</td>
                    <td><span style={{ fontWeight: 700, color: 'var(--primary)' }}>{d.servicio}</span></td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{d.tractor || '-'}</td>
                    {Array.from({ length: 31 }, (_, i) => {
                      const val = diasArray[i] || '';
                      return (
                        <td key={i} className="cell-day">
                          {val ? (
                            <span className={`day-badge ${getDayClass(val)}`} title={`Día ${i + 1}: ${val}`}>
                              {val}
                            </span>
                          ) : '-'}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'center', fontWeight: 800, color: '#1e40af' }}>{d.dias_trabajados}</td>
                    <td style={{ textAlign: 'center', fontWeight: 800, color: '#64748b' }}>{d.dias_francos}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
