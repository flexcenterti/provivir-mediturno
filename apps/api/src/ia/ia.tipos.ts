import type Anthropic from '@anthropic-ai/sdk';

export interface ContextoConversacion {
  conversacionId: string;
  telefono: string;
  pacienteId?: string;
  /** Historial ya en formato del SDK. */
  historial: Anthropic.MessageParam[];
  /** RN-09.8 · el enlace del portal se menciona una sola vez por conversación. */
  yaOfrecioWeb: boolean;
}

export interface ResultadoIA {
  /** Texto a enviar al paciente. Vacío si solo se escaló. */
  respuesta: string;
  escalar?: { motivo: string; prioridad: 'alta' | 'media' | 'baja' };
  /** Se detectó intención de agendar: dispara la oferta web y el seguimiento (RN-09.8). */
  ofrecioWeb: boolean;
  pacienteId?: string;
  citaCreada?: { codigo: string };
  /** Turnos del loop consumidos; alimenta el límite de gasto por conversación. */
  turnos: number;
}

/** Puerto del LLM: permite probar el orquestador sin llamar a la API real. */
export interface ClienteLlm {
  crearMensaje(params: {
    system: string;
    messages: Anthropic.MessageParam[];
    tools: Anthropic.Tool[];
  }): Promise<Anthropic.Message>;
}
