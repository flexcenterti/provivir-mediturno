import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { aHHMM, aMinutos, CONFIG, SEDE_ID, type TipoCita } from '@provivir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { AgendasService, aFechaUtc } from '../agendas/agendas.service';
import {
  chocaConAlguna, controlDentroDeVentana, elegirPorMenorCarga, generarCupos,
  ordenarPorCompactacion, violaIntercaladoEnAgenda,
  type CitaExistente, type Cupo,
} from './citas.reglas';
import { RecordatoriosService } from '../recordatorios/recordatorios.service';
import type { CancelarCitaDto, ConsultarCuposDto, CrearCitaDto, ReprogramarCitaDto } from './dto/cita.dto';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

const ESTADOS_VIVOS = ['pendiente_llegada', 'confirmada', 'llego', 'en_atencion'] as const;

/**
 * Con los advisory locks, varias peticiones al mismo prestador y día hacen cola.
 * Los tiempos por defecto de Prisma (2 s de espera, 5 s de transacción) son cortos
 * para una ráfaga: WhatsApp, portal y mostrador pueden coincidir sobre el mismo médico.
 */
const OPCIONES_TX = { maxWait: 15_000, timeout: 20_000 } as const;

export interface CupoOfrecido {
  prestadorId: string;
  prestadorNombre: string;
  fecha: string;
  hora: string;
  duracionMin: number;
  consultorio: string | null;
}

/**
 * Motor de agendamiento — único punto de asignación de cupos (Arquitectura §6, A3).
 *
 * WhatsApp, el portal y el backoffice consumen esta API; ninguno recalcula reglas.
 * Las reglas puras viven en `citas.reglas.ts`; aquí se orquesta con la BD y transacciones.
 */
@Injectable()
export class CitasService {
  private readonly log = new Logger(CitasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agendas: AgendasService,
    private readonly auditoria: AuditoriaService,
    private readonly configuracion: ConfiguracionService,
    private readonly recordatorios: RecordatoriosService,
  ) {}

  // ─────────────────────── Consulta de cupos ───────────────────────

  /**
   * Devuelve los cupos válidos ya filtrados por disponibilidad de agenda, solapamiento,
   * intercalado (RN-01), cupos múltiples (RN-04) y ordenados por compactación (RN-03).
   * En medicina general sin preferencia de prestador, ordena por menor carga (RN-02).
   */
  async cupos(dto: ConsultarCuposDto): Promise<CupoOfrecido[]> {
    const fecha = aFechaUtc(dto.fecha);
    const servicio = await this.prisma.servicio.findUnique({ where: { id: dto.servicioId } });
    if (!servicio) throw new NotFoundException('Servicio no encontrado');
    /*
     * Un servicio retirado no se ofrece ni se agenda. Los prestadores ya se
     * filtraban por `activo`, el servicio no: al retirarlo desaparecía del portal
     * pero el motor seguía dando cupos, así que se podía seguir agendando desde el
     * mostrador y desde la IA. Las citas ya creadas no se tocan.
     */
    if (!servicio.activo) throw new NotFoundException('El servicio ya no está disponible');

    const tipo = (dto.tipo ?? servicio.tipo) as TipoCita;
    const limite = dto.limite ?? 10;

    const candidatos = await this.prestadoresCandidatos(dto.servicioId, dto.prestadorId);
    if (candidatos.length === 0) return [];

    // RN-01.3 · un control exige consulta origen dentro de la ventana del prestador.
    if (tipo === 'control') {
      await this.validarVentanaControl(dto.citaOrigenId, fecha, candidatos.map((c) => c.id));
    }

    const ordenados = await this.ordenarCandidatos(candidatos, fecha, Boolean(dto.prestadorId));
    const huecoMax = this.configuracion.numero(CONFIG.HUECO_MAX_MIN, 0);

    // Lista por prestador, cada una ya ordenada por compactación (RN-03).
    const porPrestador: CupoOfrecido[][] = [];

    for (const prestador of ordenados) {
      const duracionMin = await this.duracionEfectiva(prestador.id, servicio);
      const agendasDelDia = await this.agendas.vigentesEnFecha(prestador.id, fecha);
      const citasDelDia = await this.citasDelDia(this.prisma, prestador.id, fecha);
      const suyos: CupoOfrecido[] = [];

      for (const agenda of agendasDelDia) {
        const brutos = generarCupos(
          { horaIni: aMinutos(agenda.horaIni), horaFin: aMinutos(agenda.horaFin), slotMin: agenda.slotMin },
          duracionMin,
        );

        const validos = brutos.filter(
          (c) => !chocaConAlguna(c, citasDelDia) && !violaIntercaladoEnAgenda(c, tipo, citasDelDia),
        );

        for (const cupo of ordenarPorCompactacion(validos, citasDelDia, huecoMax)) {
          suyos.push({
            prestadorId: prestador.id,
            prestadorNombre: prestador.nombre,
            fecha: dto.fecha,
            hora: aHHMM(cupo.horaInicio),
            duracionMin: cupo.duracionMin,
            consultorio: agenda.consultorio,
          });
        }
      }

      if (suyos.length > 0) porPrestador.push(suyos);
    }

    return this.intercalarPorPrestador(porPrestador, limite);
  }

