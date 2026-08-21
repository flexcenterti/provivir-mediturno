import { normalizarTelefono, normalizarWebhook, variantesDeTelefono } from './whatsapp.normalizador';
import type { WebhookMeta } from './whatsapp.tipos';

const envoltorio = (mensajes: unknown[], nombre = 'Ana Torres'): WebhookMeta => ({
  object: 'whatsapp_business_account',
  entry: [{
    id: 'entry-1',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        contacts: [{ profile: { name: nombre }, wa_id: '573002222222' }],
        messages: mensajes as never,
      },
    }],
  }],
});

describe('RN-09.2 · normalización del multimedia entrante', () => {
  it('normaliza un mensaje de texto', () => {
    const [m] = normalizarWebhook(envoltorio([
      { id: 'wamid.1', from: '573002222222', timestamp: '1755000000', type: 'text', text: { body: 'Hola' } },
    ]));
    expect(m).toMatchObject({ tipo: 'texto', texto: 'Hola', telefono: '+573002222222', nombrePerfil: 'Ana Torres' });
  });

  it('RN-09.2: normaliza una nota de voz y la distingue de un audio adjunto', () => {
    const [voz] = normalizarWebhook(envoltorio([
      { id: 'wamid.2', from: '573002222222', timestamp: '1755000000', type: 'audio', audio: { id: 'media-1', mime_type: 'audio/ogg', voice: true } },
    ]));
    expect(voz).toMatchObject({ tipo: 'audio', mediaId: 'media-1', esNotaDeVoz: true });

    const [adjunto] = normalizarWebhook(envoltorio([
      { id: 'wamid.3', from: '573002222222', timestamp: '1755000000', type: 'audio', audio: { id: 'media-2', mime_type: 'audio/mpeg', voice: false } },
    ]));
    expect(adjunto?.esNotaDeVoz).toBe(false);
  });

  it('RN-09.2: normaliza imagen, video y documento con su caption', () => {
    const mensajes = normalizarWebhook(envoltorio([
      { id: 'w.1', from: '573002222222', timestamp: '1755000000', type: 'image', image: { id: 'i1', mime_type: 'image/jpeg', caption: 'mi orden' } },
      { id: 'w.2', from: '573002222222', timestamp: '1755000000', type: 'video', video: { id: 'v1', mime_type: 'video/mp4' } },
      { id: 'w.3', from: '573002222222', timestamp: '1755000000', type: 'document', document: { id: 'd1', mime_type: 'application/pdf', filename: 'orden.pdf' } },
    ]));
    expect(mensajes.map((m) => m.tipo)).toEqual(['imagen', 'video', 'documento']);
    expect(mensajes[0]!.texto).toBe('mi orden');
    expect(mensajes[2]!.texto).toBe('orden.pdf');
  });

  it('trata la respuesta a un botón como texto', () => {
    const [m] = normalizarWebhook(envoltorio([
      { id: 'w.4', from: '573002222222', timestamp: '1755000000', type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'chat', title: 'Seguir por aquí' } } },
    ]));
    expect(m).toMatchObject({ tipo: 'texto', texto: 'Seguir por aquí' });
  });

  it('ignora los eventos de estado (entregado/leído), que no son mensajes', () => {
    const cuerpo: WebhookMeta = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'e', changes: [{ field: 'messages', value: { statuses: [{ id: 'w.1', status: 'delivered', timestamp: '1', recipient_id: '57300' }] } }] }],
    };
    expect(normalizarWebhook(cuerpo)).toEqual([]);
  });

  it('ignora campos del webhook distintos de messages', () => {
    const cuerpo: WebhookMeta = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'e', changes: [{ field: 'message_template_status_update', value: {} }] }],
    };
    expect(normalizarWebhook(cuerpo)).toEqual([]);
  });

  it('un webhook vacío no revienta', () => {
    expect(normalizarWebhook({ object: 'x' })).toEqual([]);
  });
});

describe('RN-09.4 · normalización del número de contacto', () => {
  it('agrega el indicativo de Colombia a un celular sin él', () => {
    expect(normalizarTelefono('3001112222')).toBe('+573001112222');
  });

  it('conserva un número que ya trae indicativo', () => {
    expect(normalizarTelefono('573001112222')).toBe('+573001112222');
  });

  it('limpia separadores', () => {
    expect(normalizarTelefono('+57 300 111 2222')).toBe('+573001112222');
  });

  it('genera las variantes con que un número puede estar guardado en la base', () => {
    const v = variantesDeTelefono('+573001112222');
    expect(v).toContain('+573001112222');
    expect(v).toContain('3001112222');
    expect(v).toContain('573001112222');
  });
});

/**
 * Meta entrega varios mensajes en un mismo lote y reintenta ante un 5xx. Un
 * mensaje que no se puede interpretar tumbaba la petición entera: se perdían los
 * buenos que venían al lado y el mismo lote volvía indefinidamente, porque
 * reintentar un cuerpo ilegible no lo arregla nunca. Esto ocurrió en producción.
 */
describe('un mensaje raro no puede tumbar la entrega', () => {
  it('descarta el que no trae remitente y conserva los demás', () => {
    const omitidos: Array<{ tipo: string; motivo: string }> = [];
    const mensajes = normalizarWebhook(
      envoltorio([
        { id: 'w1', type: 'text', timestamp: '1', text: { body: 'sin from' } },
        { id: 'w2', from: '573001112222', type: 'text', timestamp: '1', text: { body: 'este sí' } },
      ]),
      (o) => omitidos.push(o),
    );

    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]!.texto).toBe('este sí');
    expect(omitidos).toEqual([{ tipo: 'text', motivo: 'el mensaje no trae remitente (from)', id: 'w1' }]);
  });

  it('avisa del tipo no soportado sin descartar el lote', () => {
    const omitidos: Array<{ tipo: string }> = [];
    const mensajes = normalizarWebhook(
      envoltorio([
        { id: 'w1', from: '573001112222', type: 'reaction', timestamp: '1' },
        { id: 'w2', from: '573001112222', type: 'text', timestamp: '1', text: { body: 'hola' } },
      ]),
      (o) => omitidos.push(o),
    );

    expect(mensajes).toHaveLength(1);
    expect(omitidos[0]).toMatchObject({ tipo: 'reaction', motivo: 'tipo de mensaje no soportado' });
  });

  it('no lanza ante un cuerpo deforme', () => {
    for (const basura of [{}, { entry: null }, { entry: [null] }, { entry: [{ changes: [null] }] }]) {
      expect(() => normalizarWebhook(basura as never)).not.toThrow();
    }
    expect(() => normalizarWebhook(envoltorio([null, undefined, 42, 'texto']))).not.toThrow();
  });

  it('un timestamp ilegible no cuesta el mensaje', () => {
    const [m] = normalizarWebhook(
      envoltorio([{ id: 'w1', from: '573001112222', type: 'text', timestamp: 'ayer', text: { body: 'hola' } }]),
    );
    expect(m!.texto).toBe('hola');
    expect(Number.isNaN(m!.ts.getTime())).toBe(false);
  });
});
