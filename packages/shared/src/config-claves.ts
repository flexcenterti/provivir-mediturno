/**
 * Parámetros de reglas que viven en la tabla `configuracion`, nunca en código
 * (Arquitectura §9). Cambiarlos no debe requerir despliegue.
 */
export const CONFIG = {
  /** RN-03.2 · Hueco máximo tolerado entre citas al recomendar. Valor inicial: 0 (compactar al máximo). */
  HUECO_MAX_MIN: 'hueco_max_min',
  /** RN-01.3 · Ventana de control por defecto cuando el prestador no define la suya. */
  VENTANA_CONTROL_DIAS_DEFECTO: 'ventana_control_dias_defecto',
  /** D3 · El kiosko queda construido pero apagado. */
  KIOSKO_ACTIVO: 'kiosko_activo',
  /** RN-08 · Umbral bajo el cual la IA escala a la asistente. */
  UMBRAL_CONFIANZA_IA: 'umbral_confianza_ia',
  /** RN-11.2 · Cada cuántos minutos se interrumpe el canal para el video institucional. */
  INTERVALO_INSTITUCIONAL_MIN: 'intervalo_institucional_min',
  /** Minutos de anticipación con que se permite registrar llegada. */
  ANTICIPACION_LLEGADA_MIN: 'anticipacion_llegada_min',
  /** Tolerancia de retraso antes de degradar la prioridad en cola. */
  TOLERANCIA_RETRASO_MIN: 'tolerancia_retraso_min',
} as const;

export type ClaveConfig = (typeof CONFIG)[keyof typeof CONFIG];
