# ==============================================================================
# Dockerfile Multi-Runtime (Python 3.11 + Node.js 20) para Render Cloud
# ==============================================================================

# 1. Base oficial de Node.js 20 (Debian Bookworm)
FROM node:20-bookworm-slim AS node-base

# 2. Base principal de Python 3.11 (Debian Bookworm)
FROM python:3.11-slim-bookworm

# Copiar Node.js y NPM directamente desde la imagen oficial
# (Sin depender de repositorios apt externos o mirrors obsoletos)
COPY --from=node-base /usr/local/bin/node /usr/local/bin/node
COPY --from=node-base /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

WORKDIR /app

# Instalar dependencias de Node
COPY package*.json ./
RUN npm install --production

# Instalar dependencias de Python
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el código fuente
COPY . .

# Variables de entorno por defecto
ENV PORT=10000
ENV ENABLE_SCHEDULER=true
ENV PYTHONUNBUFFERED=1

EXPOSE 10000

# Comando de inicio del servidor con Uvicorn
CMD ["sh", "-c", "uvicorn server_render:app --host 0.0.0.0 --port ${PORT}"]
