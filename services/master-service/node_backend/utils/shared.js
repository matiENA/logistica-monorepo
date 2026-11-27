// ==============================================================
// 🔧 UTILIDADES COMPARTIDAS — Módulo Central
// ==============================================================
let WebSocketImpl;
try {
    WebSocketImpl = (typeof globalThis.WebSocket !== 'undefined') ? globalThis.WebSocket : require('ws');
    if (typeof globalThis.WebSocket === 'undefined') {
        globalThis.WebSocket = WebSocketImpl;
    }
} catch (e) {
    // ws package fallback
}

const fs = require('fs');
const path = require('path');
const { JWT } = require('google-auth-library');
const { createClient } = require('@supabase/supabase-js');

// ==============================================================
// 📝 Funciones de normalización y fecha
// ==============================================================
const normalizar = (n) => {
    if (!n) return '';
    return String(n)
        .normalize('NFC')
        .replace(/__N_TILDE__/gi, 'ñ')
        .trim()
        .toLowerCase()
        .replace(/[áäàâ]/g, 'a')
        .replace(/[éëèê]/g, 'e')
        .replace(/[íïìî]/g, 'i')
        .replace(/[óöòô]/g, 'o')
        .replace(/[úüùû]/g, 'u')
        .replace(/\s+/g, ' ');
};

function getFechaArgentina() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc - (3 * 3600000));
}

// ==============================================================
// 📅 Constantes de meses
// ==============================================================
const mesesAbrev = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const mesesLargo = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// ==============================================================
// 🔑 IDs de Google Spreadsheets
// ==============================================================
const ID_SPREADSHEET_MASTER = process.env.SPREADSHEET_ID || '1eQ9Y5diL5fwxYTxvseNgZJFbX-lSUQ13axbp3cLiqPc';
const ID_SPREADSHEET_DIAGRAMAS = process.env.ID_SPREADSHEET_DIAGRAMAS || '14jgQZF0gkbT7k3mps1k3dM3qtoaseoCOUfK4PFRozKU';
const ID_SHEET_OBSERVACIONES = '1VwCNK89ecaac7IDlMWWCLHRqZoch9HB6vop5AfQEaA0';
const ID_SHEET_APTOS_MEDICOS = '1oJmN8hurfHfNnGBYUFcBdlrIj2VUzeIyq0ZTWxTpYNI';
const ID_SHEET_KILOMETROS = process.env.ID_SHEET_KM || process.env.SHEET_KM_ID || '1TccPqkhXUa7W1uvd0xfKUinEEX_3_mgEgAhGQUwaT5U';
const TAB_SHEET_KILOMETROS = process.env.TAB_SHEET_KM || process.env.SHEET_KM_TAB || 'Reporte Novedades';
const ID_SHEET_HABILITACIONES = '1hPDno09tMBtKh7aIdsvzEYcyOY7leYj2B6XnniD0aXg';
const ID_SHEET_DOCUMENTOS = '1pnYXKDSv70Vq78Rchxus5FHMKdgXdbfltVsEg6vArjo';
const ID_SHEET_MOVIMIENTOS = process.env.ID_SHEET_MOVIMIENTOS || process.env.MES_MOVIMIENTOS_ID || '1z66kNDjMki1k9csQevuyhfz50dYoHrQro4wPj-Yt-hc';

// ==============================================================
// 🔄 Registro Calendario Auto-Cutover & Merge Virtual Movimientos
// ==============================================================
const FALLBACK_MESES_MOVIMIENTOS = {
    '2026-10': {
        nombre: 'Octubre 2026',
        movimientos_id: '14Mb5rD853zxDkaLDS-IrW-OBDTDBjuJxn_3olXeWlkc',
        tab_movimientos: 'OCTUBRE 2026- Mov.Unidades y Choferes'
    },
    '2026-11': {
        nombre: 'Noviembre 2026',
        movimientos_id: '1z66kNDjMki1k9csQevuyhfz50dYoHrQro4wPj-Yt-hc',
        tab_movimientos: 'NOVIEMBRE 2026- Mov.Unidades y Choferes'
    },
    '2026-12': {
        nombre: 'Diciembre 2026',
        movimientos_id: '14QpWY9KvOVj2Yinn5F1hOiSkTxASYwLc-Cd7F2rFO_k',
        tab_movimientos: 'DICIEMBRE 2026- Mov.Unidades y Choferes'
    }
};

