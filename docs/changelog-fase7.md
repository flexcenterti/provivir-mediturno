# Changelog · FASE 7 — Base de conocimiento y seguimiento comercial

**Estado:** completa salvo el golden set. **232 unitarias, 173 e2e de API y 9 de navegador en verde**.

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

## Frontend

Pantalla **Conocimiento** (artículos con su ciclo de vida, probador de preguntas, cola de preguntas
sin respuesta e importación), bloque **Interesados sin agendar** bajo las conversaciones escaladas
de la bandeja, y la **ficha comercial** en el formulario del catálogo con las advertencias de
impacto.

El probador va arriba del listado a propósito: es la pantalla donde se decide qué le responde la
plataforma a los pacientes, y lo primero que debe ofrecer es ver qué contestaría **antes** de que
la pregunta la haga alguien de verdad.

### Lo que encontraron las pruebas de navegador

Se escribieron 5 pruebas con Playwright sobre Chromium. Ninguno de estos fallos lo habrían
detectado el typecheck ni las pruebas de API, y dos son bugs de producto, no de las pruebas:

**El paquete compartido compilado estaba obsoleto.** `packages/shared/dist` era de dos días antes,
y la API resuelve `@provivir/shared` contra ese `dist`, no contra el código. Los dos permisos
nuevos **nunca llegaron a nada que se ejecute**: la pantalla cargaba y devolvía «No tiene permisos
para esta operación». Las suites pasaban igual porque jest sí mapea al fuente — es decir, **las
pruebas y lo que corre no coincidían**. El `Dockerfile.api` de producción sí compila `shared`
primero; el hueco era solo local, y el arranque de las pruebas de navegador ahora lo compila antes
del seed.

**Un permiso nuevo del catálogo no llegaba a instalaciones ya desplegadas.** `asegurarPerfilesBase`
no pisa los permisos de perfiles existentes —correcto, pueden haberlos ajustado— pero eso significa
que una función se despliega y nadie puede usarla, porque la fila del perfil se creó con la lista
de aquel día. Ahora el perfil de **acceso completo** se reconcilia: solo se **agregan** los que
falten, nunca se quita ninguno, y se avisa por log de los permisos que no tiene ningún perfil.
Había además **dos implementaciones** de esa función y ya habían divergido; `acceso.service.ts`
ahora delega en la del alta inicial.

**Detalles de interfaz que solo se ven mirando:** el informe de la importación —cuántos entraron y
cuáles quedaron sin servicio vinculado— lo pisaba un mensaje genérico; el `##` del markdown se
filtraba al mostrar un fragmento; `.p-check` se usaba sin estilo, así que las casillas del
formulario de servicios quedaban pegadas en la misma línea; y «Medicina general» se clasificaba
como *Información general* porque la regla de categoría hacía match con la palabra suelta
«general».

## Arnés de evaluación

`apps/api/evaluacion/casos.json` pasa de 31 a 46 casos: 15 de la base de conocimiento, en su
propia categoría `conocimiento`. Preguntas cubiertas (horarios, ubicación, formas de pago, qué
llevar, cancelación, cita de control), escalamiento obligatorio de RN-13.4 que todavía no estaba
representado (descuentos, facturación en disputa), y la pregunta que llega con el documento del
paciente adentro (RN-13.8).

**Dos cambios estructurales, sin los cuales los casos nuevos no medirían nada:**

**El prompt se arma como el del despliegue.** El arnés inyectaba la documentación comercial
porque así corría producción cuando se escribió. Desde esta fase el prompt no la lleva —el bot
recupera— y medir con el bloque adentro habría tapado justamente lo que RN-13 vino a comprobar:
el modelo recitaba y aprobaba sin llamar a `buscar_conocimiento`. `--sin-conocimiento` reproduce
la configuración anterior, que sigue siendo real mientras no se importe P6.

**Casos de segundo turno.** Un caso puede declarar `previo`: llamadas ya resueltas con el
resultado que devolvería el motor. Las dos reglas que más importan no se ven en el primer turno,
porque en el primero el modelo solo tiene que llamar a la herramienta:

- ante `accion: "escalar"` —sin cobertura o tema prohibido— escala en vez de responder igual;
- ante un fragmento con una cifra vieja, la cifra la pide con `consultar_servicio` (RN-13.1). El
  artículo del caso dice 30 minutos y el catálogo dice 15, que es exactamente cómo envejece un
  artículo sin que nadie lo note.

Los dos casos de obediencia son `critico: true`: bloquean el despliegue sin volver crítica a toda
la categoría, que hasta ahora era la única forma de expresarlo. Y `espera.argumentos` comprueba
los argumentos de una llamada —el documento que no debe viajar a la base, el motivo con que
escala—, no solo el texto de la respuesta.

**`npm run evaluar` estaba roto:** invocaba `ts-node`, que no es dependencia del repo (el resto
usa `tsx`). Nadie lo había notado porque el comando se corre a mano y con clave de OpenAI.

