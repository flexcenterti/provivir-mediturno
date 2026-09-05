import { numeroDeContacto } from './contacto';

describe('numeroDeContacto', () => {
  it('prefiere el de WhatsApp', () => {
    expect(numeroDeContacto({ whatsapp: '+573001112233', telefono: '+573009998877' }))
      .toBe('+573001112233');
  });

  it('cae al teléfono cuando no hay WhatsApp', () => {
    expect(numeroDeContacto({ whatsapp: null, telefono: '+573009998877' }))
      .toBe('+573009998877');
  });

  /**
   * El caso que motivó extraer la función: con `??` una cadena vacía NO es nulo, así
   * que se devolvía `''` y el aviso salía hacia ninguna parte teniendo el fijo a mano.
   *
   * Mutación que la mata: volver a `whatsapp ?? telefono`.
   */
  it('la cadena vacía no es un número: cae al respaldo', () => {
    expect(numeroDeContacto({ whatsapp: '', telefono: '+573009998877' }))
      .toBe('+573009998877');
    expect(numeroDeContacto({ whatsapp: '   ', telefono: '+573009998877' }))
      .toBe('+573009998877');
  });

  it('sin ningún número devuelve null, no una cadena vacía', () => {
    expect(numeroDeContacto({ whatsapp: '', telefono: '' })).toBeNull();
    expect(numeroDeContacto({ whatsapp: null, telefono: null })).toBeNull();
    expect(numeroDeContacto({})).toBeNull();
  });
});
