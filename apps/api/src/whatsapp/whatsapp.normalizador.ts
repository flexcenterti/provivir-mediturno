import type { MensajeEntrante, MensajeMeta, ValorCambio, WebhookMeta } from './whatsapp.tipos';

/** Lo que se descartó y por qué. Para la traza, no para el flujo. */
export interface Omitido {
  tipo: string;
  motivo: string;
  id?: string;
  /** Nombres de los campos que traía, sin sus valores. Ver `formaDe`. */
  forma?: string;
}

/**
 * Enumera las CLAVES de un objeto, nunca sus valores.
 *
 * Cuando Meta empieza a mandar un campo que no conocemos —los nombres de usuario
 * de WhatsApp llegan sin `from` ni `wa_id`— esto dice cómo se llama sin volcar el
 * teléfono, el alias ni el texto del paciente al registro.
 */
export function formaDe(o: unknown): string {
  if (o === null || o === undefined) return String(o);
  if (typeof o !== 'object') return typeof o;
  return `{${Object.keys(o).join(', ')}}`;
}

/**
 * RN-09.2 · multimedia entrante completo: notas de voz, fotos, videos y documentos.
 * Aquí se traduce el formato de Meta al interno; ningún otro módulo lo conoce.
 *
 * NUNCA lanza. Meta entrega varios mensajes en un mismo lote y reintenta ante un
 * 5xx: si uno raro tumbaba la petición, se perdían también los buenos que venían
 * al lado y el mismo lote volvía una y otra vez, porque reintentar un cuerpo que
 * no se puede interpretar no lo arregla nunca.
 *
 * `alOmitir` recibe lo descartado para que quien llame lo registre.
 */
export function normalizarWebhook(
  cuerpo: WebhookMeta,
  alOmitir?: (o: Omitido) => void,
): MensajeEntrante[] {
  const salida: MensajeEntrante[] = [];

  for (const entrada of cuerpo?.entry ?? []) {
    for (const cambio of entrada?.changes ?? []) {
      if (cambio?.field !== 'messages') continue;
      const valor: ValorCambio = cambio.value ?? {};
      const nombre = valor.contacts?.[0]?.profile?.name;
      // Con nombres de usuario el remitente puede no venir en `from`; el wa_id del
      // contacto es la otra forma en que Meta lo identifica.
      const waId = valor.contacts?.[0]?.wa_id;

      for (const m of valor.messages ?? []) {
        const tipo = m?.type ?? 'sin tipo';
        try {
          // Sin remitente no hay a quién responder ni con quién asociar la
          // conversación: se descarta en vez de reventar el lote.
          const remitente = m?.from ?? waId;
          if (!remitente) {
            alOmitir?.({
              tipo,
              motivo: 'sin remitente: ni `from` ni `contacts[].wa_id`',
              id: m?.id,
              // La forma del mensaje y la del contacto revelan en qué campo viene
              // el remitente cuando Meta cambia el formato.
              forma: `mensaje ${formaDe(m)} · contacto ${formaDe(valor.contacts?.[0])} · value ${formaDe(valor)}`,
            });
            continue;
          }
          const normalizado = normalizarMensaje({ ...m, from: remitente }, nombre);
          if (normalizado) salida.push(normalizado);
          else alOmitir?.({ tipo, motivo: 'tipo de mensaje no soportado', id: m.id });
        } catch (e) {
          alOmitir?.({ tipo, motivo: (e as Error).message, id: m?.id });
        }
      }
    }
  }

  return salida;
}

function normalizarMensaje(m: MensajeMeta, nombrePerfil?: string): MensajeEntrante | null {
  const ts = new Date(Number(m.timestamp) * 1000);
  const base = {
    waMessageId: m.id,
    telefono: normalizarIdentidad(m.from),
    nombrePerfil,
    // Un timestamp ilegible no justifica perder el mensaje: se usa la hora actual.
    ts: Number.isNaN(ts.getTime()) ? new Date() : ts,
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
 * WhatsApp ya NO siempre entrega el teléfono del remitente: con los nombres de
 * usuario llega un alias, y a veces no llega nada en `from`.
 *
 * Antes todo pasaba por normalizarTelefono, que se queda con los dígitos. Un
 * alias sin dígitos daba "+", el mismo valor para todos: como la conversación
 * abierta se busca por este campo, dos pacientes distintos habrían compartido
 * hilo — uno leyendo lo del otro y la IA respondiéndole con su contexto. Un alias
 * como "@paciente_2026" daba "+2026", que es un teléfono inventado.
 *
 * Por eso la identidad se marca: lo que no es un teléfono se guarda con prefijo,
 * imposible de confundir con uno y sin colisiones.
 */
export const PREFIJO_ALIAS = 'wa:';

export function normalizarIdentidad(crudo: string): string {
  const texto = String(crudo ?? '').trim();
  const digitos = texto.replace(/\D/g, '');
  // Un teléfono trae solo dígitos y separadores, y al menos siete cifras.
  const pareceTelefono = /^[+\s().-]*[\d\s().-]+$/.test(texto) && digitos.length >= 7;

  if (!pareceTelefono) return `${PREFIJO_ALIAS}${texto}`;
  return normalizarTelefono(texto);
}

/** ¿Podemos llamar, mandar SMS o cruzar con la base por este identificador? */
export const esTelefono = (identidad: string): boolean =>
  Boolean(identidad) && !identidad.startsWith(PREFIJO_ALIAS);

/** Lo que va en `to` al responder: Meta espera el mismo identificador que envió. */
export const paraEnviar = (identidad: string): string =>
  identidad.startsWith(PREFIJO_ALIAS) ? identidad.slice(PREFIJO_ALIAS.length) : identidad;

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
  // Un alias no tiene variantes. Sin esta salida temprana se generaban cadenas
  // vacías, y buscar `telefono IN ('')` casa con cualquier paciente sin teléfono:
  // se le atribuiría la conversación a quien no es.
  if (!esTelefono(e164)) return [e164];

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
