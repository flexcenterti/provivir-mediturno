# Changelog · FASE 19 — Las pantallas de llamado, funcionando

**Estado:** en rama `fase-19-pantallas-de-sala`. **Sin migración.** 315 unitarias (API) +
71 (shared) + 370 e2e + 53 de navegador.

## Por qué

La pregunta del cliente fue por qué no aparecían los menús de configuración de las
pantallas de sala. La respuesta corta: **no falta ningún menú, falta poder crear una
pantalla.** El modal de configuración existe y está completo, pero solo se abre desde una
fila, y no había filas ni forma de crearlas desde el producto.

Al tirar del hilo aparecieron cinco huecos, y tres eran invisibles desde esa pantalla.

### Lo que decía producción

| | |
|---|---|
| Tabla `pantalla` | **0 filas** |
| Turnos con `llamado_ts` | **0** — no se ha llamado a nadie ni una vez |
| `GET /socket.io/?EIO=4&transport=polling` contra el dominio | 200 con el HTML del backoffice |
| El mismo handshake contra la API por dentro del contenedor | 200, con su `sid` |

Esa última pareja de líneas es el hallazgo de la fase.

---

## 1 · El WebSocket no había funcionado nunca. Tampoco el de la bandeja

Esto corrige lo que se dijo al cerrar la fase 18: **el refresco en vivo de la bandeja
tampoco funcionó en producción**, por la misma causa.

El gateway declaraba `namespace: '/tiempo-real'` y **no fijaba `path`**. En socket.io el
namespace es enrutado de protocolo; el handshake HTTP vive en el path por defecto,
`/socket.io`. El despliegue enruta `/tiempo-real`. Los dos nunca se encontraron, y los dos
clientes degradaban a su `setInterval` **en silencio** — que es la razón de que llevara
seis fases sin detectarse.

**Se arregla fijando el `path` en el gateway**, no añadiendo una ruta al proxy. Se
consideraron las dos:

- Enrutar `/socket.io` en Caddy no toca código y los bundles ya desplegados funcionarían
  sin recompilar. Pero deja el despliegue con tres rutas para una sola cosa, una de ellas
  —`/tiempo-real`— proxyando un 404 permanente, y la tabla de rutas del propio `Caddyfile`
  convertida en ficción por escrito. Dentro de un año alguien borra la ruta muerta.
- Fijar el `path` hace ciertos de golpe los cinco sitios que ya dicen `/tiempo-real`
  —Caddyfile, ejemplo de subdominios, guía de despliegue y el proxy de Vite de la TV— y
  **quita** una pieza móvil en lugar de añadirla. Cuesta una línea.

El argumento de «no hay que recompilar» no compraba nada aquí: esta fase recompila la TV y
el backoffice de todos modos. Se comprobó en el adaptador instalado
(`@nestjs/platform-socket.io`) que `path` se reenvía al servidor de engine.io junto al
resto de opciones, y que solo hay un gateway en todo el repositorio.

Va con: el proxy de `/tiempo-real` en `apps/backoffice/vite.config.ts`, que **no tenía
ninguno** —por eso el defecto llegó a producción sin que nadie lo viera en desarrollo—, y
`wss:` en el `connect-src` de la CSP de `/tv`, que el bloque del backoffice ya llevaba.

También se cerró un defecto latente de `tiempoReal.ts`: refrescaba la sesión en **cada**
intento fallido de conexión, y socket.io reintenta indefinidamente. Con la ruta rota eso
era una petición de refresco cada pocos segundos por pestaña abierta.

## 2 · Alta y baja de pantallas

`POST /pantallas` y `DELETE /pantallas/:id`, con `pantallas.editar`. En el backoffice:
botón **Nueva pantalla**, **estado vacío** en la tabla —lo que faltaba para que la pantalla
dejara de ser un callejón sin salida—, **Retirar pantalla** con confirmación que dice qué
se rompe, y **Copiar enlace**, que copia la URL **absoluta**: quien configura está en un
escritorio y el televisor está en otra sala, así que «Abrir» no servía para la tarea real.
La fila muestra además el UUID, que es lo único que permite correlacionar «qué pantalla es
ese televisor» cuando alguien te lo lee por teléfono.

El borrado es **duro**, y la razón está en RN-11.6: retirar una pantalla *es* la revocación
de su enlace, y un borrado lógico solo cumpliría eso si las tres rutas de lectura
recordaran el filtro. La tercera —la selección de destinatarios del llamado— es la que
nadie recuerda, y olvidarla dejaría una pantalla «retirada» recibiendo nombres de pacientes
en vivo.

**Los servicios se validan contra el catálogo**, en POST y en PATCH. Es un cambio de
comportamiento de un endpoint existente, y se hace ahora precisamente porque con cero filas
en producción no hay nada que romper.

