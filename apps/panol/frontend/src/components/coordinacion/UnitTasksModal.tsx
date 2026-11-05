import React, { useEffect, useMemo, useState } from 'react';
import { X, Search, MapPin, UserCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  CoordKanbanCard,
  CoordTaskRow,
  StaffMember,
  fetchUnitTasks,
  mapSnapshotToTasks,
  updateTaskCoordinationAssignment,
} from '../../services/coordinacionApi';
import { formatPlateDisplay } from './UnitKanbanCard';

interface UnitTasksModalProps {
  card: CoordKanbanCard | null;
  mode: 'progreso' | 'terminados';
  staffList: StaffMember[];
  onClose: () => void;
  onTaskUpdated: () => void;
}

const STANDARD_LOCATIONS = [
  'Box 1',
  'Box 2',
  'Box 6',
  'Box 7',
  'Box 11',
  'Box 12',
  'Box 15',
  'Box 16',
  'Box 25',
  'Fosa 1',
  'Fosa 2',
  'Fosa 3',
  'Lavadero',
  'Gomería',
  'Lubricentro',
  'Engrase',
  'ENA',
  'Patio / Tránsito',
];

function formatDateTimeParts(value: string | null | undefined): { datePart: string; timePart: string; hasValue: boolean } {
  if (!value || !String(value).trim()) {
    return { datePart: '—', timePart: '', hasValue: false };
  }
  const raw = String(value).trim();
  // Si ya viene formateado 'DD/MM HH:MM' desde un snapshot
  const preformatted = raw.match(/^(\d{2}\/\d{2})\s+(\d{2}:\d{2})/);
  if (preformatted) {
    return { datePart: preformatted[1], timePart: preformatted[2], hasValue: true };
  }
  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    return { datePart: '—', timePart: '', hasValue: false };
  }
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return { datePart: `${dd}/${mm}`, timePart: `${hh}:${min}`, hasValue: true };
}

function normalizeBoxChip(b: string): string {
  const clean = String(b || '').trim();
  if (!clean) return '';
  return /^\d+$/.test(clean) ? `Box ${clean}` : clean;
}

