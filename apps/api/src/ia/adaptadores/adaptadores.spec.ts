import { ConfigService } from '@nestjs/config';
import { AnthropicAdaptador } from './anthropic.adaptador';
import { OpenAiAdaptador } from './openai.adaptador';
import { HERRAMIENTAS } from '../ia.herramientas';
import type { MensajeLlm } from '../ia.tipos';

/**
 * La traducción entre proveedores es donde se rompen las cosas: cada uno nombra
 * distinto lo mismo. Estas pruebas ejercitan los mapeadores sin llamar a ninguna
 * API — se accede a los métodos privados a propósito, porque son la unidad que
 * importa y exponerlos solo para probarlos ensuciaría la interfaz pública.
 */

const configFalsa = (valores: Record<string, string>): ConfigService =>
  ({ get: (k: string) => valores[k] }) as unknown as ConfigService;

const HISTORIAL: MensajeLlm[] = [
  { rol: 'usuario', contenido: 'Quiero una cita' },
  {
    rol: 'asistente',
    contenido: 'Déjame buscar tus datos.',
    llamadas: [{ id: 'call-1', nombre: 'buscar_paciente', argumentos: { documento: '12345678' } }],
  },
  { rol: 'herramienta', llamadaId: 'call-1', nombre: 'buscar_paciente', contenido: '{"encontrado":true}' },
  { rol: 'usuario', contenido: 'Para el lunes' },
];

