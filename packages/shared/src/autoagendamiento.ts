import { diaSemanaIso } from './dominio.js';

/**
 * RN-04.8 · Cuándo se permite el autoagendamiento.
 *
 * El día en que el paciente agenda determina qué días puede reservar. La tabla la fijó
 * el cliente y se guarda en configuración; aquí solo vive cómo se resuelve.
 *
 * Puro por contrato, como el resto de `citas.reglas.ts`: recibe `hoy` y si hoy es
 * festivo, nunca los averigua. Quien llama ya resolvió el reloj de la sede y la base.
 *
 * Vive en `shared` y no en la API porque el backoffice necesita las MISMAS reglas para
 * pintar, debajo de la tabla de siete filas, qué ventana va a salir de lo que el
 * operador acaba de escribir. Calcularla dos veces sería garantizar que un día difieran.
 */

export interface FilaVentana {
  /** 1 = lunes … 7 = domingo, el mismo criterio que `Agenda.diasSemana`. */
  dia: number;
  desde: number;
  hasta: number;
}

export interface Franja {
  desde: number;
  hasta: number;
}

export interface Ventana {
  inicio: Date;
  fin: Date;
}

/**
 * La tabla que mandó el cliente. Es también el valor al que caen los parsers cuando lo
 * guardado no se puede leer: **hacia la restricción, nunca hacia el canal abierto**.
 */
export const VENTANA_BASE: readonly FilaVentana[] = [
  { dia: 1, desde: 3, hasta: 5 }, // lunes    → miércoles a viernes  (+2)
  { dia: 2, desde: 4, hasta: 5 }, // martes   → jueves a viernes     (+2)
  { dia: 3, desde: 1, hasta: 5 }, // miércoles→ lunes a viernes      (+5)
  { dia: 4, desde: 1, hasta: 5 }, // jueves   → lunes a viernes      (+4)
  { dia: 5, desde: 2, hasta: 5 }, // viernes  → martes a viernes     (+4)
  { dia: 6, desde: 2, hasta: 5 }, // sábado   → martes a viernes     (+3)
  { dia: 7, desde: 3, hasta: 5 }, // domingo o festivo → miércoles a viernes (+3)
];

const DIA_MS = 86_400_000;

/**
 * Formato compacto `1:3-5,2:4-5,…` y no JSON.
 *
 * Son veintiún números, no texto libre: en JSON con nombres legibles ocupan 211
 * caracteres —once por encima del tope de la tabla de configuración— y habría que
 * levantarle el límite a esta clave. Y sobre todo, el `estadoPrev`/`estadoNext` de la
 * auditoría con un bloque JSON de 211 caracteres no lo lee nadie; así se ve de un
 * vistazo qué fila cambió.
 */
export function serializarVentana(filas: readonly FilaVentana[]): string {
  return filas.map((f) => `${f.dia}:${f.desde}-${f.hasta}`).join(',');
}

/**
 * Lee la tabla, y **ante cualquier duda devuelve la base**.
 *
 * La dirección del respaldo importa: caer a una lista vacía dejaría el canal abierto de
 * par en par, que es lo contrario de lo que esta regla existe para hacer. Es la misma
 * decisión que toma `parsearTemas` con los temas prohibidos del bot.
 */
export function parsearVentana(crudo: string | undefined | null): FilaVentana[] {
  if (!crudo?.trim()) return [...VENTANA_BASE];

  const filas: FilaVentana[] = [];
  for (const trozo of crudo.split(',')) {
    const m = /^\s*([1-7]):([1-7])-([1-7])\s*$/.exec(trozo);
    if (!m) return [...VENTANA_BASE];
    filas.push({ dia: Number(m[1]), desde: Number(m[2]), hasta: Number(m[3]) });
  }

  // Las siete, sin repetir: una tabla incompleta dejaría días sin regla, y «sin regla»
  // en este archivo tiene que significar «la base», no «todo vale».
  const dias = new Set(filas.map((f) => f.dia));
  if (filas.length !== 7 || dias.size !== 7) return [...VENTANA_BASE];
  return filas;
}

