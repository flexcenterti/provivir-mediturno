# Changelog · FASE 20 — La sala de espera, con el reparto de la guía de televisión

**Estado:** desplegado en producción el 2026-09-05. **Una migración.** 318 unitarias (API) +
74 (shared) + 381 e2e + 60 de navegador.

## Por qué

El cliente encontró la guía de DirecTV en un televisor y mandó la foto: video en un
rectángulo, imágenes publicitarias en una franja inferior, y la lista de llamado en un
área más pequeña.

Dos de las tres cosas eran mover cajas. La tercera no existía en absoluto: **no había nada
de imágenes en el producto.** Ningún modelo que guardara una, ninguna extensión de imagen
aceptada en las subidas —`.csv`, `.txt` y `.md`, nada más—, una decisión escrita de que *lo
subido nunca se sirve como estático*, y Caddy sin montar siquiera esos volúmenes. Y el
televisor no tiene sesión, así que el único endpoint que sirve archivos hoy —el de
adjuntos de WhatsApp, que exige `bandeja.operar`— no le valía.

Lo que sí ayudó: la CSP de `/tv` ya permite `img-src 'self'`, así que sirviéndolas desde la
propia API **no hubo que tocar el Caddyfile ni el compose**.

### Decidido con el cliente

Se suben desde el backoffice · **las mismas en todos los televisores** · dos o tres fijas
lado a lado, sin rotación · **el turno actual sigue siendo lo más grande**.

---

## 1 · Los anuncios (RN-11.7)

`AnuncioSala`, colgando de la sede. **No `AnuncioPantalla`**: ese nombre habría invitado a
que alguien le añadiera `pantallaId` «porque el nombre lo pedía», y ahí se acababa lo de
«las mismas en todos los televisores».

**La subida va en memoria, no a disco**, y la razón no es la obvia: cuando salta
`limits.fileSize`, **multer deja el archivo parcial en disco** y la excepción la lanza el
interceptor, así que el manejador nunca llega a correr y no puede limpiarlo. En memoria no
hay nada que limpiar, y el archivo no toca el volumen hasta que la firma dice que es una
imagen. De paso desaparece el problema de mover el archivo entre dos volúmenes Docker
distintos, donde un `rename` habría fallado con `EXDEV`.

**Se valida por la firma del contenido, no por la extensión.** SVG queda fuera y es lo
importante: es XML, admite `<script>` y servido desde `/api` correría en el mismo origen
que la API. GIF también: un GIF animado es una rotación colada por el formato del archivo,
y la franja se decidió fija.

Tres detalles de las firmas que no son obvios, y que las pruebas fijan porque cada uno
rompería algo real: la de **JPEG son tres bytes** —el cuarto es el marcador y varía, así
que exigir cuatro rechazaría cualquier foto con EXIF—; **WebP necesita comprobar el `RIFF`
inicial *y* el `WEBP` de los bytes 8-11**, porque los de en medio son el tamaño del archivo
y un WAV o un AVI también son RIFF; y **la extensión canónica es una tabla y no un `split`
del MIME**, que daría `.jpeg` y rompería la guarda del nombre de archivo.

**El endpoint de la imagen es público a propósito** y así queda escrito, para que nadie lo
«arregle» con un permiso: eso dejaría la franja vacía en todos los televisores y la
miniatura del backoffice perfecta, que es la peor combinación para diagnosticarlo.

**La caché es un contrato.** Se sirve `public, max-age=31536000, immutable`, al revés que
el adjunto de un paciente. Es seguro porque un id apunta a un archivo fijo para siempre —
y por eso **no puede existir nunca un «reemplazar la imagen» que conserve el id**. Queda
escrito en el código, porque el día que alguien lo añada el televisor mostrará el anuncio
viejo hasta que se le borre el perfil del navegador.

El tope de cuatro se aplica **en los dos extremos y son garantías distintas**: al escribir
es un 409 con una carrera real, y al leer es un `take` que no tiene ninguna.

## 2 · El reparto de la pantalla

Los cuatro estados —con y sin video, con y sin anuncios— se declaran enteros y se eligen
por atributos de datos. Componer clases deja combinaciones sin CSS que solo se descubren
colgadas en una pared.

**Y arregla un defecto que llevaba desde la fase 3**: el grid era `1fr 1fr` aunque la
pantalla no tuviera video, así que media pantalla quedaba en negro.

**`.tv` pasa de `min-height: 100vh` a `height: 100vh` con `overflow: hidden`.** Un
televisor **no tiene barra de desplazamiento**: lo que desborda no es scrolleable, es
invisible, y nadie va a descubrirlo. Con altura fija el desbordamiento se convierte en un
apretón que se ve. Contrapartida aceptada: con `turnosVisibles` alto en una pantalla de
768 px, la lista se recorta.

