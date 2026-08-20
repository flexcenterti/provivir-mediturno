import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { HISTORIAL_SERVICIOS_VISIBLES, SEDE_ID } from '@provivir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { armarPagina } from '../comun/paginacion';
import { enmascararDocumento } from '../comun/pii';
import type { ActualizarPacienteDto, BuscarPacientesDto, CrearPacienteDto } from './dto/paciente.dto';

@Injectable()
export class PacientesService {
  private readonly log = new Logger(PacientesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Un solo campo de búsqueda para las tres formas en que la asistente identifica
   * a alguien: documento, nombre o teléfono. Se elige el criterio por la forma del texto
   * en lugar de hacer OR sobre los tres, que en 400k registros no usaría índice.
   */
  async buscar(dto: BuscarPacientesDto) {
    const q = dto.q?.trim();
    let where: Prisma.PacienteWhereInput = {};

    if (q) {
      const soloDigitos = /^[0-9]+$/.test(q);
      if (soloDigitos && q.length >= 6) {
        // Puede ser documento o teléfono: ambos están indexados.
        where = { OR: [{ documento: { startsWith: q } }, { telefono: { contains: q } }] };
      } else if (soloDigitos) {
        where = { documento: { startsWith: q } };
      } else {
        const partes = q.split(/\s+/).filter(Boolean);
        where = {
          AND: partes.map((p) => ({
            OR: [
              { apellidos: { contains: p, mode: 'insensitive' as const } },
              { nombres: { contains: p, mode: 'insensitive' as const } },
            ],
          })),
        };
      }
    }

    const [datos, total] = await Promise.all([
      this.prisma.paciente.findMany({
        where,
        orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
        skip: dto.salto,
        take: dto.porPagina,
      }),
      this.prisma.paciente.count({ where }),
    ]);

    return armarPagina(datos, total, dto);
  }

  async porId(id: string) {
    const paciente = await this.prisma.paciente.findUnique({ where: { id } });
    if (!paciente) throw new NotFoundException('Paciente no encontrado');
    return paciente;
  }

  async porDocumento(documento: string) {
    return this.prisma.paciente.findUnique({ where: { documento } });
  }

  /**
   * RN-12.4 · Historial OPERATIVO de servicios: los últimos 10, sin importar la fecha.
   * No es historia clínica.
   */
  async historial(id: string) {
    await this.porId(id);
    return this.prisma.historialServicio.findMany({
      where: { pacienteId: id },
      orderBy: { fecha: 'desc' },
      take: HISTORIAL_SERVICIOS_VISIBLES,
    });
  }

  async crear(dto: CrearPacienteDto, usuarioId: string) {
    const existente = await this.prisma.paciente.findUnique({ where: { documento: dto.documento } });
    if (existente) {
      throw new ConflictException(`Ya existe un paciente con el documento ${dto.documento}`);
    }

    const paciente = await this.prisma.paciente.create({
      data: {
        tdoc: dto.tdoc,
        documento: dto.documento,
        nombres: dto.nombres.trim(),
        apellidos: dto.apellidos.trim(),
        telefono: dto.telefono ?? null,
        whatsapp: dto.whatsapp ?? dto.telefono ?? null,
        correo: dto.correo ?? null,
        fechaNac: dto.fechaNac ? new Date(`${dto.fechaNac}T00:00:00Z`) : null,
        sexo: dto.sexo ?? null,
        condiciones: dto.condiciones ?? [],
        origen: (dto.origen ?? 'mostrador') as never,
        sedeId: SEDE_ID,
      },
    });

    this.log.log(`Paciente creado · doc ${enmascararDocumento(paciente.documento)}`);
    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Paciente creado',
      entidad: `paciente/${paciente.id}`,
      detalle: `Documento ${enmascararDocumento(paciente.documento)} · origen ${paciente.origen}`,
      estadoNext: 'Activo',
    });

    return paciente;
  }

  async actualizar(id: string, dto: ActualizarPacienteDto, usuarioId: string) {
    await this.porId(id);
    const paciente = await this.prisma.paciente.update({ where: { id }, data: { ...dto } });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Paciente actualizado',
      entidad: `paciente/${id}`,
      detalle: `Campos: ${Object.keys(dto).join(', ')}`,
    });

    return paciente;
  }

  /**
   * No hay borrado físico: los pacientes tienen citas e historial asociados.
   * Se desactiva, y queda auditado.
   */
  async desactivar(id: string, usuarioId: string) {
    await this.porId(id);
    const paciente = await this.prisma.paciente.update({ where: { id }, data: { activo: false } });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Paciente desactivado',
      entidad: `paciente/${id}`,
      estadoPrev: 'Activo',
      estadoNext: 'Inactivo',
    });

    return paciente;
  }
}
