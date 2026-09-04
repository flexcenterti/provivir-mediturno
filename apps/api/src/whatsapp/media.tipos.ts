import { extname } from 'node:path';

/**
 * Correspondencia entre el tipo MIME que declara Meta y la extensión con la que
 * guardamos el adjunto en disco.
 *
 * Vive aparte porque se recorre en los dos sentidos y desde dos módulos: al
 * DESCARGAR (whatsapp) se necesita la extensión, y al SERVIR (bandeja) se necesita
 * el tipo de vuelta. Guardar el MIME en la tabla habría evitado el viaje de ida y
 * vuelta, pero no compensa una migración: la extensión la escribimos nosotros y
 * el conjunto de tipos lo fija Meta, así que la conversión es total y estable.
 */
const MIME_A_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/amr': '.amr',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'application/pdf': '.pdf',
};

const EXTENSION_A_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_A_EXTENSION).map(([mime, ext]) => [ext, mime]),
);

/** Extensión con la que se guarda un adjunto recién descargado de Meta. */
export function extensionDe(mimeType?: string): string {
  if (!mimeType) return '.bin';
  return MIME_A_EXTENSION[mimeType.split(';')[0]!.trim()] ?? extname(mimeType) ?? '.bin';
}

/**
 * Tipo MIME con el que se sirve un adjunto ya guardado.
 *
 * Lo desconocido se sirve como `application/octet-stream`: es lo que el navegador
 * descarga en vez de interpretar. Junto con `X-Content-Type-Options: nosniff`, un
 * archivo inesperado no puede ejecutarse en el navegador de la asistente.
 */
export function mimeDeExtension(ruta: string): string {
  return EXTENSION_A_MIME[extname(ruta).toLowerCase()] ?? 'application/octet-stream';
}
