# Changelog · FASE 15 — Constancia de cobro en el mostrador

**Estado:** en verde, sin desplegar. 308 unitarias (API) + 39 (shared) + 296 e2e + 25 de navegador.

## Por qué

Pregunta del cliente sobre el ciclo del paciente en el mostrador: llega, lo buscan, se
determina que debe pagar; si paga pasa a esperar, y si no paga se cancela o se reagenda.

Al mirarlo, **no existía absolutamente nada de cobro**: ninguna de las 25 tablas
guardaba dinero, no había endpoint ni pantalla, y ni un solo campo monetario. Y no fue
un olvido — RN-07.1 lo sacó del software a propósito.

El problema era otro: **el software afirmaba que el pago había ocurrido**.
`registrarLlegada` escribía siempre en auditoría la cadena fija «Mostrador · pago en
recepción · prioridad X», hubiera pagado el paciente o no. Una frase hardcodeada sobre
dinero, escrita antes de que el sistema supiera nada de dinero.

Y el desenlace contrario no tenía salida: si el paciente no pagaba, el mostrador no
podía ni cancelar ni reagendar — el texto de la propia pantalla mandaba a la asistente
a otra vista, con el paciente delante.

## El alcance, decidido con el cliente

**Solo la constancia. Sin importes.** Se registra QUE se cobró, quién y cuándo; no
cuánto. Rechazado explícitamente: tarifario, medios de pago y arqueo de caja.

El motivo no es pereza: meter importes crea **una segunda verdad sobre el dinero** que
se desviaría de la contabilidad real de la clínica, y nadie la validaría. Hay una prueba
de navegador que falla si alguna vez aparece una cifra en el mostrador — si se cae, la
conversación es de producto, no de código.

Se descartaron también, con su razón:

- **Un estado intermedio «pendiente de pago».** El paciente está delante de la
  asistente: buscar, cobrar y registrar son un solo acto. Un estado nuevo habría tocado
  la cola, las pantallas de TV, el llamado, las métricas de espera y cinco listas de
  estados, para modelar una espera que en el mostrador no existe.
- **Construir el kiosko.** Sigue apagado; su dinámica es el pendiente P8, sin decidir.

## La regla

**La nota es obligatoria cuando el desenlace contradice la política del servicio.**

No cobrar un control no exige nada —la política ya es la razón— y eximir algo que se
cobra, sí. Y captura también la anomalía inversa, que es la que se olvida: **cobrar un
servicio sin costo** significa que o la política del catálogo está mal, o se cobró algo
que no tocaba.

La regla es pura y vive aparte (`cobro.reglas.ts`). **No puede estar en el DTO**:
`class-validator` ve el cuerpo aislado y no conoce el servicio; resolverlo con
`@ValidateIf` obligaría a que el cliente enviara la política — y entonces el cliente
puede mentir para saltarse la nota.

**El tercer desenlace no existe a propósito.** Si el paciente no paga, no se crea turno:
la ausencia del turno *es* la constancia. Queda escrito en la regla con esas palabras,
porque es lo primero que alguien querrá añadir como estado `no_pago`.

## Dónde se guarda, y por qué no en la cita

En el **turno**. La cita existe desde que el bot la crea, días antes: un campo de cobro
ahí estaría en `null` para cientos de citas futuras, y ese `null` es una invitación
permanente a leerlo como «pendiente de pago» — justo el estado que se descartó. El turno
**es** el acto del mostrador, y se escribe en la transacción que ya existía, así que la
llegada y su constancia son atómicas por construcción.

`null` significa **no consta**, no «no se cobró»: son las llegadas anteriores a la regla,
y será también el kiosko. Rellenarlas con `cobrado` sería inventar un hecho sobre dinero.

**Se guarda quién cobró**, y no solo en auditoría: ese servicio traga sus propios fallos
por diseño —«perder una cita es peor que perder una línea de auditoría»— y un registro
declaradamente con pérdidas no puede ser el único de algo contiguo al dinero.

## La pantalla sigue siendo un clic

El desenlace viene marcado según la política del servicio, así que en el camino normal
la asistente no toca nada: pulsa «Registrar llegada» y ya. La nota aparece **solo** al
contradecir la política, en la misma fila, con el botón deshabilitado hasta escribirla.

Bajo el nombre del servicio hay un texto derivado solo de la política —«Sin costo
(RN-01.2)» o «Con costo · tarifa en recepción»—, **nunca una cifra**.

Y el código de la cita abre la ficha de siempre, con cancelar y reprogramar: con eso el
«no pagó» se resuelve sin salir del mostrador. Antes había que irse a Agenda
consolidada.

## `politicaCosto` deja de ser inerte, y eso destapó un defecto