**El código del turno pasa a `clamp()`.** A 1366 px —la resolución de la mayoría de los
sticks— ocupa unos 197 px sobre unos 300 útiles; con los `5rem` y `.06em` fijos de antes
eran ~288 px, o sea al filo.

## 3 · El reloj

No lo pediste explícitamente; está en la foto y son unas líneas. Si sobra, se quita.

**La hora la manda el servidor.** Los sticks HDMI baratos no traen reloj de batería y
arrancan con la zona horaria mal, y un reloj equivocado colgado en la pared de una sala de
espera es peor que no tener ninguno. Vale además como **indicador de vida**: un televisor
congelado es hoy indistinguible de una mañana tranquila.

`ahora` y `anuncios` viajan **fuera** del objeto `pantalla`, y eso no es cosmético: la TV
compara ese objeto para no reemplazar la configuración cuando no ha cambiado, y con la
hora dentro no coincidiría jamás — el reproductor de YouTube se recrearía cada 60 s y los
institucionales de más de un minuto no llegarían nunca a su final. Es exactamente el
defecto que esa comparación existe para evitar, y hay una prueba que lo caza desde la API.

## 4 · De camino

- **`subirArchivo` sale a `api.ts`.** Estaba copiado en dos vistas y los anuncios eran el
  tercer llamador — que es el mismo motivo por el que en el servidor se creó
  `opcionesSubida`.
- **Sin vista previa local en el backoffice**: su CSP es `img-src 'self' data:` **sin
  `blob:`**, así que un `URL.createObjectURL` quedaría bloqueado. No vale tocar una
  política de seguridad por una comodidad, y la miniatura real llega en menos de un
  segundo. Que la miniatura use **la misma ruta pública que el televisor** convierte esa
  vista previa en la prueba de que el televisor funciona.

---

## Pruebas

**318 unitarias (API) + 74 (shared) + 381 e2e de API + 60 de navegador**, todas en verde.
Las de navegador eran 53 al cerrar la fase 19.

Mutaciones comprobadas contra el código, no supuestas. Las que más dicen:

| Mutación | Qué pasó |
|---|---|
| Poner un permiso en el endpoint de la imagen | Caen 4 |
| `ahora` dentro de `pantalla` | Cae. Es un defecto **de la TV** que solo se puede cazar desde la API |
| Aceptar el archivo sin mirar la firma | Cae, y la aserción comprueba además que no quedó nada en disco |
| No borrar el archivo al retirar | Cae |
| Quitar el `nosniff` | Cae |
| Firma JPEG de cuatro bytes | Cae: rechazaría cualquier foto con EXIF |
| WebP comprobando solo el `RIFF` | Cae: un WAV pasaría por imagen |
| GIF en la lista blanca | Cae |
| Extensión por `split` del MIME | Cae |

**Una prueba mía que no probaba nada, otra vez:** la guarda de longitud de `tipoDeImagen`
era **código muerto** —`every` ya falla sola cuando la cabecera es corta, porque el índice
fuera de rango es `undefined`— y su comentario afirmaba lo contrario. La mutación
sobrevivió, se quitó el código y se reagrupó la prueba bajo una mutación que sí mata.

En navegador, las comparaciones de layout se hacen con `boundingBox()` y no con
`toHaveClass`: la clase puede estar puesta y el CSS no aplicarse, que es justo el fallo que
hay que cazar en un rediseño. Y **el reloj se prueba con el navegador puesto en Madrid**:
con el runner en Bogotá, cualquier implementación pasaría.

### Y dos pruebas de la fase 19 que resultaron inestables

Las dos de la franja de activación del sonido empezaron a fallar. Costó tres diagnósticos
equivocados llegar al motivo, y merece quedar escrito:

1. Primero pareció una fuga mía —la prueba nueva del backoffice dejaba un anuncio subido, y
   los anuncios son de sede, así que el proyecto del televisor se encontraba una franja que
   no había pedido—. Era real y se arregló, pero **no era la causa**.
2. Después pareció que las había roto el rediseño: con el código de la fase 19 la prueba
   pasaba y con el mío fallaba. Ese experimento estaba **mal hecho** —el `git stash` no
   movió nada porque los archivos ya estaban commiteados— y la conclusión, con una sola
   muestra, era falsa. Repetido en condiciones, **la fase 19 pura falla tres de tres**.
3. La causa: **Playwright reporta `navigator.userActivation.hasBeenActive === true` en una
   página recién cargada**, sin que nadie haya tocado nada. La política real de Chrome mira
   exactamente eso, así que el `AudioContext` arrancaba a veces `running` y a veces no,
   según el día.

