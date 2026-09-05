# RN-07.6 · Constancia de cobro en el mostrador

**Estado:** implementada (fase 15). Extiende RN-07 sin contradecirla.

## El problema

RN-07.1 describe el flujo real —*pay-per-view*— así: «el paciente llega → **paga en
recepción (mostrador)** → registro de llegada → sala de espera», y remata: «no hay
turno intermedio de pago». El pago ocurre, por diseño, **antes del primer evento que el
software observa**.

Eso está bien. Lo que no estaba bien es que el software **afirmara** que había
ocurrido: `registrarLlegada` escribía siempre en auditoría la cadena fija «Mostrador ·
pago en recepción · prioridad X», hubiera pagado el paciente o no. Una frase
hardcodeada sobre dinero, escrita antes de que el sistema supiera nada de dinero.

Y faltaba el desenlace contrario. Si el paciente no paga, la cita se cancela o se
reagenda — y el mostrador no podía hacer ninguna de las dos cosas.

## RN-07.6

1. **Toda llegada registra qué pasó con el cobro**: `cobrado` o `exento`. Se guarda en
   el turno, con quién lo resolvió y cuándo.
2. **Sin importes.** La plataforma registra la decisión, no el dinero. No hay
   tarifario, ni medio de pago, ni recibo, ni arqueo. **El mostrador nunca muestra una
   cifra que el sistema posea.**
3. **El tercer desenlace no existe.** Si el paciente no paga, **no se registra la
   llegada**: se cancela o se reprograma la cita desde el propio mostrador. **La
   ausencia de turno es la constancia de que no pagó**, y el motivo de cancelación
   dice por qué. No añadir un estado `pendiente_pago`: eso es un estado de la cola, y
   se descartó a propósito.
4. **La nota es obligatoria cuando el desenlace contradice la política del servicio.**

   | `politicaCosto` | `cobrado` | `exento` |
   |---|---|---|
   | `sin_costo` | **nota** | sin nota |
   | `costo_pleno` / `porcentaje` | sin nota | **nota** |

   No cobrar un control no exige nada: la política ya es la razón. Cobrarlo sí, y esa
   es la anomalía que más interesa ver — significa que o la política del catálogo está
   mal, o se cobró algo que no tocaba.
5. **Nada bloquea el registro salvo la nota faltante.** Si la política del catálogo
   está equivocada, la asistente registra igual dejando nota. Corregir el catálogo es
   asunto de administración, no del paciente que está esperando delante.
6. **La excepción queda como entrada propia en auditoría** (`Excepción de cobro`), no
   solo dentro del texto del registro de llegada: «quién eximió a quién y por qué» es
   una consulta, no una búsqueda de cadenas.

## Por qué en el turno y no en la cita

La cita existe desde que el bot la crea, días antes. Un campo de cobro ahí estaría en
`null` para cientos de citas futuras, y ese `null` es una invitación permanente a
leerlo como «pendiente de pago» — justo el estado que se descartó. El turno **es** el
acto del mostrador, y se escribe en la transacción que ya existía, así que la llegada y
su constancia son atómicas por construcción.

Consecuencia asumida: si al paciente se le mueve la cita, el cobro anterior queda en la
llegada anulada y **se le vuelve a preguntar a la asistente**, con el dato anterior a la
vista. El sistema no sabe si la clínica devolvió, aplicó o volvió a cobrar; afirmarlo
sería justamente la segunda verdad sobre el dinero que esta regla evita.

## `null` no significa «no se cobró»

Significa **no consta**: son las llegadas anteriores a esta regla, y será también el
kiosko. Rellenar esas filas con `cobrado` sería inventar un hecho sobre dinero.

## Qué decide `politicaCosto`, y qué no

Hasta ahora no decidía nada. Pasa a decidir **exactamente dos cosas**: qué desenlace
viene preseleccionado en el mostrador, y si la nota es obligatoria.

**No decide nada del motor de agendamiento.** No se lee en `citas.service`, ni en
`cupos()`, ni en el intercalado (RN-01.5), ni en el balanceo (RN-02), ni en la
anticipación (RN-04.6). Ninguna política impide agendar nada.

`porcentaje` **nunca se implementó**: no hay dónde guardar el porcentaje ni sobre qué
tarifa aplicarlo. Se retira de la interfaz y se conserva en la base; se comporta como
costo pleno. Implementarlo de verdad es el tarifario, que se descartó.

## Cómo encaja el kiosko

La pieza reutilizable es `registrarLlegada` entera: el kiosko creará el mismo turno,
con el mismo `llegadaTs`, entrando en `en_espera`. Lo único que cambia es que la
llegada y el cobro dejan de ser el mismo acto, y eso ya está resuelto porque **`cobro`
es nullable con significado**: el kiosko lo crea en `null` y la caja lo completa
escribiendo los mismos cuatro campos.

**No es un estado nuevo de la cola.** El paciente ya está en espera, la prioridad y el
llamado funcionan igual, y la ausencia de constancia se puede pintar como un distintivo
sin tocar el orden.

## Lo que queda abierto

- **Qué otros servicios no tienen costo.** Hoy solo el control. Si la clínica tiene
  jornadas de promoción o convenios, hay que marcarlos.
- **Cierre del día.** Sigue sin existir, así que un paciente que se marcha deja su
  turno abierto. Es lo que impide bloquear un segundo llamado con uno sin finalizar.
