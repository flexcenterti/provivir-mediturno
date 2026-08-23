import { textoDelPaso, type FichaParaMensaje } from './seguimiento.mensajes';

const FICHA: FichaParaMensaje = {
  nombre: 'Nutrición',
  duracionMin: 30,
  requiereOrden: false,
  beneficios: ['Media hora completa de acompañamiento', 'Plan escrito ajustado a tu rutina y presupuesto'],
  preparacion: 'Trae exámenes recientes si los tienes.',
};

describe('RN-09.9.3 · contenido de la secuencia', () => {
  it('el primer mensaje usa un beneficio de la ficha', () => {
    const t = textoDelPaso('seguimiento_1', FICHA);
    expect(t.toLowerCase()).toContain('media hora completa');
    expect(t).toContain('¿');
  });

  it('no repite un beneficio que ya se mencionó en la conversación', () => {
    const t = textoDelPaso('seguimiento_1', {
      ...FICHA,
      yaMencionados: ['Media hora completa de acompañamiento'],
    });
    expect(t.toLowerCase()).toContain('plan escrito');
    expect(t.toLowerCase()).not.toContain('media hora completa');
  });

  it('sin beneficios nuevos pregunta qué le frena, en vez de repetirse', () => {
    const t = textoDelPaso('seguimiento_1', { ...FICHA, beneficios: [], yaMencionados: [] });
    expect(t.toLowerCase()).toContain('qué te frena');
  });

  it('el segundo mensaje ofrece horarios concretos cuando los hay', () => {
    const t = textoDelPaso('seguimiento_2', FICHA, ['mañana 10:00 a.m.', 'jueves 3:00 p.m.']);
    expect(t).toContain('mañana 10:00 a.m.');
    expect(t).toContain('jueves 3:00 p.m.');
    expect(t).toContain('30 minutos');
  });

  it('sin horarios resuelve la barrera: la orden médica si la exige', () => {
    const t = textoDelPaso('seguimiento_2', { ...FICHA, requiereOrden: true }, []);
    expect(t.toLowerCase()).toContain('orden médica');
  });

  it('sin horarios ni orden, resuelve la preparación', () => {
    const t = textoDelPaso('seguimiento_2', FICHA, []);
    expect(t.toLowerCase()).toContain('exámenes recientes');
  });

  it('el cierre NO lleva pregunta: exigir respuesta sería un cuarto intento', () => {
    const t = textoDelPaso('cierre', FICHA);
    expect(t).not.toContain('?');
    expect(t).not.toContain('¿');
  });

  it('los tres mensajes son distintos entre sí', () => {
    const uno = textoDelPaso('seguimiento_1', FICHA);
    const dos = textoDelPaso('seguimiento_2', FICHA, ['mañana 10:00 a.m.']);
    const tres = textoDelPaso('cierre', FICHA);
    expect(new Set([uno, dos, tres]).size).toBe(3);
  });

  it('cada mensaje lleva un solo llamado a la acción', () => {
    for (const paso of ['seguimiento_1', 'seguimiento_2'] as const) {
      const t = textoDelPaso(paso, FICHA, ['mañana 10:00 a.m.']);
      expect((t.match(/\?/g) ?? []).length).toBe(1);
    }
  });
});
