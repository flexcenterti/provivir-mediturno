# RN-11.7 · Anuncios en la sala de espera

**Estado:** implementada (fase 20). Extiende RN-11.

El cliente mandó una foto de la guía de DirecTV en un televisor: video en un rectángulo,
publicidad en una franja inferior y la lista en un área más pequeña. Esta regla cubre la
parte que no existía en absoluto — **la publicidad** —, y las decisiones que no se pueden
rederivar del código.

---

## La regla

1. **Los anuncios son de la sede, no de la pantalla.** Los mismos en todos los
   televisores. Por eso el modelo se llama `AnuncioSala` y **no tiene `pantallaId`**: el
   día que un anuncio tenga que salir en un solo televisor, eso es un modelo distinto y
   no una columna más. Un nombre como `AnuncioPantalla` habría invitado a añadirla.
2. **Cuatro como máximo.** Cinco carteles lado a lado en un televisor visto desde tres
   metros no se leen. El tope se aplica **en los dos extremos, y son garantías
   distintas**: al escribir es un 409 que tiene una carrera real —dos administradores
   subiendo a la vez pasan los dos el conteo—, y al leer es un `take` que no tiene
   ninguna. Si por la vía que sea acaban existiendo diez, el televisor muestra cuatro.
3. **Fijos, no rotando.** Se ven todos a la vez, en el orden que fije el operador. Quién
   va a la izquierda es una decisión comercial, y por eso hay una columna `orden` y no
   un `ORDER BY creadoEn`.
4. **Sin recortar.** `object-fit: contain` y nunca `cover`: un anuncio es una composición
   con un logo y un teléfono en los bordes, y `cover` recorta justo lo que el anunciante
   pagó. Se prefiere la banda blanca al anuncio mutilado.
5. **Un anuncio que no carga sale de la franja entera.** Dos carteles se ven bien; dos
   carteles y un icono de imagen rota colgado en la pared, no. Y si caen todos, la franja
   desaparece en vez de dejar una banda negra que parece una avería del televisor.

## El endpoint es público, y tiene que serlo

`GET /api/pantallas/anuncios/:id/imagen` **no exige sesión**. No hay alternativa: el
televisor no tiene ninguna, y por eso el único endpoint que hoy sirve archivos —el de
adjuntos de WhatsApp— no le vale.

Y no hay nada que proteger: es publicidad que la clínica quiere que se vea. Queda escrito
aquí para que nadie lo «arregle» más tarde poniéndole un permiso, que dejaría **la franja
vacía en todos los televisores y la miniatura del backoffice perfecta** — la peor
combinación posible para diagnosticarlo.

**Es la primera vez que este sistema sirve bytes subidos por un usuario desde una ruta
pública sin autenticar.** Es una clase de superficie nueva, no una más, y las cuatro
piezas que la cierran no son prescindibles por separado:

- **La firma del archivo**, no su extensión. La lista blanca de las subidas mira el nombre
  que mandó el navegador, y cualquier cosa llamada `.png` pasaría. **SVG queda fuera y es
  lo importante**: es XML, admite `<script>`, no tiene firma que olfatear, y servido desde
  `/api` correría en el mismo origen que la API. GIF también queda fuera: un GIF animado
  es una rotación colada por el formato, y la franja se decidió fija.
- **El MIME que se guarda es el olfateado**, y es el que se sirve. Un solo hecho, no dos
  que puedan divergir. Y se vuelve a filtrar contra la lista blanca a la salida, para que
  una fila corrupta no pueda producir `text/html`.
- **La tabla guarda solo el nombre del archivo, nunca una ruta.** La travesía de
  directorios se vuelve imposible por construcción; `Mensaje.mediaPath` guarda la ruta
  entera y por eso necesita una guarda. Aun así hay dos: el patrón del nombre y la
  comprobación de que lo resuelto cae dentro del directorio — la segunda es la que sigue
  en pie si alguien relaja la primera.
