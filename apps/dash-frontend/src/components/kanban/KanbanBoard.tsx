import React, { useMemo, useRef } from 'react';
import { Folder, User, MessageSquare } from 'lucide-react';
import { Novedad, FlotaItem, Usuario, RetornoItem } from '../../types/dash';
import { useDashStore } from '../../store/useDashStore';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { LibresRow } from './LibresRow';
import { ReturnColumn } from './ReturnColumn';
import { ColumnSplitter } from './ColumnSplitter';
import { NoveltyCard } from './NoveltyCard';

interface KanbanBoardProps {
  novedades: Novedad[];
  flota: FlotaItem[];
  usuarios: Usuario[];
  retornos: RetornoItem[];
  onResolver: (id: number | string, nuevoServicio?: string) => void;
  onEditar?: (novedad: Novedad) => void;
  onCambiarTerminal?: (id: number | string, terminal: string, terminal_id?: string | null) => void;
  onCambiarServicio?: (id: number | string, servicio: string) => void;
  onAgregarMencion?: (id: number | string, usuario: string) => void;
  onQuitarMencion?: (id: number | string, usuario: string) => void;
  onNovedadPublicada?: (nueva?: Novedad | null) => void;
  onRecargar: () => void;
}

const CATEGORIAS_CONFIG: Record<
  string,
  { titulo: string; colorText: string; borderColor: string }
> = {
  BAJA_DIAGRAMA: {
    titulo: 'BAJA / TÉRMINO DE DIAGRAMA',
    colorText: 'text-red-500',
    borderColor: 'border-red-500'
  },
  REPARACION: {
    titulo: 'REPARACIONES REQUERIDAS',
    colorText: 'text-indigo-500',
    borderColor: 'border-indigo-500'
  },
  CERTIFICACION_UNIDAD: {
    titulo: 'CERTIFICACIONES DE UNIDAD',
    colorText: 'text-orange-400',
    borderColor: 'border-orange-300'
  },
  EXAMEN_CHOFER: {
    titulo: 'EXÁMENES / VENCIMIENTOS',
    colorText: 'text-emerald-500',
    borderColor: 'border-emerald-500'
  },
  ESTADO_DEMORA: {
    titulo: 'ESTADO / DEMORA',
    colorText: 'text-[#D28976]',
    borderColor: 'border-[#D28976]'
  }
};

interface KanbanCategoryColumnProps {
  catKey: string;
  cat: { titulo: string; colorText: string; borderColor: string; bgHex?: string };
  items: Novedad[];
  flexWeight: number;
  usuarios: Usuario[];
  onResolver: (id: number | string, nuevoServicio?: string) => void;
  onEditar?: (novedad: Novedad) => void;
  onCambiarTerminal?: (id: number | string, terminal: string, terminal_id?: string | null) => void;
  onCambiarServicio?: (id: number | string, servicio: string) => void;
  onAgregarMencion?: (id: number | string, usuario: string) => void;
  onQuitarMencion?: (id: number | string, usuario: string) => void;
}

