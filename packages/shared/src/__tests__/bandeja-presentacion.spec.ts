import {
  cuandoSale, ESPERA_LARGA_MIN, etiquetaDeDia, previsualizacion, resumenDeFila,
  type FilaConversacion,
} from '../bandeja-presentacion';

const YO = 'usuario-1';
const base: FilaConversacion = {
  paciente: { nombres: 'Carlos', apellidos: 'Ramírez' },
  telefono: '+573001112233',
  estado: 'escalada',
  resueltaTs: null,
  minutosEsperando: 10,
  tomadaPor: null,
  asistente: null,
};

describe('resumenDeFila', () => {
  it('el título es «apellidos, nombres»', () => {
    expect(resumenDeFila(base, YO).titulo).toBe('Ramírez, Carlos');
  });

  /**
   * Mutación que la mata: devolver «Sin registrar» como título. Dos desconocidos se
   * verían idénticos en la lista y no habría forma de distinguirlos ni de llamarlos.
   */
  it('sin ficha, el título es el teléfono: es la única identidad que hay', () => {
    expect(resumenDeFila({ ...base, paciente: null }, YO).titulo).toBe('+573001112233');
  });

  /**
   * Mutación que la mata: mirar `estado` antes que `resueltaTs`. Una conversación que
   * el bot llevaba y una asistente cerró conserva `ia_activa`, así que se pintaría
   * «Bot» y parecería viva.
   */
  it('resuelta manda sobre el estado del bot', () => {
    const r = resumenDeFila(
      { ...base, estado: 'ia_activa', resueltaTs: '2026-09-12T15:00:00Z' }, YO,
    );
    expect(r.cuando).not.toBe('Bot');
    expect(r.detalle).toMatch(/^Cerrada el/);
  });

  it('la que lleva el bot lo dice, y no finge una espera', () => {
    const r = resumenDeFila({ ...base, estado: 'ia_activa', minutosEsperando: 0 }, YO);
    expect(r.cuando).toBe('Bot');
    expect(r.detalle).toBe('La atiende el bot');
  });

  /**
   * Mutación que la mata: `>=` en vez de `>`, o cambiar el umbral. `espera-larga`
   * dejaría de marcar exactamente el punto que define RN-08.3.
   */
  it(`a ${ESPERA_LARGA_MIN + 1} min la espera es larga; a ${ESPERA_LARGA_MIN} todavía no`, () => {
    expect(resumenDeFila({ ...base, minutosEsperando: ESPERA_LARGA_MIN }, YO).esperaLarga).toBe(false);
    expect(resumenDeFila({ ...base, minutosEsperando: ESPERA_LARGA_MIN + 1 }, YO).esperaLarga).toBe(true);
  });

  it('una cerrada no se marca como espera larga por vieja que sea', () => {
    const r = resumenDeFila(
      { ...base, minutosEsperando: 4000, resueltaTs: '2026-09-12T15:00:00Z' }, YO,
    );
    expect(r.esperaLarga).toBe(false);
  });

  /**
   * Mutación que la mata: soltar el `usuarioId` de la comparación. La asistente creería
   * suyo un hilo que atiende otra persona y le escribiría encima.
   */
  it('solo dice «tú» si de verdad la tienes tú', () => {
    const conAna = { ...base, tomadaPor: 'otra', asistente: { nombre: 'Ana' } };
    expect(resumenDeFila(conAna, YO).atiende).toBe('Ana');
    expect(resumenDeFila({ ...conAna, tomadaPor: YO }, YO).atiende).toBe('Ana · tú');
  });

  it('sin tomar devuelve null, para que la interfaz decida cómo decirlo', () => {
    expect(resumenDeFila(base, YO).atiende).toBeNull();
  });
});

describe('previsualizacion', () => {
  it('el texto del último mensaje manda', () => {
    expect(previsualizacion('hola, quería cambiar mi cita', 'texto'))
      .toBe('hola, quería cambiar mi cita');
  });

  /**
   * Mutación que la mata: quitar el respaldo por tipo. `contenido` es nulo en los
   * adjuntos, así que la fila se quedaría muda justo cuando acaba de llegar algo.
   */
  it('un adjunto sin texto no deja la línea vacía', () => {
    expect(previsualizacion(null, 'audio')).toBe('🎤 Nota de voz');
    expect(previsualizacion(null, 'imagen')).toBe('📎 Imagen');
    expect(previsualizacion('   ', 'documento')).toBe('📎 Documento');
  });

  it('una conversación abierta a mano y todavía sin mensajes lo dice', () => {
    // La fase 16 dejó que una asistente abra un hilo vacío con «Escribirle».
    expect(previsualizacion(null, undefined)).toBe('Sin mensajes todavía');
  });
});

describe('etiquetaDeDia', () => {
  const ahora = new Date('2026-09-15T09:00:00');

  it('hoy se llama «Hoy»', () => {
    expect(etiquetaDeDia(new Date('2026-09-15T01:00:00'), ahora)).toBe('Hoy');
  });

  /**
   * Mutación que la mata: restar 86_400_000 en vez de comparar por día natural. A las
   * 00:30 casi todo el día de ayer cae dentro de «hace menos de 24 h» y se rotularía
   * «Hoy» — el separador diría lo contrario de lo que pasó.
   */
  it('ayer a las 23:59 es «Ayer», no «Hoy»', () => {
    const madrugada = new Date('2026-09-15T00:30:00');
    expect(etiquetaDeDia(new Date('2026-09-14T23:59:00'), madrugada)).toBe('Ayer');
  });

  it('más atrás se nombra el día', () => {
    expect(etiquetaDeDia(new Date('2026-09-10T10:00:00'), ahora)).toMatch(/septiembre/);
  });

  /**
   * Mutación que la mata: comparar el ISO completo en vez de la fecha. Saldría un
   * separador entre cada dos mensajes.
   */
  it('dos mensajes del mismo día comparten rótulo', () => {
    expect(etiquetaDeDia(new Date('2026-09-15T08:00:00'), ahora))
      .toBe(etiquetaDeDia(new Date('2026-09-15T20:00:00'), ahora));
  });
});

describe('cuandoSale', () => {
  const ahora = new Date('2026-09-15T09:00:00Z');
  const en = (min: number) => new Date(ahora.getTime() + min * 60_000).toISOString();

  it('menos de una hora, en minutos', () => {
    expect(cuandoSale(en(42), ahora)).toBe('en 42 min');
  });

  /**
   * Mutación que la mata: quitar el condicional del resto. Saldría «en 2 h 0 min», que
   * se lee como un error de redondeo.
   */
  it('dos horas justas no arrastran «0 min»', () => {
    expect(cuandoSale(en(120), ahora)).toBe('en 2 h');
    expect(cuandoSale(en(125), ahora)).toBe('en 2 h 5 min');
  });

  /**
   * Mutación que la mata: `< 0` en vez de `<= 0`. Justo al cumplirse diría «en 0 min».
   */
  it('vencido o justo ahora, «en cualquier momento»', () => {
    expect(cuandoSale(en(0), ahora)).toBe('en cualquier momento');
    expect(cuandoSale(en(-30), ahora)).toBe('en cualquier momento');
  });

  it('sin próximo envío, la secuencia se agotó', () => {
    expect(cuandoSale(null, ahora)).toBe('—');
  });
});
