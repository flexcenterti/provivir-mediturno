/**
 * Temas de escalamiento obligatorio (RN-13.4).
 *
 * Escalan SIEMPRE, sin importar qué tan bien recupere la base. La lista vive en
 * `configuracion` y no en el prompt: el cliente la aprueba y la ajusta sin
 * desplegar código (P12).
 *
 * Se evalúa ANTES de buscar. Que exista un artículo que cubra el tema no es
 * motivo para responder: la clínica decidió que esas conversaciones las atiende
 * una persona.
 */

export interface TemaProhibido {
  tema: string;
  /** Frases que lo delatan. Se comparan sin tildes y en minúscula. */
  senales: string[];
}

/**
 * Propuesta base. El cliente la confirma por escrito antes del piloto (P12);
 * hasta entonces esto es lo que rige.
 */
export const TEMAS_PROHIBIDOS_POR_DEFECTO: TemaProhibido[] = [
  {
    tema: 'Consejo o diagnóstico clínico',
    senales: [
      'que tengo', 'que sera', 'es grave', 'me duele', 'sintoma', 'sintomas',
      'diagnostico', 'que me recomienda', 'es normal que', 'sera que tengo',
    ],
  },
  {
    tema: 'Interpretación de exámenes o fórmulas',
    senales: [
      'que significa', 'mi resultado', 'mis resultados', 'salio alto', 'salio bajo',
      'esta alterado', 'interpretar', 'me pueden explicar el examen',
    ],
  },
  {
    tema: 'Medicamentos y dosis',
    senales: [
      'dosis', 'cuantas pastillas', 'puedo tomar', 'me sirve el', 'miligramos',
      'cada cuantas horas', 'puedo mezclar',
    ],
  },
  {
    tema: 'Quejas y reclamos',
    senales: [
      'queja', 'reclamo', 'pesimo', 'denuncia', 'devolucion', 'me atendieron mal',
      'quiero hablar con el gerente',
    ],
  },
  {
    tema: 'Asuntos legales o de facturación en disputa',
    senales: ['demanda', 'abogado', 'tutela', 'me cobraron mal', 'factura errada', 'superintendencia'],
  },
  {
    tema: 'Negociación de precios o descuentos',
    senales: ['descuento', 'rebaja', 'me lo deja en', 'precio especial', 'promocion especial'],
  },
];

/** Misma normalización que la búsqueda: minúscula y sin tildes. */
export const normalizar = (texto: string): string =>
  texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Devuelve el tema que obliga a escalar, o null. Si coinciden varios se devuelve
 * el primero de la lista: el orden de `configuracion` es el que decide, para que
 * el motivo registrado sea predecible y no dependa del texto del paciente.
 */
export function temaProhibido(
  pregunta: string,
  temas: TemaProhibido[] = TEMAS_PROHIBIDOS_POR_DEFECTO,
): string | null {
  const n = normalizar(pregunta);
  for (const { tema, senales } of temas) {
    if (senales.some((s) => n.includes(normalizar(s)))) return tema;
  }
  return null;
}

/** Lee la lista de `configuracion`; si el JSON está mal formado, cae a la propuesta base. */
export function parsearTemas(crudo: string | null | undefined): TemaProhibido[] {
  if (!crudo) return TEMAS_PROHIBIDOS_POR_DEFECTO;
  try {
    const parsed: unknown = JSON.parse(crudo);
    if (!Array.isArray(parsed)) return TEMAS_PROHIBIDOS_POR_DEFECTO;

    const temas = parsed.filter(
      (t): t is TemaProhibido =>
        typeof t === 'object' && t !== null &&
        typeof (t as TemaProhibido).tema === 'string' &&
        Array.isArray((t as TemaProhibido).senales),
    );
    // Una lista vacía dejaría al bot sin guardarraíl clínico. Ante la duda, la base.
    return temas.length ? temas : TEMAS_PROHIBIDOS_POR_DEFECTO;
  } catch {
    return TEMAS_PROHIBIDOS_POR_DEFECTO;
  }
}
