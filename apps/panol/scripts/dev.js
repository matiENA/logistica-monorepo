/**
 * Runner unificado para desarrollo local:
 * Inicia concurrentemente:
 *   - [FRONTEND] Servidor estático en http://localhost:5173
 *   - [BACKEND]  Servidor Node.js API en http://localhost:3000
 */

const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

console.log('================================================================');
console.log('🚀 Iniciando Entorno de Desarrollo Local Pañol Logistics');
console.log('   - Frontend: http://localhost:5173 (Static Service)');
console.log('   - Backend:  http://localhost:5000 (Web Service API)');
console.log('================================================================\n');

// 1. Iniciar Frontend (Vite)
const frontProcess = spawn('npm', ['run', 'dev', '--prefix', 'frontend'], {
  cwd: rootDir,
  shell: true,
  stdio: 'pipe'
});

frontProcess.stdout.on('data', (data) => {
  const lines = data.toString().trim().split('\n');
  lines.forEach(l => console.log(`[FRONT :5173] ${l}`));
});

frontProcess.stderr.on('data', (data) => {
  const lines = data.toString().trim().split('\n');
  lines.forEach(l => console.error(`[FRONT :5173 ERR] ${l}`));
});

// 2. Iniciar Backend
const backProcess = spawn('node', ['--watch', 'backend/index.js'], {
  cwd: rootDir,
  shell: true,
  stdio: 'pipe'
});

backProcess.stdout.on('data', (data) => {
  const lines = data.toString().trim().split('\n');
  lines.forEach(l => console.log(`[BACK  :5000] ${l}`));
});

backProcess.stderr.on('data', (data) => {
  const lines = data.toString().trim().split('\n');
  lines.forEach(l => console.error(`[BACK  :5000 ERR] ${l}`));
});

// Manejo de salida / Ctrl+C
function cleanup() {
  console.log('\n🛑 Deteniendo procesos de desarrollo...');
  try { frontProcess.kill(); } catch (e) {}
  try { backProcess.kill(); } catch (e) {}
  process.exit();
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
