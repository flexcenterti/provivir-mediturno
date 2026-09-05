# RN-10.5 · Una cita por día agendándose solo

**Estado:** implementada (fase 17). Extiende RN-10 y comparte mecanismo con RN-04.6.

## El problema, medido

El 2026-09-05, en producción, **tres pacientes tenían dos citas ese mismo día**:

| Paciente | Citas | Canal |
|---|---|---|
| Dominga Arizala | **07:00 con una médica y 07:00 con otro médico** | portal, las dos |
| Carlos A. Buitrago | 07:00 con un médico y 08:00 con otro | bot, las dos |
| Marlon venté Banguera | 07:30 y 07:45, mismo médico | bot, las dos |

El primero es el que da la medida: **dos citas a la misma hora exacta con dos médicos
distintos**, imposibles de atender las dos, puestas desde el portal por la misma persona.
Y dos de los tres casos los produjo el bot de WhatsApp, no el portal — la regla no puede
ser solo del portal.

Nada lo impedía. El motor valida el solapamiento **por prestador** (RN-04), no por
paciente: dos médicos distintos son dos agendas distintas y ninguna sabe de la otra.

## RN-10.5

1. **Agendándose solo, una cita por día.** Para una segunda el mismo día, el paciente
   tiene que llamar y que una asistente valore si de verdad hacen falta dos visitas.
2. **El límite es del canal, no del paciente.** Mostrador y backoffice ponen las que
   hagan falta: ahí hay alguien mirándolo. Se aplica donde el paciente actúa solo —
   portal y bot—, que es la misma frontera que ya usa RN-04.6.
3. **Cuenta cualquier cita viva de ese día**, la haya puesto él, el bot, la asistente o
   el mostrador. Lo que se evita es que acabe con dos sin que nadie con criterio lo haya
   mirado, y da igual por qué puerta entró la primera.
4. **`cancelada` no cuenta.** Cancelar y volver a agendar el mismo día es justamente lo
   que el paciente tiene que poder hacer sin llamar. Todo lo demás sí, incluida
   `atendida`: si ya vino esta mañana y quiere volver esta tarde, eso es una
   conversación con una asistente, no un formulario.
5. **Se dice antes de ofrecer horarios**, no al confirmar. El portal pintaría doce horas
   y las rechazaría las doce; en el bot, el modelo le negociaría al paciente una cita
   que no puede existir.
6. **Reprogramar cuenta igual**: mover una cita a un día donde ya hay otra es agendarse
   dos por la puerta de atrás. La cita que se mueve se excluye de la cuenta, o no podría
   cambiar de hora dentro de su propio día — que es la reprogramación más común que hay.

## El lock, y por qué no bastaba con comprobar

Dos citas **a la misma hora con médicos distintos** es la firma de dos envíos a la vez.
`lockPrestadorFecha` no las serializa: prestadores distintos son llaves distintas y las
dos transacciones no se ven. Y una comprobación fuera de la transacción las dejaría pasar
las dos igual, porque ambas contarían cero.

Por eso hay un lock nuevo, **por paciente y fecha**, tomado dentro de la transacción. Se
toma **siempre el primero de los tres** —paciente, prestador, fecha— para que el orden sea
total y no pueda haber interbloqueo entre transacciones concurrentes.

## Dónde vive

El predicado, en `citas.reglas.ts` con su spec: `superaCitasDelDia(vivasEseDia)`, con `>=`
y no `>` porque se llama **antes** de crear la nueva. El resto —qué citas cuentan y quién
está exento— en el servicio, junto a RN-04.6 y a la validación de servicios no agendables,
que son sus dos hermanas y comparten `OpcionesAgendamiento.autoservicio`.

`OpcionesAgendamiento` gana `pacienteId`: la consulta de cupos es pública y no lo lleva en
su DTO, así que el canal lo aporta desde la sesión del portal o desde el hilo de WhatsApp.
**Sin paciente conocido la regla no se aplica** y los horarios se pueden mirar igual:
exigir identificarse para curiosear la agenda sería un paso nuevo por una regla que no es
suya, y `crear()` la vuelve a aplicar de todos modos.

## Lo que NO cambia

El motor de cupos (RN-01 a RN-04) · el solapamiento por prestador · el intercalado
(RN-01.5) · el balanceo (RN-02) · la anticipación (RN-04.6) · el mostrador, el backoffice
y la reprogramación hechos por una asistente · las citas ya existentes, que no se tocan.

## Lo que queda abierto

- **El límite es uno y está escrito en el código**, no en configuración. Si la clínica
  quiere dos para algún servicio, es un parámetro nuevo y una conversación de producto.
- **Las citas dobles que ya existen** no se cancelan solas: la regla es hacia adelante.
  Hay que revisarlas a mano.
