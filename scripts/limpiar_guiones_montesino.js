#!/usr/bin/env node
/**
 * scripts/limpiar_guiones_montesino.js
 * 
 * Limpieza quirúrgica de guiones para MONTESINO JAVIER ELISEO (Fila 152)
 * en la hoja 'Nov-26' del spreadsheet de Diagramas EOR (14jgQZF0gkbT7k3mps1k3dM3qtoaseoCOUfK4PFRozKU).
 */

const path = require('path');
const nodeBackendDir = path.resolve(__dirname, '../services/master-service/node_backend');
require('dotenv').config({ path: path.join(nodeBackendDir, '.env') });

const { getAuthClient, fetchRange } = require(path.join(nodeBackendDir, 'utils/sheets'));
const { ID_SPREADSHEET_DIAGRAMAS } = require(path.join(nodeBackendDir, 'utils/shared'));

async function main() {
    console.log(`========================================================================`);
    console.log(`🧹 LIMPIEZA DE GUIONES: MONTESINO JAVIER ELISEO (Google Sheets)`);
    console.log(`   Spreadsheet: ${ID_SPREADSHEET_DIAGRAMAS}`);
    console.log(`   Pestaña:     Nov-26`);
    console.log(`========================================================================\n`);

    const auth = getAuthClient();

    // 1. Verificación previa de Fila 152
    console.log(`1. Leyendo fila 152 antes de la modificación...`);
    const row152Before = await fetchRange(ID_SPREADSHEET_DIAGRAMAS, "'Nov-26'!A152:AI152");
    if (!row152Before || row152Before.length === 0) {
        throw new Error('No se pudo leer la fila 152');
    }

    const r = row152Before[0];
    const legajo = r[0] || '(Sin legajo)';
    const nombre = r[1];
    console.log(`   • Legajo: ${legajo}`);
    console.log(`   • Nombre: ${nombre}`);

    if (!String(nombre).toUpperCase().includes('MONTESINO')) {
        throw new Error(`La fila 152 no corresponde a Montesino (Nombre encontrado: "${nombre}"). Abortando para seguridad.`);
    }

    const dias1a11 = r.slice(4, 15);
    const dias12a31 = r.slice(15, 35);
    console.log(`   • Días 1..11 (Cols E..O):`, JSON.stringify(dias1a11));
    console.log(`   • Días 12..31 (Cols P..AI con guiones):`, JSON.stringify(dias12a31));

    // 2. Ejecutar limpieza quirúrgica en P152:AI152 (días 12 al 31)
    console.log(`\n2. Ejecutando actualización en Google Sheets (Nov-26!P152:AI152 con celdas vacías)...`);
    const empty20Days = new Array(20).fill('');
    const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${ID_SPREADSHEET_DIAGRAMAS}/values/'Nov-26'!P152:AI152?valueInputOption=USER_ENTERED`;
    
    const updateRes = await auth.request({
        url: updateUrl,
        method: 'PUT',
        data: {
            range: "'Nov-26'!P152:AI152",
            majorDimension: 'ROWS',
            values: [empty20Days]
        }
    });

    console.log(`   • Celdas actualizadas: ${updateRes.data.updatedCells}`);

    // 3. Verificación posterior de Fila 152
    console.log(`\n3. Verificando Fila 152 tras la limpieza...`);
    const row152After = await fetchRange(ID_SPREADSHEET_DIAGRAMAS, "'Nov-26'!A152:AI152");
    const rAfter = row152After[0];
    const dias1a11After = rAfter.slice(4, 15);
    const dias12a31After = rAfter.slice(15, 35);

    console.log(`   • Días 1..11 tras limpieza:`, JSON.stringify(dias1a11After));
    console.log(`   • Días 12..31 tras limpieza:`, JSON.stringify(dias12a31After));

    const allDays1to11Match = JSON.stringify(dias1a11) === JSON.stringify(dias1a11After);
    const allCleaned = dias12a31After.every(d => !d || d === '');

    if (!allDays1to11Match) {
        throw new Error('❌ ALERTA: Los días 1 a 11 sufrieron cambios inesperados.');
    }
    if (!allCleaned) {
        throw new Error('❌ ALERTA: Aún quedan caracteres en los días 12 a 31.');
    }
    console.log(`   ✅ Días 1..11 preservados 100% idénticos.`);
    console.log(`   ✅ Días 12..31 totalmente limpios (0 guiones).`);

    console.log(`\n🎉 Operación completada con éxito para MONTESINO JAVIER ELISEO.`);
}

main().catch(err => {
    console.error(`\n❌ Error en la ejecución:`, err.message);
    process.exit(1);
});
