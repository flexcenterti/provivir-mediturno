import { minutosEsperando } from '../turnos/turnos.reglas';

/**
 * D6 · la palabra es "prioridad", nunca "urgencia" (RN-05.1).
 * Lo desconocido va al final, no al principio: un valor que nadie reconoce no puede
 * colarse por delante de una prioridad alta de verdad.
 */
const PESO: Record<string, number> = { alta: 0, media: 1, baja: 2 };

export interface FilaPendiente {
  prioridad: string;
  minutosEsperando: number;
}

export interface Relojes {
  escaladaTs: Date | null;
  reabiertaTs: Date | null;
}

/**
 * Desde cuándo lleva esperando una conversación.
 *
 * Una reabierta arranca su reloj de cero: si contara desde el escalamiento original
 * aparecería con tres días de espera el mismo minuto en que se reabre, y empujaría
 * al final de la lista a quien de verdad lleva esperando desde esta mañana.
 */
export function inicioDeEspera(c: Relojes): Date | null {
  return c.reabiertaTs ?? c.escaladaTs;
}

/** Minutos que lleva esperando, 0 si nunca se escaló ni se reabrió. */
export function esperaEnMinutos(c: Relojes): number {
  const desde = inicioDeEspera(c);
  return desde ? minutosEsperando(desde) : 0;
}

/**
 * RN-05.3 · mientras el cliente no defina los criterios de prioridad (P4), la
 * columna operativa dominante es el TIEMPO DE ESPERA. De ahí el orden: prioridad y,
 * dentro de ella, quien lleva más esperando primero.
 */
export function compararPendientes(a: FilaPendiente, b: FilaPendiente): number {
  return (
    (PESO[a.prioridad] ?? 9) - (PESO[b.prioridad] ?? 9) ||
    b.minutosEsperando - a.minutosEsperando
  );
}

export function ordenarPendientes<T extends FilaPendiente>(filas: T[]): T[] {
  return [...filas].sort(compararPendientes);
}
