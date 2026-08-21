/**
 * Checklist §4.6 · los logs no llevan documento ni teléfono en claro.
 * Se enmascara conservando lo justo para poder correlacionar un caso en soporte.
 */
export function enmascararDocumento(documento: string | null | undefined): string {
  if (!documento) return '—';
  const d = documento.trim();
  if (d.length <= 4) return '*'.repeat(d.length);
  return `${'*'.repeat(d.length - 4)}${d.slice(-4)}`;
}

export function enmascararTelefono(telefono: string | null | undefined): string {
  if (!telefono) return '—';

  /*
   * Los identificadores de nombre de usuario ("wa:US.1349…") llevan dígitos, así
   * que sin distinguirlos salían enmascarados igual que un teléfono: en soporte
   * alguien buscaría un número terminado en esas cifras y no existiría. Se
   * conserva la marca para que se vea de un vistazo que no es un número.
   */
  if (telefono.startsWith('wa:')) {
    const id = telefono.slice(3);
    return `wa:${id.length <= 4 ? '*'.repeat(id.length) : `***${id.slice(-4)}`}`;
  }

  const digitos = telefono.replace(/\D/g, '');
  if (digitos.length <= 4) return enmascararDocumento(telefono);
  return `***${digitos.slice(-4)}`;
}

/** Para trazas: "Mora, C." en vez del nombre completo. */
export function enmascararNombre(nombres: string, apellidos: string): string {
  return `${apellidos}, ${nombres.charAt(0).toUpperCase()}.`;
}
