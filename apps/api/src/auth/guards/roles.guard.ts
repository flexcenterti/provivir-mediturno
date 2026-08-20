import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Rol } from '@provivir/shared';
import { CLAVE_ROLES } from '../decorators/roles.decorator';
import { CLAVE_PUBLICO } from '../decorators/publico.decorator';
import type { UsuarioAutenticado } from '../auth.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const esPublico = this.reflector.getAllAndOverride<boolean>(CLAVE_PUBLICO, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (esPublico) return true;

    const permitidos = this.reflector.getAllAndOverride<Rol[]>(CLAVE_ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!permitidos || permitidos.length === 0) return true;

    const usuario: UsuarioAutenticado | undefined = ctx.switchToHttp().getRequest().user;
    if (!usuario || !permitidos.includes(usuario.rol)) {
      throw new ForbiddenException('No tiene permisos para esta operación');
    }
    return true;
  }
}
