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
