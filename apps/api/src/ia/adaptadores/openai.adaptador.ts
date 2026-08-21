import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type {
  ClienteLlm, HerramientaLlm, LlamadaHerramienta, MensajeLlm, RespuestaLlm,
} from '../ia.tipos';

/**
 * Adaptador de la API de OpenAI.
 *
 * Traduce entre los tipos neutros de la plataforma y el SDK. Las diferencias con
 * Anthropic no son cosméticas: las herramientas se envuelven en `function`, los
 * argumentos viajan como JSON en string, el resultado va en un rol `tool` propio
 * y el fin de turno se lee de `finish_reason`. Todo eso vive aquí.
 */
@Injectable()
export class OpenAiAdaptador implements ClienteLlm {
  readonly proveedor = 'openai';
  private readonly log = new Logger(OpenAiAdaptador.name);
  private readonly cliente?: OpenAI;
  private readonly modelo: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('OPENAI_API_KEY');
    this.modelo = config.get<string>('OPENAI_MODEL') ?? 'gpt-5.6-terra';

    if (apiKey) this.cliente = new OpenAI({ apiKey });
    else this.log.warn('OPENAI_API_KEY sin configurar');
  }

  get disponible(): boolean {
    return Boolean(this.cliente);
  }

  async responder(params: {
    system: string;
    mensajes: MensajeLlm[];
    herramientas: HerramientaLlm[];
  }): Promise<RespuestaLlm> {
    if (!this.cliente) throw new Error('Cliente de OpenAI no configurado');

    const respuesta = await this.cliente.chat.completions.create({
      model: this.modelo,
      // Respuestas de WhatsApp: cortas a propósito.
      max_completion_tokens: 2048,
      messages: [
        // OpenAI no tiene campo `system` aparte: va como primer mensaje.
        { role: 'system', content: params.system },
        ...this.aMensajes(params.mensajes),
      ],
      tools: params.herramientas.map((h) => ({
        type: 'function' as const,
        function: {
          name: h.nombre,
          description: h.descripcion,
          parameters: h.parametros,
          // Garantiza que los argumentos validen contra el esquema.
          strict: true,
        },
      })),
    });

    return this.aRespuesta(respuesta);
  }

  private aMensajes(mensajes: MensajeLlm[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    return mensajes.map((m): OpenAI.Chat.ChatCompletionMessageParam => {
      if (m.rol === 'usuario') {
        return { role: 'user', content: m.contenido };
      }

      if (m.rol === 'herramienta') {
        // El error se transmite en el propio contenido: OpenAI no tiene `is_error`.
        return {
          role: 'tool',
          tool_call_id: m.llamadaId,
          content: m.esError ? `ERROR: ${m.contenido}` : m.contenido,
        };
      }

      const llamadas = m.llamadas ?? [];
      if (llamadas.length === 0) {
        return { role: 'assistant', content: m.contenido };
      }

      return {
        role: 'assistant',
        content: m.contenido || null,
        tool_calls: llamadas.map((l) => ({
          id: l.id,
          type: 'function' as const,
          // Los argumentos viajan serializados, no como objeto.
          function: { name: l.nombre, arguments: JSON.stringify(l.argumentos) },
        })),
      };
    });
  }

  private aRespuesta(r: OpenAI.Chat.ChatCompletion): RespuestaLlm {
    const eleccion = r.choices[0];
    if (!eleccion) return { texto: '', llamadas: [], motivo: 'fin' };

    const mensaje = eleccion.message;

    // El modelo declinó responder: se trata igual que un rechazo de Anthropic.
    if ('refusal' in mensaje && mensaje.refusal) {
      return { texto: '', llamadas: [], motivo: 'rechazo' };
    }

    const llamadas: LlamadaHerramienta[] = (mensaje.tool_calls ?? [])
      .filter((t): t is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => t.type === 'function')
      .map((t) => ({
        id: t.id,
        nombre: t.function.name,
        argumentos: this.parsearArgumentos(t.function.arguments, t.function.name),
      }));

    return {
      texto: (mensaje.content ?? '').trim(),
      llamadas,
      motivo: eleccion.finish_reason === 'tool_calls' || llamadas.length > 0 ? 'herramientas' : 'fin',
    };
  }

  /**
   * Los argumentos llegan como texto JSON. Un JSON malformado no debe tumbar la
   * conversación: se devuelve vacío y la herramienta responderá que faltan datos,
   * que el modelo sí sabe manejar.
   */
  private parsearArgumentos(crudo: string, herramienta: string): Record<string, string> {
    try {
      return JSON.parse(crudo || '{}') as Record<string, string>;
    } catch {
      this.log.warn(`Argumentos ilegibles para ${herramienta}: ${crudo.slice(0, 120)}`);
      return {};
    }
  }
}
