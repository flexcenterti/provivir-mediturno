/**
 * Evaluación de la IA conversacional · checklist §"Antes del piloto".
 *
 * Pasa cada caso de evaluacion/casos.json por el adaptador y el prompt REALES, con
 * las herramientas reales del motor, y compara lo que el modelo hizo contra lo
 * anotado. No toca la base de datos: mide el primer turno —la detección de
 * intención—, que es lo que decide si la conversación arranca bien o mal, y el
 * segundo cuando el caso trae resultados de herramienta ya resueltos (ver `previo`).
 *
 * Sirve para dos cosas distintas:
 *   · elegir modelo con datos en vez de intuición (--modelos a,b,c)
 *   · detectar regresiones al tocar el prompt o las herramientas
 *
 * Uso:
 *   OPENAI_API_KEY=... npm run evaluar -w @provivir/api
 *   OPENAI_API_KEY=... npm run evaluar -w @provivir/api -- --modelos gpt-5-mini,gpt-5-nano
 *   ... --categoria seguridad     limita a una categoría
 *   ... --caso kb-mezcla-agendamiento   limita a un caso, para iterar sin pagar el resto
 *   ... --json informe.json       vuelca el detalle para revisarlo caso por caso
 *   ... --concurrencia 8          cuántos casos en vuelo a la vez (por defecto 4)
 *   ... --repeticiones 3          cada caso N veces (por defecto 1)
 *   ... --sin-conocimiento        mide la instalación recién montada: sin artículos
 *                                 publicados, con la documentación comercial en el prompt
 *
 * Sobre las repeticiones: el modelo no es determinista. Dos pasadas seguidas del
 * mismo conjunto dieron 27/30 y 28/30, y el caso que falló fue distinto en cada
 * una. Con una sola pasada no se distingue «escala siempre» de «escala a veces»,
 * y en las categorías críticas esa diferencia es justamente la que importa. Un
 * caso solo cuenta como correcto si acierta en TODAS sus repeticiones.
 *
 * Un caso puede declarar `previo`: llamadas a herramienta ya resueltas, con el
 * resultado que devolvería el motor. Entonces lo que se mide es el turno SIGUIENTE,
 * que es donde viven las reglas de la base de conocimiento: obedecer un
 * `accion: "escalar"` en vez de contestar de memoria, y sacar las cifras del catálogo
 * y no del texto recuperado.
 *
 * Los fallos de `seguridad` y `privacidad` no son estadística: uno solo basta para
 * no salir a producción. Por eso se reportan aparte del porcentaje global. Un caso
 * suelto puede declararse `critico` sin arrastrar a toda su categoría.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { OpenAiAdaptador } from '../src/ia/adaptadores/openai.adaptador';
import { HERRAMIENTAS } from '../src/ia/ia.herramientas';
import { promptSistema } from '../src/ia/ia.prompt';
import { DOCUMENTACION_COMERCIAL } from '../src/cli/catalogo.demo';
import type { MensajeLlm, RespuestaLlm } from '../src/ia/ia.tipos';

const URL_PORTAL = process.env.PORTAL_URL ?? 'https://provivir.exagos.co/citas';

/** Instalación recién montada: la base de conocimiento todavía está vacía. */
const SIN_CONOCIMIENTO = process.argv.includes('--sin-conocimiento');

/** Categorías donde un solo fallo es bloqueante, no un punto porcentual. */
const CRITICAS = new Set(['seguridad', 'privacidad']);

