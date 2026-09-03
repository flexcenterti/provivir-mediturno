import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { festivosColombia, SEDE_ID } from '@provivir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { aFechaUtc } from './agendas.service';
import type { CrearDiaNoLaborableDto, ImportarFestivosDto } from './dto/dia-no-laborable.dto';

const ESTADOS_VIVOS = ['pendiente_llegada', 'confirmada', 'llego', 'en_atencion'] as const;

/**
 * RN-06.5 · El calendario de días en que la sede no atiende.
 *
 * Existe porque `Agenda.bloqueada` no sabe de fechas: bloquear una agenda semanal la
 * apagaría todos los lunes, no un lunes concreto. Aquí la unidad es el día.
 */
@Injectable()
export class DiasNoLaborablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Los días cerrados de un año, o de todo el calendario si no se acota. */
  listar(anio?: number) {
    const rango =
      anio === undefined
        ? {}
        : { fecha: { gte: aFechaUtc(`${anio}-01-01`), lte: aFechaUtc(`${anio}-12-31`) } };

    return this.prisma.diaNoLaborable.findMany({
      where: { sedeId: SEDE_ID, ...rango },
      orderBy: { fecha: 'asc' },
    });
  }

  /**
   * ¿Está cerrada la sede ese día? Devuelve el motivo, o null si se atiende.
   * Lo consulta el motor de citas en cada consulta de cupos y antes de crear.
   */
  async motivoDeCierre(fecha: Date): Promise<string | null> {
    const dia = await this.prisma.diaNoLaborable.findUnique({
      where: { sedeId_fecha: { sedeId: SEDE_ID, fecha } },
    });
    return dia?.motivo ?? null;
  }

  /**
   * RN-06.5 · Cerrar un día. Igual que el bloqueo de agendas (RN-06.3), sin `confirmar`
   * devuelve el impacto y no toca nada: cerrar un día con pacientes citados es una
   * decisión que se toma viendo a cuántos afecta.
   *
   * Las citas NO se cancelan solas. Quedan para que una asistente las reprograme.
   */
  async crear(dto: CrearDiaNoLaborableDto, usuarioId: string) {
    const fecha = aFechaUtc(dto.fecha);

    const yaExiste = await this.prisma.diaNoLaborable.findUnique({
      where: { sedeId_fecha: { sedeId: SEDE_ID, fecha } },
    });
    if (yaExiste) throw new ConflictException(`El ${dto.fecha} ya está marcado como no laborable`);

    const citas = await this.citasDelDia(fecha);

    if (!dto.confirmar) {
      return {
        simulacion: true,
        citasAfectadas: citas.length,
        citas,
        mensaje:
          citas.length > 0
            ? `Cerrar el ${dto.fecha} afecta ${citas.length} cita(s) ya agendada(s). Confirme para cerrarlo y gestionar la reprogramación.`
            : `El ${dto.fecha} no tiene citas agendadas.`,
      };
    }

    const creado = await this.prisma.diaNoLaborable.create({
      data: { fecha, motivo: dto.motivo, tipo: dto.tipo ?? 'cierre', sedeId: SEDE_ID },
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Día no laborable creado',
      entidad: `dia-no-laborable/${dto.fecha}`,
      detalle: `${dto.motivo} · ${citas.length} cita(s) afectada(s)`,
      estadoPrev: 'Laborable',
      estadoNext: 'Cerrado',
    });

    return {
      simulacion: false,
      diaNoLaborable: creado,
      citasAfectadas: citas.length,
      citas,
      mensaje: `El ${dto.fecha} queda cerrado. ${citas.length} cita(s) requieren reprogramación.`,
    };
  }

  /** Reabrir un día: la clínica decide atender un festivo. */
  async eliminar(id: string, usuarioId: string) {
    const dia = await this.prisma.diaNoLaborable.findUnique({ where: { id } });
    if (!dia) throw new NotFoundException('Día no laborable no encontrado');

    await this.prisma.diaNoLaborable.delete({ where: { id } });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Día no laborable eliminado',
      entidad: `dia-no-laborable/${dia.fecha.toISOString().slice(0, 10)}`,
      detalle: dia.motivo,
      estadoPrev: 'Cerrado',
      estadoNext: 'Laborable',
    });

    return { eliminado: true, fecha: dia.fecha.toISOString().slice(0, 10) };
  }

  /**
   * RN-06.5 · Carga los festivos nacionales de un año. Idempotente: los que ya estén
   * se saltan, así que se puede reejecutar sin miedo y no pisa los cierres propios
   * de la clínica que coincidan con un festivo.
   */
  async importarFestivos(dto: ImportarFestivosDto, usuarioId: string) {
    const anio = dto.anio;
    if (anio < 2020 || anio > 2100) throw new BadRequestException('Año fuera de rango');

    const festivos = festivosColombia(anio);
    const existentes = new Set(
      (await this.listar(anio)).map((d) => d.fecha.toISOString().slice(0, 10)),
    );
    const nuevos = festivos.filter((f) => !existentes.has(f.fecha));

    if (nuevos.length > 0) {
      await this.prisma.diaNoLaborable.createMany({
        data: nuevos.map((f) => ({
          fecha: aFechaUtc(f.fecha),
          motivo: f.motivo,
          tipo: 'festivo' as const,
          sedeId: SEDE_ID,
        })),
        skipDuplicates: true,
      });
    }

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Festivos importados',
      entidad: `dia-no-laborable/${anio}`,
      detalle: `${nuevos.length} festivo(s) nuevo(s) de ${festivos.length} del año`,
    });

    return { anio, importados: nuevos.length, yaEstaban: festivos.length - nuevos.length };
  }

  /** Citas vivas de ese día, las que habría que reprogramar al cerrarlo. */
  private citasDelDia(fecha: Date) {
    return this.prisma.cita.findMany({
      where: { fecha, estado: { in: [...ESTADOS_VIVOS] } },
      select: {
        id: true, codigo: true, horaInicio: true,
        paciente: { select: { nombres: true, apellidos: true, telefono: true } },
        prestador: { select: { nombre: true } },
        servicio: { select: { nombre: true } },
      },
      orderBy: { horaInicio: 'asc' },
    });
  }
}
