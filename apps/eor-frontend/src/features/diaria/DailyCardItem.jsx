import React from 'react';
import { CheckCircle2, RotateCcw, Calendar, Truck, User } from 'lucide-react';
import { useToggleResolveCard } from './useDailyCards';

export const DailyCardItem = ({ card }) => {
  const toggleResolve = useToggleResolveCard();

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Sin fecha';
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
      return dateStr;
    } catch (_) {
      return dateStr;
    }
  };

  const isResolved = Boolean(card.resuelto);

  return (
    <article className={`daily-card-row ${isResolved ? 'card-resolved' : ''}`}>
      {/* Indicador de Color lateral */}
      <div className={`card-indicator-strip type-${card.tipo}`} />

      {/* Metadatos Izquierda: Tipo de Novedad y Fecha */}
      <div className="card-left-meta">
        <span className={`card-type-chip chip-${card.tipo}`}>
          {card.tipo ? card.tipo.replace(/_/g, ' ') : 'GENERAL'}
        </span>
        <div className="card-date-text" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <Calendar size={13} />
          <span>{formatDate(card.fecha)}</span>
        </div>
      </div>

      {/* Contenido Central: Chofer, Unidad y Detalle */}
      <div className="card-body-content">
        <div className="card-driver-name" title={card.chofer_nombre}>
          {card.chofer_nombre || 'Sin Chofer Asignado'}
        </div>

        <div className="card-equipment-row">
          <span className="equip-item">
            <Truck size={14} />
            <span>Tractor: <strong>{card.tractor || 'S/D'}</strong></span>
          </span>
          {card.semi && (
            <span className="equip-item">
              <span>Semi: <strong>{card.semi}</strong></span>
            </span>
          )}
          {card.n_ute && (
            <span className="equip-item">
              <span>N°: <strong>{card.n_ute}</strong></span>
            </span>
          )}
          {card.servicio && (
            <span className="equip-item" style={{ color: 'var(--primary)', fontWeight: 700 }}>
              [{card.servicio}]
            </span>
          )}
        </div>

        {card.detalle && (
          <div className="card-detail-box">
            {card.detalle}
          </div>
        )}
      </div>

      {/* Acciones Derecha: Botón Resolver / Reabrir */}
      <div className="card-actions-col">
        <button
          className={`btn-resolve-toggle ${isResolved ? 'resolved' : 'pending'}`}
          onClick={() => toggleResolve.mutate({ cardId: card.card_id, resuelto: card.resuelto })}
          disabled={toggleResolve.isPending}
          title={isResolved ? 'Reabrir novedad pendiente' : 'Marcar como resuelto'}
        >
          {isResolved ? (
            <>
              <RotateCcw size={14} />
              <span>Reabrir</span>
            </>
          ) : (
            <>
              <CheckCircle2 size={14} />
              <span>Resolver</span>
            </>
          )}
        </button>
      </div>
    </article>
  );
};
