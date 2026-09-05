import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PUBLICA ?? '/',
  server: {
    port: 5173,
    // Sin esto vite se muda a otro puerto en silencio cuando el suyo está ocupado,
    // y lo que responde en 5173 pasa a ser otra app. Se descubre tarde y mal.
    strictPort: true,
    // Evita CORS en desarrollo: el front habla con /api del mismo origen.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      // El pulso de la bandeja (RN-08.3). Sin esta entrada tampoco refrescaba en vivo
      // en desarrollo, y por eso el defecto llegó a producción sin que nadie lo viera.
      '/tiempo-real': { target: 'http://localhost:3000', ws: true, changeOrigin: true },
    },
  },
});
