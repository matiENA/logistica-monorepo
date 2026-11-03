# 🚀 Guía de Despliegue en Render Cloud

Esta guía explica cómo subir la carpeta `diaria` a Render para que las 6 tareas operativas se ejecuten automáticamente las 24 horas del día, los 7 días de la semana, sin depender de que tu computadora esté encendida.

---

## 🛠️ Paso 1: Inicializar Git y Subir a GitHub / GitLab

Abre una terminal en `C:\Users\Matias Rodriguez\Documents\diaria`:

```bash
cd "C:\Users\Matias Rodriguez\Documents\diaria"
git init
git add .
git commit -m "feat: Integración unificada de operativas diarias para Render y n8n"
```

Crea un repositorio (privado recomendado) en tu cuenta de GitHub (por ejemplo `diaria-operativas`) y vincúlalo:

```bash
git remote add origin https://github.com/TU_USUARIO/diaria-operativas.git
git branch -M main
git push -u origin main
```

*(Nota: Asegúrate de que `.gitignore` ignore credenciales locales si no deseas subirlas; de todas formas, en Render usaremos variables de entorno).*

---

## 🌐 Paso 2: Crear el Servicio en Render

1. Entra a [dashboard.render.com](https://dashboard.render.com).
2. Haz clic en **New +** > **Web Service**.
3. Selecciona tu repositorio `diaria-operativas`.
4. Configura los siguientes campos:
   - **Name:** `diaria-operativas`
   - **Region:** `Oregon` (o la que prefieras)
   - **Runtime:** `Docker` *(Render detectará automáticamente el `Dockerfile`)*
   - **Instance Type:** `Free` o `Starter`

---

## 🔑 Paso 3: Configurar las Variables de Entorno en Render

En la pestaña **Environment** de tu servicio en Render, agrega las siguientes variables:

| Variable | Valor | Descripción |
|---|---|---|
| `ENABLE_SCHEDULER` | `true` | Activa el motor de calendarización automática 24/7 de fondo |
| `PORT` | `10000` | Puerto interno de escucha |
| `TZ` | `America/Argentina/Buenos_Aires` | Zona horaria para la ejecución precisa de los Cron |
| `CONF_SPREADSHEET_ID` | `1bK99AJp7O1jluupQeM5lsH8Gu5QfT--HXWTNzMft9tU` | ID de la planilla de UTE Cordillera y CONF. DE VIAJE |
| `CONF_SOURCE_SHEET_NAME` | `UTE Cordillera Octubre 26` | Pestaña de origen en UTE Cordillera |
| `CONF_TARGET_SHEET_NAME` | `CONF. DE VIAJE OCTUBRE 26` | Pestaña de destino en CONF. DE VIAJE |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `{...}` | **Contenido completo del archivo JSON de tu Service Account** |
| `TELEGRAM_BOT_TOKEN` *(opcional)* | `123456:ABC...` | Token del bot provisto por `@BotFather` para recibir alertas |
| `TELEGRAM_CHAT_ID` *(opcional)* | `123456789` | ID de usuario, grupo o canal donde enviar las notificaciones |
| `TELEGRAM_NOTIFY_ALL` *(opcional)* | `false` | `false` = alerta sólo en fallos; `true` = notifica cada tarea |

### 💡 ¿Cómo obtener el valor de `GOOGLE_SERVICE_ACCOUNT_JSON`?
Abre el archivo `credentials.json` o `ute-logistica-key.json` con cualquier editor de texto, copia todo el texto JSON (desde `{` hasta `}`) y pégalo directamente en el campo **Value** en Render.

### 🤖 ¿Cómo configurar las alertas de Telegram?
1. En Telegram, busca `@BotFather`, escribe `/newbot` y sigue las instrucciones para crear tu bot y obtener tu **Token**.
2. Escribe `/start` a tu nuevo bot.
3. Para obtener tu **Chat ID**, busca el bot `@userinfobot` en Telegram y copia el ID numérico que te devuelve.
4. Pega `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` en el panel de **Environment** en Render.
5. Puedes probar el envío visitando `https://diaria-operativas.onrender.com/test-telegram`.

---

## ⏱️ Paso 4: ¡Listo! Verificación de Funcionamiento 24/7

Una vez que Render complete el despliegue:
1. Tu servicio estará activo en una URL pública (ejemplo: `https://diaria-operativas.onrender.com`).
2. Visita `https://diaria-operativas.onrender.com/health` y verás:
   ```json
   {
     "status": "ok",
     "service": "diaria-operativas",
     "scheduler_enabled": true,
     "has_scheduler_lib": true
   }
   ```
3. El planificador de Render ejecutará automáticamente:
   - **Viajes Cordillera**: Cada 10 minutos.
   - **CONF. DE VIAJE**: Cada 10 minutos.
   - **Tracking Hover**: Cada 15 minutos.
   - **Seguimiento Vacío (#9fc5e8)**: Cada 15 minutos.
   - **VACÍO con Bordes**: Cada 20 minutos.
   - **Pintar Disponibilidad**: Todos los días a las 06:00 AM.

---

## ⚡ Disparos Manuales Bajo Demanda desde n8n o Webhook

Si necesitas disparar cualquier tarea remotamente desde n8n (o desde cualquier parte del mundo):
- **Ejecutar Todo:** `POST https://diaria-operativas.onrender.com/sync/all`
- **Solo Seguimiento Vacío:** `POST https://diaria-operativas.onrender.com/sync/seguimiento-vacio`
- **Solo Cordillera:** `POST https://diaria-operativas.onrender.com/sync/cordillera`
- **Solo CONF. DE VIAJE:** `POST https://diaria-operativas.onrender.com/sync/conf-viaje`
- **Solo Disponibilidad:** `POST https://diaria-operativas.onrender.com/sync/dispo`
