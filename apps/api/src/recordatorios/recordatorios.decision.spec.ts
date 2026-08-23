import { decidirEnvio } from './recordatorios.decision';

const ahora = new Date('2026-09-07T15:00:00Z');
const hace = (horas: number): Date => new Date(ahora.getTime() - horas * 3_600_000);

describe('RN-05 · un recordatorio fuera de la ventana de Meta no sale como texto libre', () => {
  it('dentro de la ventana va el ticket completo, aunque haya plantilla', () => {
    expect(decidirEnvio({ ultimoMensajePaciente: hace(3), ahora, plantilla: 'recordatorio_24h' }))
      .toEqual({ modo: 'texto' });
  });

  it('fuera de la ventana sale la plantilla aprobada', () => {
    expect(decidirEnvio({ ultimoMensajePaciente: hace(30), ahora, plantilla: 'recordatorio_24h' }))
      .toEqual({ modo: 'plantilla', nombre: 'recordatorio_24h' });
  });

  it('el borde son 24 h exactas: a las 23:59 todavía cabe, a las 24:01 ya no', () => {
    expect(decidirEnvio({ ultimoMensajePaciente: hace(23.99), ahora, plantilla: 'p' }).modo).toBe('texto');
    expect(decidirEnvio({ ultimoMensajePaciente: hace(24.01), ahora, plantilla: 'p' }).modo).toBe('plantilla');
  });

  it('sin plantilla aprobada se descarta con motivo, no se intenta tres veces', () => {
    const d = decidirEnvio({ ultimoMensajePaciente: hace(30), ahora, plantilla: '' });
    expect(d.modo).toBe('descartar');
    expect(d).toHaveProperty('motivo', expect.stringContaining('sin plantilla aprobada'));
  });

  it('una plantilla en blanco no es una plantilla', () => {
    expect(decidirEnvio({ ultimoMensajePaciente: hace(30), ahora, plantilla: '   ' }).modo)
      .toBe('descartar');
  });
});

describe('RN-10.3 · quien agenda por el portal no ha escrito por WhatsApp', () => {
  it('sin mensajes del paciente no hay ventana: va por plantilla', () => {
    expect(decidirEnvio({ ultimoMensajePaciente: null, ahora, plantilla: 'confirmacion_cita' }))
      .toEqual({ modo: 'plantilla', nombre: 'confirmacion_cita' });
  });

  it('sin mensajes y sin plantilla, el motivo dice exactamente eso', () => {
    const d = decidirEnvio({ ultimoMensajePaciente: null, ahora, plantilla: '' });
    expect(d).toHaveProperty('motivo', expect.stringContaining('nunca ha escrito'));
  });
});
