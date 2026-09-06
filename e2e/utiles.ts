import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const RAIZ = resolve(__dirname, '..');

/** Base propia para las pruebas: crean citas y no deben ensuciar la de desarrollo. */
export const BASE_E2E = 'provivir_e2e';

/**
 * Lee apps/api/.env sin depender de dotenv. La API valida su entorno al arrancar,
 * así que hay que pasarle todo, no solo la URL de la base.
 */
export function entornoApi(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const linea of readFileSync(resolve(RAIZ, 'apps/api/.env'), 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(linea.trim());
    if (m) env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }

  const url = env.DATABASE_URL;
  if (!url) throw new Error('apps/api/.env no define DATABASE_URL');
  env.DATABASE_URL = url.replace(/\/[^/?]+(\?|$)/, `/${BASE_E2E}$1`);

  // Salvaguarda: el arranque hace `migrate reset`, que BORRA la base entera. Si
  // la sustitución fallara y quedara apuntando a la de desarrollo, se perdería
  // todo sin aviso. Más vale no arrancar.
  if (!new RegExp(`/${BASE_E2E}(\\?|$)`).test(env.DATABASE_URL)) {
    throw new Error(`La URL de pruebas no apunta a ${BASE_E2E}. Se aborta antes de borrar nada.`);
  }

  // Las pruebas hacen muchas peticiones seguidas desde una sola IP; con los
  // límites de producción el propio limitador haría fallar la suite.
  env.THROTTLE_LIMIT = '10000';
  env.THROTTLE_LOGIN_LIMIT = '1000';
  return env;
}

/** Credenciales que crea el seed. Solo existen en desarrollo y pruebas. */
export const ADMIN = { email: 'admin@provivir.local', password: 'Provivir2026!' };

/** Perfil Asistente: sin auditoría, carga masiva, catálogo ni reglas del sistema. */
export const ASISTENTE = { email: 'asistente@provivir.local', password: 'Provivir2026!' };

/** Rol médico CON ficha (`ao`): es lo que decide si ve su cola o la sala (RN-06.2). */
export const MEDICO = { email: 'osorio@provivir.local', password: 'Provivir2026!' };

/** Paciente del seed: documento y últimos 4 de su teléfono (+57 300 111 1111). */
export const PACIENTE = { documento: '12345678', ultimos4: '1111', nombre: 'Carlos' };

/**
 * El próximo lunes en la zona de la sede. Las agendas del seed son de lunes a
 * sábado por la mañana; usar "hoy" haría que la prueba fallara según la hora a
 * la que se ejecute, porque los cupos pasados no se ofrecen.
 */
/** RN-04.6 · mañana en la zona de la sede: la primera fecha que el portal ofrece. */
export function manana(): string {
  const hoy = new Date(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()) + 'T12:00:00Z');
  hoy.setUTCDate(hoy.getUTCDate() + 1);
  return hoy.toISOString().slice(0, 10);
}

export function proximoLunes(): string {
  const hoy = new Date(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()) + 'T12:00:00Z');
  const faltan = ((8 - hoy.getUTCDay()) % 7) || 7;
  hoy.setUTCDate(hoy.getUTCDate() + faltan);
  return hoy.toISOString().slice(0, 10);
}

/**
 * RN-04.8 · Fija parámetros de configuración por API, como administrador.
 *
 * Las pruebas de navegador comparten una sola base y corren con `workers: 1`, así que
 * esto es seguro; lo que no lo sería es dejarlo cambiado, porque el siguiente proyecto
 * hereda el estado. Cada prueba que lo use restaura al terminar.
 */
export async function fijarConfig(
  request: import('@playwright/test').APIRequestContext,
  valores: Record<string, string>,
): Promise<void> {
  const login = await request.post('http://localhost:3000/api/auth/login', { data: ADMIN });
  const { token } = await login.json();
  for (const [clave, valor] of Object.entries(valores)) {
    const r = await request.put(`http://localhost:3000/api/configuracion/${clave}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { valor },
    });
    // Sin esto, un valor rechazado por el validador dejaría la prueba corriendo contra
    // la configuración anterior y pasando por el motivo equivocado.
    if (!r.ok()) throw new Error(`No se pudo fijar ${clave}: ${r.status()} ${await r.text()}`);
  }
}

/** El interruptor apagado: el comportamiento anterior a RN-04.8. */
export const SIN_VENTANA = { autoagendamiento_ventana_activa: 'false' };

/**
 * Dentro de tres días, en la zona de la sede.
 *
 * Es la fecha que hace determinista la ventana: con las siete filas puestas a ese mismo
 * día de la semana, la ventana es exactamente ese día, sea cual sea el día en que corra
 * la suite. Y nunca coincide con «mañana», que es lo que el `min` tenía cableado.
 */
export function enTresDias(): string {
  const hoy = new Date(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()) + 'T12:00:00Z');
  hoy.setUTCDate(hoy.getUTCDate() + 3);
  return hoy.toISOString().slice(0, 10);
}

/** Las siete filas apuntando al mismo día de la semana: la ventana es un solo día. */
export function ventanaDeUnSoloDia(iso: string): string {
  const dia = ((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  return [1, 2, 3, 4, 5, 6, 7].map((d) => `${d}:${dia}-${dia}`).join(',');
}
