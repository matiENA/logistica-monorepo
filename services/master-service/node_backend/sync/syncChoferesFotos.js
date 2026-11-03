/**
 * ==============================================================================
 * PROCESO DE AUDITORÍA, UPSERT WEBP Y REPORTE DE FALTANTES / FOTOS CHOFERES
 * Script ejecutable CLI / n8n / Windows Scheduler
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');
const sharp = require('sharp');
const XLSX = require('C:/Users/Matias Rodriguez/AppData/Roaming/npm/node_modules/n8n/node_modules/@e965/xlsx');

// 1. Cargar .env
const envPaths = [
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env'),
  'C:/Users/Matias Rodriguez/Documents/eor_v1/.env'
];
let env = null;
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    env = dotenv.parse(fs.readFileSync(p));
    break;
  }
}
if (!env || !env.DATABASE_URL || !env.SUPABASE_URL || !env.SUPABASE_KEY) {
  console.error('❌ Error: Variables de entorno Supabase / DB no encontradas.');
  process.exit(1);
}

const FOTOS_DIR = 'S:\\4- Registros Operativos\\2. RRHH y Control Doc\\19.Fotos conductores\\Fotos fondo blanco';
const REPORT_DIR = 'C:\\Users\\Matias Rodriguez\\Documents\\reportes\\choferes_fotos';

async function runSyncChoferesFotos() {
  console.log('===============================================================');
  console.log(`🚀 INICIANDO SINCRONIZACIÓN DE FOTOS CHOFERES (WEBP + SUPABASE)`);
  console.log(`   Directorio Origen: ${FOTOS_DIR}`);
  console.log(`   Bucket Destino: choferes-fotos`);
  console.log('===============================================================\n');

  if (!fs.existsSync(FOTOS_DIR)) {
    console.error(`❌ Carpeta de fotos no accesible en: ${FOTOS_DIR}`);
    process.exit(1);
  }

  // Clientes
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
  const pgClient = new Client({ connectionString: env.DATABASE_URL });
  await pgClient.connect();

  try {
    // 1. Obtener choferes de la base de datos con su documentación
    const query = `
      SELECT 
        c.id, c.nombre, c.legajo, c.foto, c.estado,
        d.cuil, d.dni, d.drv_codigo, d.telefono, d.email
      FROM public.choferes c
      LEFT JOIN public.chofer_documentacion d ON c.id = d.chofer_id
      ORDER BY c.nombre ASC
    `;
    const res = await pgClient.query(query);
    const dbDrivers = res.rows;
    console.log(`📋 Total choferes en BD: ${dbDrivers.length}`);

    // 2. Leer archivos en la carpeta de fotos
    const rawFiles = fs.readdirSync(FOTOS_DIR).filter(f => f !== 'Thumbs.db');
    console.log(`📸 Total archivos detectados en carpeta: ${rawFiles.length}`);

    // Indexar archivos por DNI
    const filesByDni = new Map();
    const allFilesMeta = [];

    for (const f of rawFiles) {
      const fullPath = path.join(FOTOS_DIR, f);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;

      const cuilMatch = f.match(/(\d{2})[-_]?(\d{7,8})[-_]?(\d{1})/);
      const dniMatch = f.match(/\b(\d{7,8})\b/);
      const cuil = cuilMatch ? `${cuilMatch[1]}-${cuilMatch[2]}-${cuilMatch[3]}` : null;
      const dni = cuilMatch ? cuilMatch[2] : (dniMatch ? dniMatch[1] : null);

      const fileObj = {
        fileName: f,
        fullPath,
        size: stat.size,
        dni,
        cuil
      };
      allFilesMeta.push(fileObj);

      if (dni) {
        if (!filesByDni.has(dni)) filesByDni.set(dni, []);
        filesByDni.get(dni).push(fileObj);
      }
    }

    // 3. Procesar choferes que no tienen foto
    const sinFoto = dbDrivers.filter(d => !d.foto || d.foto.trim() === '');
    console.log(`🔎 Choferes sin foto en BD: ${sinFoto.length}`);

    const actualizados = [];
    const faltantes = [];

    for (const d of sinFoto) {
      const cleanDni = d.dni ? String(d.dni).replace(/\D/g, '') : null;
      let matched = null;

      if (cleanDni && filesByDni.has(cleanDni)) {
        matched = filesByDni.get(cleanDni)[0];
      }

      if (matched) {
        // Convertir a WebP y subir
        const storageFileName = `${cleanDni}.webp`;
        try {
          const webpBuffer = await sharp(matched.fullPath)
            .webp({ quality: 80, effort: 4 })
            .toBuffer();

          const { error: uploadErr } = await sb.storage
            .from('choferes-fotos')
            .upload(storageFileName, webpBuffer, {
              contentType: 'image/webp',
              upsert: true
            });

          if (uploadErr) {
            console.error(`❌ Error al subir ${storageFileName}:`, uploadErr.message);
            continue;
          }

          const { data: urlData } = sb.storage
            .from('choferes-fotos')
            .getPublicUrl(storageFileName);

          const publicUrl = urlData.publicUrl;

          // Actualizar en DB
          await pgClient.query(
            `UPDATE public.choferes SET foto = $1, actualizado_el = NOW() WHERE id = $2`,
            [publicUrl, d.id]
          );

          actualizados.push({
            nombre: d.nombre,
            dni: cleanDni,
            cuil: d.cuil || '-',
            archivo: matched.fileName,
            fotoUrl: publicUrl
          });
          console.log(`  ✅ Actualizado: ${d.nombre} (${cleanDni}.webp)`);
        } catch (convErr) {
          console.error(`❌ Error procesando imagen de ${d.nombre}:`, convErr.message);
        }
      } else {
        faltantes.push({
          id: d.id,
          nombre: d.nombre,
          legajo: d.legajo || '-',
          dni: cleanDni || 'SIN DNI',
          cuil: d.cuil || 'SIN CUIL',
          estado: d.estado,
          drv_codigo: d.drv_codigo || '-',
          telefono: d.telefono || '-',
          email: d.email || '-'
        });
      }
    }

    console.log(`\n🎉 Resumen de ejecución:`);
    console.log(`   - Choferes actualizados con nueva foto: ${actualizados.length}`);
    console.log(`   - Choferes que aún carecen de foto en carpeta: ${faltantes.length}`);

    // 4. Generar Reporte de Faltantes e Historial (Excel XLSX)
    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }

    const now = new Date();
    const timestampStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dateFormatted = now.toLocaleDateString('es-AR');
    const timeFormatted = now.toLocaleTimeString('es-AR');

    const wb = XLSX.utils.book_new();

    // Hoja 1: Choferes Faltantes
    const wsFaltantesData = [
      ['REPORTE DE CHOFERES SIN FOTO REGISTRADA'],
      [`Generado el: ${dateFormatted} ${timeFormatted}`],
      [`Total Faltantes: ${faltantes.length}`],
      [],
      ['NOMBRE Y APELLIDO', 'DNI', 'CUIL', 'LEGAJO', 'ESTADO', 'CÓDIGO DRV', 'TELÉFONO', 'OBSERVACIÓN']
    ];

    faltantes.forEach(f => {
      wsFaltantesData.push([
        f.nombre,
        f.dni,
        f.cuil,
        f.legajo,
        f.estado,
        f.drv_codigo,
        f.telefono,
        'Sin archivo correspondiente en carpeta de fotos'
      ]);
    });

    const wsFaltantes = XLSX.utils.aoa_to_sheet(wsFaltantesData);
    XLSX.utils.book_append_sheet(wb, wsFaltantes, 'Faltantes');

    // Hoja 2: Actualizados en esta corrida
    const wsActualizadosData = [
      ['FOTOS PROCESADAS Y SUBIDAS (WEBP)'],
      [`Fecha: ${dateFormatted} ${timeFormatted}`],
      [`Total Actualizados: ${actualizados.length}`],
      [],
      ['NOMBRE Y APELLIDO', 'DNI', 'CUIL', 'ARCHIVO ORIGEN', 'URL SUPABASE STORAGE']
    ];

    actualizados.forEach(a => {
      wsActualizadosData.push([
        a.nombre,
        a.dni,
        a.cuil,
        a.archivo,
        a.fotoUrl
      ]);
    });

    const wsActualizados = XLSX.utils.aoa_to_sheet(wsActualizadosData);
    XLSX.utils.book_append_sheet(wb, wsActualizados, 'Actualizados');

    // Hoja 3: Archivos huérfanos en carpeta (fotos sin chofer en BD)
    const dbDniSet = new Set(dbDrivers.map(d => d.dni ? String(d.dni).replace(/\D/g, '') : null).filter(Boolean));
    const huerfanos = allFilesMeta.filter(f => f.dni && !dbDniSet.has(f.dni));

    const wsHuerfanosData = [
      ['ARCHIVOS EN CARPETA SIN CHOFER EN BASE DE DATOS'],
      [`Total: ${huerfanos.length}`],
      [],
      ['ARCHIVO', 'DNI EXTRAÍDO', 'CUIL DETECTADO', 'TAMAÑO BYTES']
    ];
    huerfanos.forEach(h => {
      wsHuerfanosData.push([h.fileName, h.dni, h.cuil || '-', h.size]);
    });
    const wsHuerfanos = XLSX.utils.aoa_to_sheet(wsHuerfanosData);
    XLSX.utils.book_append_sheet(wb, wsHuerfanos, 'Fotos Huérfanas');

    // Guardar archivo
    const reportFileName = `reporte_faltantes_fotos_${timestampStr}.xlsx`;
    const latestFileName = `reporte_faltantes_fotos_latest.xlsx`;
    const reportFilePath = path.join(REPORT_DIR, reportFileName);
    const latestFilePath = path.join(REPORT_DIR, latestFileName);

    XLSX.writeFile(wb, reportFilePath);
    XLSX.writeFile(wb, latestFilePath);
    console.log(`📊 Reporte generado exitosamente en:`);
    console.log(`   - ${reportFilePath}`);
    console.log(`   - ${latestFilePath}`);

    return {
      success: true,
      total_evaluados: dbDrivers.length,
      actualizados: actualizados.length,
      faltantes: faltantes.length,
      reporte: reportFilePath
    };

  } finally {
    await pgClient.end();
  }
}

// Ejecución directa si se invoca por CLI
if (require.main === module) {
  runSyncChoferesFotos()
    .then(r => {
      console.log('✅ Proceso finalizado.');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Error fatal:', err);
      process.exit(1);
    });
}

module.exports = { runSyncChoferesFotos };
