/**
 * Troceado de artículos para indexar (RN-13).
 *
 * Se corta primero por encabezados de markdown, porque el cliente entrega la
 * documentación con un título por servicio (P6) y ese corte respeta el sentido:
 * un fragmento que mezcla dos servicios recupera mal para ambos.
 *
 * Solo cuando una sección excede el máximo se parte por párrafos, con solape,
 * para no cortar una indicación de preparación por la mitad.
 *
 * Las medidas van en PALABRAS y no en tokens: no hay tokenizador en el backend y
 * traer uno por esto no se justifica. La equivalencia aproximada en español es de
 * ~1,4 tokens por palabra, así que 350 palabras ≈ 500 tokens, el objetivo del ADR.
 */

export const OBJETIVO_PALABRAS = 350;
export const MAXIMO_PALABRAS = 550;
export const SOLAPE_PALABRAS = 70;

export interface Fragmento {
  orden: number;
  texto: string;
  /** Palabras, no tokens. Sirve para diagnosticar troceados raros desde el backoffice. */
  tokens: number;
}

const palabras = (t: string): string[] => t.trim().split(/\s+/).filter(Boolean);
const esEncabezado = (linea: string): boolean => /^#{1,6}\s+\S/.test(linea);

/** Secciones delimitadas por encabezados; el texto anterior al primero es una sección. */
function porEncabezados(markdown: string): string[] {
  const secciones: string[] = [];
  let actual: string[] = [];

  for (const linea of markdown.split('\n')) {
    if (esEncabezado(linea) && actual.some((l) => l.trim())) {
      secciones.push(actual.join('\n').trim());
      actual = [linea];
    } else {
      actual.push(linea);
    }
  }
  if (actual.some((l) => l.trim())) secciones.push(actual.join('\n').trim());
  return secciones.filter(Boolean);
}

/** Parte una sección larga por párrafos, arrastrando solape entre trozos. */
function porParrafos(seccion: string): string[] {
  const parrafos = seccion.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const trozos: string[] = [];
  let acumulado: string[] = [];
  let cuenta = 0;

  const cerrar = (): void => {
    if (!acumulado.length) return;
    trozos.push(acumulado.join('\n\n'));
    // El solape se toma del final del trozo que se cierra, para que una frase
    // partida entre dos fragmentos siga siendo recuperable desde cualquiera.
    const cola = palabras(acumulado.join(' ')).slice(-SOLAPE_PALABRAS);
    acumulado = cola.length ? [cola.join(' ')] : [];
    cuenta = cola.length;
  };

  for (const parrafo of parrafos) {
    const n = palabras(parrafo).length;

    // Un párrafo que por sí solo pasa el máximo se parte por palabras: es raro,
    // pero un bloque sin saltos no puede dejar el fragmento fuera de control.
    if (n > MAXIMO_PALABRAS) {
      cerrar();
      const todas = palabras(parrafo);
      for (let i = 0; i < todas.length; i += OBJETIVO_PALABRAS) {
        trozos.push(todas.slice(i, i + OBJETIVO_PALABRAS).join(' '));
      }
      acumulado = [];
      cuenta = 0;
      continue;
    }

    if (cuenta + n > OBJETIVO_PALABRAS && acumulado.length) cerrar();
    acumulado.push(parrafo);
    cuenta += n;
  }

  if (acumulado.length) trozos.push(acumulado.join('\n\n'));
  return trozos;
}

/**
 * Devuelve los fragmentos listos para indexar. Un artículo vacío no produce
 * ninguno: publicar algo sin contenido no debe dejar el índice en un estado raro.
 */
export function trocear(markdown: string): Fragmento[] {
  const fragmentos: string[] = [];

  for (const seccion of porEncabezados(markdown)) {
    if (palabras(seccion).length <= MAXIMO_PALABRAS) fragmentos.push(seccion);
    else fragmentos.push(...porParrafos(seccion));
  }

  return fragmentos
    .map((t) => t.trim())
    .filter(Boolean)
    .map((texto, orden) => ({ orden, texto, tokens: palabras(texto).length }));
}
