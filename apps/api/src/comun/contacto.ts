/** Lo mínimo que hace falta para saber a dónde se le escribe a alguien. */
export interface ConTelefonos {
  whatsapp?: string | null;
  telefono?: string | null;
}

/**
 * A qué número se le escribe a un paciente, o `null` si no hay ninguno.
 *
 * Con `||` y NO con `??`: la base trae cadenas vacías además de nulos —el cargador
 * masivo y el mostrador escriben `''` cuando el campo viene en blanco—, y con `??`
 * un `whatsapp: ''` no cae al respaldo. El recordatorio salía entonces hacia la
 * cadena vacía en vez de hacia el teléfono que sí estaba guardado.
 *
 * Vive en un solo sitio para que «a dónde se envía» y «qué se le muestra a la
 * asistente» no puedan divergir. Con una copia en cada lado, la pantalla podría
 * decir que al paciente nunca le llegó nada mientras el aviso salió por otro número.
 */
export function numeroDeContacto(p: ConTelefonos): string | null {
  return p.whatsapp?.trim() || p.telefono?.trim() || null;
}
