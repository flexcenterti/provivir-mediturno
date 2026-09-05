import { resolverVinculo } from './acceso.reglas';

/**
 * RN-06.2 · la tabla de verdad de rol × ficha.
 *
 * Es donde se cuelan los errores que después no se pueden deshacer desde la
 * interfaz: así quedó en producción una cuenta con rol médico y sin ficha.
 */
describe('resolverVinculo', () => {
  const medico = { rol: 'prestador' as const, prestadorId: 'ao' };
  const asistente = { rol: 'asistente' as const, prestadorId: null };

  it('sin pedir nada, todo se queda como estaba', () => {
    expect(resolverVinculo({ actual: medico })).toEqual(medico);
    expect(resolverVinculo({ actual: asistente })).toEqual(asistente);
  });

  it('un médico se cambia de ficha', () => {
    expect(resolverVinculo({ actual: medico, prestadorId: 'pr' }))
      .toEqual({ rol: 'prestador', prestadorId: 'pr' });
  });

  it('RN-06.2: un médico no puede quedarse sin ficha', () => {
    expect(() => resolverVinculo({ actual: medico, prestadorId: null }))
      .toThrow('RN-06.2');
  });

  it('RN-06.2: no se promueve a médico sin darle ficha', () => {
    expect(() => resolverVinculo({ actual: asistente, rol: 'prestador' }))
      .toThrow('RN-06.2');
  });

  it('se promueve a médico dando el rol y la ficha a la vez', () => {
    expect(resolverVinculo({ actual: asistente, rol: 'prestador', prestadorId: 'ao' }))
      .toEqual({ rol: 'prestador', prestadorId: 'ao' });
  });

  /** Un solo guardado: el paso intermedio —médico sin ficha— está prohibido. */
  it('dejar de ser médico suelta la ficha sola', () => {
    expect(resolverVinculo({ actual: medico, rol: 'asistente' }))
      .toEqual({ rol: 'asistente', prestadorId: null });
  });

  it('a un administrativo no se le queda una ficha pegada', () => {
    expect(resolverVinculo({ actual: { rol: 'admin', prestadorId: 'ao' } }))
      .toEqual({ rol: 'admin', prestadorId: null });
  });

  /**
   * La distinción que un refactor borra: si `undefined` se tratara como `null`,
   * cambiarle el nombre a un médico le arrancaría la ficha.
   */
  it('`undefined` no toca la ficha; `null` sí la quita', () => {
    expect(resolverVinculo({ actual: medico, prestadorId: undefined }).prestadorId).toBe('ao');
    expect(resolverVinculo({ actual: asistente, prestadorId: null }).prestadorId).toBeNull();
  });
});