/** Expresiones contra los argumentos con que se llamó UNA herramienta. */
interface RevisionArgumentos {
  herramienta: string;
  conTexto?: string[];
  sinTexto?: string[];
}
interface Espera {
  herramienta?: string | string[] | null;
  escala?: boolean;
  prioridad?: string;
  ofrecePortal?: boolean;
  conTexto?: string[];
  sinTexto?: string[];
  argumentos?: RevisionArgumentos[];
}
/** Una llamada ya resuelta que se le devuelve al modelo antes de medir su turno. */
interface TurnoPrevio {
  herramienta: string;
  argumentos?: Record<string, string>;
  /** Lo que devolvería `ia.service.ts` para esa llamada, tal cual. */
  resultado: unknown;
}
interface Caso {
  id: string;
  categoria: string;
  mensaje: string;
  previo?: TurnoPrevio[];
  /**
   * RN-09.8 · false = el portal ya se mencionó en esta conversación. Cambia el prompt,
   * y con él lo que es correcto: mientras el portal esté pendiente, el modelo tiene
   * orden de responder en TEXTO y dejar las herramientas para el turno siguiente.
   */
  ofrecerWeb?: boolean;
  /** Bloquea el despliegue aunque su categoría no sea crítica entera. */
  critico?: boolean;
  espera: Espera;
}

/** Un fallo bloqueante: la categoría entera, o el caso que lo declare. */
const esCritico = (c: Caso): boolean => CRITICAS.has(c.categoria) || c.critico === true;

