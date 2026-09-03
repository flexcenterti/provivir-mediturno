/**
 * Reglas puras del motor de agendamiento (RN-01 a RN-04).
 *
 * Están separadas del servicio a propósito: son funciones sin BD ni IO, así se
 * prueban exhaustivamente (incluido property-based) y el servicio queda como
 * orquestador transaccional. La lógica de negocio NO vive en ningún otro módulo.
 */
import type { TipoCita } from '@provivir/shared';

export interface CitaExistente {
  horaInicio: number;
  duracionMin: number;
  tipo: TipoCita;
}

export interface Cupo {
  horaInicio: number;
  duracionMin: number;
}

export interface FranjaAgenda {
  horaIni: number;
  horaFin: number;
  slotMin: number;
}

/** Dos rangos [ini, fin) se solapan si cada uno empieza antes de que el otro acabe. */
export function seSolapan(aIni: number, aDur: number, bIni: number, bDur: number): boolean {
  return aIni < bIni + bDur && bIni < aIni + aDur;
}

export function chocaConAlguna(cupo: Cupo, citas: CitaExistente[]): boolean {
  return citas.some((c) => seSolapan(cupo.horaInicio, cupo.duracionMin, c.horaInicio, c.duracionMin));
}

/**
 * RN-01.5 · Regla dura del intercalado.
 *
 * Prohibido agendar dos citas de control CONSECUTIVAS. "Consecutiva" se evalúa
 * sobre el orden temporal real de la agenda del prestador ese día: se mira la cita
 * inmediatamente anterior y la inmediatamente posterior al cupo candidato.
 *
 * Motivo de negocio (RN-01.5): los controles no facturan; una secuencia de controles
 * deja al médico sin citas que generen ingreso.
 *
 * INTERPRETACIÓN — adyacencia real, sin filtrar por tipo.
 * Cualquier cita que no sea control rompe la cadena, incluidos procedimientos y
 * exámenes. Un suero de vitamina C entre dos controles SÍ factura, así que la
 * secuencia control–procedimiento–control no incurre en el problema que la regla
 * busca evitar. La alternativa (mirar solo general/control e ignorar el resto)
 * bloquearía agendas legítimas sin beneficio de negocio.
 * Pendiente de confirmación con el cliente.
 */
export function violaIntercaladoEnAgenda(
  cupo: Cupo,
  tipoNuevo: TipoCita,
  citasDelDia: CitaExistente[],
): boolean {
  if (tipoNuevo !== 'control') return false;

  const ordenadas = [...citasDelDia].sort((a, b) => a.horaInicio - b.horaInicio);

  const anterior = [...ordenadas].reverse().find((c) => c.horaInicio < cupo.horaInicio);
  const posterior = ordenadas.find((c) => c.horaInicio > cupo.horaInicio);

  return anterior?.tipo === 'control' || posterior?.tipo === 'control';
}

/**
 * RN-01.3 · La cita de control solo puede agendarse dentro de una ventana de días
 * posterior a la consulta origen, configurable por prestador.
 */
export function controlDentroDeVentana(
  fechaConsultaOrigen: Date,
  fechaControl: Date,
  ventanaDias: number,
): boolean {
  const dias = Math.round((fechaControl.getTime() - fechaConsultaOrigen.getTime()) / 86_400_000);
  return dias >= 0 && dias <= ventanaDias;
}

/**
 * RN-04.6 · Primera fecha que un canal de autoservicio puede agendar.
 *
 * Recibe "hoy" en vez de calcularlo: este archivo no toca reloj ni zona horaria,
 * así se mantiene puro y probable. Quien llama ya resolvió el día de la sede con
 * `hoyEnSede()`. Ambas fechas son medianoche UTC, así que la aritmética de días
 * es exacta — el mismo criterio que `controlDentroDeVentana`.
 */
export function primeraFechaAgendable(hoy: Date, anticipacionDias: number): Date {
  return new Date(hoy.getTime() + anticipacionDias * 86_400_000);
}

/**
 * RN-04.6 · El paciente no puede agendarse solo para hoy ni para una fecha pasada:
 * la agenda del día ya está comprometida y la administra la sede. Con anticipación
 * 0 la regla queda apagada y hoy vuelve a ser agendable, sin desplegar nada.
 */
