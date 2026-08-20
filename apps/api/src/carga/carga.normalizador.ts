import { COLUMNAS, type CampoCarga, type FilaNormalizada } from './carga.tipos';

const SIN_TILDES = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * RN-12.2 · la plantilla se construye a partir del archivo que el cliente exporta:
 * no se le exige reacomodar columnas ni títulos. Por eso el mapeo es tolerante a
 * tildes, mayúsculas y variantes de nombre.
 */
export function mapearEncabezados(encabezados: string[]): Partial<Record<CampoCarga, number>> {
  const mapa: Partial<Record<CampoCarga, number>> = {};
  const normalizados = encabezados.map(SIN_TILDES);

  for (const [campo, alias] of Object.entries(COLUMNAS) as [CampoCarga, readonly string[]][]) {
    const idx = normalizados.findIndex((h) => alias.some((a) => SIN_TILDES(a) === h));
    if (idx >= 0) mapa[campo] = idx;
  }
  return mapa;
}

export function columnasFaltantes(mapa: Partial<Record<CampoCarga, number>>): CampoCarga[] {
  const obligatorias: CampoCarga[] = ['documento', 'nombres', 'apellidos'];
  return obligatorias.filter((c) => mapa[c] === undefined);
}

/** Deja solo dígitos y el prefijo +; el archivo del cliente trae formatos mezclados. */
export function normalizarTelefono(valor: string | undefined): string | undefined {
  if (!valor) return undefined;
  const limpio = valor.replace(/[^\d+]/g, '');
  return limpio.length >= 7 ? limpio : undefined;
}

export function normalizarDocumento(valor: string | undefined): string | undefined {
  if (!valor) return undefined;
  const limpio = valor.replace(/[^\dA-Za-z-]/g, '').trim();
  return limpio.length >= 4 ? limpio : undefined;
}

/** Acepta AAAA-MM-DD, DD/MM/AAAA y DD-MM-AAAA. */
export function parsearFecha(valor: string | undefined): Date | undefined {
  if (!valor) return undefined;
  const v = valor.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);

  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(v);
  if (local) {
    const dd = local[1]!.padStart(2, '0');
    const mm = local[2]!.padStart(2, '0');
    return new Date(`${local[3]}-${mm}-${dd}T00:00:00Z`);
  }
  return undefined;
}

export function normalizarFila(
  celdas: string[],
  mapa: Partial<Record<CampoCarga, number>>,
): { fila?: FilaNormalizada; motivo?: string } {
  const leer = (campo: CampoCarga): string | undefined => {
    const i = mapa[campo];
    return i === undefined ? undefined : celdas[i]?.trim() || undefined;
  };

  const documento = normalizarDocumento(leer('documento'));
  if (!documento) return { motivo: 'Documento ausente o inválido' };

  const nombres = leer('nombres');
  const apellidos = leer('apellidos');
  if (!nombres || !apellidos) return { motivo: 'Nombres o apellidos ausentes' };

  return {
    fila: {
      documento,
      nombres: nombres.slice(0, 80),
      apellidos: apellidos.slice(0, 80),
      telefono: normalizarTelefono(leer('telefono')),
      correo: leer('correo')?.includes('@') ? leer('correo')!.slice(0, 160) : undefined,
      tdoc: (leer('tdoc') || 'CC').toUpperCase().slice(0, 5),
      servicio: leer('servicio'),
      fechaServicio: parsearFecha(leer('fechaServicio')),
    },
  };
}

/**
 * RN-12.3 · filtro acordado: se cargan los pacientes con al menos un servicio en
 * el último año; los demás se registran cuando lleguen.
 * Sin fecha de servicio no se puede afirmar que esté dentro del filtro → queda fuera.
 */
export function dentroDelUltimoAnio(fechaServicio: Date | undefined, referencia: Date): boolean {
  if (!fechaServicio) return false;
  const haceUnAnio = new Date(referencia);
  haceUnAnio.setUTCFullYear(haceUnAnio.getUTCFullYear() - 1);
  return fechaServicio >= haceUnAnio;
}
