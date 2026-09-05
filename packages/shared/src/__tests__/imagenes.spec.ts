import { extensionCanonica, tipoDeImagen } from '../imagenes';

const bytes = (...v: number[]) => new Uint8Array(v);
const texto = (s: string) => new TextEncoder().encode(s);

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50);

describe('tipoDeImagen', () => {
  /* Mata: devolver `null` siempre. No se podría subir ninguna imagen. */
  it('reconoce PNG y WebP por su firma', () => {
    expect(tipoDeImagen(PNG)).toBe('image/png');
    expect(tipoDeImagen(WEBP)).toBe('image/webp');
  });

  /*
   * Mata: exigir cuatro bytes de firma JPEG. El cuarto es el marcador y varía —E0 en
   * JFIF, E1 en EXIF—, así que cualquier foto sacada con un móvil sería rechazada y el
   * operador vería «archivo no válido» con una imagen perfectamente buena delante.
   */
  it('acepta JPEG con cualquier marcador, no solo JFIF', () => {
    expect(tipoDeImagen(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1))).toBe('image/jpeg');
    expect(tipoDeImagen(bytes(0xff, 0xd8, 0xff, 0xe1, 0, 0x1c, 0x45, 0x78, 0x69, 0x66, 0, 0))).toBe('image/jpeg');
  });

  /*
   * Mata: devolver un tipo fijo, o fiarse de la extensión del nombre —que es lo único
   * que valida la subida hoy—. El HTML se llamaría `banner.png` y se serviría desde una
   * ruta PÚBLICA. Los dos últimos son el mismo defecto por el borde: lo que no alcanza a
   * ser una firma tampoco es una imagen.
   */
  it('lo que no es una imagen devuelve null', () => {
    expect(tipoDeImagen(texto('<!doctype html><script>alert(1)'))).toBeNull();
    expect(tipoDeImagen(bytes(0x89, 0x50, 0x4e))).toBeNull();
    expect(tipoDeImagen(new Uint8Array(0))).toBeNull();
  });

  /*
   * Mata: comprobar solo el `RIFF` inicial, o comparar los 12 bytes de corrido. Lo
   * primero deja pasar un WAV o un AVI; lo segundo rechaza TODOS los WebP, porque los
   * bytes 4-7 son el tamaño del archivo y cambian en cada uno.
   */
  it('un RIFF que no es WEBP no cuela', () => {
    expect(tipoDeImagen(bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45))).toBeNull();
  });

  /*
   * Mata: cambiar la lista blanca por una negra. SVG es el peligroso: es XML, admite
   * `<script>` y se serviría desde el mismo origen que la API. GIF entraría como
   * animación, que es una rotación que se decidió no tener.
   */
  it('ni SVG ni GIF son imágenes servibles', () => {
    expect(tipoDeImagen(texto('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(tipoDeImagen(texto('<?xml version="1.0"?><svg>'))).toBeNull();
    expect(tipoDeImagen(texto('GIF89a'))).toBeNull();
  });

  /*
   * Mata: buscar la firma en cualquier posición en vez de al principio. Cualquier
   * archivo que CONTENGA los bytes de un PNG en medio —un ZIP con una imagen dentro—
   * se aceptaría.
   */
  it('la firma tiene que estar al principio, no en cualquier sitio', () => {
    expect(tipoDeImagen(new Uint8Array([0x00, 0x00, ...PNG]))).toBeNull();
  });
});

describe('extensionCanonica', () => {
  /*
   * Mata: derivar la extensión partiendo el MIME por `/`, que daría `.jpeg`. Dos
   * extensiones para un mismo tipo rompen la guarda del nombre de archivo, que compara
   * contra una lista cerrada.
   */
  it('JPEG se guarda como .jpg, nunca como .jpeg', () => {
    expect(extensionCanonica('image/jpeg')).toBe('.jpg');
    expect(extensionCanonica('image/png')).toBe('.png');
    expect(extensionCanonica('image/webp')).toBe('.webp');
  });
});
