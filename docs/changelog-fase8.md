# Fase 8 · Envíos proactivos y la ventana de 24 h de Meta

**Fecha:** 23 de agosto de 2026 · posterior al alcance original, como la fase 7.

## El hueco

Buscando qué faltaba para dar el desarrollo por terminado apareció esto: **los recordatorios de
cita salían como texto libre, y casi nunca podían salir.**

WhatsApp solo admite mensajes de formato libre dentro de las 24 h que abre el **último mensaje del
paciente**. Un recordatorio se envía 24 h y 3 h antes de la cita, casi siempre con la ventana ya
cerrada — y quien agendó en el mostrador o por el portal puede no haber escrito nunca. Meta lo
rechaza con `#131047`, BullMQ reintenta tres veces y el trabajo muere en la cola de fallidos: **el
paciente no recibe el recordatorio y en la clínica nadie se entera.**

Lo llamativo es que la regla estaba bien resuelta en el módulo de seguimiento comercial
(RN-09.9.6, fase 7): comprueba la ventana y, si el envío no cabe, lo descarta con motivo en vez de
intentarlo. Nunca se aplicó hacia atrás a `recordatorios`, que es de la fase 2/4 y es anterior a
que se entendiera la restricción. Con las credenciales de Meta ya configuradas, esto no era
teórico: era comportamiento vivo.

## Qué cambia

**La ventana es de la plataforma, no de una regla de negocio.** `dentroDeVentanaMeta()` sale de
`seguimiento/seguimiento.horario.ts` y pasa a `whatsapp/ventana-meta.ts`, que es donde la pueden
ver los tres sitios que envían en frío. El módulo de seguimiento la reexporta, así que ni sus
llamadas ni sus pruebas cambian.

**`MetaCliente.enviarPlantilla()`.** El cliente sabía enviar `text` e `interactive` y nada más.
Los parámetros son posicionales y el orden lo fija la plantilla aprobada en Meta, no el código:
`parametrosTicket()` en `whatsapp.plantillas.ts` es el contrato —código, servicio, fecha, hora— y
ahí está escrito, porque cruzar dos variables no lo detecta nadie: para la API son cuatro cadenas.

**La decisión vive aparte del servicio.** `recordatorios.decision.ts` es una función pura:
dentro de la ventana, texto; fuera, plantilla si hay alguna aprobada; y si no la hay,
**descartar con motivo**. Se prueba sin colas ni Redis, como `citas.reglas.ts` o
`seguimiento.horario.ts`.

**Descartar no es fallar en silencio.** Cuando no hay plantilla, el envío no se intenta —Meta lo
rechazaría igual y el reintento no cambia nada— y queda un registro en auditoría con el motivo.
La diferencia entre un recordatorio que no salió y un recordatorio que nadie sabe que no salió es
exactamente esa línea.

**RN-10.3, por fin.** `portal.service.ts` llevaba desde la fase 5 el comentario «la confirmación
por WhatsApp se encola en la Fase 4». Ahora se encola: quien agenda desde el móvil cierra la
pestaña y se queda sin el código. Va por la misma cola que los recordatorios para heredar
reintentos y política de ventana, y se encola con `catch` propio: un fallo de Meta no puede tumbar
una cita ya creada. **El bot de WhatsApp no la usa**: cuando agenda él ya responde con el ticket en
la conversación, y mandarlo dos veces es peor que no mandarlo.

**Tres claves de configuración**, vacías por defecto: `plantilla_recordatorio_24h`,
`plantilla_recordatorio_hoy`, `plantilla_confirmacion_cita`. Los nombres los define el cliente en
su Business Manager y cambian sin desplegar.

## Pruebas

- 7 unitarias sobre la decisión, con el borde de las 24 h exactas y los dos motivos de descarte
  (`RN-05`, `RN-10.3`).
- 2 sobre la carga de la plantilla: parámetros posicionales en orden, y sin `components` vacío
  cuando la plantilla no lleva variables.
- Suite completa en verde: 241 unitarias y las 19 e2e del portal, que son las que comprueban que
  el agendamiento sigue funcionando con la confirmación encolada.

## Pendiente, y no es código

**Las plantillas hay que crearlas en Meta y que las apruebe.** Es trámite del cliente, va con C2.
Hasta entonces las tres claves quedan vacías y el comportamiento es el de antes —el recordatorio
fuera de ventana no sale— con una diferencia que importa: ahora queda registrado.

Al aprobarlas, cargar los nombres en Administración → Reglas. La plantilla necesita **cuatro
variables de cuerpo en este orden**: `{{1}}` código, `{{2}}` servicio, `{{3}}` fecha, `{{4}}` hora.
