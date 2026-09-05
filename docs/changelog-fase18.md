# Changelog · FASE 18 — Rediseño de la bandeja de la asistente

**Estado:** en rama `fase-18-bandeja-dos-paneles`. 312 unitarias (API) + 58 (shared) +
341 e2e + 42 de navegador.

## Por qué

El cliente: **«la interfaz de gestión de conversaciones es muy compleja, según lo
manifiestan los usuarios»**, con una captura de WhatsApp Web como modelo — *«cubre todo
lo que necesitamos pero con mejor orden»*.

Era una tabla de seis columnas y un modal que la tapaba entera. El problema concreto: para
leer un hilo había que abrir un modal que ocultaba la lista, y para pasar al siguiente
había que cerrarlo. Y la tabla no mostraba lo único que la asistente quiere ver de un
vistazo —**qué acaba de decir el paciente**— pese a que la API ya lo devolvía en cada
fila y la pantalla nunca lo pintaba.

## Lo que hay ahora

Dos paneles. La lista siempre a la izquierda, el hilo a la derecha. **Ningún estado de
esta pantalla abre un overlay.** Chips de filtro sobre la lista, con «Solo las mías»
convertido en chip y las fechas plegadas tras el suyo.

**«Interesados sin agendar» deja de ser una tabla aparte y pasa a ser un chip más.** Al
pulsarlo la lista muestra los interesados; al elegir uno se abre su conversación a la
derecha, como cualquier otra. «Escribirle yo» desaparece como botón porque la fila entera
ya hace eso: 19 acciones pasan a 18 sin perder ninguna capacidad.

La fila tiene tres líneas: prioridad y nombre arriba, **el último mensaje en medio**,
motivo y quién atiende abajo.

## RN-05.3 cambia, y es una decisión de negocio

Los pendientes se ordenaban por prioridad y, dentro de ella, por quien llevaba más
esperando. **Ahora se ordenan por actividad reciente**, como WhatsApp.

**Quien escribe tres veces adelanta a quien lleva dos horas en silencio.** Antes no podía
pasar. Se tomó a sabiendas, con una contrapartida que forma parte de la regla: **la
etiqueta de prioridad va siempre visible, la primera de la fila**. Desde que el orden no
la codifica, ese chip es la única señal que queda — si se cae del diseño, la prioridad
deja de existir de hecho. El tiempo de espera sigue en cada fila y sigue poniéndose rojo
a los 30 minutos (RN-08.3); lo que ya no hace es decidir el orden.

**Sin denormalizar.** `@@index([conversacionId, ts])` ya existía, que es justo el índice
de un `LEFT JOIN LATERAL` con el último mensaje: el filtro se queda en Prisma y el orden
en SQL, porque `orderBy` no sabe ordenar por el máximo de una relación. Se descartó una
columna `ultimoMensajeTs` porque hay **cinco** sitios que crean mensajes y una segunda
verdad con cinco escritores se desincroniza sola.

El `COALESCE` con `creado_en` no es adorno: desde la fase 16 una asistente puede abrir un
hilo vacío con «Escribirle», y sin él se hundiría al fondo el mismo día que lo crea.

`ordenarPendientes` y `compararPendientes` se retiran con su parte del spec.
`inicioDeEspera` y `esperaEnMinutos` se quedan: alimentan el dato que se pinta.

## Tiempo real, y la sala que estaba abierta

`socket.io-client` llevaba desde la fase 3 en el `package.json` **sin que nadie lo
importara**, mientras el backend emitía a la sala `backoffice` en cada mensaje entrante y
solo la TV escuchaba. Ahora hay un socket único para toda la consola y el evento
`bandeja-pendientes` se usa como **pulso, no como dato**: no trae contenido, pero lo
emiten los nueve sitios que cambian algo, así que sirve para «vuelve a mirar» — incluido
lo que hace otra asistente en otra pestaña, que antes no se veía hasta el siguiente
sondeo. El `setInterval` se queda de red de seguridad, a 60 s con el socket en pie y a 20
sin él: los minutos de espera avanzan sin que nadie emita nada.

**Y se cerró la sala.** `suscribir-backoffice` no validaba nada, y por ahí viaja
`llamado`, que lleva el **nombre del paciente**: cualquiera que alcanzara el servidor
podía escucharlos. El agujero ya existía; lo urgente es que esta fase convierte esa sala
en infraestructura de uso diario. Ahora exige token en el handshake, rechaza los de
refresco, comprueba que el usuario esté activo y exige `bandeja.operar` — resuelto contra
la base, no contra el token, para que desactivar a alguien surta efecto sin esperar a que
caduque su sesión. `suscribir-pantalla` no se toca: la TV no tiene sesión que ofrecer.

## Cuatro cosas que se arreglan de camino

- **El buscador mandaba peticiones inválidas.** `q` tiene `@MinLength(3)`, así que teclear
  una sola letra devolvía 400 y la pantalla pintaba un error rojo mientras escribías.
  Ahora hay debounce de 300 ms y mínimo de tres caracteres.
