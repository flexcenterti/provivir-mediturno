import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CLAVE_PERMISOS } from '../decorators/permisos.decorator';
import { CLAVE_PUBLICO } from '../decorators/publico.decorator';
import type { UsuarioAutenticado } from '../auth.types';

/**
 * Autorización por permisos del perfil, no por rol.
 *
 * Los permisos NO viajan en el token: la estrategia JWT ya consulta la base en
 * cada petición para comprobar que el usuario sigue activo, así que se resuelven
 * ahí. Quitarle un permiso a alguien surte efecto en la siguiente petición, sin
 * esperar a que expire su sesión.
 */
@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const esPublico = this.reflector.getAllAndOverride<boolean>(CLAVE_PUBLICO, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (esPublico) return true;

    const requeridos = this.reflector.getAllAndOverride<string[]>(CLAVE_PERMISOS, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!requeridos || requeridos.length === 0) return true;

    const usuario: UsuarioAutenticado | undefined = ctx.switchToHttp().getRequest().user;
    const tiene = usuario?.permisos ?? [];

    if (!requeridos.some((p) => tiene.includes(p))) {
      // No se dice cuál falta: sería un mapa de la superficie de permisos.
      throw new ForbiddenException('No tiene permisos para esta operación');
    }
    return true;
  }
}
