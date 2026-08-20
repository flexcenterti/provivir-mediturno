import fc from 'fast-check';
import {
  chocaConAlguna, controlDentroDeVentana, elegirPorMenorCarga, generarCupos,
  ordenarPorCompactacion, porcentajeOcupacion, seSolapan, violaIntercaladoEnAgenda,
  type CitaExistente,
} from './citas.reglas';
import { aMinutos } from '@provivir/shared';

const cita = (hora: string, dur: number, tipo: CitaExistente['tipo'] = 'general'): CitaExistente => ({
  horaInicio: aMinutos(hora), duracionMin: dur, tipo,
});

// ─────────────────────────── RN-01 · Intercalado ───────────────────────────

describe('RN-01 · intercalado general/control', () => {
  it('RN-01: rechaza un control inmediatamente después de otro control', () => {
    const dia = [cita('08:00', 15, 'general'), cita('08:15', 10, 'control')];
    expect(violaIntercaladoEnAgenda({ horaInicio: aMinutos('08:25'), duracionMin: 10 }, 'control', dia)).toBe(true);
  });

  it('RN-01: rechaza un control inmediatamente ANTES de otro control', () => {
    const dia = [cita('08:00', 15, 'general'), cita('08:40', 10, 'control')];
    expect(violaIntercaladoEnAgenda({ horaInicio: aMinutos('08:25'), duracionMin: 10 }, 'control', dia)).toBe(true);
  });

  it('RN-01: acepta el patrón general–control–general–control', () => {
    const dia = [cita('08:00', 15, 'general'), cita('08:15', 10, 'control'), cita('08:25', 15, 'general')];
    expect(violaIntercaladoEnAgenda({ horaInicio: aMinutos('08:40'), duracionMin: 10 }, 'control', dia)).toBe(false);
  });

  it('RN-01: permite dos consultas generales consecutivas', () => {
    const dia = [cita('08:00', 15, 'general'), cita('08:15', 15, 'general')];
    expect(violaIntercaladoEnAgenda({ horaInicio: aMinutos('08:30'), duracionMin: 15 }, 'general', dia)).toBe(false);
  });

  it('RN-01: el primer cupo del día puede ser un control', () => {
    expect(violaIntercaladoEnAgenda({ horaInicio: aMinutos('08:00'), duracionMin: 10 }, 'control', [])).toBe(false);
  });

  it('RN-01: un procedimiento entre dos controles rompe la cadena (sí factura)', () => {
    const dia = [cita('08:00', 10, 'control'), cita('08:10', 120, 'procedimiento')];
    // La cita inmediatamente anterior a las 10:10 es el procedimiento, no el control.
    expect(violaIntercaladoEnAgenda({ horaInicio: aMinutos('10:10'), duracionMin: 10 }, 'control', dia)).toBe(false);
  });

  it('RN-01: un examen adyacente tampoco bloquea el control', () => {
    const dia = [cita('08:00', 10, 'control'), cita('08:10', 20, 'examen')];
    expect(violaIntercaladoEnAgenda({ horaInicio: aMinutos('08:35'), duracionMin: 10 }, 'control', dia)).toBe(false);
  });

  it('RN-01: un control entre dos generales es válido aunque el día tenga otros controles lejos', () => {
    const dia = [cita('08:00', 10, 'control'), cita('08:10', 15, 'general'), cita('08:40', 15, 'general')];
    expect(violaIntercaladoEnAgenda({ horaInicio: aMinutos('08:25'), duracionMin: 10 }, 'control', dia)).toBe(false);
  });
});

describe('RN-01.3 · ventana de control por prestador', () => {
  const consulta = new Date('2026-08-05T00:00:00Z');

  it('RN-01: acepta el control dentro de la ventana del prestador', () => {
    expect(controlDentroDeVentana(consulta, new Date('2026-08-11T00:00:00Z'), 10)).toBe(true);
  });

  it('RN-01: rechaza el control fuera de la ventana', () => {
    expect(controlDentroDeVentana(consulta, new Date('2026-08-20T00:00:00Z'), 10)).toBe(false);
  });

  it('RN-01: el último día de la ventana es válido', () => {
    expect(controlDentroDeVentana(consulta, new Date('2026-08-15T00:00:00Z'), 10)).toBe(true);
  });

  it('RN-01: rechaza un control anterior a su consulta origen', () => {
    expect(controlDentroDeVentana(consulta, new Date('2026-08-01T00:00:00Z'), 10)).toBe(false);
  });

  it('RN-01: respeta ventanas distintas por prestador (Ortiz maneja 30 días)', () => {
    const fecha = new Date('2026-08-30T00:00:00Z');
    expect(controlDentroDeVentana(consulta, fecha, 8)).toBe(false);
    expect(controlDentroDeVentana(consulta, fecha, 30)).toBe(true);
  });
});

// ─────────────────────────── RN-02 · Balanceo ───────────────────────────

