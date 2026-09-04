import {
  violaIntercalado, aMinutos, aHHMM, SEDE_ID, HISTORIAL_SERVICIOS_VISIBLES,
  fechaEnZona, hoyEnSede, ZONA_SEDE, inicioDelDiaEnZona, finDelDiaEnZona,
} from '../dominio';
import { puedeModificarAgenda, ROLES } from '../roles';

/**
 * Los tests de regla llevan el ID de la RN en el nombre: así la cobertura de la
 * lógica de negocio se lee directamente del reporte (Guía §3).
 *
 * Nota de alcance: aquí se prueba el predicado base del intercalado. La regla completa
 * (ventana de control, cita origen, compactación) se implementa y prueba en el motor
 * de citas durante la Fase 2.
 */
describe('RN-01 · intercalado general/control', () => {
  it('RN-01: no permite dos controles consecutivos', () => {
    expect(violaIntercalado('control', 'control')).toBe(true);
  });

  it('RN-01: permite dos consultas generales consecutivas', () => {
    expect(violaIntercalado('general', 'general')).toBe(false);
  });

  it('RN-01: permite la secuencia general → control', () => {
    expect(violaIntercalado('general', 'control')).toBe(false);
  });

  it('RN-01: permite la secuencia control → general', () => {
    expect(violaIntercalado('control', 'general')).toBe(false);
  });

  it('RN-01: el primer cupo del día puede ser un control (no hay cita previa)', () => {
    expect(violaIntercalado(null, 'control')).toBe(false);
  });

  it('RN-01: procedimientos y exámenes no participan del intercalado', () => {
    expect(violaIntercalado('procedimiento', 'control')).toBe(false);
    expect(violaIntercalado('examen', 'control')).toBe(false);
  });
});

describe('RN-06 · gobierno de agendas', () => {
  it('RN-06: administración y asistente pueden modificar agendas', () => {
    expect(puedeModificarAgenda('admin')).toBe(true);
    expect(puedeModificarAgenda('asistente')).toBe(true);
  });

  it('RN-06: el prestador NO puede modificar su agenda (solo lectura)', () => {
    expect(puedeModificarAgenda('prestador')).toBe(false);
  });

  it('RN-06: el rol pantalla tampoco puede modificar agendas', () => {
    expect(puedeModificarAgenda('pantalla')).toBe(false);
  });
});

describe('Conversión de horas del motor', () => {
  it('convierte HH:MM a minutos desde medianoche', () => {
    expect(aMinutos('00:00')).toBe(0);
    expect(aMinutos('08:15')).toBe(495);
    expect(aMinutos('23:59')).toBe(1439);
  });

  it('es reversible', () => {
    for (const hhmm of ['07:00', '08:30', '12:45', '18:00']) {
      expect(aHHMM(aMinutos(hhmm))).toBe(hhmm);
    }
  });

  it('rechaza horas inválidas en vez de devolver NaN silencioso', () => {
    expect(() => aMinutos('24:00')).toThrow();
    expect(() => aMinutos('8:15')).toThrow();
    expect(() => aMinutos('08:60')).toThrow();
    expect(() => aMinutos('')).toThrow();
  });
});

describe('Constantes de dominio', () => {
  it('D1: la sede única es cdc-oriente', () => {
    expect(SEDE_ID).toBe('cdc-oriente');
  });

  it('RN-12.4: el historial muestra los últimos 10 servicios', () => {
    expect(HISTORIAL_SERVICIOS_VISIBLES).toBe(10);
  });

  it('define exactamente los cuatro roles del sistema', () => {
    expect([...ROLES]).toEqual(['admin', 'asistente', 'prestador', 'pantalla']);
  });
});