Se arregla dejando de padecer la política del navegador y fijándola: un doble de
`AudioContext` que modela lo que hace Chrome —nace suspendido, y `resume()` solo prospera
tras un `pointerdown` de verdad—. Lo que estas pruebas tienen que verificar es **nuestra
rama de interfaz**, no la política de Chrome; que el audio se desbloquee en un stick de
verdad se comprueba en la sede, y así está escrito en la guía.

Con eso desaparece también el proyecto `tv-con-flag` que se había creado en la fase 19:
los dos caminos vuelven a un solo archivo y son deterministas.

---

## Al desplegar

**Una migración.** No se toca ni el `Caddyfile` ni el `docker-compose`: la CSP de `/tv` ya
permite `img-src 'self'` y el volumen `media` ya existe.

**La comprobación que hay que hacer y no suponer:** `anuncios/` es un subdirectorio
estrenado dentro de un volumen nombrado, y el contenedor corre como `node`. Un volumen
nombrado tapa lo que la imagen traiga en ese punto de montaje, así que hay que confirmar
que la carpeta se crea y con el dueño correcto. Se crea al vuelo en la primera subida, no
en el `Dockerfile`, precisamente por eso.

**Aviso operativo:** los anuncios viven en el volumen `media`, igual que los adjuntos de
WhatsApp. Sobreviven a los relevos, pero un `docker compose down -v` los borraría. Y
conviene confirmar que el respaldo de la base **también cubre ese volumen**; hoy
probablemente no.

## Lo que queda abierto

- **El material lo pone el cliente**, igual que los enlaces de YouTube de P10. Sin
  imágenes la franja no aparece, y eso está bien: el grid la colapsa en vez de dejar un
  hueco.
- **No hay rotación de anuncios.** La franja fija con orden es deliberadamente *no* un
  carrusel; el monorepo no tiene ni un `@keyframes`. Si la piden, es una fase propia con
  su decisión sobre distracción en sala.
- **Nadie aprueba el contenido.** Se van a poner anuncios de terceros al lado de nombres
  de pacientes: quién autoriza qué es un proceso de la clínica, no una función del
  software. Lo que sí aporta el sistema es que la auditoría deja escrito quién subió qué
  y cuándo.
- **Las fuentes siguen sin cargarse.** `--fm` y `--fd` apuntan a IBM Plex y Sora y no hay
  ni un `<link>` ni un `@font-face` en ningún `index.html` del monorepo: todo cae a
  `system-ui`. Es de antes de esta fase y no se toca aquí.

---

## El despliegue

Desplegado el 2026-09-05 a las 22:08. **Una migración**, y exactamente una: de 12 a 13.

### Verificado en vivo

- Las **cinco rutas nuevas** registradas: `GET/POST /pantallas/anuncios`,
  `DELETE`, `PATCH …/mover` y `GET …/imagen`.
- `anuncio_sala` creada y vacía. `/api/health/ready` en `ok`, contenedor `healthy`, sin
  errores ni 500 en el registro.
- **La forma de `/estado` es la correcta**, comprobada contra la pantalla real que la
  clínica ya tenía creada: `anuncios` y `ahora` salen al nivel superior y el objeto
  `pantalla` **no los lleva dentro**. Eso es lo que evita que el reproductor de YouTube se
  recree cada 60 s.
- La ruta pública de imágenes responde **404 y no 500** con un id inexistente, y listar o
  subir siguen exigiendo sesión (401).
- Bundles: backoffice `index-Drxi6gZ9.js` y TV `index-_5pAeNb5.js` cambiaron; **el portal
  quedó en `index-Duhw44L6.js`, el mismo de antes** — esta fase no lo toca. Sin `dist`
  anidado.
- Caddy no se tocó: la CSP de `/tv` sigue siendo `img-src 'self' data: https://i.ytimg.com`,
  que ya permitía las imágenes del mismo origen.
- Datos: 93 pacientes, 25 citas, 463 conversaciones, 6.414 mensajes — **uno más** que antes
  del relevo, tráfico real de WhatsApp durante la ventana.

### Lo que NO se pudo verificar, y hay que decirlo

**Que `media/anuncios` se cree bien es la trampa clásica de estrenar un subdirectorio
dentro de un volumen nombrado, y solo está verificada la precondición**: `/app/media`
existe, es `drwxr-xr-x node:node`, y el proceso corre como `uid=1000(node)`. Con eso el
`mkdir` debería prosperar, pero la carpeta no existe todavía porque se crea en la primera
subida, y subir exige credenciales de producción. **La primera imagen que suba la clínica
es la prueba**: si la miniatura aparece en el backoffice, está resuelto; si no, es esto.
