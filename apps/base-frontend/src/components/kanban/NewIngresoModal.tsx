import React, { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import type { PlaneacionCatalog } from '../../types/planeacion';
import { registrarLlegadaBox } from '../../services/planeacionApi';

interface NewIngresoModalProps {
  open: boolean;
  catalog: PlaneacionCatalog;
  onClose: () => void;
  onCreated: () => void;
}

export const NewIngresoModal: React.FC<NewIngresoModalProps> = ({
  open,
  catalog,
  onClose,
  onCreated,
}) => {
  const [unitSearch, setUnitSearch] = useState('');
  const [selectedUnidadId, setSelectedUnidadId] = useState('');
  const [selectedBoxId, setSelectedBoxId] = useState(catalog.boxes[0]?.id || '');
  const [notaTexto, setNotaTexto] = useState('');
  const [saving, setSaving] = useState(false);

  const filteredUnits = useMemo(() => {
    const q = unitSearch.trim().toLowerCase();
    const list = catalog.unidades;
    if (!q) return list.slice(0, 40);
    return list
      .filter(
        (u) =>
          u.n_ute.toLowerCase().includes(q) ||
          u.tractor_plate.toLowerCase().includes(q) ||
          u.semi_plate.toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [catalog.unidades, unitSearch]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const boxId = selectedBoxId || catalog.boxes[0]?.id;
    if (!selectedUnidadId || !boxId) {
      toast.error('Seleccioná una unidad y un box de destino');
      return;
    }

    setSaving(true);
    try {
      await registrarLlegadaBox({
        unidadId: selectedUnidadId,
        boxId,
        notaTexto: notaTexto.trim() || null,
      });
      toast.success('Ingreso a box registrado');
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error registrando ingreso');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white border-[1.5px] border-zinc-900 rounded-2xl w-full max-w-md p-5 shadow-2xl flex flex-col gap-4"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 pb-2.5">
          <h3 className="text-sm font-black text-zinc-950 uppercase tracking-wide">
            Registrar Llegada a Box
          </h3>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-950">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-bold uppercase text-zinc-700">
            Buscar Unidad / Patente
          </label>
          <input
            type="text"
            value={unitSearch}
            onChange={(e) => setUnitSearch(e.target.value)}
            placeholder="Filtrar por UTE, tractor o semi..."
            className="px-3 py-2 text-xs border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
          <select
            value={selectedUnidadId}
            onChange={(e) => setSelectedUnidadId(e.target.value)}
            className="px-3 py-2 text-xs font-semibold border border-zinc-300 rounded-lg bg-white"
            required
          >
            <option value="">Seleccionar unidad...</option>
            {filteredUnits.map((u) => (
              <option key={u.unidad_id} value={u.unidad_id}>
                {u.n_ute ? `#${u.n_ute} — ` : ''}
                {u.tractor_plate || '---'} / {u.semi_plate || '---'}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-bold uppercase text-zinc-700">Box de Destino</label>
          <select
            value={selectedBoxId || catalog.boxes[0]?.id || ''}
            onChange={(e) => setSelectedBoxId(e.target.value)}
            className="px-3 py-2 text-xs font-semibold border border-zinc-300 rounded-lg bg-white"
            required
          >
            {catalog.boxes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.zone_name} — {b.box_name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-bold uppercase text-zinc-700">
            Nota inicial (opcional)
          </label>
          <input
            type="text"
            value={notaTexto}
            onChange={(e) => setNotaTexto(e.target.value)}
            placeholder="Motivo de ingreso..."
            className="px-3 py-2 text-xs border border-zinc-300 rounded-lg"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-zinc-200">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-zinc-300 text-xs font-semibold text-zinc-700"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1 px-4 py-1.5 rounded-lg bg-zinc-950 text-white text-xs font-bold hover:bg-zinc-800 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            Confirmar Llegada
          </button>
        </div>
      </form>
    </div>
  );
};
