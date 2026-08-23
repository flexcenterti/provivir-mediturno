/**
 * Recuperación léxica sobre la base de conocimiento (RN-13, ADR A8).
 *
 * Etapa 1: sin embeddings. La capa semántica se suma detrás de esta misma interfaz
 * si el golden set muestra que hace falta — ver `docs/adr-a8-recuperacion-conocimiento.md`.
 *
 * El puntaje es **cobertura de términos**: qué porcentaje de los lexemas de la
 * pregunta aparece en el fragmento. Se eligió sobre `ts_rank` porque es
 * interpretable: un umbral de 62 significa "el fragmento cubre al menos dos tercios
 * de lo que preguntó el paciente", y eso se puede discutir con el cliente y
 * calibrar contra el golden set. `ts_rank` devuelve un número sin unidades que
 * nadie puede razonar.
 *
 * Los trigramas amplían el conjunto de candidatos (nombres propios de exámenes,
 * errores de tipeo) y desempatan, pero no inflan la cobertura: una pregunta mal
 * escrita baja el puntaje y escala, que es la conducta conservadora que piden las
 * reglas.
 */

/** Similitud de trigramas para considerar un fragmento candidato del prefiltro. */
const SIMILITUD_CANDIDATO = 0.15;

/**
 * Similitud a la que dos lexemas cuentan como el mismo término.
 *
 * El lematizador español unifica mucho por sí solo (pago/pagar, sábado/sábados,
 * ecografía/ecografías dan el mismo lema), pero no todo: «preparo» da `prepar` y
 * «preparación» da `preparacion`, que son términos distintos para el índice. Medido
 * sobre pares reales, esas variantes quedan entre 0,35 y 0,50 de similitud, mientras
 * que palabras sin relación se quedan por debajo de 0,25.
 *
 * Esto cierra la brecha morfológica. NO cierra la de sinónimos: «abren» contra
 * «atendemos» da 0,09 y «vale» contra «precio» da 0,00. Para eso hace falta la capa
 * semántica del ADR A8 — o escribir los artículos con las palabras que usa el
 * paciente, que es lo que persigue el ciclo de mejora de RN-13.6.
 */
const SIMILITUD_LEXEMA = 0.35;

export interface FragmentoRecuperado {
  fragmentoId: string;
  articuloId: string;
  titulo: string;
  version: number;
  servicioId: string | null;
  texto: string;
  /** 0–100 · porcentaje de lexemas de la pregunta presentes en el fragmento. */
  puntaje: number;
}

/**
 * SQL de la recuperación. Se deja aparte del servicio para poder leerlo completo
 * sin ruido: es la pieza que decide qué responde el bot.
 *
 * $1 pregunta · $2 servicioId (o null) · $3 límite
 */
export const SQL_RECUPERAR = `
WITH consulta AS (
  SELECT
    lexemas,
    -- Los lexemas se unen con OR. Con plainto_tsquery serían un AND y bastaría con
    -- que faltara una palabra de la pregunta para no recuperar nada: la cobertura
    -- se calcula abajo, el prefiltro solo tiene que traer candidatos.
    CASE WHEN cardinality(lexemas) > 0
      THEN array_to_string(ARRAY(SELECT quote_literal(l) FROM unnest(lexemas) AS l), ' | ')::tsquery
      ELSE NULL::tsquery
    END AS tsq
  FROM (SELECT tsvector_to_array(to_tsvector('spanish', inmutable_unaccent($1))) AS lexemas) AS t
)
SELECT
  f.id            AS "fragmentoId",
  f.articulo_id   AS "articuloId",
  a.titulo,
  a.version,
  a.servicio_id   AS "servicioId",
  f.texto,
  -- Cobertura: qué porcentaje de los lexemas de la pregunta aparece en el fragmento,
  -- contando como presente también una variante morfológica cercana.
  COALESCE(
    ROUND(
      100.0 * cardinality(ARRAY(
        SELECT ql FROM unnest(c.lexemas) AS ql
        WHERE EXISTS (
          SELECT 1 FROM unnest(tsvector_to_array(f.tsv)) AS fl
          WHERE fl = ql OR similarity(fl, ql) > ${SIMILITUD_LEXEMA}
        )
      )) / NULLIF(cardinality(c.lexemas), 0)
    ),
    0
  )::int AS puntaje
FROM kb_fragmento f
JOIN kb_articulo a ON a.id = f.articulo_id
CROSS JOIN consulta c
WHERE a.estado = 'publicado'
  AND a.vigente_desde <= now()
  AND (a.vigente_hasta IS NULL OR a.vigente_hasta > now())
  AND ($2::text IS NULL OR a.servicio_id = $2)
  -- Prefiltro que usa los dos índices GIN. Sin él esto sería un recorrido completo.
  AND ((c.tsq IS NOT NULL AND f.tsv @@ c.tsq) OR similarity(f.texto, $1) > ${SIMILITUD_CANDIDATO})
ORDER BY puntaje DESC, similarity(f.texto, $1) DESC
LIMIT $3
`;

export type ResultadoBusqueda =
  | { tipo: 'bloqueada'; tema: string }
  | { tipo: 'sin_cobertura'; mejorPuntaje: number; fragmentos: FragmentoRecuperado[] }
  | { tipo: 'respondida'; fragmentos: FragmentoRecuperado[]; mejorPuntaje: number };

/**
 * Decide el desenlace a partir de lo recuperado. Aparte del acceso a datos para
 * poder probar la regla del umbral sin base de datos.
 *
 * Sin fragmentos sobre el umbral NO se responde: se escala (RN-13.3). El bot no
 * aproxima — en salud una indicación de preparación equivocada tiene costo real.
 */
export function decidir(
  fragmentos: FragmentoRecuperado[],
  umbral: number,
  tema: string | null,
): ResultadoBusqueda {
  if (tema) return { tipo: 'bloqueada', tema };

  const mejorPuntaje = fragmentos[0]?.puntaje ?? 0;
  if (mejorPuntaje < umbral) return { tipo: 'sin_cobertura', mejorPuntaje, fragmentos };

  // Solo se entregan los que superan el umbral: un fragmento flojo arrastrado por
  // uno bueno es material para que el modelo mezcle cosas que no van juntas.
  return { tipo: 'respondida', mejorPuntaje, fragmentos: fragmentos.filter((f) => f.puntaje >= umbral) };
}

/**
 * Normaliza una pregunta para agrupar las que no tuvieron cobertura (RN-13.6).
 * Quita signos y palabras vacías para que "¿tienen parqueadero?" y "hay
 * parqueadero" caigan en la misma fila y sumen ocurrencias en vez de duplicarse.
 */
const VACIAS = new Set([
  'a', 'al', 'algo', 'de', 'del', 'el', 'ella', 'ellos', 'en', 'es', 'esta', 'hay',
  'la', 'las', 'lo', 'los', 'me', 'mi', 'para', 'por', 'que', 'se', 'si', 'su',
  'tiene', 'tienen', 'un', 'una', 'uno', 'ustedes', 'y', 'yo',
]);

export function normalizarPregunta(pregunta: string): string {
  return pregunta
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((p) => p && !VACIAS.has(p))
    .sort()
    .join(' ')
    .trim();
}
