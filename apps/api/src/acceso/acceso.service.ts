import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PERFILES_BASE } from '@provivir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { generarPassword } from '../auth/password';
import { hashearPassword } from '../auth/argon2.opciones';
import type { ActualizarPerfilDto, ActualizarUsuarioDto, CrearPerfilDto, CrearUsuarioDto } from './dto/acceso.dto';

/**
 * Perfiles de acceso y usuarios.
 *
 * Dos reglas gobiernan casi todo lo de aquí, y las dos existen para que nadie se
 * quede fuera de su propio sistema:
 *   · un perfil con usuarios no se borra
 *   · siempre debe quedar alguien que pueda gestionar usuarios
 */
@Injectable()
export class AccesoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly config: ConfigService,
  ) {}

  private get sedeId(): string {
    return this.config.getOrThrow<string>('SEDE_ID');
  }

  /** Crea los perfiles base si faltan. Idempotente. */
  async asegurarPerfilesBase(): Promise<void> {
    for (const base of PERFILES_BASE) {
      await this.prisma.perfil.upsert({
        where: { nombre: base.nombre },
        // No se pisan los permisos: puede que ya los hayan ajustado.
        update: { sistema: true },
        create: {
          nombre: base.nombre,
          descripcion: base.descripcion,
          permisos: [...base.permisos],
          sistema: true,
          sedeId: this.sedeId,
        },
      });
    }
  }

  async perfiles() {
    await this.asegurarPerfilesBase();
    return this.prisma.perfil.findMany({
      orderBy: [{ sistema: 'desc' }, { nombre: 'asc' }],
      include: { _count: { select: { usuarios: true } } },
    });
  }

  async crearPerfil(dto: CrearPerfilDto, usuario: string) {
    if (await this.prisma.perfil.findUnique({ where: { nombre: dto.nombre } })) {
      throw new ConflictException(`Ya existe un perfil llamado "${dto.nombre}"`);
    }
    const perfil = await this.prisma.perfil.create({
      data: { ...dto, sedeId: this.sedeId },
    });
    await this.auditoria.registrar({
      usuario, accion: 'Perfil creado', entidad: `perfil/${perfil.id}`,
      detalle: `${perfil.nombre} · ${perfil.permisos.length} permiso(s)`,
    });
    return perfil;
  }

  async actualizarPerfil(id: string, dto: ActualizarPerfilDto, usuario: string) {
    const perfil = await this.prisma.perfil.findUnique({ where: { id } });
    if (!perfil) throw new NotFoundException('El perfil no existe');

    if (dto.permisos && !dto.permisos.includes('usuarios.gestionar')) {
      await this.exigirQueQuedeAlguienGestionando(id);
    }
    if (dto.activo === false) await this.exigirQueQuedeAlguienGestionando(id);

    const actualizado = await this.prisma.perfil.update({ where: { id }, data: dto });
    await this.auditoria.registrar({
      usuario, accion: 'Perfil modificado', entidad: `perfil/${id}`,
      detalle: actualizado.nombre,
      estadoPrev: perfil.permisos.join(','),
      estadoNext: actualizado.permisos.join(','),
    });
    return actualizado;
  }

  async eliminarPerfil(id: string, usuario: string) {
    const perfil = await this.prisma.perfil.findUnique({
      where: { id }, include: { _count: { select: { usuarios: true } } },
    });
    if (!perfil) throw new NotFoundException('El perfil no existe');
    if (perfil.sistema) throw new BadRequestException('Los perfiles base no se eliminan. Puedes desactivarlo.');
    if (perfil._count.usuarios > 0) {
      throw new ConflictException(
        `El perfil tiene ${perfil._count.usuarios} usuario(s). Reasígnalos antes de eliminarlo.`,
      );
    }

    await this.prisma.perfil.delete({ where: { id } });
    await this.auditoria.registrar({
      usuario, accion: 'Perfil eliminado', entidad: `perfil/${id}`, detalle: perfil.nombre,
    });
    return { eliminado: true };
  }

  async usuarios() {
    return this.prisma.usuario.findMany({
      orderBy: [{ activo: 'desc' }, { email: 'asc' }],
      select: {
        id: true, email: true, nombre: true, rol: true, activo: true,
        ultimoAcceso: true, prestadorId: true,
        perfil: { select: { id: true, nombre: true, activo: true } },
      },
    });
  }

  async crearUsuario(dto: CrearUsuarioDto, usuario: string) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.usuario.findUnique({ where: { email } })) {
      throw new ConflictException(`Ya existe un usuario con ${email}`);
    }
    if (!(await this.prisma.perfil.findUnique({ where: { id: dto.perfilId } }))) {
      throw new NotFoundException('El perfil indicado no existe');
    }
    if (dto.rol === 'prestador') {
      if (!dto.prestadorId) throw new BadRequestException('Un usuario médico debe asociarse a una ficha de prestador (RN-06.2)');
      if (!(await this.prisma.prestador.findUnique({ where: { id: dto.prestadorId } }))) {
        throw new NotFoundException('El prestador indicado no existe');
      }
    }

    const password = generarPassword();
    const creado = await this.prisma.usuario.create({
      data: {
        email, nombre: dto.nombre, rol: dto.rol, perfilId: dto.perfilId,
        prestadorId: dto.prestadorId ?? null,
        hashPassword: await hashearPassword(password),
        sedeId: this.sedeId,
      },
      select: { id: true, email: true, nombre: true, rol: true },
    });

    await this.auditoria.registrar({
      usuario, accion: 'Usuario creado', entidad: `usuario/${creado.id}`, detalle: creado.email,
    });
    // La contraseña se devuelve UNA vez: en la base solo queda su hash.
    return { ...creado, password };
  }

  async actualizarUsuario(id: string, dto: ActualizarUsuarioDto, usuario: string) {
    const actual = await this.prisma.usuario.findUnique({ where: { id } });
    if (!actual) throw new NotFoundException('El usuario no existe');

    if (dto.activo === false || dto.perfilId) await this.exigirQueQuedeAlguienGestionando(undefined, id);

    const actualizado = await this.prisma.usuario.update({
      where: { id }, data: dto,
      select: { id: true, email: true, nombre: true, activo: true },
    });
    await this.auditoria.registrar({
      usuario, accion: 'Usuario modificado', entidad: `usuario/${id}`, detalle: actualizado.email,
    });
    return actualizado;
  }

  async reiniciarClave(id: string, usuario: string) {
    const existe = await this.prisma.usuario.findUnique({ where: { id }, select: { email: true } });
    if (!existe) throw new NotFoundException('El usuario no existe');

    const password = generarPassword();
    await this.prisma.usuario.update({
      where: { id }, data: { hashPassword: await hashearPassword(password), activo: true },
    });
    await this.auditoria.registrar({
      usuario, accion: 'Contraseña reiniciada', entidad: `usuario/${id}`, detalle: existe.email,
    });
    return { email: existe.email, password };
  }

  /**
   * Impide el suicidio administrativo: quedarse sin nadie que pueda entrar a
   * gestionar usuarios deja el sistema sin salida y solo se arregla por consola.
   *
   * @param perfilIdQueCambia perfil que va a perder el permiso o desactivarse
   * @param usuarioIdQueCambia usuario que va a desactivarse o cambiar de perfil
   */
  private async exigirQueQuedeAlguienGestionando(
    perfilIdQueCambia?: string,
    usuarioIdQueCambia?: string,
  ): Promise<void> {
    const quedan = await this.prisma.usuario.count({
      where: {
        activo: true,
        ...(usuarioIdQueCambia ? { id: { not: usuarioIdQueCambia } } : {}),
        perfil: {
          activo: true,
          permisos: { has: 'usuarios.gestionar' },
          ...(perfilIdQueCambia ? { id: { not: perfilIdQueCambia } } : {}),
        },
      },
    });

    if (quedan === 0) {
      throw new ConflictException(
        'Con este cambio nadie podría gestionar usuarios y el sistema quedaría sin administrador. ' +
        'Asigna antes ese permiso a otra persona.',
      );
    }
  }
}
