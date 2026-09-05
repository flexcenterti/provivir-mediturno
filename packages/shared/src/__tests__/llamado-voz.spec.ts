import { deletrearCodigo, elegirVozEspanola, textoDeLlamado } from '../llamado-voz';

const BASE = { codigo: 'MG-042', paciente: 'María G.', prestador: 'Dra. Peña', consultorio: '3' };

describe('deletrearCodigo', () => {
  /*
   * Mata: devolver el código tal cual (identidad). Un `toContain('042')` sobreviviría
   * a esa mutación, por eso se compara la cadena entera.
   */
  it('separa letras y dígitos, y el guion se vuelve pausa', () => {
    expect(deletrearCodigo('MG-042')).toBe('M G, 0 4 2');
  });

  /* Mata: partir solo por guion. Un código sin separador quedaría sin deletrear. */
  it('un código de una sola pieza también se deletrea', () => {
    expect(deletrearCodigo('A12')).toBe('A 1 2');
  });
});

describe('textoDeLlamado', () => {
  /* Mata: sustituir `consultorio ?? prestador` por `prestador`, o invertir el orden. */
  it('dice el consultorio cuando lo hay', () => {
    expect(textoDeLlamado(BASE)).toBe('Turno M G, 0 4 2, María G., consultorio 3.');
  });

  /*
   * Mata: quitar el respaldo. La frase terminaría en «consultorio» a secas o con
   * `null`, y la sala se quedaría sin saber a dónde ir.
   */
  it('sin consultorio cae al profesional, como hace el tablero', () => {
    expect(textoDeLlamado({ ...BASE, consultorio: null }))
      .toBe('Turno M G, 0 4 2, María G., Dra. Peña.');
  });

  /*
   * Mata: concatenar sin filtrar los vacíos → «Turno M G, 0 4 2, , consultorio 3.».
   * Es el caso real de `mostrar_nombre_en_pantalla = oculto`, donde el servidor manda
   * el nombre vacío a propósito.
   */
  it('con el nombre oculto no queda una coma colgando', () => {
    expect(textoDeLlamado({ ...BASE, paciente: '' }))
      .toBe('Turno M G, 0 4 2, consultorio 3.');
  });

  /* Mata: ignorar el flag `repetido` → las dos frases salen idénticas. */
  it('un rellamado se anuncia como repetición', () => {
    expect(textoDeLlamado({ ...BASE, repetido: true })).toMatch(/^De nuevo, turno /);
  });
});

describe('elegirVozEspanola', () => {
  /*
   * Mata: caer a `voces[0]` cuando no hay española. Es LA mutación de este archivo:
   * la diferencia entre callarse y que un motor en inglés lea un nombre español a
   * todo volumen en una sala de espera.
   */
  it('sin voz en español devuelve null, no la primera que haya', () => {
    expect(elegirVozEspanola([{ lang: 'en-US', name: 'Samantha' }])).toBeNull();
    expect(elegirVozEspanola([])).toBeNull();
  });

  /* Mata: alterar el orden de preferencia, o quedarse con la primera española. */
  it('prefiere la variante más cercana a la sede', () => {
    const voces = [
      { lang: 'es-ES', name: 'Mónica' },
      { lang: 'es-CO', name: 'Carlos' },
      { lang: 'es-MX', name: 'Paulina' },
    ];
    expect(elegirVozEspanola(voces)?.name).toBe('Carlos');
  });

  /*
   * Mata: exigir `lang === 'es-CO'`. En un stick recién sacado de la caja lo probable
   * es que solo haya `es-ES`, y ahí cualquier español gana al silencio.
   */
  it('si solo hay es-ES, esa vale', () => {
    expect(elegirVozEspanola([{ lang: 'es-ES', name: 'Mónica' }])?.name).toBe('Mónica');
  });
});