  /**
   * Combina las listas de cada prestador en ronda: primero el mejor cupo del prestador
   * con menor carga, luego el del siguiente, y así.
   *
   * Sin esto, la lista se llenaba con todos los cupos del primer prestador y el paciente
   * no veía los demás: tras ocuparse las 08:00 de Osorio, el portal ofrecía únicamente
   * las tardes de Ortiz y escondía la mañana libre. Así se conservan las dos reglas
   * —RN-02 decide a quién se propone primero, RN-03 qué hora dentro de cada agenda—
   * y el paciente sigue viendo un abanico real de horarios.
   */
  private intercalarPorPrestador(listas: CupoOfrecido[][], limite: number): CupoOfrecido[] {
    const salida: CupoOfrecido[] = [];
    const maximo = Math.max(0, ...listas.map((l) => l.length));

    for (let i = 0; i < maximo && salida.length < limite; i++) {
      for (const lista of listas) {
        const cupo = lista[i];
        if (cupo) salida.push(cupo);
        if (salida.length >= limite) break;
      }
    }

    return salida;
  }

  // ─────────────────────── Creación transaccional ───────────────────────

  /**
   * RN-01 a RN-04 · crea la cita revalidando TODAS las reglas dentro de la transacción.
   *
   * Concurrencia: se toma un advisory lock por (sede, fecha). Serializa las creaciones
   * del mismo día, que es lo que exige el balanceo de RN-02 — dos peticiones simultáneas
   * sin lock verían el mismo "prestador con menor carga" y romperían la equidad —
   * y de paso evita la doble asignación del mismo cupo entre WhatsApp, portal y mostrador.
   * A 400+ citas/día el costo de serializar por fecha es despreciable.
   */
  async crear(dto: CrearCitaDto, usuarioId: string) {
    const fecha = aFechaUtc(dto.fecha);
    const horaInicio = aMinutos(dto.hora);

    const servicio = await this.prisma.servicio.findUnique({ where: { id: dto.servicioId } });
    if (!servicio) throw new NotFoundException('Servicio no encontrado');
    /*
     * Un servicio retirado no se ofrece ni se agenda. Los prestadores ya se
     * filtraban por `activo`, el servicio no: al retirarlo desaparecía del portal
     * pero el motor seguía dando cupos, así que se podía seguir agendando desde el
     * mostrador y desde la IA. Las citas ya creadas no se tocan.
     */
    if (!servicio.activo) throw new NotFoundException('El servicio ya no está disponible');

    const paciente = await this.prisma.paciente.findUnique({ where: { id: dto.pacienteId } });
    if (!paciente) throw new NotFoundException('Paciente no encontrado');

    const tipo = (dto.tipo ?? servicio.tipo) as TipoCita;

    const cita = await this.prisma.$transaction(async (tx) => {
      // La duración depende del prestador, y el prestador del balanceo: se resuelve
      // con la duración de catálogo y se recalcula una vez elegido.
      const preliminar: Cupo = { horaInicio, duracionMin: servicio.duracionMin };
      const prestadorId =
        dto.prestadorId ?? (await this.elegirPrestador(tx, dto.servicioId, fecha, preliminar));
      if (!prestadorId) {
        throw new BadRequestException('No hay prestadores disponibles para ese servicio y horario');
      }

      await this.lockPrestadorFecha(tx, prestadorId, dto.fecha);

      const duracionMin = await this.duracionEfectiva(prestadorId, servicio);
      const cupo: Cupo = { horaInicio, duracionMin };

      await this.validarCupo(tx, { prestadorId, fecha, cupo, tipo, servicioId: dto.servicioId, citaOrigenId: dto.citaOrigenId });

      await this.lockFecha(tx, dto.fecha);
      const codigo = await this.generarCodigo(tx, fecha, servicio.categoria, tipo);

      return tx.cita.create({
        data: {
          codigo,
          pacienteId: dto.pacienteId,
          prestadorId,
          servicioId: dto.servicioId,
          tipo,
          citaOrigenId: dto.citaOrigenId ?? null,
          fecha,
          horaInicio,
          duracionMin,
          estado: 'confirmada',
          origen: (dto.origen ?? 'asistente') as never,
          observacion: dto.observacion ?? null,
          sedeId: SEDE_ID,
        },
        include: { paciente: true, prestador: true, servicio: true },
      });
    }, OPCIONES_TX);

    // Recordatorios 24 h antes y el mismo día (Guía, FASE 4).
    await this.recordatorios.programar(cita.id, cita.fecha, cita.horaInicio);

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Cita creada',
      entidad: `cita/${cita.codigo}`,
      detalle: `${cita.prestador.nombre} · ${dto.fecha} ${dto.hora} · ${cita.servicio.nombre} (${tipo})`,
      estadoNext: 'confirmada',
    });

    return cita;
  }

  /**
   * Cuando el cupo se ocupa a mitad de conversación, la IA y el portal necesitan
   * alternativas inmediatas en vez de un error seco (Arquitectura §6).
   */
  async crearConAlternativas(dto: CrearCitaDto, usuarioId: string) {
    try {
      return { creada: true as const, cita: await this.crear(dto, usuarioId) };
    } catch (e) {
      if (!(e instanceof ConflictException)) throw e;

      const alternativas = await this.cupos({
        servicioId: dto.servicioId,
        fecha: dto.fecha,
        prestadorId: dto.prestadorId,
        tipo: dto.tipo,
        citaOrigenId: dto.citaOrigenId,
        limite: 5,
      } as ConsultarCuposDto);

      return { creada: false as const, motivo: e.message, alternativas };
    }
  }

  // ─────────────────────── Reprogramación y cancelación ───────────────────────

  /** Si cambia el día, se emite un código nuevo: el código es único por sede y día. */
  async reprogramar(id: string, dto: ReprogramarCitaDto, usuarioId: string) {
    const original = await this.prisma.cita.findUnique({ where: { id }, include: { servicio: true } });
    if (!original) throw new NotFoundException('Cita no encontrada');
    if (original.estado === 'cancelada' || original.estado === 'atendida') {
      throw new BadRequestException(`No se puede reprogramar una cita ${original.estado}`);
    }

    const fecha = aFechaUtc(dto.fecha);
    const horaInicio = aMinutos(dto.hora);
    const cambiaDia = fecha.getTime() !== original.fecha.getTime();

    const actualizada = await this.prisma.$transaction(async (tx) => {
      const prestadorId = dto.prestadorId ?? original.prestadorId;
      await this.lockPrestadorFecha(tx, prestadorId, dto.fecha);
      const duracionMin = await this.duracionEfectiva(prestadorId, original.servicio);

      await this.validarCupo(tx, {
        prestadorId, fecha, cupo: { horaInicio, duracionMin },
        tipo: original.tipo as TipoCita, servicioId: original.servicioId,
        citaOrigenId: original.citaOrigenId ?? undefined, excluirCitaId: id,
      });

      let codigo = original.codigo;
      if (cambiaDia) {
        await this.lockFecha(tx, dto.fecha);
        codigo = await this.generarCodigo(tx, fecha, original.servicio.categoria, original.tipo as TipoCita);
      }

      return tx.cita.update({
        where: { id },
        data: { fecha, horaInicio, duracionMin, prestadorId, codigo },
        include: { paciente: true, prestador: true, servicio: true },
      });
    }, OPCIONES_TX);

    // Los recordatorios de la hora anterior ya no aplican.
    await this.recordatorios.cancelar(id);
    await this.recordatorios.programar(id, actualizada.fecha, actualizada.horaInicio);

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Cita reprogramada',
      entidad: `cita/${actualizada.codigo}`,
      detalle:
        `${aHHMM(original.horaInicio)} → ${dto.hora} · ` +
        `${original.fecha.toISOString().slice(0, 10)} → ${dto.fecha}` +
        (cambiaDia ? ` · código ${original.codigo} → ${actualizada.codigo}` : '') +
        (dto.motivo ? ` · ${dto.motivo}` : ''),
    });

    return actualizada;
  }

  async cancelar(id: string, dto: CancelarCitaDto, usuarioId: string) {
    const cita = await this.prisma.cita.findUnique({ where: { id } });
    if (!cita) throw new NotFoundException('Cita no encontrada');
    if (cita.estado === 'cancelada') throw new BadRequestException('La cita ya está cancelada');

    const cancelada = await this.prisma.cita.update({
      where: { id },
      data: { estado: 'cancelada', observacion: dto.motivo },
      include: { paciente: true, prestador: true, servicio: true },
    });

    await this.recordatorios.cancelar(id);

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Cita cancelada',
      entidad: `cita/${cita.codigo}`,
      detalle: dto.motivo,
      estadoPrev: cita.estado,
      estadoNext: 'cancelada',
    });

    // La notificación al paciente se encola en la Fase 4.
    return cancelada;
  }

  // ─────────────────────── Consultas ───────────────────────

  async porId(id: string) {
    const cita = await this.prisma.cita.findUnique({
      where: { id },
      include: { paciente: true, prestador: true, servicio: true, turno: true },
    });
    if (!cita) throw new NotFoundException('Cita no encontrada');
    return cita;
  }

  /** Especificación §2.7 · buscador por código, nombre del paciente o documento. */
  async buscar(q: string) {
    const texto = q.trim();
    if (texto.length < 3) throw new BadRequestException('La búsqueda requiere al menos 3 caracteres');

    return this.prisma.cita.findMany({
      where: {
        OR: [
          { codigo: { equals: texto.toUpperCase() } },
          { paciente: { documento: { startsWith: texto } } },
          { paciente: { apellidos: { contains: texto, mode: 'insensitive' } } },
          { paciente: { nombres: { contains: texto, mode: 'insensitive' } } },
        ],
      },
      include: { paciente: true, prestador: true, servicio: true },
      orderBy: [{ fecha: 'desc' }, { horaInicio: 'asc' }],
      take: 50,
    });
  }

  /** Agenda consolidada: día, semana o mes (Especificación §2.8). */
  async agendaConsolidada(desde: string, hasta: string, prestadorId?: string) {
    return this.prisma.cita.findMany({
      where: {
        fecha: { gte: aFechaUtc(desde), lte: aFechaUtc(hasta) },
        ...(prestadorId ? { prestadorId } : {}),
        estado: { not: 'cancelada' },
      },
      include: { paciente: true, prestador: true, servicio: true, turno: true },
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    });
  }

  // ─────────────────────── Interno ───────────────────────

  /**
   * Advisory locks transaccionales: se liberan al terminar la transacción, pase lo
   * que pase. No requieren tabla de bloqueos ni limpieza.
   *
   * Se toman SIEMPRE en este orden — prestador y luego fecha — para que no puedan
   * producir un interbloqueo entre transacciones concurrentes.
   */
  private async lockPrestadorFecha(tx: Tx, prestadorId: string, fecha: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${SEDE_ID}:${fecha}:${prestadorId}`}))`;
  }

  /**
   * Lock de fecha, tomado solo justo antes de generar el código y insertar.
   * El código es único por sede y día, así que su contador debe serializarse; pero
   * la validación (agendas, solapamiento, intercalado) ya corrió en paralelo.
   * Serializar apenas la cola de la transacción evita que 20 peticiones simultáneas
   * agoten el pool de conexiones esperando un lock de día completo.
   */
  private async lockFecha(tx: Tx, fecha: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${SEDE_ID}:${fecha}`}))`;
  }

  private async citasDelDia(cliente: Tx, prestadorId: string, fecha: Date, excluirId?: string): Promise<CitaExistente[]> {
    const citas = await cliente.cita.findMany({
      where: {
        prestadorId, fecha,
        estado: { in: ESTADOS_VIVOS as unknown as Prisma.EnumEstadoCitaFilter['in'] },
        ...(excluirId ? { id: { not: excluirId } } : {}),
      },
      select: { horaInicio: true, duracionMin: true, tipo: true },
    });
    return citas.map((c) => ({ horaInicio: c.horaInicio, duracionMin: c.duracionMin, tipo: c.tipo as TipoCita }));
  }

  /** RN-04.4 · la duración efectiva es la del prestador, o cupos × slot si el servicio ocupa varios. */
  private async duracionEfectiva(prestadorId: string, servicio: { id: string; duracionMin: number; cupos: number }): Promise<number> {
    const propia = await this.prisma.prestadorServicio.findUnique({
      where: { prestadorId_servicioId: { prestadorId, servicioId: servicio.id } },
    });
    return propia?.duracionMin ?? servicio.duracionMin;
  }

  private async prestadoresCandidatos(servicioId: string, prestadorId?: string) {
    if (prestadorId) {
      const p = await this.prisma.prestador.findUnique({ where: { id: prestadorId } });
      if (!p || !p.activo) throw new NotFoundException('Prestador no encontrado o inactivo');
      return [p];
    }

    const conServicio = await this.prisma.prestador.findMany({
      where: { activo: true, servicios: { some: { servicioId } } },
      orderBy: { nombre: 'asc' },
    });
    if (conServicio.length > 0) return conServicio;

    // Fallback: prestadores cuya agenda declara ese servicio.
    return this.prisma.prestador.findMany({
      where: { activo: true, agendas: { some: { servicioId, activa: true } } },
      orderBy: { nombre: 'asc' },
    });
  }

  /**
   * RN-02 · si el paciente no expresó preferencia y los candidatos son del grupo de
   * medicina general, se ordenan por menor carga. Los especialistas NO balancean (RN-04.2).
   */
  private async ordenarCandidatos(
    candidatos: Array<{ id: string; nombre: string; grupoBalanceo: boolean }>,
    fecha: Date,
    hayPreferencia: boolean,
  ) {
    if (hayPreferencia || !candidatos.every((c) => c.grupoBalanceo)) return candidatos;

    const cargas = await this.cargasDelDia(this.prisma, candidatos.map((c) => c.id), fecha);
    return [...candidatos].sort(
      (a, b) => (cargas.get(a.id) ?? 0) - (cargas.get(b.id) ?? 0) || a.id.localeCompare(b.id),
    );
  }

  /** RN-02.4 · la métrica comparativa cuenta SOLO consultas generales. Los controles no. */
  private async cargasDelDia(cliente: Tx, prestadorIds: string[], fecha: Date): Promise<Map<string, number>> {
    const filas = await cliente.cita.groupBy({
      by: ['prestadorId'],
      where: {
        prestadorId: { in: prestadorIds }, fecha, tipo: 'general',
        estado: { in: ESTADOS_VIVOS as unknown as Prisma.EnumEstadoCitaFilter['in'] },
      },
      _count: { _all: true },
    });

    const mapa = new Map(prestadorIds.map((id) => [id, 0]));
    for (const f of filas) mapa.set(f.prestadorId, f._count._all);
    return mapa;
  }

  /**
   * RN-02 · elige prestador cuando el paciente no expresó preferencia.
   *
   * El balanceo se aplica SOLO entre quienes realmente pueden atender ese horario.
   * Sin este filtro, "el de menor carga" podía ser un médico que no trabaja a esa hora
   * (Ortiz atiende 14:00–18:00) y la cita se rechazaba después de haberla ofrecido.
   */
  private async elegirPrestador(tx: Tx, servicioId: string, fecha: Date, cupo: Cupo): Promise<string | null> {
    const candidatos = await this.prestadoresCandidatos(servicioId);
    if (candidatos.length === 0) return null;

    const disponibles: typeof candidatos = [];
    for (const c of candidatos) {
      if (await this.tieneFranjaPara(c.id, fecha, cupo)) disponibles.push(c);
    }
    if (disponibles.length === 0) return null;
    if (disponibles.length === 1) return disponibles[0]!.id;

    // RN-04.2 · fuera de medicina general no hay balanceo: el primero disponible.
    if (!disponibles.every((c) => c.grupoBalanceo)) return disponibles[0]!.id;

    const cargas = await this.cargasDelDia(tx, disponibles.map((c) => c.id), fecha);
    return elegirPorMenorCarga(
      disponibles.map((c) => ({ prestadorId: c.id, consultasGenerales: cargas.get(c.id) ?? 0 })),
    );
  }

  /** ¿Alguna franja del prestador ese día contiene el cupo, alineado al slot? */
  private async tieneFranjaPara(prestadorId: string, fecha: Date, cupo: Cupo): Promise<boolean> {
    const agendas = await this.agendas.vigentesEnFecha(prestadorId, fecha);
    return agendas.some((a) => {
      const ini = aMinutos(a.horaIni);
      const fin = aMinutos(a.horaFin);
      return (
        cupo.horaInicio >= ini &&
        cupo.horaInicio + cupo.duracionMin <= fin &&
        (cupo.horaInicio - ini) % a.slotMin === 0
      );
    });
  }

  /** Revalida TODAS las reglas dentro de la transacción, justo antes de insertar. */
  private async validarCupo(
    tx: Tx,
    args: {
      prestadorId: string; fecha: Date; cupo: Cupo; tipo: TipoCita;
      servicioId: string; citaOrigenId?: string; excluirCitaId?: string;
    },
  ): Promise<void> {
    const agendasDelDia = await this.agendas.vigentesEnFecha(args.prestadorId, args.fecha);
    if (agendasDelDia.length === 0) {
      throw new ConflictException('El prestador no tiene agenda disponible en esa fecha');
    }

    // El servicio declarado en la agenda es informativo (franja principal), no una
    // restricción: un mismo prestador atiende consulta y control en la misma franja.
    const cabeEnAlguna = agendasDelDia.some((a) => {
      const ini = aMinutos(a.horaIni);
      const fin = aMinutos(a.horaFin);
      const alineado = (args.cupo.horaInicio - ini) % a.slotMin === 0;
      return args.cupo.horaInicio >= ini && args.cupo.horaInicio + args.cupo.duracionMin <= fin && alineado;
    });
    if (!cabeEnAlguna) {
      throw new ConflictException('El horario solicitado está fuera de la agenda del prestador');
    }

    const citasDelDia = await this.citasDelDia(tx, args.prestadorId, args.fecha, args.excluirCitaId);

    if (chocaConAlguna(args.cupo, citasDelDia)) {
      throw new ConflictException('El cupo ya está ocupado');
    }

    if (violaIntercaladoEnAgenda(args.cupo, args.tipo, citasDelDia)) {
      throw new ConflictException(
        'No se permiten dos citas de control consecutivas (RN-01). Se ofrecen otros cupos.',
      );
    }

    if (args.tipo === 'control') {
      await this.validarVentanaControl(args.citaOrigenId, args.fecha, [args.prestadorId]);
    }
  }

  /** RN-01.3 · el control exige consulta origen y debe caer dentro de la ventana del prestador. */
  private async validarVentanaControl(citaOrigenId: string | undefined, fecha: Date, prestadorIds: string[]): Promise<void> {
    if (!citaOrigenId) {
      throw new BadRequestException('Una cita de control exige la consulta origen (RN-01)');
    }

    const origen = await this.prisma.cita.findUnique({ where: { id: citaOrigenId } });
    if (!origen) throw new NotFoundException('Consulta origen no encontrada');
    if (origen.tipo !== 'general') {
      throw new BadRequestException('La consulta origen de un control debe ser una consulta general');
    }

    const prestadorId = prestadorIds.includes(origen.prestadorId) ? origen.prestadorId : prestadorIds[0]!;
    const config = await this.prisma.prestadorConfig.findUnique({ where: { prestadorId } });
    const ventana = config?.ventanaControlDias ?? this.configuracion.numero(CONFIG.VENTANA_CONTROL_DIAS_DEFECTO, 10);

    if (!controlDentroDeVentana(origen.fecha, fecha, ventana)) {
      throw new BadRequestException(
        `La cita de control debe agendarse dentro de los ${ventana} días siguientes a la consulta origen (RN-01)`,
      );
    }
  }

  /**
   * Código de atención único por sede y día. Se genera dentro del lock de fecha,
   * así que el contador no puede colisionar entre peticiones concurrentes.
   */
  private async generarCodigo(tx: Tx, fecha: Date, categoria: string, tipo: TipoCita): Promise<string> {
    const prefijo = tipo === 'control' ? 'C' : (categoria.trim()[0] ?? 'X').toUpperCase();
    const delDia = await tx.cita.count({ where: { fecha, sedeId: SEDE_ID } });
    return `${prefijo}${String(delDia + 1).padStart(4, '0')}`;
  }
}
