import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

function devEntryRewritePlugin(): Plugin {
  return {
    name: 'dev-entry-rewrite',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url || '';
        if (url === '/qr' || url.startsWith('/qr/') || url.startsWith('/qr?')) {
          req.url = '/qr.html';
        } else if (
          url === '/taller' ||
          url.startsWith('/taller/') ||
          url.startsWith('/taller?') ||
          url === '/login' ||
          url.startsWith('/login/')
        ) {
          req.url = '/taller.html';
        } else if (
          url === '/' ||
          url === '/coordinacion' ||
          url.startsWith('/coordinacion/') ||
          url.startsWith('/coordinacion?')
        ) {
          req.url = '/coordinacion.html';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devEntryRewritePlugin()],
  server: {
    port: 5173,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        taller: path.resolve(__dirname, 'taller.html'),
        coordinacion: path.resolve(__dirname, 'coordinacion.html'),
        qr: path.resolve(__dirname, 'qr.html'),
      },
    },
  },
});
