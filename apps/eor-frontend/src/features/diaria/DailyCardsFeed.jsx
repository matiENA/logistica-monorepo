import React, { useEffect, useRef } from 'react';
import { DailyCardItem } from './DailyCardItem';
import { useDailyCardsInfinite } from './useDailyCards';
import { Inbox, AlertCircle } from 'lucide-react';

export const DailyCardsFeed = ({ filters }) => {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = useDailyCardsInfinite(filters);

  const sentinelRef = useRef(null);

  // IntersectionObserver para Scroll Infinito
  useEffect(() => {
    if (!sentinelRef.current || !hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isLoading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <div className="spinner-pulse" />
        <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>
          Cargando tarjetas diarias en memoria RAM...
        </p>
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', backgroundColor: 'var(--novedad-a-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--novedad-a-border)' }}>
        <AlertCircle size={28} style={{ color: 'var(--novedad-a-text)', margin: '0 auto 0.5rem auto' }} />
        <h4 style={{ fontWeight: 800, color: 'var(--novedad-a-text)' }}>Error consultando vista de tarjetas</h4>
        <p style={{ fontSize: '0.82rem', color: 'var(--novedad-a-text)', marginTop: '0.25rem' }}>{error?.message || 'Error desconocido'}</p>
      </div>
    );
  }

  const allCards = data?.pages?.flatMap((page) => page.cards) || [];
  const totalCount = data?.pages?.[0]?.totalCount || allCards.length;

  if (allCards.length === 0) {
    return (
      <div style={{ padding: '4rem 1rem', textAlign: 'center', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--border-strong)' }}>
        <Inbox size={42} style={{ color: 'var(--text-muted)', margin: '0 auto 0.75rem auto' }} />
        <h4 style={{ fontWeight: 800, color: 'var(--text-main)' }}>No se encontraron novedades</h4>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
          Prueba cambiando los filtros seleccionados o registra una nueva novedad.
        </p>
      </div>
    );
  }

  return (
    <div className="cards-feed-wrapper">
      {/* Indicador de Conteo */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 0.25rem' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 700 }}>
          Mostrando {allCards.length} de {totalCount} novedades
        </span>
      </div>

      {/* Lista de Tarjetas Diarias */}
      {allCards.map((card) => (
        <DailyCardItem key={card.card_id || card.legacy_id} card={card} />
      ))}

      {/* Centinela de Scroll Infinito */}
      <div ref={sentinelRef} className="infinite-scroll-sentinel">
        {isFetchingNextPage ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <span className="spinner-pulse" style={{ width: '18px', height: '18px' }} />
            <span>Cargando más tarjetas...</span>
          </div>
        ) : hasNextPage ? (
          <span>Desplaza hacia abajo para cargar más</span>
        ) : (
          <span>Fin de las novedades</span>
        )}
      </div>
    </div>
  );
};