- **No había desplazamiento automático** al último mensaje. Ahora sí, y con criterio: al
  cambiar de hilo salta al final, pero cuando llega un mensaje nuevo solo baja **si ya
  estabas al día**. Si estás leyendo historial aparece una píldora en vez de arrancarte la
  vista — sin eso, el refresco en vivo sería hostil.
- **Enter no enviaba.** Ahora sí, con `Shift+Enter` para saltar de línea y respetando
  `isComposing`: con teclado de acentos, Enter confirma la palabra que se está componiendo
  y habría enviado el mensaje a medias.
- **El chat no separaba los días**: todos los mensajes llevaban solo la hora.

Y uno de presentación: `ultimoMensaje` salía de `contenido`, que es nulo en un audio o una
imagen. Ahora usa `transcripcion ?? contenido` y la interfaz respalda con el tipo, para
que la fila no se quede muda justo cuando acaba de llegar algo.

## La semilla no tenía conversaciones

Verificado: el seed creaba sede, configuración, usuarios y catálogo, y **ni una
`Conversacion`, ni un `Mensaje`, ni un `Seguimiento`**. Por eso las dos pruebas que
tocaban la bandeja solo comprobaban el cromo y **ninguna abría un hilo**.

Ahora hay cuatro conversaciones con tiempos **relativos a `Date.now()`** —con fechas
fijas, la que hoy lleva 90 minutos esperando lleva semanas el mes que viene—: una con la
ventana abierta y mensajes de ayer y de hoy, otra con cuatro días de silencio, una cerrada
y reabierta, y una que el bot llevó solo. Más un interesado con su secuencia a medias.

Usan los **últimos** pacientes por documento, no los primeros: los primeros los usan las
pruebas de citas, y una de ellas comprueba justamente que a ese paciente «nunca le llegó
nada por WhatsApp». Darle conversación la rompía — y la rompió, hasta que se cambió.

## Lo que enseñaron las mutaciones

Diez, todas matan. Las de la lógica pura —el título cuando no hay ficha, el umbral de los
30 minutos, la comparación del «tú», el día natural frente a restar 24 h, el resto de
horas— y las cuatro del handshake: aceptar el token de refresco, no exigir el permiso, no
mirar si el usuario está activo, y dejar entrar a todos.

Una de ellas no contaba: cambiar la comparación del «tú» a `true` no la mató la prueba
sino el compilador. Se repitió invirtiendo el operador, que sí compila, y entonces sí.

Dos fallos propios de camino, los dos de la misma clase —cosas que compilan y fallan en
ejecución—: el cast a `uuid[]` cuando Prisma mapea `String @default(uuid())` a **TEXT**, y
unos backticks dentro de un comentario SQL que cerraban el template literal y dejaban
media clase fuera. Solo los caza una prueba que llegue a la base.

## Siete pruebas de navegador nuevas

Antes **no había ninguna** que abriera una conversación. Ahora se cubre: que abrir no tapa
la lista y no hay ningún `.modal`; que se pasa de un hilo al siguiente sin cerrar nada;
que se distingue quién escribió cada mensaje; los separadores de día; la ventana de 24 h
cerrada —que cubre `situacion()`, la máquina de estados más delicada de la pantalla y
hasta hoy sin una sola prueba—; el chip de interesados de punta a punta; y que «Tomar»
se refleja **en la fila de la lista**, que es la prueba de que el refresco cruzado
funciona.

Sin cobertura de websocket en Playwright, a propósito: exigiría dos contextos y un webhook
simulado, sería cara y escamosa, y la red del `setInterval` hace que un socket roto
degrade a lo de antes, no a algo peor. Lo que sí se cubre, y es barato, es que la sala
dejó de ser pública.

## Al desplegar

**Sin migración y sin parámetros nuevos.**

**Aviso operativo:** la pantalla cambia de arriba abajo y las asistentes la usan todos los
días. Conviene enseñársela antes, no después: el modal desaparece, la tabla desaparece, y
los interesados dejan de estar debajo para ser un chip.

## Lo que queda abierto

- **El límite «una plantilla al día» y el resto de reglas de WhatsApp** no se tocan.
- **«Solo las mías» sigue filtrando en cliente** sobre la página actual. Es inofensivo en
  Pendientes, donde caben 100 por página, y el estado vacío lo dice cuando hay más de una.
  Arreglarlo de verdad son ~6 líneas: `mias?: boolean` en el DTO.
- **P4 sigue pendiente**: quién es «prioridad alta» lo decide el bot al escalar. Ese
  pendiente era la razón de la regla de orden anterior; ahora es la razón de que la
  etiqueta importe tanto.
- **Por debajo de 760 px de contenedor** la pantalla pasa a master–detail: o la lista o el
  hilo, con un botón para volver. No está probado en navegador.