export function cumpleAnticipacionMinima(
  hoy: Date,
  fechaSolicitada: Date,
  anticipacionDias: number,
): boolean {
  return fechaSolicitada.getTime() >= primeraFechaAgendable(hoy, anticipacionDias).getTime();
}

/**
 * Genera los cupos candidatos de una franja, respetando la duración pedida.
 *
 * RN-04.4 · un servicio de N cupos ocupa N × slot: la duración efectiva ya viene
 * calculada por el llamador, y aquí solo se exige que quepa completa antes del cierre.
 */
export function generarCupos(franja: FranjaAgenda, duracionMin: number): Cupo[] {
  const cupos: Cupo[] = [];
  for (let h = franja.horaIni; h + duracionMin <= franja.horaFin; h += franja.slotMin) {
    cupos.push({ horaInicio: h, duracionMin });
  }
  return cupos;
}

/**
 * RN-03 · Asignación por bloques: compacta la agenda del prestador.
 *
 * La recomendación principal es el cupo contiguo (o más cercano) a la última cita
 * asignada del día. `huecoMax` es el hueco tolerado; con 0 se compacta al máximo.
 * Objetivo: evitar espacios muertos (cita a las 8:00 y la siguiente a las 12:00).
 *
 * Devuelve los cupos ordenados por preferencia, NO filtrados: RN-03.4 dice que la
 * optimización gobierna la recomendación, no impone. El paciente siempre puede
 * pedir un horario específico.
 */
export function ordenarPorCompactacion(
  cupos: Cupo[],
  citasDelDia: CitaExistente[],
  huecoMax: number,
): Cupo[] {
  if (citasDelDia.length === 0) {
    return [...cupos].sort((a, b) => a.horaInicio - b.horaInicio);
  }

  const finUltima = Math.max(...citasDelDia.map((c) => c.horaInicio + c.duracionMin));

  const distancia = (c: Cupo): number => {
    if (c.horaInicio < finUltima) return Number.MAX_SAFE_INTEGER; // hueco anterior: menos preferible
    return c.horaInicio - finUltima;
  };

  return [...cupos].sort((a, b) => {
    const da = distancia(a);
    const db = distancia(b);

    // Dentro del hueco tolerado, todos cuentan como "contiguos": desempata la hora.
    const aTolerado = da <= huecoMax;
    const bTolerado = db <= huecoMax;
    if (aTolerado !== bTolerado) return aTolerado ? -1 : 1;

    if (da !== db) return da - db;
    return a.horaInicio - b.horaInicio;
  });
}

export interface CargaPrestador {
  prestadorId: string;
  /** RN-02.4 · consultas generales del día. Los controles NO se cuentan. */
  consultasGenerales: number;
}

/**
 * RN-02 · Balanceo de carga, exclusivamente para el grupo de medicina general.
 *
 * Cuando el paciente no expresa preferencia, se asigna al prestador elegible con
 * menor carga. La métrica de comparación es la CANTIDAD DE CONSULTAS GENERALES
 * del día: las citas de control no se cuentan porque distorsionan la equidad
 * (no facturan), aunque sí ocupan agenda.
 *
 * Ojo: esta métrica es distinta del % de ocupación del dashboard (RN-02.5), que
 * sí incluye los controles porque mide tiempo ocupado. Son dos indicadores que coexisten.
 */
export function elegirPorMenorCarga(cargas: CargaPrestador[]): string | null {
  if (cargas.length === 0) return null;

  const minimo = Math.min(...cargas.map((c) => c.consultasGenerales));
  const empatados = cargas.filter((c) => c.consultasGenerales === minimo);

  // Desempate estable por id: dos llamadas con la misma carga dan el mismo resultado.
  return [...empatados].sort((a, b) => a.prestadorId.localeCompare(b.prestadorId))[0]!.prestadorId;
}

/**
 * RN-02.5 · Ocupación mostrada en el dashboard: % del tiempo de la jornada que está
 * ocupado. TODAS las citas ocupan tiempo, incluidos los controles.
 */
export function porcentajeOcupacion(citas: CitaExistente[], minutosJornada: number): number {
  if (minutosJornada <= 0) return 0;
  const ocupados = citas.reduce((s, c) => s + c.duracionMin, 0);
  return Math.min(100, Math.round((ocupados / minutosJornada) * 100));
}
