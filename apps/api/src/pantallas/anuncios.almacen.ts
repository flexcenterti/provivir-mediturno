import { resolve, sep, join } from 'node:path';

/**
 * Dónde vive el archivo de un anuncio, y la única forma de construir esa ruta.
 *
 * Va en un módulo aparte, puro, porque es la frontera de seguridad de un endpoint
 * **público**: se prueba sin base de datos y sin Nest.
 *
 * En `media/` y no en `uploads/`: ese directorio está declarado para lo que se procesa
 * y se tira, y un anuncio vive meses y se sirve. En una **subcarpeta propia** y no en la
 * raíz de `media/`, donde hoy están los adjuntos clínicos de WhatsApp: mezclarlos haría
 * que durante un incidente un `ls` no distinga un cartel de la farmacia del soporte
 * médico de un paciente.
 */
export const SUBCARPETA = 'anuncios';

/**
 * `<uuid>.png` y nada más. La ruta nunca la escribe el cliente, pero se valida igual:
 * es la defensa que sobrevive a que alguien, algún día, decida aceptar el nombre por
 * parámetro «para simplificar».
 */
const NOMBRE_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;

export const directorioDeAnuncios = (dirMedia: string): string => join(dirMedia, SUBCARPETA);

/**
 * La ruta absoluta del archivo, o `null` si el nombre no es de los nuestros o la ruta
 * se sale del directorio.
 *
 * Dos guardas y no una: el patrón del nombre, y la comprobación de que lo resuelto cae
 * dentro. La segunda es la que sigue en pie si alguien relaja la primera.
 */
export function rutaDeAnuncio(dirMedia: string, archivo: string): string | null {
  if (!NOMBRE_VALIDO.test(archivo)) return null;

  const raiz = resolve(directorioDeAnuncios(dirMedia));
  const ruta = resolve(raiz, archivo);
  // `raiz + sep` y no `raiz` a secas: sin el separador, un directorio hermano que
  // empiece igual —`anuncios-viejos`— pasaría la comprobación.
  return ruta.startsWith(raiz + sep) ? ruta : null;
}
