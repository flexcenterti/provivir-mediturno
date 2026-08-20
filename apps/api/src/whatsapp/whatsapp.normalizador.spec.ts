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
