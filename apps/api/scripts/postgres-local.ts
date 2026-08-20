/**
 * Postgres local SIN Docker, para máquinas donde no hay demonio disponible.
 * Usa los binarios reales de PostgreSQL 16 que trae `embedded-postgres`,
 * la misma major que `postgres:16-alpine` del docker-compose y que producción.
 *
 * Donde SÍ haya Docker, el camino normal sigue siendo `docker compose up -d`.
 *
 * Uso:  npm run db:local -w @provivir/api
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR_DATOS = resolve(import.meta.dirname, '../.pgdata');
const PUERTO = Number(process.env.PG_LOCAL_PORT ?? 5432);

async function main(): Promise<void> {
  const yaInicializado = existsSync(resolve(DIR_DATOS, 'PG_VERSION'));

  const pg = new EmbeddedPostgres({
    databaseDir: DIR_DATOS,
    user: 'provivir',
    password: 'provivir',
    port: PUERTO,
    persistent: true,
  });

  if (!yaInicializado) {
    console.log('Inicializando cluster en .pgdata …');
    await pg.initialise();
  }

  await pg.start();
  console.log(`PostgreSQL escuchando en localhost:${PUERTO}`);

  if (!yaInicializado) {
    await pg.createDatabase('provivir');
    console.log('Base de datos "provivir" creada.');
  }

  const apagar = async (senal: string) => {
    console.log(`\n${senal} · deteniendo PostgreSQL …`);
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void apagar('SIGINT'));
  process.on('SIGTERM', () => void apagar('SIGTERM'));

  console.log('Ctrl-C para detener.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
