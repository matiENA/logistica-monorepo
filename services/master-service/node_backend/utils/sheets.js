const { JWT } = require('google-auth-library');

const mesesAbrev = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const mesesLargo = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

let serviceAccountAuth = null;

function getAuthClient() {
    if (!serviceAccountAuth) {
        let email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        let key = process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';

        if ((!email || !key) && process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
            try {
                const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
                email = email || parsed.client_email;
                key = key || (parsed.private_key ? parsed.private_key.replace(/\\n/g, '\n') : '');
            } catch (e) {
                console.warn('⚠️ No se pudo parsear GOOGLE_SERVICE_ACCOUNT_JSON en sheets.js:', e.message);
            }
        }

        if (!email || !key) {
            throw new Error('Faltan variables de autenticación de Google (GOOGLE_SERVICE_ACCOUNT_EMAIL/KEY o GOOGLE_SERVICE_ACCOUNT_JSON)');
        }

        serviceAccountAuth = new JWT({
            email,
            key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
    }
    return serviceAccountAuth;
}

async function fetchRange(spreadsheetId, range, retries = 3, delay = 1500) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const auth = getAuthClient();
            const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
            const res = await auth.request({ url });
            return res.data.values || [];
        } catch (err) {
            if (attempt === retries) throw err;
            console.warn(`   ⚠️ Reintentando lectura de Google Sheets (${attempt}/${retries}): ${err.message}`);
            await new Promise(resolve => setTimeout(resolve, delay * attempt));
        }
    }
}

async function getSheetTitles(spreadsheetId, retries = 3, delay = 1500) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const auth = getAuthClient();
            const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
            const res = await auth.request({ url });
            return (res.data.sheets || []).map(s => s.properties.title);
        } catch (err) {
            if (attempt === retries) throw err;
            console.warn(`   ⚠️ Reintentando títulos de Google Sheets (${attempt}/${retries}): ${err.message}`);
            await new Promise(resolve => setTimeout(resolve, delay * attempt));
        }
    }
}

function getFechaArgentina() {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
}

function parseFechaISO(str) {
    if (!str) return null;
    const s = String(str).trim();
    const parts = s.split(/[\/\-]/);
    if (parts.length === 3) {
        let y = parseInt(parts[2], 10);
        if (y < 100) y += 2000;
        const m = String(parseInt(parts[1], 10)).padStart(2, '0');
        const d = String(parseInt(parts[0], 10)).padStart(2, '0');
        if (!isNaN(y) && !isNaN(m) && !isNaN(d)) return `${y}-${m}-${d}`;
    }
    return null;
}

function normalizar(texto) {
    if (!texto) return '';
    return String(texto)
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Elimina acentos
        .replace(/\s+/g, ' ');           // Colapsa espacios múltiples
}

async function resolveTabNameMovimientos(spreadsheetId, fallbackName = "NOVIEMBRE 2026- Mov.Unidades y Choferes") {
    try {
        const titles = await getSheetTitles(spreadsheetId);
        const hoyAr = getFechaArgentina();
        const mesNombre = mesesLargo[hoyAr.getMonth()].toLowerCase();
        const mesAbrev = mesesAbrev[hoyAr.getMonth()].toLowerCase();

        // Busca coincidencia de mes actual + "mov"
        const foundCurrent = titles.slice().reverse().find(t => {
            const low = t.toLowerCase();
            return (low.includes(mesNombre) || low.includes(mesAbrev)) && low.includes('mov');
        });
        if (foundCurrent) return foundCurrent;

        // Fallback: última pestaña con "mov"
        const foundAnyMov = titles.slice().reverse().find(t => t.toLowerCase().includes('mov'));
        return foundAnyMov || fallbackName;
    } catch (err) {
        console.warn('⚠️ No se pudo resolver automáticamente la pestaña de Movimientos:', err.message);
        return fallbackName;
    }
}

async function resolveTabNameDiagramas(spreadsheetId, fallbackName = "Sep-26") {
    try {
        const titles = await getSheetTitles(spreadsheetId);
        const hoyAr = getFechaArgentina();
        const mesAbrev = mesesAbrev[hoyAr.getMonth()];
        const anioAbrev = String(hoyAr.getFullYear()).slice(-2);
        const expectedTab = `${mesAbrev}-${anioAbrev}`;

        const foundExact = titles.find(t => t.toLowerCase() === expectedTab.toLowerCase());
        if (foundExact) return foundExact;

        const foundPartial = titles.find(t => t.toLowerCase().includes(mesAbrev.toLowerCase()) && t.includes(anioAbrev));
        if (foundPartial) return foundPartial;

        return fallbackName;
    } catch (err) {
        console.warn('⚠️ No se pudo resolver automáticamente la pestaña de Diagramas:', err.message);
        return fallbackName;
    }
}

module.exports = {
    getAuthClient,
    fetchRange,
    getSheetTitles,
    getFechaArgentina,
    parseFechaISO,
    normalizar,
    resolveTabNameMovimientos,
    resolveTabNameDiagramas,
    mesesAbrev,
    mesesLargo
};
