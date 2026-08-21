import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // En producción esta app se sirve bajo una subruta del dominio único, así que
  // los assets deben resolverse relativos a ella. En desarrollo vive en la raíz
  // de su propio puerto, por eso el valor es configurable.
  base: process.env.BASE_PUBLICA ?? '/tv/',
  server: {
    port: 5175,
    // Sin esto vite se muda a otro puerto en silencio cuando el suyo está ocupado,
    // y lo que responde en 5175 pasa a ser otra app. Se descubre tarde y mal.
    strictPort: true,
    // Evita CORS en desarrollo: el front habla con /api del mismo origen.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      // Los llamados de turno llegan por WebSocket (RN-11).
      '/tiempo-real': { target: 'http://localhost:3000', ws: true, changeOrigin: true },
    },
  },
});