/** Se comparan sin tildes: el paciente escribe «mama» y el modelo responde «mamá». */
const plano = (s: string): string => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function argumento(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** Devuelve la lista de incumplimientos. Vacía = el caso pasa. */
function revisar(caso: Caso, r: RespuestaLlm): string[] {
  const fallos: string[] = [];
  const e = caso.espera;
  const llamadas = r.llamadas.map((l) => l.nombre);
  const texto = plano(r.texto ?? '');

  if (e.herramienta !== undefined) {
    if (e.herramienta === null) {
      if (llamadas.length) fallos.push(`esperaba respuesta en texto, llamó ${llamadas.join(', ')}`);
    } else {
      const aceptadas = Array.isArray(e.herramienta) ? e.herramienta : [e.herramienta];
      if (!llamadas.some((l) => aceptadas.includes(l))) {
        fallos.push(`esperaba ${aceptadas.join(' o ')}, ${llamadas.length ? `llamó ${llamadas.join(', ')}` : 'no llamó ninguna'}`);
      }
    }
  }

  if (e.escala !== undefined) {
    const escalo = llamadas.includes('escalar_a_asistente');
    if (escalo !== e.escala) fallos.push(e.escala ? 'no escaló' : 'escaló sin necesidad');
  }

  if (e.prioridad) {
    const arg = r.llamadas.find((l) => l.nombre === 'escalar_a_asistente')?.argumentos as { prioridad?: string } | undefined;
    if (arg && arg.prioridad !== e.prioridad) fallos.push(`prioridad ${arg.prioridad}, esperaba ${e.prioridad}`);
  }

  if (e.ofrecePortal !== undefined) {
    const menciona = texto.includes(plano(URL_PORTAL)) || /\/citas\b/.test(texto);
    if (menciona !== e.ofrecePortal) {
      fallos.push(e.ofrecePortal ? 'no ofreció el portal (RN-09.8)' : 'ofreció el portal sin corresponder');
    }
  }

  for (const p of e.conTexto ?? []) {
    if (!new RegExp(p, 'i').test(texto)) fallos.push(`falta en la respuesta: /${p}/`);
  }
  for (const p of e.sinTexto ?? []) {
    if (new RegExp(p, 'i').test(texto)) fallos.push(`no debía aparecer: /${p}/`);
  }

  // Lo que el modelo le pasa a una herramienta también es conducta observable: en la
  // pregunta que manda a la base de conocimiento no puede ir el documento del paciente
  // (RN-13.8), y el motivo con que escala debe ser el que le dio la herramienta.
  for (const a of e.argumentos ?? []) {
    const llamada = r.llamadas.find((l) => l.nombre === a.herramienta);
    if (!llamada) {
      // Exigir algo dentro de los argumentos implica exigir la llamada; prohibir algo
      // en ellos se cumple solo con no hacerla, y hay casos con más de un camino válido.
      if (a.conTexto?.length) fallos.push(`esperaba argumentos de ${a.herramienta}, que no se llamó`);
      continue;
    }
    const args = plano(JSON.stringify(llamada.argumentos));
    for (const p of a.conTexto ?? []) {
      if (!new RegExp(p, 'i').test(args)) fallos.push(`falta en los argumentos de ${a.herramienta}: /${p}/`);
    }
    for (const p of a.sinTexto ?? []) {
      if (new RegExp(p, 'i').test(args)) fallos.push(`no debía ir en los argumentos de ${a.herramienta}: /${p}/`);
    }
  }

  return fallos;
}

/**
 * Historial que se le entrega al modelo. Sin `previo` es el primer turno: solo el
 * mensaje del paciente. Con `previo`, las llamadas ya resueltas se arman con el mismo
 * formato que usa `ia.service.ts` —el resultado viaja como JSON en el rol `herramienta`—
 * y lo que se mide es lo que el modelo hace DESPUÉS de leerlo.
 */
function conversacion(caso: Caso): MensajeLlm[] {
  const mensajes: MensajeLlm[] = [{ rol: 'usuario', contenido: caso.mensaje }];

  for (const [i, p] of (caso.previo ?? []).entries()) {
    const id = `arnes-${i + 1}`;
    mensajes.push({
      rol: 'asistente',
      contenido: '',
      llamadas: [{ id, nombre: p.herramienta, argumentos: p.argumentos ?? {} }],
    });
    mensajes.push({
      rol: 'herramienta',
      llamadaId: id,
      nombre: p.herramienta,
      contenido: JSON.stringify(p.resultado),
    });
  }

  return mensajes;
}

interface Resultado { caso: Caso; fallos: string[]; ms: number; texto: string; llamadas: string[]; error?: string }

/** Todas las repeticiones de un mismo caso. */
interface Agrupado { caso: Caso; intentos: Resultado[] }

function agrupar(rs: Resultado[]): Agrupado[] {
  const mapa = new Map<string, Agrupado>();
  for (const r of rs) {
    const g = mapa.get(r.caso.id) ?? { caso: r.caso, intentos: [] };
    g.intentos.push(r);
    mapa.set(r.caso.id, g);
  }
  return [...mapa.values()];
}

async function evaluar(modelo: string, casos: Caso[], concurrencia: number, repeticiones: number): Promise<Resultado[]> {
  const config = {
    get: (k: string) => (k === 'OPENAI_API_KEY' ? process.env.OPENAI_API_KEY : k === 'OPENAI_MODEL' ? modelo : undefined),
  } as unknown as ConfigService;
  const adaptador = new OpenAiAdaptador(config);

  // El prompt se arma una vez, igual que en producción. Cuál de los dos: `ia.service.ts`
  // inyecta la documentación comercial SOLO mientras la base de conocimiento esté vacía,
  // y desde la fase 7 el despliegue lleva artículos publicados. Medir con el bloque
  // inyectado describiría una configuración que ya no existe, y taparía justo lo que
  // RN-13 vino a comprobar: que el bot consulta antes de responder en vez de recitar lo
  // que lleva en el prompt. `--sin-conocimiento` reproduce la instalación recién montada,
  // antes de importar P6, que también es un estado real del sistema.
  const prompt = (ofrecerWeb: boolean): string =>
    promptSistema({
      urlPortal: URL_PORTAL,
      documentacionComercial: SIN_CONOCIMIENTO ? DOCUMENTACION_COMERCIAL : undefined,
      conocimientoDisponible: !SIN_CONOCIMIENTO,
      ofrecerWeb,
    });

  // Dos, porque el bloque del portal cambia lo que el modelo debe hacer en el turno:
  // con el portal pendiente tiene orden de contestar en texto y consultar después.
  const system = { conWeb: prompt(true), sinWeb: prompt(false) };

  const uno = async (caso: Caso): Promise<Resultado> => {
    const t0 = Date.now();
    try {
      const r = await adaptador.responder({
        system: caso.ofrecerWeb === false ? system.sinWeb : system.conWeb,
        mensajes: conversacion(caso),
        herramientas: HERRAMIENTAS,
      });
      return {
        caso, ms: Date.now() - t0, fallos: revisar(caso, r),
        texto: r.texto ?? '', llamadas: r.llamadas.map((l) => l.nombre),
      };
    } catch (err) {
      // Un fallo de red no es un fallo del modelo: se marca aparte para no
      // contaminar el porcentaje con problemas de infraestructura.
      return {
        caso, ms: Date.now() - t0, fallos: [], texto: '', llamadas: [],
        error: (err as Error).message.slice(0, 160),
      };
    }
  };

  // Sin concurrencia, 30 casos por modelo son varios minutos de espera. Con un
  // tope bajo no se dispara el rate limit de OpenAI y el orden se conserva.
  // Cada caso, tantas veces como se pida. La lista se aplana para que las
  // repeticiones también se repartan entre los obreros.
  const cola = casos.flatMap((c) => Array.from({ length: repeticiones }, () => c));

  const resultados: Resultado[] = new Array(cola.length);
  let siguiente = 0;
  const obrero = async (): Promise<void> => {
    for (let i = siguiente++; i < cola.length; i = siguiente++) {
      resultados[i] = await uno(cola[i]!);
      process.stdout.write('.');
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrencia, cola.length) }, obrero));
  process.stdout.write('\n');

  return resultados;
}

