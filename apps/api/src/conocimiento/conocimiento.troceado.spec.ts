import { MAXIMO_PALABRAS, OBJETIVO_PALABRAS, SOLAPE_PALABRAS, trocear } from './conocimiento.troceado';

const palabras = (n: number, prefijo = 'palabra'): string =>
  Array.from({ length: n }, (_, i) => `${prefijo}${i}`).join(' ');

describe('RN-13 · troceado de artículos', () => {
  it('un artículo vacío no produce fragmentos', () => {
    expect(trocear('')).toEqual([]);
    expect(trocear('   \n\n  ')).toEqual([]);
  });

  it('corta por encabezados: cada servicio queda en su propio fragmento', () => {
    const md = [
      '## Ecografía Doppler',
      'Requiere ayuno de 6 horas.',
      '',
      '## Suero de vitamina C',
      'Procedimiento de 15 minutos.',
    ].join('\n');

    const fragmentos = trocear(md);
    expect(fragmentos).toHaveLength(2);
    expect(fragmentos[0]!.texto).toContain('Doppler');
    expect(fragmentos[0]!.texto).not.toContain('vitamina');
    expect(fragmentos[1]!.texto).toContain('vitamina');
  });

  it('el texto anterior al primer encabezado no se pierde', () => {
    const fragmentos = trocear('Introducción del documento.\n\n## Sección\nContenido.');
    expect(fragmentos).toHaveLength(2);
    expect(fragmentos[0]!.texto).toContain('Introducción');
  });

  it('numera los fragmentos de forma consecutiva desde cero', () => {
    const md = ['## A', 'uno', '', '## B', 'dos', '', '## C', 'tres'].join('\n');
    expect(trocear(md).map((f) => f.orden)).toEqual([0, 1, 2]);
  });

  it('una sección larga se parte y ningún fragmento excede el máximo', () => {
    const md = `## Sección larga\n\n${[1, 2, 3, 4, 5].map(() => palabras(200)).join('\n\n')}`;
    const fragmentos = trocear(md);

    expect(fragmentos.length).toBeGreaterThan(1);
    for (const f of fragmentos) {
      expect(f.texto.split(/\s+/).length).toBeLessThanOrEqual(MAXIMO_PALABRAS + SOLAPE_PALABRAS);
    }
  });

  it('los fragmentos de una sección partida se solapan, para no perder una frase cortada', () => {
    const md = `## Larga\n\n${palabras(300, 'a')}\n\n${palabras(300, 'b')}`;
    const fragmentos = trocear(md);
    expect(fragmentos.length).toBeGreaterThan(1);

    const finPrimero = fragmentos[0]!.texto.split(/\s+/).slice(-SOLAPE_PALABRAS);
    const inicioSegundo = fragmentos[1]!.texto.split(/\s+/).slice(0, SOLAPE_PALABRAS);
    expect(inicioSegundo).toEqual(finPrimero);
  });

  it('un párrafo gigante sin saltos también se parte', () => {
    const fragmentos = trocear(palabras(MAXIMO_PALABRAS * 3));
    expect(fragmentos.length).toBeGreaterThan(1);
    for (const f of fragmentos) {
      expect(f.texto.split(/\s+/).length).toBeLessThanOrEqual(OBJETIVO_PALABRAS);
    }
  });

  it('cuenta las palabras de cada fragmento', () => {
    const fragmentos = trocear('## Título\nuna dos tres');
    expect(fragmentos[0]!.tokens).toBe(fragmentos[0]!.texto.split(/\s+/).length);
  });
});
