/**
 * Cómo aparece el paciente en un televisor de sala de espera.
 *
 * Las pantallas se sirven sin restricción de red (decisión del cliente): lo único
 * que las protege es que la URL lleva un UUID que solo se ve desde el backoffice.
 * Con esa defensa, lo que se muestra importa más que antes — un enlace filtrado
 * expone en vivo a quién está atendiendo la clínica.
 *
 * Y aun dentro de la sala: el código de turno basta para que el paciente se
 * reconozca, mientras que su nombre completo lo oye y lo ve toda la sala.
 */
export type ModoNombre = 'completo' | 'abreviado' | 'oculto';

const MODOS: readonly string[] = ['completo', 'abreviado', 'oculto'];

export const esModoNombre = (v: string): v is ModoNombre => MODOS.includes(v);

/**
 * `abreviado` deja el primer nombre y la inicial del primer apellido: suficiente
 * para que alguien se reconozca, insuficiente para identificarlo desde fuera.
 */
export function nombreParaPantalla(
  nombres: string,
  apellidos: string,
  modo: ModoNombre,
): string {
  if (modo === 'oculto') return '';
  if (modo === 'completo') return `${nombres} ${apellidos}`.trim();

  const nombre = nombres.trim().split(/\s+/)[0] ?? '';
  const apellido = apellidos.trim().split(/\s+/)[0] ?? '';
  return apellido ? `${nombre} ${apellido.charAt(0).toUpperCase()}.` : nombre;
}
