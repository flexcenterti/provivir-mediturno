/**
 * Cómo se lee una conversación en la lista de la bandeja.
 *
 * Vive aquí y no en el backoffice porque el backoffice no tiene runner de pruebas, y
 * esto es exactamente el tipo de lógica que se rompe en silencio: un `>=` de más deja
 * de marcar las esperas largas, y una guarda en el orden equivocado pinta como viva una
 * conversación cerrada. `youtube.ts` es el precedente de lógica de presentación del
 * frontend viviendo en el paquete compartido.
 *
 * Las que dependen del reloj reciben `ahora` explícito. Sin eso no hay forma de probar
 * «ayer a las 23:59». `resumenDeFila` no lo necesita: `minutosEsperando` llega ya
 * calculado por el backend, que es quien tiene la hora buena.
 */

/** RN-08.3 · a partir de aquí la espera «se vuelve paisaje» y hay que destacarla. */
export const ESPERA_LARGA_MIN = 30;

export interface FilaConversacion {
  paciente: { nombres: string; apellidos: string } | null;
  telefono: string;
  estado: string;
  resueltaTs: string | null;
  minutosEsperando: number;
  tomadaPor: string | null;
  asistente: { nombre: string } | null;
}

export interface ResumenFila {
  /** Lo que va en la línea 1. Nunca vacío: si no hay ficha, el número. */
  titulo: string;
  /** La esquina derecha, abreviada. La frase entera va en `detalle`. */
  cuando: string;
  /** Para el `title` de la fila: lo que `cuando` no cabe a decir. */
  detalle: string;
  esperaLarga: boolean;
  /** Quién atiende, ya resuelto el «tú». `null` = sin tomar. */
  atiende: string | null;
}

/**
 * Resume una conversación para su fila.
 *
 * El orden de las guardas importa: **`resueltaTs` manda sobre el estado**. Una
 * conversación que el bot llevaba y una asistente cerró sigue teniendo
 * `estado: 'ia_activa'`, y mirándolo primero se pintaría «Bot» — o sea, viva.
 */
export function resumenDeFila(c: FilaConversacion, usuarioId: string): ResumenFila {
  const titulo = c.paciente
    ? `${c.paciente.apellidos}, ${c.paciente.nombres}`
    : c.telefono;

  let cuando: string;
  let detalle: string;
  if (c.resueltaTs) {
    cuando = fechaCorta(new Date(c.resueltaTs));
    detalle = `Cerrada el ${fechaLarga(new Date(c.resueltaTs))}`;
  } else if (c.estado === 'ia_activa') {
    cuando = 'Bot';
    detalle = 'La atiende el bot';
  } else {
    cuando = `${c.minutosEsperando} min`;
    detalle = `Esperando ${c.minutosEsperando} min`;
  }

  return {
    titulo,
    cuando,
    detalle,
    // Solo cuenta si sigue esperando: una cerrada con 400 minutos no es urgente.
    esperaLarga: !c.resueltaTs && c.minutosEsperando > ESPERA_LARGA_MIN,
    atiende: c.asistente
      ? (c.tomadaPor === usuarioId ? `${c.asistente.nombre} · tú` : c.asistente.nombre)
      : null,
  };
}

/**
 * Lo que se pinta bajo el nombre.
 *
 * `contenido` es nulo en un audio o una imagen, así que sin respaldo por tipo la fila
 * se queda muda justo cuando acaba de llegar algo — que es el único momento en que
 * alguien la mira.
 */
export function previsualizacion(
  ultimoMensaje: string | null,
  tipo?: string | null,
): string {
  const texto = ultimoMensaje?.trim();
  if (texto) return texto;

  switch (tipo) {
    case 'imagen': return '📎 Imagen';
    case 'audio': return '🎤 Nota de voz';
    case 'video': return '📎 Video';
    case 'documento': return '📎 Documento';
    case 'plantilla': return 'Plantilla enviada';
    default: return 'Sin mensajes todavía';
  }
}

/**
 * Rótulo del separador de día en el chat.
 *
 * Se compara por día natural y NO restando 24 h: a las 00:30, «hace menos de un día»
 * incluye casi todo el día anterior, y el chat rotularía «Hoy» mensajes de ayer.
 */
export function etiquetaDeDia(ts: Date, ahora: Date = new Date()): string {
  const dia = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  if (dia(ts) === dia(ahora)) return 'Hoy';

  const ayer = new Date(ahora);
  ayer.setDate(ayer.getDate() - 1);
  if (dia(ts) === dia(ayer)) return 'Ayer';

  return ts.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Cuándo sale el próximo mensaje de una secuencia de seguimiento (RN-09.9.8). */
export function cuandoSale(proximoEnvio: string | null, ahora: Date = new Date()): string {
  if (!proximoEnvio) return '—';

  const minutos = Math.round((new Date(proximoEnvio).getTime() - ahora.getTime()) / 60_000);
  // `<= 0` y no `< 0`: a los 0 minutos ya toca, y «en 0 min» no dice nada.
  if (minutos <= 0) return 'en cualquier momento';
  if (minutos < 60) return `en ${minutos} min`;

  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  // Sin el condicional sale «en 2 h 0 min», que se lee como un error de redondeo.
  return m === 0 ? `en ${h} h` : `en ${h} h ${m} min`;
}

const fechaCorta = (d: Date) =>
  d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });

const fechaLarga = (d: Date) =>
  d.toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
