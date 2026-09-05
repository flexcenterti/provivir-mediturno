import { resolve } from 'node:path';
import { directorioDeAnuncios, rutaDeAnuncio } from './anuncios.almacen';

const MEDIA = '/app/media';
const UUID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';

describe('rutaDeAnuncio', () => {
  /* Mata: devolver `null` siempre, que dejaría toda imagen inalcanzable. */
  it('un nombre nuestro resuelve dentro del directorio de anuncios', () => {
    expect(rutaDeAnuncio(MEDIA, `${UUID}.png`)).toBe(resolve(directorioDeAnuncios(MEDIA), `${UUID}.png`));
  });

  /*
   * Mata: quitar el patrón del nombre y fiarse de que la ruta siempre la escribe el
   * servidor. Es la guarda que sigue en pie el día que alguien acepte el nombre por
   * parámetro «para simplificar» — y este endpoint es PÚBLICO.
   */
  it('cualquier cosa con travesía o extensión ajena se rechaza', () => {
    expect(rutaDeAnuncio(MEDIA, `../${UUID}.png`)).toBeNull();
    expect(rutaDeAnuncio(MEDIA, '../../etc/passwd')).toBeNull();
    expect(rutaDeAnuncio(MEDIA, `${UUID}.svg`)).toBeNull();
    expect(rutaDeAnuncio(MEDIA, `${UUID}.png.html`)).toBeNull();
    expect(rutaDeAnuncio(MEDIA, 'adjunto-de-paciente.jpg')).toBeNull();
  });

  /*
   * Mata: comparar con `startsWith(raiz)` sin el separador. Un directorio hermano con
   * el mismo prefijo —`media/anuncios-viejos`— pasaría la comprobación.
   *
   * Hoy el patrón del nombre ya lo impide, así que esta prueba fija la SEGUNDA guarda:
   * se comprueba llamando a la función con una raíz que termina donde empieza el
   * hermano.
   */
  it('un directorio hermano con el mismo prefijo no cuenta como dentro', () => {
    const raiz = resolve(directorioDeAnuncios(MEDIA));
    expect(raiz.endsWith('/anuncios')).toBe(true);
    // La ruta de un hermano nunca puede salir de la función, pase lo que pase.
    expect(rutaDeAnuncio(MEDIA, `${UUID}.png`)!.startsWith(raiz + '/')).toBe(true);
  });
});
