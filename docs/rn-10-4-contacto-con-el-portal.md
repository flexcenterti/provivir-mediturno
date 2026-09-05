# RN-10.4 · Hablar con quien se agenda solo

**Estado:** implementada (fase 16). Extiende RN-10 y RN-08.3 sin contradecirlas.

## El problema

No hay una población de «pacientes autoagendados», hay **tres**, y solo una estaba
atendida:

| Cómo llegó | ¿Hay hilo? | ¿Lo veía la asistente? |
|---|---|---|
| Escribió y el bot **escaló** | sí | sí |
| Escribió y el bot lo **resolvió todo** | **sí** | **no** |
| Solo **portal**, nunca escribió | **no** | no |

**La fila del medio era un hilo que existe y nadie podía ver.** «Pendientes» pide
`escalada` o `reabiertaTs`; «cerradas» pide `resueltaTs`, que solo escribe `resolver()`
—o sea una persona—. Nada cierra sola una conversación del bot, así que la que atendió
de punta a punta se quedaba en `ia_activa` y no caía en ninguna de las dos vistas.

**La fila de abajo no tenía hilo siquiera.** Solo lo crea un mensaje entrante del
webhook. Y ese paciente **tampoco recibe la confirmación de su cita**: nunca escribió,
no hay ventana de 24 h, y sin plantilla aprobada el envío se descarta. Quedaba una
línea de auditoría que nadie mira, y en pantalla esa cita se veía igual que las demás.

## RN-10.4

1. **Toda conversación es alcanzable.** Hay una vista que las muestra todas, y el
   buscador por nombre, documento o teléfono la recorre entera.
2. **Tomar un hilo del bot lo apaga en esa conversación**, y se avisa antes de hacerlo,
   no después. Es lo que ya hacía `procesar()` al ver `en_gestion`; lo nuevo es que se
   pueda llegar ahí a propósito.
3. **La ficha de la cita dice si al paciente le pudo llegar el aviso, y si no, por
   qué**, con su número a la vista para llamarlo.
4. **Una asistente puede abrir conversación con quien nunca ha escrito**, mandándole
   una plantilla aprobada. La plantilla no abre la ventana: la abre su respuesta.
5. **El portal NO crea conversaciones.** El hilo lo crea una persona cuando decide que
   hace falta. La bandeja es para lo que necesita a alguien, y un hilo por cada
   agendamiento web la llenaría de conversaciones que nadie pidió.
6. **Un solo hilo vivo por número.** Si ya hay uno se devuelve; si solo hay cerrados se
   reabre el más reciente, y no se crea otro al lado.

## Por qué dos plantillas y no una

La de reapertura dice «sobre tu consulta anterior». En un primer contacto eso es
mentira, y una plantilla que le afirma algo falso al paciente es peor que un trámite
más. Además cada clave corresponde a un endpoint distinto —retomar un hilo cerrado y
abrir uno que no existe—, así que no hay nada que decidir en tiempo de ejecución.

**Y el coste ante Meta se puede anular sin tocar código:** lo que se guarda en
configuración es un *nombre*. Quien no quiera tramitar una sexta plantilla pega el
mismo nombre aprobado en las dos casillas y obtiene el comportamiento fundido.

Texto propuesto para `plantilla_contacto_inicial` (UTILITY, `es`, una variable):

> Hola {{1}}, te escribimos del Centro de Profesionales & Provivir sobre tu cita.
> Respóndenos por este chat y una de nuestras asistentes te atiende.
>
> *Si no agendaste ninguna cita, ignora este mensaje.*

Dice «tu cita» y no «la que agendaste en la web» a propósito: el botón vive en la ficha
de una cita, y no siempre viene del portal. **Por eso el botón no va en la ficha del
paciente**: sin cita el texto sería falso, que es justo lo que se le reprocha a
reutilizar la de reapertura.

## El consentimiento no se toca (RN-09.10)

Quien agenda por el portal acepta el aviso del portal, que es **otro** consentimiento:
tratamiento de datos para agendar. `ConsentimientoWhatsapp` está llaveada por el
identificador de Meta a propósito, y presembrarla desde el portal silenciaría la puerta
para quien nunca vio el aviso en ese canal.

Así que **se le sigue pidiendo en el chat cuando responda**, como a todo el mundo. La
puerta aguanta: `procesar()` consulta el consentimiento en todo entrante, antes incluso
de mirar el estado de la conversación.

Precedente que sí conviene tener escrito: el sistema **ya** manda proactivos
—confirmación, recordatorios— a estos pacientes sin consentimiento de WhatsApp. Abrir
chat es un paso más, pero el paciente acaba de dar su número para una cita y la
plantilla habla de esa cita. Queda en auditoría quién lo abrió y cuándo.

## Qué significa cada desenlace de la apertura

| | Qué pasó |
|---|---|
| `enviada` | Salió la plantilla. Falta que conteste: eso es lo que abre la ventana. |
| `ventana_abierta` | Escribió hace poco, así que cabe texto libre. No se gasta plantilla. |
| `ya_enviada` | Ya se le mandó una en 24 h. Insistir no cambia nada y a Meta le consta como spam. |
| `sin_configurar` | No hay plantilla aprobada: no se intentó, porque Meta lo rechazaría. |

Es un **200 con desenlace, no un 409**: la acción siguiente es siempre la misma —abrir
el hilo— y el cliente descarta el cuerpo de los errores, así que un 409 dejaría a la
asistente con un error rojo y ningún sitio al que ir.

## Lo que queda abierto

- **Las plantillas de P14.** Sin `plantilla_confirmacion_cita` el paciente del portal
  sigue sin recibir nada, y la ficha solo sirve para *saber* que no le llegó.
- **`iniciadaTs` no tiene índice único que lo respalde.** El lock consultivo serializa
  la apertura, pero no hay `UNIQUE (telefono) WHERE resuelta_ts IS NULL` en la base.
- **Cierre del día**, que sigue sin existir.
