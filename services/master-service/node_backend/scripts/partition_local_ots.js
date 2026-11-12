#!/usr/bin/env node
/**
 * ==============================================================================
 * 🚀 PARTITION LOCAL OTS: EXTRACTOR LOCAL Y PARTICIONADOR A 6 MESES
 * ==============================================================================
 * 1. Escanea los PDFs reales en 'C:\Users\Matias Rodriguez\Documents\ots'.
 * 2. Genera los archivos JSON semanales para 6 meses (30 semanas: Oct 2026 a Mayo 2027)
 *    con la denominación secuencial canónica 'ots_semanaMMDD_YYYY.json'.
 * 3. Ubica los archivos generados en la carpeta local:
 *    'C:\Users\Matias Rodriguez\Documents\ots\semanas'.
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');
const { parseDompdfBuffer } = require('C:/Users/Matias Rodriguez/Documents/server_local/ot_extractor/app/ot_extractor_core.js');

const OTS_DIR = 'C:/Users/Matias Rodriguez/Documents/ots';
const OUTPUT_DIR = path.join(OTS_DIR, 'semanas');

// Ancla inicial: Sábado 10 de Octubre de 2026 (Semana 1010_2026)
const ANCHOR_DATE = new Date(Date.UTC(2026, 9, 10)); // Mes 9 = Octubre en JS UTC
const TOTAL_WEEKS = 30; // 30 semanas = ~7 meses (Oct 2026 - Mayo 2027)

/**
 * Genera el mapa del calendario semanal para las 30 semanas
 */
function generateWeekCalendar() {
  const calendar = [];
  for (let i = 0; i < TOTAL_WEEKS; i++) {
    const weekStart = new Date(ANCHOR_DATE.getTime() + i * 7 * 24 * 60 * 60 * 1000);
    const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);

    const sm = String(weekStart.getUTCMonth() + 1).padStart(2, '0');
    const sd = String(weekStart.getUTCDate()).padStart(2, '0');
    const sy = weekStart.getUTCFullYear();

    const filename = `ots_semana${sm}${sd}_${sy}.json`;
    const semanaId = `semana${sm}${sd}_${sy}`;

    calendar.push({
      semana_id: semanaId,
      archivo: filename,
      periodo: {
        desde: weekStart.toISOString().split('T')[0],
        hasta: weekEnd.toISOString().split('T')[0]
      },
      weekStart,
      weekEnd,
      ots: []
    });
  }
  return calendar;
}

/**
 * Encuentra a qué semana pertenece una fecha en formato DD/MM/YYYY
 */
function findWeekForDate(dateStr, calendar) {
  if (!dateStr) return null;
  const parts = String(dateStr).trim().split('/');
  if (parts.length !== 3) return null;

  const d = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const y = parseInt(parts[2], 10);
  const target = new Date(Date.UTC(y, m, d));

  for (const week of calendar) {
    if (target >= week.weekStart && target <= week.weekEnd) {
      return week;
    }
  }

  // Si cae antes del ancla o después, calcular dinámicamente
  const diffDays = Math.floor((target.getTime() - ANCHOR_DATE.getTime()) / (1000 * 60 * 60 * 24));
  const weekOffset = Math.floor(diffDays / 7);
  const wStart = new Date(ANCHOR_DATE.getTime() + weekOffset * 7 * 24 * 60 * 60 * 1000);
  const wEnd = new Date(wStart.getTime() + 6 * 24 * 60 * 60 * 1000);
  const sm = String(wStart.getUTCMonth() + 1).padStart(2, '0');
  const sd = String(wStart.getUTCDate()).padStart(2, '0');
  const sy = wStart.getUTCFullYear();

  return {
    semana_id: `semana${sm}${sd}_${sy}`,
    archivo: `ots_semana${sm}${sd}_${sy}.json`,
    periodo: {
      desde: wStart.toISOString().split('T')[0],
      hasta: wEnd.toISOString().split('T')[0]
    },
    weekStart: wStart,
    weekEnd: wEnd,
    ots: []
  };
}

/**
 * Función principal
 */