function loadOperativasConfig() {
    const candidates = [
        path.join(__dirname, '../../python_engine/config_operativas.json'),
        path.join(process.cwd(), 'services/master-service/python_engine/config_operativas.json'),
        path.join(process.cwd(), '../python_engine/config_operativas.json')
    ];
    for (const cp of candidates) {
        try {
            if (fs.existsSync(cp)) {
                return JSON.parse(fs.readFileSync(cp, 'utf8'));
            }
        } catch (_) {}
    }
    return null;
}

function getMovimientosRegistry() {
    const ext = loadOperativasConfig();
    const meses = { ...FALLBACK_MESES_MOVIMIENTOS, ...(ext?.meses || {}) };
    const dualDays = Array.isArray(ext?.dias_dual_print_cruce)
        ? ext.dias_dual_print_cruce.map(Number).filter(Boolean)
        : [1, 2];
    return { meses, dualDays, ext };
}

function ymKey(year, month) {
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function getActiveMovimientosConfig(dateObj = null) {
    const d = dateObj || getFechaArgentina();
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const { meses } = getMovimientosRegistry();
    const found = meses[ymKey(year, month)];
    if (found && found.movimientos_id) {
        return {
            id: found.movimientos_id,
            tabName: found.tab_movimientos || `${mesesLargo[month - 1].toUpperCase()} ${year}- Mov.Unidades y Choferes`,
            nombre: found.nombre || `${mesesLargo[month - 1]} ${year}`,
            year,
            month
        };
    }
    return {
        id: ID_SHEET_MOVIMIENTOS,
        tabName: process.env.TAB_MOVIMIENTOS || `${mesesLargo[month - 1].toUpperCase()} ${year}- Mov.Unidades y Choferes`,
        nombre: `${mesesLargo[month - 1]} ${year}`,
        year,
        month
    };
}

function getTargetMovimientosSheetsForDate(dateObj = null) {
    const d = dateObj || getFechaArgentina();
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const { meses, dualDays } = getMovimientosRegistry();

    const targets = [];
    const seen = new Set();
    const primary = getActiveMovimientosConfig(d);
    if (primary && primary.id) {
        targets.push({ role: 'primary', ...primary });
        seen.add(primary.id);
    }

    if (dualDays.includes(day)) {
        const prevY = month === 1 ? year - 1 : year;
        const prevM = month === 1 ? 12 : month - 1;
        const prevEntry = meses[ymKey(prevY, prevM)];
        if (prevEntry && prevEntry.movimientos_id && !seen.has(prevEntry.movimientos_id)) {
            targets.push({
                role: 'bridge_tail',
                id: prevEntry.movimientos_id,
                tabName: prevEntry.tab_movimientos || `${mesesLargo[prevM - 1].toUpperCase()} ${prevY}- Mov.Unidades y Choferes`,
                nombre: prevEntry.nombre || `${mesesLargo[prevM - 1]} ${prevY}`,
                year: prevY,
                month: prevM
            });
            seen.add(prevEntry.movimientos_id);
        }
    }

    return targets;
}

function parseHeaderDateToYMD(str) {
    if (!str) return null;
    const clean = String(str).toLowerCase().replace(/\s+/g, ' ').trim();
    const matchWord = clean.match(/\b(\d{1,2})(?:\s+de\s+|[\s/\-]+)([a-záéíóú]+)(?:\s+de\s+|[\s/\-]+)(\d{2,4})\b/);
    if (matchWord) {
        const day = parseInt(matchWord[1], 10);
        const mStr = matchWord[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        let monthIdx = mesesAbrev.map(m => m.toLowerCase()).indexOf(mStr.substring(0, 3));
        if (monthIdx === -1) monthIdx = mesesLargo.map(m => m.toLowerCase()).indexOf(mStr);
        let year = parseInt(matchWord[3], 10);
        if (year < 100) year += 2000;
        if (monthIdx !== -1 && day >= 1 && day <= 31) {
            return { year, month: monthIdx + 1, day };
        }
    }
    const matchSlash = clean.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    if (matchSlash) {
        const day = parseInt(matchSlash[1], 10);
        const month = parseInt(matchSlash[2], 10);
        let year = parseInt(matchSlash[3], 10);
        if (year < 100) year += 2000;
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return { year, month, day };
        }
    }
    return null;
}

// ==============================================================
// 🔐 Instancias de autenticación
// ==============================================================
let saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
let saKey = process.env.GOOGLE_PRIVATE_KEY;

if ((!saEmail || !saKey) && process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
        const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
        saEmail = saEmail || parsed.client_email;
        saKey = saKey || parsed.private_key;
    } catch (e) {
        console.warn('?? No se pudo parsear GOOGLE_SERVICE_ACCOUNT_JSON en shared.js:', e.message);
    }
}

