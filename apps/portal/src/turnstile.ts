/**
 * CAPTCHA del portal público (Cloudflare Turnstile).
 *
 * El portal agenda citas sin autenticación: sin esto, un bot puede tantear
 * documentos de pacientes contra /identificar o llenar la agenda de citas falsas.
 *
 * Sin `VITE_TURNSTILE_SITE_KEY` en el build, todo esto queda inerte y el portal
 * funciona igual que antes. El backend hace lo simétrico: sin TURNSTILE_SECRET no
 * exige token. Las dos mitades deben configurarse a la vez — con una sola, el
 * portal responde "Verificación de seguridad fallida" en cada intento.
 */

interface Turnstile {
  render(el: HTMLElement, opciones: Record<string, unknown>): string;
  execute(id: string): void;
  reset(id: string): void;
}
declare global {
  interface Window { turnstile?: Turnstile }
}

const CLAVE_SITIO = import.meta.env.VITE_TURNSTILE_SITE_KEY;

/** El token caduca y es de un solo uso, así que se pide uno por operación. */
const ESPERA_MAX_MS = 30_000;

let carga: Promise<void> | undefined;
let idWidget: string | undefined;
let pendiente: { ok: (t: string) => void; falla: (e: Error) => void } | undefined;

function cargarScript(): Promise<void> {
  carga ??= new Promise<void>((ok, falla) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => falla(new Error('No se pudo cargar la verificación de seguridad'));
    document.head.appendChild(s);
  });
  return carga;
}

function resolver(token: string): void {
  pendiente?.ok(token);
  pendiente = undefined;
}
function rechazar(mensaje: string): void {
  pendiente?.falla(new Error(mensaje));
  pendiente = undefined;
}

async function preparar(): Promise<string> {
  await cargarScript();
  if (idWidget !== undefined) return idWidget;

  // El contenedor va en el DOM y visible: con `interaction-only` no ocupa espacio
  // salvo que Cloudflare decida retar al visitante, y entonces tiene que verse.
  // Ocultarlo dejaría al paciente ante un reto invisible e irresoluble.
  const caja = document.createElement('div');
  caja.className = 'captcha';
  document.body.appendChild(caja);

  idWidget = window.turnstile!.render(caja, {
    sitekey: CLAVE_SITIO,
    appearance: 'interaction-only',
    execution: 'execute',
    language: 'es',
    callback: resolver,
    'error-callback': () => { rechazar('La verificación de seguridad falló. Inténtalo de nuevo.'); return true; },
    'expired-callback': () => rechazar('La verificación de seguridad expiró. Inténtalo de nuevo.'),
    'timeout-callback': () => rechazar('La verificación de seguridad tardó demasiado.'),
  });
  return idWidget;
}

/** Devuelve un token fresco, o `undefined` si el CAPTCHA no está configurado. */
export async function tokenCaptcha(): Promise<string | undefined> {
  if (!CLAVE_SITIO) return undefined;

  const id = await preparar();
  // Un token ya usado no sirve: se reinicia antes de cada operación.
  window.turnstile!.reset(id);

  return new Promise<string>((ok, falla) => {
    pendiente = { ok, falla };
    const reloj = setTimeout(
      () => rechazar('La verificación de seguridad no respondió. Revisa tu conexión.'),
      ESPERA_MAX_MS,
    );
    const limpiar = <T,>(f: (v: T) => void) => (v: T) => { clearTimeout(reloj); f(v); };
    pendiente = { ok: limpiar(ok), falla: limpiar(falla) };
    window.turnstile!.execute(id);
  });
}

export const captchaConfigurado = Boolean(CLAVE_SITIO);
