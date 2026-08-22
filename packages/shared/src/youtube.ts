/**
 * Interpretación de lo que un administrador pega en el campo de YouTube.
 *
 * Existe porque la primera versión no usaba ese campo en absoluto: el reproductor
 * recibía `listType: 'user_uploads'` sin lista ni video, un parámetro que YouTube
 * retiró hace años. Arrancaba sin fuente y el televisor mostraba «Se ha producido
 * un error», que en una sala de espera es peor que una pantalla vacía.
 *
 * Para un directo hace falta el ID del canal (`UC…`), no el `@handle`: resolver un
 * handle exige una llamada a la API de datos de YouTube, imposible desde el
 * navegador. Por eso se detecta y se explica, en vez de fallar en negro.
 */

export type FuenteYoutube =
  | { tipo: 'directo'; canalId: string }
  | { tipo: 'video'; videoId: string }
  | { tipo: 'invalida'; motivo: string };

const CANAL = /(UC[A-Za-z0-9_-]{22})/;
const VIDEO = /(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/;
const HANDLE = /youtube\.com\/@([A-Za-z0-9._-]+)/i;

export function interpretarYoutube(valor: string | null | undefined): FuenteYoutube {
  const texto = (valor ?? '').trim();
  if (!texto) return { tipo: 'invalida', motivo: 'Sin configurar' };

  // El id del canal manda: sirve tanto pegado suelto como dentro de cualquier URL.
  const canal = CANAL.exec(texto);
  if (canal) return { tipo: 'directo', canalId: canal[1]! };

  const handle = HANDLE.exec(texto);
  if (handle) {
    return {
      tipo: 'invalida',
      motivo:
        `Para emitir el directo de @${handle[1]} hace falta el ID del canal, que empieza por «UC». ` +
        'Ábrelo en YouTube, entra a cualquiera de sus videos y copia el enlace del canal desde ahí, ' +
        'o busca "channelId" en el código fuente de su página.',
    };
  }

  const video = VIDEO.exec(texto);
  if (video) return { tipo: 'video', videoId: video[1]! };

  // Un id de video pegado suelto: 11 caracteres del alfabeto de YouTube.
  if (/^[A-Za-z0-9_-]{11}$/.test(texto)) return { tipo: 'video', videoId: texto };

  return { tipo: 'invalida', motivo: 'No parece un canal ni un video de YouTube.' };
}

/**
 * URL para el iframe. El directo NO se puede montar con la API de IFrame —solo
 * acepta `videoId`— así que va como iframe normal.
 */
export function urlEmbedDirecto(canalId: string): string {
  const p = new URLSearchParams({
    channel: canalId,
    autoplay: '1',
    mute: '1',        // sin esto el navegador bloquea la reproducción automática
    controls: '0',
    playsinline: '1',
    rel: '0',
  });
  return `https://www.youtube.com/embed/live_stream?${p}`;
}
