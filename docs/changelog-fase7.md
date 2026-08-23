# Changelog · FASE 7 — Base de conocimiento y seguimiento comercial

**Estado:** backend completo. RN-13, RN-09.9 y RN-04.5 implementadas; falta el frontend. **231 unitarias y 171 e2e en verde**.

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

## Herramientas del orquestador

Dos herramientas nuevas, de ocho a diez en el inventario.

**`buscar_conocimiento(pregunta, servicioId?)`** · para todo lo que no es agendamiento.
Cuando la base no cubre la pregunta **no devuelve texto**, devuelve `accion: "escalar"` con el
motivo. Es la diferencia entre que el modelo reciba un "no sé" que pueda parafrasear y que reciba
una orden. Lo mismo con los temas de RN-13.4: el modelo nunca ve el contenido, solo la instrucción
de pasar a una persona.

**`consultar_servicio(servicio)`** · ficha completa desde el catálogo, por id o por nombre. Es la
única fuente válida para cifras. `listar_servicios` se conserva: devuelve el catálogo; esta
devuelve el detalle de uno.

**Trazabilidad (RN-13.7.3):** el mensaje saliente guarda `kbArticulosUsados` y `kbScore`. Cuando
el bot responde mal se va al artículo culpable en vez de discutir sobre el prompt.

**Prompt:** un bloque nuevo obliga a consultar antes de responder preguntas informativas y a
escalar cuando la herramienta lo indique. El texto lo dice sin rodeos: *una respuesta aproximada
sobre una preparación o un precio le cuesta el viaje al paciente; decir "déjame confirmarlo con
una asistente" no le cuesta nada.*

El bloque `documentacion_comercial` sigue inyectándose mientras la base se llena de artículos, tal
como prevé RN-13. Se retira cuando el contenido esté migrado.

**6 e2e nuevas** sobre el doble del modelo: pregunta cubierta con su trazabilidad, falta de
cobertura que ordena escalar sin entregar fragmentos, tema prohibido que hace lo mismo, la ficha
del servicio con las cifras del catálogo (el Doppler ocupa 2 espacios) y un servicio inexistente
que devuelve `encontrado: false` en vez de inventarlo.

La prueba que fijaba el inventario en «8 herramientas» pasó a comparar la lista de nombres: si
alguien agrega o quita una, el fallo dice cuál.

## Migración de la documentación comercial

`configuracion.documentacion_comercial` se parte en artículos publicados. El formato que ya
entrega el cliente —bloques `**Título** — cuerpo` separados por línea en blanco— se reconoce tal
cual, y también se aceptan encabezados markdown: el cliente manda lo que tenga.

**Idempotente por título.** Se puede correr tras cada entrega de contenido sin duplicar nada.

**Ante ambigüedad no se vincula el servicio.** «Medicina general» coincide con Consulta y con
Control, que tienen duración y costo distintos; atarlo al equivocado haría que el bot cite cifras
que no son y que RN-04.5.4 marque para revisión el artículo que no toca. El artículo se recupera
igual —lo único que se pierde es el vínculo— y la importación lo reporta para que un humano lo
resuelva en medio minuto. «Ecografía» tampoco se queda con el bloque de «Ecografía Doppler».

**Lo que no encaja no se pierde:** un párrafo sin título reconocible se pega al bloque anterior, y
el texto suelto anterior al primer título se conserva como «Información general».

### El prompt cambia solo

`documentacion_comercial` se inyecta **únicamente mientras la base esté vacía**. En cuanto hay
artículos publicados, esa información se recupera por pregunta y repetirla entera en cada
conversación sería pagar sus tokens para nada. El parámetro **no se borra**: si se archivaran todos
los artículos, el bloque vuelve solo. Eso hace la migración reversible sin tocar código.

El prompt tiene ahora tres variantes: sin documentación (P6 pendiente), con el bloque inyectado, y
con la base de conocimiento disponible.

### Se descartó el comando CLI

Se escribió primero como comando de consola, siguiendo el patrón de `datos-demo`. Arrancar el
contexto completo de Nest desde la consola cuelga el proceso —levanta colas, websockets y el
cliente de Meta, nada de lo cual hace falta— y `tsx` además no emite `emitDecoratorMetadata`, del
que depende la inyección de dependencias.

Quedó como endpoint (`POST /conocimiento/importar`, permiso `conocimiento.editar`), que además es
mejor sitio: la importación es una acción de administración con reporte visible, y queda auditada
con el usuario real en vez de con la etiqueta `cli`.

## Seguimiento comercial (RN-09.9)

Tres mensajes a las 2 h, 5 h y 8 h desde el último mensaje de la conversación, para el paciente que
preguntó por un servicio, recibió el ofrecimiento y no agendó. **Activo por defecto**
(`seguimiento_comercial_activo = true`), por decisión del equipo.

### Los textos son plantillas, no los compone el modelo

