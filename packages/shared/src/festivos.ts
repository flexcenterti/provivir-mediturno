/**
 * RN-06.5 · Festivos nacionales de Colombia.
 *
 * Se calculan en vez de escribirse a mano: son 18 al año y **doce de ellos son
 * móviles**, así que una lista fija caduca cada 31 de diciembre y nadie se acuerda
 * de renovarla hasta que un paciente agenda el lunes de Reyes.
 *
 * Dos mecanismos de traslado, y conviene no confundirlos:
 *
 * - **Ley 51 de 1983 ("Ley Emiliani")**: siete festivos se corren al LUNES siguiente
 *   cuando no caen en lunes. Los otros seis se celebran siempre en su fecha.
 * - **Derivados de la Pascua**: Jueves y Viernes Santo se quedan donde caen; Ascensión,
 *   Corpus Christi y Sagrado Corazón sí se corren al lunes.
 *
 * Todas las fechas se devuelven como `AAAA-MM-DD` calculadas en UTC, que es como se
 * guardan las fechas en este sistema (medianoche UTC). No usar `fechaEnZona()` sobre
 * ellas: las correría un día hacia atrás.
 */

export interface Festivo {
  /** AAAA-MM-DD */
  fecha: string;
  motivo: string;
}

const DIA_MS = 86_400_000;

const iso = (d: Date): string => d.toISOString().slice(0, 10);

const utc = (anio: number, mes: number, dia: number): Date =>
  new Date(Date.UTC(anio, mes - 1, dia));

const sumarDias = (d: Date, dias: number): Date => new Date(d.getTime() + dias * DIA_MS);

/**
 * Corre la fecha al lunes siguiente si no cae en lunes (Ley Emiliani).
 * `getUTCDay()`: 0 = domingo, 1 = lunes.
 */
function alLunesSiguiente(d: Date): Date {
  const dia = d.getUTCDay();
  if (dia === 1) return d;
  // Desde domingo falta 1 día; desde martes faltan 6.
  return sumarDias(d, dia === 0 ? 1 : 8 - dia);
}

/**
 * Domingo de Pascua por el algoritmo de Meeus/Butcher (calendario gregoriano).
 * Es la referencia de la que cuelgan cinco festivos.
 */
export function domingoDePascua(anio: number): Date {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(anio, mes, dia);
}

/** Los 18 festivos nacionales del año, ordenados por fecha. */
export function festivosColombia(anio: number): Festivo[] {
  const pascua = domingoDePascua(anio);

  /** Se celebran en su fecha, pase lo que pase. */
  const fijos: Array<[number, number, string]> = [
    [1, 1, 'Año Nuevo'],
    [5, 1, 'Día del Trabajo'],
    [7, 20, 'Día de la Independencia'],
    [8, 7, 'Batalla de Boyacá'],
    [12, 8, 'Inmaculada Concepción'],
    [12, 25, 'Navidad'],
  ];

  /** Ley Emiliani: se corren al lunes siguiente. */
  const trasladables: Array<[number, number, string]> = [
    [1, 6, 'Reyes Magos'],
    [3, 19, 'Día de San José'],
    [6, 29, 'San Pedro y San Pablo'],
    [8, 15, 'Asunción de la Virgen'],
    [10, 12, 'Día de la Raza'],
    [11, 1, 'Todos los Santos'],
    [11, 11, 'Independencia de Cartagena'],
  ];

  /** Desde la Pascua. Los dos primeros NO se trasladan. */
  const dePascua: Array<[number, string, boolean]> = [
    [-3, 'Jueves Santo', false],
    [-2, 'Viernes Santo', false],
    [39, 'Ascensión del Señor', true],
    [60, 'Corpus Christi', true],
    [68, 'Sagrado Corazón de Jesús', true],
  ];

  const festivos: Festivo[] = [
    ...fijos.map(([m, d, motivo]) => ({ fecha: iso(utc(anio, m, d)), motivo })),
    ...trasladables.map(([m, d, motivo]) => ({
      fecha: iso(alLunesSiguiente(utc(anio, m, d))),
      motivo,
    })),
    ...dePascua.map(([offset, motivo, traslada]) => {
      const base = sumarDias(pascua, offset);
      return { fecha: iso(traslada ? alLunesSiguiente(base) : base), motivo };
    }),
  ];

  /*
   * Dos festivos pueden caer el mismo día tras el traslado, y entonces son un solo
   * día cerrado. Pasa de verdad: en 2025 San Pedro (domingo 29 de junio) y el Sagrado
   * Corazón (viernes 27) se corren los dos al lunes 30, y ese año tiene 17 días
   * festivos, no 18. Sin fusionarlos, la carga a la base chocaría con el único
   * (sede, fecha).
   */
  const porFecha = new Map<string, string[]>();
  for (const f of festivos) {
    porFecha.set(f.fecha, [...(porFecha.get(f.fecha) ?? []), f.motivo]);
  }

  return [...porFecha.entries()]
    .map(([fecha, motivos]) => ({ fecha, motivo: motivos.join(' · ') }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}
