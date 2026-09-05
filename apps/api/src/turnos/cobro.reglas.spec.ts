import { exigeNota, motivoPorPolitica } from './cobro.reglas';

/**
 * RN-07.6 · las seis combinaciones de política × desenlace.
 *
 * La tabla entera cabe aquí, y merece la pena tenerla explícita: es una condición
 * booleana de una línea, de las que se escriben al revés y nadie vuelve a mirar.
 */
describe('exigeNota', () => {
  it('no cobrar un servicio de pago hay que explicarlo', () => {
    expect(exigeNota('costo_pleno', 'exento')).toBe(true);
  });

  it('cobrar un servicio de pago es lo normal: sin nota', () => {
    expect(exigeNota('costo_pleno', 'cobrado')).toBe(false);
  });

  it('no cobrar un control es lo normal: la política ya es la razón', () => {
    expect(exigeNota('sin_costo', 'exento')).toBe(false);
  });

  /** La anomalía inversa, la que es fácil olvidar. */
  it('cobrar un servicio SIN costo hay que explicarlo', () => {
    expect(exigeNota('sin_costo', 'cobrado')).toBe(true);
  });

  /** No implementado: se comporta como costo pleno, nunca como gratuito. */
  it('`porcentaje` cuenta como servicio que se cobra', () => {
    expect(exigeNota('porcentaje', 'exento')).toBe(true);
    expect(exigeNota('porcentaje', 'cobrado')).toBe(false);
  });
});

describe('motivoPorPolitica', () => {
  it('cuando la política justifica la exención, la traza lo dice', () => {
    expect(motivoPorPolitica('sin_costo', 'exento')).toBe('servicio sin costo');
  });

  it('lo que exige nota no tiene motivo automático: lo pone la persona', () => {
    expect(motivoPorPolitica('costo_pleno', 'exento')).toBeUndefined();
    expect(motivoPorPolitica('sin_costo', 'cobrado')).toBeUndefined();
  });

  it('cobrar lo que se cobra no necesita explicación', () => {
    expect(motivoPorPolitica('costo_pleno', 'cobrado')).toBeUndefined();
  });
});
