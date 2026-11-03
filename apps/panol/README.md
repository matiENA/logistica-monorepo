# 🚀 Pañol Logistics — Nueva Plataforma Desacoplada

Arquitectura moderna y desacoplada de **Pañol Logistics**:
- **Frontend:** SPA en **Vite 6 + React 18 + TypeScript + Tailwind CSS** (ubicado en `frontend/`).
- **Backend:** API REST y WebSockets en **Node.js + Express + Supabase (PostgreSQL Pool)** (ubicado en `backend/`).

---

## 💻 Desarrollo Local (Localhost)

Para ejecutar ambos servicios en simultáneo con un único comando:

```bash
# Desde la raíz del proyecto (C:\Users\Matias Rodriguez\Documents\panol)
npm run dev
```

Esto iniciará concurrentemente:
- 🌐 **Frontend (Vite):** [http://localhost:5173](http://localhost:5173)
- ⚙️ **Backend (API REST & WebSockets):** [http://localhost:5000](http://localhost:5000)

### Comandos individuales:
```bash
npm run dev:front   # Inicia solo el frontend en Vite (:5173)
npm run dev:back    # Inicia solo el backend con hot-reload (:5000)
npm run build       # Compila el frontend para producción (tsc && vite build)
npm run test-db     # Prueba de conexión al Pool PostgreSQL de Supabase
```

---

## ☁️ Despliegue en Render (`render.yaml`)

El archivo [`render.yaml`](./render.yaml) contiene la configuración automática en Blueprints:

1. **Static Site (`panol-static-site`):**
   - **Directorio raíz:** `frontend`
   - **Comando de build:** `npm install && npm run build`
   - **Directorio de publicación:** `./dist`
   - **Rutas SPA:** Reescribe todas las rutas (`/*`) a `/index.html`.

2. **Web Service (`panol-monolith-service`):**
   - **Entorno:** Node
   - **Comando de inicio:** `node index.js` (apunta a `backend/index.js`)
   - **Conexión a BD:** Supabase PostgreSQL Pool optimizado.

---

## 🔒 Variables de Entorno (`.env`)

Tanto `frontend/.env` como `backend/.env` ya están configurados con las credenciales activas del proyecto Supabase `rsvajuxihvmpmrmlcbul`.
