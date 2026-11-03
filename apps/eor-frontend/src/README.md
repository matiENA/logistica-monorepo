# 🎨 Frontend Moderno — Diagramas EOR (React + Headless UI + TanStack Query)

Documentación técnica de la arquitectura del frontend, modularización por características y catálogo de componentes accesibles implementados con **Headless UI** y **CSS Semántico por Tokens**.

---

## 🏗️ 1. Arquitectura y Stack Tecnológico

El frontend ha sido completamente reescrito para desacoplar la lógica de datos de la interfaz visual, eliminar dependencias pesadas (como Tailwind CDN en tiempo de ejecución) y optimizar el consumo de ancho de banda (**Egress**) y memoria RAM:

- **React 19 + Vite**: Carga ultrarrápida, soporte de módulos ESM nativos y code-splitting con `React.lazy()` y `Suspense`.
- **@headlessui/react (v2)**: Primitivas de interfaz sin estilos predefinidos (unstyled), 100% accesibles según las normas WAI-ARIA, con control total de teclado y lectores de pantalla.
- **@tanstack/react-query (v5)**: Capa de caché en memoria RAM, deduplicación automática de peticiones HTTP, sincronización en segundo plano (`staleTime`) y mutaciones atómicas optimistas.
- **Supabase Client**: Capa de abstracción centralizada (`src/api/supabaseClient.js`) consumiendo **PostgreSQL Views** optimizadas para transferir menos de 15 KB por vista.
- **Lucide React**: Iconografía SVG ligera, importada bajo demanda.
- **Tokens CSS Puros**: Variables CSS nativas en `src/styles/theme.css` que eliminan la necesidad de procesadores pesados o librerías de estilos en tiempo de ejecución.

---

## 🧩 2. Elementos Implementados de Headless UI

A continuación se detalla cada componente de **Headless UI** utilizado en el proyecto, su ubicación en el código y su comportamiento:

### A. `Disclosure`, `DisclosureButton`, `DisclosurePanel`, `Transition` (Acordeones y Dropdowns Desplegables)
- **Ubicaciones:** 
  - `src/features/individual/components/DriverDocAccordion.jsx` (Módulo Individual)
  - `src/features/diaria/components/DailyDriverCard.jsx` (Módulo Diaria - Grilla Operativa)
- **Propósito:** Secciones colapsables interactivas:
  1. **Grilla Diaria (`DailyDriverCard`):** Detalle expandible con métricas del ciclo (26 al 25), vencimientos exactos de documentación (Periódico, Licencia, Cargas Peligrosas) y estado de VTV/MASS de la unidad asignada.
  2. **📝 Historial de Observaciones (Individual):** Muestra la lista histórica de eventos y novedades del conductor con contador dinámico en cabecera.
  3. **📄 Documentación y Vencimientos (Individual):** Panel abierto por defecto (`defaultOpen={true}`) con tarjetas individuales de fechas y guardado atómico.
  4. **🩺 Obs. Aptos Médicos (SRC):** Estado de apto médico (Avalado / No Avalado) con selector de estado y fecha de vigencia.
- **Accesibilidad ARIA integrada:**
  - `DisclosureButton` administra automáticamente los atributos `aria-expanded` y vincula el foco al panel con `aria-controls`.
  - Soporte de teclado: <kbd>Espacio</kbd> o <kbd>Enter</kbd> para alternar el estado abierto/cerrado.
- **Animaciones fluidas con `Transition`:**
  ```jsx
  <Transition
    enter="transition duration-150 ease-out"
    enterFrom="transform scale-95 opacity-0"
    enterTo="transform scale-100 opacity-100"
    leave="transition duration-100 ease-out"
    leaveFrom="transform scale-100 opacity-100"
    leaveTo="transform scale-95 opacity-0"
  >
    <DisclosurePanel className="doc-disclosure-body">
      {/* Contenido dinámico */}
    </DisclosurePanel>
  </Transition>
  ```

---

### B. `Dialog`, `DialogBackdrop`, `DialogPanel`, `DialogTitle` (Slide-Over Drawer Móvil)
- **Ubicación:** `src/components/MobileDrawer.jsx`
- **Propósito:** Panel lateral deslizante (Off-Canvas) para dispositivos móviles y pantallas estrechas, permitiendo filtrar por bases, turnos y estados operativos sin ocupar espacio vertical.
- **Accesibilidad ARIA integrada:**
  - **Focus Trap:** Atrapa el foco dentro del Drawer mientras está abierto, impidiendo la navegación accidental hacia elementos detrás del modal.
  - **Escape Dismiss:** Presionar la tecla <kbd>Esc</kbd> cierra el modal inmediatamente.
  - `DialogBackdrop` atenúa y desenfoca el fondo (`backdrop-filter: blur(4px)`).

---

### C. `TabGroup`, `TabList`, `Tab`, `TabPanels`, `TabPanel` (Navegación Modular)
- **Ubicación:** `src/components/Header.jsx`
- **Propósito:** Barra de navegación superior con los 3 módulos operativos principales de la aplicación:
  - `Diaria` | `Individual` | `Flota`
  - *(Nota: `Métricas`, `Inducciones` y `Diagramas` (grilla general) han sido desacoplados en `src/legacy/`).*
- **Accesibilidad ARIA integrada:**
  - Navegación entre pestañas mediante teclas de flechas (<kbd>←</kbd> / <kbd>→</kbd>).
  - Gestión automática de roles `role="tablist"`, `role="tab"` y `role="tabpanel"`.

