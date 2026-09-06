import type { INestApplication } from '@nestjs/common';
import { ConfiguracionService } from '../src/configuracion/configuracion.service';

/**
 * RN-04.8 · Apagar y encender la ventana de autoagendamiento dentro de una suite.
 *
 * Las suites que agendan por autoservicio en fechas fijas —un lunes concreto de
 * septiembre— dejarían de pasar según el día de la semana en que se ejecuten, porque la
 * ventana se mueve con el calendario. Cambiarles la fecha a una que caiga dentro sería
 * peor: quedarían atadas al día en que corren.
 *
 * Así que las suites que **no van de esta regla** la apagan y lo dicen. Cada una sigue
 * probando una sola cosa, y la regla tiene su propia suite, donde se prueba con una
 * configuración deliberadamente abierta: la semántica de las siete filas se fija en las
 * unitarias puras, aquí solo el cableado.
 *
 * Hay que **restaurarla en `afterAll`**: la base es compartida entre suites y cada una
 * levanta su propia aplicación, que relee la configuración al arrancar. Dejarla apagada
 * desactivaría la regla para todo lo que corra después.
 */
const CLAVE = 'autoagendamiento_ventana_activa';

export const apagarVentana = (app: INestApplication): Promise<void> =>
  app.get(ConfiguracionService).fijar(CLAVE, 'false');

export const encenderVentana = (app: INestApplication): Promise<void> =>
  app.get(ConfiguracionService).fijar(CLAVE, 'true');

/**
 * Abre la ventana en una configuración concreta, y devuelve el ÚNICO día que ofrece.
 *
 * Las siete filas apuntan al lunes, así que la ventana es el próximo lunes sea cual sea
 * el día en que corra la suite — y el lunes es un día con agenda de mañana en el seed,
 * que es justo lo que hace falta para probar que la franja de tardes lo deja fuera.
 */
export async function ventanaSoloElProximoLunes(
  app: INestApplication, horarioCita: string,
): Promise<string> {
  const config = app.get(ConfiguracionService);
  await config.fijar('autoagendamiento_ventana_dias', '1:1-1,2:1-1,3:1-1,4:1-1,5:1-1,6:1-1,7:1-1');
  await config.fijar('autoagendamiento_dias_excluidos', '');
  await config.fijar('autoagendamiento_horario_cita', horarioCita);
  await config.fijar('autoagendamiento_horario_canal', '00:00-23:59');
  await config.fijar(CLAVE, 'true');

  const hoy = new Date(`${new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())}T00:00:00Z`);
  // Estrictamente posterior a hoy, como hace el motor.
  hoy.setUTCDate(hoy.getUTCDate() + (((8 - hoy.getUTCDay()) % 7) || 7));
  return hoy.toISOString().slice(0, 10);
}

/** Deja los cuatro parámetros como los siembra `configuracion.base`. */
export async function restaurarVentana(app: INestApplication): Promise<void> {
  const config = app.get(ConfiguracionService);
  await config.fijar('autoagendamiento_ventana_dias', '1:3-5,2:4-5,3:1-5,4:1-5,5:2-5,6:2-5,7:3-5');
  await config.fijar('autoagendamiento_dias_excluidos', '6,7');
  await config.fijar('autoagendamiento_horario_cita', '12:00-23:59');
  await config.fijar('autoagendamiento_horario_canal', '00:00-23:59');
}