**Cómo se verificó, y qué falta.** El SDK de OpenAI respeta `OPENAI_BASE_URL`, así que probar el
arnés sin gastar llamadas cuesta un servidor de cuarenta líneas en el sitio del proveedor:
`apps/api/scripts/openai-doble.mjs`. Trae dos dobles porque un validador probado en una sola
dirección no distingue «está bien» de «es permisivo» — uno que siempre escala hace pasar los
casos de obediencia y fallar los de consulta, y uno que siempre responde en texto afirmando de
todo hace fallar los dos críticos con código de salida 1. Además registra las peticiones, y ahí
se comprobó que el historial que se le manda al modelo tiene la misma forma que arma
`ia.service.ts`.

Eso comprueba el arnés, no al modelo. **Línea base contra `gpt-5-mini`, 47 casos × 3
repeticiones (2026-08-23): 43/46 en la primera corrida completa, sin fallos críticos** —
`seguridad` 5/5, `privacidad` 3/3— y latencia mediana de 5,0 s. Los dos casos de obediencia pasan
las tres repeticiones, y ante el artículo que dice 30 minutos el modelo pide la ficha al catálogo
en vez de repetir la cifra.

**El único que falló era la expectativa, no el bot, y dos veces seguidas.**
`kb-mezcla-agendamiento` —una pregunta de preparación pegada a una intención de agendar— fallaba
1 de 3 por dos motivos distintos:

1. El modelo mencionaba el portal en texto y aplazaba la consulta, que es exactamente lo que
   RN-09.8 le ordena: «ese primer mensaje va en TEXTO, si ibas a consultar algo puede esperar al
   turno siguiente». El caso medía la contradicción entre dos reglas. Ahora declara
   `ofrecerWeb: false` —el portal ya se mencionó—; el arnés arma los dos prompts y elige por caso.
2. Con eso arreglado, el modelo preguntaba **cuál** ecografía antes de consultar. También es lo
   correcto: la preparación de abdomen (ayuno) y la pélvica (vejiga llena) son distintas, y buscar
   a ciegas habría dado una respuesta peor. El mensaje del caso era ambiguo, no el bot. Ahora
   nombra el servicio; la variante ambigua se queda en `servicio-preparacion`, donde lo único que
   se exige es no contestar el ayuno de memoria.

**Los tres fallos eran anotaciones mías, y el patrón se repitió.** En los tres, el modelo llamó a
una herramienta y no respondió nada de memoria; lo que fallaba era que el caso exigía *una*
herramienta concreta cuando la regla solo prohíbe responder sin ninguna:

- `factura` (1/3) consultaba la base antes de escalar. Pedir una factura no es una disputa, P13
  bien puede documentar cómo se solicita, y si no la cubre, RN-13.3 escala un turno después.
- `kb-mezcla-agendamiento` (2/3) llamaba a `listar_servicios`: el mensaje también pide cita, y
  resolver el servicio es un primer paso razonable.
- `kb-cifra-viene-del-catalogo` (2/3) llamaba a `listar_servicios`, que **también** devuelve
  `duracionMin`. Es el catálogo igual: RN-13.1 se cumple.

Las tres expectativas se relajaron a la regla, conservando lo que sí prohíben —contestar el ayuno
de memoria, prometer el envío de una factura, repetir la cifra del artículo—. Y como en un turno
de herramienta no hay texto que revisar, el `sinTexto` de la cifra no probaba nada: se añadió
`kb-cifra-responde-la-del-catalogo`, que entrega **las dos** llamadas ya resueltas —el artículo
dice 30, la ficha dice 15— y exige que la respuesta al paciente lleve la del catálogo. Ahí la
contradicción se resuelve de verdad, y son 47 casos.

**Una observación que no se convirtió en regla:** al preguntar cuál ecografía, el modelo enumeró
«abdominal, pélvica, transvaginal, obstétrica». En el catálogo solo existen `Ecografía` y
`Ecografía Doppler`, y no había llamado a ninguna herramienta: esos subtipos salen de su propio
conocimiento. Si el catálogo real no los presta, es inventar servicios. No se fija con una
expresión regular porque el catálogo del cliente puede traerlos; queda para mirarlo cuando entre
P2.

## Pendiente en esta fase

Golden set de 40-50 preguntas anotadas y calibración de `kb_score_min`. Necesita preguntas reales
del número de prueba: el 62 actual es una hipótesis, no un valor medido.

**Requieren decisión:** fusionar a `main` y desplegar —hasta entonces ningún paciente recibe nada—,
la aprobación de los textos por el cliente (D-d) y su contenido (P6 real, P12 aprobado, P13). El
umbral de 62 es **una hipótesis**: calibrarlo necesita preguntas reales del número de prueba.

## Nota de operación

`prisma migrate dev` se quedó colgado tras aplicar la migración, en el chequeo de deriva contra la
base sombra. `prisma migrate deploy` aplica sin base sombra y `prisma migrate diff` comprueba la
deriva sin bloquearse; conviene usar esos dos en esta máquina.
