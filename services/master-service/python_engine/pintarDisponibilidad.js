/**
 * ============================================================================
 * PINTAR DISPONIBILIDAD — Ejecutable CLI / Tarea de Windows / n8n / Render
 * ============================================================================
 * Ejecuta el proceso de disponibilidad leyendo la configuración activa.
 * 
 * Uso:
 *   node pintarDisponibilidad.js
 *   node pintarDisponibilidad.js [ID_O_URL_DE_LA_PLANILLA]
 *   node pintarDisponibilidad.js --force
 *   node pintarDisponibilidad.js --dry-run
 * ============================================================================
 */

'use strict';

const { ejecutarPintado, cargarConfig, guardarConfig } = require('./core');

const args = process.argv.slice(2);
let customId = null;
let force = false;
let dryRun = false;

for (const arg of args) {
  if (arg === '--force') {
    force = true;
  } else if (arg === '--dry-run') {
    dryRun = true;
  } else if (!arg.startsWith('--')) {
    const match = arg.match(/\/d\/([a-zA-Z0-9-_]+)/);
    customId = match ? match[1] : (arg.length > 20 ? arg.trim() : null);
  }
}

if (customId) {
  const cfg = cargarConfig();
  cfg.spreadsheetId = customId;
  guardarConfig(cfg);
}

ejecutarPintado({ force, dryRun })
  .then(res => {
    if (res.sinCambios) {
      console.log(`\n⚡ Finalizado en ${res.duracionSegundos}s [Gatekeeper O(1)]: ${res.title} (Sin cambios en unidades ni vencimientos, 0 escrituras).`);
    } else if (res.dryRun) {
      console.log(`\n🔍 Finalizado en ${res.duracionSegundos}s [Simulación]: ${res.title} (${res.operacionesSimuladas} operaciones estimadas).`);
    } else {
      console.log(`\n✅ Finalizado en ${res.duracionSegundos}s [${res.modo}]: ${res.title} (${res.operacionesAplicadas} operaciones aplicadas, ${res.alertas.total} alertas activas).`);
    }
    process.exit(0);
  })
  .catch(err => {
    console.error(`\n❌ Error fatal: ${err.message}`);
    process.exit(1);
  });
