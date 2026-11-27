/**
 * ============================================================================
 * PINTAR DISPONIBILIDAD — Ejecutable CLI / Automations / Render / n8n
 * ============================================================================
 * Ejecuta el proceso de disponibilidad sobre todas las planillas activas
 * configuradas en config.json (`spreadsheetIdsActivos` o `spreadsheetId`) o
 * mediante la variable de entorno `DISPO_SPREADSHEET_IDS`.
 *
 * Uso:
 *   node pintarDisponibilidad.js                         (pinta todas las activas)
 *   node pintarDisponibilidad.js [ID_O_URL ...]          (pinta solo los IDs pasados sin mutar config.json)
 *   node pintarDisponibilidad.js [ID_O_URL] --save       (pinta y guarda como spreadsheetId principal)
 * ============================================================================
 */

'use strict';

const {
  ejecutarPintado,
  cargarConfig,
  guardarConfig,
  resolverPlanillasActivas
} = require('./core');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const args = process.argv.slice(2);
const saveFlag = args.includes('--save');
const customIds = [];

for (const arg of args) {
  if (!arg.startsWith('--')) {
    const match = arg.match(/\/d\/([a-zA-Z0-9-_]+)/);
    const id = match ? match[1] : (arg.length > 20 ? arg.trim() : null);
    if (id && !customIds.includes(id)) customIds.push(id);
  }
}

if (saveFlag && customIds.length > 0) {
  const cfg = cargarConfig();
  cfg.spreadsheetId = customIds[0];
  guardarConfig(cfg);
}

const targetIds = customIds.length > 0 ? customIds : resolverPlanillasActivas();

if (targetIds.length === 0) {
  console.error('❌ No se encontraron planillas configuradas para pintar.');
  process.exit(1);
}

(async () => {
  const tGlobal = Date.now();
  const resultados = [];
  let errores = 0;

  console.log(`\n🚀 [PINTAR DISPONIBILIDAD] Planillas a procesar (${targetIds.length}): ${targetIds.join(', ')}`);

  for (let idx = 0; idx < targetIds.length; idx++) {
    const spreadsheetId = targetIds[idx];
    console.log(`\n${'─'.repeat(72)}`);
    console.log(`📋 [${idx + 1}/${targetIds.length}] Procesando planilla: ${spreadsheetId}`);
    console.log(`${'─'.repeat(72)}`);

    try {
      const res = await ejecutarPintado({ spreadsheetId });
      resultados.push({ spreadsheetId, ok: true, ...res });
      console.log(`✅ [${idx + 1}/${targetIds.length}] Finalizado en ${res.duracionSegundos}s: ${res.title} | ${res.unidadesProcesadas} unidades | 🔴 ${res.alertas.rojos} rojos + 🔵 ${res.alertas.azules} azules (${res.alertas.total} bloques).`);
    } catch (err) {
      errores++;
      resultados.push({ spreadsheetId, ok: false, error: err.message });
      console.error(`❌ [${idx + 1}/${targetIds.length}] Error en ${spreadsheetId}: ${err.message}`);
    }

    if (idx < targetIds.length - 1) {
      await sleep(1500);
    }
  }

  const durTotal = ((Date.now() - tGlobal) / 1000).toFixed(2);
  console.log(`\n${'='.repeat(72)}`);
  console.log(`📊 RESUMEN FINAL (${resultados.length - errores}/${resultados.length} OK) — Tiempo total: ${durTotal}s`);
  for (const r of resultados) {
    if (r.ok) {
      console.log(`  • ${r.title} (${r.movTitle}): ${r.unidadesProcesadas} unidades | 🔴 ${r.alertas.rojos} | 🔵 ${r.alertas.azules} | ${r.duracionSegundos}s`);
    } else {
      console.log(`  • ${r.spreadsheetId}: FALLÓ (${r.error})`);
    }
  }
  console.log(`${'='.repeat(72)}\n`);

  process.exit(errores > 0 ? 1 : 0);
})();
