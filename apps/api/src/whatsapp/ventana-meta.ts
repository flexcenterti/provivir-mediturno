/**
 * Ventana de atención al cliente de WhatsApp.
 *
 * Meta solo admite mensajes de formato libre dentro de las 24 h que abre el
 * ÚLTIMO mensaje del paciente. Fuera de ellas, lo único que sale es una
 * **plantilla preaprobada**; un texto libre se rechaza con `#131047` y el
 * paciente no recibe nada.
 *
 * Vive en `whatsapp/` porque es una restricción de la plataforma, no de una
 * regla de negocio: la usan el seguimiento comercial (RN-09.9.6) y los
 * recordatorios de cita (RN-05), y cualquier envío proactivo que venga después.
 */
export const VENTANA_META_HORAS = 24;

/** ¿El envío cabe en la ventana que abrió el paciente con su último mensaje? */
export function dentroDeVentanaMeta(ultimoMensajePaciente: Date, envio: Date): boolean {
  return envio.getTime() - ultimoMensajePaciente.getTime() < VENTANA_META_HORAS * 60 * 60_000;
}
