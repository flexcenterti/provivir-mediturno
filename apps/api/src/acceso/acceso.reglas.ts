import type { Rol } from '@provivir/shared';

export interface Vinculo {
  rol: Rol;
  /** `null` = la cuenta no está atada a ninguna ficha. */
  prestadorId: string | null;
}

export interface CambioDeVinculo {
  actual: Vinculo;
  /** Ausente = no se toca. Presente = se cambia, y `null` desata la ficha. */
  rol?: Rol;
  prestadorId?: string | null;
}

/**
 * RN-06.2 · Qué combinación de rol y ficha queda tras una edición.
 *
 * Vive aparte y sin base a propósito: la regla es una tabla de verdad pequeña y es
 * justo donde se cuelan los errores —promover a médico sin ficha, o dejar a un
 * médico sin ella— que después nadie puede deshacer desde la interfaz.
 *
 * `undefined` significa «no lo toques» y `null` significa «quítalo». La distinción es
 * load-bearing: si se colapsaran, guardar el nombre de un médico le arrancaría la
 * ficha. Los DTO la respetan.
 */
export function resolverVinculo(cambio: CambioDeVinculo): Vinculo {
  const rol = cambio.rol ?? cambio.actual.rol;
  const prestadorId = cambio.prestadorId === undefined
    ? cambio.actual.prestadorId
    : cambio.prestadorId;

  if (rol === 'prestador' && !prestadorId) {
    throw new Error('Un usuario médico debe asociarse a una ficha de prestador (RN-06.2)');
  }

  /*
   * Dejar de ser médico suelta la ficha sola, en vez de rechazar el cambio. Es lo
   * que quiere decir quien pasa a alguien a administrativo, y es lo que ya hacía el
   * formulario de alta. Rechazarlo obligaría a un baile de dos guardados que además
   * no se puede hacer: el paso intermedio —médico sin ficha— está prohibido arriba.
   */
  if (rol !== 'prestador' && prestadorId) return { rol, prestadorId: null };

  return { rol, prestadorId };
}