/** Días de la semana que nunca se ofrecen, pase lo que pase con las ventanas. */
export function parsearDias(crudo: string | undefined | null, base: number[]): number[] {
  if (crudo === undefined || crudo === null) return base;
  if (!crudo.trim()) return [];

  const dias = crudo.split(',').map((d) => Number(d.trim()));
  if (dias.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return base;
  return dias;
}

/**
 * `HH:MM-HH:MM` a minutos.
 *
 * No usa `aMinutos`, que **lanza** con una hora inválida: esto se lee dentro de una
 * consulta de cupos del portal público, y un valor mal tecleado en Administración no
 * puede convertirse en un error 500 para el paciente.
 */
export function parsearFranja(crudo: string | undefined | null, base: Franja): Franja {
  const m = /^\s*([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)\s*$/.exec(crudo ?? '');
  if (!m) return base;

  const desde = Number(m[1]) * 60 + Number(m[2]);
  const hasta = Number(m[3]) * 60 + Number(m[4]);
  // Una franja invertida no significa nada y taparía todo el día.
  return hasta > desde ? { desde, hasta } : base;
}

/** Cerrado por la derecha: a la hora de cierre en punto el canal ya está cerrado. */
export function dentroDeFranja(minutos: number, franja: Franja): boolean {
  return minutos >= franja.desde && minutos < franja.hasta;
}

/**
 * Qué puede reservar quien agenda hoy.
 *
 * `inicio` es la próxima ocurrencia del día «desde» **estrictamente posterior a hoy** —de
 * ahí salen los `+2, +2, +5, +4, +4, +3, +3` que anotó el cliente, comprobados uno a uno—
 * y `fin` la próxima ocurrencia de «hasta» **en o después** del inicio, para que una
 * ventana de un solo día (`desde == hasta`) no se vaya a la semana siguiente.
 *
 * Si «hasta» cae antes que «desde» en la semana, la ventana envuelve el fin de semana sin
 * ningún caso especial. El ancho máximo es siempre de seis días.
 */
export function ventanaPara(hoy: Date, filas: FilaVentana[], hoyEsFestivo: boolean): Ventana {
  const propia = conFila(hoy, filaDe(filas, diaSemanaIso(hoy)));
  if (!hoyEsFestivo) return propia;

  /*
   * «Domingo o festivos» comparten fila. Pero aplicarla a secas puede abrir la ventana
   * ANTES que un día normal: un 1 de enero en martes daría +1 —la fila del domingo empieza
   * en miércoles— frente a los +2 del martes corriente. Un día en que la clínica está
   * cerrada no puede dar más margen que uno en que está abierta, así que se toma el más
   * tardío de los dos.
   *
   * En la práctica casi nunca se nota: los festivos colombianos se corren a lunes por la
   * Ley Emiliani, y para un lunes las dos filas coinciden.
   */
  const comoDomingo = conFila(hoy, filaDe(filas, 7));
  return comoDomingo.inicio.getTime() >= propia.inicio.getTime() ? comoDomingo : propia;
}

function filaDe(filas: FilaVentana[], dia: number): FilaVentana {
  return filas.find((f) => f.dia === dia) ?? VENTANA_BASE[dia - 1]!;
}

function conFila(hoy: Date, fila: FilaVentana): Ventana {
  const inicio = new Date(hoy.getTime() + diasHasta(diaSemanaIso(hoy), fila.desde, false) * DIA_MS);
  const fin = new Date(inicio.getTime() + diasHasta(fila.desde, fila.hasta, true) * DIA_MS);
  return { inicio, fin };
}

/** Días desde un día de la semana hasta otro. `incluirCero`: si coincidir vale 0 o 7. */
function diasHasta(desde: number, hasta: number, incluirCero: boolean): number {
  const d = (hasta - desde + 7) % 7;
  return d === 0 && !incluirCero ? 7 : d;
}

/**
 * Las fechas concretas que el canal puede ofrecer, ya sin los días excluidos ni los
 * cerrados.
 *
 * Es lo que consumen el portal y el prompt del bot, y por eso se resta aquí: publicar un
 * rango que incluya el 25 de diciembre hace que el bot lo ofrezca con confianza y queme
 * un turno. El rechazo del día cerrado sigue siendo de `validarDiaLaborable`, que da un
 * mensaje mejor —dice el motivo—; esto solo evita anunciarlo.
 */
export function fechasDeVentana(
  ventana: Ventana,
  diasExcluidos: number[],
  cerradas: ReadonlySet<string>,
): string[] {
  const fechas: string[] = [];
  for (let t = ventana.inicio.getTime(); t <= ventana.fin.getTime(); t += DIA_MS) {
    const d = new Date(t);
    if (diasExcluidos.includes(diaSemanaIso(d))) continue;
    const iso = d.toISOString().slice(0, 10);
    if (cerradas.has(iso)) continue;
    fechas.push(iso);
  }
  return fechas;
}
