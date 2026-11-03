import React, { useState, useEffect } from 'react';
import { useDashStore } from '../../store/useDashStore';
import { ServicioDrop } from '../../types/dash';

interface ServiceDropOverlayProps {
  onAsignarServicioYResolver: (cardId: string | number, servicio: string) => void;
}

interface ServiceItemConfig {
  id: ServicioDrop;
  label: string;
  desc: string;
  badgeColor: string;
  borderDefault: string;
  borderActive: string;
  bgDefault: string;
  bgActive: string;
  shadowActive: string;
  textAccent: string;
}

export const ServiceDropOverlay: React.FC<ServiceDropOverlayProps> = ({
  onAsignarServicioYResolver
}) => {
  const { overlayServiceAbierto, activeDragCardId, setActiveDragCardId } = useDashStore();
  const [highlightedZone, setHighlightedZone] = useState<string | null>(null);

  // Escuchar tecla Escape para cancelar el arrastre
  useEffect(() => {
    if (!overlayServiceAbierto) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveDragCardId(null);
        setHighlightedZone(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [overlayServiceAbierto, setActiveDragCardId]);

  if (!overlayServiceAbierto || !activeDragCardId) return null;

  const servicios: ServiceItemConfig[] = [
    {
      id: 'CM',
      label: 'CM',
      desc: 'CAMPO',
      badgeColor: 'bg-emerald-500',
      borderDefault: 'border-emerald-500/40 hover:border-emerald-400',
      borderActive: 'border-emerald-400',
      bgDefault: 'bg-emerald-950/20 hover:bg-emerald-950/40',
      bgActive: 'bg-emerald-500/30 ring-4 ring-emerald-400/50',
      shadowActive: 'shadow-2xl shadow-emerald-500/50 scale-[1.03]',
      textAccent: 'text-emerald-300'
    },
    {
      id: 'EURO',
      label: 'EURO',
      desc: 'DOCK SUD / EURO',
      badgeColor: 'bg-amber-500',
      borderDefault: 'border-amber-500/40 hover:border-amber-400',
      borderActive: 'border-amber-400',
      bgDefault: 'bg-amber-950/20 hover:bg-amber-950/40',
      bgActive: 'bg-amber-500/30 ring-4 ring-amber-400/50',
      shadowActive: 'shadow-2xl shadow-amber-500/50 scale-[1.03]',
      textAccent: 'text-amber-300'
    },
    {
      id: 'MET',
      label: 'MET',
      desc: 'METANOL',
      badgeColor: 'bg-pink-500',
      borderDefault: 'border-pink-500/40 hover:border-pink-400',
      borderActive: 'border-pink-400',
      bgDefault: 'bg-pink-950/20 hover:bg-pink-950/40',
      bgActive: 'bg-pink-500/30 ring-4 ring-pink-400/50',
      shadowActive: 'shadow-2xl shadow-pink-500/50 scale-[1.03]',
      textAccent: 'text-pink-300'
    },
    {
      id: 'LIVIANO',
      label: 'LIVIANO',
      desc: 'UTE / LIVIANO',
      badgeColor: 'bg-cyan-500',
      borderDefault: 'border-cyan-500/40 hover:border-cyan-400',
      borderActive: 'border-cyan-400',
      bgDefault: 'bg-cyan-950/20 hover:bg-cyan-950/40',
      bgActive: 'bg-cyan-500/30 ring-4 ring-cyan-400/50',
      shadowActive: 'shadow-2xl shadow-cyan-500/50 scale-[1.03]',
      textAccent: 'text-cyan-300'
    },
    {
      id: 'PP',
      label: 'PP',
      desc: 'PRODUCTOS PRIMARIOS',
      badgeColor: 'bg-purple-500',
      borderDefault: 'border-purple-500/40 hover:border-purple-400',
      borderActive: 'border-purple-400',
      bgDefault: 'bg-purple-950/20 hover:bg-purple-950/40',
      bgActive: 'bg-purple-500/30 ring-4 ring-purple-400/50',
      shadowActive: 'shadow-2xl shadow-purple-500/50 scale-[1.03]',
      textAccent: 'text-purple-300'
    },
    {
      id: 'TDS',
      label: 'TDS',
      desc: 'TERMINAL DOCK SUD',
      badgeColor: 'bg-blue-500',
      borderDefault: 'border-blue-500/40 hover:border-blue-400',
      borderActive: 'border-blue-400',
      bgDefault: 'bg-blue-950/20 hover:bg-blue-950/40',
      bgActive: 'bg-blue-500/30 ring-4 ring-blue-400/50',
      shadowActive: 'shadow-2xl shadow-blue-500/50 scale-[1.03]',
      textAccent: 'text-blue-300'
    }
  ];

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, servicio: string) => {
    e.preventDefault();
    e.stopPropagation();
    const cardId = activeDragCardId;
    setActiveDragCardId(null);
    setHighlightedZone(null);
    if (cardId) {
      onAsignarServicioYResolver(cardId, servicio);
    }
  };

  const handleCancelar = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActiveDragCardId(null);
    setHighlightedZone(null);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onClick={() => handleCancelar()}
      className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[90] flex flex-col justify-center items-center p-4 md:p-8 animate-in fade-in duration-200 select-none overflow-y-auto"
    >
      {/* Cabecera Informativa */}
      <div className="text-center mb-6 md:mb-8 shrink-0 pointer-events-none">
        <h3 className="text-xl md:text-3xl font-black text-white uppercase tracking-widest drop-shadow-md">
          Asignar Servicio & Resolver
        </h3>
        <p className="text-xs md:text-sm font-extrabold text-cyan-400 mt-1 uppercase tracking-wider">
          Suelta la unidad sobre el servicio de destino (o haz clic sobre la opción)
        </p>
      </div>

      {/* Grilla Ampliada y Ergonómica de Drop Targets */}
      <div
        onDragOver={handleDragOver}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-5xl lg:max-w-6xl grid grid-cols-2 md:grid-cols-3 gap-5 md:gap-7 my-auto"
      >
        {servicios.map((srv) => {
          const isHighlighted = highlightedZone === srv.id;
          return (
            <div
              key={srv.id}
              onDragOver={handleDragOver}
              onDragEnter={() => setHighlightedZone(srv.id)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setHighlightedZone(null);
                }
              }}
              onDrop={(e) => handleDrop(e, srv.id)}
              onClick={() => {
                if (activeDragCardId) {
                  onAsignarServicioYResolver(activeDragCardId, srv.id);
                  setActiveDragCardId(null);
                  setHighlightedZone(null);
                }
              }}
              className={`service-drop-zone relative border-2 border-dashed rounded-3xl p-6 md:p-10 flex flex-col items-center justify-center cursor-pointer transition-all duration-200 select-none min-h-[170px] md:min-h-[210px] ${
                isHighlighted
                  ? `${srv.borderActive} ${srv.bgActive} ${srv.shadowActive}`
                  : `${srv.borderDefault} ${srv.bgDefault} hover:scale-[1.02] shadow-xl`
              }`}
            >
              {/* Badge Identificador Superior */}
              <div className="pointer-events-none absolute top-3 right-4 flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${srv.badgeColor} ${isHighlighted ? 'animate-ping' : ''}`} />
                <span className="text-[9px] font-black tracking-widest text-white/50 uppercase">
                  {srv.id}
                </span>
              </div>

              {/* Título Principal de la Zona */}
              <span className={`pointer-events-none text-3xl md:text-5xl font-black tracking-widest transition-colors duration-150 ${
                isHighlighted ? srv.textAccent : 'text-white'
              }`}>
                {srv.label}
              </span>

              {/* Subtítulo Operativo (Campo / Productos Primarios / etc.) */}
              <span className={`pointer-events-none text-[11px] md:text-xs font-black uppercase tracking-wider mt-2.5 px-3 py-1 rounded-lg bg-black/30 border border-white/10 ${
                isHighlighted ? `${srv.textAccent} border-white/30` : 'text-slate-300'
              }`}>
                {srv.desc}
              </span>

              {/* Indicador de Suelta Activa */}
              {isHighlighted && (
                <div className="pointer-events-none absolute bottom-2.5 text-[9px] font-black uppercase tracking-widest text-white/80 animate-pulse">
                  ⚡ Soltar para asignar
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Botón Cancelar */}
      <div className="mt-6 md:mt-8 shrink-0">
        <button
          type="button"
          onClick={(e) => handleCancelar(e)}
          className="px-8 py-3 rounded-2xl bg-slate-800/90 hover:bg-rose-600 text-slate-300 hover:text-white font-black text-xs uppercase tracking-widest transition-all cursor-pointer shadow-lg active:scale-95 border border-slate-700/60 hover:border-rose-500"
        >
          Cancelar (Esc)
        </button>
      </div>
    </div>
  );
};
