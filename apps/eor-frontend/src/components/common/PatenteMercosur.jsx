import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { copyToClipboard, normalizarPatenteRaw, formatearPatenteVisual } from '@/utils/clipboard';

/**
 * Componente de Chapa Patente Mercosur Argentina (Réplica 1:1 pura)
 * - Borde negro perimetral (1.5px) con esquinas redondeadas (4px)
 * - Franja superior azul Mercosur (#003399)
 * - Cuerpo blanco puro con tipografía negra sólida (XX 000 XX / XXX 000)
 * - Sin recuadro dashed ni ícono externo
 * - Clic copia en formato RAW DATA (sin espacios, ej. "AD337AV")
 */
export const PatenteMercosur = ({
  patente,
  fieldLabel = 'Patente',
  variant = 'inline', // 'inline' | 'field'
  className = '',
}) => {
  const [copied, setCopied] = useState(false);

  const patenteRaw = normalizarPatenteRaw(patente);
  const patenteVisible = formatearPatenteVisual(patente);
  const hasValidPatente = Boolean(patenteRaw);

  const handleCopy = async (e) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!hasValidPatente) return;

    const ok = await copyToClipboard(patenteRaw, fieldLabel || 'Patente', e);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  if (!hasValidPatente) {
    return (
      <span className="patente-empty-val" title={`Sin ${fieldLabel || 'patente'} asignada`}>
        —
      </span>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCopy}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleCopy(e);
      }}
      className={`patente-mercosur-plate patente-plate-${variant} ${copied ? 'copied' : ''} ${className}`}
      title={`Copiar ${patenteRaw} (sin espacios)`}
      aria-label={`Copiar ${fieldLabel || 'Patente'} ${patenteRaw}`}
    >
      {/* Franja Superior Azul Mercosur */}
      <div className="patente-mercosur-band" />

      {/* Cuerpo Blanco de la Patente */}
      <div className="patente-mercosur-body">
        {copied ? (
          <span className="patente-mercosur-copied-text">
            <Check size={10} strokeWidth={3} />
            <span>COPIADO</span>
          </span>
        ) : (
          <span className="patente-mercosur-text">{patenteVisible}</span>
        )}
      </div>
    </div>
  );
};
