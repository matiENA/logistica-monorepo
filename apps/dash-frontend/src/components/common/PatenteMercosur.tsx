import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';

interface PatenteMercosurProps {
  patente?: string | null;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  mostrarToast?: boolean;
}

/**
 * Normaliza y extrae la patente argentina en formato raw data (sin espacios ni símbolos):
 * - ej. "AD 337 AV" -> "AD337AV"
 * - ej. "HQK 842"   -> "HQK842"
 */
export function normalizarPatenteRaw(patenteRaw?: string | null): string {
  if (!patenteRaw) return '';
  const clean = patenteRaw.trim().toUpperCase();
  if (clean === 'S/D' || clean === '-') return '';
  return clean.replace(/[\s\-_.]/g, '');
}

/**
 * Función utilitaria para copiar patente al portapapeles como raw data (sin espacios)
 */
export async function copiarPatenteAlPortapapeles(
  patenteRaw?: string | null,
  conToast = true
): Promise<string> {
  const raw = normalizarPatenteRaw(patenteRaw);
  if (!raw) return '';

  let copiadoExitoso = false;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(raw);
      copiadoExitoso = true;
    } catch {
      // Fallback a execCommand
    }
  }

  if (!copiadoExitoso) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = raw;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      copiadoExitoso = document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch (err) {
      console.warn('Error copiando patente:', err);
    }
  }

  if (copiadoExitoso && conToast) {
    toast.success(`Patente copiada: ${raw}`, {
      duration: 1500,
      description: 'Raw data sin espacios'
    });
  }

  return raw;
}

/**
 * Formatea una patente argentina según su formato oficial con espaciado para visualización:
 * - Mercosur (7 caracteres): XX 000 XX  (ej. AD 337 AV, AH 751 FC)
 * - Pre-Mercosur (6 caracteres): XXX 000  (ej. AAO 123, HQK 842)
 * - Otros: Devuelve la patente normalizada
 */
export function formatearPatente(patenteRaw?: string | null): string {
  if (!patenteRaw) return '';
  const clean = patenteRaw.trim().toUpperCase();
  if (clean === 'S/D' || clean === '-') return clean;

  const stripped = clean.replace(/[\s\-_.]/g, '');

  // Formato Mercosur: 2 letras, 3 dígitos, 2 letras -> XX 000 XX
  if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(stripped)) {
    return stripped.replace(/^([A-Z]{2})(\d{3})([A-Z]{2})$/, '$1 $2 $3');
  }

  // Formato Clásico Pre-Mercosur: 3 letras, 3 dígitos -> XXX 000
  if (/^[A-Z]{3}\d{3}$/.test(stripped)) {
    return stripped.replace(/^([A-Z]{3})(\d{3})$/, '$1 $2');
  }

  // Formato Motos / Histórico: 2 letras, 3 dígitos -> XX 000
  if (/^[A-Z]{2}\d{3}$/.test(stripped)) {
    return stripped.replace(/^([A-Z]{2})(\d{3})$/, '$1 $2');
  }

  return clean;
}

/**
 * Componente de Chapa Patente Mercosur Argentina
 * Réplica 1:1 del diseño oficial:
 * - Borde negro perimetral con esquinas redondeadas
 * - Banda superior azul Mercosur (#003399)
 * - Cuerpo blanco puro con tipografía negra condensada/mono
 * - Espaciado oficial XX 000 XX / XXX 000 para display
 * - EasyCopy al portapapeles en formato RAW DATA (sin espacios) con feedback y toast
 */
export const PatenteMercosur: React.FC<PatenteMercosurProps> = ({
  patente,
  className = '',
  onClick,
  mostrarToast = true
}) => {
  const [copiado, setCopiado] = useState(false);

  const cleanPatente = (patente || '').trim().toUpperCase();

  if (!cleanPatente || cleanPatente === 'S/D' || cleanPatente === '-') {
    return (
      <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase px-1">
        S/D
      </span>
    );
  }

  const patenteVisible = formatearPatente(cleanPatente);
  const patenteRaw = normalizarPatenteRaw(cleanPatente);

  const handleCopiar = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const raw = await copiarPatenteAlPortapapeles(cleanPatente, mostrarToast);
    if (raw) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1400);
    }
    onClick?.(e);
  };

  return (
    <div
      onClick={handleCopiar}
      title={`Copiar ${patenteRaw} (sin espacios)`}
      className={`inline-flex flex-col items-center justify-between bg-white border-[1.5px] border-black rounded-[4px] overflow-hidden shadow-xs cursor-pointer select-all transition-all duration-150 active:scale-95 hover:scale-105 hover:shadow-sm shrink-0 ${className}`}
      style={{
        minWidth: '68px',
        height: '24px',
        boxSizing: 'border-box'
      }}
    >
      {/* Franja Superior Azul Mercosur */}
      <div className="w-full h-[5px] bg-[#003399] shrink-0" />

      {/* Cuerpo de la Patente */}
      <div className="flex-1 w-full flex items-center justify-center px-1.5 pb-0.5 bg-white">
        {copiado ? (
          <span className="text-[9px] font-black text-emerald-700 tracking-tight leading-none animate-pulse flex items-center gap-0.5">
            <Check className="w-2.5 h-2.5 stroke-[3]" />
            <span>COPIADO</span>
          </span>
        ) : (
          <span className="text-[11px] font-black text-black tracking-wide font-mono uppercase leading-none select-all whitespace-nowrap">
            {patenteVisible}
          </span>
        )}
      </div>
    </div>
  );
};
