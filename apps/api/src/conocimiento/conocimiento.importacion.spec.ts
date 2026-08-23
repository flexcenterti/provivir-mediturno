import {
  categoriaDe,
  dividirDocumentacion,
  emparejarServicio,
} from './conocimiento.importacion';

const CATALOGO = [
  { id: 'mg', nombre: 'Medicina general · Consulta' },
  { id: 'ctrl', nombre: 'Medicina general · Control' },
  { id: 'gin', nombre: 'Ginecología' },
  { id: 'eco', nombre: 'Ecografía' },
  { id: 'ecod', nombre: 'Ecografía Doppler' },
  { id: 'vitc', nombre: 'Suero de vitamina C' },
];

describe('RN-13 · división de la documentación comercial', () => {
  it('parte por títulos en negrita, que es como la entrega el cliente', () => {
    const bloques = dividirDocumentacion(
      '**Ginecología** — Consulta de 20 minutos.\n\n**Nutrición** — Valoración de 30 minutos.',
    );
    expect(bloques).toHaveLength(2);
    expect(bloques[0]!.titulo).toBe('Ginecología');
    expect(bloques[0]!.cuerpo).toBe('Consulta de 20 minutos.');
  });

  it('acepta también encabezados markdown: el cliente manda lo que tenga', () => {
    const bloques = dividirDocumentacion('## Horarios\nDe 7 a 18.\n\n### Pagos\nEfectivo y tarjeta.');
    expect(bloques.map((b) => b.titulo)).toEqual(['Horarios', 'Pagos']);
  });

  it('conserva las líneas siguientes del mismo bloque', () => {
    const bloques = dividirDocumentacion('**Ecografía** — 20 minutos.\nRequiere orden médica.');
    expect(bloques[0]!.cuerpo).toBe('20 minutos.\nRequiere orden médica.');
  });

  it('un párrafo sin título se pega al bloque anterior en vez de perderse', () => {
    const bloques = dividirDocumentacion('**Ecografía** — 20 minutos.\n\nVen con ayuno de 6 horas.');
    expect(bloques).toHaveLength(1);
    expect(bloques[0]!.cuerpo).toContain('ayuno de 6 horas');
  });

  it('el texto suelto antes del primer título se conserva', () => {
    const bloques = dividirDocumentacion('Somos una clínica de Cali.\n\n**Ginecología** — 20 minutos.');
    expect(bloques[0]!.titulo).toBe('Información general');
    expect(bloques[1]!.titulo).toBe('Ginecología');
  });

  it('un texto vacío no produce bloques', () => {
    expect(dividirDocumentacion('')).toEqual([]);
    expect(dividirDocumentacion('\n\n  \n')).toEqual([]);
  });
});

describe('RN-13.1 · vínculo con el catálogo', () => {
  it('empareja por nombre exacto', () => {
    expect(emparejarServicio('Ginecología', CATALOGO)).toBe('gin');
    expect(emparejarServicio('ginecologia', CATALOGO)).toBe('gin');
  });

  it('«Ecografía» no se queda con el bloque de «Ecografía Doppler»', () => {
    expect(emparejarServicio('Ecografía', CATALOGO)).toBe('eco');
    expect(emparejarServicio('Ecografía Doppler', CATALOGO)).toBe('ecod');
  });

  it('empareja con una parte del nombre compuesto', () => {
    expect(emparejarServicio('Suero de vitamina C', CATALOGO)).toBe('vitc');
  });

  it('ante ambigüedad no vincula: «Medicina general» es Consulta y también Control', () => {
    // Atarlo al equivocado haría que el bot cite duración y costo que no son.
    expect(emparejarServicio('Medicina general', CATALOGO)).toBeNull();
  });

  it('un título que no corresponde a ningún servicio queda sin vincular', () => {
    expect(emparejarServicio('Horarios', CATALOGO)).toBeNull();
    expect(emparejarServicio('', CATALOGO)).toBeNull();
  });
});

describe('RN-13 · categoría del artículo', () => {
  it('con servicio vinculado es un servicio', () => {
    expect(categoriaDe('Ginecología', 'gin')).toBe('Servicios');
  });

  it('horarios, pagos y avisos son información general', () => {
    expect(categoriaDe('Horarios', null)).toBe('Información general');
    expect(categoriaDe('Formas de pago', null)).toBe('Información general');
    expect(categoriaDe('Importante', null)).toBe('Información general');
  });

  it('«Medicina general» no es información general: la palabra suelta no clasifica', () => {
    // Con un comodín sobre «general», un servicio terminaba etiquetado como
    // información de la clínica. Se vio en pantalla, no en las pruebas.
    expect(categoriaDe('Medicina general', null)).not.toBe('Información general');
    expect(categoriaDe('Medicina general', 'mg')).toBe('Servicios');
  });

  it('lo demás cae en preguntas frecuentes', () => {
    expect(categoriaDe('¿Puedo llevar acompañante?', null)).toBe('Preguntas frecuentes');
  });
});
