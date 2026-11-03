import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Config unica del frontend (eor_v1).
// - Local: Vite sirve en FRONT_PORT (default 3000) y proxya /api y /socket.io al backend (BACKEND_URL).
// - Render Static Site: `npm ci && npm run build` -> dist/. VITE_API_URL apunta al backend en Render.
// Las variables se leen del .env de la raiz del proyecto; solo las VITE_* llegan al navegador.
export default defineConfig(({ mode }) => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const env = loadEnv(mode, rootDir, '');
  const port = parseInt(env.FRONT_PORT || '3000', 10);
  const backend = env.BACKEND_URL || 'http://localhost:3005';

  return {
    plugins: [react()],
    envDir: rootDir,
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    publicDir: false,
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      proxy: {
        '/api': backend,
        '/socket.io': {
          target: backend,
          ws: true,
        },
      },
    },
    preview: {
      port,
      strictPort: true,
    },
  };
});
