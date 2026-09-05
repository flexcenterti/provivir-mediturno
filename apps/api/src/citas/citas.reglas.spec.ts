import fc from 'fast-check';
import {
  chocaConAlguna, CITAS_POR_DIA_AUTOSERVICIO, controlDentroDeVentana, cumpleAnticipacionMinima,
  elegirPorMenorCarga, superaCitasDelDia,
  generarCupos, ordenarPorCompactacion, porcentajeOcupacion, primeraFechaAgendable,
  seSolapan, violaIntercaladoEnAgenda,
  cabeEnFranja, intersectaFranja,
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

// ────────────────── RN-04.6 · Anticipación mínima ──────────────────

describe('RN-04.6 · anticipación mínima de agendamiento', () => {
  const hoy = new Date('2026-09-03T00:00:00Z');
  const dia = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it('RN-04.6: rechaza la fecha de hoy', () => {
    expect(cumpleAnticipacionMinima(hoy, dia('2026-09-03'), 1)).toBe(false);
  });

  it('RN-04.6: rechaza fechas pasadas', () => {
    expect(cumpleAnticipacionMinima(hoy, dia('2026-09-02'), 1)).toBe(false);
    expect(cumpleAnticipacionMinima(hoy, dia('2026-08-20'), 1)).toBe(false);
  });

  it('RN-04.6: acepta mañana', () => {
    expect(cumpleAnticipacionMinima(hoy, dia('2026-09-04'), 1)).toBe(true);
  });

  it('RN-04.6: acepta cualquier día posterior a mañana', () => {
    expect(cumpleAnticipacionMinima(hoy, dia('2026-12-24'), 1)).toBe(true);
  });

  it('RN-04.6: respeta una anticipación configurada mayor a un día', () => {
    // Con 3 días de anticipación, el día 5 todavía no es agendable y el 6 sí.
    expect(cumpleAnticipacionMinima(hoy, dia('2026-09-05'), 3)).toBe(false);
    expect(cumpleAnticipacionMinima(hoy, dia('2026-09-06'), 3)).toBe(true);
  });

  it('RN-04.6: con anticipación 0 hoy vuelve a ser agendable', () => {
    // Apagar la regla desde configuración no debe exigir un despliegue.
    expect(cumpleAnticipacionMinima(hoy, dia('2026-09-03'), 0)).toBe(true);
    expect(cumpleAnticipacionMinima(hoy, dia('2026-09-02'), 0)).toBe(false);
  });

  it('RN-04.6: la primera fecha agendable es mañana y cae a medianoche UTC', () => {
    // Medianoche UTC es como se guardan las fechas; leerla en la zona de la sede
    // (UTC−5) la correría un día hacia atrás.
    const primera = primeraFechaAgendable(hoy, 1);
    expect(primera.toISOString()).toBe('2026-09-04T00:00:00.000Z');
  });

  it('RN-04.6: cruza el fin de mes sin saltarse un día', () => {
    expect(primeraFechaAgendable(dia('2026-09-30'), 1).toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(primeraFechaAgendable(dia('2026-12-31'), 1).toISOString().slice(0, 10)).toBe('2027-01-01');
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

describe('RN-10.5 · una cita por día agendándose solo', () => {
  /**
   * El borde es lo único que hay que probar, y es donde está el error fácil.
   *
   * Mutación que la mata: `>` en vez de `>=`. Con ella harían falta dos citas para
   * bloquear la tercera, así que el paciente acabaría con dos — que es exactamente el
   * caso que se vio en producción.
   */
  it('sin citas ese día se puede agendar; con una ya no', () => {
    expect(superaCitasDelDia(0)).toBe(false);
    expect(superaCitasDelDia(1)).toBe(true);
    expect(superaCitasDelDia(2)).toBe(true);
  });

  it('el límite es uno, y está escrito una sola vez', () => {
    expect(CITAS_POR_DIA_AUTOSERVICIO).toBe(1);
    expect(superaCitasDelDia(CITAS_POR_DIA_AUTOSERVICIO)).toBe(true);
    expect(superaCitasDelDia(CITAS_POR_DIA_AUTOSERVICIO - 1)).toBe(false);
  });
});

/**
 * RN-06 · Los dos predicados de pertenencia a una franja, que NO son el mismo.
 *
 * `cabeEnFranja` dice si un cupo es legal ahí; `intersectaFranja`, si lo pisa. La
 * diferencia decide si una previsualización de impacto reporta de más o de menos.
 */
describe('cabeEnFranja', () => {
  const MANANA = { horaIni: 7 * 60, horaFin: 12 * 60, slotMin: 15 };

  /* Mata: usar `>` en el inicio — el primer cupo de la jornada dejaría de existir. */
  it('el cupo que abre la jornada cabe, y el que la cierra justo también', () => {
    expect(cabeEnFranja({ horaInicio: 7 * 60, duracionMin: 15 }, MANANA)).toBe(true);
    expect(cabeEnFranja({ horaInicio: 11 * 60 + 45, duracionMin: 15 }, MANANA)).toBe(true);
  });

  /*
   * Mata: comparar solo `horaInicio`, que es lo que hace hoy el detector de citas
   * afectadas por un bloqueo. 11:45 SÍ está alineada al slot de 15, así que lo único que
   * la descarta es que termine a las 12:15 — con una hora desalineada la prueba pasaría
   * por el otro chequeo y no probaría nada de la duración.
   */
  it('un cupo que termina después del cierre no cabe, aunque empiece dentro', () => {
    expect(cabeEnFranja({ horaInicio: 11 * 60 + 45, duracionMin: 30 }, MANANA)).toBe(false);
    expect(cabeEnFranja({ horaInicio: 11 * 60 + 30, duracionMin: 30 }, MANANA)).toBe(true);
  });

  /*
   * Mata: quitar el `% slotMin`. Es la condición menos evidente y la más cara: mover
   * `horaIni` de 07:00 a 07:10 deja todas las citas dentro del rango pero desalineadas,
   * o sea irreprogramables — y sin esto el cambio no reportaría impacto ninguno.
   */
  it('un cupo desalineado al slot no cabe', () => {
    expect(cabeEnFranja({ horaInicio: 7 * 60 + 30, duracionMin: 15 }, MANANA)).toBe(true);
    expect(cabeEnFranja({ horaInicio: 7 * 60 + 30, duracionMin: 15 },
      { ...MANANA, horaIni: 7 * 60 + 10 })).toBe(false);
  });

  /* Mata: alinear contra medianoche (`h % slot`) en vez de contra el inicio de la franja. */
  it('el alineamiento es contra el inicio de la franja, no contra la medianoche', () => {
    const desde710 = { horaIni: 7 * 60 + 10, horaFin: 12 * 60, slotMin: 15 };
    expect(cabeEnFranja({ horaInicio: 7 * 60 + 10, duracionMin: 15 }, desde710)).toBe(true);
    expect(cabeEnFranja({ horaInicio: 7 * 60 + 25, duracionMin: 15 }, desde710)).toBe(true);
    expect(cabeEnFranja({ horaInicio: 7 * 60 + 15, duracionMin: 15 }, desde710)).toBe(false);
  });

  /*
   * Mata: cualquier `<=` ↔ `<` en UNA SOLA de las dos funciones. Es la prueba que impide
   * que el motor de cupos y la validación se separen: todo lo que el generador produce
   * tiene que caber, y todo lo que cabe tiene que producirlo.
   */
  it('todo cupo generado cabe, y todo cupo que cabe se genera', () => {
    for (const franja of [
      { horaIni: 7 * 60, horaFin: 12 * 60, slotMin: 15 },
      { horaIni: 7 * 60 + 10, horaFin: 11 * 60 + 50, slotMin: 20 },
      { horaIni: 13 * 60, horaFin: 16 * 60 + 30, slotMin: 30 },
    ]) {
      for (const duracion of [15, 20, 40]) {
        const generados = generarCupos(franja, duracion);
        expect(generados.every((c) => cabeEnFranja(c, franja))).toBe(true);

        const caben: number[] = [];
        for (let h = 0; h < 24 * 60; h++) {
          if (cabeEnFranja({ horaInicio: h, duracionMin: duracion }, franja)) caben.push(h);
        }
        expect(generados.map((c) => c.horaInicio)).toEqual(caben);
      }
    }
  });
});

describe('intersectaFranja', () => {
  const MANANA = { horaIni: 7 * 60, horaFin: 12 * 60, slotMin: 15 };

  /*
   * Mata: usar `cabeEnFranja` para calcular el impacto. Estas dos citas NO son legales
   * en la franja —una empieza antes de abrir, la otra desborda el cierre— pero viven
   * dentro de ella, y quitarla las deja huérfanas. El predicado estricto las daría por
   * no afectadas, que es sub-reportar el impacto en un diálogo de confirmación.
   */
  it('lo que pisa la franja cuenta, aunque no sea legal en ella', () => {
    expect(intersectaFranja({ horaInicio: 6 * 60 + 50, duracionMin: 30 }, MANANA)).toBe(true);
    expect(intersectaFranja({ horaInicio: 11 * 60 + 50, duracionMin: 30 }, MANANA)).toBe(true);
    expect(intersectaFranja({ horaInicio: 7 * 60 + 5, duracionMin: 15 }, MANANA)).toBe(true);
    // …y ninguna de las tres es legal ahí.
    expect(cabeEnFranja({ horaInicio: 6 * 60 + 50, duracionMin: 30 }, MANANA)).toBe(false);
    expect(cabeEnFranja({ horaInicio: 11 * 60 + 50, duracionMin: 30 }, MANANA)).toBe(false);
    expect(cabeEnFranja({ horaInicio: 7 * 60 + 5, duracionMin: 15 }, MANANA)).toBe(false);
  });

  /* Mata: `<` → `<=` en los bordes — una cita que empieza al cerrar contaría como dentro. */
  it('lo que solo toca el borde no pisa', () => {
    expect(intersectaFranja({ horaInicio: 12 * 60, duracionMin: 15 }, MANANA)).toBe(false);
    expect(intersectaFranja({ horaInicio: 6 * 60 + 45, duracionMin: 15 }, MANANA)).toBe(false);
  });
});
