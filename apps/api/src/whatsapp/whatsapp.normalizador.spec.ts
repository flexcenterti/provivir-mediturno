import {
  esTelefono, normalizarIdentidad, normalizarTelefono, normalizarWebhook,
  paraEnviar, variantesDeTelefono, formaDe,
} from './whatsapp.normalizador';
import type { Omitido } from './whatsapp.normalizador';
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
  it('descarta solo cuando no hay NINGUNA forma de identificar al remitente', () => {
    // Sin `from` se recurre al wa_id del contacto; si tampoco está, no hay a quién
    // responder. Lo que no puede pasar es que se caiga el lote entero.
    const omitidos: Array<{ tipo: string; motivo: string }> = [];
    const mensajes = normalizarWebhook(
      {
        object: 'whatsapp_business_account',
        entry: [{ id: 'e', changes: [{ field: 'messages', value: {
          messaging_product: 'whatsapp',
          messages: [
            { id: 'w1', type: 'text', timestamp: '1', text: { body: 'anónimo' } },
            { id: 'w2', from: '573001112222', type: 'text', timestamp: '1', text: { body: 'este sí' } },
          ] as never,
        } }] }],
      },
      (o) => omitidos.push(o),
    );

    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]!.texto).toBe('este sí');
    expect(omitidos).toHaveLength(1);
    expect(omitidos[0]).toMatchObject({
      tipo: 'text', motivo: 'sin remitente: ni `from`/`from_user_id` ni `contacts[].wa_id`/`user_id`', id: 'w1',
    });
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

/**
 * WhatsApp ya no siempre entrega el teléfono: con los nombres de usuario llega un
 * alias. Todo pasaba por normalizarTelefono, que se queda con los dígitos, así que
 * un alias sin dígitos daba "+" — el MISMO valor para todos. Como la conversación
 * abierta se busca por este campo, dos pacientes distintos habrían compartido hilo.
 */
describe('identidad del remitente cuando no hay teléfono', () => {
  it('reconoce los teléfonos en los formatos que llegan', () => {
    expect(normalizarIdentidad('573004765496')).toBe('+573004765496');
    expect(normalizarIdentidad('3001112222')).toBe('+573001112222');
    expect(normalizarIdentidad('+57 300 111 2222')).toBe('+573001112222');
  });

  it('no convierte un alias en un teléfono inventado', () => {
    // "@paciente_2026" daba "+2026", que es un número de otra persona o de nadie.
    expect(normalizarIdentidad('@paciente_2026')).toBe('wa:@paciente_2026');
    expect(normalizarIdentidad('carlos.rivas')).toBe('wa:carlos.rivas');
  });

  it('dos alias distintos NUNCA colapsan en la misma identidad', () => {
    const identidades = ['carlos.rivas', 'maria', 'jose_2026', ''].map(normalizarIdentidad);
    expect(new Set(identidades).size).toBe(identidades.length);
    expect(identidades).not.toContain('+');
  });

  it('distingue lo que sirve para llamar de lo que no', () => {
    expect(esTelefono('+573004765496')).toBe(true);
    expect(esTelefono('wa:carlos.rivas')).toBe(false);
  });

  it('al responder se le quita la marca interna: Meta no la conoce', () => {
    expect(paraEnviar('wa:carlos.rivas')).toBe('carlos.rivas');
    expect(paraEnviar('+573004765496')).toBe('+573004765496');
  });

  it('un alias no genera variantes vacías', () => {
    // `telefono IN ('')` casa con cualquier paciente sin teléfono: se le
    // atribuiría la conversación a quien no es.
    const v = variantesDeTelefono('wa:carlos.rivas');
    expect(v).toEqual(['wa:carlos.rivas']);
    expect(v).not.toContain('');
  });

  it('usa el wa_id del contacto cuando el mensaje no trae remitente', () => {
    const cuerpo = envoltorio([{ id: 'w1', type: 'text', timestamp: '1', text: { body: 'hola' } }]);
    // El envoltorio declara wa_id 573002222222 en contacts.
    const [m] = normalizarWebhook(cuerpo);
    expect(m!.telefono).toBe('+573002222222');
  });
});

