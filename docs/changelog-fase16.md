# Changelog · FASE 16 — Hablar con los pacientes que se agendan solos

**Estado:** en rama `fase-16-contacto-autoagendados`. 314 unitarias (API) + 39 (shared) +
319 e2e + 26 de navegador.

## Por qué

Pregunta del cliente: *«no recuerdo dónde queda la opción de hablar o habilitar el chat
de los pacientes auto agendados»*. No quedaba en ninguna parte.

Al mirarlo apareció que no es un caso, sino **tres poblaciones**, y solo una estaba
atendida:

| Cómo llegó | ¿Hay hilo? | ¿Lo veía la asistente? |
|---|---|---|
| Escribió y el bot **escaló** | sí | sí |
| Escribió y el bot lo **resolvió todo** | **sí** | **no** |
| Solo **portal**, nunca escribió | **no** | no |

La fila del medio es la más incómoda: **un hilo que existe y nadie podía ver.**
«Pendientes» pide `escalada` o `reabiertaTs`, «cerradas» pide `resueltaTs` —que solo
escribe una persona pulsando «Resolver»— y nada cierra sola una conversación del bot.
La API tenía desde siempre una tercera vista `todas`; el frontend nunca la pedía.

## Se entrega en tres partes, y las dos primeras no dependen de Meta

**A · Los hilos que el bot atendió solo.** Pestaña «Todas», que es también donde buscar
a un paciente concreto. El backend ya sabía atenderlos: `tomar()` nunca exigió
`escalada`, y al poner `en_gestion` el bot se calla por sí solo. Lo que faltaba era
poder llegar.

**B · Si al paciente le llegó el aviso de su cita**, en la propia ficha, con su número
a la vista. Funciona hoy.

**C · Escribirle al que solo pasó por el portal.** Queda **inerte hasta que Meta apruebe
la plantilla**, igual que la reapertura de la fase 13.

## Cuatro defectos vivos, encontrados por el camino

**El agujero del consentimiento, que esta misma fase abría.** La puerta RN-09.10 aguanta
—`procesar()` consulta el consentimiento en todo entrante, antes incluso de mirar el
estado—, pero `resolverConsentimiento` retomaba el mensaje pendiente con la IA **sin
volver a mirar quién tiene el hilo**. Era inalcanzable mientras a `en_gestion` solo se
llegara después de resolver el consentimiento; en cuanto una asistente puede tomar un
hilo sin escalar, pasa a ser el camino normal — y la IA le responde al paciente por
encima de quien lo está atendiendo. La prueba que lo fija falla sin el arreglo.

**Dos contadores para la misma burbuja.** El del lado del webhook contaba solo
`escalada: true` y se dejaba fuera las reabiertas, así que **la burbuja bajaba sola al
entrar cualquier WhatsApp y volvía a subir en cuanto alguien tocaba la bandeja**. El
comentario que acompañaba al filtro ya advertía de esto —«dos copias del mismo filtro
acaban divergiendo»— sin saber que había una tercera. `PENDIENTES` pasa a un módulo
plano que comparten los dos.

**El código de cita no identifica una cita.** Es único por sede y **día**
(`@@unique([sedeId, fecha, codigo])`), y la auditoría no se borra: `cita/MG-001` se
repite cada jornada. La ficha habría mostrado el desenlace del envío de **otra cita
distinta** —la del martes contando lo que pasó con la del lunes—, que es peor que no
mostrar nada. Se acota por `creadoEn`: nada de una cita puede ser anterior a ella misma.
Lo destapó la propia suite, con una fila de auditoría de una cita ya borrada.

**El rechazo duro de Meta era invisible.** Si el número no tiene WhatsApp (`#131026`),
`enviar()` lanza, BullMQ reintenta tres veces y al agotarse solo quedaba una línea de
log. Cuando existan las plantillas esa será la causa número uno de «no le llegó». Ahora
se audita y se relanza: el reintento sigue teniendo sentido, lo que no puede es
agotarse en silencio.

Y uno menor pero del mismo tipo: `whatsapp ?? telefono` no cae al respaldo con
`whatsapp: ''`, que es lo que escriben el cargador masivo y el mostrador cuando el
campo viene en blanco. Se extrae `numeroDeContacto()` a un solo sitio, para que «a
dónde se envía» y «qué se le muestra a la asistente» no puedan divergir.

## Decisiones, con su razón

**El portal sigue sin crear conversaciones.** Evita el ciclo portal → whatsapp → ia →
citas que `MetaModule` documenta esquivar, y sobre todo evita **un hilo en la bandeja
por cada agendamiento web**. La bandeja es para lo que necesita a una persona; el hilo
lo crea una persona cuando decide que hace falta.

