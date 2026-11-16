/**
 * ============================================================================
 * PINTAR DISPONIBILIDAD — Ejecutable CLI / Tarea de Windows
 * ============================================================================
 * Ejecuta el proceso de disponibilidad leyendo la configuración activa.
 * 
 * Uso:
 *   node pintarDisponibilidad.js
 *   node pintarDisponibilidad.js [ID_O_URL_DE_LA_PLANILLA]
 * ============================================================================
 */

'use strict';

const { ejecutarPintado, cargarConfig, guardarConfig } = require('./core');

// Permitir pasar ID por CLI
const args = process.argv.slice(2);
let customId = null;

for (const arg of args) {
  if (!arg.startsWith('--')) {
    const match = arg.match(/\/d\/([a-zA-Z0-9-_]+)/);
    customId = match ? match[1] : (arg.length > 20 ? arg.trim() : null);
    if (customId) break;
  }
}

if (customId) {
  const cfg = cargarConfig();
  cfg.spreadsheetId = customId;
  guardarConfig(cfg);
}

ejecutarPintado()
  .then(res => {
    console.log(`\n✅ Finalizado en ${res.duracionSegundos}s: ${res.title} (${res.alertas.total} alertas aplicadas).`);
    process.exit(0);
  })
  .catch(err => {
    console.error(`\n❌ Error fatal: ${err.message}`);
    process.exit(1);
  });
