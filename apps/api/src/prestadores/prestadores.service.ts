import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { SEDE_ID } from '@provivir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { CONFIG } from '@provivir/shared';
import type { ActualizarPrestadorDto, CrearPrestadorDto, DuracionServicioDto } from './dto/prestador.dto';

const INCLUIR = { servicios: { include: { servicio: true } }, config: true } as const;

@Injectable()
export class PrestadoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly configuracion: ConfiguracionService,
  ) {}

  listar(soloActivos = true) {
    return this.prisma.prestador.findMany({
      where: soloActivos ? { activo: true } : {},
      include: INCLUIR,
      orderBy: [{ especialidad: 'asc' }, { nombre: 'asc' }],
    });
  }

  /** RN-02.1 · el grupo de balanceo: los médicos generales. */
  listarGrupoBalanceo() {
    return this.prisma.prestador.findMany({
      where: { grupoBalanceo: true, activo: true },
      include: INCLUIR,
      orderBy: { nombre: 'asc' },
    });
  }

  async porId(id: string) {
    const prestador = await this.prisma.prestador.findUnique({ where: { id }, include: INCLUIR });
    if (!prestador) throw new NotFoundException('Prestador no encontrado');
    return prestador;
  }

  /**
   * RN-01.3 · la ventana de control es por prestador. Si no la definió,
   * cae al valor por defecto de la tabla de configuración, no a una constante en código.
   */
  async ventanaControlDias(prestadorId: string): Promise<number> {
    const config = await this.prisma.prestadorConfig.findUnique({ where: { prestadorId } });
    return (
      config?.ventanaControlDias ??
      this.configuracion.numero(CONFIG.VENTANA_CONTROL_DIAS_DEFECTO, 10)
    );
  }

  /** RN-01.4 · duración de un servicio para un prestador; si no la tiene, la del catálogo. */
  async duracionMin(prestadorId: string, servicioId: string): Promise<number> {
    const propia = await this.prisma.prestadorServicio.findUnique({
      where: { prestadorId_servicioId: { prestadorId, servicioId } },
    });
    if (propia) return propia.duracionMin;

    const servicio = await this.prisma.servicio.findUnique({ where: { id: servicioId } });
    if (!servicio) throw new NotFoundException('Servicio no encontrado');
    return servicio.duracionMin;
  }

  async crear(dto: CrearPrestadorDto, usuarioId: string) {
    const existente = await this.prisma.prestador.findUnique({ where: { id: dto.id } });
    if (existente) throw new ConflictException(`Ya existe un prestador con el id ${dto.id}`);

    const prestador = await this.prisma.prestador.create({
      data: {
        id: dto.id,
        nombre: dto.nombre,
        especialidad: dto.especialidad,
        grupoBalanceo: dto.grupoBalanceo ?? false,
        vinculacion: dto.vinculacion ?? 'Interno',
        consultorio: dto.consultorio ?? null,
        sedeId: SEDE_ID,
        ...(dto.ventanaControlDias !== undefined
          ? { config: { create: { ventanaControlDias: dto.ventanaControlDias } } }
          : {}),
        ...(dto.duraciones?.length
          ? { servicios: { create: dto.duraciones.map((d) => ({ servicioId: d.servicioId, duracionMin: d.duracionMin })) } }
          : {}),
      },
      include: INCLUIR,
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Prestador creado',
      entidad: `prestador/${prestador.id}`,
      detalle: `${prestador.especialidad}${prestador.grupoBalanceo ? ' · grupo de balanceo' : ''}`,
    });

    return prestador;
  }

  async actualizar(id: string, dto: ActualizarPrestadorDto, usuarioId: string) {
    await this.porId(id);
    const { duraciones, ventanaControlDias, ...campos } = dto;

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(campos).length > 0) {
        await tx.prestador.update({ where: { id }, data: campos });
      }

      if (ventanaControlDias !== undefined) {
        await tx.prestadorConfig.upsert({
          where: { prestadorId: id },
          update: { ventanaControlDias },
          create: { prestadorId: id, ventanaControlDias },
        });
      }

      if (duraciones) {
        await this.reemplazarDuraciones(tx, id, duraciones);
      }
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Prestador actualizado',
      entidad: `prestador/${id}`,
      detalle: `Campos: ${Object.keys(dto).join(', ')}`,
    });

    return this.porId(id);
  }

  private async reemplazarDuraciones(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    prestadorId: string,
    duraciones: DuracionServicioDto[],
  ): Promise<void> {
    await tx.prestadorServicio.deleteMany({ where: { prestadorId } });
    if (duraciones.length > 0) {
      await tx.prestadorServicio.createMany({
        data: duraciones.map((d) => ({ prestadorId, servicioId: d.servicioId, duracionMin: d.duracionMin })),
      });
    }
  }
}