## 3 · El llamado suena

`Pantalla.sonido` estaba en el modelo, era editable, viajaba a la TV… y **no se leía ni una
vez**. Campanita sintetizada con osciladores (sin archivo, sin `media-src`) y voz que lee el
turno, con el desbloqueo del autoplay por las dos vías. El detalle completo, en RN-11.5.

Lo importante de la mecánica: **el anuncio cuelga solo del evento del socket**. Colgarlo del
estado haría que cada refresco de 60 s le recitara a la sala los últimos cuatro turnos.

## 4 · Repetir el llamado

`POST /turnos/:id/rellamar`, y un botón en la vista del prestador que se apaga tres
segundos tras cada pulsación —sin eso, una asistente impaciente encadena cuatro anuncios
solapados—. **No toca `llamadoTs`**: esa marca es la métrica de espera.

## 5 · El video institucional dejaba de rotar al minuto

El efecto que monta el reproductor de YouTube dependía de `config.videosPromo`, y el
refetch de 60 s reasignaba `config` con un array nuevo aunque no hubiera cambiado nada. Cada
minuto: destruir y recrear. **Un institucional de más de 60 segundos no llegaba jamás a su
evento de fin**, que es lo único de lo que depende RN-11.2 para volver al canal. Y como
`YT.Player` reemplaza el `<div>` que recibe, tras el `destroy()` la referencia apuntaba a un
nodo fuera del documento: frame en negro.

Tres arreglos, y el primero es la causa raíz:

- El refetch solo reemplaza `config` si cambió de verdad. Elimina la clase entera de
  problemas, no solo este síntoma.
- YouTube recibe un nodo desechable creado dentro del contenedor, nunca el que administra
  React.
- Por la rama asíncrona de carga de la API, el reproductor **no se destruía nunca**: el
  valor que devolvía `iniciar()` se lo tragaba `onYouTubeIframeAPIReady`. Y el script se
  añadía en cada montaje. Ahora se carga una vez por documento.

Además, **`ErrorBoundary` en la TV**: no había ninguno, y el modo de fallo de un error de
render en un kiosko es una página en blanco, indistinguible desde la sala de un aparato
averiado. Ahora lo dice y se recarga sola: es la única pantalla del producto sin un usuario
delante.

## 6 · Lo que se arregló de camino

- **El tablero es el del día.** `ultimosLlamados` no filtraba por fecha, y como nadie
  escribe nunca `ausente`, el televisor habría amanecido con el llamado de ayer. No mordía
  porque nunca se había llamado a nadie.
- **El turno atendido sale al instante**, en vez de quedarse hasta el refresco de 60 s.
- **La TV deduplica por turno.** Con el rellamado deja de ser cosmético: tres pulsaciones
  y el mismo paciente ocuparía el tablero entero.
- **La guía de despliegue decía «`/tv`: solo desde la red de la sede»** y mandaba ajustar un
  matcher `@redInterna` que **no existe** en el `Caddyfile` activo. La guía contradecía al
  archivo que corre.

---

## Pruebas

**315 unitarias (API) + 71 (shared) + 370 e2e de API + 53 de navegador**, todas en verde.
Las de navegador eran 42 al cerrar la fase 18. La cobertura de WebSocket y de
`GET /pantallas/:id/estado` pasa de **cero** a existir.

(`carga.e2e-spec.ts` sigue fallando a nivel de suite con sus ocho pruebas en verde: su
`afterAll` borra 100.000 pacientes y agota el tiempo bajo carga. Pasa aislada. Es de antes
de esta fase y no se toca.)

La suite nueva `tiempo-real.e2e-spec.ts` conecta un `socket.io-client` real contra la
aplicación escuchando en un puerto. No es ceremonia: **lo que falló durante seis fases fue
el transporte**, y un test que invocara los métodos del gateway a mano no lo habría tocado
nunca.

### Las mutaciones

Nueve comprobadas contra el código. Las que más dicen:

| Mutación | Qué pasó |
|---|---|
| **Quitar `path: '/tiempo-real'`** | Caen **9 pruebas**. Es el defecto exacto que estuvo seis fases en producción y hasta hoy no había nada que lo cazara |
| `elegirVozEspanola` cae a `voces[0]` en vez de `null` | Cae. Es la diferencia entre callarse y que un motor en inglés lea un nombre español a todo volumen en una sala de espera |
| `rellamar` sí toca `llamadoTs` | Cae. Sin esa prueba, la métrica de espera se corrompería a cada repetición sin que nadie relacionara las dos cosas |
| Borrado lógico sin filtrar en `/estado` | Caen 2. La segunda es la que cubre la tercera ruta de lectura, la que el diseño con `activo` habría olvidado |
| Quitar el filtro de día de `ultimosLlamados` | Cae |
| `deletrearCodigo` devuelve su entrada | Caen 5 |

