import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verificación de `X-Hub-Signature-256` de Meta (Arquitectura §7.1, checklist §4.7).
 *
 * OBLIGATORIA: sin ella, cualquiera que conozca la URL puede inyectar mensajes
 * falsos y hacer que la plataforma agende citas en nombre de otros. Es uno de los
 * puntos que CLAUDE.md marca como "no se toca sin revisión humana".
 *
 * Se compara en tiempo constante: un `===` filtra por temporización cuántos bytes
 * del prefijo coinciden, y permite reconstruir la firma byte a byte.
 */
export function firmaValida(cuerpoCrudo: Buffer, cabecera: string | undefined, secreto: string): boolean {
  if (!cabecera || !secreto) return false;

  const [algoritmo, recibida] = cabecera.split('=');
  if (algoritmo !== 'sha256' || !recibida) return false;

  const esperada = createHmac('sha256', secreto).update(cuerpoCrudo).digest('hex');

  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(recibida, 'utf8');
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/**
 * Verificación del webhook al registrarlo en Meta: responde el `hub.challenge`
 * solo si el `hub.verify_token` coincide con el configurado.
 */
export function respuestaDeVerificacion(
  params: Record<string, string | undefined>,
  tokenEsperado: string,
): string | null {
  const modo = params['hub.mode'];
  const token = params['hub.verify_token'];
  const challenge = params['hub.challenge'];

  if (modo === 'subscribe' && token && tokenEsperado && token === tokenEsperado && challenge) {
    return challenge;
  }
  return null;
}