La regla original decía que el orquestador los compondría con las herramientas de RN-13. No se
sostiene: **el cliente tiene que aprobar estos textos** (D-d), y un texto distinto cada vez no se
puede aprobar. Un mensaje comercial que sale solo hacia un paciente real no es el lugar para
descubrir qué se le ocurrió al modelo. Las cifras siguen saliendo del catálogo.

### Revalidación completa antes de cada envío

El worker solo despierta y pregunta; la decisión de enviar la toma el servicio, que vuelve a
comprobarlo todo. **Las condiciones que cancelan se evalúan antes que las que difieren:** no tiene
sentido reprogramar un envío que de todos modos no debía salir.

Dos correcciones que salieron al probar contra la base:

- **La ventana de 24 h se cuenta desde el último mensaje del paciente**, que es donde Meta la abre,
  no desde que se armó la secuencia. En producción se parecen; de la diferencia depende que el
  mensaje pueda salir como texto libre.
- **La pregunta correcta es si la persona ya tiene su cita**, no si la sacó después de armarse la
  secuencia. A quien ya la tenía tampoco hay que escribirle. La comprobación faltaba además al
  armar: se podía perseguir a alguien que ya tenía cita de antes de la conversación.

### Diferir es mover la fecha, no cambiar de estado

La fila sigue en `programado` cuando se difiere por horario, porque el índice único parcial que
limita la insistencia cuenta ese estado; sacarla de ahí abriría hueco para una segunda secuencia.
El valor `diferido` del enum quedó sin uso por esa razón.

### La tabla es la fuente de verdad, no Redis

Al arrancar, el módulo vuelve a encolar lo que quedó programado. Si se pierde la cola —reinicio,
purga, cambio de instancia— los envíos no se evaporan y nadie queda a medias de una secuencia.

### Pruebas

**22 unitarias** de horario y textos: la zona de la sede manda sobre la del servidor, un envío
nocturno se difiere, el domingo salta al lunes, un horario sin días hábiles no cuelga, el cierre no
lleva pregunta y cada mensaje tiene un solo llamado a la acción.

**14 e2e** con el envío ya programado, que es el estado en el que se descubre el problema en
producción: respondió, ya tiene cita **creada desde el portal**, opt-out posterior al armado,
conversación tomada por una asistente, servicio desactivado, fuera de horario (difiere), fuera de la
ventana de 24 h (descarta), y una condición de corte que gana sobre el diferimiento.

Una prueba obligó a corregir el primer mensaje: hacía **dos** preguntas y la regla pide un solo
llamado a la acción.

## Gobierno del catálogo (RN-04.5)

Ficha comercial en los DTO, `@Delete` con su restricción, baja y alta con efectos en cadena, y un
endpoint de impacto para consultar qué arrastra una baja **antes** de decidirla.

### La cascada vive en el servicio, no en el endpoint

El backoffice ya editaba `activo` desde el formulario del catálogo, así que atar los efectos en
cadena al endpoint dedicado habría dejado un camino por el que se desactiva un servicio sin cancelar
sus seguimientos ni marcar sus artículos. `actualizar()` detecta la transición y dispara la cascada
venga por donde venga. Por eso `activo` se conserva en el DTO de actualización en lugar de sacarlo.

### No se puede eliminar lo que tiene historia

Un servicio con citas no se elimina: borrarlo arrancaría su nombre del historial de esos pacientes
y de la auditoría. La clave foránea lo impediría igual, pero se comprueba antes para poder explicar
por qué en vez de devolver un error de base de datos. Sin citas sí se borra, soltando primero los
vínculos que no son historia de nadie (prestador-servicio y artículos).

### Auditoría que distingue lo que importa

Un cambio de duración, cupos o `requiereOrden` se registra con el antes y el después y marcado como
**no retroactivo**; un cambio de descripción, no. Quien revise la auditoría busca lo primero.

**14 e2e:** la duración cambia sin tocar las citas ya agendadas, un servicio con citas no se elimina
y sin citas sí, desactivar conserva las citas y cancela seguimientos y marca artículos, la cascada
ocurre también desde el PATCH del formulario, el impacto se consulta sin cambiar nada, y un servicio
desactivado desaparece de la oferta del bot pero sigue existiendo para el historial.

## Pendiente en esta fase

Solo frontend y calibración: pantalla de conocimiento en el backoffice, bloque de interesados en la
bandeja (el endpoint `GET /bandeja/interesados` ya existe), edición de la ficha comercial en el
formulario del catálogo, y el golden set con la calibración del umbral.

**Requieren decisión:** fusionar a `main` y desplegar —hasta entonces ningún paciente recibe nada—,
la aprobación de los textos por el cliente (D-d) y su contenido (P6 real, P12 aprobado, P13). El
umbral de 62 es **una hipótesis**: calibrarlo necesita preguntas reales del número de prueba.

## Nota de operación

`prisma migrate dev` se quedó colgado tras aplicar la migración, en el chequeo de deriva contra la
base sombra. `prisma migrate deploy` aplica sin base sombra y `prisma migrate diff` comprueba la
deriva sin bloquearse; conviene usar esos dos en esta máquina.
