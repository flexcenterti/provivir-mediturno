/**
 * Qué imagen es un archivo, mirando sus primeros bytes.
 *
 * La lista blanca de extensiones de `opcionesSubida` mira el NOMBRE que mandó el
 * navegador, y eso no basta para un archivo que va a servirse desde una ruta pública y
 * a renderizarse en un `<img>`: cualquier cosa llamada `.png` pasaría. Aquí se mira el
 * contenido, que es lo único que quien sube no elige libremente.
 *
 * Es lista **blanca**: lo que no se reconoce se rechaza. Con una lista negra, cada
 * formato nuevo y peligroso entraría solo hasta que alguien se acordara de prohibirlo.
 */

export type MimeImagen = 'image/png' | 'image/jpeg' | 'image/webp';

/**
 * El tipo real del archivo, o `null`.
 *
 * **GIF queda fuera a propósito**: un GIF animado es una rotación colada por el formato,
 * y la franja de anuncios se decidió fija. **SVG también, y es lo importante**: es XML,
 * admite `<script>`, no tiene firma que olfatear, y servido desde `/api` correría en el
 * mismo origen que la API.
 */
export function tipoDeImagen(cabecera: Uint8Array): MimeImagen | null {
  // Los OCHO bytes del PNG: los cuatro últimos son el detector de corrupción del propio
  // formato, y recortar a `\x89PNG` deja pasar cualquier basura que empiece igual.
  if (casa(cabecera, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // TRES y no cuatro: el cuarto varía según el marcador (E0 en JFIF, E1 en EXIF, DB, EE…),
  // así que exigir cuatro rechazaría cualquier foto sacada con una cámara.
  if (casa(cabecera, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // WebP es un contenedor RIFF y los bytes 4-7 son el tamaño del archivo, así que no se
  // puede comparar un bloque contiguo de 12. Sin comprobar además el `WEBP` de 8-11, un
  // `.wav` o un `.avi` —que también son RIFF— pasarían por imagen.
  if (casa(cabecera, 0, [0x52, 0x49, 0x46, 0x46]) && casa(cabecera, 8, [0x57, 0x45, 0x42, 0x50])) {
    return 'image/webp';
  }
  return null;
}

/**
 * Con qué extensión se guarda cada tipo.
 *
 * `.jpg` y **nunca** `.jpeg`: la guarda de la ruta compara el nombre del archivo contra
 * una lista, y dos extensiones para un mismo tipo la rompen. Por eso es una tabla y no
 * un `mime.split('/')[1]`, que devolvería `jpeg`.
 */
export function extensionCanonica(mime: MimeImagen): '.png' | '.jpg' | '.webp' {
  return mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
}

/** Cuántos bytes hay que leer del archivo para decidir. */
export const BYTES_DE_FIRMA = 12;

function casa(cabecera: Uint8Array, posicion: number, bytes: readonly number[]): boolean {
  // No hace falta comprobar la longitud: fuera de rango `cabecera[i]` es `undefined`, que
  // no es igual a ningún byte. Una cabecera corta —o vacía— no casa con nada.
  return bytes.every((b, i) => cabecera[posicion + i] === b);
}
