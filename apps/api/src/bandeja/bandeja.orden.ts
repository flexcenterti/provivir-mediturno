import { minutosEsperando } from '../turnos/turnos.reglas';

/**
 * Desde cuándo lleva esperando cada conversación.
 *
 * Este módulo ordenaba además la bandeja: prioridad y, dentro de ella, quien llevaba
 * más esperando (RN-05.3). En la fase 18 el cliente cambió el orden al de WhatsApp
 * —arriba quien acaba de escribir—, así que `ordenarPendientes` y `compararPendientes`
 * se retiraron. El dato de la espera sigue haciendo falta: se pinta en cada fila, y a
 * partir de 30 minutos se destaca (RN-08.3).
 */

export interface Relojes {
  escaladaTs: Date | null;
  reabiertaTs: Date | null;
  /** Cuándo la abrió una asistente desde el backoffice. Ver `bandeja.filtros`. */
  iniciadaTs?: Date | null;
}

/**
 * Desde cuándo lleva esperando una conversación.
 *
 * Una reabierta arranca su reloj de cero: si contara desde el escalamiento original
 * aparecería con tres días de espera el mismo minuto en que se reabre, y empujaría
 * al final de la lista a quien de verdad lleva esperando desde esta mañana.
 *
 * El orden es del suceso más reciente al más antiguo, no al revés: una conversación
 * que se abrió a mano y después se cerró y se reabrió tiene que contar desde la
 * reapertura. Con `iniciadaTs` por delante seguiría contando desde el primer día.
 */
export function inicioDeEspera(c: Relojes): Date | null {
  return c.reabiertaTs ?? c.iniciadaTs ?? c.escaladaTs;
}

/** Minutos que lleva esperando, 0 si nunca se escaló ni se reabrió. */
export function esperaEnMinutos(c: Relojes): number {
  const desde = inicioDeEspera(c);
  return desde ? minutosEsperando(desde) : 0;
}
