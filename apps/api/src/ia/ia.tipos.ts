/**
 * Tipos neutros de proveedor para la capa de IA.
 *
 * El orquestador (`ia.service.ts`) trabaja SOLO con estos tipos; ningún SDK de
 * proveedor aparece fuera de `ia/adaptadores/`. Así cambiar de modelo o de
 * proveedor no toca la lógica de negocio, y el conmutador se prueba con un doble.
 */

/** Definición de herramienta en JSON Schema, común a ambos proveedores. */
export interface HerramientaLlm {
  nombre: string;
  descripcion: string;
  /** JSON Schema del objeto de entrada. */
  parametros: Record<string, unknown>;
}

export interface LlamadaHerramienta {
  /** Identificador que el proveedor asigna y que hay que devolverle con el resultado. */
  id: string;
  nombre: string;
  argumentos: Record<string, string>;
}

export type MensajeLlm =
  | { rol: 'usuario'; contenido: string }
  | { rol: 'asistente'; contenido: string; llamadas?: LlamadaHerramienta[] }
  | { rol: 'herramienta'; llamadaId: string; nombre: string; contenido: string; esError?: boolean };

export interface RespuestaLlm {
  texto: string;
  llamadas: LlamadaHerramienta[];
  /**
   * `fin` — el modelo terminó su turno.
   * `herramientas` — pide ejecutar herramientas y volver.
   * `rechazo` — un clasificador de seguridad declinó responder; hay que escalar.
   */
  /**
   * `truncado`: el modelo agotó su presupuesto de tokens a mitad de frase. No es
   * un turno terminado y no debe enviarse al paciente. En los modelos con
   * razonamiento, los tokens de pensamiento cuentan contra ese mismo tope, así
   * que ocurre sin que la respuesta visible sea larga.
   */
  motivo: 'fin' | 'herramientas' | 'rechazo' | 'truncado';
}

/** Puerto del modelo. Cada proveedor lo implementa en `ia/adaptadores/`. */
export interface ClienteLlm {
  /** Nombre legible del proveedor, para logs y auditoría. */
  readonly proveedor: string;
  readonly disponible: boolean;

  responder(params: {
    system: string;
    mensajes: MensajeLlm[];
    herramientas: HerramientaLlm[];
  }): Promise<RespuestaLlm>;
}

export interface ContextoConversacion {
  conversacionId: string;
  telefono: string;
  pacienteId?: string;
  historial: MensajeLlm[];
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
  /** RN-13.7.3 · Artículos que sustentaron la respuesta, y su puntaje. */
  kbArticulos?: string[];
  kbScore?: number;
}
