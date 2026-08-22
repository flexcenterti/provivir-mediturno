import { SetMetadata } from '@nestjs/common';
import type { Permiso } from '@provivir/shared';

export const CLAVE_PERMISOS = 'permisosRequeridos';

/**
 * Exige uno o más permisos para entrar a la ruta. Basta con tener UNO de ellos:
 * un mismo endpoint suele servir a dos perfiles por motivos distintos.
 *
 * Sin este decorador la ruta queda abierta a cualquier usuario autenticado, que
 * es lo correcto para lo que solo depende de tener sesión.
 */
export const Permisos = (...permisos: Permiso[]) => SetMetadata(CLAVE_PERMISOS, permisos);
