import React, { useState, useEffect, useMemo } from 'react';
import { Header } from '../components/common/Header';
import { LicensePlate } from '../components/common/LicensePlate';
import { SectorBadge } from '../components/common/SectorBadge';
import { useAuthStore } from '../stores/authStore';
import { useCartStore } from '../stores/cartStore';
import {
  getItemCatalog,
  getFleetSearchCatalog,
  getUnitTimelineTasks,
  updateTaskExecution,
  submitBatchOrder,
  getOrdersFeed,
} from '../services/tallerApi';
import { getSocket } from '../services/socket';
import { CatalogItem, WorkOrderTask, PanolOrder } from '../types';
import { toast } from 'sonner';
import {
  Play,
  Check,
  ShoppingCart,
  Truck,
  Search,
  Clock,
  Package,
  Wrench,
  Trash2,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export const AppMobile: React.FC = () => {
  const { user, activeBox, setActiveBox } = useAuthStore();
  const { items: cartItems, addItem, removeItem, updateQuantity, clearCart } = useCartStore();

  // Subtabs: 'pedir' | 'tareas' | 'pedidos'
  const [activeTab, setActiveTab] = useState<'pedir' | 'tareas' | 'pedidos'>('pedir');

  // Datos y catálogos
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [fleetPlates, setFleetPlates] = useState<{ tractores: string[]; semis: string[] }>({
    tractores: [],
    semis: [],
  });

  // Inputs del formulario de solicitud
  const [tractorPlate, setTractorPlate] = useState('AD355XY');
  const [tractorOt, setTractorOt] = useState('44892');
  const [semiPlate, setSemiPlate] = useState('AD102PR');
  const [semiOt, setSemiOt] = useState('44893');
  const [showSemiDetails, setShowSemiDetails] = useState(false);
  const [targetType, setTargetType] = useState<'TRACTOR' | 'SEMI'>('TRACTOR');

  // Selector de repuesto
  const [selectedCategory, setSelectedCategory] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Tareas operativas de fosa y cronómetro
  const [tasks, setTasks] = useState<WorkOrderTask[]>([
    {
      id: 't-mob-1',
      work_order_id: 'wo-1',
      task_index: 1,
      task_description: 'Regulación de freno motor y zapatas traseras',
      sector: 'MECANICA',
      status: 'EN_CURSO',
      started_at: new Date().toISOString(),
    },
    {
      id: 't-mob-2',
      work_order_id: 'wo-1',
      task_index: 2,
      task_description: 'Cambio de filtro de aire secundario',
      sector: 'LUBRICENTRO',
      status: 'PENDIENTE',
    },
  ]);
  const [runningTaskId, setRunningTaskId] = useState<string | null>('t-mob-1');
  const [taskTimer, setTaskTimer] = useState<number>(412); // demo timer 06:52

  // Pedidos del operario
  const [myOrders, setMyOrders] = useState<PanolOrder[]>([]);

  // Cronómetro activo
  useEffect(() => {
    let interval: any;
    if (runningTaskId) {
      interval = setInterval(() => {
        setTaskTimer((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [runningTaskId]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Carga inicial
  useEffect(() => {
    loadData();

    // Sincronización en vivo por WebSocket
    const socket = getSocket();
    const handleOrdersSync = (incoming: any[]) => {
      if (!Array.isArray(incoming)) return;
      const formatted = incoming.filter(
        (o) =>
          !user?.op_code ||
          String(o.mechanic_id || o.opInfo || '').includes(user.op_code) ||
          String(o.box || o.box_number) === activeBox
      );
      setMyOrders(formatted);

      // Notificar si alguno cambió a LISTO
      const readyOrder = formatted.find((o) => o.status === 'LISTO');
      if (readyOrder) {
        toast.success(`🔔 Pedido ${readyOrder.req_code || readyOrder.reqId} LISTO en Pañol`, {
          description: `Podés retirarlo en el mostrador para el Box ${activeBox}.`,
        });
      }
    };

    socket.on('orders_sync', handleOrdersSync);
    return () => {
      socket.off('orders_sync', handleOrdersSync);
    };
  }, [activeBox, user]);

  const loadData = async () => {
    try {
      const [cat, fleet, ords] = await Promise.all([
        getItemCatalog(),
        getFleetSearchCatalog(),
        getOrdersFeed(),
      ]);
      setCatalogItems(cat);
      setFleetPlates({ tractores: fleet.tractores, semis: fleet.semis });
      setMyOrders(ords);

      // Cargar tareas
      if (tractorPlate) {
        const res = await getUnitTimelineTasks({ tractorPlate, tractorOt });
        if (res && res.tasks && Array.isArray(res.tasks)) {
          setTasks(res.tasks);
        } else if (res && res.timelineGroups && res.timelineGroups[0]?.tasks) {
          setTasks(res.timelineGroups[0].tasks as any);
        }
      }
    } catch (err) {
      console.error('Error loading mobile data:', err);
    }
  };

  // Categorías del catálogo
  const categories = useMemo(() => {
    const set = new Set(catalogItems.map((i) => i.category).filter(Boolean));
    return Array.from(set).sort();
  }, [catalogItems]);

  // Ítems sugeridos según búsqueda
  const filteredProducts = useMemo(() => {
    if (!productQuery && !selectedCategory) return [];
    return catalogItems
      .filter((i) => {
        const matchesCategory = !selectedCategory || i.category === selectedCategory;
        const matchesSearch =
          !productQuery ||
          i.description.toLowerCase().includes(productQuery.toLowerCase()) ||
          i.code.toLowerCase().includes(productQuery.toLowerCase());
        return matchesCategory && matchesSearch;
      })
      .slice(0, 10);
  }, [catalogItems, selectedCategory, productQuery]);

  // Confirmar y enviar pedido
  const handleConfirmOrder = async () => {
    if (cartItems.length === 0) {
      toast.error('Agregá al menos un repuesto al pedido.');
      return;
    }

    setIsSubmitting(true);
    try {
      await submitBatchOrder({
        opId: user?.op_code || '190',
        mechanicName: user?.name || 'Mecánico',
        box: activeBox,
        tractorPlate: tractorPlate.toUpperCase().trim(),
        semiPlate: semiPlate ? semiPlate.toUpperCase().trim() : undefined,
        targetType,
        items: cartItems.map((ci) => ({
          code: ci.item.code,
          name: ci.item.description,
          qty: ci.quantity,
          canje: ci.item.requires_exchange,
        })),
      });

      toast.success('¡Pedido enviado al Pañol con éxito!');
      clearCart();
      setProductQuery('');
      setOrderNotes('');
      setActiveTab('pedidos');
      loadData();
    } catch (err: any) {
      toast.error('Error al enviar pedido: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Control de inicio y fin de tarea con cronómetro
  const handleToggleTask = async (task: WorkOrderTask) => {
    if (runningTaskId === task.id) {
      // Pausar
      setRunningTaskId(null);
      toast.info('Cronómetro de tarea pausado.');
    } else {
      // Iniciar
      setRunningTaskId(task.id);
      try {
        await updateTaskExecution({
          taskId: task.id,
          status: 'EN_CURSO',
          operario: user?.name,
          box: activeBox,
        });
      } catch (e) {}
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: 'EN_CURSO' } : t))
      );
      toast.success(`Tarea iniciada en Box ${activeBox}`);
    }
  };

  const handleFinishTask = async (task: WorkOrderTask) => {
    if (runningTaskId === task.id) {
      setRunningTaskId(null);
    }
    try {
      await updateTaskExecution({
        taskId: task.id,
        status: 'TERMINADO',
        operario: user?.name,
        box: activeBox,
      });
    } catch (e) {}
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: 'TERMINADO' } : t))
    );
    toast.success('¡Tarea completada con éxito!');
  };

  const boxes = ['01', '02', '03', '04', '05', '06', '07', '08'];

  return (
    <div className="min-h-screen bg-[#0A0B0B] text-panol-text flex flex-col pb-16 select-none">
      <Header />

      <main className="flex-1 max-w-lg mx-auto w-full p-3 flex flex-col gap-3">
        {/* Selector Horizontal de Box */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-extrabold text-panol-text-dim uppercase tracking-wider">
              BOX DE TRABAJO ACTIVO
            </span>
            <span className="text-[10px] font-mono text-emerald-400 font-bold">
              SELECCIONADO: BOX {activeBox}
            </span>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {boxes.map((box) => (
              <button
                key={box}
                onClick={() => setActiveBox(box)}
                className={`px-4 py-2 rounded-xl text-xs font-black shrink-0 transition-all ${
                  activeBox === box
                    ? 'bg-panol-blue-primary text-white shadow-lg shadow-blue-900/50 scale-105 border border-blue-400'
                    : 'bg-panol-card-bg text-panol-text-muted border border-panol-border hover:border-panol-border-light'
                }`}
              >
                BOX {box}
              </button>
            ))}
          </div>
        </div>

        {/* Pestañas Principales Táctiles */}
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-panol-card-bg border border-panol-border rounded-xl">
          <button
            onClick={() => setActiveTab('pedir')}
            className={`py-2 rounded-lg text-xs font-black tracking-wider flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'pedir'
                ? 'bg-panol-blue-primary text-white shadow-sm'
                : 'text-panol-text-muted hover:text-white'
            }`}
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>PEDIR</span>
          </button>

          <button
            onClick={() => setActiveTab('tareas')}
            className={`py-2 rounded-lg text-xs font-black tracking-wider flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'tareas'
                ? 'bg-panol-blue-primary text-white shadow-sm'
                : 'text-panol-text-muted hover:text-white'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>TAREAS</span>
            {runningTaskId && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('pedidos')}
            className={`py-2 rounded-lg text-xs font-black tracking-wider flex items-center justify-center gap-1.5 transition-all ${
              activeTab === 'pedidos'
                ? 'bg-panol-blue-primary text-white shadow-sm'
                : 'text-panol-text-muted hover:text-white'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>PEDIDOS</span>
            {myOrders.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-mono border border-emerald-500/40">
                {myOrders.length}
              </span>
            )}
          </button>
        </div>

        {/* ======================================================================= */}
        {/* PESTAÑA 1: PEDIR REPUESTOS                                              */}
        {/* ======================================================================= */}
        {activeTab === 'pedir' && (
          <div className="flex flex-col gap-3">
            {/* Tarjeta de Unidad & Toggle Tractor/Semi */}
            <div className="bg-panol-card-bg border border-panol-border rounded-2xl p-3.5 flex flex-col gap-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black text-panol-text-dim uppercase tracking-wider">
                  UNIDAD DE TRABAJO
                </span>
                <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800">
                  BOX {activeBox}
                </span>
              </div>

              {/* Input Patente Tractor + OT */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] font-bold text-panol-text-dim uppercase mb-1">
                    PATENTE TRACTOR
                  </label>
                  <input
                    type="text"
                    list="mobTractorPlates"
                    value={tractorPlate}
                    onChange={(e) => setTractorPlate(e.target.value)}
                    placeholder="PATENTE TRACTOR"
                    className="w-full bg-panol-panel-bg border border-panol-border rounded-xl px-3 py-2 text-xs font-mono text-white outline-none focus:border-panol-blue uppercase"
                  />
                  <datalist id="mobTractorPlates">
                    {fleetPlates.tractores.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </div>

                <div className="w-28">
                  <label className="block text-[10px] font-bold text-panol-text-dim uppercase mb-1">
                    OT TRACTOR
                  </label>
                  <input
                    type="text"
                    value={tractorOt}
                    onChange={(e) => setTractorOt(e.target.value)}
                    placeholder="OT"
                    className="w-full bg-panol-panel-bg border border-panol-border rounded-xl px-2.5 py-2 text-xs font-mono text-white outline-none focus:border-panol-blue uppercase"
                  />
                </div>
              </div>

              {/* Colapsable de Semi / Acoplado */}
              <div className="border border-panol-border rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowSemiDetails(!showSemiDetails)}
                  className="w-full px-3 py-2 bg-panol-panel-bg flex items-center justify-between text-xs font-bold text-panol-blue hover:text-blue-300"
                >
                  <span>🚛 AGREGAR SEMI / ACOPLADO</span>
                  {showSemiDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {showSemiDetails && (
                  <div className="p-3 bg-panol-card-bg flex gap-2 border-t border-panol-border">
                    <div className="flex-1">
                      <input
                        type="text"
                        list="mobSemiPlates"
                        value={semiPlate}
                        onChange={(e) => setSemiPlate(e.target.value)}
                        placeholder="PATENTE SEMI"
                        className="w-full bg-panol-panel-bg border border-panol-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-white outline-none focus:border-panol-blue uppercase"
                      />
                      <datalist id="mobSemiPlates">
                        {fleetPlates.semis.map((p) => (
                          <option key={p} value={p} />
                        ))}
                      </datalist>
                    </div>
                    <div className="w-28">
                      <input
                        type="text"
                        value={semiOt}
                        onChange={(e) => setSemiOt(e.target.value)}
                        placeholder="OT SEMI"
                        className="w-full bg-panol-panel-bg border border-panol-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-white outline-none focus:border-panol-blue uppercase"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Toggle de Destino: TRACTOR vs SEMI */}
              <div className="flex p-1 bg-panol-panel-bg rounded-xl border border-panol-border">
                <button
                  type="button"
                  onClick={() => setTargetType('TRACTOR')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    targetType === 'TRACTOR'
                      ? 'bg-panol-card-bg text-panol-blue shadow border border-panol-blue/40'
                      : 'text-panol-text-muted hover:text-white'
                  }`}
                >
                  <Truck className="w-3.5 h-3.5" />
                  <span>TRACTOR ({tractorPlate || '---'})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setTargetType('SEMI')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    targetType === 'SEMI'
                      ? 'bg-panol-card-bg text-emerald-400 shadow border border-emerald-500/40'
                      : 'text-panol-text-muted hover:text-white'
                  }`}
                >
                  <span>SEMI ({semiPlate || '---'})</span>
                </button>
              </div>
            </div>

            {/* Búsqueda y Selección de Repuestos */}
            <div className="bg-panol-card-bg border border-panol-border rounded-2xl p-3.5 flex flex-col gap-3 shadow-sm">
              <span className="text-[11px] font-black text-panol-text-dim uppercase tracking-wider">
                CATÁLOGO DE REPUESTOS
              </span>

              {/* Selector de Rubro */}
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full bg-panol-panel-bg border border-panol-border rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-panol-blue"
              >
                <option value="">📂 1. Filtrar por Rubro (Opcional)</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              {/* Buscador de repuesto */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-panol-text-dim" />
                <input
                  type="text"
                  placeholder="2. Buscar por nombre o código..."
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 bg-panol-panel-bg border border-panol-border rounded-xl text-xs text-white outline-none focus:border-panol-blue"
                />
              </div>

              {/* Sugerencias de productos */}
              {filteredProducts.length > 0 && (
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                  {filteredProducts.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => {
                        addItem(item);
                        toast.success(`+1 ${item.description}`);
                      }}
                      className="p-2.5 bg-panol-panel-bg border border-panol-border hover:border-panol-blue/50 rounded-xl flex items-center justify-between cursor-pointer transition-colors active:scale-98"
                    >
                      <div>
                        <div className="text-xs font-bold text-white">{item.description}</div>
                        <div className="text-[10px] font-mono text-panol-text-dim">
                          COD: {item.code} • Stock: {item.stock}
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded bg-panol-blue-primary text-white text-xs font-bold">
                        + AGREGAR
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Notas opcionales */}
              <div className="border border-panol-border rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowNotes(!showNotes)}
                  className="w-full px-3 py-2 bg-panol-panel-bg flex items-center justify-between text-xs font-bold text-panol-text-muted hover:text-white"
                >
                  <span>📝 NOTA / DETALLE ADICIONAL</span>
                  {showNotes ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                {showNotes && (
                  <div className="p-2.5 bg-panol-card-bg">
                    <textarea
                      rows={2}
                      value={orderNotes}
                      onChange={(e) => setOrderNotes(e.target.value)}
                      placeholder="Ej. Rueda izquierda, marca específica..."
                      className="w-full bg-panol-panel-bg border border-panol-border rounded-lg p-2 text-xs text-white outline-none focus:border-panol-blue"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Carrito de Repuestos (Lista para Enviar) */}
            {cartItems.length > 0 && (
              <div className="bg-panol-card-bg border border-panol-border rounded-2xl p-3.5 flex flex-col gap-3 shadow-md">
                <div className="flex items-center justify-between border-b border-panol-border/60 pb-2">
                  <span className="text-xs font-black text-white">
                    LISTA PARA ENVIAR ({cartItems.length} ÍTEMS)
                  </span>
                  <button
                    onClick={clearCart}
                    className="text-[11px] text-red-400 hover:text-red-300 font-bold"
                  >
                    Vaciar
                  </button>
                </div>

                <div className="space-y-2">
                  {cartItems.map((ci) => (
                    <div
                      key={ci.item.id}
                      className="p-2.5 bg-panol-panel-bg border border-panol-border rounded-xl flex items-center justify-between"
                    >
                      <div className="flex-1 pr-2">
                        <div className="text-xs font-bold text-white truncate">
                          {ci.item.description}
                        </div>
                        {ci.item.requires_exchange && (
                          <span className="text-[9px] font-bold text-amber-400">
                            • REQUIERE CANJE
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex items-center bg-zinc-800 rounded-lg px-2 py-1">
                          <button
                            onClick={() => updateQuantity(ci.item.id, -1)}
                            className="text-panol-text-dim hover:text-white font-bold px-1"
                          >
                            -
                          </button>
                          <span className="font-mono font-bold text-white px-2 text-xs">
                            {ci.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(ci.item.id, 1)}
                            className="text-panol-text-dim hover:text-white font-bold px-1"
                          >
                            +
                          </button>
                        </div>

                        <button
                          onClick={() => removeItem(ci.item.id)}
                          className="text-panol-text-dim hover:text-red-400 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleConfirmOrder}
                  disabled={isSubmitting}
                  className="w-full py-3 bg-panol-blue-primary hover:bg-blue-600 disabled:opacity-50 text-white font-black text-xs tracking-wider rounded-xl shadow-lg shadow-blue-900/40 flex items-center justify-center gap-2 transition-all active:scale-98"
                >
                  {isSubmitting ? (
                    <span>ENVIANDO PEDIDO...</span>
                  ) : (
                    <>
                      <ShoppingCart className="w-4 h-4" />
                      <span>CONFIRMAR PEDIDO AL PAÑOL</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ======================================================================= */}
        {/* PESTAÑA 2: TAREAS EN FOSA & CRONÓMETRO                                   */}
        {/* ======================================================================= */}
        {activeTab === 'tareas' && (
          <div className="flex flex-col gap-3">
            {/* Header de Unidad Activa */}
            <div className="bg-panol-card-bg border border-panol-border rounded-2xl p-3.5 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-extrabold text-panol-text-dim uppercase tracking-wider block">
                  UNIDAD EN FOSA
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <LicensePlate plate={tractorPlate} size="sm" />
                  <span className="text-xs font-mono font-bold text-panol-text-muted">
                    OT #{tractorOt}
                  </span>
                </div>
              </div>
              <span className="text-xs font-mono font-bold bg-emerald-950/50 text-emerald-400 border border-emerald-800 px-2.5 py-1 rounded-xl">
                BOX {activeBox}
              </span>
            </div>

            {/* Lista de Tareas */}
            <div className="space-y-2.5">
              {tasks.map((task) => {
                const isRunning = runningTaskId === task.id;
                const isFinished = task.status === 'TERMINADO';

                return (
                  <div
                    key={task.id}
                    className={`bg-panol-card-bg border rounded-2xl p-3.5 flex flex-col gap-3 shadow-sm transition-all ${
                      isRunning
                        ? 'border-panol-blue ring-1 ring-panol-blue/40 shadow-blue-950/20'
                        : isFinished
                        ? 'border-emerald-900/40 opacity-75'
                        : 'border-panol-border'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <SectorBadge sector={task.sector} />
                      {isRunning && (
                        <div className="flex items-center gap-1.5 font-mono text-xs font-extrabold text-amber-400 bg-amber-950/40 px-2.5 py-0.5 rounded-full border border-amber-800">
                          <Clock className="w-3.5 h-3.5 animate-spin" />
                          <span>{formatTimer(taskTimer)}</span>
                        </div>
                      )}
                      {isFinished && (
                        <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800">
                          TERMINADO
                        </span>
                      )}
                    </div>

                    <div>
                      <h4 className="text-sm font-bold text-white">
                        {task.task_description}
                      </h4>
                      <p className="text-[11px] text-panol-text-muted mt-0.5">
                        Fosa {activeBox} • Estado: {task.status}
                      </p>
                    </div>

                    {!isFinished && (
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => handleToggleTask(task)}
                          className={`flex-1 py-2.5 rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all ${
                            isRunning
                              ? 'bg-amber-600 hover:bg-amber-500 text-white shadow'
                              : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow'
                          }`}
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>{isRunning ? 'PAUSAR' : 'INICIAR TAREA'}</span>
                        </button>

                        <button
                          onClick={() => handleFinishTask(task)}
                          className="px-4 py-2.5 bg-panol-panel-bg hover:bg-zinc-800 border border-panol-border rounded-xl font-bold text-xs text-emerald-400 flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>FINALIZAR</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {tasks.length === 0 && (
                <div className="text-center py-16 text-panol-text-dim text-xs">
                  No hay tareas operativas asignadas en este momento.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================================================================= */}
        {/* PESTAÑA 3: MIS PEDIDOS (TRACKING EN TIEMPO REAL)                         */}
        {/* ======================================================================= */}
        {activeTab === 'pedidos' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-panol-text uppercase tracking-wider">
                PEDIDOS DEL BOX {activeBox}
              </span>
              <button
                onClick={loadData}
                className="flex items-center gap-1 text-xs text-panol-blue font-bold hover:underline"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Actualizar</span>
              </button>
            </div>

            <div className="space-y-3">
              {myOrders.map((order) => {
                const isReady = order.status === 'LISTO';
                const isPending = order.status === 'PENDIENTE' || order.status === 'EN_PREPARACION';

                return (
                  <div
                    key={order.id || order.req_code}
                    className={`bg-panol-card-bg border rounded-2xl p-3.5 flex flex-col gap-2.5 shadow-sm transition-all ${
                      isReady
                        ? 'border-emerald-500 shadow-emerald-950/30 ring-1 ring-emerald-500/30'
                        : isPending
                        ? 'border-amber-500/40'
                        : 'border-panol-border'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-black text-panol-blue">
                        {order.req_code || (order as any).reqId}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                          isReady
                            ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800 animate-pulse'
                            : isPending
                            ? 'bg-amber-950/60 text-amber-400 border-amber-800'
                            : 'bg-zinc-800 text-panol-text-muted border-zinc-700'
                        }`}
                      >
                        {order.status}
                      </span>
                    </div>

                    {isReady && (
                      <div className="p-2.5 bg-emerald-950/40 border border-emerald-800/60 rounded-xl flex items-center gap-2 text-xs text-emerald-300">
                        <AlertCircle className="w-4 h-4 shrink-0 text-emerald-400" />
                        <span>¡Tu pedido está LISTO para retirar en el mostrador del Pañol!</span>
                      </div>
                    )}

                    <div className="bg-panol-panel-bg p-2 rounded-xl border border-panol-border text-xs space-y-1">
                      {order.items?.map((it, idx) => (
                        <div key={idx} className="flex justify-between text-white">
                          <span>• {it.description || it.code || (it as any).name}</span>
                          <span className="font-mono font-bold text-panol-blue">
                            x{it.quantity || (it as any).qty}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {myOrders.length === 0 && (
                <div className="text-center py-16 text-panol-text-dim text-xs">
                  No tenés pedidos activos en este momento.
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
