import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hoyEnSede } from '@provivir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ConocimientoService } from '../conocimiento/conocimiento.service';
import { SeguimientoService } from '../seguimiento/seguimiento.service';
import type { ActualizarServicioDto, CrearServicioDto } from './dto/servicio.dto';

/** Lo que arrastra desactivar un servicio (RN-04.5.4). */
export interface ImpactoBaja {
  citasVigentes: number;
  seguimientosCancelados: number;
  articulosParaRevisar: number;
}

@Injectable()
export class ServiciosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly conocimiento: ConocimientoService,
    private readonly seguimiento: SeguimientoService,
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
      detalle:
        `${servicio.tipo} · ${servicio.duracionMin} min · ${servicio.cupos} cupo(s)` +
        (this.tieneFicha(servicio) ? '' : ' · SIN ficha comercial: el bot no lo ofrecerá (RN-04.5.1)'),
    });

    return servicio;
  }

  /**
   * RN-04.5.2 · Los cambios NO son retroactivos: duración y cupos afectan solo a las
   * citas que se creen desde ahora. Las ya agendadas conservan su configuración,
   * porque recalcularlas desplazaría agendas completas y dejaría pacientes sin aviso.
   *
   * Si el cambio incluye `activo`, se disparan los efectos en cadena. Se maneja aquí
   * y no solo en el endpoint dedicado para que la cascada ocurra venga por donde venga:
   * el backoffice ya edita `activo` desde el formulario del catálogo.
   */
  async actualizar(id: string, dto: ActualizarServicioDto, usuarioId: string) {
    const previo = await this.porId(id);
    const servicio = await this.prisma.servicio.update({ where: { id }, data: dto as never });

    const cambioMotor =
      (dto.duracionMin !== undefined && dto.duracionMin !== previo.duracionMin) ||
      (dto.cupos !== undefined && dto.cupos !== previo.cupos) ||
      (dto.requiereOrden !== undefined && dto.requiereOrden !== previo.requiereOrden);

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Servicio actualizado',
      entidad: `servicio/${id}`,
      detalle: cambioMotor
        ? `Cambio con impacto en agenda, no retroactivo (RN-04.5.2). Campos: ${Object.keys(dto).join(', ')}`
        : `Campos: ${Object.keys(dto).join(', ')}`,
      ...(cambioMotor
        ? {
            estadoPrev: `${previo.duracionMin} min · ${previo.cupos} cupo(s)`,
            estadoNext: `${servicio.duracionMin} min · ${servicio.cupos} cupo(s)`,
          }
        : {}),
    });

    /*
     * RN-07.6 · La política de costo va en su propia línea, fuera de `cambioMotor`:
     * no afecta a la agenda, pero desde que el mostrador la lee decide qué desenlace
     * de cobro viene preseleccionado y cuándo se exige nota. Antes no se registraba en
     * ningún sitio, y ahora es una decisión con consecuencias en caja.
     */
    if (dto.politicaCosto !== undefined && dto.politicaCosto !== previo.politicaCosto) {
      await this.auditoria.registrar({
        usuario: usuarioId,
        accion: 'Política de costo modificada',
        entidad: `servicio/${id}`,
        detalle: servicio.nombre,
        estadoPrev: previo.politicaCosto,
        estadoNext: servicio.politicaCosto,
      });
    }

    if (dto.activo === false && previo.activo) await this.efectosDeBaja(id, servicio.nombre, usuarioId);
    if (dto.activo === true && !previo.activo) await this.registrarAlta(id, servicio.nombre, usuarioId);

    return servicio;
  }

  /**
   * Qué se arrastra si se desactiva. Se consulta ANTES de decidir: quien administra
   * merece ver cuántas citas quedan colgando antes de apretar el botón, no después.
   */
  async impacto(id: string): Promise<ImpactoBaja & { citas: number }> {
    await this.porId(id);
    return {
      citas: await this.prisma.cita.count({ where: { servicioId: id } }),
      citasVigentes: await this.citasVigentes(id),
      seguimientosCancelados: await this.prisma.seguimiento.count({
        where: { servicioId: id, estado: 'programado' },
      }),
      articulosParaRevisar: await this.prisma.kbArticulo.count({
        where: { servicioId: id, estado: 'publicado' },
      }),
    };
  }

  /** RN-04.5.3 · Baja lógica. Las citas ya agendadas se atienden normalmente. */
  async desactivar(id: string, usuarioId: string): Promise<ImpactoBaja> {
    const previo = await this.porId(id);
    if (!previo.activo) throw new BadRequestException('El servicio ya está inactivo');

    await this.prisma.servicio.update({ where: { id }, data: { activo: false } });
    return this.efectosDeBaja(id, previo.nombre, usuarioId);
  }

  async activar(id: string, usuarioId: string) {
    const previo = await this.porId(id);
    if (previo.activo) throw new BadRequestException('El servicio ya está activo');

    const servicio = await this.prisma.servicio.update({ where: { id }, data: { activo: true } });
    await this.registrarAlta(id, servicio.nombre, usuarioId);
    return servicio;
  }

  /**
   * RN-04.5.3.2 · Eliminación definitiva, solo si no hay ninguna cita asociada.
   *
   * Con citas, borrar el servicio arrancaría su nombre del historial de esos pacientes
   * y de la auditoría. La clave foránea lo impediría igual; se comprueba antes para
   * poder explicar por qué, en vez de devolver un error de base de datos.
   */
  async eliminar(id: string, usuarioId: string): Promise<{ eliminado: true }> {
    const servicio = await this.porId(id);
    const citas = await this.prisma.cita.count({ where: { servicioId: id } });

    if (citas > 0) {
      throw new BadRequestException(
        `No se puede eliminar: el servicio tiene ${citas} cita(s) asociada(s). ` +
          'Desactívalo en su lugar: deja de ofrecerse de inmediato y las citas se conservan.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Los vínculos que no son historia de nadie sí se sueltan.
      await tx.prestadorServicio.deleteMany({ where: { servicioId: id } });
      await tx.kbArticulo.updateMany({ where: { servicioId: id }, data: { servicioId: null } });
      await tx.servicio.delete({ where: { id } });
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Servicio eliminado',
      entidad: `servicio/${id}`,
      detalle: `${servicio.nombre} · sin citas asociadas (RN-04.5.3.2)`,
      estadoPrev: servicio.activo ? 'activo' : 'inactivo',
      estadoNext: 'eliminado',
    });

    return { eliminado: true };
  }

  // ─────────────────────────── Interno ───────────────────────────

  private tieneFicha(s: { descripcionComercial: string | null; beneficios: string[] }): boolean {
    return Boolean(s.descripcionComercial && s.beneficios.length);
  }

  private citasVigentes(id: string): Promise<number> {
    return this.prisma.cita.count({
      where: { servicioId: id, estado: { not: 'cancelada' }, fecha: { gte: hoyEnSede() } },
    });
  }

  /**
   * RN-04.5.4 · Todo lo que arrastra una baja, en una sola operación.
   *
   * Los seguimientos se cancelan porque perseguir pacientes para venderles algo
   * descontinuado es el peor error posible del módulo. Los artículos se marcan y no
   * se archivan solos: puede que el texto siga siendo válido y la decisión es de quien
   * administra — pero dejarlo pasar en silencio es como el bot termina ofreciendo algo
   * que ya no se presta.
   */
  private async efectosDeBaja(id: string, nombre: string, usuarioId: string): Promise<ImpactoBaja> {
    const citasVigentes = await this.citasVigentes(id);
    const seguimientosCancelados = await this.seguimiento.cancelarPorServicio(id);
    const articulosParaRevisar = await this.conocimiento.marcarParaRevisionPorServicio(id);

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Servicio desactivado',
      entidad: `servicio/${id}`,
      detalle:
        `${nombre} · ${citasVigentes} cita(s) vigente(s) por reprogramar · ` +
        `${seguimientosCancelados} seguimiento(s) cancelado(s) · ` +
        `${articulosParaRevisar} artículo(s) marcado(s) para revisión`,
      estadoPrev: 'activo',
      estadoNext: 'inactivo',
    });

    return { citasVigentes, seguimientosCancelados, articulosParaRevisar };
  }

  private async registrarAlta(id: string, nombre: string, usuarioId: string): Promise<void> {
    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Servicio activado',
      entidad: `servicio/${id}`,
      detalle: `${nombre} · vuelve a ofrecerse por WhatsApp y portal`,
      estadoPrev: 'inactivo',
      estadoNext: 'activo',
    });
  }
}
