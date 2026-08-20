import { minutosEsperando, ordenarCola, prioridadPorCondiciones, type TurnoEnCola } from './turnos.reglas';

const t = (id: string, prioridad: TurnoEnCola['prioridad'], minutos: number, condiciones: string[] = []): TurnoEnCola => ({
  id, prioridad, condiciones,
  llegadaTs: new Date(Date.UTC(2026, 7, 20, 8, minutos)),
});

describe('RN-05.2 · orden de la cola de atención', () => {
  it('RN-05: la prioridad alta va primero, sin importar la llegada', () => {
    const cola = ordenarCola([t('a', 'baja', 0), t('b', 'alta', 30)]);
    expect(cola.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('RN-05: dentro del mismo nivel manda el orden de llegada', () => {
    const cola = ordenarCola([t('tarde', 'media', 30), t('temprano', 'media', 5)]);
    expect(cola.map((x) => x.id)).toEqual(['temprano', 'tarde']);
  });

  it('RN-05.2: las marcas preferenciales adelantan dentro del mismo nivel', () => {
    const cola = ordenarCola([
      t('sin-marca', 'media', 5),
      t('adulto-mayor', 'media', 20, ['Adulto mayor']),
    ]);
    expect(cola.map((x) => x.id)).toEqual(['adulto-mayor', 'sin-marca']);
  });

  it('RN-05.2: la prioridad pesa más que la marca preferencial', () => {
    const cola = ordenarCola([
      t('preferencial-baja', 'baja', 5, ['Embarazo']),
      t('normal-alta', 'alta', 40),
    ]);
    expect(cola.map((x) => x.id)).toEqual(['normal-alta', 'preferencial-baja']);
  });

  it('RN-05: ordena una cola realista de sala', () => {
    const cola = ordenarCola([
      t('c', 'baja', 10),
      t('a', 'alta', 45, ['Marcación manual']),
      t('b', 'media', 8, ['Movilidad reducida']),
      t('d', 'baja', 2),
    ]);
    expect(cola.map((x) => x.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('no muta el arreglo original', () => {
    const original = [t('a', 'baja', 30), t('b', 'alta', 5)];
    const copia = [...original];
    ordenarCola(original);
    expect(original).toEqual(copia);
  });

  it('una cola vacía no revienta', () => {
    expect(ordenarCola([])).toEqual([]);
  });
});

describe('RN-05.2 · prioridad de entrada por marcas preferenciales', () => {
  it('RN-05: un paciente con marca preferencial entra con prioridad media', () => {
    expect(prioridadPorCondiciones(['Adulto mayor'])).toBe('media');
  });

  it('RN-05: sin marcas entra con prioridad baja', () => {
    expect(prioridadPorCondiciones([])).toBe('baja');
  });
});

describe('RN-08.3 · tiempo esperando', () => {
  const ahora = new Date('2026-08-20T09:00:00Z');

  it('RN-08: calcula los minutos de espera', () => {
    expect(minutosEsperando(new Date('2026-08-20T08:22:00Z'), ahora)).toBe(38);
  });

  it('RN-08: nunca devuelve negativos si el reloj se desfasa', () => {
    expect(minutosEsperando(new Date('2026-08-20T09:30:00Z'), ahora)).toBe(0);
  });
});
