# Changelog · FASE 13 — Retomar conversaciones, modificar citas y buscar en el mostrador

**Estado:** en verde, sin desplegar. 292 unitarias (API) + 39 (shared) + 265 e2e + 19 de navegador.
Va encima de la fase 12, que tampoco está desplegada.

## Por qué

Tres huecos que salieron al operar la plataforma ya desplegada. Los tres tienen la misma forma:
**el motor sabe hacerlo y la interfaz no lo expone**, o hay una pieza construida a medias.

---

## 1 · Ver y reabrir las conversaciones cerradas

Una conversación resuelta desaparecía para siempre. El filtro de la bandeja estaba cableado a
`{ escalada: true, resueltaTs: null }`, `GET /bandeja` no aceptaba ni un parámetro, y **no existía
ninguna transición que saliera de `resuelta`**: `resueltaTs` nunca volvía a nulo. Si el paciente
volvía a escribir, `obtenerOCrear` abría un hilo nuevo sin historial. Si llamaba por lo mismo de la
semana pasada, no había forma de leer qué se le había dicho.

Ahora hay pestaña de cerradas, con buscador por teléfono, nombre o documento, rango de fechas y
paginación. **Sin parámetros devuelve exactamente lo de antes**, en el mismo orden. El sondeo de
20 s se queda solo en pendientes: en el histórico nada corre, y recargar le movería la lista a
quien está leyendo.

### Se reabre la misma fila

En vez de crear una conversación nueva enlazada. Lo que se busca es continuidad, y así
`obtenerOCrear` vuelve a encontrar este hilo si el paciente responde, **sin tocar el camino
caliente del webhook**.

Queda `en_gestion` y a nombre de quien la reabre. `procesar()` corta al bot en ese estado: si
volviera a `ia_activa`, el bot y la persona contestarían a la vez sobre el mismo hilo. Reabrir es
un acto deliberado — quien reabre es quien va a atender.

**No depende de la ventana de 24 h.** La ventana decide qué se puede *enviar*, no si se puede
retomar; atarlas dejaría conversaciones imposibles de recuperar.

### Lo que NO se toca al reabrir, y por qué

`escalada` y `escaladaTs`. `metricas.service.ts` cuenta `resueltasPorIa` y `escaladas` sobre el
**estado actual**, no sobre una foto: pisarlos habría inflado las escalaciones de un mes ya
reportado. De ahí `reabiertaTs`, campo propio, que además es el reloj operativo — una reabierta que
contara desde su escalamiento original aparecería con tres días de espera en el mismo minuto en que
se reabre, y empujaría al final de la lista a quien lleva esperando desde esta mañana.

El filtro de pendientes pasa a `{ resueltaTs: null, OR: [{ escalada }, { reabiertaTs }] }`, así una
conversación que resolvió el bot solo y una asistente reabre sí aparece. Estaba **duplicado
literalmente** entre el listado y el conteo; ahora es una constante, para que la burbuja y la lista
no puedan decir números distintos.

### La carrera con `obtenerOCrear`

Si el paciente escribe justo mientras se reabre, quedarían dos conversaciones sin resolver para su
número y el historial partido en dos sin que nadie se entere. La transacción comprueba antes del
`update` que no exista otro hilo vivo y, si lo hay, responde **409 con su id** para que la interfaz
navegue a él.

*(El índice único parcial que lo cerraría del todo queda pendiente: exige auditar y limpiar
duplicados en producción, donde el worker de entrantes corre con `concurrency: 4`.)*

### El seguimiento comercial no revive, y es lo correcto

`seguimiento.service.ts` cancela la secuencia si hay `tomadaPor`, que es justo lo que pone la
reapertura. Si hay una persona hablando, la plataforma no le escribe encima. Queda dicho en un
comentario para que nadie lo «arregle» dentro de seis meses.

## 2 · Responder ya no revienta con la ventana vencida

La ruta `POST /bandeja/:id/responder` **no consultaba la ventana**. Meta rechazaba con `#131047`,
nadie capturaba, y la asistente veía un **500 crudo**; el mensaje no se persistía y la conversación
quedaba sin tomar, porque el «tomar implícito» iba *después* del envío.

Ahora el orden es **validar ventana → tomar → enviar → persistir**, y fuera de ventana sale un 409
que dice qué hacer, con registro en auditoría igual que un recordatorio descartado. El detalle de
la ventana viaja en `GET /bandeja/:id` para que la pantalla lo diga **antes** de que la asistente
redacte: enterarse al pulsar enviar es enterarse tarde.

