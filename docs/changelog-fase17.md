# Changelog · FASE 17 — Una cita por día agendándose solo

**Estado:** en rama `fase-17-una-cita-por-dia`. 316 unitarias (API) + 39 (shared) +
335 e2e + 35 de navegador.

## Por qué

Petición del cliente: *«un paciente solo puede auto agendar una cita por día, para otras
citas debe llamar a la asistente»*, con un caso concreto de ese mismo día — un paciente
con dos citas, dos médicos, a las 7 y a las 8.

Al mirarlo en producción no era un caso, eran **tres**, y el peor no era el que contaba:

| Paciente | Citas | Canal |
|---|---|---|
| Dominga Arizala | **07:00 con una médica y 07:00 con otro médico** | portal, las dos |
| Carlos A. Buitrago | 07:00 y 08:00, dos médicos | bot, las dos |
| Marlon venté Banguera | 07:30 y 07:45, mismo médico | bot, las dos |

**Dos citas a la misma hora exacta**, imposibles de atender las dos. Y **dos de los tres
casos los produjo el bot**, no el portal: una regla que solo mirara el portal habría
dejado fuera la mayoría.

Nada lo impedía, y no por descuido: el motor valida el solapamiento **por prestador**
(RN-04), no por paciente. Dos médicos distintos son dos agendas distintas y ninguna sabe
de la otra.

## Encajó donde ya había sitio

No hizo falta inventar el mecanismo. `OpcionesAgendamiento.autoservicio` existe desde la
fase 5 y su comentario ya decía exactamente lo que hacía falta: *«el paciente actúa solo,
sin asistente que lo corrija: portal público y bot de WhatsApp»*. Ya gobierna la
anticipación mínima (RN-04.6) y los servicios no agendables por autoservicio. La regla
nueva es la tercera de esa familia y comparte la misma frontera de canal.

## Las tres decisiones que había que tomar

**Cuenta cualquier cita viva de ese día**, no solo las que se puso él. Si la asistente le
agendó un control el martes y el paciente se autoagenda otra el martes, acaba con dos —
que es justo lo que la regla evita. El límite es del canal, no del paciente: mostrador y
backoffice siguen poniendo las que hagan falta, porque ahí sí hay alguien valorándolo.

**`cancelada` no cuenta.** Cancelar y volver a agendar el mismo día es justamente lo que
el paciente tiene que poder hacer solo. Todo lo demás sí, incluida `atendida`: volver por
la tarde es una conversación con una asistente, no un formulario.

**Se dice antes de ofrecer horarios.** El portal pintaría doce horas y las rechazaría las
doce; en el bot es peor, porque el modelo le negocia al paciente una cita que no puede
existir. Para eso `OpcionesAgendamiento` gana `pacienteId`: la consulta de cupos es
pública y no lo lleva en su DTO, así que lo aporta el canal desde la sesión del portal o
desde el hilo de WhatsApp. Sin paciente conocido la regla no se aplica y los horarios se
miran igual — exigir identificarse para curiosear la agenda sería un paso nuevo por una
regla que no es suya, y `crear()` la revalida de todos modos.

## El lock, que es la mitad del arreglo

Comprobar no bastaba. Dos citas a la misma hora con médicos distintos es la firma de dos
envíos simultáneos, y `lockPrestadorFecha` no los serializa: prestadores distintos son
llaves distintas y las dos transacciones no se ven. Una comprobación fuera de la
transacción las dejaría pasar las dos, porque ambas contarían cero.

Lock nuevo **por paciente y fecha**, dentro de la transacción, y tomado **siempre el
primero de los tres** —paciente, prestador, fecha— para que el orden sea total y no pueda
haber interbloqueo.

## Lo que enseñaron las mutaciones

Ocho, y **dos encontraron pruebas mías que no probaban nada**:

- **La prueba de concurrencia pasaba con el lock quitado.** Usaba un prestador `'jr'` que
  no existe en la semilla, así que el segundo intento fallaba por «prestador no
  encontrado» y la prueba veía «una creada, una rechazada» sin que el lock hubiera hecho
  nada. Ahora usa un prestador real y afirma **las dos mitades**: que una salió y que la
  otra se rechazó.
- **La excepción de canal no estaba probada.** La prueba del mostrador no pasaba
  `pacienteId`, así que quedaba exenta por no saber a quién contar, no por ser un canal
  con asistente. Con la guarda mutada a todos los canales seguía en verde. Ahora hay una
  variante con el paciente puesto y sin `autoservicio`.

Y una tercera, de montaje: `const auto = { autoservicio: true, pacienteId }` capturaba
`pacienteId` en `undefined`, porque el cuerpo del `describe` corre antes del `beforeAll`.
La regla no se aplicaba y dos pruebas pasaban sin probar nada. Ahora es una función.

Las otras cinco se cazaron a la primera: `>` en vez de `>=`, contar las canceladas, no
excluir la cita que se está moviendo, validar solo en `crear()` y no en `cupos()`, y
quitar el lock del paciente.

## Dos arreglos colaterales en las pruebas del portal

`portal.e2e-spec.ts` **solo limpiaba al final del fichero**, así que las citas se
acumulaban entre pruebas. Era inocuo hasta ahora; con esta regla, la cita que deja una
prueba bloquea el agendamiento de la siguiente. El orden no debería haber importado
nunca: ahora se limpia antes de cada una.

Y `/identificar` está limitado a 8 por minuto **a propósito** —es la superficie por la que
se enumeraría pacientes—. El fichero hacía nueve llamadas contando las nuevas, y la última
prueba fallaba con un 429 que no tenía nada que ver con lo que probaba. Ahora el bloque de
agendamiento comparte una sola sesión.

## Al desplegar

**Sin migración y sin parámetros nuevos.** Es lógica pura más un lock.

**Aviso operativo real:** a partir del relevo, un paciente que ya tenga cita ese día
**no podrá agendarse otra ni por el portal ni por WhatsApp**, y verá «Ya tienes una cita
ese día. Para agendar otra el mismo día, comunícate con una asistente y te ayudamos a
coordinarlo.» Conviene que recepción lo sepa, porque las llamadas que eso genere llegan a
ellas — que es exactamente lo que el cliente pidió.

## Lo que queda abierto

- **La cita doble que ya existe.** Luciana Álzate tiene dos el martes 8 (13:00 y 14:00,
  misma psicóloga, puestas por el bot con un minuto de diferencia). **No se toca**: la
  regla es hacia adelante y esa cita ya está confirmada. Hay que llamarla.
- **El límite es uno y está en el código**, no en configuración. Si la clínica quiere dos
  para algún servicio, es un parámetro nuevo y una conversación de producto.