describe('Adaptador de Anthropic', () => {
  const adaptador = new AnthropicAdaptador(configFalsa({ ANTHROPIC_API_KEY: 'sk-prueba' }));
  const mapear = (m: MensajeLlm[]) =>
    (adaptador as unknown as { aMensajes(x: MensajeLlm[]): unknown[] }).aMensajes(m);
  const leer = (r: unknown) =>
    (adaptador as unknown as { aRespuesta(x: unknown): unknown }).aRespuesta(r);

  it('se declara disponible solo con la clave configurada', () => {
    expect(adaptador.disponible).toBe(true);
    expect(new AnthropicAdaptador(configFalsa({})).disponible).toBe(false);
  });

  it('traduce el historial al formato de bloques', () => {
    const m = mapear(HISTORIAL) as Array<Record<string, unknown>>;
    expect(m[0]).toEqual({ role: 'user', content: 'Quiero una cita' });

    const asistente = m[1] as { role: string; content: Array<Record<string, unknown>> };
    expect(asistente.role).toBe('assistant');
    expect(asistente.content[0]).toMatchObject({ type: 'text' });
    expect(asistente.content[1]).toMatchObject({ type: 'tool_use', id: 'call-1', name: 'buscar_paciente' });
  });

  it('agrupa resultados de herramienta CONSECUTIVOS en un solo mensaje', () => {
    // Partirlos entrena al modelo a dejar de pedir llamadas en paralelo.
    const dos: MensajeLlm[] = [
      { rol: 'herramienta', llamadaId: 'a', nombre: 'x', contenido: '1' },
      { rol: 'herramienta', llamadaId: 'b', nombre: 'y', contenido: '2' },
    ];
    const m = mapear(dos) as Array<{ role: string; content: unknown[] }>;

    expect(m).toHaveLength(1);
    expect(m[0]!.role).toBe('user');
    expect(m[0]!.content).toHaveLength(2);
  });

  it('marca el resultado con error', () => {
    const m = mapear([
      { rol: 'herramienta', llamadaId: 'a', nombre: 'x', contenido: '{"error":"x"}', esError: true },
    ]) as Array<{ content: Array<Record<string, unknown>> }>;
    expect(m[0]!.content[0]).toMatchObject({ is_error: true });
  });

  it('lee una respuesta de texto', () => {
    const r = leer({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Listo' }],
    });
    expect(r).toEqual({ texto: 'Listo', llamadas: [], motivo: 'fin' });
  });

  it('lee una respuesta con herramientas', () => {
    const r = leer({
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Un momento' },
        { type: 'tool_use', id: 'c1', name: 'ofrecer_cupos', input: { servicioId: 'mg' } },
      ],
    }) as { motivo: string; llamadas: Array<Record<string, unknown>> };

    expect(r.motivo).toBe('herramientas');
    expect(r.llamadas[0]).toEqual({ id: 'c1', nombre: 'ofrecer_cupos', argumentos: { servicioId: 'mg' } });
  });

  it('traduce el rechazo del clasificador de seguridad', () => {
    expect(leer({ stop_reason: 'refusal', content: [] })).toMatchObject({ motivo: 'rechazo' });
  });

  it('marca como truncada la respuesta cortada por el tope de tokens', () => {
    // Media frase no debe llegar al paciente como si el turno hubiera terminado.
    expect(leer({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Claro, tu cita es el' }] }))
      .toEqual({ texto: '', llamadas: [], motivo: 'truncado' });
  });
});

describe('Adaptador de OpenAI', () => {
  const adaptador = new OpenAiAdaptador(configFalsa({ OPENAI_API_KEY: 'sk-prueba' }));
  const mapear = (m: MensajeLlm[]) =>
    (adaptador as unknown as { aMensajes(x: MensajeLlm[]): unknown[] }).aMensajes(m);
  const leer = (r: unknown) =>
    (adaptador as unknown as { aRespuesta(x: unknown): unknown }).aRespuesta(r);

  it('se declara disponible solo con la clave configurada', () => {
    expect(adaptador.disponible).toBe(true);
    expect(new OpenAiAdaptador(configFalsa({})).disponible).toBe(false);
  });

  it('traduce el historial al formato de chat', () => {
    const m = mapear(HISTORIAL) as Array<Record<string, unknown>>;
    expect(m[0]).toEqual({ role: 'user', content: 'Quiero una cita' });

    const asistente = m[1] as { role: string; tool_calls: Array<{ id: string; function: { name: string; arguments: string } }> };
    expect(asistente.role).toBe('assistant');
    expect(asistente.tool_calls[0]!.id).toBe('call-1');
    // Los argumentos viajan serializados, no como objeto.
    expect(JSON.parse(asistente.tool_calls[0]!.function.arguments)).toEqual({ documento: '12345678' });

    // El resultado va en un rol propio, no dentro de un mensaje de usuario.
    expect(m[2]).toEqual({ role: 'tool', tool_call_id: 'call-1', content: '{"encontrado":true}' });
  });

  it('transmite el error en el contenido, porque no existe un campo para ello', () => {
    const m = mapear([
      { rol: 'herramienta', llamadaId: 'a', nombre: 'x', contenido: 'cupo ocupado', esError: true },
    ]) as Array<{ content: string }>;
    expect(m[0]!.content).toMatch(/^ERROR: /);
  });

  it('lee una respuesta de texto', () => {
    const r = leer({
      choices: [{ finish_reason: 'stop', message: { content: 'Listo', tool_calls: undefined } }],
    });
    expect(r).toEqual({ texto: 'Listo', llamadas: [], motivo: 'fin' });
  });

  describe('esquemas en modo strict', () => {
    const estricto = (e: Record<string, unknown>) =>
      (adaptador as unknown as { aEsquemaEstricto(x: Record<string, unknown>): Record<string, unknown> })
        .aEsquemaEstricto(e);

    /**
     * Comprueba la única regla que la API impone y que no se ve venir: en `strict`,
     * `required` debe listar TODAS las propiedades. Omitir una devuelve 400 y
     * tumba la conversación entera, no solo esa herramienta.
     */
    const todasObligatorias = (e: Record<string, unknown>, ruta = 'raíz'): void => {
      const props = e.properties as Record<string, Record<string, unknown>> | undefined;
      if (props) {
        expect(new Set(e.required as string[])).toEqual(new Set(Object.keys(props)));
        for (const [k, sub] of Object.entries(props)) todasObligatorias(sub, `${ruta}.${k}`);
      }
      if (e.items && typeof e.items === 'object') todasObligatorias(e.items as Record<string, unknown>, `${ruta}[]`);
    };

    it('cada herramienta del motor sobrevive a la conversión', () => {
      for (const h of HERRAMIENTAS) todasObligatorias(estricto(h.parametros));
    });

    it('lo opcional pasa a admitir null en vez de desaparecer', () => {
      // ofrecer_cupos.prestadorId es opcional: filtrar por un médico concreto.
      const e = estricto(HERRAMIENTAS.find((h) => h.nombre === 'ofrecer_cupos')!.parametros);
      const props = e.properties as Record<string, { type: unknown }>;
      expect(props.prestadorId!.type).toEqual(['string', 'null']);
      // Lo que ya era obligatorio no se toca.
      expect(props.servicioId!.type).toBe('string');
    });

    it('un enum nulificable admite null también entre sus valores', () => {
      const e = estricto({
        type: 'object',
        properties: { prioridad: { type: 'string', enum: ['alta', 'baja'] } },
        required: [],
      });
      expect((e.properties as Record<string, unknown>).prioridad).toMatchObject({
        type: ['string', 'null'],
        enum: ['alta', 'baja', null],
      });
    });

    it('desciende por objetos anidados y por items de arreglo', () => {
      const e = estricto({
        type: 'object',
        properties: {
          lista: { type: 'array', items: { type: 'object', properties: { a: { type: 'string' } }, required: [] } },
        },
        required: ['lista'],
      });
      const items = (e.properties as Record<string, { items: Record<string, unknown> }>).lista!.items;
      expect(items.required).toEqual(['a']);
    });

    it('no altera el esquema original: las herramientas siguen siendo neutras', () => {
      const original = HERRAMIENTAS.find((h) => h.nombre === 'ofrecer_cupos')!.parametros;
      const antes = JSON.stringify(original);
      estricto(original);
      expect(JSON.stringify(original)).toBe(antes);
    });
  });

  it('lee una respuesta con herramientas y deserializa los argumentos', () => {
    const r = leer({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [{
            id: 'c1', type: 'function',
            function: { name: 'ofrecer_cupos', arguments: '{"servicioId":"mg","fecha":"2026-09-21"}' },
          }],
        },
      }],
    }) as { motivo: string; llamadas: Array<Record<string, unknown>> };

    expect(r.motivo).toBe('herramientas');
    expect(r.llamadas[0]!.argumentos).toEqual({ servicioId: 'mg', fecha: '2026-09-21' });
  });

  it('un JSON de argumentos malformado no tumba la conversación', () => {
    const r = leer({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{roto' } }],
        },
      }],
    }) as { llamadas: Array<{ argumentos: unknown }> };

    // Se devuelve vacío: la herramienta responderá que faltan datos, y eso el
    // modelo sí sabe manejarlo.
    expect(r.llamadas[0]!.argumentos).toEqual({});
  });

  it('traduce el rechazo del modelo', () => {
    const r = leer({
      choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'No puedo ayudar con eso' } }],
    });
    expect(r).toMatchObject({ motivo: 'rechazo' });
  });

  it('una respuesta sin opciones no revienta', () => {
    expect(leer({ choices: [] })).toEqual({ texto: '', llamadas: [], motivo: 'fin' });
  });

  it('marca como truncada la respuesta cortada por el tope de tokens', () => {
    // Ocurre con los modelos de razonamiento: los tokens de pensamiento consumen
    // el mismo presupuesto, así que se agota sin que la respuesta visible sea larga.
    expect(leer({ choices: [{ finish_reason: 'length', message: { content: 'Claro, tu cita es el' } }] }))
      .toEqual({ texto: '', llamadas: [], motivo: 'truncado' });
  });
});

describe('Las herramientas son neutras de proveedor', () => {
  it('expone exactamente el inventario esperado', () => {
    // Lista explícita y no un conteo: si alguien agrega o quita una herramienta,
    // el fallo dice cuál, no que el número cambió.
    expect(HERRAMIENTAS.map((h) => h.nombre)).toEqual([
      'buscar_paciente',
      'registrar_paciente',
      'listar_servicios',
      'buscar_conocimiento',
      'consultar_servicio',
      'ofrecer_cupos',
      'confirmar_cita',
      'consultar_citas',
      'cancelar_cita',
      'escalar_a_asistente',
    ]);
  });

  it('cada una trae nombre, descripción y JSON Schema', () => {
    for (const h of HERRAMIENTAS) {
      expect(h.nombre).toMatch(/^[a-z_]+$/);
      expect(h.descripcion.length).toBeGreaterThan(20);
      expect(h.parametros).toMatchObject({ type: 'object' });
    }
  });

  it('ningún esquema admite propiedades extra: los dos proveedores lo exigen para strict', () => {
    for (const h of HERRAMIENTAS) {
      expect(h.parametros).toMatchObject({ additionalProperties: false });
    }
  });
});