### `#131047` deja de confundirse con un token vencido

`postear()` convertía cualquier `!r.ok` en un `Error` genérico. Es el único rechazo con una salida
concreta —mandar una plantilla— así que ahora se distingue (`FueraDeVentanaMeta`). Es la red de
seguridad, no el mecanismo principal: la comprobación previa puede desincronizarse con un entrante
todavía en la cola o un desfase de reloj.

Detalle que no es menor: `enviar()` lo reenvía tal cual. Envolverlo en `DestinatarioSinTelefono`
haría que quien lo recibe escalara a una persona en vez de ofrecer la plantilla, que es lo que sí
resuelve el caso.

### Un solo sitio decide si la ventana sigue abierta

El cálculo estaba en dos sitios con criterios distintos, y el de los recordatorios comparaba el
teléfono **por igualdad exacta**: un paciente con el número guardado como `3001234567` que
escribiera desde `+573001234567` no se detectaba nunca dentro de la ventana, así que su
recordatorio se descartaba siempre. `VentanaService` busca con `variantesDeTelefono()` y sobre
todas las conversaciones del número, que es como Meta la cuenta. `ventana-meta.ts` sigue siendo la
función pura, sin Prisma.

## 3 · La plantilla de reapertura

Clave nueva `plantilla_reapertura_conversacion`. **No reutiliza las tres que había**: su contrato
es rígido —cuatro variables posicionales código/servicio/fecha/hora— y una reapertura no tiene cita
que meter en esas cajas.

Lleva **una sola variable**, el nombre; con más, el riesgo de cruzarlas es el mismo que ya avisa
`parametrosTicket()`. Sin nombre, el respaldo es «de nuevo», que encaja en la misma frase:

    Hola María, te escribimos de…      ← con nombre
    Hola de nuevo, te escribimos de…   ← sin él

Cualquier genérico del tipo «paciente» delata que la clínica no sabe con quién habla, y «hola» de
respaldo daría «Hola hola». Meta rechaza los parámetros vacíos y con saltos de línea, así que el
respaldo no es cortesía: es lo que evita que falle el envío con quien escribió antes de
identificarse, que es el caso normal en un primer contacto.

**La plantilla no abre la ventana** — la abre la respuesta del paciente. La pantalla lo dice con
esas palabras, o la asistente enviaría la plantilla y a continuación intentaría escribir.

Con la ventana abierta el envío se rechaza (las plantillas se pagan, y Meta penaliza usarlas donde
vale el texto libre), y hay un límite de una al día por conversación: si no contesta a la primera,
insistir no lo cambia y a Meta le consta como spam.

## 4 · Quién atiende qué

`Conversacion.tomadaPor` guardaba un id de usuario **suelto, sin relación con la tabla de
usuarios**, así que la bandeja no podía resolver el nombre: la lista solo pintaba «En gestión» y el
aviso de conflicto decía «otra asistente ya tomó esta conversación» **sin poder decir cuál**.

Peor: `Mensaje` **no tenía campo de autor**, y por el mismo `enviar()` salen los mensajes del bot,
los de la asistente, los recordatorios y los de seguimiento. En el chat era imposible distinguir
qué escribió el bot y qué una persona, ni cuál.

Ahora la columna dice «En gestión · Marcela R.», hay filtro «solo las mías» —resuelto en el
cliente: la lista ya está en memoria— y cada mensaje saliente lleva firma: el nombre de la
asistente, «Asistente virtual» o «Automático». Los 1.762 salientes históricos se quedan sin autor:
no hay de dónde reconstruirlo, y atribuirlos a alguien sería inventárselo.

La clave foránea entró sin riesgo — comprobado antes en producción: 146 conversaciones con
`tomada_por` puesto y **ninguna huérfana**. Obliga a que sea un usuario de verdad, lo que rompió una
prueba que escribía el rótulo `'asistente'`.

### Devolver a la bandeja

Con los nombres a la vista se hace evidente un atasco que ya existía: quien tomaba un hilo y se iba
lo dejaba **bloqueado para todas las demás**, porque `tomar()` rechaza a cualquier otra persona y no
había forma de soltarlo. Vuelve a `escalada`, no a `ia_activa`: sigue necesitando a una persona.

---

## 5 · Cancelar y mover citas desde el backoffice

`PATCH /citas/:id/reprogramar` y `/cancelar` existían desde la fase 2, revalidaban todas las reglas
y estaban auditados — y **no tenían ni un botón**. El resultado era que **el bot de WhatsApp podía
cancelar una cita y la asistente no**.