describe('Zona horaria de la sede', () => {
  it('calcula la fecha en Cali, no en la del servidor', () => {
    // 2026-08-21 00:30 en Berlín (UTC+2) es todavía 2026-08-20 en Cali (UTC−5).
    const momento = new Date('2026-08-20T22:30:00Z');
    expect(fechaEnZona(momento, 'America/Bogota')).toBe('2026-08-20');
    expect(fechaEnZona(momento, 'Europe/Berlin')).toBe('2026-08-21');
  });

  it('la sede opera en America/Bogota', () => {
    expect(ZONA_SEDE).toBe('America/Bogota');
  });

  it('hoyEnSede devuelve medianoche UTC del día de la sede', () => {
    expect(hoyEnSede().toISOString()).toMatch(/T00:00:00\.000Z$/);
  });
});

/**
 * Filtrar por rango de fechas lo que se guarda como INSTANTE (`creado_en`,
 * `resuelta_ts`) exige saber dónde empieza y acaba el día de la sede en UTC.
 */
describe('rango de un día en la zona de la sede', () => {
  it('el día de la sede empieza a las 05:00 UTC', () => {
    expect(inicioDelDiaEnZona('2026-09-04').toISOString()).toBe('2026-09-04T05:00:00.000Z');
    expect(finDelDiaEnZona('2026-09-04').toISOString()).toBe('2026-09-05T05:00:00.000Z');
  });

  /**
   * El caso que rompe `toISOString().slice(0, 10)`: son las 23:00 del viernes en la
   * clínica, pero en UTC ya es sábado. Recortando el ISO, esa conversación
   * desaparece del filtro del viernes y aparece en el del sábado.
   */
  it('lo ocurrido de noche en la sede sigue perteneciendo a ese día', () => {
    const casiMedianocheEnCali = new Date('2026-09-05T04:00:00Z');
    expect(fechaEnZona(casiMedianocheEnCali)).toBe('2026-09-04');
    expect(casiMedianocheEnCali >= inicioDelDiaEnZona('2026-09-04')).toBe(true);
    expect(casiMedianocheEnCali < finDelDiaEnZona('2026-09-04')).toBe(true);
    // Y no se cuela en el día siguiente.
    expect(casiMedianocheEnCali < inicioDelDiaEnZona('2026-09-05')).toBe(true);
  });

  it('el límite superior es exclusivo, así que los días encajan sin solaparse', () => {
    expect(finDelDiaEnZona('2026-09-04').getTime()).toBe(inicioDelDiaEnZona('2026-09-05').getTime());
  });

  /**
   * Colombia no cambia la hora, pero la zona es un parámetro. El 8 de marzo de 2026
   * Nueva York adelanta el reloj y ese día dura 23 h: si el cálculo asumiera 24 h
   * fijas, el rango se pasaría una hora al día siguiente.
   */
  it('acierta en una zona con cambio de hora', () => {
    expect(inicioDelDiaEnZona('2026-03-08', 'America/New_York').toISOString())
      .toBe('2026-03-08T05:00:00.000Z');
    expect(finDelDiaEnZona('2026-03-08', 'America/New_York').toISOString())
      .toBe('2026-03-09T04:00:00.000Z');
  });

  /**
   * El caso que obliga a calcular el desfase DOS veces, y que no se ve en América:
   * en una zona por delante de UTC, la medianoche UTC de la fecha cae ya dentro del
   * día siguiente local. Aproximar con ese desfase deja el resultado al otro lado
   * del cambio de hora, y con una sola pasada el día empezaría a las 23:00 del día
   * anterior. Comprobado aparte con Intl: el 27 empieza en 2026-09-26T12:00:00Z.
   */
  it('acierta en una zona por delante de UTC que además cambia la hora', () => {
    expect(inicioDelDiaEnZona('2026-09-27', 'Pacific/Auckland').toISOString())
      .toBe('2026-09-26T12:00:00.000Z');
  });

  it('una fecha ilegible falla en vez de devolver una fecha inventada', () => {
    expect(() => inicioDelDiaEnZona('ayer')).toThrow('Fecha inválida');
  });
});
