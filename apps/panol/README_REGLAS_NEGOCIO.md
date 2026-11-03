# 📘 Reglas de Negocio del Sistema Pañol Logistics & Taller

Este documento constituye la **especificación canónica de reglas de negocio** implementadas en el sistema. Cualquier cambio en estas reglas por parte de los stakeholders debe actualizarse en este archivo y reflejarse en los servicios de Backend y Frontend correspondientes.

---

## 📌 REGLA 1: Delimitación de Fuentes de Datos (SSOT Híbrido)
1. **Supabase PostgreSQL (`rsvajuxihvmpmrmlcbul`)** es la **Fuente Única de la Verdad (SSOT)** para:
   - Maestro de flota: `public.tractores`, `public.semis`, `public.unidades`, `public.servicios_unidades`.
   - Gestión de taller: `panol.work_orders`, `panol.unit_work_orders`, `panol.work_order_tasks`.
   - Nómina y usuarios: `panol.staff` (vinculado con `auth.users`).
   - Gestión de pañol: `panol.orders`, `panol.order_items`, `panol.items`.
   - Puestos y retenciones: `panol.staff_holds`.
2. **Google Sheets** queda **estrictamente delimitado** a:
   - Lectura de la matriz de asignación de números de OT vigentes en la pestaña **`DB_OT_LIST`** (Tractor, OT Tractor, Semi, OT Semi, Producto, Marca Tractor, Marca Semi).
   - El backend lee esta tabla para sincronizar los números de OT activos con `panol.unit_work_orders`. Ningún otro flujo transaccional de la app taller lee de Sheets.

---

## 📌 REGLA 2: Interacción con Tareas y Bloqueo Colaborativo (Anti-Solapamiento)
1. **Inicio de Tarea ("Empecé")**:
   - Al presionar *"Empecé"*, la tarea pasa a estado `EN_CURSO`.
   - Se registra el timestamp de inicio (`empezo`), el box actual del puesto y se asigna a la instancia del operario logueado (`assigned_staff_id = currentUser.id`).
2. **Bloqueo para Terceros**:
   - Mientras una tarea esté `EN_CURSO`, los botones de *"Empecé"* y *"Terminé"* se muestran **deshabilitados** para todos los demás operarios del taller.
   - La tarea exhibe un distintivo visual claro: `👤 En curso por [Nombre del Mecánico] (Box XX)`.
3. **Relevo de Turno / Reasignación Explícita**:
   - Si otro operario intenta interactuar con una tarea asignada a un compañero (por ejemplo en un relevo de turno o asistencia compartida), el sistema **NO** ejecuta la acción de forma ciega; despliega un modal de confirmación:
     > *"Esta tarea fue iniciada por [Nombre]. ¿Confirmas que tomas el relevo de la tarea en este momento?"*
   - Al confirmar, se reasigna la tarea al nuevo operario y box, registrando la novedad en tiempo real.
4. **Finalización de Tarea ("Terminé")**:
   - Solo el operario asignado (o quien haya tomado el relevo) puede presionar *"Terminé"*, pasando el estado a `COMPLETADA` / `TERMINADO`.

---

## 📌 REGLA 3: Consolidación Atómica y Purga al 100% (Cold Storage Automático)
1. Cada vez que una tarea cambia de estado, el trigger `trg_wot_sync_avg` recalcula el porcentaje promedio ponderado de la OT (`avg`) en `panol.work_orders`.
2. Cuando el 100% de las tareas de una OT están completadas:
   - La función PostgreSQL `panol.consolidate_completed_work_order` se ejecuta atómicamente.
   - Empaqueta todas las tareas finalizadas con sus tiempos y mecánicos en el campo `json_format` (JSONB snapshot) dentro de `panol.work_orders`.
   - Cambia el estado de la OT a `COMPLETADA`.
   - Elimina las filas de `panol.work_order_tasks` de la tabla activa.
3. **Objetivo de Performance**: Mantener la tabla viva de tareas siempre compacta (< 3.000 filas activas), garantizando tiempos de respuesta inferiores a 30 ms permanentemente.

---

## 📌 REGLA 4: Alcance y Aislamiento de Pedidos en Terminal de Taller
1. **Emisión de Pedidos**:
   - Todo pedido de repuestos generado en la Terminal Taller se asocia obligatoriamente a:
     - `mechanic_id`: UUID de `panol.staff` del operario logueado.
     - `box_number`: Box físico asignado.
     - `work_order_id`: UUID de la orden de trabajo en bahía.
     - `unidad_id` / `tractor_id` / `semi_id`.
2. **Visibilidad en Terminal**:
   - La pestaña *"PEDIDOS"* en la terminal ofrece dos modos de vista:
     - **"Mis Pedidos" (Predeterminada)**: Muestra exclusivamente los pedidos emitidos por el operario conectado para evitar confusiones de entregas.
     - **"Todos los Pedidos de la Unidad/Box"**: Permite auditar todos los repuestos pedidos para esa misma unidad por otros turnos o compañeros.

---

