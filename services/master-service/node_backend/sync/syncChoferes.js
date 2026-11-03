const { 
    normalizar, 
    fetchRango, 
    serviceAccountAuth, 
    ID_SPREADSHEET_MASTER,
    ID_SHEET_HABILITACIONES,
    ID_SHEET_DOCUMENTOS 
} = require('../utils/shared');

/**
 * Normaliza DNI eliminando cualquier caracter no numérico y ceros a la izquierda innecesarios.
 */
function normalizarDni(dni) {
    if (!dni) return '';
    const num = String(dni).replace(/\D/g, '');
    return num ? String(parseInt(num, 10)) : '';
}

/**
 * Normaliza CUIL eliminando guiones y espacios.
 */
function normalizarCuil(cuil) {
    if (!cuil) return '';
    return String(cuil).replace(/\D/g, '');
}

/**
 * Extrae DNI desde un string de CUIL (formato XX-XXXXXXXX-X).
 */
function extraerDniDeCuil(cuil) {
    const cClean = normalizarCuil(cuil);
    if (cClean.length >= 10) {
        const dniSub = cClean.substring(2, cClean.length - 1);
        return String(parseInt(dniSub, 10));
    }
    return '';
}

/**
 * Sincroniza las planillas externas (VENCIMIENTOS CONDUCTORES y Control Periódicos)
 * hacia la pestaña DB_CHOFERES en la planilla Master (1eQ9Y5diL5fwxYTxvseNgZJFbX-lSUQ13axbp3cLiqPc).
 */
