/**
 * Textos de la secuencia comercial (RN-09.9.3).
 *
 * Son plantillas deterministas alimentadas por la ficha comercial del servicio, no
 * texto generado por el modelo en cada envío. La razón es que el cliente tiene que
 * **aprobar estos mensajes** (decisión D-d): un texto distinto cada vez no se puede
 * aprobar, y un mensaje comercial que sale solo a un paciente real no es el lugar
 * para descubrir qué se le ocurrió al modelo. Además evita coste y latencia de una
 * llamada al modelo en un trabajo de fondo.
 *
 * La regla de RN-09.9.3 —cada mensaje aporta algo nuevo, un solo llamado a la
 * acción, el cierre no lleva pregunta— se cumple por construcción.
 */

export interface FichaParaMensaje {
  nombre: string;
  duracionMin: number;
  requiereOrden: boolean;
  beneficios: string[];
  preparacion: string | null;
  /** Ya mencionados en la conversación: no se repiten (RN-09.9.3.2). */
  yaMencionados?: string[];
}

const normalizar = (t: string): string =>
  t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

/** El primer beneficio que el paciente todavía no haya oído. */
function beneficioNuevo(ficha: FichaParaMensaje): string | null {
  const dichos = (ficha.yaMencionados ?? []).map(normalizar);
  const nuevo = ficha.beneficios.find((b) => !dichos.some((d) => d.includes(normalizar(b))));
  return nuevo ?? null;
}

/**
 * Seguimiento 1 (`T0+2h`) · pregunta abierta apoyada en un beneficio no mencionado.
 * Si no queda ninguno sin decir, se pregunta por la duda en vez de repetir.
 */
export function mensajeSeguimiento1(ficha: FichaParaMensaje): string {
  const beneficio = beneficioNuevo(ficha);

  // Una sola pregunta por mensaje (RN-09.9.3.3). Abrir con "¿te quedó alguna duda?"
  // y cerrar con "¿te reservo un espacio?" son dos peticiones en el mismo mensaje:
  // baja la respuesta y suena a insistencia.
  return beneficio
    ? `Hola de nuevo 😊 ¿Te quedó alguna duda con ${ficha.nombre.toLowerCase()}? ` +
      `Te cuento que ${beneficio.toLowerCase()}, por si eso pesaba.`
    : `Hola de nuevo 😊 ¿Qué te frena para agendar ${ficha.nombre.toLowerCase()}? Lo miramos juntos.`;
}

/**
 * Seguimiento 2 (`T0+5h`) · algo nuevo y concreto. Con horarios reales se ofrecen;
 * si no hay, se resuelve la barrera práctica (preparación u orden médica).
 */
export function mensajeSeguimiento2(ficha: FichaParaMensaje, horarios: string[]): string {
  if (horarios.length) {
    const opciones = horarios.slice(0, 2).join(' o ');
    return `Te dejo dos opciones concretas por si te sirven: ${opciones}. Son ${ficha.duracionMin} minutos. ¿Te aparto alguna? 🗓️`;
  }

  if (ficha.requiereOrden) {
    return `Por si era eso lo que te frenaba: para ${ficha.nombre.toLowerCase()} solo necesitas tu orden médica, y puedes mandarme la foto por aquí. ¿La tienes a mano?`;
  }

  if (ficha.preparacion) {
    return `Por si era eso lo que te frenaba, la preparación es sencilla: ${ficha.preparacion.toLowerCase()} ¿Te busco un espacio?`;
  }

  return `Son solo ${ficha.duracionMin} minutos y no requiere preparación. ¿Te busco un espacio esta semana?`;
}

/**
 * Cierre (`T0+8h`) · deja la puerta abierta y no vuelve a insistir.
 * Sin pregunta: exigir respuesta en el mensaje de cierre es lo que lo convierte
 * en un cuarto intento disfrazado.
 */
export function mensajeCierre(ficha: FichaParaMensaje): string {
  return (
    `Te dejo tranquilo por hoy 🙂 Cuando quieras agendar ${ficha.nombre.toLowerCase()}, ` +
    `escríbeme por aquí y lo vemos en un minuto. Que estés muy bien.`
  );
}

export function textoDelPaso(
  paso: 'seguimiento_1' | 'seguimiento_2' | 'cierre',
  ficha: FichaParaMensaje,
  horarios: string[] = [],
): string {
  if (paso === 'seguimiento_1') return mensajeSeguimiento1(ficha);
  if (paso === 'seguimiento_2') return mensajeSeguimiento2(ficha, horarios);
  return mensajeCierre(ficha);
}