La ficha se abre desde la agenda consolidada y desde el buscador del tablero, que es la vía rápida
para llegar a una cita sin saber su fecha. Los cupos los ofrece el motor, igual que al crear: la UI
no calcula reglas.

**«Eliminar» es cancelar.** La pantalla lo dice con esas palabras: la fila se conserva porque la
auditoría, las métricas y el historial del paciente dependen de ello. No hay borrado físico en
runtime y no debe haberlo.

### El aviso al paciente lo decide la asistente

Casilla marcada por defecto; cuando la quita, **queda en auditoría que fue decisión suya**. El
envío va por la cola de recordatorios para heredar la ventana, la plantilla y el descarte con
auditoría, que ya estaban escritos. No va en la transacción: que WhatsApp esté caído no puede
impedir cancelar una cita.

`ticketCancelacion` llevaba desde la fase 4 escrita y **sin que nadie la llamara**. Hizo falta
`ticketReprogramacion` nueva: `avisoReprogramacion` es la de RN-06.3 —«necesitamos reprogramar,
respóndenos»— y *pide* algo; aquí no hay nada que pedir, hay datos nuevos que apuntar.

La reprogramación reutiliza `plantilla_confirmacion_cita`: sus cuatro variables son exactamente los
datos nuevos. La cancelación estrena `plantilla_cancelacion_cita`, porque mandar la de confirmación
diría lo contrario.

### Cuatro defectos de consistencia

**El turno huérfano era el grave.** Ni cancelar ni reprogramar tocaban el `Turno`, y `cola()` filtra
solo por el estado del turno: **un paciente con la cita cancelada seguía en la lista de espera y
podía ser llamado a consultorio**. Ahora se cierra como `cancelado`, valor nuevo del enum — no
`ausente`, que significa «se le llamó y no vino» y contarlo así ensuciaría el ausentismo con
cancelaciones administrativas. Con el paciente ya dentro de consulta no se deja tocar la cita.

**Reprogramar no restauraba el estado.** Una cita en `llego` movida al mes siguiente seguía en
`llego`, y el día bueno `registrarLlegada` la rechazaba porque solo acepta
`pendiente_llegada|confirmada`: el paciente se presentaba y el mostrador no podía registrarlo.

**Cancelar aceptaba citas ya `atendida`** —solo bloqueaba `cancelada`— así que se podía borrar de
las estadísticas de atención a alguien que sí vino.

**El motivo pisaba `observacion`**, llevándose por delante lo que hubiera anotado quien agendó.
Ahora va en `motivoCancelacion`, con el precedente de `Seguimiento.motivoCancelacion`.

### Y el fallo de fecha que dejó anotado la fase 11

`fechaEnZona()` sobre una fecha ya almacenada la corre un día hacia atrás: el recordatorio de una
cita del 21 anunciaba el **20**. Se corrige aquí y no aparte porque ese mismo objeto alimenta ahora
también los avisos de cancelación y de reprogramación — sin tocarlo, el fallo saldría en dos
mensajes más.

---

## 6 · El mostrador busca antes de registrar

Era un solo campo a ciegas con una heurística —«si son solo dígitos, es un documento»— así que
buscar por nombre mandaba el apellido como código de atención y devolvía 404. Si el paciente tenía
dos citas hoy, el motor elegía la más temprana **sin decírselo a nadie**. Y cualquier fallo era un
404 o un 400 genérico: la recepcionista no podía saber si el problema era la cita, el día o que ya
estaba hecho.

Ahora se busca primero y se ve a quién se va a registrar. La lista dice en cada fila qué se puede
hacer: registrar la llegada, reimprimir el ticket si ya la tenía, o por qué no se puede. La llegada
se registra con el código exacto, así que el motor ya no elige por su cuenta.

Reutiliza `GET /citas/buscar`, que ya buscaba por código, documento y nombre y ya tenía cliente:
solo le faltaban el teléfono y un rango de fechas. El mostrador pide las de hoy, porque traer 50
citas de cualquier fecha obliga a encontrar la buena entre las del mes pasado, con el paciente
esperando delante.

**El ticket ya no se pierde.** Vivía solo en el estado de React y desaparecía al atender al
siguiente paciente, así que un atasco de la impresora dejaba al paciente sin nada. Se rearma desde
la cita, que ya traía su turno: no hizo falta endpoint nuevo.

