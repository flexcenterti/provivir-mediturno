import { aMinutos } from '@provivir/shared';
import type { FranjaAgenda } from '../citas/citas.reglas';

/**
 * RN-06 · La forma de una agenda: qué días rige y cuándo dos franjas se pisan.
 *
 * Lo que cabe DENTRO de una franja vive en `citas.reglas.ts`, pegado a `generarCupos`,
 * porque es el predicado de pertenencia del conjunto que ese generador produce.
 *
 * Invariante de todo el sistema: las fechas son medianoche UTC (`@db.Date` + `aFechaUtc`),
 * así que aquí se compara con `getUTCDay()` y con `getTime()` sin normalizar nada.
 */

export interface Franja {
  modo: string;
  diasSemana: number[];
  fecha: Date | null;
  horaIni: string;
  horaFin: string;
  slotMin: number;
}

/** 1 = lunes … 7 = domingo, que es el criterio de `Agenda.diasSemana`. */
export function diaSemanaIso(fecha: Date): number {
  const d = fecha.getUTCDay();
  return d === 0 ? 7 : d;
}

/** Pasa las horas de la fila a minutos, que es como las quiere el motor de cupos. */
export function aFranjaAgenda(f: Pick<Franja, 'horaIni' | 'horaFin' | 'slotMin'>): FranjaAgenda {
  return { horaIni: aMinutos(f.horaIni), horaFin: aMinutos(f.horaFin), slotMin: f.slotMin };
}

/** ¿Esta franja rige ese día? Semanal por día de la semana; calendario por fecha exacta. */
export function franjaAplicaA(fecha: Date, franja: Pick<Franja, 'modo' | 'diasSemana' | 'fecha'>): boolean {
  return franja.modo === 'semanal'
    ? franja.diasSemana.includes(diaSemanaIso(fecha))
    : franja.fecha !== null && franja.fecha.getTime() === fecha.getTime();
}

/**
 * ¿Dos franjas del mismo prestador se pisan?
 *
 * Cuando se pisan, `cupos()` **ofrece la misma hora dos veces** —no hay deduplicación
 * dentro de un prestador— y con `slotMin` distintos salen además horas desalineadas
 * entre sí. Nunca se validó, y poder editar horarios lo vuelve trivial de provocar.
 *
 * Se llama `franjasSeSolapan` y no `seSolapan` porque ese nombre ya existe en
 * `citas.reglas.ts` con otra firma —solapamiento de dos citas— y los dos módulos se
 * importan entre sí.
 */
export function franjasSeSolapan(a: Franja, b: Franja): boolean {
  return compartenDia(a, b) && rangosSeCruzan(a, b);
}

function compartenDia(a: Franja, b: Franja): boolean {
  if (a.modo === 'semanal' && b.modo === 'semanal') {
    return a.diasSemana.some((d) => b.diasSemana.includes(d));
  }
  if (a.modo === 'calendario' && b.modo === 'calendario') {
    return a.fecha !== null && b.fecha !== null && a.fecha.getTime() === b.fecha.getTime();
  }
  // Semanal contra calendario: un especialista con fecha puntual un jueves sobre una
  // agenda de lunes a viernes se pisa ese jueves. La función lo dice; que la POLÍTICA
  // lo tolere o no se decide en el servicio, no aquí.
  const [semanal, calendario] = a.modo === 'semanal' ? [a, b] : [b, a];
  return calendario.fecha !== null && semanal.diasSemana.includes(diaSemanaIso(calendario.fecha));
}

function rangosSeCruzan(a: Franja, b: Franja): boolean {
  /*
   * Semiabierto `[ini, fin)`, y de esto depende el catálogo real: la jornada partida de
   * varios profesionales es 07:00–12:00 y 12:30–16:30, y la de otro 07:00–12:00 y
   * 13:00–16:30. Un `<=` de más y el cargador del catálogo deja de poder sembrar.
   */
  return aMinutos(a.horaIni) < aMinutos(b.horaFin) && aMinutos(b.horaIni) < aMinutos(a.horaFin);
}
