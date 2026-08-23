# Changelog · FASE 7 — Base de conocimiento y seguimiento comercial

**Estado:** en curso. Esquema migrado y módulo `conocimiento` operativo; **195 unitarias y 134 e2e en verde**.

Fase posterior al alcance original. Convierte `configuracion.documentacion_comercial` —hoy un
bloque de texto inyectado en el prompt de **todas** las conversaciones— en artículos versionados
con recuperación (RN-13), extiende el seguimiento de RN-09.8 a una secuencia comercial (RN-09.9) y
completa el gobierno del catálogo (RN-04.5).

## Esquema de datos

Cinco modelos nuevos y siete enumeraciones:

- **`KbArticulo`** · estados `borrador | publicado | archivado`, versión y vigencia. Se archiva,
  nunca se borra: la auditoría debe poder explicar respuestas que el bot ya dio (RN-13.5).
  `requiereRevision` lo marca cuando su servicio se desactiva (RN-04.5.4).
- **`KbFragmento`** · trozos indexables, con borrado en cascada desde el artículo.
- **`KbConsulta`** · qué recuperó el bot y en qué terminó. `mensajeId` único: una respuesta se
  sustenta como máximo en una consulta (RN-13.7.3).
- **`KbPendiente`** · preguntas sin cobertura agrupadas por pregunta normalizada, con contador de
  ocurrencias. Repetir la pregunta incrementa el contador, no crea otra fila (RN-13.6).
- **`Seguimiento`** · un envío programado de la secuencia de tres pasos (RN-09.9).

Modelos ampliados: `Servicio` con la ficha comercial (RN-04.5.1), `Conversacion` con interés y
desenlace comercial, `Mensaje` con los artículos que sustentaron la respuesta, y `Paciente` con
`noContactar` para el opt-out permanente (RN-09.9.4).

## Recuperación sin pgvector

`pgvector` no está en `postgres:16-alpine` ni en el Postgres embebido del flujo sin Docker, y
cambiar la imagen habría roto ese flujo. Se descartó — detalle y alternativas en
`docs/adr-a8-recuperacion-conocimiento.md`.

La capa léxica usa contrib estándar: `unaccent` y `pg_trgm`, ambas creadas en la migración.

**`inmutable_unaccent(text)`** · `unaccent()` no es `IMMUTABLE` porque depende del diccionario que
reciba; fijándolo explícitamente sí lo es, y solo así puede usarse para indexar.

**Índices:** GIN sobre el `tsvector`, GIN de trigramas sobre `kb_fragmento.texto` —para tolerar
errores de tipeo y recuperar exacto nombres propios como "Doppler" o "TSH", que la búsqueda
semántica diluye— y GIN de trigramas sobre `kb_pendiente.pregunta_normalizada` para agrupar por
similitud.

### El `tsvector` se mantiene con trigger, no con columna generada

Primero se implementó como columna `GENERATED ALWAYS AS ... STORED`, que es lo natural. **Choca con
el diff de Prisma:** al comparar contra `tsv Unsupported("tsvector")?` la ve como deriva y en cada
`migrate dev` intenta revertirla, arrastrándose además los índices GIN. La migración correctiva
(`20260823175500_kb_fragmento_tsv_por_trigger`) la convierte en columna simple mantenida por un
trigger `BEFORE INSERT OR UPDATE OF texto`.

Misma garantía —el índice no puede quedar desincronizado del texto— y Prisma no modela triggers, así
que desaparece la deriva. Los índices GIN sí se declaran en el esquema, con `type: Gin` y `map:`
explícito para conservar los nombres descriptivos.

Verificado: `migrate diff` entre la base y el esquema devuelve migración vacía.

### Límite de insistencia como restricción de base de datos

```sql
CREATE UNIQUE INDEX seguimiento_una_secuencia_activa_por_telefono
  ON seguimiento (telefono, paso) WHERE estado = 'programado';
```

Cada secuencia aporta exactamente una fila por paso, así que la unicidad sobre `(telefono, paso)`
entre las programadas permite los tres pasos de **una** secuencia y bloquea una segunda. Va en la
base y no solo en la aplicación porque un bug de reintentos que mande varios mensajes comerciales
en una tarde es un riesgo de bloqueo del número (RN-09.9.7).

`@@unique([conversacionId, paso])` cubre lo demás: rearmar la secuencia no puede duplicar envíos.

## Verificación

