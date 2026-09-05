import type { Prisma } from '@prisma/client';

/**
 * Pendiente = sin resolver y esperando a una persona.
 *
 * `reabiertaTs` e `iniciadaTs` entran en el OR porque una conversación sin escalar
 * (`escalada: false`) que una asistente reabre —o abre ella misma para escribirle a
 * quien nunca ha escrito— tiene que aparecer aquí. La alternativa —ponerles
 * `escalada: true`— falsearía el contador de escalaciones de un mes ya reportado,
 * porque las métricas se calculan sobre el estado actual.
 *
 * Vive aquí, y no dentro de `BandejaService`, porque la burbuja del menú la emiten
 * DOS lados: la bandeja cuando la asistente hace algo, y `ConversacionService` cuando
 * entra un mensaje. Con una copia en cada uno el número cambiaba según quién hubiera
 * emitido último —el lado del webhook contaba solo `escalada: true` y se dejaba fuera
 * las reabiertas—, así que la burbuja bajaba sola al llegar un WhatsApp y volvía a
 * subir en cuanto alguien tocaba la bandeja.
 *
 * Es un objeto plano, no un proveedor: importarlo desde `whatsapp` no crea ciclo de
 * inyección, que es justo lo que impedía compartir el conteo.
 */
export const PENDIENTES: Prisma.ConversacionWhereInput = {
  resueltaTs: null,
  OR: [{ escalada: true }, { reabiertaTs: { not: null } }, { iniciadaTs: { not: null } }],
};
