/**
 * ==============================================================
 * 🖥️ PAÑOL LOGISTICS — SERVIDOR DE DESARROLLO FRONTEND (STATIC)
 * ==============================================================
 * Servidor estático nativo Node.js sin dependencias externas.
 * Emula exactamente las reglas de reescritura de Render Static Site
 * y corre en su propio localhost (puerto 5173 por defecto).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const DEFAULT_PORT = parseInt(process.env.PORT || '5173', 10);
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.eot': 'application/vnd.ms-fontobject'
};

// Reglas de rewrite idénticas a las configuradas en Render Static Site (render.yaml)
const REWRITE_RULES = {
  '/': '/index.html',
  '/coordinacion': '/coordinacion.html',
  '/coord': '/coordinacion.html',
  '/panol': '/panol.html',
  '/monitor': '/panol.html',
  '/mobile': '/mobile.html',
  '/m': '/mobile.html',
  '/app-mecanico': '/mobile.html',
  '/login': '/login.html',
  '/wireframe': '/coordinacion.html',
  '/wireframe.html': '/coordinacion.html'
};

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`500 Internal Server Error: ${err.message}`);
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  // Manejo de CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    });
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url);
  let pathname = parsedUrl.pathname;

  // 1. Verificar reglas de rewrite
  if (REWRITE_RULES[pathname]) {
    pathname = REWRITE_RULES[pathname];
  }

  // 2. Normalizar ruta segura
  const safeSuffix = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safeSuffix);

  // Si es un directorio, intentar servir index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  // 3. Si no tiene extensión y existe con .html
  if (!path.extname(filePath) && fs.existsSync(filePath + '.html')) {
    filePath = filePath + '.html';
  }

  // 4. Servir archivo si existe
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    serveFile(res, filePath, contentType);
  } else {
    // 404 No encontrado
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html>
<head><title>404 - No Encontrado</title></head>
<body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; text-align: center;">
  <h1>⚠️ 404 - Archivo no encontrado</h1>
  <p>La ruta <code>${pathname}</code> no existe en el servicio frontend.</p>
  <p><a href="/" style="color: #38bdf8; text-decoration: underline;">Volver al Inicio</a></p>
</body>
</html>`);
  }
});

function startServer(port) {
  server.removeAllListeners('error');
  server.removeAllListeners('listening');

  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ [Frontend] Puerto ${port} en uso. Reintentando en ${port + 1}...`);
      setTimeout(() => startServer(port + 1), 500);
    } else {
      console.error('❌ [Frontend] Error en servidor HTTP:', err.message);
    }
  });

  server.once('listening', () => {
    console.log('================================================================');
    console.log(`🚀 [FRONTEND] Static Site activo en: http://localhost:${port}`);
    console.log(`📄 Rutas disponibles:`);
    console.log(`   - Terminal:     http://localhost:${port}/`);
    console.log(`   - Coordinación: http://localhost:${port}/coordinacion`);
    console.log(`   - Pañol:        http://localhost:${port}/panol`);
    console.log(`🔗 Backend esperado en: http://localhost:5000`);
    console.log('================================================================');
  });

  server.listen(port, '0.0.0.0');
}

startServer(DEFAULT_PORT);
