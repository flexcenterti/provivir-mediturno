# RN-04.6 · Anticipación mínima de agendamiento

**Origen:** retroalimentación del cliente sobre el prototipo desplegado (septiembre de 2026). No
está en la Lógica de Negocio v2.0; se registra aquí para mantener la trazabilidad del resto de
reglas.

**Estado:** implementada (fase 11).

**Extiende:** RN-04, que define servicios, cupos y la oferta de horarios.

---

## Por qué

El paciente que se agenda solo no puede tomar un cupo de hoy. La agenda del día ya está
comprometida cuando abre la mañana: hay pacientes en sala, retrasos que se arrastran y huecos que
el mostrador reasigna sobre la marcha. Un cupo que el portal ve libre a las 10:00 puede no existir
a las 10:05, y el paciente que lo tomó ya salió de casa.

La restricción es de **canal, no de calendario**: la sede sí agenda para hoy, porque tiene delante
al paciente y ve el estado real de la sala.

Antes de esta regla no había ninguna validación de fecha en el sistema: se podía agendar hoy y
**también en fechas pasadas**, por los tres canales. El `min` del selector del portal era el único
freno, y un atributo HTML no es una garantía.

---

## Regla

**RN-04.6.1** · Los canales de **autoservicio** —portal público y bot de WhatsApp— solo pueden
ofrecer y agendar a partir de la **primera fecha agendable**, que por defecto es mañana.

**RN-04.6.2** · La primera fecha agendable es `hoy en la sede + agendamiento_anticipacion_dias`.
El parámetro es configurable (Administración → Reglas); con `0` la regla queda apagada y hoy
vuelve a ser agendable, sin desplegar nada.

**RN-04.6.3** · El **backoffice no está sujeto a la regla**. El personal en sede agenda para hoy
como siempre: un paciente que llega al mostrador necesita atención el mismo día.

**RN-04.6.4** · El rechazo dice **desde cuándo sí se puede**, no "no hay horarios". Son cosas
distintas y confundirlas manda al paciente a probar otras fechas sin entender qué pasó.

**RN-04.6.5** · "Hoy" es el día **en la sede** (Cali, UTC−5), no el del servidor ni el del
navegador del paciente.

---

## Dónde vive

La invariante está en el motor (`citas.service.ts`), único punto que gobierna reglas de
agendamiento (Arquitectura §6, ADR A3). Se comprueba en dos sitios:

| Punto | Qué cubre |
|---|---|
| `cupos()` | la oferta: ningún canal de autoservicio ve horarios de una fecha que no puede tomar |
| `validarCupo()` | la creación y la reprogramación, dentro de la transacción: cubre que el bot confirme sin haber consultado antes |

Las funciones puras `primeraFechaAgendable` y `cumpleAnticipacionMinima` viven en
`citas.reglas.ts` y no tocan reloj ni zona horaria: reciben "hoy" como parámetro.

El canal se declara con una opción de servicio, `{ autoservicio: true }`, que fijan
`portal.service.ts` e `ia.service.ts`. **No viaja en ningún DTO**: si el navegador pudiera
enviarla, podría desactivar la regla.

## Lo que NO se hizo

**No se metió la regla en el prompt del bot ni en la base de conocimiento (RN-13).** El motor
rechaza y el mensaje llega al modelo como resultado de la herramienta, que es el camino por el que
ya viajan RN-01 a RN-04. Una regla escrita en el prompt sería una sugerencia, no una invariante, y
divergiría entre canales (ADR A3).

Sí se le inyecta al prompt la **primera fecha agendable como dato**, junto al "Hoy es …" que ya
existía. Sale del mismo parámetro que usa la validación, así que no puede desactualizarse, y evita
que el bot le prometa al paciente un horario de hoy antes de consultar.

## Parámetro

| Clave | Defecto | Qué hace |
|---|---|---|
| `agendamiento_anticipacion_dias` | `1` | Días de anticipación exigidos al portal y a WhatsApp. `1` = solo desde mañana. `0` apaga la regla. No aplica al personal en sede. |

## Pendiente de confirmar con el cliente

- ¿La reprogramación que hace el propio paciente debe seguir la misma regla? Hoy la sigue, por
  consistencia de canal.
- ¿Algún servicio necesita más anticipación que el resto (por ejemplo procedimientos con
  preparación)? El parámetro es hoy global, no por servicio.
