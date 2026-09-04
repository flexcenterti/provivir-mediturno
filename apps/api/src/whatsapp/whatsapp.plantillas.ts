/**
 * RN-09.3 · La confirmación de cita es TEXTO FORMATEADO tipo ticket, no una imagen.
 * Reemplaza el pantallazo que el cliente envía hoy a mano.
 */
export interface DatosTicket {
  codigo: string;
  paciente: string;
  servicio: string;
  prestador: string;
  fecha: string;
  hora: string;
  consultorio?: string | null;
  indicaciones?: string;
}

const LINEA = '━━━━━━━━━━━━━━━━━━';

export function ticketConfirmacion(d: DatosTicket): string {
  const filas = [
    LINEA,
    '  *CENTRO DE PROFESIONALES & PROVIVIR*',
    '  CPP Principal',
    LINEA,
    `*Código*     ${d.codigo}`,
    `*Paciente*   ${d.paciente}`,
    `*Servicio*   ${d.servicio}`,
    `*Profesional* ${d.prestador}`,
    `*Fecha*      ${d.fecha}`,
    `*Hora*       ${d.hora}`,
  ];

  if (d.consultorio) filas.push(`*Consultorio* ${d.consultorio}`);

  filas.push(LINEA);
  if (d.indicaciones) filas.push(d.indicaciones);
  filas.push('Preséntate 15 minutos antes en recepción.');

  return filas.join('\n');
}

/**
 * Los mismos datos, en el orden que espera la plantilla aprobada de Meta.
 *
 * Fuera de la ventana de 24 h no se puede mandar el ticket como texto libre, así
 * que la plantilla la crea el cliente en su Business Manager con **cuatro
 * variables de cuerpo, en este orden**:
 *
 *   {{1}} código · {{2}} servicio · {{3}} fecha · {{4}} hora
 *
 * Cambiar el orden aquí sin cambiarlo allá manda los datos cruzados, y Meta no
 * lo detecta: para la API son cuatro cadenas.
 */
export function parametrosTicket(d: DatosTicket): string[] {
  return [d.codigo, d.servicio, d.fecha, d.hora];
}

/**
 * Plantilla para retomar una conversación que ya se cerró, con **una sola variable
 * de cuerpo**: `{{1}}` el nombre del paciente.
 *
 * Una sola, a propósito. No hay cita de la que hablar —por eso no sirven las cuatro
 * de `parametrosTicket`— y la plantilla tiene un único trabajo: que la persona
 * conteste. En cuanto conteste se abre la ventana y la asistente escribe con todo el
 * detalle que quiera. Cuantas más variables, más formas de cruzarlas.
 *
 * Meta rechaza los parámetros vacíos y los que llevan saltos de línea, así que el
 * respaldo no es cortesía: es lo que evita que el envío falle con un paciente que
 * escribió antes de identificarse, que es el caso normal en un primer contacto.
 *
 * El respaldo es «de nuevo» porque encaja en la misma frase que un nombre y suena a
 * lo que de verdad está pasando:
 *
 *   Hola María, te escribimos de…      ← con nombre
 *   Hola de nuevo, te escribimos de…   ← sin él
 *
 * Cualquier genérico del tipo «paciente» delata que la clínica no sabe con quién
 * habla, y «hola» de respaldo daría «Hola hola».
 */
export function parametrosReapertura(nombrePaciente: string | null): string[] {
  // Solo el primer nombre: la plantilla saluda, no rellena una ficha.
  const limpio = (nombrePaciente ?? '').replace(/\s+/g, ' ').trim().split(' ')[0] ?? '';
  return [limpio.slice(0, 60) || 'de nuevo'];
}

export function ticketRecordatorio(d: DatosTicket, cuando: '24h' | 'hoy'): string {
  const encabezado = cuando === '24h'
    ? 'Te recordamos tu cita de mañana 🗓️'
    : 'Te esperamos hoy 🗓️';
  return `${encabezado}\n\n${ticketConfirmacion(d)}`;
}

export function ticketCancelacion(d: DatosTicket, motivo: string): string {
  return [
    'Tu cita fue cancelada.',
    '',
    `*Código*   ${d.codigo}`,
    `*Servicio* ${d.servicio}`,
    `*Fecha*    ${d.fecha} ${d.hora}`,
    '',
    `Motivo: ${motivo}`,
    '',
    'Escríbenos por aquí y te ayudamos a reprogramarla.',
  ].join('\n');
}

/**
 * RN-06.3 · Bloqueo de agenda con citas asignadas: se notifica al paciente
 * con opciones de reprogramación y el caso queda en manos de la asistente.
 */
export function avisoReprogramacion(d: DatosTicket): string {
  return [
    'Necesitamos reprogramar tu cita 🙏',
    '',
    `*Código*   ${d.codigo}`,
    `*Servicio* ${d.servicio}`,
    `*Fecha*    ${d.fecha} ${d.hora}`,
    '',
    'Respóndenos por aquí y te ofrecemos nuevos horarios, o escribe *AGENDAR* para verlos ahora.',
  ].join('\n');
}
