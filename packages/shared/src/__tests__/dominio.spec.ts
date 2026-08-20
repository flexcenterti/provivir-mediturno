import {
  violaIntercalado, aMinutos, aHHMM, SEDE_ID, HISTORIAL_SERVICIOS_VISIBLES,
  fechaEnZona, hoyEnSede, ZONA_SEDE,
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
