'use strict';

const path = require('path');
const fs = require('fs');
const stream = require('stream');
const { google } = require('googleapis');

const DRIVE_FOLDER_ID = '18E_m8Ye5dp5xv2oCmYhEm8Ts7eeA7y8-';
const STATE_FILENAME = 'pintardispo.json';
const LOCAL_CACHE_DIR = path.join(__dirname, 'cache_drive_states');
const LOCAL_CACHE_FILE = path.join(LOCAL_CACHE_DIR, 'pintardispo.json');

if (!fs.existsSync(LOCAL_CACHE_DIR)) {
  fs.mkdirSync(LOCAL_CACHE_DIR, { recursive: true });
}

async function getAuthClient() {
  const scopes = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive'
  ];

  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_CREDENTIALS_JSON;
  if (rawJson && rawJson.trim()) {
    let jsonStr = rawJson.trim();
    if (!jsonStr.startsWith('{')) {
      jsonStr = Buffer.from(jsonStr, 'base64').toString('utf8');
    }
    const credentials = JSON.parse(jsonStr);
    const auth = new google.auth.GoogleAuth({ credentials, scopes });
    return await auth.getClient();
  }

  const keyCandidates = [
    path.join(__dirname, 'ute-logistica-key.json'),
    path.join(__dirname, 'credentials.json')
  ];

  for (const k of keyCandidates) {
    if (fs.existsSync(k)) {
      const auth = new google.auth.GoogleAuth({ keyFile: k, scopes });
      return await auth.getClient();
    }
  }

  throw new Error('No se encontró archivo de credenciales de Google Service Account.');
}

async function getDriveClient(client) {
  const authClient = client || await getAuthClient();
  return google.drive({ version: 'v3', auth: authClient });
}

let cachedFileId = null;

async function findOrCreateDriveFile(drive) {
  if (cachedFileId) return cachedFileId;

  const query = `'${DRIVE_FOLDER_ID}' in parents and name = '${STATE_FILENAME}' and trashed = false`;
  const res = await drive.files.list({
    q: query,
    spaces: 'drive',
    fields: 'files(id, name, mimeType, size)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });

  const files = res.data.files || [];
  if (files.length > 0) {
    cachedFileId = files[0].id;
    return cachedFileId;
  }

  // Si no existe, crearlo
  const fileMeta = {
    name: STATE_FILENAME,
    parents: [DRIVE_FOLDER_ID],
    mimeType: 'application/json'
  };
  const createRes = await drive.files.create({
    requestBody: fileMeta,
    fields: 'id, name'
  });

  cachedFileId = createRes.data.id;
  return cachedFileId;
}

async function leerEstadoDrive(drive) {
  try {
    const fileId = await findOrCreateDriveFile(drive);
    const res = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'text' }
    );

    if (res.data && typeof res.data === 'string' && res.data.trim().length > 0) {
      const parsed = JSON.parse(res.data);
      // Guardar espejo local en cache
      fs.writeFileSync(LOCAL_CACHE_FILE, JSON.stringify(parsed, null, 2), 'utf8');
      return parsed;
    }
  } catch (err) {
    console.warn(`⚠️ Error leyendo ${STATE_FILENAME} de Drive (${err.message}). Intentando cache local...`);
  }

  if (fs.existsSync(LOCAL_CACHE_FILE)) {
    try {
      const raw = fs.readFileSync(LOCAL_CACHE_FILE, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.warn(`⚠️ Error leyendo cache local de ${STATE_FILENAME}:`, e.message);
    }
  }

  return null;
}

async function guardarEstadoDrive(drive, stateData) {
  // 1. Guardar primero en cache local inmediatamente
  try {
    fs.writeFileSync(LOCAL_CACHE_FILE, JSON.stringify(stateData, null, 2), 'utf8');
  } catch (e) {
    console.warn(`⚠️ Error guardando cache local: ${e.message}`);
  }

  // 2. Subir a Google Drive
  try {
    const fileId = await findOrCreateDriveFile(drive);
    const jsonStr = JSON.stringify(stateData, null, 2);
    const bufferStream = new stream.PassThrough();
    bufferStream.end(Buffer.from(jsonStr, 'utf8'));

    await drive.files.update({
      fileId,
      media: {
        mimeType: 'application/json',
        body: bufferStream
      },
      supportsAllDrives: true
    });
    return true;
  } catch (err) {
    console.error(`❌ Error actualizando ${STATE_FILENAME} en Drive: ${err.message}`);
    return false;
  }
}

module.exports = {
  getAuthClient,
  getDriveClient,
  leerEstadoDrive,
  guardarEstadoDrive,
  LOCAL_CACHE_FILE,
  DRIVE_FOLDER_ID,
  STATE_FILENAME
};
