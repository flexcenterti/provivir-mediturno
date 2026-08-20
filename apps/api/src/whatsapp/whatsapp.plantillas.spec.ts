import { avisoReprogramacion, ticketCancelacion, ticketConfirmacion, ticketRecordatorio } from './whatsapp.plantillas';

const datos = {
  codigo: 'M0104',
  paciente: 'Ana Torres',
  servicio: 'Medicina general · Consulta',
  prestador: 'Dra. Pamela Ríos',
  fecha: '2026-08-24',
  hora: '08:45',
  consultorio: 'Consultorio 2',
};

/** RN-09.3 · la confirmación es texto formateado tipo ticket, no una imagen. */
describe('RN-09.3 · plantillas de texto formateado', () => {
  it('RN-09.3: el ticket incluye fecha, hora, prestador, servicio y código', () => {
    const t = ticketConfirmacion(datos);
    expect(t).toContain('M0104');
    expect(t).toContain('Ana Torres');
    expect(t).toContain('Medicina general');
    expect(t).toContain('Dra. Pamela Ríos');
    expect(t).toContain('2026-08-24');
    expect(t).toContain('08:45');
  });

  it('RN-09.3: incluye indicaciones cuando las hay', () => {
    const t = ticketConfirmacion({ ...datos, indicaciones: 'Trae tu orden médica.' });
    expect(t).toContain('Trae tu orden médica.');
  });

  it('omite el consultorio si no se conoce', () => {
    const t = ticketConfirmacion({ ...datos, consultorio: null });
    expect(t).not.toContain('Consultorio');
  });

  it('el recordatorio de 24 h se distingue del del mismo día', () => {
    expect(ticketRecordatorio(datos, '24h')).toContain('mañana');
    expect(ticketRecordatorio(datos, 'hoy')).toContain('hoy');
  });

  it('la cancelación explica el motivo y ofrece reprogramar', () => {
    const t = ticketCancelacion(datos, 'Agenda bloqueada');
    expect(t).toContain('Agenda bloqueada');
    expect(t).toMatch(/reprogramar/i);
  });

  it('RN-06.3: el aviso de reprogramación ofrece opciones al paciente', () => {
    const t = avisoReprogramacion(datos);
    expect(t).toContain('M0104');
    expect(t).toMatch(/reprogramar/i);
  });

  it('D6: ninguna plantilla usa la palabra "urgencia"', () => {
    const todas = [
      ticketConfirmacion(datos),
      ticketRecordatorio(datos, '24h'),
      ticketCancelacion(datos, 'x'),
      avisoReprogramacion(datos),
    ].join(' ');
    expect(todas).not.toMatch(/urgencia/i);
  });
});