Y `window.print()` deja de mandar la aplicación entera a la impresora: no había ninguna regla
`@media print`. Ocultar la barra lateral no bastaba —el `grid` seguía desplazando el contenido
240 px— así que la maquetación se deshace además de esconderse.

**El kiosko no se toca.** Son 44 líneas de marcador de posición sin servicio ni base de datos:
encenderlo no habilitaría nada. Sigue apagado, como pidió el cliente (D3).

## 7 · La cola de sala exigía un permiso que no se aplicaba

`GET /turnos` no llevaba `@Permisos`: `turnos.ver` estaba declarado en el catálogo y **no se exigía
en ninguna ruta**, así que cualquier usuario autenticado veía la cola del día con nombres y
apellidos de los pacientes en sala.

Comprobado en producción antes de exigirlo: los cuatro perfiles base lo traen, no hay perfiles
personalizados, y los usuarios sin perfil caen al perfil base de su rol (`permisosDe`). Nadie se
queda sin la cola.

---

## Dos detalles que aparecieron por el camino

**`variantesDeTelefono()` no sirve para un buscador.** Espera un identificador ya normalizado; con
texto libre mete la **cadena vacía** entre las variantes, y `telefono IN ('')` casaría con cualquier
paciente sin teléfono. Su propio comentario avisa del riesgo por otra puerta. Tanto la bandeja como
el buscador de citas van por subcadena de dígitos.

**Filtrar por rango de fechas lo que se guarda como instante.** Recortar el ISO
(`toISOString().slice(0,10)`) compara en UTC: en la sede, todo lo ocurrido después de las 19:00 se
atribuiría al día siguiente y desaparecería del filtro. `inicioDelDiaEnZona` / `finDelDiaEnZona`
viven en `shared`, con el límite superior expresado como el inicio del día siguiente para no
dejarse fuera el último segundo.

## Pruebas

Nueve e2e de la bandeja, ocho de las citas, ocho del buscador y del permiso, siete unitarias del
orden y del reloj de espera, seis de fecha y zona, cuatro de los rechazos de Meta, y dos de
navegador.

**Las piezas nuevas se comprobaron contra mutaciones**, no solo escribiendo la prueba: dejar el
turno sin cerrar tumba dos, quitar la restauración del estado tumba otra, cambiar el código de
error a uno inexistente tumba dos, borrar el reenvío de `FueraDeVentanaMeta` tumba una, quitar la
búsqueda por teléfono tumba una y quitar el permiso de la cola tumba otra.

Una de esas mutaciones encontró un agujero real: el **segundo paso** del cálculo de zona horaria no
lo cubría ninguna prueba. Hace falta en una zona por delante de UTC que además cambie la hora, así
que se añadió el caso de Auckland — verificado aparte con `Intl` antes de fijarlo.

## Al desplegar

**Dos migraciones.** Ambas añaden columnas y valores de enum; ninguna borra ni reescribe datos.

- `reabierta_ts`, `reaperturas`, índice sobre `resuelta_ts`, `mensaje.autor_id`, las dos claves
  foráneas hacia `usuario` y `TipoMensaje += plantilla`.
- `cita.motivo_cancelacion` y `EstadoTurno += cancelado`.

Las claves foráneas validan contra las 227 conversaciones y los 1.762 mensajes existentes:
comprobado que no hay huérfanos.

**Claves de configuración nuevas**, ambas vacías, que aparecen solas por la reconciliación al
arrancar: `plantilla_reapertura_conversacion` y `plantilla_cancelacion_cita`. Las cuatro anteriores
estrenan descripción en Administración → Reglas, donde salían como identificador crudo justo en la
pantalla en la que el cliente tiene que escribir el nombre aprobado en Meta.

## Lo que queda pendiente

- **Las plantillas de Meta.** Todo el camino de plantilla —reapertura y cancelación— **nace
  inerte** hasta que el cliente las apruebe en su Business Manager. Ya son cinco: recordatorio de
  24 h, del día, confirmación, cancelación (4 variables) y reapertura (1 variable). El código está
  listo y la pantalla lo dice en vez de fallar en silencio.
- **`no_asistio`** sigue sin escribirse nunca: el KPI de ausentismo será 0 mientras no exista la
  acción. Se dejó fuera a propósito.
- **El índice único parcial** sobre `conversacion(telefono) where resuelta_ts is null`, que cerraría
  del todo la carrera de la reapertura.
- **El simulador de WhatsApp · IA** del prototipo sigue sin construirse.
