import { randomUUID } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import type { JwtPayload } from './auth.types';
import type { LoginDto } from './dto/login.dto';
import { ARGON2_OPCIONES } from './argon2.opciones';

/**
 * Duraciones de la sesión, editables desde Administración → Reglas sin desplegar.
 * El entorno queda de respaldo: si la clave falta o trae un valor imposible, se
 * firma con lo de siempre en vez de con una duración absurda.
 */
const TTL = {
  acceso: { clave: 'sesion_ttl_acceso', entorno: 'JWT_ACCESS_TTL' },
  inactividad: { clave: 'sesion_ttl_inactividad', entorno: 'JWT_REFRESH_TTL' },
} as const;

/** `15m`, `8h`, `7d`. Nada más: un valor raro caduca la sesión donde no toca. */
const FORMATO_TTL = /^\d+[mhd]$/;

/** Mismo mensaje para todo lo que falla al refrescar: no se dice qué falló. */
const SESION_INVALIDA = 'Sesión expirada';

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly configuracion: ConfiguracionService,
  ) {}

  /**
   * jsonwebtoken tipa `expiresIn` como plantilla literal ("15m", "7d"), no como string.
   * El valor de entorno ya viene validado por zod en el arranque; el de la tabla de
   * configuración lo escribe una persona desde el backoffice, así que se comprueba
   * aquí y, si no cuadra, se cae al de entorno. El cast se aísla en este método.
   */
  private ttl(cual: keyof typeof TTL): JwtSignOptions['expiresIn'] {
    const { clave, entorno } = TTL[cual];
    const valor = this.configuracion.texto(clave, '').trim();

    if (FORMATO_TTL.test(valor)) return valor as JwtSignOptions['expiresIn'];
    if (valor) {
      this.log.warn(`${clave} = "${valor}" no es una duración válida (15m, 8h, 7d): se usa ${entorno}`);
    }
    return this.config.getOrThrow<string>(entorno) as JwtSignOptions['expiresIn'];
  }

  /**
   * El par de tokens de una sesión. El de refresco dura lo que la ventana de
   * inactividad y **rota en cada canje**: mientras la persona trabaje, la ventana
   * se corre hacia adelante y la sesión no se corta nunca.
   */
  private async emitirPar(payload: JwtPayload) {
    return {
      accessToken: await this.jwt.signAsync(
        { ...payload, tipo: 'acceso' },
        { expiresIn: this.ttl('acceso') },
      ),
      refreshToken: await this.jwt.signAsync(
        { ...payload, tipo: 'refresco' },
        // `jwtid` le da identidad propia a cada refresco. Sin él, dos firmados en el
        // mismo segundo con la misma carga salen idénticos byte a byte: la rotación
        // no se distingue, y el día que haya que detectar la reutilización de uno
        // viejo no habría por dónde agarrarlo.
        { expiresIn: this.ttl('inactividad'), jwtid: randomUUID() },
      ),
    };
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
      ...(await this.emitirPar(payload)),
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
        prestadorId: usuario.prestadorId,
      },
    };
  }

  /**
   * Canjea un token de refresco por un par nuevo.
   *
   * No hay estado de sesión en el servidor, así que un token de refresco robado no
   * se puede revocar de a uno: la palanca es **desactivar al usuario**, que corta
   * al instante porque `JwtStrategy` revalida contra la base en cada petición. Para
   * cortar a todos, rotar `JWT_SECRET`.
   */
  async refrescar(token: string) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException(SESION_INVALIDA);
    }

    // Se exige la marca explícita: un token de acceso no abre sesiones nuevas, y los
    // emitidos antes de esta versión (sin `tipo`) tampoco, que es lo prudente.
    if (payload.tipo !== 'refresco') throw new UnauthorizedException(SESION_INVALIDA);

    const usuario = await this.prisma.usuario.findUnique({ where: { id: payload.sub } });
    if (!usuario || !usuario.activo) throw new UnauthorizedException(SESION_INVALIDA);

    // Se reconstruye desde la base, no desde el token: si al usuario le cambiaron el
    // rol o la ficha de prestador, la sesión renovada lleva lo de ahora.
    const nuevo: JwtPayload = {
      sub: usuario.id,
      rol: usuario.rol,
      sedeId: usuario.sedeId,
      ...(usuario.prestadorId ? { prestadorId: usuario.prestadorId } : {}),
    };

    return {
      ...(await this.emitirPar(nuevo)),
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
