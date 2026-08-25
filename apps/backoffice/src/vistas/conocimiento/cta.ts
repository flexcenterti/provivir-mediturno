import type { Servicio } from '../../api';

/**
 * Ofrecimiento de cita cuando el bot detecta interés (RN-09.8).
 *
 * **Todas las cifras salen de la ficha del servicio, ninguna del texto del
 * fragmento** (RN-13.1). Es la razón de que el probador muestre el ofrecimiento:
 * permite comprobar de un vistazo que la duración y el costo que comunicaría el
 * bot son los del catálogo, aunque el artículo diga otra cosa.
 *
 * Devuelve `null` si el servicio no existe o no es agendable: ofrecer algo que no
 * se puede reservar es peor que no ofrecer nada.
 */
export function ofrecimiento(servicio: Servicio | undefined): string | null {
  if (!servicio || servicio.agendable === false) return null;

  if (servicio.requiereOrden) {
    const doble = servicio.cupos > 1 ? ' · ocupa dos espacios de agenda' : '';
    return `¿Te lo agendo? Para reservar «${servicio.nombre}» (${servicio.duracionMin} min${doble}) necesito tu orden médica. 📎`;
  }

  const costo = servicio.politicaCosto === 'sin_costo'
    ? ' y sin costo'
    : servicio.rangoPrecio ? ` (${servicio.rangoPrecio})` : '';

  return `¿Te agendo «${servicio.nombre}»? Son ${servicio.duracionMin} minutos${costo} y tengo cupos esta semana. 😊`;
}

/** `120` → `2 h`; `90` → `1 h 30 min`; `45` → `45 min`. */
export function enHoras(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Fecha en la zona de la sede, nunca la del navegador (CLAUDE.md). */
export const fechaCorta = (iso: string): string =>
  new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric',
  }).format(new Date(iso));

/** Primeras líneas del artículo, sin el encabezado ni los marcadores markdown. */
export function extracto(contenidoMd: string, largo = 110): string {
  const limpio = contenidoMd
    .replace(/^#{1,6}\s+.*$/m, '')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return limpio.length > largo ? `${limpio.slice(0, largo)}…` : limpio;
}
