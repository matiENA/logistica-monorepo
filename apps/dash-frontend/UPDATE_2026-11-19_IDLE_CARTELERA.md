# Update 2026-11-19 — Transición Automática por Inactividad a Modo Cartelera (`dash-frontend`)

## 1. Resumen Funcional
Se implementó la transición automática entre el **modo edición** y el **modo cartelera (`modoCartelera`)** controlada por tiempo de inactividad en `apps/dash-frontend`:

- **Entrada automática por inactividad (60 segundos)**: Si hay una sesión iniciada y transcurren `60_000 ms` sin interacción (`pointerdown`, `keydown`, `wheel`, `touchstart`, `scroll`, `mousemove`), el tablero pasa automáticamente a `modoCartelera` activando el auto-scroll en columnas y fila de Libres.
- **Retorno a edición — Opción B**: Mientras `modoCartelera` está activo, el **primer clic/tap o tecla** (ignorando `mousemove`, teclas modificadoras/función y los botones de control del header) devuelve el tablero al modo edición. El clic que despierta la interfaz consume el evento en fase de captura (`preventDefault` + `stopPropagation`) para evitar acciones accidentales sobre tarjetas o botones.
- **Transición *Smooth* sin Layout Shift**: Se reemplazaron los desmontajes abruptos (`return null`) y el `display: none !important` en controles de edición por transiciones CSS de ~300 ms (`opacity`, `transform`, `max-width` / `width`) con soporte `prefers-reduced-motion`.

## 2. Clasificación Arquitectónica (`/db-render-arch`)
- **Capa afectada**: **100% Capa C0 (Estado React/Zustand + DOM/CSS)**.
- **Impacto en C1 / C2 / C3**: **Cero**. El cambio a modo cartelera y su retorno no disparan peticiones REST adicionales, no generan reconexiones en Socket.IO (`/dash`), no alteran la caché Hot RAM del backend ni consumen cuotas adicionales de Supabase o Render.
- **Delta de variables de entorno**: Ninguna variable nueva en `.env` ni `.env.example`.

## 3. Mitigaciones Técnicas Implementadas
1. **Protección de borradores y arrastres activos**: El temporizador de 60s se pausa automáticamente si `NoveltyModal` (`modalNuevaAbierto`), `ServiceDropOverlay` (`overlayServiceAbierto`), algún `<input>`/`<textarea>`/`<select>`/`contentEditable` tiene foco, o si la pestaña está oculta (`document.hidden`).
2. **Sin contaminación de `localStorage`**: `useDashStore` distingue `setModoCartelera(activo, { persistir, origen })`. Las transiciones automáticas (`origen: 'idle'`) usan `persistir: false` para no pisar la preferencia manual del operador ante un `F5`.
3. **Preservación de pestaña activa (`vistaActual`)**: Si el idle ocurre estando en `archivo`, `mis_novedades` o `menciones`, cambia a `'todas'` para mostrar el Kanban con auto-scroll y guarda la vista previa en memoria para restaurarla al volver a edición.
4. **Limpieza de estados locales de UI**: Al entrar en `modoCartelera`, se cierran menús y dropdowns abiertos en `NoveltyCard` (`isHovered`, `isPinned`, `dropTerminalAbierto`, `dropServicioAbierto`, `dropMencionAbierto`, `textoMencion`), `LibresRow` (`terminalMenu`) y `QuickAddLibre` (`abierto`, `busqueda`).
5. **Controles del `Header` protegidos**: El botón de Cartelera y el Reloj (`data-cartelera-control="true"`) no sufren doble toggle, y el switch de Dark/Light Mode (`data-cartelera-ignore="true"`) puede usarse sin sacar el tablero de modo cartelera.
6. **Cero re-renders por actividad**: El hook `useIdleCartelera` gestiona el timer mediante referencias locales y throttle de 1s para `mousemove`/`scroll`, ejecutando `setState` únicamente al cumplirse los 60s o al despertar.

## 4. Archivos Creados y Modificados
- `apps/dash-frontend/src/hooks/useIdleCartelera.ts` *(nuevo)*
- `apps/dash-frontend/src/store/useDashStore.ts`
- `apps/dash-frontend/src/App.tsx`
- `apps/dash-frontend/src/index.css`
- `apps/dash-frontend/src/components/layout/Header.tsx`
- `apps/dash-frontend/src/components/kanban/QuickAddLibre.tsx`
- `apps/dash-frontend/src/components/kanban/ColumnSplitter.tsx`
- `apps/dash-frontend/src/components/kanban/LibresRow.tsx`
- `apps/dash-frontend/src/components/kanban/NoveltyCard.tsx`
- `HANDOFF.md`
- `apps/dash-frontend/UPDATE_2026-11-19_IDLE_CARTELERA.md` *(nuevo)*

## 5. Prueba Rápida en Localhost
1. Abrir `http://localhost:3000` e iniciar sesión.
2. Dejar el tablero sin clics, scroll ni teclado durante 60 segundos (con modal cerrado y sin inputs enfocados): la barra superior, botones de edición, splitters y Quick Add se ocultarán suavemente y comenzará el auto-scroll.
3. Mover el mouse (`mousemove`): permanece en modo cartelera.
4. Hacer clic sobre cualquier zona del tablero o presionar una tecla (ej. `Espacio` o `Enter`): vuelve suavemente a modo edición sin disparar acciones sobre las tarjetas y restaurando la pestaña previa si correspondía.
