import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload, UsuarioAutenticado } from './auth.types';
import { permisosDe } from './permisos.resolucion';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Se revalida contra la BD en cada petición: un usuario desactivado debe perder
   * el acceso de inmediato, sin esperar a que expire su token. Ya que se consulta,
   * los permisos del perfil se resuelven aquí y no en el token, de modo que un
   * cambio de perfil también aplica de inmediato.
   */
  async validate(payload: JwtPayload): Promise<UsuarioAutenticado> {
    // Un token de refresco tiene la vida de la sesión entera: si sirviera de
    // `Bearer`, guardarlo en el navegador equivaldría a un access token de 8 horas.
    if (payload.tipo === 'refresco') throw new UnauthorizedException();

    const usuario = await this.prisma.usuario.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, rol: true, sedeId: true, prestadorId: true, activo: true,
        perfil: { select: { permisos: true, activo: true } },
      },
    });

    if (!usuario || !usuario.activo) throw new UnauthorizedException();

    return {
      id: usuario.id,
      rol: usuario.rol,
      sedeId: usuario.sedeId,
      permisos: permisosDe(usuario),
      prestadorId: usuario.prestadorId ?? undefined,
    };
  }
}
