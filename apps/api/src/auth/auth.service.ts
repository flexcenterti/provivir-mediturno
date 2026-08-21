import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from './auth.types';
import type { LoginDto } from './dto/login.dto';
import { ARGON2_OPCIONES } from './argon2.opciones';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * jsonwebtoken tipa `expiresIn` como plantilla literal ("15m", "7d"), no como string.
   * El valor ya viene validado por zod en el arranque, así que el cast se aísla aquí.
   */
  private ttl(clave: 'JWT_ACCESS_TTL' | 'JWT_REFRESH_TTL'): JwtSignOptions['expiresIn'] {
    return this.config.getOrThrow<string>(clave) as JwtSignOptions['expiresIn'];
  }

  static hashear(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPCIONES);
  }

  async login(dto: LoginDto) {
    const usuario = await this.prisma.usuario.findUnique({ where: { email: dto.email } });

    // Mismo mensaje y mismo costo aproximado exista o no el usuario: sin enumeración de cuentas.
    if (!usuario || !usuario.activo) {
      await argon2.hash(dto.password, ARGON2_OPCIONES);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const valida = await argon2.verify(usuario.hashPassword, dto.password);
    if (!valida) throw new UnauthorizedException('Credenciales inválidas');

    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: { ultimoAcceso: new Date() },
    });

    const payload: JwtPayload = {
      sub: usuario.id,
      rol: usuario.rol,
      sedeId: usuario.sedeId,
      ...(usuario.prestadorId ? { prestadorId: usuario.prestadorId } : {}),
    };

    return {
      accessToken: await this.jwt.signAsync(payload, { expiresIn: this.ttl('JWT_ACCESS_TTL') }),
      refreshToken: await this.jwt.signAsync(payload, { expiresIn: this.ttl('JWT_REFRESH_TTL') }),
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
        prestadorId: usuario.prestadorId,
      },
    };
  }
}
