import { ZONA_SEDE } from '@provivir/shared';

/**
 * Cuándo puede salir cada mensaje de la secuencia (RN-09.9.5 y RN-09.9.6).
 *
 * Todo se calcula en la zona de la sede. La clínica opera en Cali (UTC−5) y el
 * servidor puede estar en otra: usar la del servidor mandaría mensajes comerciales
 * de madrugada.
 */

/** Minutos desde `T0` para cada paso (RN-09.9.2). */
export const RETRASOS_MIN = { seguimiento_1: 120, seguimiento_2: 300, cierre: 480 } as const;

/** Ventana de atención al cliente de WhatsApp. Fuera de ella solo salen plantillas. */
export const VENTANA_META_HORAS = 24;

export interface HorarioSede {
  /** Minutos desde medianoche. */
  aperturaMin: number;
  cierreMin: number;
  /** Días hábiles, 0 = domingo. */
  dias: number[];
}

/** Horario del cliente: lunes a viernes 7-18, sábados 7-13 (documentación comercial). */
export const HORARIO_POR_DEFECTO: HorarioSede = {
  aperturaMin: 7 * 60,
  cierreMin: 18 * 60,
  dias: [1, 2, 3, 4, 5, 6],
};

/** Partes de un instante ya trasladadas a la zona de la sede. */
function enSede(momento: Date, zona = ZONA_SEDE): { dia: number; minutos: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(momento);

  const valor = (tipo: string): string => partes.find((p) => p.type === tipo)?.value ?? '0';
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    dia: dias[valor('weekday')] ?? 0,
    // 24:00 aparece como "24" en algunas plataformas para la medianoche.
    minutos: (Number(valor('hour')) % 24) * 60 + Number(valor('minute')),
  };
}

export function dentroDelHorario(momento: Date, horario = HORARIO_POR_DEFECTO, zona = ZONA_SEDE): boolean {
  const { dia, minutos } = enSede(momento, zona);
  return horario.dias.includes(dia) && minutos >= horario.aperturaMin && minutos < horario.cierreMin;
}

/**
 * Adelanta el envío al siguiente instante hábil. Avanza en saltos de 15 minutos
 * en vez de calcular la apertura exacta: es una función de diferimiento, no de
 * agendamiento, y así respeta cualquier horario configurado sin casos especiales
 * de cambio de día, fin de semana o festivo.
 */
export function proximoHabil(momento: Date, horario = HORARIO_POR_DEFECTO, zona = ZONA_SEDE): Date {
  if (dentroDelHorario(momento, horario, zona)) return momento;

  const paso = 15 * 60_000;
  let t = momento.getTime();
  // Tope de una semana: si el horario configurado no tiene ningún día hábil, esto
  // devuelve el momento original en vez de girar para siempre.
  const limite = t + 7 * 24 * 60 * 60_000;

  while (t <= limite) {
    t += paso;
    const candidato = new Date(t);
    if (dentroDelHorario(candidato, horario, zona)) return candidato;
  }
  return momento;
}

/**
 * RN-09.9.6 · ¿el envío cabe en la ventana de 24 h que abrió el paciente?
 * Fuera de ella WhatsApp solo admite plantillas preaprobadas.
 */
export function dentroDeVentanaMeta(ultimoMensajePaciente: Date, envio: Date): boolean {
  return envio.getTime() - ultimoMensajePaciente.getTime() < VENTANA_META_HORAS * 60 * 60_000;
}

/** Momento de envío de un paso, ya diferido si cae fuera del horario. */
export function momentoDeEnvio(
  t0: Date,
  paso: keyof typeof RETRASOS_MIN,
  horario = HORARIO_POR_DEFECTO,
  zona = ZONA_SEDE,
): Date {
  return proximoHabil(new Date(t0.getTime() + RETRASOS_MIN[paso] * 60_000), horario, zona);
}
