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
    '  *GRUPO PROVIVIR*',
    '  CDC Oriente',
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
