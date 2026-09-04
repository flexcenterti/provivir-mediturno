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

/**
 * Desfase de la zona respecto a UTC en un instante dado, en milisegundos.
 *
 * Se calcula formateando el instante en la zona y volviéndolo a leer como si fuera
 * UTC: la diferencia es el desfase. Parece un rodeo, pero es la única forma sin
 * dependencias de acertar en una zona con horario de verano — y aunque Colombia no
 * lo tenga, la constante `ZONA_SEDE` es un parámetro, no una ley.
 */
function desfaseMs(momento: Date, zona: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(momento);

  const v = (tipo: string): number => Number(partes.find((p) => p.type === tipo)!.value);
  const comoSiFueraUtc = Date.UTC(
    v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'),
  );
  return comoSiFueraUtc - Math.floor(momento.getTime() / 1000) * 1000;
}

/**
 * El instante UTC en que empieza el día AAAA-MM-DD de la zona.
 *
 * Hace falta para filtrar por RANGO DE FECHAS lo que se guarda como instante
 * (`creado_en`, `resuelta_ts`). Recortar el ISO con `toISOString().slice(0,10)`
 * compara en UTC: en la sede (UTC−5) todo lo ocurrido después de las 19:00 se
 * atribuiría al día siguiente y desaparecería del filtro.
 *
 * Dos pasadas porque el desfase depende del instante, y el instante es justo lo que
 * se está calculando: la primera aproxima, la segunda corrige si esa aproximación
 * cayó al otro lado de un cambio de hora.
 */
export function inicioDelDiaEnZona(fecha: string, zona: string = ZONA_SEDE): Date {
  const comoUtc = new Date(`${fecha}T00:00:00Z`);
  if (Number.isNaN(comoUtc.getTime())) throw new Error(`Fecha inválida: ${fecha}`);

  const aproximado = new Date(comoUtc.getTime() - desfaseMs(comoUtc, zona));
  return new Date(comoUtc.getTime() - desfaseMs(aproximado, zona));
}

/**
 * El instante UTC en que EMPIEZA el día siguiente al dado.
 *
 * Es el límite superior de un rango con `hasta` inclusivo, y se expresa así —con un
 * `<` sobre el día siguiente— en vez de restar un milisegundo al final del día: no
 * hay forma de dejarse fuera el último segundo por accidente.
 */
export function finDelDiaEnZona(fecha: string, zona: string = ZONA_SEDE): Date {
  const inicio = inicioDelDiaEnZona(fecha, zona);
  // Sumar 24 h y renormalizar: un día no siempre dura 24 h donde hay cambio de hora.
  return inicioDelDiaEnZona(fechaEnZona(new Date(inicio.getTime() + 36 * 60 * 60_000), zona), zona);
}