const serviceAccountAuth = (saEmail && saKey) ? new JWT({
    email: saEmail,
    key: saKey.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
}) : null;

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) 
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
        auth: { persistSession: false },
        realtime: {
            transport: WebSocketImpl
        }
    }) 
    : null;

// ==============================================================
// 📡 Helpers de Google Sheets (Opcionales si hay credenciales)
// ==============================================================
async function fetchRango(spreadsheetId, rango, reintentos = 3) {
    if (!serviceAccountAuth) return [];
    for (let i = 0; i < reintentos; i++) {
        try {
            return (await serviceAccountAuth.request({
                url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(rango)}`
            })).data.values || [];
        } catch (e) {
            if (e.response && e.response.status === 429) {
                await new Promise(resolve => setTimeout(resolve, (i + 1) * 1500));
            } else {
                return [];
            }
        }
    }
    return [];
}

async function getTabName(spreadsheetId, keyword, defaultName) {
    try {
        const resMeta = await serviceAccountAuth.request({
            url: `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`
        });
        const sheets = (resMeta.data.sheets || []).map(s => s.properties.title);
        if (!sheets || sheets.length === 0) return defaultName;

        let hoyAr = getFechaArgentina();
        let mesNombre = mesesLargo[hoyAr.getMonth()].toLowerCase();
        let mesAbrev = mesesAbrev[hoyAr.getMonth()].toLowerCase();
        const normKw = keyword.toLowerCase().replace(/\s+/g, '');

        // Prioridad 1: Pestaña del mes actual que contenga el keyword
        let foundCurrent = sheets.slice().reverse().find(s => {
            let low = s.toLowerCase();
            return (low.includes(mesNombre) || low.includes(mesAbrev)) && low.replace(/\s+/g, '').includes(normKw);
        });
        if (foundCurrent) return foundCurrent;

        // Prioridad 2: Última pestaña que contenga el keyword
        let foundLast = sheets.slice().reverse().find(s => s.toLowerCase().replace(/\s+/g, '').includes(normKw));
        if (foundLast) return foundLast;

        // Prioridad 3: Fallback para "mov"
        if (normKw.includes("mov")) {
            let foundMov = sheets.slice().reverse().find(s => s.toLowerCase().includes("mov"));
            if (foundMov) return foundMov;
        }

        return sheets[0] || defaultName;
    } catch (e) {
        return defaultName;
    }
}

// ==============================================================
// 📦 Exports
// ==============================================================
module.exports = {
    // Funciones
    normalizar,
    getFechaArgentina,
    fetchRango,
    getTabName,
    // Constantes de meses
    mesesAbrev,
    mesesLargo,
    // IDs de planillas
    ID_SPREADSHEET_MASTER,
    ID_SPREADSHEET_DIAGRAMAS,
    ID_SHEET_OBSERVACIONES,
    ID_SHEET_APTOS_MEDICOS,
    ID_SHEET_KILOMETROS,
    TAB_SHEET_KILOMETROS,
    ID_SHEET_HABILITACIONES,
    ID_SHEET_DOCUMENTOS,
    ID_SHEET_MOVIMIENTOS,
    getActiveMovimientosConfig,
    getTargetMovimientosSheetsForDate,
    parseHeaderDateToYMD,
    // Instancias de auth
    serviceAccountAuth,
    supabase
};
