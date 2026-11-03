/**
 * ============================================================================
 * SERVIDOR LOCAL ZEN — Interfaz Web de Pintar Disponibilidad
 * ============================================================================
 * Servidor HTTP ligero en Node.js puro (sin dependencias externas).
 * Puerto por defecto: 4321
 * ============================================================================
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const {
  cargarConfig,
  guardarConfig,
  inspeccionarPlanilla,
  ejecutarPintado,
  KEY_FILE
} = require('./core');

const PORT = process.env.PORT || 4321;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ─── HELPER DE RESPUESTAS JSON ────────────────────────────────────────────────

function sendJSON(res, statusCode, data) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(json);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('JSON malformado en el cuerpo de la petición.'));
      }
    });
    req.on('error', reject);
  });
}

// ─── SERVIDOR HTTP ────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname  = parsedUrl.pathname;
  const method    = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  try {
    // ── API: Estado general y configuración ──────────────────────────────────
    if (pathname === '/api/config' && method === 'GET') {
      const config = cargarConfig();
      const tieneClave = fs.existsSync(KEY_FILE);
      let claveEmail = null;
      if (tieneClave) {
        try {
          const keyData = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
          claveEmail = keyData.client_email;
        } catch (e) {}
      }
      return sendJSON(res, 200, {
        ...config,
        tieneClave,
        claveEmail
      });
    }

    // ── API: Guardar configuración ──────────────────────────────────────────
    if (pathname === '/api/config' && method === 'POST') {
      const body = await parseBody(req);
      const configActual = cargarConfig();
      const configNueva = {
        ...configActual,
        ...body
      };
      guardarConfig(configNueva);
      return sendJSON(res, 200, { exito: true, config: configNueva });
    }

    // ── API: Inspeccionar / Validar una planilla en tiempo real ──────────────
    if (pathname === '/api/inspect' && method === 'POST') {
      const body = await parseBody(req);
      let targetId = body.spreadsheetId || '';
      const match = targetId.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (match) targetId = match[1];
      targetId = targetId.trim();

      if (!targetId) {
        return sendJSON(res, 400, { error: 'Debe ingresar un ID o URL válida.' });
      }

      const info = await inspeccionarPlanilla(targetId);
      return sendJSON(res, 200, info);
    }

    // ── API: Ejecutar proceso de pintado con streaming de logs en vivo ───────
    if (pathname === '/api/execute' && method === 'POST') {
      const body = await parseBody(req);
      let targetId = body.spreadsheetId || cargarConfig().spreadsheetId;
      const match = targetId.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (match) targetId = match[1];
      targetId = targetId.trim();

      const customCols = Array.isArray(body.colsDispo) && body.colsDispo.length > 0
        ? body.colsDispo
        : null;

      // Iniciar respuesta SSE / Chunked
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      const sendEvent = (tipo, data) => {
        res.write(`event: ${tipo}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const resultado = await ejecutarPintado(
          { spreadsheetId: targetId, colsDispo: customCols },
          logEvent => sendEvent('log', logEvent)
        );
        sendEvent('done', resultado);
      } catch (err) {
        sendEvent('error', { error: err.message });
      } finally {
        res.end();
      }
      return;
    }

    // ── SERVIR ARCHIVOS ESTÁTICOS DE LA INTERFAZ ZEN (public/) ───────────────
    if (method === 'GET') {
      let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          '.html': 'text/html; charset=utf-8',
          '.css':  'text/css; charset=utf-8',
          '.js':   'application/javascript; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.svg':  'image/svg+xml'
        };
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
        return fs.createReadStream(filePath).pipe(res);
      }
    }

    // 404
    sendJSON(res, 404, { error: 'Ruta no encontrada' });
  } catch (err) {
    console.error('Error en el servidor:', err);
    sendJSON(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`  🎨 SERVIDOR ZEN ACTIVO: http://localhost:${PORT}`);
  console.log(`  Interfaz accesible y lista para gestionar la disponibilidad.`);
  console.log(`══════════════════════════════════════════════════════════════\n`);
});
