import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { ActualizarServicioDto, CrearServicioDto } from './dto/servicio.dto';

@Injectable()
export class ServiciosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  listar(soloActivos = true) {
    return this.prisma.servicio.findMany({
      where: soloActivos ? { activo: true } : {},
      orderBy: [{ categoria: 'asc' }, { nombre: 'asc' }],
    });
  }

  async porId(id: string) {
    const servicio = await this.prisma.servicio.findUnique({ where: { id } });
    if (!servicio) throw new NotFoundException('Servicio no encontrado');
    return servicio;
  }

  async crear(dto: CrearServicioDto, usuarioId: string) {
    const existente = await this.prisma.servicio.findUnique({ where: { id: dto.id } });
    if (existente) throw new ConflictException(`Ya existe un servicio con el id ${dto.id}`);

    const servicio = await this.prisma.servicio.create({ data: dto as never });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Servicio creado',
      entidad: `servicio/${servicio.id}`,
      detalle: `${servicio.tipo} · ${servicio.duracionMin} min · ${servicio.cupos} cupo(s)`,
    });

    return servicio;
  }

  async actualizar(id: string, dto: ActualizarServicioDto, usuarioId: string) {
    await this.porId(id);
    const servicio = await this.prisma.servicio.update({ where: { id }, data: dto as never });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Servicio actualizado',
      entidad: `servicio/${id}`,
      detalle: `Campos: ${Object.keys(dto).join(', ')}`,
    });

    return servicio;
  }
}