Hasta hoy no decidía nada: dos sitios la leían, solo para componer texto. Al empezar a
decidir apareció que **el catálogo real nunca la declaró**: los 21 servicios cayeron en
`costo_pleno` por defecto, **incluido el control**, que por RN-01.2 no tiene costo. No
se notó durante meses precisamente porque el campo no hacía nada; en cuanto el mostrador
lo lee, diría que el control se cobra.

Tres piezas, las tres necesarias:

1. **El campo pasa a obligatorio** en la interfaz del catálogo. Ponerlo solo en el
   control dejaría la trampa armada para el próximo servicio.
2. **Una migración acotada** corrige los datos (`WHERE tipo='control' AND
   politica_costo='costo_pleno'`, idempotente y sin pisar decisiones tomadas a mano).
   **No vale reejecutar el cargador**: borra y recrea en bloque todas las agendas de
   esos profesionales y se llevaría por delante los horarios ajustados desde el
   backoffice.
3. **Una prueba** lo fija, sobre la constante y no sobre la base — contra la base
   pasaría igual gracias al default de Prisma, que es justo cómo se coló el defecto.

**`porcentaje` sale del desplegable** y se queda en la base. Nunca se implementó: no hay
dónde guardar el porcentaje ni sobre qué tarifa aplicarlo. Inofensivo mientras el campo
no decidía nada; ahora significaría «cobra» sin poder decir cuánto.

**Efecto sobre el bot, comprobado: mínimo.** El control es `agendable: false`, así que el
bot nunca ofrece agendarlo; solo pasa a tener el dato correcto si alguien pregunta si
tiene costo. Y no hay ningún `rangoPrecio` en la base, así que no aparece cifra alguna.

## Y el arreglo a medias de la fase 13

`Turno.citaId` es único, y `registrarLlegada` rechazaba si existía **cualquier** fila de
turno, mirara o no su estado. Al reprogramar, el turno queda `cancelado` y la cita vuelve
a `confirmada` — pero el día bueno el mostrador seguía respondiendo «la llegada ya fue
registrada». **A un paciente al que le mueven la cita no se le podía registrar la llegada
nunca**, y la fila ni le ofrecía el botón: veía un turno y pintaba «Reimprimir ticket».

En la fase 13 se arregló el estado de la cita, con una prueba cuyo comentario decía «si
se quedara en `llego`, el martes el mostrador no podría registrarlo». Se arregló esa
mitad, y la prueba comprobaba solo esa mitad.

Ahora se reutiliza la fila en vez de levantar el índice único —convertir `Cita.turno` en
una lista tocaría el buscador, el ticket, los tipos del cliente y la cola—, limpiando
`llamadoTs`, que un turno cancelado puede arrastrar porque también se cancela desde
`llamado`. El cobro se vuelve a pedir con el anterior a la vista.

## Pruebas, y lo que enseñaron las mutaciones

Ocho unitarias de la tabla de verdad, nueve de integración del cobro, tres del
reingreso, dos del catálogo y tres de navegador.

**Cinco mutaciones**, y dos de ellas encontraron pruebas que no probaban nada:

- **Quitar la obligatoriedad del DTO no se detectaba.** Con el campo opcional el 400
  seguía saliendo —por la regla de la nota, no por la validación— y la prueba, que solo
  miraba el código de estado, pasaba igual. Ahora distingue la causa: `class-validator`
  devuelve una lista de mensajes; las reglas del servicio, una cadena.
- **No limpiar `llamadoTs` al reactivar tampoco.** En la primera versión de la prueba
  nadie había llamado al paciente, así que la aserción pasaba trivialmente. Ahora el
  turno se cancela desde `llamado`, que es el caso real.

Las otras tres —invertir la condición de la nota, devolver la cadena fija de auditoría,
y mirar el estado equivocado al reactivar— se cazaron a la primera.

## Al desplegar

**Dos migraciones**, separadas para poder revertir una sin la otra: los cuatro campos de
la constancia, y la corrección del control.

**Aviso operativo:** `cobro` es obligatorio, así que una pestaña del backoffice abierta
durante el relevo recibirá un 400 al registrar una llegada. Basta recargar; conviene
avisar a recepción si se despliega en horario de atención.

## Lo que queda abierto

- **Qué otros servicios no tienen costo.** Hoy solo el control. Si la clínica tiene
  jornadas de promoción o convenios, hay que marcarlos — es una pregunta para ellos.
- **Cierre del día**, que sigue sin existir. Es lo que impide bloquear un segundo
  llamado con uno sin finalizar, y lo que define el ausentismo.
- **El kiosko**, apagado. El diseño ya deja el hueco: crearía el turno con `cobro` en
  `null` y la caja lo completaría escribiendo los mismos cuatro campos.
