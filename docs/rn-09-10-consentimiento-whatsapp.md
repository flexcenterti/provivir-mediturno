# RN-09.10 · Autorización de tratamiento de datos en WhatsApp

**Origen:** solicitud del cliente (septiembre de 2026). Cierra además una exigencia que la
Arquitectura §8 ya hacía y que llevaba sin implementarse: *«aviso de privacidad en el portal **y en
el primer contacto por WhatsApp**»*.

**Estado:** implementada (fase 12).

**Extiende:** RN-09, canal de WhatsApp. Cierra el pendiente D-c de RN-09.2 sobre botones
interactivos.

---

## Por qué

El portal pedía consentimiento con casilla obligatoria desde la fase 5. **WhatsApp no lo mencionaba
en ningún punto**, y es el canal por el que entra la mayoría: se recibían nombres, documentos,
teléfonos y notas de voz sin haber pedido autorización para tratarlos.

---

## Regla

**RN-09.10.1** · Antes de atender nada por WhatsApp se pide la autorización de tratamiento de datos
(Ley 1581 de 2012), con el enlace a la política vigente.

**RN-09.10.2** · Se pide **antes de cualquier otra cosa**: antes de la IA, antes de escalar a una
asistente y antes de interpretar una foto o una nota de voz. Que un adjunto escale a un humano no
es excusa: una asistente leyéndolo también es tratamiento de datos.

**RN-09.10.3** · Se pregunta **una sola vez**. Quien ya autorizó no vuelve a verlo.

**RN-09.10.4** · Quien rechaza **no queda bloqueado para siempre**: se le da una salida (teléfono o
sede) y, si vuelve a escribir, se le pregunta de nuevo. Un «no» de hoy no es un «no» perpetuo.

**RN-09.10.5** · Quien acepta **no tiene que repetir lo que pidió**: su mensaje original se retoma
y el bot contesta a eso.

**RN-09.10.6** · Se registra **qué política** aceptó, no solo que aceptó. Cuando el texto cambie,
los consentimientos ya dados conservan el suyo.

---

## Dónde se guarda, y por qué no en el paciente

**En el primer mensaje no se sabe quién escribe.** `Conversacion.pacienteId` nace nulo y solo se
llena cuando la IA identifica el documento — que ya es tratamiento de datos. Colgar el
consentimiento del paciente sería pedirlo después de necesitarlo.

La llave es el **identificador que entrega Meta**, que el sistema ya guardaba tal cual. Puede ser un
teléfono E.164 o un `wa:CO.<id>` cuando la persona usa nombre de usuario en vez de número; para
esto da igual, porque es estable por interlocutor.

Tabla `ConsentimientoWhatsapp`: `identificador` único, `aceptado`, `ts`, `politicaUrl`,
`pacienteId` opcional y `sedeId`. **El estado vive en la tabla; el historial, en `Auditoria`**
(`usuario: 'whatsapp'`), que es append-only.

El `pacienteId` se enlaza cuando la persona confirma su documento. Es lo que permite responder
«esta persona autorizó, tal día, esta política» y no solo tener un número suelto.

---

## Los botones, y el respaldo

`meta.cliente.ts` sabía enviar botones desde la fase 4, con los límites de Meta ya aplicados, pero
**nadie lo llamaba**: estaba guardado tras `whatsapp_botones_interactivos`, pendiente de aprobación
del cliente. Esta petición es esa aprobación, y la clave pasa a existir de verdad, con valor `true`.

**Con la bandera en `false` el aviso sale en texto**, pidiendo responder ACEPTO o NO ACEPTO. No es
adorno: si Meta rechazara el mensaje interactivo, el consentimiento no puede quedarse sin vía y la
clínica se quedaría sin poder atender a nadie.

El normalizador **conserva ahora el `id` del botón**, que antes descartaba quedándose con el
título. Una decisión legal no puede depender de que un título coincida palabra por palabra: los
títulos son traducibles y el paciente puede escribir su respuesta a mano.

---

## Los textos

Ni el aviso ni la bienvenida los redacta el modelo. Viven en `whatsapp.textos.ts`, juntos, porque
los revisa gente que no lee TypeScript.

Antes, el saludo lo improvisaba la IA a partir del prompt — por eso seguía presentándose como
«Grupo Provivir — CDC Oriente». Ahora es fijo, y el prompt lleva la instrucción de no volver a
saludar.

---

## Pendiente

- **A todas las conversaciones abiertas se les pedirá la autorización** la próxima vez que
  escriban. Es lo correcto, pero la clínica debe saberlo para no leerlo como un fallo.
- El aviso del portal **sigue sin declarar el procesamiento por terceros**, y las conversaciones y
  notas de voz se envían a un proveedor de IA externo. Anotado en tres documentos y todavía abierto.
- `Paciente.noContactar` sigue sin escribirse desde ningún sitio de producción: el opt-out
  comercial de RN-09.9.4 existe en el modelo y se respeta al enviar, pero nada lo activa.