---

### D. `Switch` (Interruptores de Estado Booleano)
- **Ubicación:** `src/components/QuickFilters.jsx`
- **Propósito:** Alternadores accesibles para filtros rápidos (ej. *Solo unidades disponibles*, *Filtro de fatiga extrema*, *Modo compacto*).
- **Accesibilidad ARIA integrada:**
  - Actúa como `role="switch"` con `aria-checked="true|false"`.

---

## 💾 3. Guardado Individual y Atómico de Fechas de Documentación

En el módulo **Individual** (`DriverDocAccordion.jsx`), cada campo de fecha cuenta con dos modalidades de persistencia:

### 1. Guardado Atómico Individual (Por Input)
Cada documento cuenta con un botón directo a la derecha del input:
- **`venc_periodico`** (Examen Periódico)
- **`venc_licencia_nacional`** (Licencia Nacional Habilitante)
- **`venc_cargas_peligrosas`** (Certificado de Mercancías Peligrosas)
- **`apto_medico_venc`** (Vencimiento de Apto Médico)

**Flujo:**
1. El usuario modifica la fecha en el input tipo `date`.
2. Presiona el botón individual de guardado (<kbd>💾</kbd>).
3. La mutación `useUpdateDocField` ejecuta un `UPDATE` en `public.chofer_documentacion` únicamente para la columna modificada.
4. El botón cambia instantáneamente a un icono verde de verificación (<kbd>✓</kbd>) durante 2.5 segundos como confirmación visual.
5. TanStack Query invalida la clave de caché `['driver_docs', choferId]` manteniendo la consistencia de datos sin recargar la página.

### 2. Guardado Masivo Global
- El botón **`GUARDAR VENCIMIENTOS`** en la parte inferior del panel ejecuta la mutación `useSaveAllDocs`, persistiendo simultáneamente todos los valores en una sola transacción.

### 3. Semáforo Dinámico de Vencimientos
El helper `getBadgeState(dateStr)` evalúa los días restantes en tiempo real:
- **VIGENTE** (Verde): Más de 30 días antes del vencimiento.
- **POR VENCER** (Ámbar): Vence en los próximos 30 días.
- **VENCIDO** (Rojo): La fecha es anterior a hoy.
- **SIN REGISTRO** (Gris): Campo vacío o no especificado.

---

## 🎨 4. Desacoplamiento de Estilos: Tokens CSS

En lugar de cargar librerías utility-first monolíticas como Tailwind en tiempo de ejecución, toda la interfaz está gobernada por variables CSS nativas en `src/styles/theme.css`:

```css
:root {
  --primary: #2563eb;
  --primary-light: #eff6ff;
  --primary-dark: #1d4ed8;
  
  --bg-app: #f8fafc;
  --bg-surface: #ffffff;
  --bg-surface-muted: #f1f5f9;
  
  --text-main: #0f172a;
  --text-secondary: #475569;
  --text-muted: #94a3b8;
  
  --border-subtle: #e2e8f0;
  --border-strong: #cbd5e1;
  
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
}
```

### Organización de Hojas de Estilo en `src/styles/`:
- `theme.css`: Variables maestras, paleta de colores, sombras y radios.
- `layout.css`: Header sticky, contenedor responsivo de aplicación y navegación por pestañas.
- `cards.css`: Tarjetas de choferes, unidades y novedades de la vista Diaria.
- `filters.css`: Buscadores, botones de filtro y cajón drawer móvil.
- `modules.css`: Tablas de datos, paginadores y vistas para Flota, Diagrama, Métricas e Inducciones.
- `individual.css`: Ficha del conductor, contenedor 3:4 de foto, acordiones de Headless UI y calendario trimestral con Shift+Clic.

---

## 🚀 5. Cómo Extender o Agregar Nuevos Componentes de Headless UI

Si deseas agregar un nuevo componente interactivo, sigue estas pautas para mantener la coherencia y el desacoplamiento:

### Ejemplo: Dropdown de Menú de Acciones (`Menu`)
```jsx
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/react';
import { MoreVertical, Download, Printer } from 'lucide-react';

export const ActionsDropdown = () => (
  <Menu as="div" style={{ position: 'relative', display: 'inline-block' }}>
    <MenuButton className="btn-secondary">
      <MoreVertical size={16} />
    </MenuButton>

    <MenuItems className="data-table-wrapper" style={{
      position: 'absolute',
      right: 0,
      marginTop: '0.5rem',
      width: '180px',
      padding: '0.35rem',
      zIndex: 50
    }}>
      <MenuItem>
        {({ focus }) => (
          <button className={`btn-menu-item ${focus ? 'focused' : ''}`}>
            <Download size={14} /> Exportar Excel
          </button>
        )}
      </MenuItem>
      <MenuItem>
        {({ focus }) => (
          <button className={`btn-menu-item ${focus ? 'focused' : ''}`}>
            <Printer size={14} /> Imprimir Ficha
          </button>
        )}
      </MenuItem>
    </MenuItems>
  </Menu>
);
```

---

## 📦 6. Compilación y Despliegue

Para compilar el frontend y generar los assets optimizados en la carpeta `public/`:

```bash
# Compilación de producción con Vite
npm run build

# Levantar el servidor Node.js que sirve la aplicación y APIs
npm start
```
Los archivos finales se minifican y se emiten a `public/assets/`, listos para ser servidos de forma estática con compresión gzip y control de caché `Cache-Control`.
