import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Evita CORS en desarrollo: el front habla con /api del mismo origen.
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
});
