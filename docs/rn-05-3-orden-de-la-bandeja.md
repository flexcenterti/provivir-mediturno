# RN-05.3 · Orden de la bandeja

**Estado:** reescrita en la fase 18. Sustituye a la versión que describe
`docs/changelog-fase4.md`.

## Lo que decía antes

Los pendientes se ordenaban **por prioridad y, dentro de ella, por quien llevaba más
esperando**. El motivo estaba escrito: mientras el cliente no defina los criterios de
prioridad (P4), la columna operativa dominante es el tiempo de espera.

## Lo que dice ahora

**Se ordena por actividad reciente: arriba, quien acaba de escribir.** Es el orden de
WhatsApp, y el cliente lo pidió al rediseñar la pantalla con esa referencia.

**La contrapartida es obligatoria y forma parte de la regla: la etiqueta de prioridad va
siempre visible, la primera de la fila, delante del nombre.** Desde que el orden no la
codifica, el chip es la única señal de que alguien es urgente — si se cae del diseño, la
prioridad deja de existir de hecho.

## Lo que se pierde, dicho claro

Quien escribe tres veces seguidas adelanta a quien lleva dos horas en silencio. Antes no
podía pasar. Es un cambio de negocio y se tomó a sabiendas: la asistente trabaja mirando
lo que acaba de llegar, y una lista que no se mueve cuando entra un mensaje no se parece
a ninguna herramienta de conversación que haya usado.

El tiempo de espera **no desaparece**: sigue en cada fila y, a partir de 30 minutos, se
destaca en rojo (RN-08.3). Lo que cambia es que ya no decide el orden.

## Cómo se implementa

Sin denormalizar. `@@index([conversacionId, ts])` ya existía en `Mensaje`, que es
exactamente el índice que necesita un `LEFT JOIN LATERAL` con el último mensaje. El
filtro se queda en Prisma —que es donde se puede leer— y el orden en SQL, que es donde se
puede hacer: `orderBy` no sabe ordenar por el máximo de una relación.

Se descartó una columna `ultimoMensajeTs`: hay **cinco** sitios que crean mensajes, y una
segunda verdad con cinco escritores se desincroniza sola.

**`COALESCE(último mensaje, creado_en)`**, y no es adorno: desde la fase 16 una asistente
puede abrir un hilo vacío con «Escribirle», y sin el respaldo se hundiría al fondo el
mismo día que lo crea.

**Un solo mecanismo para las tres vistas**, frente a los dos de antes —memoria para
pendientes, base para el resto—. Los filtros no cambian: «cerradas» sigue acotándose por
`resueltaTs`.

## Qué se retiró

`ordenarPendientes` y `compararPendientes` en `bandeja.orden.ts`, con su parte del spec.
`inicioDeEspera` y `esperaEnMinutos` **se quedan**: alimentan el dato de espera que se
pinta en cada fila.

## Lo que queda abierto

**P4 sigue pendiente.** El cliente aún no ha definido los criterios de prioridad, así que
quién es «alta» lo sigue decidiendo el bot al escalar. Ese pendiente era la razón de la
regla anterior; ahora es solo la razón de que la etiqueta importe tanto.
