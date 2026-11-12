#!/usr/bin/env node
/**
 * ==============================================================================
 * 🚀 SYNC OTS PIPELINE: AUTO-DISCOVERY, INSERCIÓN IDEMPOTENTE & DUAL SYNC
 * ==============================================================================
 * Lee archivos semanales de OTs desde:
 *  1. Carpeta local 'C:\Users\Matias Rodriguez\Documents\ots\semanas' (si existe)
 *  2. O Google Drive subcarpeta 'ots/' (ID: 1-tcXyG0xZx9NlSeJ52NjrysornZ0HS19)
 * 
 * Sincroniza hacia dos destinos de forma atómica e idempotente:
 *  A. PostgreSQL / Supabase DB (Tablas #db):
 *     - panol.work_orders (ot_number, entry_date, status = 'ACTIVA')
 *     - panol.unit_work_orders (tractor_id, semi_id por patente)
 *     - panol.work_order_tasks (task_index, sector_task)
 *     -> Regla Zero Overwrite: ON CONFLICT DO NOTHING en tareas vivas.
 * 
 *  B. Google Sheets (Database PRUEBAS LOCAL: 17yFPBMz8ExHf53e6ssh9LyDTjKCCJApoiCNXP-4KINQ):
 *     - Pestaña 'ots' (Append limpio de 4 atributos canónicos):
 *       Col B: FECHA INGRESO (fecha de planificación)
 *       Col C: ORDEN Nº (ot número)
 *       Col D: DOMINIO (patente)
 *       Col E: SECTOR / TAREAS (tareas consolidadas [SECTOR] DESCRIPCION | ...)
 *     - Excluidos explícitamente: KEY (Col A), CIERRE (Col F), PORCENTAJE (Col J).
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { google } = require('googleapis');

// Cargar variables de entorno locales
const envPaths = [
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '..', '..', 'apps', 'panol', 'backend', '.env'),
  path.join(__dirname, '..', '..', '..', '.env')
];
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    require('dotenv').config({ path: p });
    break;
  }
}

// Configuración de rutas locales y de Google Drive / Sheets
const LOCAL_SEMANAS_DIR = 'C:/Users/Matias Rodriguez/Documents/ots/semanas';
const LOCAL_ROOT_DIR = 'C:/Users/Matias Rodriguez/Documents/ots';
const LOCAL_LEDGER_PATH = path.join(LOCAL_ROOT_DIR, 'ledger_ots.json');

const DRIVE_ROOT_FOLDER_ID = '15RcLixNkeEQKct0UcFH4C0v3KPwfkrA6';
const DRIVE_SUBFOLDER_OTS_ID = '1-tcXyG0xZx9NlSeJ52NjrysornZ0HS19';
const DRIVE_ROOT_LEDGER_ID = '1aifmYNNMYDRITMSaojwE_zrXHYj2AtCZ';

const DEFAULT_SPREADSHEET_ID = '17yFPBMz8ExHf53e6ssh9LyDTjKCCJApoiCNXP-4KINQ';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres.rsvajuxihvmpmrmlcbul:kMmGplQEcWDYUBAB@aws-0-us-east-1.pooler.supabase.com:6543/postgres';

/**
 * Inicializar clientes de Google (Drive y Sheets)
 */
function getGoogleClientsSafe() {
  let auth = null;
  const scopes = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets'
  ];

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      auth = new google.auth.JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes
      });
    } catch (e) {}
  }

  if (!auth && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes
    });
  }

  if (!auth) {
    const localKeyPaths = [
      'C:/Users/Matias Rodriguez/Documents/server_local/ot_extractor/app/service_account.json',
      path.join(__dirname, '..', 'service_account.json'),
      path.join(__dirname, 'service_account.json')
    ];
    for (const kp of localKeyPaths) {
      if (fs.existsSync(kp)) {
        try {
          const creds = JSON.parse(fs.readFileSync(kp, 'utf8'));
          auth = new google.auth.JWT({
            email: creds.client_email,
            key: creds.private_key,
            scopes
          });
          break;
        } catch (e) {}
      }
    }
  }

  return {
    auth,
    drive: auth ? google.drive({ version: 'v3', auth }) : null,
    sheets: auth ? google.sheets({ version: 'v4', auth }) : null
  };
}

/**
 * Parsear fechas en formato DD/MM/YYYY a Date UTC
 */
