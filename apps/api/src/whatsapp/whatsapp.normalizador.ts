import type { MensajeEntrante, MensajeMeta, ValorCambio, WebhookMeta } from './whatsapp.tipos';

/**
 * RN-09.2 · multimedia entrante completo: notas de voz, fotos, videos y documentos.
 * Aquí se traduce el formato de Meta al interno; ningún otro módulo lo conoce.
 */
export function normalizarWebhook(cuerpo: WebhookMeta): MensajeEntrante[] {
  const salida: MensajeEntrante[] = [];

  for (const entrada of cuerpo.entry ?? []) {
    for (const cambio of entrada.changes ?? []) {
      if (cambio.field !== 'messages') continue;
      const valor: ValorCambio = cambio.value;
      const nombre = valor.contacts?.[0]?.profile?.name;

      for (const m of valor.messages ?? []) {
        const normalizado = normalizarMensaje(m, nombre);
        if (normalizado) salida.push(normalizado);
      }
    }
  }

  return salida;
}

function normalizarMensaje(m: MensajeMeta, nombrePerfil?: string): MensajeEntrante | null {
  const base = {
    waMessageId: m.id,
    telefono: normalizarTelefono(m.from),
    nombrePerfil,
    ts: new Date(Number(m.timestamp) * 1000),
  };

  switch (m.type) {
    case 'text':
      return { ...base, tipo: 'texto', texto: m.text?.body ?? '' };

    case 'interactive': {
      // Respuesta a un botón: se trata como texto para que la IA no distinga el canal.
      const titulo = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
      return { ...base, tipo: 'texto', texto: titulo ?? '' };
    }

    case 'audio':
      return {
        ...base, tipo: 'audio', mediaId: m.audio?.id,
        mimeType: m.audio?.mime_type, esNotaDeVoz: m.audio?.voice === true,
      };

    case 'image':
      return {
        ...base, tipo: 'imagen', mediaId: m.image?.id,
        mimeType: m.image?.mime_type, texto: m.image?.caption,
      };

    case 'video':
      return {
        ...base, tipo: 'video', mediaId: m.video?.id,
        mimeType: m.video?.mime_type, texto: m.video?.caption,
      };

    case 'document':
      return {
        ...base, tipo: 'documento', mediaId: m.document?.id,
        mimeType: m.document?.mime_type, texto: m.document?.caption ?? m.document?.filename,
      };

    // Stickers y ubicaciones no aportan al agendamiento; se registran como sistema.
    case 'sticker':
    case 'location':
    case 'button':
      return { ...base, tipo: 'sistema', texto: `[${m.type}]` };

    default:
      return null;
  }
}

/**
 * RN-09.4 · WhatsApp entrega el número sin formato. Se normaliza a E.164 con
 * prefijo de Colombia cuando llega sin indicativo, para que coincida con los
 * teléfonos de la base cargada.
 */
export function normalizarTelefono(crudo: string): string {
  const digitos = crudo.replace(/\D/g, '');
  if (digitos.length === 10 && digitos.startsWith('3')) return `+57${digitos}`;
  return `+${digitos}`;
}

/** Variantes con las que un mismo número puede estar guardado en la base. */
export function variantesDeTelefono(e164: string): string[] {
  const digitos = e164.replace(/\D/g, '');
  const sinIndicativo = digitos.startsWith('57') ? digitos.slice(2) : digitos;
  return [...new Set([
    e164,
    digitos,
    `+${digitos}`,
    sinIndicativo,
    `+57${sinIndicativo}`,
    `57${sinIndicativo}`,
  ])];
}
