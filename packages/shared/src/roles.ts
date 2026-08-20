/** Roles del sistema. El rol `pantalla` es de solo lectura para los TV de sala (RN-11). */
export const ROLES = ['admin', 'asistente', 'prestador', 'pantalla'] as const;
export type Rol = (typeof ROLES)[number];

/**
 * RN-06.1/RN-06.2 · Solo administración gobierna las agendas.
 * El prestador las ve en modo "Información de agenda" (solo lectura).
 */
export const ROLES_QUE_GOBIERNAN_AGENDA: readonly Rol[] = ['admin', 'asistente'];

export function puedeModificarAgenda(rol: Rol): boolean {
  return ROLES_QUE_GOBIERNAN_AGENDA.includes(rol);
}
