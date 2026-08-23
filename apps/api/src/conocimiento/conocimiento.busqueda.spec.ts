import { decidir, normalizarPregunta, type FragmentoRecuperado } from './conocimiento.busqueda';

const frag = (puntaje: number, articuloId = 'a1'): FragmentoRecuperado => ({
  fragmentoId: `f-${puntaje}-${articuloId}`,
  articuloId,
  titulo: 'Artículo',
  version: 1,
  servicioId: null,
  texto: 'texto',
  puntaje,
});

describe('RN-13.3 · umbral y falta de cobertura', () => {
  it('sin fragmentos, escala', () => {
    const r = decidir([], 62, null);
    expect(r.tipo).toBe('sin_cobertura');
  });

  it('por debajo del umbral escala en vez de aproximar', () => {
    const r = decidir([frag(61)], 62, null);
    expect(r.tipo).toBe('sin_cobertura');
    if (r.tipo === 'sin_cobertura') expect(r.mejorPuntaje).toBe(61);
  });

  it('justo en el umbral responde: el límite es inclusivo', () => {
    expect(decidir([frag(62)], 62, null).tipo).toBe('respondida');
  });

  it('solo entrega los fragmentos que superan el umbral', () => {
    const r = decidir([frag(90), frag(70), frag(20)], 62, null);
    expect(r.tipo).toBe('respondida');
    if (r.tipo === 'respondida') {
      expect(r.fragmentos.map((f) => f.puntaje)).toEqual([90, 70]);
      expect(r.mejorPuntaje).toBe(90);
    }
  });
});

describe('RN-13.4 · el tema prohibido gana sobre el puntaje', () => {
  it('escala aunque la recuperación sea perfecta', () => {
    const r = decidir([frag(100)], 62, 'Medicamentos y dosis');
    expect(r.tipo).toBe('bloqueada');
    if (r.tipo === 'bloqueada') expect(r.tema).toBe('Medicamentos y dosis');
  });

  it('bloquea también cuando no hay nada recuperado', () => {
    expect(decidir([], 62, 'Quejas y reclamos').tipo).toBe('bloqueada');
  });
});

describe('RN-13.6 · agrupación de preguntas sin respuesta', () => {
  it('dos formas de preguntar lo mismo caen en la misma fila', () => {
    expect(normalizarPregunta('¿Tienen parqueadero?')).toBe(
      normalizarPregunta('hay parqueadero'),
    );
  });

  it('ignora tildes, signos y mayúsculas', () => {
    expect(normalizarPregunta('¿CÓMO llego?')).toBe(normalizarPregunta('como llego'));
  });

  it('el orden de las palabras no crea filas distintas', () => {
    expect(normalizarPregunta('parqueadero tienen')).toBe(normalizarPregunta('tienen parqueadero'));
  });

  it('preguntas distintas siguen siendo distintas', () => {
    expect(normalizarPregunta('¿tienen parqueadero?')).not.toBe(
      normalizarPregunta('¿tienen ecografía?'),
    );
  });

  it('una pregunta solo de palabras vacías se descarta', () => {
    expect(normalizarPregunta('¿y para mí?')).toBe('');
  });
});
