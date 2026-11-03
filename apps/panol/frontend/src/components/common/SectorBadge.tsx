import React from 'react';
import { SectorType } from '../../types';

interface SectorBadgeProps {
  sector?: SectorType | string;
  className?: string;
}

const SECTOR_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  GOMERIA: { bg: 'bg-amber-100 dark:bg-amber-950/40', text: 'text-amber-800 dark:text-amber-300', border: 'border-amber-400' },
  MECANICA: { bg: 'bg-blue-100 dark:bg-blue-950/40', text: 'text-blue-800 dark:text-blue-300', border: 'border-blue-400' },
  ELECTRICIDAD: { bg: 'bg-purple-100 dark:bg-purple-950/40', text: 'text-purple-800 dark:text-purple-300', border: 'border-purple-400' },
  LAVADERO: { bg: 'bg-cyan-100 dark:bg-cyan-950/40', text: 'text-cyan-800 dark:text-cyan-300', border: 'border-cyan-400' },
  ENGRASE: { bg: 'bg-emerald-100 dark:bg-emerald-950/40', text: 'text-emerald-800 dark:text-emerald-300', border: 'border-emerald-400' },
  LUBRICENTRO: { bg: 'bg-teal-100 dark:bg-teal-950/40', text: 'text-teal-800 dark:text-teal-300', border: 'border-teal-400' },
  MOTORES: { bg: 'bg-orange-100 dark:bg-orange-950/40', text: 'text-orange-800 dark:text-orange-300', border: 'border-orange-400' },
  CARROCERIA: { bg: 'bg-rose-100 dark:bg-rose-950/40', text: 'text-rose-800 dark:text-rose-300', border: 'border-rose-400' },
  VTV: { bg: 'bg-indigo-100 dark:bg-indigo-950/40', text: 'text-indigo-800 dark:text-indigo-300', border: 'border-indigo-400' },
};

export const SectorBadge: React.FC<SectorBadgeProps> = ({ sector, className = '' }) => {
  const normSector = (sector || 'DEFAULT').toUpperCase();
  const style = SECTOR_STYLES[normSector] || {
    bg: 'bg-slate-100 dark:bg-slate-800',
    text: 'text-slate-800 dark:text-slate-300',
    border: 'border-slate-400',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider border ${style.bg} ${style.text} ${style.border} ${className}`}
    >
      {normSector}
    </span>
  );
};