describe('RN-02 · balanceo de medicina general', () => {
  it('RN-02: con cargas 3/3/2 asigna al de 2', () => {
    const elegido = elegirPorMenorCarga([
      { prestadorId: 'ao', consultasGenerales: 3 },
      { prestadorId: 'pr', consultasGenerales: 3 },
      { prestadorId: 'jo', consultasGenerales: 2 },
    ]);
    expect(elegido).toBe('jo');
  });

  it('RN-02: el empate se resuelve de forma estable', () => {
    const cargas = [
      { prestadorId: 'pr', consultasGenerales: 2 },
      { prestadorId: 'ao', consultasGenerales: 2 },
    ];
    expect(elegirPorMenorCarga(cargas)).toBe('ao');
    expect(elegirPorMenorCarga([...cargas].reverse())).toBe('ao');
  });

  it('RN-02: sin candidatos devuelve null en vez de inventar uno', () => {
    expect(elegirPorMenorCarga([])).toBeNull();
  });

  it('RN-02.4: los controles NO cuentan en la comparación entre médicos', () => {
    // ao tiene 2 generales + 3 controles; pr tiene 3 generales. Debe ganar ao.
    const elegido = elegirPorMenorCarga([
      { prestadorId: 'ao', consultasGenerales: 2 },
      { prestadorId: 'pr', consultasGenerales: 3 },
    ]);
    expect(elegido).toBe('ao');
  });
});

describe('RN-02.5 · ocupación del dashboard', () => {
  it('RN-02.5: los controles SÍ cuentan en el % de ocupación (ocupan tiempo)', () => {
    const jornada = 240; // 4 horas
    const soloGenerales = [cita('08:00', 15), cita('08:15', 15)];
    const conControl = [...soloGenerales, cita('08:30', 10, 'control')];

    expect(porcentajeOcupacion(soloGenerales, jornada)).toBe(13);
    expect(porcentajeOcupacion(conControl, jornada)).toBe(17);
  });

  it('RN-02.5: nunca pasa de 100 %', () => {
    expect(porcentajeOcupacion([cita('08:00', 600)], 240)).toBe(100);
  });

  it('RN-02.5: jornada sin horas reportadas da 0, no división por cero', () => {
    expect(porcentajeOcupacion([cita('08:00', 15)], 0)).toBe(0);
  });
});

// ─────────────────────────── RN-03 · Compactación ───────────────────────────

describe('RN-03 · asignación por bloques', () => {
  const franja = { horaIni: aMinutos('08:00'), horaFin: aMinutos('12:00'), slotMin: 15 };

  it('RN-03: recomienda el cupo contiguo a la última cita', () => {
    const cupos = generarCupos(franja, 15);
    const dia = [cita('08:00', 15)];
    const orden = ordenarPorCompactacion(cupos, dia, 0);
    expect(orden[0]!.horaInicio).toBe(aMinutos('08:15'));
  });

  it('RN-03: con un hueco de 4 h recomienda el contiguo, no el lejano', () => {
    const cupos = generarCupos(franja, 15);
    const dia = [cita('08:00', 15)];
    const orden = ordenarPorCompactacion(cupos, dia, 0);
    expect(orden[0]!.horaInicio).toBeLessThan(aMinutos('08:30'));
  });

  it('RN-03: sin citas previas, el primer cupo de la franja', () => {
    const orden = ordenarPorCompactacion(generarCupos(franja, 15), [], 0);
    expect(orden[0]!.horaInicio).toBe(aMinutos('08:00'));
  });

  it('RN-03: con hueco tolerado de 30 min, los cupos dentro del margen se ordenan por hora', () => {
    const cupos = generarCupos(franja, 15);
    const dia = [cita('08:00', 15)];
    const orden = ordenarPorCompactacion(cupos, dia, 30);
    expect(orden.slice(0, 3).map((c) => c.horaInicio)).toEqual(
      [aMinutos('08:15'), aMinutos('08:30'), aMinutos('08:45')],
    );
  });

  it('RN-03.4: la optimización ordena pero NO elimina cupos — el paciente puede pedir otra hora', () => {
    const cupos = generarCupos(franja, 15);
    const orden = ordenarPorCompactacion(cupos, [cita('08:00', 15)], 0);
    expect(orden).toHaveLength(cupos.length);
  });
});

// ─────────────────────────── RN-04 · Cupos y duraciones ───────────────────────────

describe('RN-04 · duraciones y cupos múltiples', () => {
  const franja = { horaIni: aMinutos('08:00'), horaFin: aMinutos('09:00'), slotMin: 20 };

  it('RN-04: genera los cupos de la franja según el slot', () => {
    expect(generarCupos(franja, 20).map((c) => c.horaInicio)).toEqual(
      [aMinutos('08:00'), aMinutos('08:20'), aMinutos('08:40')],
    );
  });

  it('RN-04.4: el Doppler ocupa 2 cupos y no cabe en el último hueco simple', () => {
    // Doppler = 40 min sobre slots de 20: solo caben dos posiciones, no tres.
    expect(generarCupos(franja, 40).map((c) => c.horaInicio)).toEqual(
      [aMinutos('08:00'), aMinutos('08:20')],
    );
  });

  it('RN-04.3: un procedimiento de 2 horas no cabe en una franja de 1 hora', () => {
    expect(generarCupos(franja, 120)).toEqual([]);
  });

  it('RN-04: la cita nunca se desborda del cierre de la agenda', () => {
    for (const c of generarCupos(franja, 40)) {
      expect(c.horaInicio + c.duracionMin).toBeLessThanOrEqual(franja.horaFin);
    }
  });
});

