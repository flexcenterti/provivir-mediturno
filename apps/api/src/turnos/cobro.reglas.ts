import type { Cobro, PoliticaCosto } from '@provivir/shared';

/**
 * RN-07.6 · Cuándo hay que explicar por escrito lo que se hizo con el cobro.
 *
 * La regla es una sola: **se exige nota cuando el desenlace contradice la política
 * del servicio**. Ni más ni menos.
 *
 *   · Eximir un servicio que se cobra → hay que decir por qué.
 *   · No cobrar un control → la política ya es la razón; pedir nota sería burocracia.
 *   · Cobrar un servicio SIN costo → también contradice, y es la anomalía que más
 *     interesa ver: o la política del catálogo está mal, o se cobró algo que no
 *     tocaba. Es fácil olvidarse de este lado.
 *
 * `porcentaje` cuenta como «se cobra»: no está implementado —no hay dónde guardar el
 * porcentaje— y tratarlo como gratuito sería peor que tratarlo como de pago.
 *
 * Vive aparte y sin base porque es la clase de condición que se escribe mal una vez y
 * nadie vuelve a mirar. Y NO puede vivir en el DTO: `class-validator` ve el cuerpo
 * aislado, así que habría que hacer que el cliente enviara la política — y entonces
 * el cliente puede mentir para saltarse la nota.
 */
export function exigeNota(politica: PoliticaCosto, cobro: Cobro): boolean {
  const seCobra = politica !== 'sin_costo';
  return seCobra !== (cobro === 'cobrado');
}

/** Lo que se guarda en la traza cuando la política justifica el desenlace. */
export function motivoPorPolitica(politica: PoliticaCosto, cobro: Cobro): string | undefined {
  if (exigeNota(politica, cobro)) return undefined;
  return cobro === 'exento' ? 'servicio sin costo' : undefined;
}
