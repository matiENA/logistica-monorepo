import React, { useState, useRef, useEffect } from 'react';
import { Plus, Search } from 'lucide-react';
import { useDashStore } from '../../store/useDashStore';
import { FlotaItem } from '../../types/dash';
import { api } from '../../services/api';
import { PatenteMercosur } from '../common/PatenteMercosur';

interface QuickAddLibreProps {
  flota: FlotaItem[];
  onNovedadPublicada: () => void;
}

export const QuickAddLibre: React.FC<QuickAddLibreProps> = ({
  flota,
  onNovedadPublicada
}) => {
  const { modoCartelera, sesion, tiposNovedad } = useDashStore();
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [enviando, setEnviando] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAbierto(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  if (modoCartelera) return null;

  const handleToggle = () => {
    if (!sesion || !sesion.usuario) {
      alert('Debe iniciar sesión para agregar una novedad.');
      return;
    }
    const nuevo = !abierto;
    setAbierto(nuevo);
    if (nuevo) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const flotaFiltrada = flota.filter((f) => {
    const q = busqueda.toLowerCase().trim();
    if (!q) return true;
    return (
      (f.nom && f.nom.toLowerCase().includes(q)) ||
      (f.tractor && f.tractor.toLowerCase().includes(q)) ||
      (f.n_ute && f.n_ute.toLowerCase().includes(q))
    );
  }).slice(0, 25);

  const handleSubmitLibre = async (item: FlotaItem) => {
    setEnviando(true);
    setAbierto(false);
    setBusqueda('');

    try {
      const tipoLibre = tiposNovedad?.find((t) => t.codigo === 'LIBRES');
      const payload = {
        chofer_id: item.chofer_id || null,
        unidad_id: item.unidad_id || null,
        nom: (item.nom || '').trim().toUpperCase(),
        tractor: (item.tractor || '').trim().toUpperCase(),
        srv: item.srv || item.srv_chofer || 'S/A',
        n_ute: item.n_ute || 'S/D',
        tipo_novedad: 'LIBRES',
        tipo_novedad_id: tipoLibre?.id || null,
        tipo_novedad_titulo: tipoLibre?.titulo || 'Libres',
        terminal: '',
        fecha_objetivo: null,
        detalle: '',
        creado_por_id: sesion?.id || null,
        creador: sesion?.usuario || 'OPERADOR'
      };

      await api.despacharNovedad({ action: 'nueva', payload });
      onNovedadPublicada();
    } catch (err: any) {
      alert(`Error al liberar chofer: ${err.message}`);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div ref={containerRef} className="relative shrink-0 flex items-center justify-center h-[65px]">
      <button
        id="btn-quick-libre"
        onClick={handleToggle}
        disabled={enviando}
        className="w-[65px] h-full rounded-xl border-2 border-cyan-400 text-cyan-500 hover:bg-cyan-400 hover:text-black transition-all flex items-center justify-center group focus:outline-none shadow-sm cursor-pointer z-10 bg-white dark:bg-slate-900 active:scale-95 disabled:opacity-50"
        title="Agregar Libre Rápido (En 1 Clic)"
      >
        <Plus className="w-6 h-6 stroke-[2.8] transition-transform duration-200 group-hover:scale-110" />
      </button>

      {abierto && (
        <div className="absolute top-[75px] left-0 w-72 md:w-80 bg-white dark:bg-slate-900 border border-cyan-200 dark:border-cyan-800 rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col animate-in fade-in duration-150">
          <div className="relative flex items-center border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            <Search className="w-4 h-4 text-slate-400 ml-3 shrink-0 stroke-[2.2]" />
            <input
              ref={inputRef}
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="BUSCAR PARA LIBERAR..."
              className="w-full bg-transparent p-3 pl-2 text-xs font-black text-slate-800 dark:text-slate-200 outline-none uppercase placeholder-slate-400"
            />
          </div>

          <div className="max-h-64 overflow-y-auto custom-scrollbar">
            {flotaFiltrada.length === 0 ? (
              <div className="p-3 text-xs text-center text-slate-400 font-bold uppercase">
                No hay resultados
              </div>
            ) : (
              flotaFiltrada.map((c) => (
                <div
                  key={`${c.nom}-${c.tractor}`}
                  onClick={() => handleSubmitLibre(c)}
                  className="p-3 border-b border-slate-100 dark:border-slate-800 hover:bg-cyan-50 dark:hover:bg-cyan-900/30 cursor-pointer transition-colors flex justify-between items-center text-left"
                >
                  <div className="flex flex-col truncate pr-2">
                    <span className="font-extrabold text-xs text-slate-800 dark:text-slate-200 truncate uppercase">
                      {c.nom}
                    </span>
                    <span className="text-[10px] text-slate-400 font-bold">
                      UTE: {c.n_ute || 'S/D'} • {c.srv || c.srv_chofer || 'S/A'}
                    </span>
                  </div>
                  <div className="flex flex-col items-end shrink-0 ml-2">
                    <PatenteMercosur patente={c.tractor} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
