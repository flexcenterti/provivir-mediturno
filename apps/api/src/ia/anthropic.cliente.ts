import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import type { ClienteLlm } from './ia.tipos';

/**
 * Cliente real de la API de Anthropic (ADR A5).
 * La clave vive solo en el servidor (checklist §4).
 */
@Injectable()
export class AnthropicCliente implements ClienteLlm {
  private readonly log = new Logger(AnthropicCliente.name);
  private readonly cliente?: Anthropic;
  private readonly modelo: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    this.modelo = config.get<string>('ANTHROPIC_MODEL') ?? 'claude-opus-5';

    if (apiKey) {
      this.cliente = new Anthropic({ apiKey });
    } else {
      this.log.warn('ANTHROPIC_API_KEY sin configurar: la IA no responderá y todo escalará a la asistente');
    }
  }

  get disponible(): boolean {
    return Boolean(this.cliente);
  }

  async crearMensaje(params: {
    system: string;
    messages: Anthropic.MessageParam[];
    tools: Anthropic.Tool[];
  }): Promise<Anthropic.Message> {
    if (!this.cliente) throw new Error('Cliente de Anthropic no configurado');

    const respuesta = await this.cliente.beta.messages.create({
      model: this.modelo,
      // Respuestas de WhatsApp: cortas a propósito. El techo alto solo gastaría latencia.
      max_tokens: 2048,
      system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
      messages: params.messages,
      tools: params.tools,
      thinking: { type: 'adaptive' },
      // Agendar es una tarea acotada; el esfuerzo bajo mantiene la conversación ágil.
      output_config: { effort: 'low' },
      // Si un clasificador de seguridad rechaza el turno, la API enruta a un modelo
      // alterno en vez de devolver la conversación vacía.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });

    return respuesta as unknown as Anthropic.Message;
  }
}
