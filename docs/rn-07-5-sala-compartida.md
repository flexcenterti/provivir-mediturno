# RN-07.5 · Quién puede operar la cola de un profesional

**Estado:** implementada (fase 14). Extiende RN-07 sin contradecirla.

## El problema

RN-07.1 describe el flujo como «llamado **del prestador**», y de ahí se dedujo que la
pantalla de turnos era del médico y de nadie más: resolvía la cola por
`usuario.prestadorId`, el vínculo uno a uno entre una cuenta y su ficha (RN-06.2).

Eso deja fuera a la asistente, que es quien está en el mostrador viendo la sala. Y no
por una decisión, sino por un accidente: **una asistente no puede tener
`prestadorId`** —ese campo está reservado a `rol = prestador`— así que la pantalla
solo podía decirle que no.

## Lo que dice la regla, releída

RN-07.3 —«el llamado es automático al siguiente en cola; el prestador no elige
arbitrariamente a quién llamar»— es una restricción sobre **el criterio de
selección**, no sobre **quién pulsa**. Lo único que RN-07 atribuye explícitamente al
médico es la priorización con nota (RN-07.4), y tampoco la prohíbe a nadie más.

El catálogo de permisos ya lo decía sin ambigüedad desde la fase 6:

> `turnos.atender` · «Llamar al siguiente paciente, priorizar y dar por atendido.
> **Lo usan asistentes y médicos**.»

Y el perfil base Asistente lo trae. La regla nueva solo pone por escrito lo que el
permiso ya concedía.

## RN-07.5

1. **Puede operar una cola quien tenga `turnos.atender`**, sea o no el profesional
   titular. Llamar al siguiente, priorizar con nota y finalizar.
2. **El llamado es siempre a la cola de UN profesional.** No existe «llamar al
   siguiente de la sala»: `llamar-siguiente` exige el prestador, y sin él no se sabe
   a qué consultorio pasa el paciente. Quien opera desde la sala elige primero.
3. **Un médico solo ve su propia cola.** Es una restricción de la interfaz y de
   `GET /turnos`, no del permiso: el médico no necesita ver la sala entera y sus
   pacientes son datos de otros profesionales.
4. **Una cuenta de médico sin ficha no ve ninguna cola.** Antes recibía la sala
   completa por un descuido: el filtro quedaba en `undefined` y eso significa «todas».
5. **La cola es la del día**, en la fecha de la sede. Un turno abierto de ayer no
   aparece.
6. **Queda registrado quién pulsó, no solo para quién.** La auditoría guarda el
   usuario que llamó y el nombre del profesional en el detalle.

## Lo que NO cambia

- Las **pantallas de sala** se resuelven por el servicio de la cita (RN-11.1), no por
  quién pulsó. Un llamado disparado por la asistente sale idéntico, con el nombre del
  médico titular.
- El **orden** sigue siendo RN-05.2: prioridad y, dentro de ella, orden de llegada.
- La **nota del motivo** al priorizar sigue siendo obligatoria (RN-07.4). Que ahora
  pueda escribirla la asistente no la hace opcional.

## Por qué hace falta un cerrojo

Con dos personas sobre la misma cola, ambas leían la lista, resolvían el mismo
paciente y las pantallas lo llamaban dos veces. **Medido: sin cerrojo, seis llamados
simultáneos devuelven el mismo turno las seis veces.** No es un caso de laboratorio;
es lo que pasa con dos clics seguidos.

`llamarSiguiente` toma un advisory lock transaccional sobre la cola de ese profesional
y ese día, y lee la cola **dentro** de la transacción. Se prefirió a una actualización
condicional porque así la segunda persona obtiene el siguiente paciente, que es lo que
quería, en vez de un conflicto que no sabría interpretar.

## Lo que queda abierto

- **Nadie escribe nunca `ausente` ni `no_asistio`.** La única salida de un turno es
  finalizarlo. Por eso no se bloquea llamar a un segundo paciente con uno aún sin
  finalizar, que sería lo prolijo: el que no se presenta no tiene salida y la cola
  quedaría atascada. Va junto con el **cierre del día**, que es lo que define el
  ausentismo y todavía no existe.
- **El refresco es por sondeo de 15 s.** Con el cerrojo, ese desfase ya no puede
  causar el daño real —el doble llamado—, solo que la lista se vea un poco vieja.
