/**
 * fleetOtBridgeService.js
 * Servicio de Puente Canónico de Ultra-Alto Rendimiento entre Google Sheets ('DB_OT_LIST') y Supabase PostgreSQL.
 * 
 * Reglas de Negocio:
 * 1. Google Sheets se limita EXCLUSIVAMENTE a la lectura de 'DB_OT_LIST' (números de OT por dominio).
 * 2. Cruza en memoria las patentes con 'public.tractores' y 'public.semis' en Supabase.
 * 3. Inserciones agrupadas por lotes (Bulk Insert) para sincronizar en < 2 segundos sin saturar el pool de conexiones.
 * 4. Mantiene una caché en RAM de ultra-baja latencia (< 5ms) para el autocompletado y consultas del frontend.
 */

const { extractPlates } = require('./plateNormalizer');
const db = require('./utils/db');
const { parseTasksFromString } = require('./taskSyncService');

let dbOtListCache = [];
let dbOtMapByPlate = new Map(); // normalizedPlate -> { tractorPlate, tractorOt, semiPlate, semiOt, producto, marcaTractor, marcaSemi }
let lastFetchTime = 0;
const CACHE_TTL_MS = 30000; // 30s TTL
let isSyncInProgress = false;

function normalizePlate(raw) {
  if (!raw) return '';
  const clean = String(raw).toUpperCase().replace(/[\s\-_.]/g, '');
  const extracted = extractPlates(clean);
  return extracted.length > 0 ? extracted[0] : clean;
}

function normalizeOt(raw) {
  if (!raw) return '';
  const str = String(raw).trim().replace(/\.0+$/, '');
  const noZeros = str.replace(/^0+/, '');
  return noZeros || str;
}

/**
 * Función auxiliar para inserciones por lotes (Bulk Insert)
 */
async function bulkInsert(table, columns, rows, onConflictClause = '') {
  if (!rows || rows.length === 0) return [];
  const CHUNK_SIZE = 60;
  const allResults = [];

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const valuePlaceholders = [];
    const values = [];

    chunk.forEach((row) => {
      const rowPlaceholders = [];
      columns.forEach((col) => {
        values.push(row[col]);
        rowPlaceholders.push(`$${values.length}`);
      });
      valuePlaceholders.push(`(${rowPlaceholders.join(', ')})`);
    });

    const query = `
      INSERT INTO ${table} (${columns.join(', ')})
      VALUES ${valuePlaceholders.join(', ')}
      ${onConflictClause}
      RETURNING *;
    `;

    const res = await db.query(query, values);
    if (res.rows && res.rows.length > 0) {
      allResults.push(...res.rows);
    }
  }

  return allResults;
}

/**
 * Obtiene las filas de DB_OT_LIST con caché en memoria
 */
async function fetchDbOtListRows({ sheetsClient, spreadsheetId, force = false }) {
  const now = Date.now();
  if (!force && dbOtListCache.length > 0 && (now - lastFetchTime < CACHE_TTL_MS)) {
    return dbOtListCache;
  }

  if (!sheetsClient || !spreadsheetId) {
    return dbOtListCache;
  }

  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: "'DB_OT_LIST'!A2:G500"
    });

    const rows = res.data.values || [];
    dbOtListCache = rows;
    lastFetchTime = now;

    // Actualizar mapa hash en memoria
    const newMap = new Map();
    rows.forEach(r => {
      const t = String(r[0] || '').trim();
      const tot = normalizeOt(r[1]);
      const s = String(r[2] || '').trim();
      const sot = normalizeOt(r[3]);
      const prod = String(r[4] || 'GENERAL').trim();
      const marcaT = String(r[5] || '').trim();
      const marcaS = String(r[6] || '').trim();

      const normT = normalizePlate(t);
      const normS = normalizePlate(s);

      const entry = {
        tractorPlate: t,
        tractorOt: tot,
        semiPlate: s,
        semiOt: sot,
        producto: prod,
        marcaTractor: marcaT,
        marcaSemi: marcaS
      };

      if (normT) newMap.set(normT, entry);
      if (normS) newMap.set(normS, entry);
    });

    dbOtMapByPlate = newMap;
    return rows;
  } catch (err) {
    console.warn('⚠️ [fleetOtBridge] Error al leer DB_OT_LIST de Sheets:', err.message);
    return dbOtListCache;
  }
}

/**
 * Sincroniza canónicamente DB_OT_LIST con Supabase PostgreSQL mediante Bulk Inserts
 */
