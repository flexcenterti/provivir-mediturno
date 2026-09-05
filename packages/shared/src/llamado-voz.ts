/**
 * RN-11.5 · lo que se dice en voz alta cuando se llama un turno.
 *
 * Vive aquí, y no en la app de TV, porque es la única parte del sonido que se puede
 * probar sin un navegador: el resto son `AudioContext` y `speechSynthesis`. Por eso
 * carga con todo el comportamiento que se puede empujar a una función pura, incluida
 * la elección de la voz.
 */

export interface LlamadoParaVoz {
  codigo: string;
  /** Ya recortado por el servidor según `mostrar_nombre_en_pantalla`; vacío si `oculto`. */
  paciente: string;
  prestador: string;
  consultorio: string | null;
  repetido?: boolean;
}

/**
 * `MG-042` → `M G, 0 4 2`.
 *
 * Sin esto casi cualquier motor lee «MG042» de corrido o interpreta el guion como una
 * resta, y el código de turno es justamente el dato por el que el paciente se
 * reconoce. Las letras se separan una a una y los dígitos también; el guion se dice
 * como pausa, no como palabra.
 */
export function deletrearCodigo(codigo: string): string {
  return codigo
    .split(/[-\s_]+/)
    .filter(Boolean)
    .map((parte) => parte.split('').join(' '))
    .join(', ');
}

/**
 * La frase completa. El nombre se omite cuando llega vacío —`mostrar_nombre_en_pantalla`
 * en `oculto`—, y ese caso hay que tratarlo aparte o la frase queda con una coma
 * colgando en medio.
 *
 * El lugar cae al nombre del profesional cuando no hay consultorio, que es lo mismo
 * que hace el televisor: la voz y el tablero no pueden decir cosas distintas.
 */
export function textoDeLlamado(l: LlamadoParaVoz): string {
  const partes = [
    `${l.repetido ? 'De nuevo, turno' : 'Turno'} ${deletrearCodigo(l.codigo)}`,
    l.paciente.trim(),
    l.consultorio?.trim() ? `consultorio ${l.consultorio.trim()}` : l.prestador.trim(),
  ];
  return `${partes.filter(Boolean).join(', ')}.`;
}

/** Lo mínimo de `SpeechSynthesisVoice` que hace falta para elegir. */
export interface VozDisponible {
  lang: string;
  name: string;
}

/** Regiones preferidas, de más a menos cercana al habla de la sede. */
const PREFERIDAS = ['es-co', 'es-419', 'es-mx', 'es-us'];

/**
 * La mejor voz en español, o `null` si el aparato no tiene ninguna.
 *
 * **`null` significa no hablar**, y no «usa la que haya». Un motor en inglés leyendo
 * «MG-042, María G., consultorio 3» produce algo entre ininteligible y cómico, y un
 * nombre mal pronunciado a todo volumen en una sala de espera es peor que el silencio.
 * La campanita se queda, y el televisor lo dice en su indicador para que quien instale
 * el aparato sepa que le falta el paquete de idioma.
 */
export function elegirVozEspanola(voces: VozDisponible[]): VozDisponible | null {
  const espanolas = voces.filter((v) => v.lang.toLowerCase().startsWith('es'));
  if (espanolas.length === 0) return null;

  for (const region of PREFERIDAS) {
    const v = espanolas.find((x) => x.lang.toLowerCase().replace('_', '-') === region);
    if (v) return v;
  }
  // Cualquier español gana a ninguno: `es-ES` en un stick es mejor que el silencio.
  return espanolas[0] ?? null;
}
