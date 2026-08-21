import * as argon2 from 'argon2';

/**
 * Parámetros Argon2id, en un solo lugar. Coste deliberadamente alto: el login es
 * infrecuente (asistentes y médicos, no pacientes) y el costo de un hash débil es
 * una fuga de credenciales.
 *
 * Vive aparte de AuthService porque el seed y el alta inicial también hashean, y
 * son scripts sueltos: importar el servicio arrastraría el contenedor de Nest
 * entero. Antes cada uno llevaba su propia copia de estos números.
 */
export const ARGON2_OPCIONES: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/** Hashea con los parámetros de la plataforma. */
export const hashearPassword = (password: string): Promise<string> =>
  argon2.hash(password, ARGON2_OPCIONES);
