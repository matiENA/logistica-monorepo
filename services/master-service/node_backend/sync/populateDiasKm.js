/**
 * apps/backend/sync/populateDiasKm.js
 * 
 * Script autónomo ultra-optimizado (Batch UPSERT) para enriquecer y poblar los objetos `dias_km`
 * en `public.choferes_km_mensual` con los kilómetros y hojas de ruta reales día a día
 * extraídos desde la planilla maestra de Google Sheets ('KM'!A:V).
 */

require('dotenv').config({ path: 'c:/Users/Matias Rodriguez/Documents/eor_v1/.env', override: true });
const { fetchRango, ID_SHEET_KILOMETROS } = require('../utils/shared');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function restoreEnie(str) {
    if (!str) return '';
    return String(str).trim()
        .replace(/Ã‘|Ã±|\uFFFD/g, 'Ñ')
        .replace(/#/g, 'Ñ')
        .replace(/\s+/g, ' ')
        .trim();
}

function sanitizeNameAscii(str) {
    if (!str) return '';
    return restoreEnie(str)
        .replace(/[ñÑ]/g, 'N')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseFecha(val) {
    if (!val) return null;
    const clean = String(val).split(' - ')[0].trim();
    const parts = clean.split(/[\/\-]/);
    if (parts.length === 3) {
        let y = parseInt(parts[2], 10);
        if (y < 100) y += 2000;
        if (y < 2020 || y > 2030) return null;
        const m = String(parseInt(parts[1], 10)).padStart(2, '0');
        const d = String(parseInt(parts[0], 10)).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    return null;
}

function parseNum(val) {
    if (!val) return 0;
    const clean = String(val).replace(/,/g, '.').replace(/[^0-9.-]/g, '');
    const n = parseFloat(clean);
    return isNaN(n) ? 0 : n;
}

const mesesMap = {
    '01': 'Ene', '02': 'Feb', '03': 'Mar', '04': 'Abr', '05': 'May', '06': 'Jun',
    '07': 'Jul', '08': 'Ago', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dic'
};

async function run() {
    const t0 = Date.now();
    console.log("🚀 [PopulateDiasKm] Iniciando sincronización de KMs diarios...");

    // 1. Catálogo de Choferes y Unidades
    const rChoferes = await pool.query("SELECT id, UPPER(TRIM(nombre)) as nombre FROM public.choferes WHERE nombre IS NOT NULL;");
    const choferMap = new Map();
    const choferMapAscii = new Map();
    rChoferes.rows.forEach(c => {
        choferMap.set(c.nombre, c.id);
        choferMapAscii.set(sanitizeNameAscii(c.nombre), c.id);
    });

    const rUnidades = await pool.query(`
        SELECT u.id, u.n_ute, UPPER(TRIM(t.patente)) as tractor, UPPER(TRIM(s.patente)) as semi
        FROM public.unidades u
        LEFT JOIN public.tractores t ON u.tractor_id = t.id
        LEFT JOIN public.semis s ON u.semi_id = s.id;
    `);
    const tractorMap = new Map();
    const semiMap = new Map();
    rUnidades.rows.forEach(u => {
        if (u.tractor) tractorMap.set(u.tractor.replace(/[^A-Z0-9]/g, ''), u);
        if (u.semi) semiMap.set(u.semi.replace(/[^A-Z0-9]/g, ''), u);
    });

    // 2. Descargar hoja 'KM'
    const spreadsheetId = process.env.SHEET_KM_ID || ID_SHEET_KILOMETROS;
    console.log(`📥 Descargando planilla de Kilómetros (${spreadsheetId})...`);
    const rawRows = await fetchRango(spreadsheetId, "'KM'!A:V");
    if (!rawRows || rawRows.length < 2) {
        console.error("❌ No se pudieron descargar filas de la planilla KM");
        await pool.end();
        return;
    }
    console.log(`📊 Filas descargadas: ${rawRows.length}`);

    // Mapeo dinámico de columnas
    const headers = rawRows[0] || [];
    const norm = (h) => String(h || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const colMap = {};
    headers.forEach((h, idx) => {
        const k = norm(h);
        if (k && colMap[k] === undefined) colMap[k] = idx;
    });

    const colFecha = colMap['fecha'] ?? 1;
    const colChofer = colMap['chofer'] ?? 2;
    const colDominio = colMap['dominio'] ?? colMap['tractor'] ?? 0;
    const colKm = colMap['kmtotales'] ?? colMap['kilometros'] ?? 17;
    const colHr = colMap['nhojaderuta'] ?? colMap['hojaderuta'] ?? 20;
    const colSemi = colMap['semi'] ?? 19;

    console.log(`Columnas detectadas: Fecha=${colFecha}, Chofer=${colChofer}, Tractor=${colDominio}, Km=${colKm}, HR=${colHr}`);

    // 3. Procesar y agrupar en buckets por chofer y mes
    const buckets = new Map();

    for (let i = 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) continue;

        const rawChofer = String(row[colChofer] || '').trim();
        if (!rawChofer || ['1', '0', '-', 'S/A', 'VACANTE', 'SIN CHOFER'].includes(rawChofer.toUpperCase())) continue;

        const rawFecha = row[colFecha];
        const fechaIso = parseFecha(rawFecha);
        if (!fechaIso) continue;

        const parts = fechaIso.split('-');
        const anio = parseInt(parts[0], 10);
        if (anio < 2024 || anio > 2030) continue;
        const mm = parts[1];
        const mesNumero = parseInt(mm, 10);
        const mesAbrev = mesesMap[mm] || 'Mes';
        const yy = String(anio).slice(-2);
        const mesTab = `${mesAbrev}-${yy}`;

        const rawKm = row[colKm];
        const km = parseNum(rawKm);
        const hr = row[colHr] !== undefined ? String(row[colHr]).trim() : '';

        // Si no hay KM ni HR, saltar
        if (km <= 0 && !hr) continue;

        const nombreUpper = restoreEnie(rawChofer).toUpperCase();
        const nombreAscii = sanitizeNameAscii(rawChofer);
        let choferId = choferMap.get(nombreUpper) || choferMapAscii.get(nombreAscii);
        if (!choferId) continue;

        const rawDominio = String(row[colDominio] || '').trim().toUpperCase();
        const rawSemi = colSemi !== undefined ? String(row[colSemi] || '').trim().toUpperCase() : '';
        const domClean = rawDominio.replace(/[^A-Z0-9]/g, '');
        const semiClean = rawSemi.replace(/[^A-Z0-9]/g, '');
        const formacion = (domClean && tractorMap.get(domClean)) || (semiClean && semiMap.get(semiClean)) || null;

        const bKey = `${choferId}__${mesTab}`;
        if (!buckets.has(bKey)) {
            buckets.set(bKey, {
                chofer_id: choferId,
                mes_tab: mesTab,
                anio,
                mes_numero: mesNumero,
                km_mes_total: 0,
                cant_viajes: 0,
                dias_km: {}
            });
        }

        const b = buckets.get(bKey);
        b.km_mes_total = Math.round((b.km_mes_total + km) * 100) / 100;
        b.cant_viajes += 1;

        if (!b.dias_km[fechaIso]) {
            b.dias_km[fechaIso] = {
                km: 0,
                hr: hr || '',
                tractor: rawDominio || null,
                semi: rawSemi || null,
                id_unidad: formacion ? formacion.id : null,
                n_ute: formacion ? formacion.n_ute : null
            };
        }

        b.dias_km[fechaIso].km = Math.round((b.dias_km[fechaIso].km + km) * 100) / 100;
        if (hr && !b.dias_km[fechaIso].hr.includes(hr)) {
            b.dias_km[fechaIso].hr = b.dias_km[fechaIso].hr ? `${b.dias_km[fechaIso].hr}, ${hr}` : hr;
        }
        if (rawDominio && !b.dias_km[fechaIso].tractor) b.dias_km[fechaIso].tractor = rawDominio;
        if (formacion && !b.dias_km[fechaIso].id_unidad) b.dias_km[fechaIso].id_unidad = formacion.id;
        if (formacion && !b.dias_km[fechaIso].n_ute) b.dias_km[fechaIso].n_ute = formacion.n_ute;
    }

    const allItems = Array.from(buckets.values());
    console.log(`📦 Total de buckets consolidados: ${allItems.length}`);

    // 4. Batch UPSERT en PostgreSQL (Chunks de 200 en single query con JSONB)
    const chunkSize = 200;
    let totalProcessed = 0;

    for (let i = 0; i < allItems.length; i += chunkSize) {
        const chunk = allItems.slice(i, i + chunkSize);
        await pool.query(`
            INSERT INTO public.choferes_km_mensual (
                chofer_id, mes_tab, anio, mes_numero, km_mes_total, cant_viajes, dias_km, actualizado_el
            )
            SELECT 
                (elem->>'chofer_id')::uuid,
                elem->>'mes_tab',
                (elem->>'anio')::int,
                (elem->>'mes_numero')::int,
                (elem->>'km_mes_total')::numeric,
                (elem->>'cant_viajes')::int,
                (elem->'dias_km')::jsonb,
                NOW()
            FROM jsonb_array_elements($1::jsonb) AS elem
            ON CONFLICT (chofer_id, mes_tab) DO UPDATE SET
                dias_km = EXCLUDED.dias_km,
                cant_viajes = EXCLUDED.cant_viajes,
                km_mes_total = GREATEST(choferes_km_mensual.km_mes_total, EXCLUDED.km_mes_total),
                actualizado_el = NOW();
        `, [JSON.stringify(chunk)]);

        totalProcessed += chunk.length;
        console.log(`   ⚡ Procesados ${totalProcessed}/${allItems.length} buckets...`);
    }

    console.log(`✅ Sincronización Batch completada con éxito en ${Date.now() - t0} ms.`);
    await pool.end();
}

run();