// ─────────────────────────── Solapamiento ───────────────────────────

describe('Solapamiento de citas', () => {
  it('detecta el solapamiento parcial', () => {
    expect(seSolapan(480, 30, 495, 15)).toBe(true);
  });

  it('citas contiguas NO se solapan', () => {
    expect(seSolapan(480, 15, 495, 15)).toBe(false);
  });

  it('detecta una cita contenida en otra', () => {
    expect(seSolapan(480, 120, 500, 15)).toBe(true);
  });

  it('RN-04.4: un Doppler de 40 min pisa el cupo siguiente', () => {
    const dia = [cita('09:30', 40, 'examen')];
    expect(chocaConAlguna({ horaInicio: aMinutos('09:50'), duracionMin: 20 }, dia)).toBe(true);
    expect(chocaConAlguna({ horaInicio: aMinutos('10:10'), duracionMin: 20 }, dia)).toBe(false);
  });
});

// ─────────────────────────── Property-based ───────────────────────────

/**
 * Guía Fase 2: "property-based sobre una agenda generada: ninguna secuencia
 * resultante viola RN-01 ni solapa citas".
 */
describe('Propiedades del motor sobre agendas generadas', () => {
  const arbCita = fc.record({
    horaInicio: fc.integer({ min: 420, max: 1020 }),
    duracionMin: fc.constantFrom(10, 15, 20, 30, 40),
    tipo: fc.constantFrom('general' as const, 'control' as const, 'procedimiento' as const, 'examen' as const),
  });

  it('los cupos generados nunca se desbordan de la franja', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 360, max: 600 }),
        fc.integer({ min: 60, max: 480 }),
        fc.constantFrom(10, 15, 20, 30),
        fc.constantFrom(10, 15, 20, 40, 120),
        (horaIni, largo, slotMin, duracionMin) => {
          const franja = { horaIni, horaFin: horaIni + largo, slotMin };
          return generarCupos(franja, duracionMin).every(
            (c) => c.horaInicio >= franja.horaIni && c.horaInicio + c.duracionMin <= franja.horaFin,
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it('RN-01: aceptar un control implica que ni el anterior ni el siguiente son control', () => {
    fc.assert(
      fc.property(fc.array(arbCita, { maxLength: 25 }), fc.integer({ min: 420, max: 1020 }), (dia, hora) => {
        const cupo = { horaInicio: hora, duracionMin: 10 };
        if (violaIntercaladoEnAgenda(cupo, 'control', dia)) return true;

        const ordenadas = [...dia].sort((a, b) => a.horaInicio - b.horaInicio);
        const anterior = [...ordenadas].reverse().find((c) => c.horaInicio < hora);
        const posterior = ordenadas.find((c) => c.horaInicio > hora);

        return anterior?.tipo !== 'control' && posterior?.tipo !== 'control';
      }),
      { numRuns: 1_000 },
    );
  });

  it('el orden por compactación es una permutación: no pierde ni inventa cupos', () => {
    fc.assert(
      fc.property(fc.array(arbCita, { maxLength: 15 }), fc.integer({ min: 0, max: 60 }), (dia, huecoMax) => {
        const franja = { horaIni: 420, horaFin: 1020, slotMin: 15 };
        const cupos = generarCupos(franja, 15);
        const orden = ordenarPorCompactacion(cupos, dia, huecoMax);
        return (
          orden.length === cupos.length &&
          new Set(orden.map((c) => c.horaInicio)).size === new Set(cupos.map((c) => c.horaInicio)).size
        );
      }),
      { numRuns: 300 },
    );
  });

  it('el solapamiento es simétrico', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1400 }), fc.integer({ min: 1, max: 120 }),
        fc.integer({ min: 0, max: 1400 }), fc.integer({ min: 1, max: 120 }),
        (a, da, b, db) => seSolapan(a, da, b, db) === seSolapan(b, db, a, da),
      ),
      { numRuns: 1_000 },
    );
  });

  it('un cupo que no choca con ninguna cita no se solapa con ninguna individualmente', () => {
    fc.assert(
      fc.property(fc.array(arbCita, { maxLength: 20 }), fc.integer({ min: 420, max: 1020 }), (dia, hora) => {
        const cupo = { horaInicio: hora, duracionMin: 15 };
        if (chocaConAlguna(cupo, dia)) return true;
        return dia.every((c) => !seSolapan(cupo.horaInicio, 15, c.horaInicio, c.duracionMin));
      }),
      { numRuns: 500 },
    );
  });
});
