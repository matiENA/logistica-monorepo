import React from 'react';

export function formatPlateDisplay(raw: string): string {
  const clean = (raw || '').replace(/[\s-]/g, '').toUpperCase();
  if (!clean) return '---';
  const mercosur = clean.match(/^([A-Z]{2})(\d{3})([A-Z]{2})$/);
  if (mercosur) {
    return `${mercosur[1]} ${mercosur[2]} ${mercosur[3]}`;
  }
  const nacional = clean.match(/^([A-Z]{3})(\d{3})$/);
  if (nacional) {
    return `${nacional[1]} ${nacional[2]}`;
  }
  return clean;
}

interface UnitLicensePlateProps {
  plate: string;
  label: 'Tractor' | 'Semi';
  topBadge?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}

export const UnitLicensePlate: React.FC<UnitLicensePlateProps> = ({
  plate,
  label,
  topBadge,
  size = 'md',
  className = '',
}) => {
  const hasPlate = Boolean(plate && plate.trim() !== '');
  const formattedPlate = hasPlate ? formatPlateDisplay(plate) : '---';
  const widthClass = size === 'sm' ? 'w-[104px]' : 'w-[118px]';
  const textClass = size === 'sm' ? 'text-[12px] py-0.5' : 'text-[13px] py-1';

  return (
    <div
      className={`flex flex-col items-center ${widthClass} ${className}`}
      title={`${label}: ${formattedPlate}`}
    >
      {topBadge ? (
        <div className="z-10 -mb-[5px] bg-white border border-zinc-800 rounded-[4px] px-2 py-[1px] text-[10px] leading-tight font-semibold text-zinc-900 shadow-xs min-w-[46px] text-center truncate max-w-full">
          {topBadge}
        </div>
      ) : null}

      <div className="w-full bg-white border-[1.5px] border-zinc-800 rounded-[5px] overflow-hidden shadow-xs">
        <div className="w-full h-[5px] bg-[#0046B8]" />
        <div
          className={`w-full text-center px-1 leading-tight font-extrabold tracking-tight whitespace-nowrap font-plate ${textClass} ${
            hasPlate ? 'text-zinc-950' : 'text-zinc-400'
          }`}
        >
          {formattedPlate}
        </div>
      </div>
    </div>
  );
};
