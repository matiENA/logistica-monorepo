import React from 'react';

interface LicensePlateProps {
  plate: string;
  ot?: string;
  brand?: string;
  brandColor?: string;
  type?: 'TRACTOR' | 'SEMI';
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showOtBadge?: boolean;
}

export const LicensePlate: React.FC<LicensePlateProps> = ({
  plate,
  ot,
  brand,
  brandColor,
  type = 'TRACTOR',
  className = '',
  size = 'md',
  showOtBadge = false,
}) => {
  if (!plate || plate.trim() === '') {
    return <span className="text-panol-text-dim text-xs">---</span>;
  }

  // Formatear patente separando si es nueva (ej. AG 426 OO) o vieja (ej. LEM 786)
  const cleanPlate = plate.toUpperCase().trim();
  
  // Colores por defecto para las marcas del taller
  const defaultBrandColor = useMemoBrandColor(brand || (type === 'TRACTOR' ? 'IVECO' : 'DANES'), brandColor);

  const containerWidth = {
    sm: 'w-[100px]',
    md: 'w-[115px]',
    lg: 'w-[130px]',
  }[size];

  const fontSize = {
    sm: 'text-[11px] py-1',
    md: 'text-[13px] py-1.5',
    lg: 'text-[15px] py-2',
  }[size];

  return (
    <div className={`inline-flex flex-col items-center gap-1 ${className}`}>
      {/* Badge superior: OT + MARCA (como en el diseño) */}
      {(showOtBadge || ot || brand) && (
        <div className="inline-flex items-center rounded overflow-hidden text-[9px] font-black font-mono shadow-sm border border-zinc-700">
          <span className="bg-white text-zinc-950 px-1.5 py-0.2">
            {ot || '--'}
          </span>
          <span
            className="text-white px-1.5 py-0.2 uppercase tracking-tight"
            style={{ backgroundColor: defaultBrandColor }}
          >
            {brand || (type === 'TRACTOR' ? 'TRACTOR' : 'SEMI')}
          </span>
        </div>
      )}

      {/* Chapa Patente con Barra Superior Azul */}
      <div
        className={`bg-white rounded-[4px] border border-zinc-400/80 shadow-md flex flex-col items-center justify-between overflow-hidden ${containerWidth}`}
        style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }}
      >
        {/* Barra superior azul Mercosur / Nacional */}
        <div className="w-full h-[5px] bg-[#003399]" />

        {/* Texto de la patente */}
        <div className={`w-full text-center font-extrabold text-zinc-950 tracking-wider ${fontSize}`}
             style={{ fontFamily: '"FE-Font", "FE-FONT", "JetBrains Mono", sans-serif' }}>
          {cleanPlate}
        </div>
      </div>
    </div>
  );
};

function useMemoBrandColor(brandName: string, customColor?: string): string {
  if (customColor) return customColor;
  const b = brandName.toUpperCase();
  if (b.includes('IVECO')) return '#1D4ED8';
  if (b.includes('DANES')) return '#0D9488';
  if (b.includes('VOLVO')) return '#0284C7';
  if (b.includes('FANGIO')) return '#059669';
  if (b.includes('SCANIA')) return '#B91C1C';
  if (b.includes('MERCEDES')) return '#475569';
  return '#2563EB';
}