## 📌 REGLA 5: Autenticación e Instancia de Usuario
1. La entidad maestra de usuarios de taller es **`panol.staff`**.
2. Se eliminaron definitivamente las columnas heredadas `app_access` e `is_active` (utilizadas en versiones previas de Google Sheets).
3. `panol.staff` se vincula con la tabla de autenticación nativa de Supabase mediante la columna `auth_user_id` (`auth.users.id`).
4. El inicio de sesión valida el legajo (`op_code`) y la credencial de acceso, cargando en el estado del cliente:
   - `id`: UUID de `panol.staff`.
   - `op_code`: Legajo del operario.
   - `name`: Nombre y apellido oficial.
   - `role`: Rol operativo (`MECANICO`, `PANOLERO`, `SUPERVISOR`, `ADMIN`).
   - `default_boxes`: Bahías asignadas por defecto.

---

## 📌 REGLA 6: Tablero Kanban de Coordinación (`/coordinacion`)
1. **Ruta y Despliegue Unificado**:
   - La vista vive en `/coordinacion` dentro de `panol/frontend` (mismo puerto y mismo Static Site `panol-static-site` en Render que `/panol`), protegida únicamente por la Capa 1 de autorización de dispositivo (90 días).
   - Se conecta directamente a Supabase (`rsvajuxihvmpmrmlcbul`) consumiendo las vistas SQL `panol.v_coord_kanban_progreso`, `panol.v_coord_kanban_terminados` y `panol.v_coord_unit_tasks`, con actualización en vivo vía Supabase Realtime (`postgres_changes` sobre `panol.work_order_tasks` y `panol.work_orders`).
2. **Agrupación de Columnas — Fase 1 (Orden fijo de izquierda a derecha)**:
   - `HACIENDO NADA`: Unidades con Orden de Trabajo activa pero sin ninguna tarea `EN_CURSO` (inactivos).
   - `LUBRICENTRO · ENGRASE · LAVADERO · GOMERIA`: Roles `LUBRICENTRO`, `ENGRASE`, `LAVADERO`, `GOMERIA`.
   - `ENA`: Role `ENA`.
   - `MOTORES`: Roles `MOTORES` y `CHAPA Y PINTURA`.
   - `VTV · MASS`: Roles `VTV`, `MASS`, `VIAL`.
   - `TALLER`: Unifica los roles `TALLER`, `MECANICO`, `ELECTRICIDAD` y `MECANICA`.
3. **Ubicación de cada Card en Columna *(Regla sujeta a cambios)***:
   - **En `PROGRESO`**: Cada par (Tractor + Semi) se muestra en **una única columna**, determinada por la tarea con `estado = 'EN_CURSO'` e inicio (`empezo`) más reciente en `panol.work_order_tasks`. Su `worker_id` se cruza con `panol.staff`:
     - `staff.role` define la columna según la agrupación de Fase 1 (con fallback al rubro `[SECTOR]` de la tarea si el rol del operario no estuviera tipificado).
     - `staff.name` se exhibe como **Operario** en la card retraída.
     - `staff.default_boxes` se exhibe como **Ubicación** en la card retraída.
     - Si el par no posee ninguna tarea `EN_CURSO`, se ubica en `HACIENDO NADA` (`Sin asignar` / `—`).
   - **En `TERMINADOS` (Vista de Auditoría `100%` vs `incompleto`)**:
     - **Sin cabeceras de sector ni grilla de 6 columnas**: La vista se divide en dos únicas zonas separadas por un divisor central punteado amarillo:
       - **`100%`**: Órdenes cuyo porcentaje promedio consolidado del par (`combined_avg`) sea estrictamente 100%.
       - **`incompleto`**: Órdenes cerradas en la ventana de 7 días cuyo `combined_avg < 100%` (0% a 99%), ordenables con el botón `▲`/`▼`.
     - **Card de Unidad en `TERMINADOS`**:
       - Muestra el porcentaje con padding a 2 dígitos (`00%`, `01%`, etc.).
       - Exhibe la **Fecha Última** en formato hispano `dd/mm` (sin año, a partir de `active_termino` o `close_date`).
       - Exhibe el **Operario** que intervino en la última tarea (o `Sin asignar`).
       - Exhibe la **Ubicación en base** (priorizando la ubicación/box de la tarea para saber inmediatamente dónde quedó estacionada la unidad en base).
     - Fuente de datos: `panol.work_orders_cold` y `panol.work_orders` (`status IN ('COMPLETADA', 'CERRADA', 'INCOMPLETA')`) en ventana de **últimos 7 días** por `close_date`.
4. **Cálculo Flexible del Porcentaje Promedio (`combined_avg`)**:
   - Toma `public.unidades` como índice de acople entre `tractor_id` y `semi_id`, soportando también unidades que se trabajan solas:
     - Si tanto el Tractor como el Semi poseen OT activa, `combined_avg = ROUND((tractor_avg + semi_avg) / 2, 0)`.
     - Si solo uno de los dos posee OT activa (o es un vehículo suelto sin par en `public.unidades`), `combined_avg` toma el `avg` de la única OT activa sin dividir por 2.
5. **Interacción en el Modal Desplegable de Tareas**:
   - Al hacer clic en una card se despliega el modal centrado con el detalle de tareas de Tractor y Semi.
   - Desde Coordinación solo son editables los pills de **Ubicación** (`ubicacion`) y **Operario** (`worker_id`), registrando automáticamente el timestamp `asignado = NOW()` cuando se asigna por primera vez.
   - Los timestamps **Empezó** (`empezo`) y **Terminó** (`termino`) son de **solo lectura** en Coordinación y se registran exclusivamente desde la interacción en la app de Taller / Mobile.

