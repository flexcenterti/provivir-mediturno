import type { Rol } from '@provivir/shared';

/** Contenido del access token. Nunca incluye PII (documento, teléfono). */
export interface JwtPayload {
  sub: string;
  rol: Rol;
  sedeId: string;
  /** Presente solo cuando rol=prestador: ata al usuario con su ficha (RN-06.2). */
  prestadorId?: string;
}

export interface UsuarioAutenticado {
  id: string;
  rol: Rol;
  sedeId: string;
  permisos: string[];
  prestadorId?: string;
}