export const UnitTasksModal: React.FC<UnitTasksModalProps> = ({
  card,
  mode,
  staffList,
  onClose,
  onTaskUpdated,
}) => {
  const [tasks, setTasks] = useState<CoordTaskRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);

  // Sub-modal de Ubicación
  const [editingLocationTask, setEditingLocationTask] = useState<CoordTaskRow | null>(null);
  const [locationInput, setLocationInput] = useState('');

  // Sub-modal de Operario
  const [editingWorkerTask, setEditingWorkerTask] = useState<CoordTaskRow | null>(null);
  const [workerSearch, setWorkerSearch] = useState('');
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [autoFillDefaultBox, setAutoFillDefaultBox] = useState(true);

  const isReadOnly = mode === 'terminados';

  useEffect(() => {
    if (!card) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const woIds = [card.tractor_wo_id, card.semi_wo_id].filter((id): id is string => Boolean(id));
        const liveTasks = woIds.length > 0 ? await fetchUnitTasks(woIds) : [];

        if (cancelled) return;

        if (liveTasks.length > 0) {
          setTasks(liveTasks);
        } else if (mode === 'terminados') {
          const trSnap = mapSnapshotToTasks(card.tractor_snapshot || [], {
            workOrderId: card.tractor_wo_id || 'tr-closed',
            otNumber: card.tractor_ot,
            patente: card.tractor_plate,
            vehicleType: 'TRACTOR',
            avg: card.tractor_avg ?? 100,
          });
          const smSnap = mapSnapshotToTasks(card.semi_snapshot || [], {
            workOrderId: card.semi_wo_id || 'sm-closed',
            otNumber: card.semi_ot,
            patente: card.semi_plate,
            vehicleType: 'SEMI',
            avg: card.semi_avg ?? 100,
          });
          setTasks([...trSnap, ...smSnap]);
        } else {
          setTasks([]);
        }
      } catch (err) {
        console.error('Error cargando tareas del par:', err);
        toast.error('No se pudieron cargar las tareas de la unidad');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [card, mode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingLocationTask) {
          setEditingLocationTask(null);
        } else if (editingWorkerTask) {
          setEditingWorkerTask(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingLocationTask, editingWorkerTask, onClose]);

  const tractorTasks = useMemo(
    () => tasks.filter((t) => t.vehicle_type === 'TRACTOR' || (card?.tractor_wo_id && t.work_order_id === card.tractor_wo_id)),
    [tasks, card]
  );

  const semiTasks = useMemo(
    () => tasks.filter((t) => t.vehicle_type === 'SEMI' && (!card?.tractor_wo_id || t.work_order_id !== card.tractor_wo_id)),
    [tasks, card]
  );

  const suggestedBoxesForLocationModal = useMemo(() => {
    if (!editingLocationTask) return [];
    const staffMember = staffList.find((s) => s.id === editingLocationTask.worker_id);
    const rawBoxes = staffMember?.default_boxes?.length
      ? staffMember.default_boxes
      : editingLocationTask.worker_default_boxes || [];
    return rawBoxes.map(normalizeBoxChip).filter(Boolean);
  }, [editingLocationTask, staffList]);

  const filteredStaff = useMemo(() => {
    const q = workerSearch.trim().toLowerCase();
    if (!q) return staffList;
    return staffList.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.role.toLowerCase().includes(q) ||
        s.op_code.toLowerCase().includes(q)
    );
  }, [staffList, workerSearch]);

  if (!card) return null;

  const openLocationPicker = (task: CoordTaskRow) => {
    if (isReadOnly) return;
    setEditingLocationTask(task);
    setLocationInput(task.ubicacion || '');
  };

  const openWorkerPicker = (task: CoordTaskRow) => {
    if (isReadOnly) return;
    setEditingWorkerTask(task);
    setSelectedWorkerId(task.worker_id || null);
    setWorkerSearch('');
    setAutoFillDefaultBox(!task.ubicacion);
  };

  const handleSaveLocation = async (newLocation: string) => {
    if (!editingLocationTask) return;
    const targetTask = editingLocationTask;
    setSavingTaskId(targetTask.task_id);
    try {
      await updateTaskCoordinationAssignment({
        taskId: targetTask.task_id,
        ubicacion: newLocation,
        currentAsignado: targetTask.asignado,
      });

      const nowIso = !targetTask.asignado && newLocation.trim() ? new Date().toISOString() : targetTask.asignado;
      setTasks((prev) =>
        prev.map((t) =>
          t.task_id === targetTask.task_id
            ? { ...t, ubicacion: newLocation.trim(), asignado: nowIso }
            : t
        )
      );
      setEditingLocationTask(null);
      onTaskUpdated();
      toast.success(newLocation.trim() ? `Ubicación "${newLocation.trim()}" asignada` : 'Ubicación liberada');
    } catch {
      toast.error('Error al guardar la ubicación en Supabase');
    } finally {
      setSavingTaskId(null);
    }
  };

  const handleSaveWorker = async (worker: StaffMember | null) => {
    if (!editingWorkerTask) return;
    const targetTask = editingWorkerTask;
    setSavingTaskId(targetTask.task_id);
    try {
      const nextWorkerId = worker ? worker.id : null;
      const suggestedBox =
        worker && autoFillDefaultBox && !targetTask.ubicacion && worker.default_boxes.length > 0
          ? normalizeBoxChip(worker.default_boxes[0])
          : undefined;

      await updateTaskCoordinationAssignment({
        taskId: targetTask.task_id,
        workerId: nextWorkerId,
        ubicacion: suggestedBox !== undefined ? suggestedBox : undefined,
        currentAsignado: targetTask.asignado,
      });

      const nowIso = !targetTask.asignado && nextWorkerId ? new Date().toISOString() : targetTask.asignado;
      setTasks((prev) =>
        prev.map((t) =>
          t.task_id === targetTask.task_id
            ? {
                ...t,
                worker_id: nextWorkerId,
                worker_name: worker ? worker.name : '',
                worker_role: worker ? worker.role : '',
                worker_default_boxes: worker ? worker.default_boxes : [],
                ubicacion: suggestedBox !== undefined ? suggestedBox : t.ubicacion,
                asignado: nowIso,
              }
            : t
        )
      );
      setEditingWorkerTask(null);
      onTaskUpdated();
      toast.success(worker ? `Operario ${worker.name} asignado` : 'Operario desasignado');
    } catch {
      toast.error('Error al asignar el operario en Supabase');
    } finally {
      setSavingTaskId(null);
    }
  };

  const renderVehicleBlock = (
    titleType: 'TRACTOR' | 'SEMI',
    plate: string,
    ot: string,
    avg: number | null,
    vehicleTasks: CoordTaskRow[]
  ) => {
    if (!ot && !plate && vehicleTasks.length === 0) return null;

    const cleanPlate = formatPlateDisplay(plate);
    const pct = avg !== null && avg !== undefined ? Math.round(avg) : Math.round(card.combined_avg);

    return (
      <div className="grid grid-cols-1 lg:grid-cols-[150px_1fr_80px] gap-4 py-5 border-b border-zinc-200 last:border-b-0 items-start">
        {/* Columna Izquierda: OT y Patente */}
        <div className="flex flex-col gap-0.5 pl-1">
          {plate && (
            <span className="text-[19px] font-black tracking-tight text-zinc-950 leading-tight">
              {cleanPlate}
            </span>
          )}
          <span className="text-[22px] font-extrabold text-zinc-950 leading-tight">
            {ot || '--'}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            {titleType === 'TRACTOR' ? 'Tractor' : 'Semi'}
          </span>
        </div>

        {/* Columna Central: Filas de Tareas */}
        <div className="flex flex-col gap-2.5">
          {vehicleTasks.length === 0 ? (
            <div className="text-xs text-zinc-400 italic py-2">
              Sin tareas detalladas registradas para esta orden.
            </div>
          ) : (
            vehicleTasks.map((task) => {
              const asig = formatDateTimeParts(task.asignado);
              const emp = formatDateTimeParts(task.empezo);
              const term = formatDateTimeParts(task.termino);
              const isDone = task.estado === 'COMPLETADA' || task.estado === 'TERMINADO' || term.hasValue;
              const isRunning = (task.estado === 'EN_CURSO' || emp.hasValue) && !isDone;
              const isSaving = savingTaskId === task.task_id;

              return (
                <div
                  key={task.task_id}
                  className={`grid grid-cols-1 md:grid-cols-[1fr_115px_125px_98px_98px_98px] gap-3 items-center py-0.5 px-1.5 rounded-md transition-colors ${
                    isDone ? 'opacity-65' : 'hover:bg-zinc-50'
                  }`}
                >
                  {/* Descripción de tarea con [SECTOR] */}
                  <div className="text-[12px] text-zinc-900 leading-snug pr-2">
                    <span className="font-semibold">[{task.sector}]</span>{' '}
                    <span>{task.descripcion}</span>
                  </div>

                  {/* Pill UBICACION */}
                  <button
                    type="button"
                    disabled={isReadOnly || isSaving}
                    onClick={() => openLocationPicker(task)}
                    title={isReadOnly ? 'Modo lectura (OT terminada)' : 'Clic para asignar ubicación / box'}
                    aria-label={`Ubicación para tarea ${task.descripcion}: ${task.ubicacion || 'Sin asignar'}`}
                    className={`h-[28px] w-full rounded-[6px] border border-zinc-800 px-2 text-[11px] font-semibold truncate transition-all flex items-center justify-center focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1 focus-visible:outline-hidden ${
                      task.ubicacion
                        ? 'bg-zinc-900 text-white hover:bg-zinc-800 active:scale-98'
                        : 'bg-white text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 active:scale-98'
                    } ${isReadOnly ? 'cursor-default opacity-80' : 'cursor-pointer'}`}
                  >
                    {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : task.ubicacion || '—'}
                  </button>

                  {/* Pill OPERARIO/S */}
                  <button
                    type="button"
                    disabled={isReadOnly || isSaving}
                    onClick={() => openWorkerPicker(task)}
                    title={isReadOnly ? 'Modo lectura (OT terminada)' : 'Clic para asignar operario'}
                    aria-label={`Operario para tarea ${task.descripcion}: ${task.worker_name || 'Sin asignar'}`}
                    className={`h-[28px] w-full rounded-[6px] border border-zinc-800 px-2 text-[11px] font-semibold truncate transition-all flex items-center justify-center focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1 focus-visible:outline-hidden ${
                      task.worker_name
                        ? 'bg-zinc-900 text-white hover:bg-zinc-800 active:scale-98'
                        : 'bg-white text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 active:scale-98'
                    } ${isReadOnly ? 'cursor-default opacity-80' : 'cursor-pointer'}`}
                  >
                    {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : task.worker_name || '—'}
                  </button>

                  {/* ASIGNADO (Solo lectura) */}
                  <div
                    className="flex items-center justify-center gap-1.5 text-[11px] font-mono select-none"
                    title={asig.hasValue ? 'Fecha y hora de asignación' : 'Sin fecha de asignación'}
                  >
                    {asig.hasValue ? (
                      <>
                        <span className="text-zinc-600">{asig.datePart}</span>
                        <span className="font-bold text-zinc-950">{asig.timePart}</span>
                      </>
                    ) : (
                      <span className="text-zinc-400 font-bold">—</span>
                    )}
                  </div>

                  {/* EMPEZO (Solo lectura — gestionado por App Taller) */}
                  <div
                    className={`flex items-center justify-center gap-1.5 text-[11px] font-mono select-none ${
                      isRunning ? 'text-blue-600 animate-pulse' : ''
                    }`}
                    title={emp.hasValue ? 'Inicio registrado desde Terminal Taller' : 'Sin iniciar'}
                  >
                    {emp.hasValue ? (
                      <>
                        <span className={isRunning ? 'text-blue-600' : 'text-zinc-600'}>
                          {emp.datePart}
                        </span>
                        <span
                          className={`font-bold ${
                            isRunning ? 'text-blue-700' : 'text-zinc-950'
                          }`}
                        >
                          {emp.timePart}
                        </span>
                      </>
                    ) : (
                      <span className="text-zinc-400 font-bold">—</span>
                    )}
                  </div>

                  {/* TERMINO (Solo lectura — gestionado por App Taller) */}
                  <div
                    className="flex items-center justify-center gap-1.5 text-[11px] font-mono select-none"
                    title={term.hasValue ? 'Fin registrado desde Terminal Taller' : 'Sin finalizar'}
                  >
                    {term.hasValue ? (
                      <>
                        <span className="text-zinc-600">{term.datePart}</span>
                        <span className="font-bold text-emerald-700">
                          {term.timePart}
                        </span>
                      </>
                    ) : (
                      <span className="text-zinc-400 font-bold">—</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Columna Derecha: Porcentaje individual de la OT */}
        <div className="flex justify-end items-start pr-1">
          <span className="text-[28px] font-black tracking-tight text-zinc-950 leading-none">
            {String(pct).padStart(2, '0')}%
          </span>
        </div>
      </div>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unit-modal-title"
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[3px] flex items-center justify-center p-3 md:p-6 transition-all duration-200"
      onClick={onClose}
    >
      {/* Contenedor Principal del Modal Detalle (Cierre por click outside o Esc) */}
      <div
        className="relative bg-white text-zinc-950 border-[1.5px] border-zinc-900 rounded-[18px] shadow-[0_24px_60px_rgba(0,0,0,0.28)] w-full max-w-[1140px] max-h-[88vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-[0.98] duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera de Columnas de Tabla */}
        <div className="px-6 md:px-10 pt-6 pb-3 border-b border-zinc-200 flex items-center justify-between">
          <div className="hidden md:grid md:grid-cols-[150px_1fr_80px] gap-4 w-full items-center">
            <div id="unit-modal-title" className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-600">
              {card.n_ute ? `UNIDAD #${card.n_ute}` : 'UNIDAD / OT'}
            </div>
            <div className="grid grid-cols-[1fr_115px_125px_98px_98px_98px] gap-3 items-center text-[10px] font-extrabold uppercase tracking-wider text-zinc-900">
              <div />
              <div className="text-center">UBICACION</div>
              <div className="text-center">OPERARIO/S</div>
              <div className="text-center">ASIGNADO</div>
              <div className="text-center">EMPEZO</div>
              <div className="text-center">TERMINO</div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar detalle de tareas (Esc)"
                className="p-1.5 rounded-full text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:outline-hidden transition-all active:scale-95 cursor-pointer"
                title="Cerrar (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex md:hidden items-center justify-between w-full">
            <span id="unit-modal-title-mobile" className="text-sm font-black text-zinc-900">
              Detalle de OTs {[card.tractor_ot, card.semi_ot].filter(Boolean).join(' / ')}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar detalle de tareas"
              className="p-1.5 rounded-full text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:outline-hidden transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Cuerpo Scrollable con Tractor y Semi */}
        <div className="px-6 md:px-10 py-4 pb-6 overflow-y-auto flex-1 scrollbar-thin">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-2 text-zinc-600">
              <Loader2 className="w-6 h-6 animate-spin text-zinc-800" />
              <span className="text-xs font-semibold">Cargando tareas desde Supabase...</span>
            </div>
          ) : (
            <>
              {(card.tractor_wo_id || card.tractor_plate || tractorTasks.length > 0) &&
                renderVehicleBlock(
                  'TRACTOR',
                  card.tractor_plate,
                  card.tractor_ot,
                  card.tractor_avg,
                  tractorTasks
                )}

              {(card.semi_wo_id || card.semi_plate || semiTasks.length > 0) &&
                renderVehicleBlock(
                  'SEMI',
                  card.semi_plate,
                  card.semi_ot,
                  card.semi_avg,
                  semiTasks
                )}
            </>
          )}
        </div>

        {/* SUB-MODAL: ASIGNAR UBICACIÓN */}
        {editingLocationTask && (
          <div
            className="fixed inset-0 z-60 bg-black/40 flex items-center justify-center p-4"
            onClick={() => setEditingLocationTask(null)}
          >
            <div
              className="bg-white border-2 border-zinc-900 rounded-2xl p-5 w-full max-w-md shadow-2xl flex flex-col gap-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-zinc-200 pb-2.5">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-zinc-900" />
                  <h3 className="text-sm font-black text-zinc-950">
                    Asignar Ubicación Física (Box / Fosa)
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingLocationTask(null)}
                  className="text-zinc-400 hover:text-zinc-900"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="text-xs text-zinc-600">
                <span className="font-bold text-zinc-900">[{editingLocationTask.sector}]</span>{' '}
                {editingLocationTask.descripcion}
              </div>

              {suggestedBoxesForLocationModal.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                    Boxes por defecto del operario ({editingLocationTask.worker_name || 'asignado'}):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestedBoxesForLocationModal.map((box) => (
                      <button
                        key={box}
                        type="button"
                        onClick={() => setLocationInput(box)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                          locationInput === box
                            ? 'bg-zinc-950 text-white border-zinc-950'
                            : 'bg-emerald-50 text-emerald-950 border-emerald-400 hover:bg-emerald-100'
                        }`}
                      >
                        {box}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold text-zinc-700">Boxes y sectores del taller:</span>
                <div className="grid grid-cols-3 gap-1.5 max-h-44 overflow-y-auto pr-1">
                  {STANDARD_LOCATIONS.map((loc) => (
                    <button
                      key={loc}
                      type="button"
                      onClick={() => setLocationInput(loc)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all truncate ${
                        locationInput === loc
                          ? 'bg-zinc-950 text-white border-zinc-950'
                          : 'bg-white text-zinc-800 border-zinc-300 hover:border-zinc-900'
                      }`}
                    >
                      {loc}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-zinc-700">
                  O escriba una ubicación personalizada:
                </label>
                <input
                  type="text"
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  placeholder="Ej: Box 25, Fosa 2, Rampa..."
                  className="w-full px-3 py-2 text-xs font-medium border border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-200">
                <button
                  type="button"
                  onClick={() => handleSaveLocation('')}
                  className="px-3 py-1.5 rounded-lg border border-zinc-300 text-xs font-semibold text-zinc-700 hover:bg-zinc-100"
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveLocation(locationInput)}
                  className="px-4 py-1.5 rounded-lg bg-zinc-950 text-white text-xs font-bold hover:bg-zinc-800"
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SUB-MODAL: ASIGNAR OPERARIO */}
        {editingWorkerTask && (
          <div
            className="fixed inset-0 z-60 bg-black/40 flex items-center justify-center p-4"
            onClick={() => setEditingWorkerTask(null)}
          >
            <div
              className="bg-white border-2 border-zinc-900 rounded-2xl p-5 w-full max-w-lg shadow-2xl flex flex-col gap-3.5 max-h-[82vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-zinc-200 pb-2.5">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-zinc-900" />
                  <h3 className="text-sm font-black text-zinc-950">
                    Asignar Operario
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingWorkerTask(null)}
                  className="text-zinc-400 hover:text-zinc-900"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="text-xs text-zinc-600">
                <span className="font-bold text-zinc-900">[{editingWorkerTask.sector}]</span>{' '}
                {editingWorkerTask.descripcion}
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={workerSearch}
                  onChange={(e) => setWorkerSearch(e.target.value)}
                  placeholder="Buscar por nombre, rol (TALLER, GOMERIA, ENA...) o legajo..."
                  className="w-full pl-8 pr-3 py-2 text-xs font-medium border border-zinc-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  autoFocus
                />
              </div>

              {!editingWorkerTask.ubicacion && (
                <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoFillDefaultBox}
                    onChange={(e) => setAutoFillDefaultBox(e.target.checked)}
                    className="rounded border-zinc-400 text-zinc-900 focus:ring-zinc-900"
                  />
                  <span>Pre-completar Ubicación con el box por defecto del operario</span>
                </label>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 overflow-y-auto max-h-64 pr-1">
                {filteredStaff.map((member) => {
                  const isSelected = selectedWorkerId === member.id;
                  const boxesText =
                    member.default_boxes.length > 0
                      ? member.default_boxes.map(normalizeBoxChip).join(' · ')
                      : 'Sin box fijo';
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => handleSaveWorker(member)}
                      className={`flex flex-col items-start p-2.5 rounded-lg border text-left transition-all ${
                        isSelected
                          ? 'bg-zinc-950 text-white border-zinc-950'
                          : 'bg-white text-zinc-900 border-zinc-200 hover:border-zinc-900 hover:bg-zinc-50'
                      }`}
                    >
                      <span className="text-xs font-bold truncate w-full">{member.name}</span>
                      <div className="flex items-center justify-between w-full gap-1 mt-0.5">
                        <span
                          className={`text-[10px] font-semibold uppercase ${
                            isSelected ? 'text-amber-300' : 'text-zinc-500'
                          }`}
                        >
                          {member.role || 'TALLER'}
                        </span>
                        <span
                          className={`text-[10px] truncate ${
                            isSelected ? 'text-zinc-300' : 'text-zinc-400'
                          }`}
                        >
                          {boxesText}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-zinc-200">
                <button
                  type="button"
                  onClick={() => handleSaveWorker(null)}
                  className="px-3 py-1.5 rounded-lg border border-zinc-300 text-xs font-semibold text-zinc-700 hover:bg-zinc-100"
                >
                  Dejar sin asignar
                </button>
                <button
                  type="button"
                  onClick={() => setEditingWorkerTask(null)}
                  className="px-4 py-1.5 rounded-lg bg-zinc-200 text-zinc-900 text-xs font-bold hover:bg-zinc-300"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
