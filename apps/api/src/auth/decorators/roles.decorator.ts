import { SetMetadata } from '@nestjs/common';
import type { Rol } from '@provivir/shared';

export const CLAVE_ROLES = 'rolesPermitidos';

/** Restringe una ruta a los roles indicados. Se combina con JwtAuthGuard. */
export const Roles = (...roles: Rol[]) => SetMetadata(CLAVE_ROLES, roles);