async function sincronizarDbChoferesExterna() {
    console.log("🔄 INICIANDO SINCRONIZACIÓN DE PLANILLAS EXTERNAS A DB_CHOFERES...");

    try {
        // 1. Descargar en paralelo las 3 fuentes de datos
        const [rowsVenc, rowsPer, rowsDbExistente] = await Promise.all([
            fetchRango(ID_SHEET_HABILITACIONES, "'VENCIMIENTOS'!A5:E"),
            fetchRango(ID_SHEET_DOCUMENTOS, "'PERIODICOS'!A5:I"),
            fetchRango(ID_SPREADSHEET_MASTER, "'DB_CHOFERES'!A2:H")
        ]);

        console.log(`📊 Leídos: ${rowsVenc.length} en Vencimientos | ${rowsPer.length} en Periódicos | ${rowsDbExistente.length} en DB_CHOFERES actual.`);

        // Indexar VENCIMIENTOS por DNI y por Nombre Normalizado
        const mapVencPorDni = {};
        const mapVencPorNombre = {};

        rowsVenc.forEach(r => {
            const nomRaw = String(r[1] || '').trim();
            const dniRaw = String(r[2] || '').trim();
            if (!nomRaw && !dniRaw) return;

            const dniNorm = normalizarDni(dniRaw);
            const nomNorm = normalizar(nomRaw);

            const record = {
                nombre: nomRaw,
                dni: dniRaw,
                dniNorm: dniNorm,
                cursoMercancias: String(r[3] || '').trim(),
                licenciaConducir: String(r[4] || '').trim()
            };

            if (dniNorm) mapVencPorDni[dniNorm] = record;
            if (nomNorm) {
                mapVencPorNombre[nomNorm] = record;
                if (nomNorm.includes('ñ')) mapVencPorNombre[nomNorm.replace(/ñ/g, 'n')] = record;
            }
        });

        // Indexar PERIODICOS por CUIL, por DNI (extraído del CUIL) y por Nombre Normalizado
        const mapPerPorCuil = {};
        const mapPerPorDni = {};
        const mapPerPorNombre = {};

        rowsPer.forEach(r => {
            const nomRaw = String(r[1] || '').trim();
            const sectorRaw = String(r[2] || '').trim();
            const ingresoRaw = String(r[3] || '').trim();
            const cuilRaw = String(r[4] || '').trim();
            if (!nomRaw && !cuilRaw) return;

            const cuilNorm = normalizarCuil(cuilRaw);
            const dniExtraido = extraerDniDeCuil(cuilRaw);
            const nomNorm = normalizar(nomRaw);

            const record = {
                nombre: nomRaw,
                sector: sectorRaw,
                ingreso: ingresoRaw,
                cuil: cuilRaw,
                cuilNorm: cuilNorm,
                dniExtraido: dniExtraido,
                fechaNac: String(r[5] || '').trim(),
                ultimoExamen: String(r[7] || '').trim(),
                vencimiento: String(r[8] || '').trim()
            };

            if (cuilNorm) mapPerPorCuil[cuilNorm] = record;
            if (dniExtraido) mapPerPorDni[dniExtraido] = record;
            if (nomNorm) {
                mapPerPorNombre[nomNorm] = record;
                if (nomNorm.includes('ñ')) mapPerPorNombre[nomNorm.replace(/ñ/g, 'n')] = record;
            }
        });

        // Mapa de IDs existentes para preservar drv_XXXX
        const choferesMap = new Map();
        let maxIdNum = 0;

        // Cargar registros existentes en DB_CHOFERES
        rowsDbExistente.forEach(r => {
            const id = String(r[0] || '').trim();
            if (!id) return;

            const idMatch = id.match(/drv_(\d+)/i);
            if (idMatch) {
                const num = parseInt(idMatch[1], 10);
                if (num > maxIdNum) maxIdNum = num;
            }

            const nomVenc = String(r[1] || '').trim();
            const dniVal = String(r[2] || '').trim();
            const nomPer = String(r[3] || '').trim();
            const cuilVal = String(r[4] || '').trim();
            const nomDiag = String(r[5] || '').trim();
            const dniClean = String(r[6] || '').trim() || normalizarDni(dniVal) || extraerDniDeCuil(cuilVal);
            const passApp = String(r[7] || '').trim();

            choferesMap.set(id, {
                id: id,
                nombreVencimientos: nomVenc,
                dni: dniVal,
                nombrePeriodicos: nomPer,
                cuil: cuilVal,
                nombreDiagrama: nomDiag,
                dniClean: dniClean,
                passwordApp: passApp
            });
        });

        // Auxiliar para buscar/crear chofer por DNI/CUIL
        function findOrCreateChofer(dniNorm, cuilNorm, nomRef) {
            // Buscar por dniClean
            for (let [id, ch] of choferesMap.entries()) {
                if (dniNorm && ch.dniClean === dniNorm) return ch;
                if (cuilNorm && normalizarCuil(ch.cuil) === cuilNorm) return ch;
                if (nomRef && (normalizar(ch.nombreDiagrama) === normalizar(nomRef) || normalizar(ch.nombreVencimientos) === normalizar(nomRef))) return ch;
            }

            // Si no existe, crear nuevo registro con drv_XXXX secuencial
            maxIdNum++;
            const newId = `drv_${String(maxIdNum).padStart(4, '0')}`;
            const newCh = {
                id: newId,
                nombreVencimientos: '',
                dni: '',
                nombrePeriodicos: '',
                cuil: '',
                nombreDiagrama: nomRef || '',
                dniClean: dniNorm || '',
                passwordApp: (dniNorm && dniNorm.length >= 4) ? dniNorm.slice(-4) : '1234'
            };
            choferesMap.set(newId, newCh);
            return newCh;
        }

        // 2. Procesar registros de VENCIMIENTOS
        Object.values(mapVencPorDni).forEach(recVenc => {
            const dniNorm = recVenc.dniNorm;
            const recPer = mapPerPorDni[dniNorm] || mapPerPorNombre[normalizar(recVenc.nombre)];
            const cuilNorm = recPer ? recPer.cuilNorm : '';

            const ch = findOrCreateChofer(dniNorm, cuilNorm, recVenc.nombre);

            ch.nombreVencimientos = recVenc.nombre;
            if (recVenc.dni) ch.dni = recVenc.dni;
            ch.dniClean = dniNorm || ch.dniClean;
            if (!ch.nombreDiagrama) ch.nombreDiagrama = recVenc.nombre;

            if (recPer) {
                ch.nombrePeriodicos = recPer.nombre;
                ch.cuil = recPer.cuil;
            }

            if (!ch.passwordApp && ch.dniClean.length >= 4) {
                ch.passwordApp = ch.dniClean.slice(-4);
            }
        });

        // 3. Procesar registros de PERIODICOS (que pudieran no haber estado en Vencimientos)
        Object.values(mapPerPorCuil).forEach(recPer => {
            const dniNorm = recPer.dniExtraido;
            const cuilNorm = recPer.cuilNorm;

            const ch = findOrCreateChofer(dniNorm, cuilNorm, recPer.nombre);

            ch.nombrePeriodicos = recPer.nombre;
            ch.cuil = recPer.cuil;
            if (!ch.dniClean && dniNorm) ch.dniClean = dniNorm;
            if (!ch.nombreDiagrama) ch.nombreDiagrama = recPer.nombre;

            const recVenc = mapVencPorDni[dniNorm] || mapVencPorNombre[normalizar(recPer.nombre)];
            if (recVenc) {
                ch.nombreVencimientos = recVenc.nombre;
                if (recVenc.dni) ch.dni = recVenc.dni;
            }

            if (!ch.passwordApp && ch.dniClean.length >= 4) {
                ch.passwordApp = ch.dniClean.slice(-4);
            }
        });

        // 4. Construir matriz final para escribir en DB_CHOFERES
        const rowsFinales = Array.from(choferesMap.values()).map(ch => [
            ch.id,
            ch.nombreVencimientos || ch.nombreDiagrama || '',
            ch.dni || ch.dniClean || '',
            ch.nombrePeriodicos || ch.nombreDiagrama || '',
            ch.cuil || '',
            ch.nombreDiagrama || ch.nombreVencimientos || '',
            ch.dniClean || '',
            ch.passwordApp || (ch.dniClean.length >= 4 ? ch.dniClean.slice(-4) : '1234')
        ]);

        console.log(`📝 Escribiendo ${rowsFinales.length} choferes sincronizados en DB_CHOFERES...`);

        // Escribir la matriz completa en DB_CHOFERES de ID_SPREADSHEET_MASTER
        await serviceAccountAuth.request({
            url: `https://sheets.googleapis.com/v4/spreadsheets/${ID_SPREADSHEET_MASTER}/values/'DB_CHOFERES'!A2:H${rowsFinales.length + 1}?valueInputOption=USER_ENTERED`,
            method: 'PUT',
            data: { values: rowsFinales }
        });

        console.log("✅ Sincronización exitosa de DB_CHOFERES.");
        return {
            success: true,
            total_choferes: rowsFinales.length,
            vencimientos_procesados: rowsVenc.length,
            periodicos_procesados: rowsPer.length
        };

    } catch (error) {
        console.error("❌ Error en sincronización de DB_CHOFERES:", error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    sincronizarDbChoferesExterna,
    normalizarDni,
    normalizarCuil,
    extraerDniDeCuil
};
