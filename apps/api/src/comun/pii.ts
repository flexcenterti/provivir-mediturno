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
  const digitos = telefono.replace(/\D/g, '');
  if (digitos.length <= 4) return '*'.repeat(digitos.length);
  return `***${digitos.slice(-4)}`;
}

/** Para trazas: "Mora, C." en vez del nombre completo. */
export function enmascararNombre(nombres: string, apellidos: string): string {
  return `${apellidos}, ${nombres.charAt(0).toUpperCase()}.`;
}
