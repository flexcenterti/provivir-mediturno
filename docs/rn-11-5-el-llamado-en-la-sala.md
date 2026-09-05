# RN-11.5 y RN-11.6 · El llamado en la sala y el ciclo de vida de una pantalla

**Estado:** implementadas (fase 19). Extienden RN-11.

Las dos reglas son decisiones de producto que **no se pueden rederivar del código**: en
ambos casos hay una alternativa razonable que se descartó por una razón que solo existe
fuera del repositorio.

---

## Punto de partida: nada de esto había funcionado nunca

Medido en producción el 2026-09-05, antes de la fase:

| | |
|---|---|
| Pantallas creadas | **0** |
| Turnos con `llamado_ts` | **0** — no se ha llamado a nadie ni una vez |
| Handshake del WebSocket contra el dominio | 200 con el HTML del backoffice |

El gateway de tiempo real llevaba desde la fase 3 escrito y **jamás había atendido una
conexión**: el cliente pedía el handshake en `/socket.io`, que es el valor por defecto de
socket.io, mientras el despliegue enrutaba `/tiempo-real`, que es el *namespace*. Los dos
clientes —la TV y, desde la fase 18, la bandeja— degradaban a su sondeo periódico sin
decir nada. Se corrigió fijando el `path` del gateway, con lo que los cinco sitios que ya
documentaban `/tiempo-real` pasan a ser ciertos.

---

## RN-11.5 · El llamado suena

1. **Campanita y después voz.** La campanita es la señal de atención: hace que la sala
   levante la vista. La voz es el contenido. Si en un aparato solo sobrevive una, tiene
   que ser la campanita.
2. **La campanita se sintetiza**, no se sirve como archivo. Dos osciladores. Así no hay
   binario que empaquetar, no hay 404 posible, no hace falta abrir `media-src` en la CSP
   de `/tv`, y el tono es un parámetro y no una grabación.
3. **La voz dice exactamente lo que la pantalla muestra.** El nombre viaja ya recortado
   por `mostrar_nombre_en_pantalla`; con el modo `oculto` llega vacío y la frase lo omite.
   La voz llega más lejos que la pantalla, así que no puede decir más que ella.
4. **El código se deletrea** (`MG-042` → «M G, 0 4 2»). Sin eso, los motores leen el
   código de corrido o interpretan el guion como una resta, y el código es justamente el
   dato por el que el paciente se reconoce.
5. **Sin voz en español, no se habla.** No se cae a la voz por defecto: un motor en inglés
   leyendo «María G., consultorio 3» a todo volumen en una sala de espera es peor que el
   silencio. Queda la campanita, y la pantalla lo dice en su cabecera para que quien
   instale el aparato sepa que le falta el paquete de idioma y no concluya que la función
   está rota.
6. **El sonido es por pantalla.** Con `sonido: false` no se crea contexto de audio ni se
   pide ningún gesto: una sala configurada muda a propósito no debe pedirle nada a nadie.
7. **Solo se anuncia lo que llega por el socket**, nunca el estado sondeado. Si colgara
   del estado, cada refresco de 60 s —o una reconexión— le recitaría a la sala los últimos
   cuatro turnos.

### El gesto de activación

Los navegadores bloquean el audio hasta que hay una interacción, y un televisor en kiosko
no tiene a nadie interactuando. Se resuelve por dos caminos, y se usan los dos:

- **El flag del navegador** (`--autoplay-policy=no-user-gesture-required`) al instalar el
  stick. Con él el sonido queda armado en cada arranque y la franja no llega a verse.
- **Una franja** para los televisores que no se pueden configurar. Es una **franja y no un
  modal**: nunca tapa el turno que se está llamando, porque una sala de espera con el
  tablero escondido detrás de una petición de permisos está peor que muda. Y es un
  `<button>` enfocado, no un `<div>` con `onClick`: el botón OK del mando de un stick
  dispara un `click` sobre el elemento con foco, y en un televisor sin táctil esa es la
  única forma de activarlo.