const KanbanCategoryColumn: React.FC<KanbanCategoryColumnProps> = ({
  catKey,
  cat,
  items,
  flexWeight,
  usuarios,
  onResolver,
  onEditar,
  onCambiarTerminal,
  onCambiarServicio,
  onAgregarMencion,
  onQuitarMencion
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  useAutoScroll(scrollRef, [items.length]);

  return (
    <section
      data-cat={catKey}
      style={{
        flex: `${flexWeight} 1 0%`,
        minWidth: '130px',
        ...(cat.bgHex ? { borderColor: `${cat.bgHex}66` } : {})
      }}
      className={`resizable-column flex-1 border-2 border-dashed ${!cat.bgHex ? cat.borderColor : ''} rounded-2xl p-3 bg-transparent flex flex-col h-full min-h-0 overflow-hidden transition-all duration-100 relative`}
    >
      {/* Título de Columna */}
      <div className="w-full mb-2 shrink-0 flex items-center justify-center pb-1 border-b border-slate-200/40 dark:border-slate-800/40">
        <h2
          style={cat.bgHex ? { color: cat.bgHex } : undefined}
          className={`text-[11px] font-black uppercase tracking-widest ${!cat.bgHex ? cat.colorText : ''} text-center flex-1 select-none truncate`}
        >
          {cat.titulo}
        </h2>
      </div>

      {/* Lista de Tarjetas */}
      <div
        ref={scrollRef}
        id={`carrusel-cat-${catKey}`}
        className="flex flex-col gap-3.5 overflow-y-auto custom-scrollbar pr-1.5 pb-2 h-full min-h-0 flex-1"
      >
        {items.length === 0 ? (
          <div className="flex-1 flex justify-center items-center text-slate-400 text-xs font-bold opacity-70 select-none">
            Sin novedades cargadas
          </div>
        ) : (
          items.map((nov) => (
            <NoveltyCard
              key={nov.id}
              novedad={nov}
              usuarios={usuarios}
              onResolver={onResolver}
              onEditar={onEditar}
              onCambiarTerminal={onCambiarTerminal}
              onCambiarServicio={onCambiarServicio}
              onAgregarMencion={onAgregarMencion}
              onQuitarMencion={onQuitarMencion}
            />
          ))
        )}
      </div>
    </section>
  );
};

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  novedades,
  flota,
  usuarios,
  retornos,
  onResolver,
  onEditar,
  onCambiarTerminal,
  onCambiarServicio,
  onAgregarMencion,
  onQuitarMencion,
  onNovedadPublicada,
  onRecargar
}) => {
  const { vistaActual, sesion, busqueda, filtroTerminal, columnWidths, tiposNovedad } = useDashStore();
  const usuarioActual = sesion?.usuario ? sesion.usuario.toUpperCase() : '';

  // Filtrado de novedades
  const { activas, resueltas, libres } = useMemo(() => {
    const act: Novedad[] = [];
    const res: Novedad[] = [];
    const lib: Novedad[] = [];

    novedades.forEach((n) => {
      // Filtro de búsqueda
      if (busqueda) {
        const q = busqueda.toLowerCase().trim();
        const coincideNom = n.nom && n.nom.toLowerCase().includes(q);
        const coincideTractor = n.tractor && n.tractor.toLowerCase().includes(q);
        const coincideDetalle = n.detalle && n.detalle.toLowerCase().includes(q);
        if (!coincideNom && !coincideTractor && !coincideDetalle) return;
      }

      // Filtro de Terminal
      if (filtroTerminal && n.terminal !== filtroTerminal) return;

      if (n.resuelto) {
        res.push(n);
      } else {
        act.push(n);
        if (n.tipo_novedad === 'LIBRES') {
          lib.push(n);
        }
      }
    });

    return { activas: act, resueltas: res, libres: lib };
  }, [novedades, busqueda, filtroTerminal]);

  // Configuración dinámica de columnas según tiposNovedad (declarado al inicio para cumplir las reglas de hooks)
  const categoriasConfig = useMemo(() => {
    const map: Record<string, { titulo: string; colorText: string; borderColor: string; bgHex?: string }> = {};
    if (tiposNovedad && tiposNovedad.length > 0) {
      tiposNovedad.forEach((tn) => {
        if (tn.codigo === 'LIBRES') return; // Se renderiza en LibresRow
        const fallback = CATEGORIAS_CONFIG[tn.codigo] || {
          titulo: (tn?.titulo || (tn as any)?.denominacion || tn?.codigo || '').toUpperCase(),
          colorText: 'text-indigo-500',
          borderColor: 'border-indigo-500'
        };
        const tituloTexto = (tn?.titulo || (tn as any)?.denominacion || fallback.titulo || tn?.codigo || '').toUpperCase();
        map[tn.codigo] = {
          titulo: tituloTexto,
          colorText: fallback.colorText,
          borderColor: fallback.borderColor,
          bgHex: tn.bg_color || (tn as any).color || undefined
        };
      });
    } else {
      Object.assign(map, CATEGORIAS_CONFIG);
    }
    return map;
  }, [tiposNovedad]);

  // VISTA: ARCHIVO (Resueltos)
  if (vistaActual === 'archivo') {
    if (resueltas.length === 0) {
      return (
        <div className="h-64 flex flex-col justify-center items-center text-slate-400 dark:text-slate-500 select-none">
          <Folder className="w-12 h-12 mb-3 stroke-[1.5] text-slate-300 dark:text-slate-600" />
          <span className="font-extrabold tracking-widest uppercase text-xs">
            Sin historial de novedades resueltas
          </span>
        </div>
      );
    }
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 w-full h-full min-h-0 overflow-y-auto custom-scrollbar p-3 items-start content-start flex-1">
        {resueltas.map((nov) => (
          <NoveltyCard
            key={nov.id}
            novedad={nov}
            usuarios={usuarios}
            onResolver={onResolver}
            onEditar={onEditar}
          />
        ))}
      </div>
    );
  }

  // VISTA: MIS NOVEDADES
  if (vistaActual === 'mis_novedades') {
    const misNovs = activas.filter(
      (n) =>
        (n.usuario && n.usuario.toUpperCase() === usuarioActual) ||
        (n.creador && n.creador.toUpperCase() === usuarioActual)
    );
    if (misNovs.length === 0) {
      return (
        <div className="h-64 flex flex-col justify-center items-center text-slate-400 dark:text-slate-500 select-none">
          <User className="w-12 h-12 mb-3 stroke-[1.5] text-slate-300 dark:text-slate-600" />
          <span className="font-extrabold tracking-widest uppercase text-xs">
            No has creado novedades activas
          </span>
        </div>
      );
    }
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 w-full h-full min-h-0 overflow-y-auto custom-scrollbar p-3 items-start content-start flex-1">
        {misNovs.map((nov) => (
          <NoveltyCard
            key={nov.id}
            novedad={nov}
            usuarios={usuarios}
            onResolver={onResolver}
            onEditar={onEditar}
            onCambiarTerminal={onCambiarTerminal}
            onCambiarServicio={onCambiarServicio}
            onAgregarMencion={onAgregarMencion}
            onQuitarMencion={onQuitarMencion}
          />
        ))}
      </div>
    );
  }

  // VISTA: MENCIONES (@)
  if (vistaActual === 'menciones') {
    const mencionesNovs = activas.filter(
      (n) =>
        Array.isArray(n.menciones) &&
        n.menciones.some((m) => (m || '').toUpperCase() === usuarioActual)
    );
    if (mencionesNovs.length === 0) {
      return (
        <div className="h-64 flex flex-col justify-center items-center text-slate-400 dark:text-slate-500 select-none">
          <MessageSquare className="w-12 h-12 mb-3 stroke-[1.5] text-slate-300 dark:text-slate-600" />
          <span className="font-extrabold tracking-widest uppercase text-xs">
            No tienes menciones pendientes
          </span>
        </div>
      );
    }
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 w-full h-full min-h-0 overflow-y-auto custom-scrollbar p-3 items-start content-start flex-1">
        {mencionesNovs.map((nov) => (
          <NoveltyCard
            key={nov.id}
            novedad={nov}
            usuarios={usuarios}
            onResolver={onResolver}
            onEditar={onEditar}
            onCambiarTerminal={onCambiarTerminal}
            onCambiarServicio={onCambiarServicio}
            onAgregarMencion={onAgregarMencion}
            onQuitarMencion={onQuitarMencion}
          />
        ))}
      </div>
    );
  }

  // ==========================================
  // VISTA: TODAS (TABLERO KANBAN PROPORCIONAL)
  // ==========================================
  // Agrupar novedades por categoría
  const colKeys = Object.keys(categoriasConfig);
  const categoriasItems: Record<string, Novedad[]> = {};
  colKeys.forEach((key) => {
    categoriasItems[key] = [];
  });

  activas.forEach((n) => {
    if (n.tipo_novedad === 'LIBRES') return;
    if (categoriasItems[n.tipo_novedad]) {
      categoriasItems[n.tipo_novedad].push(n);
    } else {
      const defaultCol = categoriasItems['REPARACION'] ? 'REPARACION' : colKeys[0];
      if (defaultCol && categoriasItems[defaultCol]) {
        categoriasItems[defaultCol].push(n);
      }
    }
  });

  const tieneRetornos = retornos && retornos.length > 0;

  // Armar lista de claves visibles en el kanban
  const columnasVisibles: string[] = [];
  if (tieneRetornos) columnasVisibles.push('VUELVE');
  colKeys.forEach((key) => {
    if (categoriasItems[key] && (categoriasItems[key].length > 0 || !tieneRetornos)) {
      columnasVisibles.push(key);
    }
  });

  return (
    <div className="h-full w-full flex flex-col gap-2 overflow-hidden flex-1 p-2 md:p-3">
      {/* 1. FILA SUPERIOR EXCLUSIVA: LIBRES */}
      <LibresRow
        novedadesLibres={libres}
        flota={flota}
        usuarios={usuarios}
        onResolver={onResolver}
        onEditar={onEditar}
        onCambiarTerminal={onCambiarTerminal}
        onCambiarServicio={onCambiarServicio}
        onAgregarMencion={onAgregarMencion}
        onQuitarMencion={onQuitarMencion}
        onNovedadPublicada={onNovedadPublicada}
        onRecargar={onRecargar}
      />

      {/* 2. CONTENEDOR DE COLUMNAS KANBAN PROPORCIONALES (100% PANTALLA) */}
      <div
        id="kanban-columns-wrapper"
        className="flex gap-2 md:gap-3 w-full h-full min-h-0 flex-1 overflow-hidden items-stretch"
      >
        {columnasVisibles.map((key, index) => {
          const flexWeight = columnWidths[key] || 1;
          const isNotLast = index < columnasVisibles.length - 1;
          const nextKey = columnasVisibles[index + 1];

          if (key === 'VUELVE') {
            return (
              <React.Fragment key="col-vuelve">
                <ReturnColumn
                  retornos={retornos}
                  flota={flota}
                  flexWeight={flexWeight}
                />
                {isNotLast && <ColumnSplitter leftKey="VUELVE" rightKey={nextKey} />}
              </React.Fragment>
            );
          }

          const cat = categoriasConfig[key] || CATEGORIAS_CONFIG[key] || {
            titulo: key,
            colorText: 'text-indigo-500',
            borderColor: 'border-indigo-500'
          };
          const items = categoriasItems[key] || [];

          return (
            <React.Fragment key={key}>
              <KanbanCategoryColumn
                catKey={key}
                cat={cat}
                items={items}
                flexWeight={flexWeight}
                usuarios={usuarios}
                onResolver={onResolver}
                onEditar={onEditar}
                onCambiarTerminal={onCambiarTerminal}
                onCambiarServicio={onCambiarServicio}
                onAgregarMencion={onAgregarMencion}
                onQuitarMencion={onQuitarMencion}
              />
              {isNotLast && <ColumnSplitter leftKey={key} rightKey={nextKey} />}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
