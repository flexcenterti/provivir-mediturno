import { serviciosInexistentes } from './servicios-validos';

describe('serviciosInexistentes', () => {
  const CATALOGO = ['mg', 'ctrl', 'lab', 'eco'];

  /*
   * Mata: invertir el filtro (`catalogo.has(id)`), que devolvería los válidos. Con un
   * `toHaveLength` sobreviviría en varios casos, por eso se asierta el array exacto.
   */
  it('devuelve solo los que sobran, en el orden en que se pidieron', () => {
    expect(serviciosInexistentes(['mg', 'derp', 'lab', 'vitc'], CATALOGO)).toEqual(['derp', 'vitc']);
  });

  /* Mata: devolver siempre algo, o comparar con `includes` sobre el array pedido. */
  it('si todos existen no sobra ninguno', () => {
    expect(serviciosInexistentes(['mg', 'eco'], CATALOGO)).toEqual([]);
  });

  /*
   * Mata: añadir una rama que trate la lista vacía como error. Una pantalla recién
   * creada y todavía sin configurar es un estado legítimo — se avisa en la interfaz y
   * en el propio televisor, no se rechaza.
   */
  it('pedir ninguno no es un error', () => {
    expect(serviciosInexistentes([], CATALOGO)).toEqual([]);
  });
});
