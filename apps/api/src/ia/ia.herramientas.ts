import type { HerramientaLlm } from './ia.tipos';

/**
 * Herramientas que la IA puede invocar (Arquitectura §7.3, ADR A5).
 *
 * El LLM **nunca** escribe en la base ni ejecuta SQL: solo llama estas herramientas,
 * cuyas entradas se validan y cuya implementación es el motor de agendamiento.
 * Las reglas RN-01 a RN-04 se aplican dentro del motor, no en el prompt (ADR A3):
 * si la IA pide un cupo inválido, el motor lo rechaza y devuelve alternativas.
 */
export const HERRAMIENTAS: HerramientaLlm[] = [
  {
    nombre: 'buscar_paciente',
    descripcion:
      'Busca un paciente por número de documento. Úsala apenas el paciente te dé su documento. ' +
      'Si no aparece, ofrécele registrarse: pide nombres, apellidos y confirma el número de contacto.',
    parametros: {
      type: 'object',
      properties: {
        documento: { type: 'string', description: 'Número de documento, solo dígitos' },
      },
      required: ['documento'],
      additionalProperties: false,
    },
  },
  {
    nombre: 'registrar_paciente',
    descripcion:
      'Registra un paciente nuevo. Confirma SIEMPRE el número de contacto con el paciente antes de llamarla: ' +
      'WhatsApp oculta cada vez más el número del remitente.',
    parametros: {
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
  },
  {
    nombre: 'listar_servicios',
    descripcion:
      'Lista los servicios que presta la clínica, con duración. Úsala cuando el paciente pregunte ' +
      'qué se ofrece o cuando necesites el identificador de un servicio.',
    parametros: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    nombre: 'ofrecer_cupos',
    descripcion:
      'Devuelve los horarios disponibles para un servicio y una fecha. Es la ÚNICA forma válida de ' +
      'saber qué horarios existen: nunca inventes ni supongas disponibilidad. ' +
      'Si el paciente no pide un médico específico, omite prestadorId y el sistema reparte la carga.',
    parametros: {
      type: 'object',
      properties: {
        servicioId: { type: 'string' },
        fecha: { type: 'string', description: 'AAAA-MM-DD' },
        prestadorId: { type: 'string', description: 'Solo si el paciente pidió un profesional específico' },
      },
      required: ['servicioId', 'fecha'],
      additionalProperties: false,
    },
  },
  {
    nombre: 'confirmar_cita',
    descripcion:
      'Crea la cita en un horario que ofrecer_cupos haya devuelto. Si el cupo se ocupó mientras conversaban, ' +
      'la respuesta trae alternativas: ofrécelas sin dramatizar.',
    parametros: {
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
  },
  {
    nombre: 'consultar_citas',
    descripcion: 'Consulta las próximas citas de un paciente ya identificado.',
    parametros: {
      type: 'object',
      properties: { pacienteId: { type: 'string' } },
      required: ['pacienteId'],
      additionalProperties: false,
    },
  },
  {
    nombre: 'cancelar_cita',
    descripcion: 'Cancela una cita del paciente. Confirma con él antes de llamarla.',
    parametros: {
      type: 'object',
      properties: {
        citaId: { type: 'string' },
        motivo: { type: 'string' },
      },
      required: ['citaId', 'motivo'],
      additionalProperties: false,
    },
  },
  {
    nombre: 'escalar_a_asistente',
    descripcion:
      'Pasa la conversación a una asistente humana. Úsala cuando: el paciente lo pida, ' +
      'no puedas resolver con las demás herramientas, el paciente se muestre confundido tras varios intentos, ' +
      'o el caso exceda el agendamiento (reclamos, temas administrativos, dudas clínicas).',
    parametros: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'Por qué escala, en una frase' },
        prioridad: { type: 'string', enum: ['alta', 'media', 'baja'] },
      },
      required: ['motivo', 'prioridad'],
      additionalProperties: false,
    },
  },
];
