# Changelog · FASE 7 — Base de conocimiento y seguimiento comercial

**Estado:** en curso. Esquema de datos listo y migrado; 164 unitarias en verde.

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

## Pendiente en esta fase

Módulo `conocimiento` (CRUD, troceado, búsqueda híbrida, archivado transaccional) · herramientas
`buscar_conocimiento` y `consultar_servicio` · migración del contenido de
`documentacion_comercial` a artículos · extensión de la cola de RN-09.8 a los tres pasos ·
`@Delete` de servicios con su restricción · bloque de interesados en la bandeja · golden set.

## Nota de operación

`prisma migrate dev` se quedó colgado tras aplicar la migración, en el chequeo de deriva contra la
base sombra. `prisma migrate deploy` aplica sin base sombra y `prisma migrate diff` comprueba la
deriva sin bloquearse; conviene usar esos dos en esta máquina.