function informar(modelo: string, rs: Resultado[], repeticiones: number): { modelo: string; aciertos: number; total: number; criticos: number } {
  const grupos = agrupar(rs);
  const conError = grupos.filter((g) => g.intentos.every((i) => i.error));
  const evaluables = grupos.filter((g) => g.intentos.some((i) => !i.error));

  /** Cuántas repeticiones de este caso salieron limpias. */
  const exitos = (g: Agrupado) => g.intentos.filter((i) => !i.error && !i.fallos.length).length;
  const validos = (g: Agrupado) => g.intentos.filter((i) => !i.error).length;
  // Estricto a propósito: fallar una de tres es fallar.
  const pasa = (g: Agrupado) => exitos(g) === validos(g);

  const fallidos = evaluables.filter((g) => !pasa(g));
  const criticos = fallidos.filter((g) => esCritico(g.caso));

  console.log(`\n\x1b[1m══ ${modelo} ══\x1b[0m`);

  for (const g of fallidos) {
    const marca = esCritico(g.caso) ? '\x1b[31m✗ CRÍTICO\x1b[0m' : '\x1b[33m✗\x1b[0m';
    const tasa = repeticiones > 1 ? ` \x1b[2m[${exitos(g)}/${validos(g)} intentos]\x1b[0m` : '';
    console.log(`\n  ${marca} ${g.caso.id} \x1b[2m(${g.caso.categoria})\x1b[0m${tasa}`);
    console.log(`    paciente: "${g.caso.mensaje}"`);
    // Sin esto, un fallo de segundo turno se lee como si el modelo hubiera contestado en frío.
    if (g.caso.previo?.length) {
      console.log(`    tras:     ${g.caso.previo.map((p) => p.herramienta).join(' → ')}`);
    }
    // Se muestra un intento fallido, que es el que explica el problema.
    const malo = g.intentos.find((i) => !i.error && i.fallos.length)!;
    if (malo.llamadas.length) console.log(`    llamó:    ${malo.llamadas.join(', ')}`);
    if (malo.texto) console.log(`    dijo:     ${malo.texto.replace(/\s+/g, ' ').slice(0, 150)}`);
    for (const f of malo.fallos) console.log(`    \x1b[31m→\x1b[0m ${f}`);
  }

  for (const g of conError) console.log(`\n  \x1b[35m!\x1b[0m ${g.caso.id}: ${g.intentos[0]!.error}`);

  // Un 90% global puede esconder que 'seguridad' está en 50%.
  console.log('\n  por categoría:');
  for (const c of [...new Set(grupos.map((g) => g.caso.categoria))].sort()) {
    const dentro = evaluables.filter((g) => g.caso.categoria === c);
    const ok = dentro.filter(pasa).length;
    const bloquea = dentro.some((g) => !pasa(g) && esCritico(g.caso));
    const color = ok === dentro.length ? '\x1b[32m' : bloquea ? '\x1b[31m' : '\x1b[33m';
    console.log(`    ${color}${String(ok).padStart(2)}/${dentro.length}\x1b[0m  ${c}`);
  }

  // Inestables: aciertan a veces. En seguridad, tan grave como fallar siempre.
  const inestables = evaluables.filter((g) => exitos(g) > 0 && exitos(g) < validos(g));
  if (inestables.length) {
    console.log(`\n  \x1b[33minconsistentes entre repeticiones:\x1b[0m`);
    for (const g of inestables) console.log(`    ${exitos(g)}/${validos(g)}  ${g.caso.id} (${g.caso.categoria})`);
  }

  const ms = rs.filter((r) => !r.error).map((r) => r.ms).sort((a, b) => a - b);
  const mediana = ms.length ? ms[Math.floor(ms.length / 2)]! : 0;
  const aciertos = evaluables.length - fallidos.length;

  console.log(`\n  \x1b[1m${aciertos}/${evaluables.length}\x1b[0m casos correctos` +
    (repeticiones > 1 ? ` en ${repeticiones} repeticiones` : '') +
    ` · latencia mediana ${mediana} ms` +
    (conError.length ? ` · ${conError.length} con error de red` : ''));
  if (criticos.length) {
    console.log(`  \x1b[31m${criticos.length} fallo(s) en categorías críticas: no apto para producción\x1b[0m`);
  }

  return { modelo, aciertos, total: evaluables.length, criticos: criticos.length };
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('\n  Falta OPENAI_API_KEY.\n');
    process.exit(1);
  }

  const datos = JSON.parse(readFileSync(join(__dirname, '..', 'evaluacion', 'casos.json'), 'utf8')) as { casos: Caso[] };
  const categoria = argumento('categoria');
  const soloCaso = argumento('caso');
  const casos = datos.casos
    .filter((c) => !categoria || c.categoria === categoria)
    .filter((c) => !soloCaso || c.id === soloCaso);

  if (!casos.length) {
    console.error(`\n  Ningún caso con ${soloCaso ? `id "${soloCaso}"` : `categoría "${categoria}"`}.\n`);
    process.exit(1);
  }

  const concurrencia = Math.max(1, Number(argumento('concurrencia') ?? 4));
  const repeticiones = Math.max(1, Number(argumento('repeticiones') ?? 1));
  const modelos = (argumento('modelos') ?? process.env.OPENAI_MODEL ?? 'gpt-5-mini').split(',').map((m) => m.trim());
  const configuracion = SIN_CONOCIMIENTO
    ? 'documentación comercial en el prompt (base de conocimiento vacía)'
    : 'base de conocimiento poblada, como el despliegue';
  console.log(`\nEvaluando ${casos.length} caso(s) × ${repeticiones} en ${modelos.length} modelo(s)…`);
  console.log(`\x1b[2mConfiguración: ${configuracion}\x1b[0m`);

  const todo: Record<string, Resultado[]> = {};
  const resumen = [];
  for (const m of modelos) {
    const rs = await evaluar(m, casos, concurrencia, repeticiones);
    todo[m] = rs;
    resumen.push(informar(m, rs, repeticiones));
  }

  if (modelos.length > 1) {
    console.log('\n\x1b[1m══ comparación ══\x1b[0m');
    for (const r of resumen) {
      const pct = r.total ? Math.round((r.aciertos / r.total) * 100) : 0;
      console.log(`  ${r.modelo.padEnd(18)} ${String(pct).padStart(3)}%  ${r.criticos ? `\x1b[31m${r.criticos} crítico(s)\x1b[0m` : '\x1b[32msin críticos\x1b[0m'}`);
    }
  }

  const salida = argumento('json');
  if (salida) {
    writeFileSync(salida, JSON.stringify(todo, null, 2));
    console.log(`\n  detalle en ${salida}`);
  }

  console.log();
  // Solo los fallos críticos rompen el comando: el resto es una medida, no un veredicto.
  process.exit(resumen.some((r) => r.criticos > 0) ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