function parseDateDDMMYYYY(str) {
  if (!str) return null;
  const parts = String(str).trim().split('/');
  if (parts.length === 3) {
    const [d, m, y] = parts;
    const date = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00Z`);
    return isNaN(date.getTime()) ? null : date;
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Normalizar patente para búsqueda exacta
 */
function normalizePlate(plate) {
  if (!plate) return '';
  return String(plate).toUpperCase().replace(/[\s\-_.]/g, '');
}

/**
 * Cargar o inicializar Ledger Raíz
 */
async function loadLedger(drive) {
  let ledger = {
    version: "2.0",
    descripcion: "Ledger de Control de Insercion de OTs y Tareas en DB Panol",
    ultima_actualizacion: new Date().toISOString(),
    semanas_completadas: [],
    total_ots_insertadas: 0,
    ots_map: {}
  };

  // 1. Intentar desde Google Drive si hay conexión
  if (drive) {
    try {
      const res = await drive.files.get({ fileId: DRIVE_ROOT_LEDGER_ID, alt: 'media' });
      const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      if (data && typeof data === 'object') {
        return {
          ...ledger,
          ...data,
          semanas_completadas: data.semanas_completadas || [],
          ots_map: data.ots_map || {}
        };
      }
    } catch (e) {}
  }

  // 2. Intentar desde disco local
  if (fs.existsSync(LOCAL_LEDGER_PATH)) {
    try {
      const localData = JSON.parse(fs.readFileSync(LOCAL_LEDGER_PATH, 'utf8'));
      return {
        ...ledger,
        ...localData,
        semanas_completadas: localData.semanas_completadas || [],
        ots_map: localData.ots_map || {}
      };
    } catch (e) {}
  }

  return ledger;
}

/**
 * Guardar Ledger Raíz en Drive y en Disco Local
 */
async function saveLedger(ledger, drive) {
  ledger.total_ots_insertadas = Object.keys(ledger.ots_map).length;
  ledger.ultima_actualizacion = new Date().toISOString();

  // Guardar en disco local
  try {
    fs.writeFileSync(LOCAL_LEDGER_PATH, JSON.stringify(ledger, null, 2), 'utf8');
    console.log(`✔ Ledger local guardado en: ${LOCAL_LEDGER_PATH}`);
  } catch (e) {}

  // Guardar en Google Drive
  if (drive) {
    try {
      await drive.files.update({
        fileId: DRIVE_ROOT_LEDGER_ID,
        media: {
          mimeType: 'application/json',
          body: JSON.stringify(ledger, null, 2)
        }
      });
      console.log('✔ Ledger actualizado exitosamente en Google Drive (ots.json).');
    } catch (e) {
      console.warn('⚠️ No se pudo actualizar el ledger en Drive:', e.message);
    }
  }
}

/**
 * Sincroniza órdenes hacia Google Sheets (Spreadsheet: 17yFPBMz8ExHf53e6ssh9LyDTjKCCJApoiCNXP-4KINQ, Tab: 'ots')
 * Inyecta exclusivamente los 4 atributos canónicos:
 * - Col B: FECHA INGRESO (fecha de planificación)
 * - Col C: ORDEN Nº (ot número)
 * - Col D: DOMINIO (patente)
 * - Col E: SECTOR / TAREAS (tareas consolidadas en formato canónico [SECTOR] DESCRIPCION | ...)
 * Dejando explícitamente vacías:
 * - Col A: KEY
 * - Col F: CIERRE / RESPALDO TAREAS
 * - Col J: PORCENTAJE
 * - Cols G, H, I: PAYLOAD, CONFIRMACIÓN, COORDINACION_JSON
 */
async function syncOtsToGoogleSheets({ sheetsClient, spreadsheetId, otsList, dryRun }) {
  if (!sheetsClient) {
    console.warn('⚠️ [GOOGLE SHEETS] Cliente de Google Sheets no disponible. Omitiendo sincronización a Sheets.');
    return { inserted: 0, omitted: 0 };
  }
  if (!otsList || otsList.length === 0) {
    return { inserted: 0, omitted: 0 };
  }

  const targetSpreadsheetId = spreadsheetId || DEFAULT_SPREADSHEET_ID;

  try {
    console.log(`📊 [GOOGLE SHEETS] Verificando órdenes existentes en planilla ${targetSpreadsheetId} (tab 'ots')...`);
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: targetSpreadsheetId,
      range: 'ots!C:C'
    });

    const existingRows = res.data.values || [];
    const existingSet = new Set();
    for (const r of existingRows) {
      const val = String(r[0] || '').trim();
      if (val) {
        existingSet.add(val);
        const num = parseInt(val, 10);
        if (!isNaN(num)) existingSet.add(String(num));
      }
    }

    const rowsToAppend = [];
    let omitted = 0;

    for (const ot of otsList) {
      const otNum = String(ot.orden_no || '').trim();
      if (!otNum) continue;

      const numParsed = parseInt(otNum, 10);
      const isAlreadyInSheet = existingSet.has(otNum) || (!isNaN(numParsed) && existingSet.has(String(numParsed)));

      if (isAlreadyInSheet) {
        omitted++;
        continue;
      }

      // Consolidar tareas en formato [SECTOR] DESCRIPCION | ...
      let tareasConsolidada = ot.tareas_consolidada || '';
      if (!tareasConsolidada && Array.isArray(ot.tareas)) {
        tareasConsolidada = ot.tareas.map(t => {
          const sec = String(t.sector || 'GENERAL').trim();
          const desc = String(t.description || '').trim();
          return `[${sec}] ${desc}`;
        }).join(' | ');
      }

      // Fila de 10 columnas limpia
      const row = [
        '',                      // Col A: KEY (sin key, ya no se necesita)
        ot.fecha_ingreso || '',  // Col B: FECHA INGRESO (fecha de planificación)
        otNum,                   // Col C: ORDEN Nº (ot número)
        ot.dominio || '',        // Col D: DOMINIO (patente)
        tareasConsolidada,       // Col E: SECTOR / TAREAS (tareas)
        '',                      // Col F: CIERRE / RESPALDO TAREAS (sin tareas de respaldo)
        '',                      // Col G: PAYLOAD
        '',                      // Col H: CONFIRMACIÓN DE TAREAS
        '',                      // Col I: COORDINACION_JSON
        ''                       // Col J: PORCENTAJE (sin porcentajes, ya en sb)
      ];

      rowsToAppend.push(row);
      existingSet.add(otNum);
      if (!isNaN(numParsed)) existingSet.add(String(numParsed));
    }

    if (rowsToAppend.length === 0) {
      console.log(`✔ [GOOGLE SHEETS] Todas las órdenes ya están presentes en tab 'ots' (${omitted} ya existentes).`);
      return { inserted: 0, omitted };
    }

    if (!dryRun) {
      console.log(`🚀 [GOOGLE SHEETS] Insertando ${rowsToAppend.length} órdenes limpias en tab 'ots'...`);
      await sheetsClient.spreadsheets.values.append({
        spreadsheetId: targetSpreadsheetId,
        range: 'ots!A:J',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: rowsToAppend
        }
      });
      console.log(`✅ [GOOGLE SHEETS] ${rowsToAppend.length} órdenes insertadas con éxito en tab 'ots'.`);
    } else {
      console.log(`🔍 [GOOGLE SHEETS - DRY RUN] Se agregarían ${rowsToAppend.length} órdenes limpias a tab 'ots'.`);
    }

    return { inserted: rowsToAppend.length, omitted };
  } catch (err) {
    console.error(`❌ [GOOGLE SHEETS] Error en sincronización a Sheets:`, err.message);
    return { inserted: 0, omitted: 0, error: err.message };
  }
}

/**
 * Función principal del pipeline
 */
async function runPipeline(options = {}) {
  const startTime = Date.now();
  const dryRun = Boolean(options.dryRun || process.argv.includes('--dry-run'));
  const targetWeek = options.week || (process.argv.find(a => a.startsWith('--week=')) || '').replace('--week=', '').trim();
  const limit = options.limit ? parseInt(options.limit) : (parseInt((process.argv.find(a => a.startsWith('--limit=')) || '').replace('--limit=', '')) || 0);
  const syncSheets = !process.argv.includes('--no-sheets') && options.syncSheets !== false;
  const targetSpreadsheetId = options.spreadsheetId || (process.argv.find(a => a.startsWith('--spreadsheet-id=')) || '').replace('--spreadsheet-id=', '').trim() || DEFAULT_SPREADSHEET_ID;

  console.log('='.repeat(75));
  console.log(`🚀 INICIANDO SYNC OTS PIPELINE ${dryRun ? '🔍 [MODO DRY-RUN]' : '⚡ [MODO PRODUCCIÓN]'}`);
  console.log(`📋 Sincronización Google Sheets: ${syncSheets ? 'ACTIVADA (' + targetSpreadsheetId + ')' : 'DESACTIVADA'}`);
  console.log('='.repeat(75));

  const googleClients = getGoogleClientsSafe();
  const ledger = await loadLedger(googleClients.drive);
  console.log(`✔ Ledger cargado: ${ledger.semanas_completadas.length} semanas completadas, ${Object.keys(ledger.ots_map).length} OTs en ots_map.`);

  // 1. Descubrimiento de archivos semanales: Preferir local si existe
  let weeklyFiles = [];
  const useLocal = fs.existsSync(LOCAL_SEMANAS_DIR);

  if (useLocal) {
    console.log(`📁 Modo Local Activo: Escaneando archivos en ${LOCAL_SEMANAS_DIR}...`);
    const diskFiles = fs.readdirSync(LOCAL_SEMANAS_DIR).filter(f => /^ots_semana.*\.json$/i.test(f));
    weeklyFiles = diskFiles.map(name => ({
      name,
      source: 'local',
      path: path.join(LOCAL_SEMANAS_DIR, name)
    })).sort((a, b) => a.name.localeCompare(b.name));
  } else if (googleClients.drive) {
    console.log(`☁️ Modo Cloud Drive: Escaneando subcarpeta ots/ (ID: ${DRIVE_SUBFOLDER_OTS_ID})...`);
    const filesRes = await googleClients.drive.files.list({
      q: `'${DRIVE_SUBFOLDER_OTS_ID}' in parents and mimeType = 'application/json' and trashed = false`,
      fields: 'files(id, name, size, modifiedTime)',
      pageSize: 100
    });
    weeklyFiles = (filesRes.data.files || [])
      .filter(f => /^ots_semana.*\.json$/i.test(f.name))
      .map(f => ({ name: f.name, source: 'drive', id: f.id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } else {
    throw new Error('No se encontró ni la carpeta local de semanas ni credenciales para Google Drive.');
  }

  console.log(`✔ Archivos semanales descubiertos (${weeklyFiles.length}).`);

  // Filtrar archivos a procesar para DB
  let filesToProcess = [];
  if (targetWeek && targetWeek !== 'latest' && targetWeek !== 'all') {
    filesToProcess = weeklyFiles.filter(f => f.name.toLowerCase() === targetWeek.toLowerCase());
  } else {
    // Procesar semanas que no figuren completadas en el ledger
    filesToProcess = weeklyFiles.filter(f => !ledger.semanas_completadas.includes(f.name));
  }

  // Si no hay semanas pendientes para DB pero syncSheets está activo, chequear sincronización en Sheets
  if (filesToProcess.length === 0) {
    console.log('✨ [AUTO-DISCOVERY] No hay semanas pendientes de procesar en Supabase DB.');
    let sheetsSyncRes = { inserted: 0, omitted: 0 };

    if (syncSheets && googleClients.sheets) {
      console.log('📊 Verificando sincronización de órdenes en Google Sheets...');
      const allActiveOts = [];
      for (const fileInfo of weeklyFiles) {
        let weeklyData;
        if (fileInfo.source === 'local') {
          weeklyData = JSON.parse(fs.readFileSync(fileInfo.path, 'utf8'));
        } else if (googleClients.drive) {
          const fileContent = await googleClients.drive.files.get({ fileId: fileInfo.id, alt: 'media' });
          weeklyData = typeof fileContent.data === 'string' ? JSON.parse(fileContent.data) : fileContent.data;
        }
        if (weeklyData && Array.isArray(weeklyData.ots) && weeklyData.ots.length > 0) {
          allActiveOts.push(...weeklyData.ots);
        }
      }

      if (allActiveOts.length > 0) {
        sheetsSyncRes = await syncOtsToGoogleSheets({
          sheetsClient: googleClients.sheets,
          spreadsheetId: targetSpreadsheetId,
          otsList: allActiveOts,
          dryRun
        });
      }
    }

    const duration = Date.now() - startTime;
    return {
      success: true,
      dryRun,
      semanas_procesadas: [],
      ots_insertadas_db: 0,
      ots_omitidas_db: 0,
      tareas_insertadas_db: 0,
      ots_insertadas_sheets: sheetsSyncRes.inserted,
      ots_omitidas_sheets: sheetsSyncRes.omitted,
      total_ledger: ledger.total_ots_insertadas,
      duracion_ms: duration,
      mensaje: 'Supabase DB al día. Google Sheets sincronizado.'
    };
  }

  // 2. Conectar a PostgreSQL
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000
  });

  const client = await pool.connect();
  console.log('✔ Conexión establecida con PostgreSQL / Supabase.');

  try {
    // 3. Pre-cargar Catálogo de Flota en Memoria para Resolución O(1)
    console.log('🚛 Cargando catálogo de tractores y semis en memoria...');
    const [tractoresRes, semisRes] = await Promise.all([
      client.query('SELECT id, patente FROM public.tractores WHERE patente IS NOT NULL;'),
      client.query('SELECT id, patente FROM public.semis WHERE patente IS NOT NULL;')
    ]);

    const tractorMap = new Map();
    for (const r of tractoresRes.rows) {
      tractorMap.set(normalizePlate(r.patente), r.id);
    }

    const semiMap = new Map();
    for (const r of semisRes.rows) {
      semiMap.set(normalizePlate(r.patente), r.id);
    }
    console.log(`✔ Catálogo listo: ${tractorMap.size} tractores y ${semiMap.size} semis.`);

    let totalOtsInsertadas = 0;
    let totalOtsOmitidas = 0;
    let totalTareasInsertadas = 0;
    const semanasProcesadasExitosamente = [];
    const allOtsToSyncSheets = [];

    // 4. Procesar secuencialmente cada archivo semanal
    for (const fileInfo of filesToProcess) {
      let weeklyData;
      if (fileInfo.source === 'local') {
        weeklyData = JSON.parse(fs.readFileSync(fileInfo.path, 'utf8'));
      } else {
        const fileContent = await googleClients.drive.files.get({ fileId: fileInfo.id, alt: 'media' });
        weeklyData = typeof fileContent.data === 'string' ? JSON.parse(fileContent.data) : fileContent.data;
      }

      const otsList = Array.isArray(weeklyData.ots) ? weeklyData.ots : [];
      if (otsList.length === 0) {
        if (!ledger.semanas_completadas.includes(fileInfo.name)) {
          ledger.semanas_completadas.push(fileInfo.name);
        }
        continue;
      }

      allOtsToSyncSheets.push(...otsList);

      console.log('-'.repeat(75));
      console.log(`📂 Procesando semana: ${fileInfo.name} (${otsList.length} OTs)...`);

      let semanaNuevas = 0;
      let semanaOmitidas = 0;
      let semanaTareas = 0;

      for (let i = 0; i < otsList.length; i++) {
        if (limit > 0 && totalOtsInsertadas >= limit) {
          console.log(`   [LÍMITE ALCANZADO] Se procesaron ${limit} órdenes.`);
          break;
        }

        const ot = otsList[i];
        const otNumber = String(ot.orden_no || '').trim();
        if (!otNumber) continue;

        // VERIFICACIÓN O(1) EN LEDGER: Zero Overwrite
        if (ledger.ots_map[otNumber]) {
          semanaOmitidas++;
          totalOtsOmitidas++;
          continue;
        }

        // Resolución del vehículo
        const plateRaw = String(ot.dominio || '').trim().toUpperCase();
        const plateNorm = normalizePlate(plateRaw);
        let tractorId = tractorMap.get(plateNorm) || null;
        let semiId = null;
        if (!tractorId) {
          semiId = semiMap.get(plateNorm) || null;
        }

        const entryDate = parseDateDDMMYYYY(ot.fecha_ingreso);
        const tareas = Array.isArray(ot.tareas) ? ot.tareas : [];

        if (!dryRun) {
          await client.query('BEGIN;');
          try {
            // A. Insertar cabecera panol.work_orders
            const woRes = await client.query(`
              INSERT INTO panol.work_orders (ot_number, status, avg, entry_date)
              VALUES ($1, 'ACTIVA', 0.00, $2)
              ON CONFLICT (ot_number) DO NOTHING
              RETURNING id;
            `, [otNumber, entryDate]);

            let workOrderId = woRes.rows[0]?.id;
            if (!workOrderId) {
              const fetchWo = await client.query('SELECT id FROM panol.work_orders WHERE ot_number = $1;', [otNumber]);
              workOrderId = fetchWo.rows[0]?.id;
            }

            if (!workOrderId) {
              throw new Error(`No se pudo obtener el ID de work_orders para OT ${otNumber}`);
            }

            // B. Vincular con unidad en panol.unit_work_orders
            if (tractorId || semiId) {
              await client.query(`
                INSERT INTO panol.unit_work_orders (work_order_id, tractor_id, semi_id)
                VALUES ($1, $2, $3)
                ON CONFLICT (work_order_id) DO NOTHING;
              `, [workOrderId, tractorId, semiId]);
            }

            // C. Insertar tareas desglosadas en panol.work_order_tasks
            for (let tIdx = 0; tIdx < tareas.length; tIdx++) {
              const t = tareas[tIdx];
              const taskIndex = t.task_index || (tIdx + 1);
              const sector = String(t.sector || 'GENERAL').trim();
              const desc = String(t.description || '').trim();
              const sectorTask = `[${sector}] ${desc}`;

              await client.query(`
                INSERT INTO panol.work_order_tasks (work_order_id, task_index, sector_task, estado, porcentaje)
                VALUES ($1, $2, $3, 'PENDIENTE', 0.00)
                ON CONFLICT (work_order_id, task_index) DO NOTHING;
              `, [workOrderId, taskIndex, sectorTask]);

              semanaTareas++;
              totalTareasInsertadas++;
            }

            await client.query('COMMIT;');

            // D. Registrar en Ledger en memoria
            ledger.ots_map[otNumber] = new Date().toISOString().split('T')[0];
            semanaNuevas++;
            totalOtsInsertadas++;
          } catch (dbErr) {
            await client.query('ROLLBACK;');
            console.error(`❌ Error al insertar OT ${otNumber}:`, dbErr.message);
            throw dbErr;
          }
        } else {
          ledger.ots_map[otNumber] = 'SIMULADO';
          semanaNuevas++;
          totalOtsInsertadas++;
          semanaTareas += tareas.length;
          totalTareasInsertadas += tareas.length;
        }
      }

      console.log(`   ✔ Resultados de ${fileInfo.name}: ${semanaNuevas} insertadas, ${semanaOmitidas} omitidas (ya en ledger), ${semanaTareas} tareas creadas.`);

      if (!limit || otsList.length === (semanaNuevas + semanaOmitidas)) {
        if (!ledger.semanas_completadas.includes(fileInfo.name)) {
          ledger.semanas_completadas.push(fileInfo.name);
        }
        semanasProcesadasExitosamente.push(fileInfo.name);
      }
    }

    // 5. Sincronización a Google Sheets
    let sheetsSyncRes = { inserted: 0, omitted: 0 };
    if (syncSheets && googleClients.sheets && allOtsToSyncSheets.length > 0) {
      sheetsSyncRes = await syncOtsToGoogleSheets({
        sheetsClient: googleClients.sheets,
        spreadsheetId: targetSpreadsheetId,
        otsList: allOtsToSyncSheets,
        dryRun
      });
    }

    // 6. Guardar Ledger actualizado
    if (!dryRun && totalOtsInsertadas > 0) {
      await saveLedger(ledger, googleClients.drive);
    }

    const duration = Date.now() - startTime;
    console.log('='.repeat(75));
    console.log(`✨ PIPELINE FINALIZADO CON ÉXITO (${duration} ms)`);
    console.log(`   Semanas completadas: ${semanasProcesadasExitosamente.join(', ') || 'Ninguna nueva'}`);
    console.log(`   OTs nuevas insertadas (DB): ${totalOtsInsertadas}`);
    console.log(`   OTs omitidas (DB Ledger): ${totalOtsOmitidas}`);
    console.log(`   Tareas insertadas (DB): ${totalTareasInsertadas}`);
    console.log(`   OTs insertadas (Google Sheets): ${sheetsSyncRes.inserted}`);
    console.log(`   OTs omitidas (Google Sheets): ${sheetsSyncRes.omitted}`);
    console.log(`   Total histórico en Ledger: ${ledger.total_ots_insertadas}`);
    console.log('='.repeat(75));

    return {
      success: true,
      dryRun,
      semanas_procesadas: semanasProcesadasExitosamente,
      ots_insertadas_db: totalOtsInsertadas,
      ots_omitidas_db: totalOtsOmitidas,
      tareas_insertadas_db: totalTareasInsertadas,
      ots_insertadas_sheets: sheetsSyncRes.inserted,
      ots_omitidas_sheets: sheetsSyncRes.omitted,
      total_ledger: ledger.total_ots_insertadas,
      duracion_ms: duration
    };

  } finally {
    client.release();
    await pool.end();
  }
}

// Ejecución directa desde CLI
if (require.main === module) {
  runPipeline()
    .then(res => {
      console.log('--- N8N_PIPELINE_OUTPUT ---');
      console.log(JSON.stringify(res));
      process.exit(0);
    })
    .catch(err => {
      console.error('FATAL PIPELINE ERROR:', err);
      process.exit(1);
    });
}

module.exports = { runPipeline };
