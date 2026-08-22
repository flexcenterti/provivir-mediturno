import { randomBytes } from 'node:crypto';

/**
 * Contraseña generada, no elegida. Se excluyen los caracteres que se confunden al
 * dictarla por teléfono (O/0, l/1/I) porque alguien la va a dictar.
 *
 * Vive en auth/ y no en cli/ porque también la usa el alta desde el backoffice: un
 * servicio de la aplicación no debe importar de las herramientas de consola.
 */
export function generarPassword(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const simbolos = '!@#$%&*?';
  const tomar = (fuente: string, n: number) =>
    Array.from(randomBytes(n)).map((b) => fuente[b % fuente.length]).join('');
  // Se baraja para que los símbolos no queden siempre al final.
  const bruto = (tomar(alfabeto, 18) + tomar(simbolos, 3)).split('');
  for (let i = bruto.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0]! % (i + 1);
    [bruto[i], bruto[j]] = [bruto[j]!, bruto[i]!];
  }
  return bruto.join('');
}
