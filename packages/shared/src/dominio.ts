/** D1 · Sede única. Vive en el modelo, nunca se expone en la UI. */
export const SEDE_ID = 'cdc-oriente';

/** RN-01, RN-04 · Tipos de cita */
export const TIPOS_CITA = ['general', 'control', 'procedimiento', 'examen'] as const;
export type TipoCita = (typeof TIPOS_CITA)[number];

/** RN-12.4 · Canal que originó el registro del paciente */
export const ORIGENES_PACIENTE = ['carga', 'mostrador', 'whatsapp', 'autoagendamiento'] as const;
export type OrigenPaciente = (typeof ORIGENES_PACIENTE)[number];

/**
 * D6 · La palabra "urgencia" está prohibida de cara al usuario.
 * Urgencias es un servicio habilitado que la clínica NO presta; usarlo genera
 * expectativas legales y operativas incorrectas (RN-05.1).
 */
export const PRIORIDADES = ['alta', 'media', 'baja'] as const;
export type Prioridad = (typeof PRIORIDADES)[number];

/** RN-05.2 · Marcas preferenciales para la cola de atención en sede */
export const MARCAS_PREFERENCIALES = [
  'Adulto mayor',
  'Discapacidad',
  'Movilidad reducida',
  'Embarazo',
  'Marcación manual',
] as const;

/** RN-12.4 · El historial de servicios muestra los últimos 10, sin importar la fecha */
export const HISTORIAL_SERVICIOS_VISIBLES = 10;

/**
 * RN-01.5 · Regla dura del intercalado.
 * Prohibido agendar dos citas de control consecutivas; dos generales seguidas sí se permiten.
 * Motivo de negocio: los controles no facturan.
 * La implementación completa vive en el módulo `citas` (Fase 2) — esto es solo el predicado base.
 */
export function violaIntercalado(tipoPrevio: TipoCita | null, tipoNuevo: TipoCita): boolean {
  return tipoPrevio === 'control' && tipoNuevo === 'control';
}

/** Convierte "HH:MM" a minutos desde medianoche. El motor opera en minutos, no en strings. */
export function aMinutos(hhmm: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new Error(`Hora inválida: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Convierte minutos desde medianoche a "HH:MM". */
export function aHHMM(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Zona horaria de la sede. La clínica opera en Cali (UTC−5) y el servidor puede
 * estar en cualquier otra: calcular "hoy" con la hora del servidor desplaza el día
 * entero y las citas de la mañana caen en la fecha equivocada.
 */
export const ZONA_SEDE = 'America/Bogota';

/** Fecha AAAA-MM-DD del momento dado en la zona indicada. */
export function fechaEnZona(momento: Date = new Date(), zona: string = ZONA_SEDE): string {
  // 'en-CA' produce exactamente AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(momento);
}

/** El día de hoy en la sede, como Date UTC a medianoche (así se guardan las fechas). */
export function hoyEnSede(zona: string = ZONA_SEDE): Date {
  return new Date(`${fechaEnZona(new Date(), zona)}T00:00:00Z`);
}
