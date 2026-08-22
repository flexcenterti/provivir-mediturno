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
  {
    clave: 'mostrar_nombre_en_pantalla',
    valor: 'abreviado',
    descripcion:
      'Cómo aparece el paciente en los televisores de sala: completo | abreviado ("Rosa Q.") | oculto (solo el turno). ' +
      'Las pantallas se sirven sin restricción de red, así que un enlace filtrado muestra en vivo a quién atiende la clínica.',
  },
] as const;
