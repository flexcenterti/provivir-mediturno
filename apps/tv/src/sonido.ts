import { elegirVozEspanola, textoDeLlamado, type LlamadoParaVoz } from '@provivir/shared';

/**
 * RN-11.5 · el llamado suena: campanita y después voz.
 *
 * **La campanita es lo que importa.** Es la señal de atención: hace que la sala levante
 * la vista, y a partir de ahí el tablero da el dato. La voz es un extra que depende del
 * aparato. Si en un televisor concreto solo sobrevive una de las dos, tiene que ser la
 * campanita — una sala que mira la pantalla se entera igual; una voz para la que nadie
 * estaba preparado se pierde.
 *
 * La campanita se **sintetiza** con dos osciladores en vez de servir un `.mp3`. No es
 * capricho: no hay binario que empaquetar, ni 404 posible, ni `media-src` que abrir en
 * la CSP de `/tv`, y el tono es un parámetro en lugar de un archivo que habría que
 * volver a grabar.
 */

export type EstadoSonido =
  /** La pantalla está configurada sin sonido: no se pide nada a nadie. */
  | 'apagado'
  /** Hay que tocar el televisor una vez; el navegador no deja sonar antes. */
  | 'pendiente'
  /** Suena, con voz. */
  | 'activo'
  /** Suena, pero el aparato no tiene voz en español: solo campanita. */
  | 'sin-voz';

interface Ventana {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

let ctx: AudioContext | null = null;
let cola: Promise<void> = Promise.resolve();

function crearContexto(): AudioContext | null {
  const w = window as unknown as Ventana;
  const Constructor = w.AudioContext ?? w.webkitAudioContext;
  return Constructor ? new Constructor() : null;
}

/**
 * Intenta dejar el audio listo. Devuelve si quedó armado.
 *
 * Con el navegador del stick lanzado con `--autoplay-policy=no-user-gesture-required`
 * esto prospera en el arranque y nadie tiene que tocar nada. Si no, hay que volver a
 * llamarla desde un gesto de verdad.
 */
export async function armar(): Promise<boolean> {
  ctx ??= crearContexto();
  if (!ctx) return false;
  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);

  /*
   * `speechSynthesis` no está formalmente sujeto a la política de autoplay, pero
   * Chrome y los WebView de Android la han aplicado igual. Una locución vacía dentro
   * del gesto lo deja armado; fuera de él no hace nada y tampoco molesta.
   */
  if (typeof speechSynthesis !== 'undefined') {
    try {
      speechSynthesis.speak(new SpeechSynthesisUtterance(''));
    } catch { /* motor ausente: la campanita sigue en pie */ }
  }

  return ctx.state === 'running';
}

/** Si hay voz en español instalada. `getVoices()` puede tardar en poblarse. */
export function hayVozEspanola(): boolean {
  if (typeof speechSynthesis === 'undefined') return false;
  return elegirVozEspanola(speechSynthesis.getVoices()) !== null;
}

/**
 * Avisa cuando la lista de voces se puebla.
 *
 * `getVoices()` devuelve `[]` en la primera llamada en Chrome hasta que dispara
 * `voiceschanged`. Es el error clásico de esta API: decidir «no hay voz» con la
 * primera respuesta condena al televisor al silencio para siempre.
 */
export function alCambiarVoces(fn: () => void): () => void {
  if (typeof speechSynthesis === 'undefined') return () => undefined;
  speechSynthesis.addEventListener('voiceschanged', fn);
  return () => speechSynthesis.removeEventListener('voiceschanged', fn);
}

/** Dos notas cortas con envolvente, para que no suene a pitido de error. */
function campanita(): Promise<void> {
  if (!ctx || ctx.state !== 'running') return Promise.resolve();
  const inicio = ctx.currentTime;

  for (const [i, frecuencia] of [880, 1320].entries()) {
    const osc = ctx.createOscillator();
    const gan = ctx.createGain();
    const t = inicio + i * 0.18;

    osc.type = 'sine';
    osc.frequency.value = frecuencia;
    gan.gain.setValueAtTime(0.0001, t);
    gan.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gan.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);

    osc.connect(gan).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.32);
  }
  return new Promise((listo) => setTimeout(listo, 520));
}

function hablar(l: LlamadoParaVoz): Promise<void> {
  const voz = typeof speechSynthesis === 'undefined'
    ? null
    : elegirVozEspanola(speechSynthesis.getVoices());
  // Sin voz en español no se habla. Ver `elegirVozEspanola`.
  if (!voz) return Promise.resolve();

  return new Promise((listo) => {
    const u = new SpeechSynthesisUtterance(textoDeLlamado(l));
    const nativa = speechSynthesis.getVoices().find((v) => v.name === voz.name);
    if (nativa) u.voice = nativa;
    u.lang = voz.lang;
    u.rate = 0.95;
    u.onend = () => listo();
    u.onerror = () => listo();
    // Un motor colgado no puede dejar la cola bloqueada para siempre.
    setTimeout(listo, 12_000);
    speechSynthesis.speak(u);
  });
}

/**
 * Anuncia un llamado. Las llamadas se encadenan: dos turnos seguidos se oyen uno
 * detrás de otro en vez de pisarse.
 */
export function anunciar(l: LlamadoParaVoz): void {
  cola = cola.then(() => campanita()).then(() => hablar(l)).catch(() => undefined);
}

/** Suelta el contexto: la pantalla puede pasar a `sonido: false` en cualquier refresco. */
export function apagar(): void {
  void ctx?.close().catch(() => undefined);
  ctx = null;
  cola = Promise.resolve();
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
