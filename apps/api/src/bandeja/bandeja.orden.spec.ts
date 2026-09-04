import { compararPendientes, esperaEnMinutos, inicioDeEspera, ordenarPendientes } from './bandeja.orden';

describe('orden de la bandeja', () => {
  const fila = (prioridad: string, minutosEsperando: number) => ({ prioridad, minutosEsperando });

  it('RN-05.3: la prioridad manda, y dentro de ella quien lleva más esperando', () => {
    const orden = ordenarPendientes([
      fila('baja', 200), fila('alta', 5), fila('media', 90), fila('alta', 60), fila('media', 10),
    ]);
    expect(orden).toEqual([
      fila('alta', 60), fila('alta', 5), fila('media', 90), fila('media', 10), fila('baja', 200),
    ]);
  });

  /** Una prioridad que nadie reconoce no puede colarse por delante de una alta. */
  it('lo desconocido va al final', () => {
    expect(ordenarPendientes([fila('inventada', 999), fila('baja', 1)]))
      .toEqual([fila('baja', 1), fila('inventada', 999)]);
  });

  it('no altera la lista que recibe', () => {
    const original = [fila('baja', 1), fila('alta', 1)];
    ordenarPendientes(original);
    expect(original[0]!.prioridad).toBe('baja');
  });
});

/**
 * El reloj de la espera cambia con la reapertura: si siguiera contando desde el
 * escalamiento original, una conversación reabierta aparecería con días de espera en
 * el mismo minuto en que se reabre y desplazaría a quien lleva esperando de verdad.
 */
describe('desde cuándo se cuenta la espera', () => {
  const hace = (minutos: number) => new Date(Date.now() - minutos * 60_000);

  it('sin reapertura, se cuenta desde el escalamiento', () => {
    const escaladaTs = hace(45);
    expect(inicioDeEspera({ escaladaTs, reabiertaTs: null })).toBe(escaladaTs);
    expect(esperaEnMinutos({ escaladaTs, reabiertaTs: null })).toBe(45);
  });

  it('reabierta, el reloj arranca de cero', () => {
    const reabiertaTs = hace(3);
    expect(esperaEnMinutos({ escaladaTs: hace(4320), reabiertaTs })).toBe(3);
    expect(inicioDeEspera({ escaladaTs: hace(4320), reabiertaTs })).toBe(reabiertaTs);
  });

  it('una conversación que nunca se escaló no lleva esperando nada', () => {
    expect(esperaEnMinutos({ escaladaTs: null, reabiertaTs: null })).toBe(0);
  });
});

describe('compararPendientes', () => {
  it('empate total: se queda como estaba', () => {
    expect(compararPendientes({ prioridad: 'alta', minutosEsperando: 10 },
                              { prioridad: 'alta', minutosEsperando: 10 })).toBe(0);
  });
});
