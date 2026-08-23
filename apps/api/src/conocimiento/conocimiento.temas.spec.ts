import {
  parsearTemas,
  temaProhibido,
  TEMAS_PROHIBIDOS_POR_DEFECTO,
} from './conocimiento.temas';

describe('RN-13.4 · temas de escalamiento obligatorio', () => {
  it('detecta consejo clínico', () => {
    expect(temaProhibido('Me duele el pecho, ¿qué tengo?')).toBe('Consejo o diagnóstico clínico');
  });

  it('detecta interpretación de exámenes', () => {
    expect(temaProhibido('¿Qué significa que mi resultado salió alto?')).toBe(
      'Interpretación de exámenes o fórmulas',
    );
  });

  it('detecta medicamentos y dosis', () => {
    expect(temaProhibido('¿Puedo tomar dos pastillas cada cuantas horas?')).toBe('Medicamentos y dosis');
  });

  it('detecta negociación de precios', () => {
    expect(temaProhibido('¿Me hacen un descuento?')).toBe('Negociación de precios o descuentos');
  });

  it('ignora tildes y mayúsculas: el paciente escribe como puede', () => {
    expect(temaProhibido('QUÉ SIGNIFICA mi resultado')).toBe('Interpretación de exámenes o fórmulas');
    expect(temaProhibido('que significa mi resultado')).toBe('Interpretación de exámenes o fórmulas');
  });

  it('una pregunta operativa normal no queda bloqueada', () => {
    expect(temaProhibido('¿A qué hora abren los sábados?')).toBeNull();
    expect(temaProhibido('¿Cómo me preparo para la ecografía?')).toBeNull();
    expect(temaProhibido('¿Puedo pagar con Nequi?')).toBeNull();
  });

  it('cuando coinciden varios, gana el primero de la lista: el motivo debe ser predecible', () => {
    const temas = [
      { tema: 'Primero', senales: ['descuento'] },
      { tema: 'Segundo', senales: ['descuento'] },
    ];
    expect(temaProhibido('quiero un descuento', temas)).toBe('Primero');
  });
});

describe('RN-13.4 · lectura de la lista desde configuración', () => {
  it('sin valor configurado usa la propuesta base', () => {
    expect(parsearTemas(undefined)).toBe(TEMAS_PROHIBIDOS_POR_DEFECTO);
    expect(parsearTemas('')).toBe(TEMAS_PROHIBIDOS_POR_DEFECTO);
  });

  it('un JSON válido reemplaza la lista', () => {
    const temas = parsearTemas(JSON.stringify([{ tema: 'Convenios', senales: ['convenio'] }]));
    expect(temas).toHaveLength(1);
    expect(temaProhibido('¿tienen convenio con Sura?', temas)).toBe('Convenios');
  });

  it('un JSON roto cae a la propuesta base en vez de dejar al bot sin guardarraíl', () => {
    expect(parsearTemas('{esto no es json')).toBe(TEMAS_PROHIBIDOS_POR_DEFECTO);
    expect(parsearTemas('"un string"')).toBe(TEMAS_PROHIBIDOS_POR_DEFECTO);
  });

  it('una lista vacía también cae a la base: dejarla vacía apagaría el guardarraíl clínico', () => {
    expect(parsearTemas('[]')).toBe(TEMAS_PROHIBIDOS_POR_DEFECTO);
  });

  it('descarta entradas mal formadas y conserva las buenas', () => {
    const temas = parsearTemas(
      JSON.stringify([{ tema: 'Bueno', senales: ['x'] }, { nada: true }, { tema: 'Sin señales' }]),
    );
    expect(temas.map((t) => t.tema)).toEqual(['Bueno']);
  });
});
