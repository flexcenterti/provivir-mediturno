import type Anthropic from '@anthropic-ai/sdk';

/**
 * Herramientas que la IA puede invocar (Arquitectura §7.3, ADR A5).
 *
 * El LLM **nunca** escribe en la base ni ejecuta SQL: solo llama estas herramientas,
 * cuyas entradas se validan y cuya implementación es el motor de agendamiento.
 * Las reglas RN-01 a RN-04 se aplican dentro del motor, no en el prompt (ADR A3):
 * si la IA pide un cupo inválido, el motor lo rechaza y devuelve alternativas.
 */
export const HERRAMIENTAS: Anthropic.Tool[] = [
  {
    name: 'buscar_paciente',
    description:
      'Busca un paciente por número de documento. Úsala apenas el paciente te dé su documento. ' +
      'Si no aparece, ofrécele registrarse: pide nombres, apellidos y confirma el número de contacto.',
    input_schema: {
      type: 'object',
      properties: {
        documento: { type: 'string', description: 'Número de documento, solo dígitos' },
      },
      required: ['documento'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'registrar_paciente',
    description:
      'Registra un paciente nuevo. Confirma SIEMPRE el número de contacto con el paciente antes de llamarla: ' +
      'WhatsApp oculta cada vez más el número del remitente.',
    input_schema: {
      type: 'object',
      properties: {
        documento: { type: 'string' },
        nombres: { type: 'string' },
        apellidos: { type: 'string' },
        telefono: { type: 'string', description: 'Número confirmado por el paciente' },
      },
      required: ['documento', 'nombres', 'apellidos', 'telefono'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'listar_servicios',
    description:
      'Lista los servicios que presta la clínica, con duración. Úsala cuando el paciente pregunte ' +
      'qué se ofrece o cuando necesites el identificador de un servicio.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    name: 'ofrecer_cupos',
    description:
      'Devuelve los horarios disponibles para un servicio y una fecha. Es la ÚNICA forma válida de ' +
      'saber qué horarios existen: nunca inventes ni supongas disponibilidad. ' +
      'Si el paciente no pide un médico específico, omite prestadorId y el sistema reparte la carga.',
    input_schema: {
      type: 'object',
      properties: {
        servicioId: { type: 'string' },
        fecha: { type: 'string', description: 'AAAA-MM-DD' },
        prestadorId: { type: 'string', description: 'Solo si el paciente pidió un profesional específico' },
      },
      required: ['servicioId', 'fecha'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'confirmar_cita',
    description:
      'Crea la cita en un horario que ofrecer_cupos haya devuelto. Si el cupo se ocupó mientras conversaban, ' +
      'la respuesta trae alternativas: ofrécelas sin dramatizar.',
    input_schema: {
      type: 'object',
      properties: {
        pacienteId: { type: 'string' },
        servicioId: { type: 'string' },
        fecha: { type: 'string' },
        hora: { type: 'string', description: 'HH:MM exactamente como lo devolvió ofrecer_cupos' },
        prestadorId: { type: 'string' },
      },
      required: ['pacienteId', 'servicioId', 'fecha', 'hora', 'prestadorId'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'consultar_citas',
    description: 'Consulta las próximas citas de un paciente ya identificado.',
    input_schema: {
      type: 'object',
      properties: { pacienteId: { type: 'string' } },
      required: ['pacienteId'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'cancelar_cita',
    description: 'Cancela una cita del paciente. Confirma con él antes de llamarla.',
    input_schema: {
      type: 'object',
      properties: {
        citaId: { type: 'string' },
        motivo: { type: 'string' },
      },
      required: ['citaId', 'motivo'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'escalar_a_asistente',
    description:
      'Pasa la conversación a una asistente humana. Úsala cuando: el paciente lo pida, ' +
      'no puedas resolver con las demás herramientas, el paciente se muestre confundido tras varios intentos, ' +
      'o el caso exceda el agendamiento (reclamos, temas administrativos, dudas clínicas).',
    input_schema: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'Por qué escala, en una frase' },
        prioridad: { type: 'string', enum: ['alta', 'media', 'baja'] },
      },
      required: ['motivo', 'prioridad'],
      additionalProperties: false,
    },
    strict: true,
  },
];
