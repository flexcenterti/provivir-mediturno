import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    // Evita CORS en desarrollo: el front habla con /api del mismo origen.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      // Los llamados de turno llegan por WebSocket (RN-11).
      '/tiempo-real': { target: 'http://localhost:3000', ws: true, changeOrigin: true },
    },
  },
});
