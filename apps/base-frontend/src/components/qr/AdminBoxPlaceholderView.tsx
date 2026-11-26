import React from 'react';
import { CheckSquare, LayoutGrid, MapPin } from 'lucide-react';
import type { FieldSection } from './QrMobileShell';

interface AdminBoxPlaceholderViewProps {
  zoneName: string;
  onNavigate: (section: FieldSection) => void;
}

export const AdminBoxPlaceholderView: React.FC<AdminBoxPlaceholderViewProps> = ({
  zoneName,
  onNavigate,
}) => {
  return (
    <div className="space-y-4">
      <section
        aria-label="Espacio reservado de Administración de Boxes"
        className="bg-[#11161F] border border-dashed border-slate-600 rounded-xl p-6 text-center space-y-4"
      >
        <div className="w-12 h-12 mx-auto rounded-xl bg-slate-800/90 border border-slate-600 flex items-center justify-center text-emerald-400">
          <LayoutGrid className="w-6 h-6" strokeWidth={2} aria-hidden="true" focusable="false" />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Espacio reservado · {zoneName || 'Tu Zona'}
          </p>
          <h2 className="text-lg font-semibold text-white">Administración de Boxes</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            Acá se integrará el mapa móvil de boxes de tu zona para gestionar asignaciones,
            operarios y movimientos sin volver a escanear QR.
          </p>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onNavigate('llegada')}
          className="h-12 px-4 rounded-xl bg-[#11161F] hover:bg-slate-800 active:scale-[0.98] border border-slate-600 text-slate-100 text-base font-medium inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A0F] transition-transform"
        >
          <MapPin className="w-5 h-5 text-emerald-400 shrink-0" strokeWidth={2} aria-hidden="true" />
          <span>Llegada</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('salida')}
          className="h-12 px-4 rounded-xl bg-[#11161F] hover:bg-slate-800 active:scale-[0.98] border border-slate-600 text-slate-100 text-base font-medium inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A0F] transition-transform"
        >
          <CheckSquare className="w-5 h-5 text-slate-200 shrink-0" strokeWidth={2} aria-hidden="true" />
          <span>Salida</span>
        </button>
      </div>
    </div>
  );
};
