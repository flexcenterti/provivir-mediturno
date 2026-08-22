import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**', '**/dist-esm/**', '**/node_modules/**', '**/coverage/**', '**/.pgdata/**',
      'docs/**', 'despliegue/web/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // El seed, los scripts de arranque y los CLI reportan por consola a propósito:
    // su salida ES la interfaz, no un rastro de depuración olvidado.
    files: ['apps/api/prisma/seed.ts', 'apps/api/scripts/**/*.ts', 'apps/api/src/cli/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // El script de carga corre dentro de k6, no en Node: tiene sus propias globales.
    files: ['apps/api/carga/**/*.js'],
    languageOptions: { globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly' } },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_|^datos$' }] },
  },
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    languageOptions: { globals: { describe: 'readonly', it: 'readonly', expect: 'readonly', beforeAll: 'readonly', afterAll: 'readonly', beforeEach: 'readonly', afterEach: 'readonly', jest: 'readonly' } },
  },
);