### Repetir el llamado

**`POST /turnos/:id/rellamar` no toca `llamadoTs` ni el estado.** No es un detalle de
implementación: esa marca *es* la métrica de espera (`minutosEsperando(llegadaTs,
llamadoTs)`). Moverla haría que el tablero informara una cola más lenta cada vez que
alguien repite un llamado, y nadie relacionaría jamás las dos cosas.

Dejarla quieta da además gratis el comportamiento que quiere la sala: como el televisor
ordena por `llamadoTs`, el repetido vuelve a sonar **sin reordenar el tablero**.

Solo se puede repetir un turno en estado `llamado`. La auditoría usa una acción propia
—`Rellamado de turno`— porque es el único rastro duradero, y es lo que responde «¿le
llamamos antes de marcarlo ausente?».

---

## RN-11.6 · Crear y retirar pantallas

Hasta la fase 19 la API solo tenía `GET` y `PATCH`: **no se podía dar de alta ni de baja
una pantalla desde el producto**. Las que hubo salieron del cargador de demostración, que
además las purga — por eso producción llevaba meses con la tabla vacía y con una pantalla
de configuración que era un callejón sin salida.

1. **Alta y baja con `pantallas.editar`**, el permiso que ya existía. Retirar no es una
   autoridad distinta de configurar: quien puede dejar una pantalla sin servicios ya puede
   apagarla.
2. **Retirar es un borrado duro, y es irreversible a propósito.**

   Todo lo que protege `/tv` es que la URL lleva un UUID que solo se ve desde el
   backoffice. El procedimiento ante un enlace filtrado, escrito en el `Caddyfile` desde el
   principio, es *«se corta creando una pantalla nueva y retirando la anterior»*. Retirar
   tiene entonces **un solo trabajo: que ese UUID deje de resolver.**

   Un `activo: false` solo lo cumpliría si las **tres** rutas de lectura recordaran el
   filtro: la lista del backoffice, el estado público que consume el televisor y la
   selección de destinatarios del llamado. Olvidar la tercera dejaría una pantalla
   «retirada» recibiendo nombres de pacientes en vivo por el WebSocket — exactamente el
   fallo que el procedimiento existe para evitar, reintroducido por el mecanismo puesto
   para implementarlo.

   La recuperación es la auditoría, que guarda la configuración entera. Rehacer la pantalla
   cuesta un minuto y produce **un UUID nuevo**, que es el resultado correcto: nadie quiere
   que «deshacer» resucite un enlace filtrado.
3. **Los servicios se validan contra el catálogo**, al crear y al editar. `Pantalla.servicios`
   es un `String[]` sin clave foránea; una pantalla con un id que no existe no recibe un
   solo llamado en toda su vida y se queda en «Esperando llamados», indistinguible de una
   sala tranquila. No es hipotético: el catálogo de demostración usa `derp` y `vitc`, y el
   real de la clínica usa `odo`, `oft` y `rx`.
4. **Una pantalla sin servicios se puede guardar**, porque es el estado normal de un alta a
   medio hacer. Pero se avisa dos veces: en el formulario antes de guardar, en la fila de la
   lista, y **en el propio televisor**, que dice «Esta pantalla no tiene servicios
   asignados» en vez de «Esperando llamados».

---

## Lo que también se corrigió, y por qué cuenta como regla

**El tablero es el del día.** `ultimosLlamados` no filtraba por fecha. Como nadie escribe
nunca `ausente`, un turno llamado y no finalizado se queda en `llamado` para siempre: el
televisor habría amanecido mostrando el llamado de ayer. No mordía porque nunca se había
llamado a nadie.

**El turno atendido sale al instante.** Al finalizar se emite un retiro a las pantallas del
servicio; antes se quedaba hasta el refresco de 60 s, y la sala veía llamado a alguien que
ya había entrado a consulta.
