---
name: db-clean-views
description: >-
  Metodología universal, estándares de arquitectura y scripts de auditoría para diseñar y refactorizar
  vistas de base de datos (PostgreSQL/Supabase) 100% limpias de identificadores técnicos sustitutos (UUIDs,
  IDs, PKs, FKs). Separa estrictamente los modelos transaccionales físicos de los Read Models orientados
  a frontend y Studio, eliminando polución visual y desacoplando la UI mediante identificadores naturales
  de negocio (hora/timestamp created_at, n_ute, patente, OT).
---

# Metodología y Estándar de Vistas Limpias (Clean DB Views)

Esta skill define la doctrina arquitectónica obligatoria para bases de datos relacionales (PostgreSQL / Supabase) consumidas por aplicaciones web, móviles o interfaces de administración (Studio / Supabase Table Editor): **el desacoplamiento radical entre el modelo de almacenamiento transaccional (Write Model) y los modelos de lectura/proyección (Read Models / Views)**.

---

## 1. El Principio Fundamental: Tablas vs Vistas

1. **Tablas Físicas (`orders`, `unidades`, `tractores`, `order_items`)**:
   - Son las dueñas de la **integridad relacional** y la consistencia ACID.
   - Usan claves primarias sustitutas (`id UUID PRIMARY KEY`) y claves foráneas (`FK UUID`).
   - El frontend **nunca** debe depender de estos UUIDs para renderizar información de negocio.

2. **Vistas de Lectura (`v_*`, `view_*`)**:
   - Son **Read Models** de negocio.
   - **REGLA DE ORO**: Están **100% libres de UUIDs, IDs sustitutos o códigos técnicos redundantes** (`_id`, `id`, `uuid`, `req_code`, `order_number`).
   - Sirven tanto para alimentar el frontend como para inspección visual limpia en Supabase Studio sin contaminación visual.

---

## 2. Las 4 Reglas Canónicas de Vistas Limpias

### Regla 1: Cero Columnas de Identificadores Técnicos
Ninguna vista destinada a consumo de UI, reportes o dashboards debe exponer columnas que terminen en `_id` o se llamen `id`, `uuid` o similares.

| ❌ Prohibido en Vistas | ✅ Reemplazo Canónico Limpio | Justificación |
| :--- | :--- | :--- |
| `order_id UUID` | *(Eliminado)* / `created_at` | La hora del pedido es el identificador visual natural. |
| `mechanic_id UUID` | `mechanic_name TEXT` | El usuario y la UI solo leen el nombre del operario. |
| `tractor_id UUID` | `tractor TEXT` (patente) | La patente es el identificador único del activo. |
| `semi_id UUID` | `semi TEXT` (patente) | La patente es el identificador único del activo. |
| `tractor_wo_id UUID` | `tractor_ot TEXT` | El operario busca por número de OT, no por UUID de sistema. |
| `work_order_id UUID` | `ot_number TEXT` | El número de OT es la referencia real de taller. |
| `panol_staff_id UUID` | `panol_staff_name` + `panol_op_code` | Nombre y legajo del pañolero. |
| `unidad_id UUID` | `n_ute TEXT` / `tractor` | Número de interno / unidad o patente. |

### Regla 2: El Identificador Natural Temporal ("La hora es suficiente")
Para pedidos, movimientos, transacciones y eventos:
- El identificador visual, operativo y de ordenamiento es la hora de creación (`created_at TIMESTAMPTZ`).
- El backend acepta la hora ISO (`created_at = $1::timestamptz`) para localizar la fila física en la tabla base.
- En la interfaz, la hora se formatea a `HH:mm` o `HH:mm hs`.

### Regla 3: JSONB Aggregates 100% Sanitizados
Cuando una vista agrupa ítems hijos (`jsonb_agg(...)`):
- ❌ **Nunca incluir**: `id`, `item_id`, `order_item_id`.
- ✅ **Solo atributos de negocio**: `name`, `code`, `brand`, `location`, `qty`, `delivered_qty`, `returned_qty`, `status`, notas.

### Regla 4: Resolución Relacional dentro de la Base (SQL Joins)
Toda resolución de nombres, marcas, patentes o estados debe resolverse en el `SELECT` de la vista mediante `LEFT JOIN`. Nunca delegar la resolución por IDs al cliente o frontend.
