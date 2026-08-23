/**
 * Parámetros de reglas fuera del código (Arquitectura §9).
 *
 * Una sola lista: estaba copiada en el seed y en el alta inicial, y una copia que
 * se queda atrás significa una instalación sin un parámetro que el código espera.
 * Editables desde Administración → Reglas.
 */
export const CONFIGURACION_BASE = [
  { clave: 'hueco_max_min', valor: '0', descripcion: 'RN-03.2 · Hueco máximo tolerado al recomendar cupos. 0 = compactar al máximo.' },
  { clave: 'ventana_control_dias_defecto', valor: '10', descripcion: 'RN-01.3 · Ventana de control por defecto si el prestador no define la suya.' },
  { clave: 'kiosko_activo', valor: 'false', descripcion: 'D3 · El kiosko queda construido pero apagado.' },
  { clave: 'umbral_confianza_ia', valor: '70', descripcion: 'RN-08 · Bajo este umbral la IA escala a la asistente.' },
  { clave: 'intervalo_institucional_min', valor: '10', descripcion: 'RN-11.2 · Cada cuántos minutos se interrumpe el canal para el video institucional.' },
  { clave: 'anticipacion_llegada_min', valor: '15', descripcion: 'Minutos de anticipación con que se permite registrar llegada.' },
  { clave: 'tolerancia_retraso_min', valor: '10', descripcion: 'Tolerancia de retraso antes de degradar la prioridad en cola.' },
  { clave: 'kb_score_min', valor: '62', descripcion: 'RN-13.3 · Cobertura mínima de la pregunta para que el bot responda en vez de escalar. Calibrar contra el golden set.' },
  { clave: 'kb_top_k', valor: '5', descripcion: 'RN-13 · Fragmentos que se le entregan al modelo por consulta.' },
  {
    clave: 'seguimiento_comercial_activo',
    valor: 'true',
    descripcion:
      'RN-09.9 · Secuencia de tres mensajes al paciente que preguntó por un servicio y no agendó ' +
      '(2 h, 5 h y cierre a las 8 h). Se detiene sola si responde, agenda o pide no ser contactado.',
  },
  { clave: 'seguimiento_hora_apertura', valor: '7', descripcion: 'RN-09.9.5 · Hora desde la que pueden salir mensajes de seguimiento.' },
  { clave: 'seguimiento_hora_cierre', valor: '18', descripcion: 'RN-09.9.5 · Hora hasta la que pueden salir mensajes de seguimiento.' },
  { clave: 'seguimiento_comercial_dias_entre', valor: '30', descripcion: 'RN-09.9.7.2 · Días mínimos entre dos secuencias para el mismo paciente y servicio.' },
  {
    clave: 'mostrar_nombre_en_pantalla',
    valor: 'abreviado',
    descripcion:
      'Cómo aparece el paciente en los televisores de sala: completo | abreviado ("Rosa Q.") | oculto (solo el turno). ' +
      'Las pantallas se sirven sin restricción de red, así que un enlace filtrado muestra en vivo a quién atiende la clínica.',
  },
] as const;