describe('la traza dice la forma, nunca el contenido', () => {
  it('enumera las claves sin revelar valores', () => {
    const forma = formaDe({ id: 'w1', type: 'text', sender_identity: '+573001112222' });
    expect(forma).toBe('{id, type, sender_identity}');
    expect(forma).not.toContain('573001112222');
  });

  it('adjunta la forma al descartar un mensaje sin remitente conocido', () => {
    const omitidos: Omitido[] = [];
    normalizarWebhook(
      {
        object: 'whatsapp_business_account',
        entry: [{ id: 'e', changes: [{ field: 'messages', value: {
          messaging_product: 'whatsapp',
          contacts: [{ profile: { name: 'Ana' }, username: 'ana.torres' }],
          messages: [{ id: 'w1', type: 'text', timestamp: '1', text: { body: 'hola' } }],
        } as never }] }],
      },
      (o) => omitidos.push(o),
    );

    // Lo que buscamos: el nombre del campo nuevo, sin su valor.
    expect(omitidos[0]!.forma).toContain('username');
    expect(omitidos[0]!.forma).not.toContain('ana.torres');
  });
});

/**
 * Cuerpos tomados literalmente de la documentación de Meta. Con nombres de usuario
 * el remitente no viene en `from` sino en `from_user_id`, y el contacto trae
 * `user_id` en vez de `wa_id`. Antes se descartaban: ese paciente escribía y no
 * recibía nada.
 */
describe('nombres de usuario de WhatsApp · cuerpos oficiales de Meta', () => {
  const conNumero = {
    object: 'whatsapp_business_account',
    entry: [{ id: '102290129340398', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
      contacts: [{ profile: { name: 'Jefferson R.' }, wa_id: '573001234567' }],
      messages: [{
        from: '573001234567', id: 'wamid.CONNUM', timestamp: '1749416383',
        type: 'text', text: { body: 'Hola, quiero información sobre el servicio' },
      }],
    } }] }],
  } as never;

  const conUsername = {
    object: 'whatsapp_business_account',
    entry: [{ id: '102290129340398', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
      contacts: [{ profile: { name: 'Sheena Nelson', username: '@realsheenanelson' }, user_id: 'US.13491208655302741918' }],
      messages: [{
        from_user_id: 'US.13491208655302741918', id: 'wamid.CONUSER', timestamp: '1749416383',
        type: 'text', text: { body: '¿Viene en otro color?' },
      }],
    } }] }],
  } as never;

  it('el que trae teléfono se normaliza a E.164', () => {
    const [m] = normalizarWebhook(conNumero);
    expect(m).toMatchObject({ telefono: '+573001234567', nombrePerfil: 'Jefferson R.', texto: 'Hola, quiero información sobre el servicio' });
    expect(esTelefono(m!.telefono)).toBe(true);
  });

  it('el que trae nombre de usuario ya no se descarta', () => {
    const omitidos: Omitido[] = [];
    const [m] = normalizarWebhook(conUsername, (o) => omitidos.push(o));

    expect(omitidos).toHaveLength(0);
    expect(m).toMatchObject({ nombrePerfil: 'Sheena Nelson', texto: '¿Viene en otro color?' });
    // Se guarda el user_id, no el @alias: el alias lo puede cambiar el paciente.
    expect(m!.telefono).toBe('wa:US.13491208655302741918');
  });

  it('un user_id no se confunde nunca con un teléfono', () => {
    const [m] = normalizarWebhook(conUsername);
    expect(esTelefono(m!.telefono)).toBe(false);
    // De ahí depende que no se le mande recordatorio ni se le cruce con la base.
    expect(variantesDeTelefono(m!.telefono)).toEqual(['wa:US.13491208655302741918']);
  });

  it('al responder se le manda a Meta el identificador tal cual', () => {
    const [m] = normalizarWebhook(conUsername);
    expect(paraEnviar(m!.telefono)).toBe('US.13491208655302741918');
  });

  it('los dos cuerpos producen identidades distintas', () => {
    const a = normalizarWebhook(conNumero)[0]!.telefono;
    const b = normalizarWebhook(conUsername)[0]!.telefono;
    expect(a).not.toBe(b);
  });

  it('el alias sirve de nombre si el perfil no trae uno', () => {
    const sinNombre = JSON.parse(JSON.stringify(conUsername));
    delete sinNombre.entry[0].changes[0].value.contacts[0].profile.name;
    expect(normalizarWebhook(sinNombre)[0]!.nombrePerfil).toBe('@realsheenanelson');
  });
});