async function syncDbOtListToSupabase({ sheetsClient, spreadsheetId }) {
  if (isSyncInProgress) {
    console.log('ℹ️ [fleetOtBridge] Sincronización en curso, omitiendo ejecución concurrente.');
    return { success: true, running: true };
  }

  if (!db || !db.isConfigured || !db.isConfigured()) {
    return { success: false, reason: 'Database not configured' };
  }

  isSyncInProgress = true;
  const startTime = Date.now();

  try {
    console.log('🌉 [fleetOtBridge] Iniciando sincronización canónica DB_OT_LIST ↔ Supabase (Bulk Mode)...');

    // 1. Cargar filas de DB_OT_LIST (Google Sheets)
    const rows = await fetchDbOtListRows({ sheetsClient, spreadsheetId, force: true });
    if (rows.length === 0) {
      console.warn('⚠️ [fleetOtBridge] DB_OT_LIST vacía o no disponible.');
      isSyncInProgress = false;
      return { success: false, reason: 'DB_OT_LIST is empty' };
    }

    // 2. Cargar estado actual de Supabase en paralelo
    const [trRes, smRes, existingWoRes, existingUwoRes, existingTasksRes] = await Promise.all([
      db.query("SELECT id, UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) as clean_plate FROM public.tractores;"),
      db.query("SELECT id, UPPER(REPLACE(REPLACE(patente, '-', ''), ' ', '')) as clean_plate FROM public.semis;"),
      db.query("SELECT id, ot_number, status FROM panol.work_orders;"),
      db.query("SELECT tractor_id, semi_id, work_order_id FROM panol.unit_work_orders;"),
      db.query("SELECT work_order_id, task_index FROM panol.work_order_tasks;")
    ]);

    const tractorMap = new Map();
    trRes.rows.forEach(r => tractorMap.set(r.clean_plate, r.id));

    const semiMap = new Map();
    smRes.rows.forEach(r => semiMap.set(r.clean_plate, r.id));

    const woMap = new Map(); // ot_number -> id
    existingWoRes.rows.forEach(r => woMap.set(r.ot_number, r.id));

    const uwoSet = new Set(); // `${tractor_id || semi_id}_${work_order_id}`
    const woAssignedSet = new Set(); // work_order_id ya vinculada a alguna unidad
    existingUwoRes.rows.forEach(r => {
      uwoSet.add(`${r.tractor_id || r.semi_id}_${r.work_order_id}`);
      if (r.work_order_id) woAssignedSet.add(r.work_order_id);
    });

    const tasksSet = new Set(); // `${work_order_id}_${task_index}`
    existingTasksRes.rows.forEach(r => tasksSet.add(`${r.work_order_id}_${r.task_index}`));

    // 3. Obtener mapa de tareas crudas desde pestaña 'ots'
    const rawTasksByOt = new Map();
    if (sheetsClient && spreadsheetId) {
      try {
        const otsRes = await sheetsClient.spreadsheets.values.get({
          spreadsheetId,
          range: "'ots'!A2:E500"
        });
        (otsRes.data.values || []).forEach(r => {
          const ot = normalizeOt(r[2]);
          const rawTasks = String(r[4] || '').trim();
          if (ot && rawTasks) {
            rawTasksByOt.set(ot, rawTasks);
          }
        });
      } catch (errOts) {
        console.warn('⚠️ [fleetOtBridge] Advertencia al leer tareas de pestaña "ots":', errOts.message);
      }
    }

    // 4. Preparar lotes de inserción
    const ordersToInsert = [];
    const neededOtsSet = new Set();

    rows.forEach(r => {
      const tot = normalizeOt(r[1]);
      const sot = normalizeOt(r[3]);
      if (tot && !woMap.has(tot) && !neededOtsSet.has(tot)) {
        neededOtsSet.add(tot);
        ordersToInsert.push({ ot_number: tot });
      }
      if (sot && !woMap.has(sot) && !neededOtsSet.has(sot)) {
        neededOtsSet.add(sot);
        ordersToInsert.push({ ot_number: sot });
      }
    });

    // 4.1 Bulk insert de órdenes faltantes
    let createdWoCount = 0;
    if (ordersToInsert.length > 0) {
      const insRes = await bulkInsert(
        'panol.work_orders',
        ['ot_number'],
        ordersToInsert,
        'ON CONFLICT (ot_number) DO NOTHING'
      );
      createdWoCount = insRes.length;
      insRes.forEach(r => woMap.set(r.ot_number, r.id));

      // Si algunos estaban en conflicto, refrescar IDs
      if (insRes.length < ordersToInsert.length) {
        const refQ = await db.query('SELECT id, ot_number FROM panol.work_orders WHERE ot_number = ANY($1::text[]);', [Array.from(neededOtsSet)]);
        refQ.rows.forEach(r => woMap.set(r.ot_number, r.id));
      }
    }

    // 4.2 Preparar enlaces a unit_work_orders y tareas
    const uwoToInsert = [];
    const tasksToInsert = [];

    rows.forEach(r => {
      const rawT = String(r[0] || '').trim();
      const tot = normalizeOt(r[1]);
      const rawS = String(r[2] || '').trim();
      const sot = normalizeOt(r[3]);

      const normT = normalizePlate(rawT);
      const normS = normalizePlate(rawS);

      const tractorId = tractorMap.get(normT);
      const semiId = semiMap.get(normS);

      // Tractor
      if (tot && tractorId && woMap.has(tot)) {
        const woId = woMap.get(tot);
        const linkKey = `${tractorId}_${woId}`;
        if (!uwoSet.has(linkKey) && !woAssignedSet.has(woId)) {
          uwoSet.add(linkKey);
          woAssignedSet.add(woId);
          uwoToInsert.push({
            tractor_id: tractorId,
            semi_id: null,
            work_order_id: woId
          });
        }

        const rawTasks = rawTasksByOt.get(tot);
        if (rawTasks) {
          const list = parseTasksFromString(rawTasks);
          list.forEach(t => {
            const taskKey = `${woId}_${t.index}`;
            if (!tasksSet.has(taskKey)) {
              tasksSet.add(taskKey);
              tasksToInsert.push({
                work_order_id: woId,
                task_index: t.index,
                sector_task: `[${t.rubro}] ${t.descripcion}`
              });
            }
          });
        }
      }

      // Semi
      if (sot && semiId && woMap.has(sot)) {
        // Regla de blindaje: Si la OT del semi es idéntica a la del tractor en la misma fila, no vincular el semi a la OT del tractor
        if (!tot || sot !== tot) {
          const woId = woMap.get(sot);
          const linkKey = `${semiId}_${woId}`;
          if (!uwoSet.has(linkKey) && !woAssignedSet.has(woId)) {
            uwoSet.add(linkKey);
            woAssignedSet.add(woId);
            uwoToInsert.push({
              tractor_id: null,
              semi_id: semiId,
              work_order_id: woId
            });
          }

          const rawTasks = rawTasksByOt.get(sot);
          if (rawTasks) {
            const list = parseTasksFromString(rawTasks);
            list.forEach(t => {
              const taskKey = `${woId}_${t.index}`;
              if (!tasksSet.has(taskKey)) {
                tasksSet.add(taskKey);
                tasksToInsert.push({
                  work_order_id: woId,
                  task_index: t.index,
                  sector_task: `[${t.rubro}] ${t.descripcion}`
                });
              }
            });
          }
        }
      }
    });

    // 4.3 Bulk insert de unit_work_orders
    let linkedUnitsCount = 0;
    if (uwoToInsert.length > 0) {
      const insUwo = await bulkInsert(
        'panol.unit_work_orders',
        ['tractor_id', 'semi_id', 'work_order_id'],
        uwoToInsert,
        'ON CONFLICT DO NOTHING'
      );
      linkedUnitsCount = insUwo.length;
    }

    // 4.4 Bulk insert de tareas atómicas
    let createdTasksCount = 0;
    if (tasksToInsert.length > 0) {
      const insTasks = await bulkInsert(
        'panol.work_order_tasks',
        ['work_order_id', 'task_index', 'sector_task'],
        tasksToInsert,
        'ON CONFLICT (work_order_id, task_index) DO NOTHING'
      );
      createdTasksCount = insTasks.length;
    }

    const durationMs = Date.now() - startTime;
    console.log(`✅ [fleetOtBridge] Sincronización completada en ${durationMs}ms:`);
    console.log(`   - OTs creadas en work_orders: ${createdWoCount}`);
    console.log(`   - Nuevos enlaces en unit_work_orders: ${linkedUnitsCount}`);
    console.log(`   - Tareas ingestadas en work_order_tasks: ${createdTasksCount}`);

    return {
      success: true,
      durationMs,
      createdWoCount,
      linkedUnitsCount,
      createdTasksCount
    };
  } catch (err) {
    console.error('❌ [fleetOtBridge] Error en sincronización:', err.message);
    return { success: false, error: err.message };
  } finally {
    isSyncInProgress = false;
  }
}

/**
 * Consulta en memoria instantánea (<1ms) del mapeo de una patente
 */
function getOtMappingForPlate(plate) {
  const norm = normalizePlate(plate);
  return dbOtMapByPlate.get(norm) || null;
}

/**
 * Retorna la caché de filas completas
 */
function getDbOtListCache() {
  return dbOtListCache;
}

module.exports = {
  fetchDbOtListRows,
  syncDbOtListToSupabase,
  getOtMappingForPlate,
  getDbOtListCache,
  normalizePlate,
  normalizeOt
};
