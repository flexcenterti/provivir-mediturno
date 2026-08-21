import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { entornoApi, RAIZ } from './utiles';

const env = entornoApi();

/**
 * Pruebas de navegador · Guía §Fase 3.
 *
 * Levanta la API y los tres frontends contra una base propia (provivir_e2e), que
 * se recrea desde cero en cada corrida. Cada app tiene su puerto y su `base`, así
 * que va en un proyecto aparte con su propia URL.
 *
 *   npm run e2e            todo
 *   npm run e2e -- --project=portal
 *   npm run e2e -- --headed --project=portal    para verlas correr
 */
export default defineConfig({
  testDir: __dirname,
  // Las pruebas comparten una sola base: en paralelo se pisarían los cupos.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  // Nunca se reutiliza un servidor existente: una corrida que falla a medias deja
  // procesos de vite huérfanos, y heredarlos hace que el puerto lo atienda otra
  // app. Se paga medio minuto de arranque a cambio de que la suite sea honesta.
  use: {
    // Solo se guardan de lo que falla: si todo pasa, no hay nada que mirar.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
  },

  projects: [
    { name: 'portal',     testMatch: 'portal.spec.ts',     // Nunca se reutiliza un servidor existente: una corrida que falla a medias deja
  // procesos de vite huérfanos, y heredarlos hace que el puerto lo atienda otra
  // app. Se paga medio minuto de arranque a cambio de que la suite sea honesta.
  use: { baseURL: 'http://localhost:5174/citas/' } },
    { name: 'backoffice', testMatch: 'backoffice.spec.ts', use: { baseURL: 'http://localhost:5173/' } },
    { name: 'tv',         testMatch: 'tv.spec.ts',         // Nunca se reutiliza un servidor existente: una corrida que falla a medias deja
  // procesos de vite huérfanos, y heredarlos hace que el puerto lo atienda otra
  // app. Se paga medio minuto de arranque a cambio de que la suite sea honesta.
  use: { baseURL: 'http://localhost:5175/tv/' } },
  ],

  webServer: [
    {
      // La base se recrea AQUÍ y no en un globalSetup: Playwright arranca los
      // webServer antes del globalSetup, así que la API encontraba una base que
      // todavía no existía. `migrate reset` la deja migrada y con el seed.
      //
      // Se compila antes de arrancar: `nest start --watch` tarda en quedar listo
      // y recompila a mitad de la suite si alguien toca un archivo.
      command: 'npx prisma migrate reset --force --skip-generate && npm run build --silent && node dist/main.js',
      cwd: resolve(RAIZ, 'apps/api'),
      url: 'http://localhost:3000/api/health',
      env,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: 'npm run dev -w @provivir/portal',
      cwd: RAIZ,
      url: 'http://localhost:5174/citas/',
      timeout: 60_000,
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -w @provivir/backoffice',
      cwd: RAIZ,
      url: 'http://localhost:5173/',
      timeout: 60_000,
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -w @provivir/tv',
      cwd: RAIZ,
      url: 'http://localhost:5175/tv/',
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
