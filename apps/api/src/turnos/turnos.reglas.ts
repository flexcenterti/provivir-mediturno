import type { Prioridad } from '@provivir/shared';

export interface TurnoEnCola {
  id: string;
  prioridad: Prioridad;
  llegadaTs: Date;
  /** Marcas preferenciales del paciente (RN-05.2). */
  condiciones: string[];
}

const PESO: Record<Prioridad, number> = { alta: 0, media: 1, baja: 2 };

/**
 * RN-05.2 · Orden de la cola de atención en sede.
 *
 * Primero los pacientes con marcas preferenciales o prioridad elevada; dentro del
 * mismo nivel, orden de llegada. El llamado es automático al siguiente (RN-07.3):
 * el prestador no elige arbitrariamente a quién llamar.
 */
export function ordenarCola<T extends TurnoEnCola>(turnos: T[]): T[] {
  return [...turnos].sort((a, b) => {
    const pa = PESO[a.prioridad];
    const pb = PESO[b.prioridad];
    if (pa !== pb) return pa - pb;

    // Las marcas preferenciales adelantan dentro del mismo nivel de prioridad.
    const ma = a.condiciones.length > 0 ? 0 : 1;
    const mb = b.condiciones.length > 0 ? 0 : 1;
    if (ma !== mb) return ma - mb;

    return a.llegadaTs.getTime() - b.llegadaTs.getTime();
  });
}

/** RN-05.2 · un paciente con marca preferencial entra con prioridad media, no baja. */
export function prioridadPorCondiciones(condiciones: string[]): Prioridad {
  return condiciones.length > 0 ? 'media' : 'baja';
}

/** RN-08.3 · minutos que lleva esperando, para que la espera "no se vuelva paisaje". */
export function minutosEsperando(desde: Date, ahora: Date = new Date()): number {
  return Math.max(0, Math.round((ahora.getTime() - desde.getTime()) / 60_000));
}
