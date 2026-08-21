import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ClienteLlm, HerramientaLlm, LlamadaHerramienta, MensajeLlm, RespuestaLlm,
} from '../ia.tipos';

/**
 * Adaptador de la API de Anthropic (ADR A5).
 *
 * Traduce entre los tipos neutros de la plataforma y el SDK. Ningún otro archivo
 * fuera de esta carpeta conoce el formato de Anthropic.
 */
@Injectable()
export class AnthropicAdaptador implements ClienteLlm {
  readonly proveedor = 'anthropic';
  private readonly log = new Logger(AnthropicAdaptador.name);
  private readonly cliente?: Anthropic;
  private readonly modelo: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    this.modelo = config.get<string>('ANTHROPIC_MODEL') ?? 'claude-opus-5';

    if (apiKey) this.cliente = new Anthropic({ apiKey });
    else this.log.warn('ANTHROPIC_API_KEY sin configurar');
  }

  get disponible(): boolean {
    return Boolean(this.cliente);
  }

  async responder(params: {
    system: string;
    mensajes: MensajeLlm[];
    herramientas: HerramientaLlm[];
  }): Promise<RespuestaLlm> {
    if (!this.cliente) throw new Error('Cliente de Anthropic no configurado');

    const respuesta = await this.cliente.beta.messages.create({
      model: this.modelo,
      // Respuestas de WhatsApp: cortas a propósito.
      max_tokens: 2048,
      system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
      messages: this.aMensajes(params.mensajes),
      tools: params.herramientas.map((h) => ({
        name: h.nombre,
        description: h.descripcion,
        input_schema: h.parametros as Anthropic.Tool.InputSchema,
        strict: true,
      })),
      thinking: { type: 'adaptive' },
      // Agendar es una tarea acotada; el esfuerzo bajo mantiene la conversación ágil.
      output_config: { effort: 'low' },
      // Si un clasificador declina el turno, la API enruta a un modelo alterno
      // en vez de devolver la conversación vacía.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });

    return this.aRespuesta(respuesta as unknown as Anthropic.Message);
  }

  /**
   * Los resultados de herramienta CONSECUTIVOS deben ir en un solo mensaje de
   * usuario: partirlos entrena al modelo a dejar de pedir llamadas en paralelo.
   */
  private aMensajes(mensajes: MensajeLlm[]): Anthropic.MessageParam[] {
    const salida: Anthropic.MessageParam[] = [];
    let pendientes: Anthropic.ToolResultBlockParam[] = [];

    const volcar = (): void => {
      if (pendientes.length > 0) {
        salida.push({ role: 'user', content: pendientes });
        pendientes = [];
      }
    };

    for (const m of mensajes) {
      if (m.rol === 'herramienta') {
        pendientes.push({
          type: 'tool_result',
          tool_use_id: m.llamadaId,
          content: m.contenido,
          ...(m.esError ? { is_error: true } : {}),
        });
        continue;
      }

      volcar();

      if (m.rol === 'usuario') {
        salida.push({ role: 'user', content: m.contenido });
        continue;
      }

      const bloques: Anthropic.ContentBlockParam[] = [];
      if (m.contenido) bloques.push({ type: 'text', text: m.contenido });
      for (const l of m.llamadas ?? []) {
        bloques.push({ type: 'tool_use', id: l.id, name: l.nombre, input: l.argumentos });
      }
      salida.push({ role: 'assistant', content: bloques.length > 0 ? bloques : m.contenido });
    }

    volcar();
    return salida;
  }

  private aRespuesta(m: Anthropic.Message): RespuestaLlm {
    if (m.stop_reason === 'refusal') {
      return { texto: '', llamadas: [], motivo: 'rechazo' };
    }

    // Equivalente de `length` en OpenAI.
    if (m.stop_reason === 'max_tokens') {
      return { texto: '', llamadas: [], motivo: 'truncado' };
    }

    const texto = m.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    const llamadas: LlamadaHerramienta[] = m.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({
        id: b.id,
        nombre: b.name,
        argumentos: (b.input ?? {}) as Record<string, string>,
      }));

    return {
      texto,
      llamadas,
      motivo: m.stop_reason === 'tool_use' ? 'herramientas' : 'fin',
    };
  }
}
