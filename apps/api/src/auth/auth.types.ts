import type { Rol } from '@provivir/shared';

/**
 * Los dos tokens se firman con el mismo secreto, así que sin esta marca el de
 * refresco valdría como `Bearer`: sería un token de acceso con la vida de la
 * sesión entera. `JwtStrategy` rechaza los de refresco y el canje rechaza los de
 * acceso.
 */
export type TipoToken = 'acceso' | 'refresco';

/** Contenido del access token. Nunca incluye PII (documento, teléfono). */
export interface JwtPayload {
  sub: string;
  rol: Rol;
  sedeId: string;
  /** Presente solo cuando rol=prestador: ata al usuario con su ficha (RN-06.2). */
  prestadorId?: string;
  /**
   * Ausente en los tokens emitidos antes de esta versión. Se tratan como de
   * acceso a propósito: así el despliegue no echa a nadie que esté trabajando.
   * Para refrescar, en cambio, se exige la marca explícita.
   */
  tipo?: TipoToken;
}

export interface UsuarioAutenticado {
  id: string;
  rol: Rol;
  sedeId: string;
  permisos: string[];
  prestadorId?: string;
}