- **`X-Content-Type-Options: nosniff`** en la respuesta, y no confiando en que lo ponga
  el proxy: en desarrollo y en las pruebas la API se alcanza en `:3000`, donde no hay
  Caddy.

### La caché es un contrato

Se sirve con `Cache-Control: public, max-age=31536000, immutable`, justo al revés que el
adjunto de un paciente, que es `private, no-store`. Un cartel es público e **inmutable**:
un id apunta a un archivo fijo para siempre.

**Y eso impone una regla que hay que respetar: no puede existir nunca un «reemplazar la
imagen de este anuncio» que conserve el id.** Sustituir es retirar y subir, lo que genera
un id nuevo. Si alguien añade el reemplazo en sitio, el televisor mostrará el anuncio
viejo hasta que se le borre el perfil del navegador, y eso se diagnostica pésimamente
desde una sala de espera.

### Sin auditoría por petición

El adjunto de WhatsApp se audita porque abrir el soporte de un paciente es un hecho de
privacidad sobre una persona concreta. Un cartel no tiene titular, y el televisor lo pide
en cada recarga y en cada reinicio del kiosko: auditar eso llenaría la tabla de filas que
dicen «alguien miró el cartel de la farmacia» y **diluiría la señal** de los hechos que sí
importan.

Lo que sí se audita son las mutaciones —subir, retirar, reordenar— con el usuario, el
nombre original, el tipo y el tamaño. Esa es la pregunta que alguien va a hacer de verdad:
**«¿quién puso ese anuncio ahí?»**.

## Cómo se ve, y qué recomendarle al cliente

Tres anuncios en una franja de 1920 px dan unos 440 × 162 px cada uno.

> **1200 × 480 px (proporción 5:2), PNG o JPG, menos de 2 MB.** Fondo blanco o claro —la
> franja es blanca, así que un fondo transparente con letras blancas queda ilegible—.
> Texto grande: quien lo lee está a cuatro metros. **Los tres con la misma proporción**, o
> quedarán con bandas de distinto grosor y parecerá un fallo.

## Lo que también cambió en el televisor

- **`.tv` pasa de `min-height: 100vh` a `height: 100vh` con `overflow: hidden`.** Un
  televisor **no tiene barra de desplazamiento**: lo que desborda no es scrolleable, es
  invisible, y nadie va a descubrirlo porque nadie mira de cerca una pantalla de sala. Con
  altura fija el desbordamiento se convierte en un apretón que se ve. La consecuencia
  aceptada: con `turnosVisibles` alto en una pantalla de 768 px, la lista se recorta.
- **Los cuatro estados del cuerpo** —con y sin video, con y sin anuncios— se declaran
  enteros y se eligen por atributos de datos. Componer clases deja combinaciones sin CSS
  que solo se descubren colgadas en una pared. **De paso arregla un defecto que llevaba
  ahí desde la fase 3**: el grid era `1fr 1fr` aunque la pantalla no tuviera video, así
  que media pantalla quedaba en negro.
- **El reloj toma la hora del servidor**, que viaja en el estado **fuera** del objeto
  `pantalla`. Los sticks HDMI baratos no traen reloj de batería y arrancan con la zona
  horaria mal, y un reloj equivocado colgado en la pared es peor que no tener ninguno.
  Vale además como indicador de vida: un televisor congelado es indistinguible de una
  mañana tranquila, y un reloj que avanza lo distingue de un vistazo.

  Que `ahora` y `anuncios` vayan **fuera** de `pantalla` no es cosmético: la TV compara ese
  objeto para no reemplazar la configuración cuando no ha cambiado, y con la hora dentro
  no coincidiría jamás — el reproductor de YouTube se recrearía cada 60 s y los videos
  institucionales de más de un minuto no llegarían nunca a su final. Es exactamente el
  defecto que esa comparación existe para evitar.
