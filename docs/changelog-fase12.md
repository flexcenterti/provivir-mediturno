# Changelog · FASE 12 — Consentimiento de datos en WhatsApp

**Estado:** en verde, sin desplegar. Incluye también RN-08.1, el adjunto visible en la bandeja
(al final). Los totales de pruebas de esta rama están en el changelog de la fase 13, que va encima.

## Por qué

Dos peticiones del cliente sobre el bot: corregir el saludo, que seguía presentándose como «Grupo
Provivir — CDC Oriente», y pedir la autorización de tratamiento de datos antes de atender.

Lo segundo resultó no ser una mejora sino **una obligación incumplida desde el principio**. La
Arquitectura §8 ya exigía el aviso «en el portal **y en el primer contacto por WhatsApp**». El
portal lo pedía desde la fase 5 con casilla obligatoria; WhatsApp, el canal por el que entra la
mayoría, no lo mencionaba en ningún punto y recibía documentos, teléfonos y notas de voz sin
autorización previa.

La regla completa está en [`docs/rn-09-10-consentimiento-whatsapp.md`](rn-09-10-consentimiento-whatsapp.md).

## Dónde se guarda, que era la pregunta difícil

**No en el paciente**, aunque fuera lo intuitivo: en el primer mensaje no se sabe quién escribe.
`Conversacion.pacienteId` nace nulo y solo se llena cuando la IA identifica el documento — que ya
es tratar datos. Colgarlo del paciente sería pedir el permiso después de necesitarlo.

La llave es **el identificador que entrega Meta**, que el sistema ya guardaba tal cual: un teléfono
E.164, o un `wa:CO.<id>` cuando la persona usa nombre de usuario. Lo confirmó la propia base de
producción, donde convivían las dos formas. El `pacienteId` se enlaza después, al confirmar el
documento, y es lo que permite responder «esta persona autorizó, tal día, esta política».

Se guarda **qué política** aceptó, no solo que aceptó: cuando el texto cambie, los consentimientos
ya dados conservan el suyo.

## Los botones que llevaban dos fases esperando

`meta.cliente.ts` sabía enviar botones desde la fase 4 —con los límites de Meta ya aplicados— pero
**nadie lo llamaba en todo el repo**: estaba guardado tras `whatsapp_botones_interactivos`,
pendiente de aprobación del cliente, y la clave **ni siquiera existía** en la configuración. Esta
petición es esa aprobación; se cierra el pendiente D-c del checklist.

Con la bandera apagada el aviso sale en texto pidiendo responder ACEPTO. No sobra: si Meta
rechazara el interactivo, la clínica se quedaría sin poder atender a nadie.

El normalizador **conservaba solo el título del botón y tiraba el id**. Ahora lo propaga: una
decisión legal no puede depender de que un título traducible coincida palabra por palabra.

## Decisiones de comportamiento

- **Rechazar no bloquea el canal.** Se registra, se da una salida (teléfono o sede) y, si la
  persona vuelve a escribir, se le pregunta otra vez.
- **Aceptar retoma lo que había pedido.** El mensaje original sigue guardado, así que el paciente
  no repite nada: acepta y recibe la respuesta a su pregunta.
- **El aviso antecede al escalamiento por adjunto.** Sin eso, una foto de orden médica llegaría a
  la bandeja y una asistente la leería sin autorización.
- **La pregunta se persiste como mensaje saliente**, o la bandeja mostraría un «Acepto» que no
  responde a nada.

## Marca

Se corrigieron los últimos textos que seguían con el nombre viejo: la identidad en el prompt, la
cabecera del ticket de WhatsApp y el `responsable` del aviso de privacidad del portal.

## RN-08.1 · el adjunto, visible de verdad

Cae en esta fase porque es el mismo asunto desde el otro lado: el aviso de datos antecede al
escalamiento por adjunto, y de poco sirve autorizarlo si luego la asistente no puede abrirlo.

La burbuja solo decía «📎 imagen». La asistente sabía que había una orden médica y no podía
leerla — que es exactamente lo que RN-08 le pide hacer: el escalamiento llegaba sin el soporte con
el que hay que trabajar.

`GET /bandeja/mensajes/:id/media` lo sirve con el mismo permiso `bandeja.operar` del controlador
—quien atiende la conversación es quien ve su soporte— y deja constancia en auditoría de quién lo
abrió, porque es un dato del paciente.

**La ruta nunca llega del cliente:** se direcciona por id de mensaje y sale de la base, así que la
travesía de rutas no es posible por construcción; la comprobación contra `DIR_MEDIA` es defensa en
profundidad por si un valor almacenado se corrompiera. El nombre del archivo lo escribe el
paciente, así que se limpia antes de ponerlo en `Content-Disposition`: un salto de línea ahí
permitiría inyectar cabeceras. Lo desconocido se sirve como `application/octet-stream` y con
`nosniff`, para que un archivo inesperado no pueda ejecutarse en el navegador de la asistente.

`extensionDe` sale de `meta.cliente` a `media.tipos` porque ahora se recorre en los dos sentidos:
al descargar hace falta la extensión, y al servir, el tipo de vuelta.

En el frontend hizo falta `pedirBlob()` aparte de `pedir()`: un `<img src>` no puede llevar la
cabecera del token. Comparte el refresco de sesión —si no, abrir un adjunto tras un rato inactivo
echaría al login— y revoca el object URL al desmontar, o cada conversación abierta dejaría una
copia del archivo colgada en memoria.

## Al desplegar

Trae migración. Y algo que conviene avisar a la clínica: **a todas las conversaciones abiertas se
les pedirá la autorización la próxima vez que escriban**. Es lo correcto, pero sin aviso previo se
lee como un fallo.
