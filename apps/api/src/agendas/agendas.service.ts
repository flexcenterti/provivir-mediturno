import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { aMinutos, hoyEnSede, SEDE_ID } from '@provivir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { BloquearAgendaDto, CrearAgendaDto, ProgramacionMensualDto } from './dto/agenda.dto';

/** Lunes=1 … Domingo=7, para que coincida con `diasSemana`. */
export function diaSemanaIso(fecha: Date): number {
  const d = fecha.getUTCDay();
  return d === 0 ? 7 : d;
}

export function aFechaUtc(fecha: string): Date {
  return new Date(`${fecha}T00:00:00Z`);
}

@Injectable()
export class AgendasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  listar(prestadorId?: string) {
    return this.prisma.agenda.findMany({
      where: { ...(prestadorId ? { prestadorId } : {}), activa: true },
      include: { prestador: true, servicio: true },
      orderBy: [{ prestadorId: 'asc' }, { horaIni: 'asc' }],
    });
  }

  /**
   * Agendas vigentes de un prestador en una fecha: las semanales cuyo día coincide
   * más las de calendario de esa fecha exacta. Excluye las bloqueadas.
   * Es la entrada del motor de cupos (Fase 2).
   */
  async vigentesEnFecha(prestadorId: string, fecha: Date) {
    const dia = diaSemanaIso(fecha);
    const agendas = await this.prisma.agenda.findMany({
      where: { prestadorId, activa: true, bloqueada: false },
      include: { servicio: true },
    });

    return agendas.filter((a) =>
      a.modo === 'semanal'
        ? a.diasSemana.includes(dia)
        : a.fecha !== null && a.fecha.getTime() === fecha.getTime(),
    );
  }

  private validar(dto: { modo: string; diasSemana?: number[]; fecha?: string; horaIni: string; horaFin: string; slotMin: number }): void {
    if (aMinutos(dto.horaFin) <= aMinutos(dto.horaIni)) {
      throw new BadRequestException('La hora de fin debe ser posterior a la de inicio');
    }
    if (aMinutos(dto.horaFin) - aMinutos(dto.horaIni) < dto.slotMin) {
      throw new BadRequestException('La franja es más corta que un slot');
    }
    if (dto.modo === 'semanal' && !dto.diasSemana?.length) {
      throw new BadRequestException('La agenda semanal exige al menos un día');
    }
    if (dto.modo === 'calendario' && !dto.fecha) {
      throw new BadRequestException('La agenda por calendario exige una fecha');
    }
  }

  async crear(dto: CrearAgendaDto, usuarioId: string) {
    this.validar(dto);
    await this.verificarPrestador(dto.prestadorId);

    const agenda = await this.prisma.agenda.create({
      data: {
        prestadorId: dto.prestadorId,
        modo: dto.modo,
        diasSemana: dto.diasSemana ?? [],
        fecha: dto.fecha ? aFechaUtc(dto.fecha) : null,
        horaIni: dto.horaIni,
        horaFin: dto.horaFin,
        slotMin: dto.slotMin,
        servicioId: dto.servicioId ?? null,
        consultorio: dto.consultorio ?? null,
        sedeId: SEDE_ID,
      },
      include: { prestador: true, servicio: true },
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Agenda creada',
      entidad: `agenda/${agenda.id}`,
      detalle: `${dto.prestadorId} · ${dto.modo} · ${dto.horaIni}–${dto.horaFin} · slot ${dto.slotMin} min`,
    });

    return agenda;
  }

  /**
   * RN-06.4 · programación masiva mensual. Se hace en una transacción: o quedan
   * todos los días programados o ninguno, para que administración no tenga que
   * reconstruir a mano un mes a medio cargar.
   */
  async programacionMensual(dto: ProgramacionMensualDto, usuarioId: string) {
    this.validar({ ...dto, modo: 'calendario', fecha: dto.fechas[0] });
    await this.verificarPrestador(dto.prestadorId);

    const fechas = [...new Set(dto.fechas)].map(aFechaUtc);

    const creadas = await this.prisma.$transaction(async (tx) => {
      if (dto.reemplazar) {
        await tx.agenda.deleteMany({
          where: { prestadorId: dto.prestadorId, modo: 'calendario', fecha: { in: fechas } },
        });
      }

      await tx.agenda.createMany({
        data: fechas.map((fecha) => ({
          prestadorId: dto.prestadorId,
          modo: 'calendario' as const,
          diasSemana: [],
          fecha,
          horaIni: dto.horaIni,
          horaFin: dto.horaFin,
          slotMin: dto.slotMin,
          servicioId: dto.servicioId ?? null,
          consultorio: dto.consultorio ?? null,
          sedeId: SEDE_ID,
        })),
      });

      return tx.agenda.findMany({
        where: { prestadorId: dto.prestadorId, modo: 'calendario', fecha: { in: fechas } },
        orderBy: { fecha: 'asc' },
      });
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Programación mensual',
      entidad: `prestador/${dto.prestadorId}`,
      detalle: `${fechas.length} días · ${dto.horaIni}–${dto.horaFin}`,
    });

    return { programadas: creadas.length, agendas: creadas };
  }

  /**
   * RN-06.3 · al bloquear disponibilidad con citas asignadas, la plataforma identifica
   * las citas afectadas y las devuelve para que la asistente gestione la reprogramación.
   * Con `confirmar: false` es una simulación: muestra el impacto sin tocar nada.
   */
  async bloquear(id: string, dto: BloquearAgendaDto, usuarioId: string) {
    const agenda = await this.prisma.agenda.findUnique({ where: { id } });
    if (!agenda) throw new NotFoundException('Agenda no encontrada');

    const citasAfectadas = await this.citasAfectadasPorBloqueo(agenda);

    if (!dto.confirmar) {
      return {
        simulacion: true,
        citasAfectadas: citasAfectadas.length,
        citas: citasAfectadas,
        mensaje:
          citasAfectadas.length > 0
            ? `El bloqueo afecta ${citasAfectadas.length} cita(s). Confirme para aplicarlo y gestionar la reprogramación.`
            : 'El bloqueo no afecta citas asignadas.',
      };
    }

    await this.prisma.agenda.update({
      where: { id },
      data: { bloqueada: true, motivoBloqueo: dto.motivo },
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Agenda bloqueada',
      entidad: `agenda/${id}`,
      detalle: `${dto.motivo} · ${citasAfectadas.length} cita(s) afectada(s)`,
      estadoPrev: 'Activa',
      estadoNext: 'Bloqueada',
    });

    return {
      simulacion: false,
      citasAfectadas: citasAfectadas.length,
      citas: citasAfectadas,
      // La notificación por WhatsApp se encola en la Fase 4; aquí queda el conflicto
      // en manos de la asistente, como define RN-06.3.
      mensaje: `Agenda bloqueada. ${citasAfectadas.length} cita(s) requieren reprogramación.`,
    };
  }

  async desbloquear(id: string, usuarioId: string) {
    const agenda = await this.prisma.agenda.findUnique({ where: { id } });
    if (!agenda) throw new NotFoundException('Agenda no encontrada');

    const actualizada = await this.prisma.agenda.update({
      where: { id },
      data: { bloqueada: false, motivoBloqueo: null },
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Agenda desbloqueada',
      entidad: `agenda/${id}`,
      estadoPrev: 'Bloqueada',
      estadoNext: 'Activa',
    });

    return actualizada;
  }

  /** Citas futuras del prestador que caen dentro de la franja de la agenda. */
  private async citasAfectadasPorBloqueo(agenda: { prestadorId: string; modo: string; fecha: Date | null; diasSemana: number[]; horaIni: string; horaFin: string }) {
    const hoy = hoyEnSede();

    const citas = await this.prisma.cita.findMany({
      where: {
        prestadorId: agenda.prestadorId,
        estado: { in: ['pendiente_llegada', 'confirmada'] },
        fecha: agenda.modo === 'calendario' && agenda.fecha ? agenda.fecha : { gte: hoy },
      },
      include: { paciente: { select: { id: true, nombres: true, apellidos: true, telefono: true } }, servicio: true },
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    });

    const ini = aMinutos(agenda.horaIni);
    const fin = aMinutos(agenda.horaFin);

    return citas.filter((c) => {
      const dentroDeFranja = c.horaInicio >= ini && c.horaInicio < fin;
      if (!dentroDeFranja) return false;
      if (agenda.modo === 'calendario') return true;
      return agenda.diasSemana.includes(diaSemanaIso(c.fecha));
    });
  }

  private async verificarPrestador(prestadorId: string): Promise<void> {
    const prestador = await this.prisma.prestador.findUnique({ where: { id: prestadorId } });
    if (!prestador) throw new NotFoundException('Prestador no encontrado');
  }
}