- Extensiones creadas, trigger activo, cinco tablas y los seis campos comerciales.
- El trigger indexa con lematización en español y **encuentra sin tildes**: un fragmento con
  "Ecografía Doppler con preparación de ayuno" responde a `plainto_tsquery('spanish', 'ecografia
  doppler')`.
- Borrado en cascada de fragmentos al eliminar el artículo.
- `migrate diff` sin diferencias.
- Suite completa: 164 pruebas en verde.

## Módulo `conocimiento`

CRUD de artículos con su ciclo de vida completo (crear · publicar · archivar · reactivar ·
eliminar borradores), troceado, recuperación léxica y la cola de preguntas sin respuesta.
Dos permisos nuevos: `conocimiento.ver` —que también recibe el perfil Asistente— y
`conocimiento.editar`, que cambia lo que el bot le responde a los pacientes.

**Troceado** por encabezados de markdown primero, porque el cliente entrega la documentación
con un título por servicio (P6) y ese corte respeta el sentido. Solo si una sección excede el
máximo se parte por párrafos, con solape, para no cortar una indicación de preparación por la
mitad. Las medidas van en palabras y no en tokens: no hay tokenizador en el backend y traer uno
por esto no se justifica.

**Cada fragmento se indexa con el título del artículo.** Un fragmento suelto de una sección
larga pierde de qué habla, y el modelo recibe el texto sin saber de dónde salió.

**Publicar reindexa en la misma transacción, sin cola.** Con la capa léxica no hay nada que
encolar: trocear e insertar es trabajo síncrono de milisegundos y el `tsvector` lo pone el
trigger. La cola vuelve a hacer falta cuando entre la capa semántica, que sí depende de un
proveedor externo.

### El puntaje es cobertura de términos, no `ts_rank`

`ts_rank` devuelve un número sin unidades que nadie puede razonar. La cobertura —qué porcentaje
de los lexemas de la pregunta aparece en el fragmento— se puede discutir con el cliente y
calibrar: un umbral de 62 significa "el fragmento cubre al menos dos tercios de lo que preguntó
el paciente".

### Dos correcciones que solo aparecieron con la base delante

**`plainto_tsquery` une los términos con AND.** La primera versión no recuperaba nada: bastaba
con que faltara una palabra de la pregunta para descartar el fragmento. Los lexemas se unen
ahora con OR y es la cobertura la que puntúa; el prefiltro solo tiene que traer candidatos.

**El lematizador no unifica derivaciones entre categorías gramaticales.** `preparo` da `prepar`
y `preparación` da `preparacion`. Se cubre comparando lexemas por trigramas por encima de 0,35
—las variantes reales quedan entre 0,35 y 0,50, y las palabras sin relación no pasan de 0,25.
Medidas y límites en `docs/adr-a8-recuperacion-conocimiento.md`.

Ninguna de las dos la habrían detectado las pruebas unitarias: el SQL solo se ve con PostgreSQL
delante. De ahí que la recuperación tenga e2e propias.

### Límite conocido

Los sinónimos quedan fuera de alcance: «abren» contra «atendemos» da 0,09 de similitud y «vale»
contra «precio» da 0,00. Ningún ajuste del índice léxico los alcanza. El disparador para pasar a
la capa semántica es concreto: que la cola de preguntas sin respuesta se llene de preguntas que
**sí** están cubiertas por un artículo, pero con otras palabras.

## Pruebas

- **31 unitarias** sobre las piezas puras: troceado, temas prohibidos, umbral y agrupación de
  preguntas sin respuesta.
- **13 e2e contra PostgreSQL** sobre lo que solo se ve con la base delante: recuperación con y
  sin tildes, escalamiento por falta de cobertura, tema prohibido que gana sobre el puntaje,
  borrador que no se sirve, archivado que saca del índice en el acto conservando la ficha,
  reactivación a borrador, borrado restringido y reindexado al editar.
- Un tema prohibido **no** entra a la cola de mejora: no se resuelve escribiendo un artículo.

## Pendiente en esta fase

Herramientas `buscar_conocimiento` y `consultar_servicio` en el orquestador · migración del
contenido de `documentacion_comercial` a artículos · extensión de la cola de RN-09.8 a los tres
pasos · `@Delete` de servicios con su restricción y los efectos en cadena · bloque de interesados
en la bandeja · pantalla de conocimiento en el backoffice · golden set.

## Nota de operación

`prisma migrate dev` se quedó colgado tras aplicar la migración, en el chequeo de deriva contra la
base sombra. `prisma migrate deploy` aplica sin base sombra y `prisma migrate diff` comprueba la
deriva sin bloquearse; conviene usar esos dos en esta máquina.
