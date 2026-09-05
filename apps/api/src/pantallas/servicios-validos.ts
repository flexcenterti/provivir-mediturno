/**
 * Qué ids de servicio de los pedidos no existen en el catálogo.
 *
 * `Pantalla.servicios` es un `String[]` sin clave foránea, así que nada impide
 * configurar un televisor con un servicio que no existe. Esa pantalla no recibe un
 * solo llamado en toda su vida y no dice por qué: se queda en «Esperando llamados»
 * para siempre, que es indistinguible de una sala tranquila.
 *
 * Y no es hipotético: el catálogo de demostración usa `der`, `derp`, `vitc` y el real
 * de la clínica usa `odo`, `oft`, `rx`. Configurar contra uno y desplegar el otro deja
 * la pantalla ciega en silencio.
 */
export function serviciosInexistentes(pedidos: string[], delCatalogo: string[]): string[] {
  const catalogo = new Set(delCatalogo);
  return pedidos.filter((id) => !catalogo.has(id));
}
