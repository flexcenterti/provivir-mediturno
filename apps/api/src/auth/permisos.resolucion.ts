import { PERFILES_BASE } from '@provivir/shared';
import type { Rol } from '@provivir/shared';

/** Qué perfil base corresponde a cada rol antiguo. */
const POR_ROL: Record<Rol, string> = {
  admin: 'Administración',
  asistente: 'Asistente',
  prestador: 'Médico',
  pantalla: 'Pantalla de sala',
};

/**
 * Permisos efectivos de un usuario.
 *
 * Si tiene perfil, manda el perfil. Si no —usuarios creados antes de que
 * existieran, o cuyo perfil se desactivó— se cae al equivalente de su rol: nadie
 * debe perder el acceso porque cambiáramos el modelo por debajo.
 *
 * Un perfil desactivado no concede nada aunque siga asignado: es la forma de
 * cortar el acceso de un grupo entero sin tocar usuario por usuario.
 */
export function permisosDe(usuario: {
  rol: Rol;
  perfil?: { permisos: string[]; activo: boolean } | null;
}): string[] {
  if (usuario.perfil) return usuario.perfil.activo ? usuario.perfil.permisos : [];

  const base = PERFILES_BASE.find((p) => p.nombre === POR_ROL[usuario.rol]);
  return base ? [...base.permisos] : [];
}