### Dos pruebas mías que probaban lo contrario de lo que decían

- **El 400 por servicio inexistente usaba `derp` y `vitc`**, que *sí* existen en el catálogo
  de demostración con el que se siembra la base de pruebas. La prueba no habría pasado por
  la razón que dice — falló, y por eso se detectó.
- **La del rechazo del backoffice esperaba un acuse** que nunca llega: el gateway desconecta
  antes de emitirlo. Se cambió a esperar el cierre, que es la respuesta de verdad.

**Sin cobertura de audio en Playwright, a propósito:** exigiría captura de sonido, sería
lenta y escamosa, y el fallo que atraparía —que no suena— lo nota una persona en dos
segundos en la sede. Lo que sí se cubre es la interfaz de activación: que la franja
aparezca cuando toca, esté **enfocada** (sin eso el mando de un stick no puede pulsarla) y
**no tape el tablero**.

Y ahí apareció algo que conviene dejar escrito, porque cuesta un rato: **para
`AudioContext`, el valor por defecto de Chrome es `document-user-activation-required`**, no
el de los elementos de medios. Así que el navegador de serie de Playwright reproduce el
televisor **sin** configurar —el contexto arranca suspendido y la franja aparece—, y pasar
`--autoplay-policy=user-gesture-required` **afloja** la política en vez de endurecerla,
porque esa variante gobierna `<audio>` y `<video>` y no el `AudioContext`. La primera
versión de estas pruebas asumía lo contrario y fallaba en los dos sentidos a la vez.

Quedan dos proyectos: `tv` es el stick recién sacado de la caja (aparece la franja, está
enfocada y no tapa el tablero) y `tv-con-flag` el bien instalado, con
`--autoplay-policy=no-user-gesture-required`, que es el que documenta la guía. Cambiar los
argumentos del navegador obliga a otro worker, así que Playwright no lo permite dentro de un
`describe` — de ahí el archivo aparte, y la separación dice la verdad: son dos situaciones
de hardware, no dos casos del mismo escenario.

De camino, los seis campos del formulario de pantallas pasaron a tener `htmlFor`/`id`. No
estaban asociados a sus etiquetas, así que `getByLabel` no los encontraba — y lo que un
lector de pantalla no puede nombrar, tampoco puede usar.

Y una tercera prueba mía con una carrera de verdad: el helper que vaciaba la tabla borraba
las pantallas a clics, y `count()` alcanzaba a ver una fila que el `recargar()` en vuelo
estaba a punto de quitar. Ahora purga por la API; el borrado por interfaz se prueba aparte,
que es su sitio.

---

## Al desplegar

**Sin migración**, y comprobarlo con `prisma migrate status` es la forma de demostrarlo.

Se despliega en **dos releases**, y la separación es el punto:

1. **Solo la API.** Verificar en el acto que
   `curl https://provivir.exagos.co/tiempo-real/?EIO=4&transport=polling` devuelve el
   handshake y no un 404. Si no, el plan de retirada es enrutar `/socket.io` en Caddy, que
   son tres líneas y no toca la aplicación.
2. **El resto**, con los bundles.

Caddy solo cambia por la CSP: `validate` y luego `reload`, nunca `restart` — un error de
sintaxis en un `reload` deja corriendo la configuración vieja; en un `restart` deja el sitio
caído.

**La verificación que solo se puede hacer en la sede:** crear una pantalla, abrirla en el
televisor, pulsar OK en el mando y llamar un turno. Que el tablero cambie **sin esperar 60
segundos** es lo único que distingue el arreglo del sondeo de antes. Y volver a la mañana
siguiente: el tablero tiene que amanecer vacío.

## Lo que queda abierto

- **P10 · los enlaces de YouTube del cliente.** Esta fase deja el mecanismo de rotación
  correcto; sin los enlaces no hay nada que rotar, y RN-11.3 ya registra la rotación como
  riesgo aceptado por ambas partes.
- **La voz depende del aparato.** Si el stick no trae español, queda la campanita y la
  pantalla lo dice. No hay forma de saberlo sin probarlo en el televisor de la sede.
- **Un llamado emitido con la TV desconectada se pierde.** Al reconectar solo ve el
  refresco, que no anuncia. Es lo correcto —no queremos que grite tres turnos viejos al
  volver— pero conviene decirlo.
- **No hay QR del enlace.** Copiarlo resuelve enviarlo; no resuelve teclear un UUID en un
  mando. La CSP de `/tv` no permite scripts externos, así que sería una implementación
  propia.
- **Nadie ha llamado a un turno en producción todavía.** Hasta que ocurra, toda esta cadena
  está probada pero no usada.