**`iniciadaTs`, columna nueva, espejo de `reabiertaTs`.** Un hilo abierto a mano tiene
que salir en «pendientes», y ponerle `escalada: true` falsearía las escalaciones de un
mes ya reportado — el propio código se niega a hacer eso al reabrir. Es también su reloj
de espera, y el orden es `reabiertaTs ?? iniciadaTs ?? escaladaTs`: del suceso más
reciente al más antiguo, o una conversación abierta el lunes y reabierta hoy volvería a
la lista con tres días de espera.

**200 con desenlace, no 409.** `pedir()` se queda con `message` y tira el resto del
cuerpo, así que el id del hilo dentro de un 409 es inalcanzable desde la interfaz: deja
a la asistente con un error rojo y ningún sitio al que ir. Y como la acción siguiente es
siempre la misma —abrir el hilo—, tampoco era un error. Los desenlaces son `enviada`,
`ventana_abierta`, `ya_enviada` y `sin_configurar`.

**Lock consultivo, no comprobación optimista.** La que usa `reabrir` es *best effort*:
en READ COMMITTED no impide un INSERT concurrente, y no hay índice único que lo impida.
Dos asistentes pulsando a la vez —o el paciente escribiendo justo entonces— partirían la
conversación en dos. Y la plantilla se manda **fuera** de la transacción: nunca se
sostiene un lock de base durante una llamada HTTP a Meta.

**La guarda de las 24 h pasa a contar por NÚMERO.** Filtrando por conversación se
burlaba sin querer: mandar plantilla, resolver el hilo y volver a abrirlo daba una fila
nueva con la guarda vacía. Meta cuenta por interlocutor, no por fila de nuestra base.

**Se normaliza el teléfono al crear.** El portal guarda lo que teclee el paciente
—`3009991111`— y Meta entrega `+573009991111`: sin esto el hilo nacería en un formato y
su respuesta llegaría en otro, se abriría un segundo hilo y la asistente se quedaría
mirando el suyo, vacío. Como red de seguridad, `obtenerOCrear` también busca por
variantes en vez de por igualdad exacta. **Ese cambio hoy no arregla nada observable**
—el webhook normaliza a la entrada, así que toda fila existente ya está en `+57…`— pero
puede unificar hilos que estuvieran separados si alguna vez se guardó uno a mano.

**Una plantilla nueva, no reutilizar la de reapertura.** Aquella dice «sobre tu consulta
anterior», y en un primer contacto es mentira. El coste del sexto trámite se anula sin
tocar código: lo que se guarda es un *nombre*, así que quien no lo quiera pega el mismo
en las dos casillas.

**El consentimiento no se presiembra.** El aviso del portal es otro consentimiento, y la
tabla está llaveada por el identificador de Meta a propósito. Se le sigue pidiendo en el
chat cuando responda, como a todo el mundo.

## Lo que enseñaron las mutaciones

Ocho, y una encontró una prueba mía que no probaba nada: **el acotado por `creadoEn` que
acababa de añadir excluía la fila antigua de la prueba de ordenación**, así que pasaba
igual con `orderBy: asc`. Se corrigió poniendo las dos filas después de crear la cita.

Las otras siete se cazaron a la primera: quitar la relectura del estado al aceptar el
consentimiento (la IA arranca con todo el historial encima de la asistente), volver a la
igualdad exacta de teléfono (dos hilos), quitar `iniciadaTs` de `PENDIENTES` (el hilo
nuevo desaparece), guardar el teléfono sin normalizar, copiar del webhook el
`pacienteId: null`, filtrar la auditoría por uuid en vez de por código, y mandar la
plantilla con parámetros distintos.

Requisito de montaje que faltaba: la suite espiaba `enviarTexto` y `enviarBotones` pero
**no `enviarPlantilla`**, así que ninguna prueba de plantilla podía afirmar nada. Ahora
se capturan los argumentos, no solo la llamada.

## Al desplegar

**Una migración**, aditiva y sin relleno: `conversacion.iniciada_ts`. `NULL` significa
que nadie la abrió a mano, que es lo cierto de todo lo anterior.

**Un parámetro nuevo**, `plantilla_contacto_inicial`, que `asegurarBase()` reparte solo
a las instalaciones ya desplegadas. Nace vacío, y con él vacío el botón sale
deshabilitado diciendo por qué.

**Sin aviso operativo:** nada de esto rompe una pestaña abierta durante el relevo.

## Lo que queda abierto

- **Las cinco plantillas de P14**, y sobre todo `plantilla_confirmacion_cita`: sin ella
  el paciente del portal sigue sin recibir nada, y la parte B solo sirve para *saber*
  que no le llegó.
- **El texto de la plantilla nueva**, que hay que llevar a Meta. Está en
  `docs/rn-10-4-contacto-con-el-portal.md`, y hay que confirmar la razón social.
- **Índice único parcial** `UNIQUE (telefono) WHERE resuelta_ts IS NULL`, que respaldaría
  en la base lo que hoy garantiza solo el lock.
- **Cierre del día**, que sigue sin existir.
