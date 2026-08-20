import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaginacionDto, armarPagina } from '../comun/paginacion';

@Controller('auditoria')
@Roles('admin')
export class AuditoriaController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listar(@Query() paginacion: PaginacionDto, @Query('entidad') entidad?: string) {
    const where = entidad ? { entidad: { contains: entidad, mode: 'insensitive' as const } } : {};
    const [datos, total] = await Promise.all([
      this.prisma.auditoria.findMany({
        where,
        orderBy: { ts: 'desc' },
        skip: paginacion.salto,
        take: paginacion.porPagina,
      }),
      this.prisma.auditoria.count({ where }),
    ]);
    return armarPagina(datos, total, paginacion);
  }
}
