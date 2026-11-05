import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { toast } from 'sonner';

interface DriverNameBadgeProps {
  nombre?: string | null;
  className?: string;
  textClassName?: string;
  mostrarToast?: boolean;
  maxWidthClass?: string;
  style?: React.CSSProperties;
}

/**
 * Componente unificado para renderizado y copiado de nombres de choferes.
 * Inspirado en el sistema de diseño de EOR (Movimientos / DailyDriverCard):
 * - Estilo badge con borde dashed de 1px
 * - Tipografía compacta y en negrita
 * - EasyCopy al portapapeles con feedback visual interactivo y toast sonner
 */
export const DriverNameBadge: React.FC<DriverNameBadgeProps> = ({
  nombre,
  className = '',
  textClassName = 'text-xs font-black',
  mostrarToast = true,
  maxWidthClass = 'max-w-full',
  style
}) => {
  const [copiado, setCopiado] = useState(false);

  const cleanNombre = String(nombre || '').trim().toUpperCase();

  if (!cleanNombre || cleanNombre === '-' || cleanNombre === 'S/D') {
    return (
      <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase select-none">
        —
      </span>
    );
  }

  if (cleanNombre === 'SIN CONDUCTOR') {
    return (
      <span className="text-[12px] font-extrabold text-black/60 dark:text-white/60 uppercase tracking-tight select-none">
        SIN CONDUCTOR
      </span>
    );
  }

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    let exito = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(cleanNombre);
        exito = true;
      } catch {
        // Fallback a textarea
      }
    }

    if (!exito) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = cleanNombre;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        exito = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch (err) {
        console.warn('Error copiando nombre:', err);
      }
    }

    if (exito) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1400);

      if (mostrarToast) {
        toast.success(`Nombre copiado: ${cleanNombre}`, {
          duration: 1500
        });
      }
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCopy}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleCopy(e as any);
      }}
      title="Clic para copiar nombre completo"
      style={style}
      className={`group/name inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border border-dashed transition-all duration-150 cursor-pointer select-none shrink-0 ${maxWidthClass} ${
        copiado
          ? 'border-emerald-500 bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 shadow-xs'
          : 'border-slate-300/80 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-900/40 text-slate-900 dark:text-slate-100 hover:border-indigo-500 dark:hover:border-indigo-400 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20'
      } ${className}`}
    >
      <span className={`uppercase tracking-tight truncate leading-tight flex-1 ${textClassName}`}>
        {cleanNombre}
      </span>

      {copiado ? (
        <span className="flex items-center gap-0.5 text-[9px] font-black tracking-tighter text-emerald-600 dark:text-emerald-400 shrink-0 animate-in fade-in zoom-in-95 duration-100">
          <Check className="w-3 h-3 stroke-[3]" />
          <span>COPIADO</span>
        </span>
      ) : (
        <Copy className="w-2.5 h-2.5 text-slate-400 dark:text-slate-500 group-hover/name:text-indigo-600 dark:group-hover/name:text-indigo-400 shrink-0 opacity-70 group-hover/name:opacity-100 transition-opacity" />
      )}
    </div>
  );
};
