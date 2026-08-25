import {
  dentroDelHorario,
  dentroDeVentanaMeta,
  HORARIO_POR_DEFECTO,
  momentoDeEnvio,
  proximoHabil,
  RETRASOS_MIN,
  retrasosValidos,
} from './seguimiento.horario';

/** Cali es UTC−5: las 12:00Z son las 07:00 en la sede. */
const enCali = (iso: string): Date => new Date(iso);

describe('RN-09.9.2 · cadencia', () => {
  it('los tres pasos caen a 2, 5 y 8 horas', () => {
    expect(RETRASOS_MIN.seguimiento_1).toBe(120);
    expect(RETRASOS_MIN.seguimiento_2).toBe(300);
    expect(RETRASOS_MIN.cierre).toBe(480);
  });

  it('el momento de envío se calcula desde T0', () => {
    const t0 = enCali('2026-09-07T13:00:00Z'); // lunes, 08:00 en Cali
    expect(momentoDeEnvio(t0, 'seguimiento_1').toISOString()).toBe('2026-09-07T15:00:00.000Z');
    expect(momentoDeEnvio(t0, 'seguimiento_2').toISOString()).toBe('2026-09-07T18:00:00.000Z');
  });

  it('RN-09.9.2: la cadencia sale de configuración, no de una constante', () => {
    const t0 = enCali('2026-09-07T13:00:00Z'); // lunes, 08:00 en Cali
    const propia = { seguimiento_1: 60, seguimiento_2: 180, cierre: 300 };

    expect(momentoDeEnvio(t0, 'seguimiento_1', undefined, undefined, propia).toISOString())
      .toBe('2026-09-07T14:00:00.000Z');
    // Y sin pasarla sigue rigiendo la de por defecto: quien no la configure no cambia.
    expect(momentoDeEnvio(t0, 'seguimiento_1').toISOString()).toBe('2026-09-07T15:00:00.000Z');
  });
});

describe('RN-09.9.6 · una cadencia mal configurada no puede salirse de la ventana', () => {
  it('la cadencia por defecto es válida', () => {
    expect(retrasosValidos(RETRASOS_MIN)).toBe(true);
  });

  it('RN-09.9.6: un cierre más allá de las 24 h no vale: solo saldría como plantilla', () => {
    expect(retrasosValidos({ seguimiento_1: 120, seguimiento_2: 300, cierre: 1_500 })).toBe(false);
  });

  it('RN-09.9.6: los pasos desordenados no valen', () => {
    // Cerrar antes del primer seguimiento dejaría la conversación cerrada sin empezar.
    expect(retrasosValidos({ seguimiento_1: 300, seguimiento_2: 120, cierre: 480 })).toBe(false);
    expect(retrasosValidos({ seguimiento_1: 120, seguimiento_2: 300, cierre: 200 })).toBe(false);
  });

  it('RN-09.9.6: un primer paso inmediato no vale: escribiría encima de la conversación', () => {
    expect(retrasosValidos({ seguimiento_1: 0, seguimiento_2: 300, cierre: 480 })).toBe(false);
  });
});

describe('RN-09.9.5 · ventana horaria', () => {
  it('un lunes al mediodía en Cali está dentro', () => {
    expect(dentroDelHorario(enCali('2026-09-07T17:00:00Z'))).toBe(true); // 12:00 Cali
  });

  it('las once de la noche en Cali está fuera', () => {
    expect(dentroDelHorario(enCali('2026-09-08T04:00:00Z'))).toBe(false); // 23:00 Cali del lunes
  });

  it('el domingo está fuera aunque sea media mañana', () => {
    expect(dentroDelHorario(enCali('2026-09-13T15:00:00Z'))).toBe(false); // domingo 10:00 Cali
  });

  it('la zona de la sede manda, no la del servidor', () => {
    // 2026-09-08T11:00Z son las 06:00 en Cali: fuera. En UTC serían las 11:00, dentro.
    expect(dentroDelHorario(enCali('2026-09-08T11:00:00Z'))).toBe(false);
  });

  it('un envío nocturno se difiere al siguiente bloque hábil', () => {
    const nocturno = enCali('2026-09-08T04:00:00Z'); // lunes 23:00 Cali
    const diferido = proximoHabil(nocturno);
    expect(diferido.getTime()).toBeGreaterThan(nocturno.getTime());
    expect(dentroDelHorario(diferido)).toBe(true);
  });

  it('un envío del domingo se difiere al lunes', () => {
    const domingo = enCali('2026-09-13T15:00:00Z');
    const diferido = proximoHabil(domingo);
    expect(dentroDelHorario(diferido)).toBe(true);
    // Menos de 24 horas después: no se salta el lunes entero.
    expect(diferido.getTime() - domingo.getTime()).toBeLessThan(24 * 3_600_000);
  });

  it('lo que ya está en horario no se mueve', () => {
    const habil = enCali('2026-09-07T17:00:00Z');
    expect(proximoHabil(habil)).toBe(habil);
  });

  it('un horario sin días hábiles no cuelga: devuelve el momento original', () => {
    const sinDias = { ...HORARIO_POR_DEFECTO, dias: [] };
    const t = enCali('2026-09-07T17:00:00Z');
    expect(proximoHabil(t, sinDias)).toBe(t);
  });
});

describe('RN-09.9.6 · ventana de 24 horas de Meta', () => {
  const t0 = enCali('2026-09-07T13:00:00Z');

  it('el cierre a las 8 horas cabe holgado', () => {
    expect(dentroDeVentanaMeta(t0, new Date(t0.getTime() + 8 * 3_600_000))).toBe(true);
  });

  it('a las 25 horas ya no cabe: solo saldría como plantilla', () => {
    expect(dentroDeVentanaMeta(t0, new Date(t0.getTime() + 25 * 3_600_000))).toBe(false);
  });

  it('el límite es estricto: exactamente 24 horas ya está fuera', () => {
    expect(dentroDeVentanaMeta(t0, new Date(t0.getTime() + 24 * 3_600_000))).toBe(false);
  });
});
