# RN-04.7 · Servicios que solo agenda la asistente

**Origen:** revisión del cliente sobre el portal desplegado (septiembre de 2026), marcando qué
servicios no debe agendar el paciente por su cuenta.

**Estado:** implementada (fase 11).

**Extiende:** RN-04 (catálogo y oferta de cupos) y precisa RN-13.9, que ya marcaba servicios que
el bot describe sin ofrecer agendar.

---

## Por qué

No todo lo que la clínica presta se puede autoservir. Hay tres situaciones distintas y una misma
consecuencia:

- **Servicios que la clínica coordina a mano**: laboratorio clínico, rayos X, ecografías,
  droguería, valoración odontológica. Dependen de disponibilidad de equipo, de orden médica o de
  una preparación que alguien debe explicar.
- **El control de medicina general**: exige una consulta previa dentro de una ventana (RN-01), y
  elegir cuál es no es algo que el paciente resuelva desde un formulario.
- **Especialistas que vienen por fechas sueltas**, no en jornada semanal: ginecología,
  oftalmología, pediatría, urología, optometría, nutrición, traumatología. Sus fechas se confirman
  mes a mes.

Antes de esta regla el portal ofrecía todos los servicios por igual. Un paciente que elegía
laboratorio llegaba a una pantalla de horarios vacía, sin entender si no había cupo o si el
sistema estaba roto.

---

## Regla

**RN-04.7.1** · Un servicio marcado como no agendable **no se agenda por los canales de
autoservicio**: ni portal ni WhatsApp.

**RN-04.7.2** · **La asistente sí lo agenda**, desde el backoffice. Es exactamente para eso que se
marca: la restricción es de canal, no del servicio.

**RN-04.7.3** · El servicio **se sigue viendo** en el portal, con la nota de que se agenda con una
asistente. Ocultarlo haría creer que la clínica no lo presta.

**RN-04.7.4** · El marcador vive en el catálogo (`Servicio.agendable`), no en el código: la
clínica abre o cierra un servicio al autoservicio desde Backoffice → Catálogo, sin desplegar.

**RN-04.7.5** · El rechazo dice qué hacer — «Comunícate con una asistente y te ayudamos a
coordinarlo» — no «no hay horarios».

---

## Dónde vive

Reutiliza dos piezas que ya existían, sin inventar mecanismo nuevo:

| Pieza | Cuál |
|---|---|
| El marcador | `Servicio.agendable`, que RN-13.9 ya usaba para el bot. Ahora vale para todo el autoservicio |
| La distinción de canal | La opción `{ autoservicio: true }` de RN-04.6, que ya fijan `portal.service.ts` e `ia.service.ts` |

Se comprueba en `citas.service.ts` · `validarAgendablePorAutoservicio()`, llamada desde `cupos()`,
`crear()` y `reprogramar()`.

El portal recibe `agendable` en `GET /portal/servicios` y pinta esos servicios en la lista pero
sin permitir elegirlos, con la nota correspondiente.

**El bot no necesita nada nuevo:** `consultar_servicio` ya devolvía `agendable` (RN-13.9), y si
pide cupos igualmente, el motor lo rechaza con el mensaje y él lo comunica (ADR A3).

---

## Pendiente

- **Duraciones sin confirmar:** rayos X, droguería y valoración odontológica llevan valores
  provisionales; la clínica no los envió. No afectan a nadie mientras no tengan agenda, pero hay
  que fijarlos antes de que la asistente empiece a agendarlos.
- **Los servicios coordinados a mano no tienen prestador ni agenda.** Hoy son informativos: para
  que la asistente pueda agendarlos hay que dar de alta quién los realiza y su horario.
- **`mint` (medicina interna) tiene dos regímenes.** Henry Maya atiende en jornada semanal y se
  agenda solo; Jaime Trujillo viene por fechas. Como `agendable` es del servicio y no del
  prestador, el servicio queda agendable: hoy da igual porque Trujillo no tiene franja, pero
  cuando se le carguen fechas serán agendables por el portal. Confirmar con la clínica si eso está
  bien o si hay que separarlos en dos servicios.
