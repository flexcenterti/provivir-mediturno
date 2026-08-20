import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { TurnosGateway } from './turnos.gateway';
import { minutosEsperando, ordenarCola, prioridadPorCondiciones } from './turnos.reglas';
import type { LlamarSiguienteDto, PriorizarTurnoDto, RegistrarLlegadaDto } from './dto/turno.dto';
import { hoyEnSede, type Prioridad } from '@provivir/shared';

const INCLUIR = {
  cita: { include: { paciente: true, prestador: true, servicio: true } },
} as const;

@Injectable()
export class TurnosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly gateway: TurnosGateway,
  ) {}

  /**
   * RN-07.1 · Flujo real del cliente: el paciente llega, paga en recepción y el
   * mostrador registra la llegada. No hay turno intermedio de pago, y el kiosko
   * está desactivado en esta etapa (D3).
   */
  async registrarLlegada(dto: RegistrarLlegadaDto, usuarioId: string) {
    if (!dto.codigo && !dto.documento) {
      throw new BadRequestException('Indique el código de atención o el documento');
    }

    // El día se calcula en la hora de la sede (Cali), no en la del servidor.
    const hoy = hoyEnSede();

    const cita = await this.prisma.cita.findFirst({
      where: {
        fecha: hoy,
        estado: { in: ['pendiente_llegada', 'confirmada'] },
        ...(dto.codigo ? { codigo: dto.codigo.toUpperCase() } : {}),
        ...(dto.documento ? { paciente: { documento: dto.documento } } : {}),
      },
      include: { paciente: true, prestador: true, servicio: true },
      orderBy: { horaInicio: 'asc' },
    });

    if (!cita) throw new NotFoundException('No se encontró una cita de hoy pendiente de llegada');

    const existente = await this.prisma.turno.findUnique({ where: { citaId: cita.id } });
    if (existente) throw new BadRequestException('La llegada de esta cita ya fue registrada');

    // RN-05.2 · las marcas preferenciales del paciente definen la prioridad de entrada.
    const prioridad = prioridadPorCondiciones(cita.paciente.condiciones);

    const turno = await this.prisma.$transaction(async (tx) => {
      const t = await tx.turno.create({
        data: {
          citaId: cita.id,
          prioridad,
          consultorio: dto.consultorio ?? cita.prestador.consultorio,
        },
        include: INCLUIR,
      });
      await tx.cita.update({ where: { id: cita.id }, data: { estado: 'llego' } });
      return t;
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Registro de llegada',
      entidad: `cita/${cita.codigo}`,
      detalle: `Mostrador · pago en recepción · prioridad ${prioridad}`,
      estadoPrev: cita.estado,
      estadoNext: 'llego',
    });

    this.gateway.emitirColaActualizada();
    return turno;
  }

  /** Cola del día ordenada por RN-05.2: prioridad primero, luego orden de llegada. */
  async cola(prestadorId?: string) {
    const turnos = await this.prisma.turno.findMany({
      where: {
        estado: { in: ['en_espera', 'llamado'] },
        ...(prestadorId ? { cita: { prestadorId } } : {}),
      },
      include: INCLUIR,
    });

    const ordenados = ordenarCola(
      turnos.map((t) => ({ ...t, condiciones: t.cita.paciente.condiciones })),
    );

    return ordenados.map((t) => ({
      ...t,
      minutosEsperando: minutosEsperando(t.llegadaTs),
    }));
  }

  /**
   * RN-07.3 · el llamado es automático al siguiente en cola. El prestador no elige
   * a quién llamar; si quiere adelantar a alguien usa la priorización con nota (RN-07.4).
   */
  async llamarSiguiente(dto: LlamarSiguienteDto, usuarioId: string) {
    const cola = await this.cola(dto.prestadorId);
    const siguiente = cola.find((t) => t.estado === 'en_espera');
    if (!siguiente) throw new NotFoundException('No hay pacientes en espera');

    const turno = await this.prisma.$transaction(async (tx) => {
      const t = await tx.turno.update({
        where: { id: siguiente.id },
        data: {
          estado: 'llamado',
          llamadoTs: new Date(),
          consultorio: dto.consultorio ?? siguiente.consultorio,
        },
        include: INCLUIR,
      });
      await tx.cita.update({ where: { id: t.citaId }, data: { estado: 'en_atencion' } });
      return t;
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Llamado de turno',
      entidad: `cita/${turno.cita.codigo}`,
      detalle: `${turno.cita.prestador.nombre} · ${turno.consultorio ?? 'sin consultorio'}`,
      estadoPrev: 'en_espera',
      estadoNext: 'llamado',
    });

    // RN-11.1 · solo las pantallas configuradas para ese servicio muestran el llamado.
    const pantallas = await this.prisma.pantalla.findMany({
      where: { servicios: { has: turno.cita.servicioId } },
      select: { id: true },
    });

    this.gateway.emitirLlamado(
      pantallas.map((p) => p.id),
      {
        turnoId: turno.id,
        codigo: turno.cita.codigo,
        paciente: `${turno.cita.paciente.nombres} ${turno.cita.paciente.apellidos}`,
        prestador: turno.cita.prestador.nombre,
        consultorio: turno.consultorio,
        servicioId: turno.cita.servicioId,
        ts: new Date().toISOString(),
      },
    );
    this.gateway.emitirColaActualizada();

    return turno;
  }

  /**
   * RN-07.4 · Priorización por el prestador. La nota del motivo es OBLIGATORIA
   * (la valida el DTO) y todo queda auditado.
   */
  async priorizar(id: string, dto: PriorizarTurnoDto, usuarioId: string) {
    const turno = await this.prisma.turno.findUnique({ where: { id }, include: INCLUIR });
    if (!turno) throw new NotFoundException('Turno no encontrado');

    const actualizado = await this.prisma.turno.update({
      where: { id },
      data: {
        prioridad: dto.prioridad as Prioridad,
        notaPriorizacion: dto.nota,
        priorizadoPor: usuarioId,
      },
      include: INCLUIR,
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Priorización de turno',
      entidad: `cita/${turno.cita.codigo}`,
      detalle: dto.nota,
      estadoPrev: turno.prioridad,
      estadoNext: dto.prioridad,
    });

    this.gateway.emitirColaActualizada();
    return actualizado;
  }

  async finalizar(id: string, usuarioId: string) {
    const turno = await this.prisma.turno.findUnique({ where: { id }, include: INCLUIR });
    if (!turno) throw new NotFoundException('Turno no encontrado');

    const actualizado = await this.prisma.$transaction(async (tx) => {
      const t = await tx.turno.update({ where: { id }, data: { estado: 'atendido' }, include: INCLUIR });
      await tx.cita.update({ where: { id: t.citaId }, data: { estado: 'atendida' } });
      return t;
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Atención finalizada',
      entidad: `cita/${turno.cita.codigo}`,
      estadoPrev: turno.estado,
      estadoNext: 'atendido',
    });

    this.gateway.emitirColaActualizada();
    return actualizado;
  }

  /** Últimos llamados, para que la pantalla los muestre al conectarse. */
  async ultimosLlamados(servicios: string[], limite: number) {
    return this.prisma.turno.findMany({
      where: { estado: { in: ['llamado', 'en_atencion'] }, cita: { servicioId: { in: servicios } } },
      include: INCLUIR,
      orderBy: { llamadoTs: 'desc' },
      take: limite,
    });
  }
}