async function partitionOts() {
  console.log('='.repeat(75));
  console.log('🚀 GENERADOR Y PARTICIONADOR SEMANAL DE OTS (LOCAL 6 MESES)');
  console.log('='.repeat(75));

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`📁 Carpeta creada: ${OUTPUT_DIR}`);
  }

  // 1. Inicializar calendario semanal de 30 semanas
  const calendar = generateWeekCalendar();
  console.log(`✔ Calendario inicializado: ${calendar.length} semanas (desde ${calendar[0].archivo} hasta ${calendar[calendar.length - 1].archivo}).`);

  // 2. Escanear y parsear PDFs en OTS_DIR
  const files = fs.readdirSync(OTS_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
  console.log(`🔎 Escaneando ${files.length} archivos PDF en ${OTS_DIR}...`);

  let totalParseados = 0;
  for (const file of files) {
    const filePath = path.join(OTS_DIR, file);
    try {
      const buf = fs.readFileSync(filePath);
      const matchOt = file.match(/OT_(\d+)/i);
      const fallbackOt = matchOt ? matchOt[1] : '';

      const raw = parseDompdfBuffer(buf, fallbackOt);
      const ordenNo = raw.orden_no || fallbackOt;
      if (!ordenNo) {
        console.warn(`⚠️ Archivo sin número de OT: ${file}`);
        continue;
      }

      const tareas = (raw.tareas || []).map((tStr, idx) => {
        const m = tStr.match(/^\[([^\]]+)\]\s*(.*)$/);
        const sector = m ? m[1].trim() : 'GENERAL';
        const desc = m ? m[2].trim() : tStr.trim();
        const taskIndex = idx + 1;
        return {
          task_id: `${ordenNo}-${raw.dominio || 'SINDOM'}-${taskIndex}`,
          task_index: taskIndex,
          sector: sector,
          description: desc,
          status: 'PENDIENTE'
        };
      });

      const cleanOt = {
        orden_no: ordenNo,
        dominio: raw.dominio || `SINDOM_${ordenNo}`,
        fecha_ingreso: raw.fecha_ingreso || '10/11/2026',
        estado: raw.confirmacion === 'Sin confirmar' ? 'Abierto' : raw.confirmacion,
        tareas_consolidada: raw.tareas_consolidada || '',
        tareas: tareas
      };

      // Asignar a la semana correspondiente
      const targetWeek = findWeekForDate(cleanOt.fecha_ingreso, calendar);
      if (targetWeek) {
        // Evitar duplicados por orden_no
        const exists = targetWeek.ots.find(o => o.orden_no === cleanOt.orden_no);
        if (!exists) {
          targetWeek.ots.push(cleanOt);
          totalParseados++;
        }
      }
    } catch (err) {
      console.error(`❌ Error parseando ${file}:`, err.message);
    }
  }

  console.log(`✔ Se parsearon e incorporaron ${totalParseados} órdenes reales.`);

  // 3. Escribir cada archivo JSON en OUTPUT_DIR
  let semanasConDatos = 0;
  for (const week of calendar) {
    const payload = {
      semana_id: week.semana_id,
      archivo: week.archivo,
      periodo: week.periodo,
      total_ots: week.ots.length,
      total_tareas: week.ots.reduce((acc, o) => acc + o.tareas.length, 0),
      ultima_actualizacion: new Date().toISOString(),
      ots: week.ots
    };

    const outPath = path.join(OUTPUT_DIR, week.archivo);
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

    if (week.ots.length > 0) {
      semanasConDatos++;
      console.log(`⭐ [POBLADA] ${week.archivo}: ${payload.total_ots} OTs, ${payload.total_tareas} tareas.`);
    }
  }

  console.log('='.repeat(75));
  console.log(`✨ PARTICIONADO COMPLETADO`);
  console.log(`   Directorio destino: ${OUTPUT_DIR}`);
  console.log(`   Archivos semanales generados: ${calendar.length}`);
  console.log(`   Semanas con OTs reales activas: ${semanasConDatos}`);
  console.log('='.repeat(75));
}

if (require.main === module) {
  partitionOts().catch(console.error);
}

module.exports = { partitionOts, generateWeekCalendar, findWeekForDate };
