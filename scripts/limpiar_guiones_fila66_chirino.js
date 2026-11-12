#!/usr/bin/env node
/**
 * scripts/limpiar_guiones_fila66_chirino.js
 * 
 * Limpieza quirúrgica de guiones exclusivamente para la Fila 66 (CHIRINO WALTER OMAR)
 * en la hoja 'Nov-26' del spreadsheet de Diagramas EOR (14jgQZF0gkbT7k3mps1k3dM3qtoaseoCOUfK4PFRozKU).
 * Las demás filas que poseen guiones permanecen completamente inalteradas.
 */

const path = require('path');
const nodeBackendDir = path.resolve(__dirname, '../services/master-service/node_backend');
require('dotenv').config({ path: path.join(nodeBackendDir, '.env') });

const { getAuthClient, fetchRange } = require(path.join(nodeBackendDir, 'utils/sheets'));
const { ID_SPREADSHEET_DIAGRAMAS } = require(path.join(nodeBackendDir, 'utils/shared'));

async function main() {
    console.log(`========================================================================`);
    console.log(`🧹 LIMPIEZA DE GUIONES: FILA 66 CHIRINO (Google Sheets)`);
    console.log(`   Spreadsheet: ${ID_SPREADSHEET_DIAGRAMAS}`);
    console.log(`   Pestaña:     Nov-26`);
    console.log(`========================================================================\n`);

    const auth = getAuthClient();

    // 1. Verificación previa de Fila 66
    console.log(`1. Leyendo fila 66 antes de la modificación...`);
    const row66Before = await fetchRange(ID_SPREADSHEET_DIAGRAMAS, "'Nov-26'!A66:AI66");
    if (!row66Before || row66Before.length === 0) {
        throw new Error('No se pudo leer la fila 66');
    }

    const r = row66Before[0];
    const legajo = r[0];
    const nombre = r[1];
    console.log(`   • Legajo: ${legajo}`);
    console.log(`   • Nombre: ${nombre}`);

    if (!String(nombre).toUpperCase().includes('CHIRINO')) {
        throw new Error(`La fila 66 no corresponde a Chirino (Nombre encontrado: "${nombre}"). Abortando para seguridad.`);
    }

    const dias1a20 = r.slice(4, 24);
    const dias21a31 = r.slice(24, 35);
    console.log(`   • Días 1..20 (Cols E..X):`, JSON.stringify(dias1a20));
    console.log(`   • Días 21..31 (Cols Y..AI con guiones):`, JSON.stringify(dias21a31));

    // 2. Ejecutar limpieza quirúrgica en Y66:AI66 (días 21 al 31)
    console.log(`\n2. Ejecutando actualización en Google Sheets (Nov-26!Y66:AI66 con celdas vacías)...`);
    const empty11Days = new Array(11).fill('');
    const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${ID_SPREADSHEET_DIAGRAMAS}/values/'Nov-26'!Y66:AI66?valueInputOption=USER_ENTERED`;
    
    const updateRes = await auth.request({
        url: updateUrl,
        method: 'PUT',
        data: {
            range: "'Nov-26'!Y66:AI66",
            majorDimension: 'ROWS',
            values: [empty11Days]
        }
    });

    console.log(`   • Celdas actualizadas: ${updateRes.data.updatedCells}`);

    // 3. Verificación posterior de Fila 66
    console.log(`\n3. Verificando Fila 66 tras la limpieza...`);
    const row66After = await fetchRange(ID_SPREADSHEET_DIAGRAMAS, "'Nov-26'!A66:AI66");
    const rAfter = row66After[0];
    const dias1a20After = rAfter.slice(4, 24);
    const dias21a31After = rAfter.slice(24, 35);

    console.log(`   • Días 1..20 tras limpieza:`, JSON.stringify(dias1a20After));
    console.log(`   • Días 21..31 tras limpieza:`, JSON.stringify(dias21a31After));

    const allDays1to20Match = JSON.stringify(dias1a20) === JSON.stringify(dias1a20After);
    const allCleaned = dias21a31After.every(d => !d || d === '');

    if (!allDays1to20Match) {
        throw new Error('❌ ALERTA: Los días 1 a 20 sufrieron cambios inesperados.');
    }
    if (!allCleaned) {
        throw new Error('❌ ALERTA: Aún quedan caracteres en los días 21 a 31.');
    }
    console.log(`   ✅ Días 1..20 preservados 100% idénticos.`);
    console.log(`   ✅ Días 21..31 totalmente limpios (0 guiones).`);

    // 4. Verificación de no-afectación en las demás filas con guiones
    console.log(`\n4. Verificando no-afectación en las demás filas con guiones...`);
    const otherRowsToCheck = [18, 85, 130, 133, 149];
    for (const rowNum of otherRowsToCheck) {
        const rowsRes = await fetchRange(ID_SPREADSHEET_DIAGRAMAS, `'Nov-26'!A${rowNum}:AI${rowNum}`);
        const rOther = rowsRes[0] || [];
        const hyphensCount = rOther.slice(4).filter(d => d === '-').length;
        console.log(`   • Fila ${rowNum} (${rOther[1]}): ${hyphensCount} guiones conservados.`);
        if (hyphensCount === 0) {
            console.warn(`   ⚠️ Advertencia: Fila ${rowNum} no tiene guiones.`);
        }
    }

    console.log(`\n🎉 Operación completada con éxito. Solo la Fila 66 fue limpiada.`);
}

main().catch(err => {
    console.error(`\n❌ Error en la ejecución:`, err.message);
    process.exit(1);
});
