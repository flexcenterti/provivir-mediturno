/**
 * Importación de la documentación comercial a artículos (RN-13).
 *
 * `configuracion.documentacion_comercial` guarda hoy un bloque de texto que se
 * inyecta entero en el prompt de todas las conversaciones. Este módulo lo parte en
 * artículos para que pase a recuperarse por pregunta, con versión y gobierno.
 *
 * El formato que entrega el cliente (P6) es el mismo que ya se venía usando:
 * bloques separados por línea en blanco, cada uno abierto por un título en negrita.
 * Se acepta tanto `**Título** — cuerpo` como un encabezado markdown, porque el
 * cliente manda lo que tenga y no vale la pena exigirle un formato.
 */

export interface BloqueImportado {
  titulo: string;
  cuerpo: string;
}

const RE_NEGRITA = /^\*\*(.+?)\*\*\s*[—–-]?\s*/;
const RE_ENCABEZADO = /^#{1,6}\s+(.+)$/;

/**
 * Parte el texto en bloques. Lo que no traiga título reconocible se acumula en el
 * bloque anterior: perder contenido por un formato inesperado sería peor que
 * dejarlo pegado a su sección.
 */
export function dividirDocumentacion(texto: string): BloqueImportado[] {
  const bloques: BloqueImportado[] = [];

  for (const crudo of texto.split(/\n\s*\n/)) {
    const parrafo = crudo.trim();
    if (!parrafo) continue;

    const [primera, ...resto] = parrafo.split('\n');
    const encabezado = RE_ENCABEZADO.exec(primera ?? '');
    const negrita = RE_NEGRITA.exec(primera ?? '');

    if (encabezado) {
      bloques.push({ titulo: encabezado[1]!.trim(), cuerpo: resto.join('\n').trim() });
    } else if (negrita) {
      const cuerpo = [(primera ?? '').replace(RE_NEGRITA, ''), ...resto].join('\n').trim();
      bloques.push({ titulo: negrita[1]!.trim(), cuerpo });
    } else if (bloques.length) {
      const ultimo = bloques[bloques.length - 1]!;
      ultimo.cuerpo = `${ultimo.cuerpo}\n\n${parrafo}`.trim();
    } else {
      // Texto suelto antes del primer título: se conserva como introducción.
      bloques.push({ titulo: 'Información general', cuerpo: parrafo });
    }
  }

  return bloques.filter((b) => b.cuerpo);
}

const normalizar = (t: string): string =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Empareja el título del bloque con un servicio del catálogo.
 *
 * Ante cualquier ambigüedad devuelve null. «Medicina general» coincide con Consulta
 * y con Control, que tienen duración y costo distintos; atarlo al equivocado haría
 * que el bot cite cifras que no son y que RN-04.5.4 marque para revisión el artículo
 * que no toca. Un artículo sin servicio se sigue recuperando igual: lo único que se
 * pierde es el vínculo, y eso un humano lo arregla en medio minuto.
 */
export function emparejarServicio(
  titulo: string,
  servicios: Array<{ id: string; nombre: string }>,
): string | null {
  const t = normalizar(titulo);
  if (!t) return null;

  // 1 · Nombre completo idéntico.
  const exactos = servicios.filter((s) => normalizar(s.nombre) === t);
  if (exactos.length) return exactos.length === 1 ? exactos[0]!.id : null;

  // 2 · Alguna parte del nombre idéntica: el catálogo usa «Medicina general · Consulta».
  const porParte = servicios.filter((s) =>
    s.nombre.split('·').some((parte) => normalizar(parte) === t),
  );
  if (porParte.length) return porParte.length === 1 ? porParte[0]!.id : null;

  // 3 · Contención, solo si es inequívoca.
  const parciales = servicios.filter((s) => normalizar(s.nombre).includes(t));
  return parciales.length === 1 ? parciales[0]!.id : null;
}

/** Los bloques que no describen un servicio son información operativa. */
export function categoriaDe(titulo: string, servicioId: string | null): string {
  if (servicioId) return 'Servicios';
  const t = normalizar(titulo);
  if (/horario|ubicacion|direccion|pago|importante|general/.test(t)) return 'Información general';
  return 'Preguntas frecuentes';
}
