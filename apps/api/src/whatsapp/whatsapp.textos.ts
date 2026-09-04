/**
 * RN-09.10 · Textos fijos del canal de WhatsApp.
 *
 * Están juntos y aparte del código de flujo porque son textos que revisa gente que no
 * lee TypeScript: el aviso legal lo aprueba la clínica y la bienvenida la corrige quien
 * lleve la comunicación. Buscarlos entre `if`s no ayuda a nadie.
 *
 * El aviso y la bienvenida NO los redacta el modelo: un texto legal que cambia de
 * palabras en cada conversación no sirve como constancia, y la presentación tras una
 * autorización tiene que ser siempre la misma.
 */

/** Lo que WhatsApp muestra en los dos botones. Meta trunca a 20 caracteres. */
export const BOTON_ACEPTO = { id: 'consentimiento_acepto', titulo: 'Acepto' } as const;
export const BOTON_NO_ACEPTO = { id: 'consentimiento_rechazo', titulo: 'No acepto' } as const;

/**
 * Aviso de tratamiento de datos. `*así*` sale en negrita en WhatsApp, también dentro de
 * un mensaje interactivo. El cuerpo admite 1024 caracteres; esto ronda los 370.
 */
export function avisoConsentimiento(politicaUrl: string): string {
  return (
    'Recuerde que al hacer uso de este canal esta aceptando el manejo de sus datos ' +
    'personales y sensibles los cuales serán tratados conforme a la *ley 1581 de 2012* ' +
    'y nuestra política de tratamiento de datos personales, que puede consultar en el ' +
    `siguiente enlace: ${politicaUrl}`
  );
}

/**
 * Respaldo cuando los botones están apagados o Meta los rechaza. El consentimiento no
 * puede quedarse sin vía: sin él no se atiende a nadie.
 */
export function avisoConsentimientoTexto(politicaUrl: string): string {
  return `${avisoConsentimiento(politicaUrl)}\n\nResponde *ACEPTO* para continuar, o *NO ACEPTO*.`;
}

/** Se envía una sola vez, justo después de aceptar. */
export const BIENVENIDA =
  '¡Hola! 😊 Soy el asistente de agendamiento de Centro de Profesionales & Provivir ' +
  '—sede CPP Principal (Cali).';

/** Tras rechazar. No se le atiende, pero tampoco se le deja sin salida. */
export const TRAS_RECHAZO =
  'Entiendo. Sin esa autorización no puedo atenderte por este canal. ' +
  'Puedes comunicarte con nosotros por teléfono o acercarte a la sede, y con gusto te ayudamos.';

/**
 * Reconoce la respuesta al aviso. Prioriza el id del botón, que es inequívoco, y cae al
 * texto para el respaldo escrito y para quien conteste a mano en vez de pulsar.
 *
 * Se compara sin tildes y en minúscula: «acepto», «Acepto», «ACEPTÓ» son la misma cosa.
 */
export function leerRespuestaConsentimiento(
  botonId: string | undefined,
  texto: string | undefined,
): 'acepta' | 'rechaza' | null {
  if (botonId === BOTON_ACEPTO.id) return 'acepta';
  if (botonId === BOTON_NO_ACEPTO.id) return 'rechaza';

  const limpio = (texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (!limpio) return null;

  // El rechazo se comprueba primero: «no acepto» contiene «acepto».
  if (/^(no acepto|no|rechazo|no autorizo)$/.test(limpio)) return 'rechaza';
  if (/^(acepto|si|si acepto|autorizo|de acuerdo)$/.test(limpio)) return 'acepta';
  return null;
}
