# ==============================================================================
# Dockerfile Multi-Runtime (Python 3.11 + Node.js 20) para Render Cloud
# Servicio Maestro: srv-db4302u0tbcc73ctq4ng (diaria-operativas)
# ==============================================================================

# 1. Base oficial de Node.js 20 (Debian Bookworm)
FROM node:20-bookworm-slim AS node-base

# 2. Base principal de Python 3.11 (Debian Bookworm)
FROM python:3.11-slim-bookworm

# Copiar Node.js y NPM directamente desde la imagen oficial
COPY --from=node-base /usr/local/bin/node /usr/local/bin/node
COPY --from=node-base /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

WORKDIR /app

# Instalar dependencias de Python
COPY python_engine/requirements.txt ./python_engine/
RUN pip install --no-cache-dir -r python_engine/requirements.txt

# Instalar dependencias de Node.js
COPY node_backend/package*.json ./node_backend/
RUN cd node_backend && npm install --production

# Copiar el código fuente completo del servicio maestro
COPY . .

# Permisos de ejecución para el entrypoint
RUN chmod +x start.sh

# Variables de entorno por defecto
ENV PORT=10000
ENV ENABLE_SCHEDULER=true
ENV PYTHONUNBUFFERED=1
ENV TZ=America/Argentina/Buenos_Aires

EXPOSE 10000

# Entrypoint coordinado (arranca Python en 8000 y Node.js en 10000)
CMD ["./start.sh"]
