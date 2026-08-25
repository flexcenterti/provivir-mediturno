# Fase 9 · La sesión no se corta mientras se trabaja

**Fecha:** 25 de agosto de 2026 · posterior al alcance original.

## El problema, y su causa real

Las asistentes y los médicos pasan la jornada dentro del backoffice, y la sesión los expulsaba
**cada 15 minutos**, perdiendo lo que estuvieran escribiendo.

La causa no era el valor de 15 minutos: **la mitad del mecanismo nunca se construyó**.
`auth.service.ts` emitía un `refreshToken` desde la fase 0, pero no existía el endpoint que lo
canjeara y el backoffice lo tiraba al entrar, guardando solo el de acceso. Estaba anotado desde
entonces —`docs/changelog-fase0.md`, «Sin `refresh` endpoint… falta la rotación. Fase 1»— y nunca
se hizo, mientras la Arquitectura §125 prometía «JWT de corta vida + refresh».

**Decisión del equipo:** al cerrar el navegador se vuelve a pedir contraseña —la sesión sigue en
`sessionStorage`, que es lo prudente en los equipos compartidos del mostrador— y la sesión caduca a
las **8 horas de inactividad**. Mientras la persona trabaje, se renueva sola y no se corta nunca.

## Qué cambia

**`POST /auth/refresh`**, público, sin el límite estricto de `login` —ahí no se prueban
contraseñas—. Verifica, comprueba que el usuario siga activo y **devuelve un par nuevo**. Que rote
es lo que convierte las 8 h en una ventana deslizante: quien trabaja no la agota nunca.

**El token de refresco deja de valer como `Bearer`.** Los dos se firman con el mismo secreto y la
misma carga, así que hasta ahora eran intercambiables: guardar el de refresco en el navegador
habría equivalido a un token de acceso de 8 horas. Ahora la carga lleva `tipo`, `JwtStrategy`
rechaza los de refresco y el canje rechaza los de acceso.

**Los tokens viejos siguen valiendo como acceso.** Los emitidos antes de esta versión no traen
`tipo` y se tratan como de acceso a propósito: así el despliegue no echa a nadie que esté
trabajando. Para refrescar, en cambio, se exige la marca explícita.

**Cada refresco tiene identidad propia** (`jwtid`). Sin eso, dos firmados en el mismo segundo con
la misma carga salen **idénticos byte a byte** —lo descubrió la prueba e2e al comprobar la
rotación—, y el día que haya que detectar la reutilización de uno viejo no habría por dónde
agarrarlo.

**Duraciones editables desde Administración → Reglas**, sin desplegar: `sesion_ttl_acceso` (`1h`) y
`sesion_ttl_inactividad` (`8h`). Se validan contra `/^\d+[mhd]$/` y, si alguien escribe «dos
horas», se cae al valor de entorno y se avisa por log en vez de firmar una duración absurda. Los
respaldos de `.env` pasan de `15m`/`7d` a `1h`/`8h`.

**Renovación silenciosa en el backoffice.** Ante un 401, `api.ts` refresca y **repite la petición
original**; solo se cae al login si el refresco tampoco sirve. Con un cerrojo de una sola llamada
en vuelo: una pantalla con varios paneles lanza varias peticiones a la vez, y sin él todas pedirían
un token nuevo pisándose entre ellas. La carga de archivos, que va por `fetch` directo porque lleva
`FormData`, recibe el mismo trato: subir un CSV de 50.000 contactos justo cuando vence el token no
puede costar el archivo.

Y cuando la sesión sí cae, la aplicación **vuelve al login** en vez de dejar la vista a medias con
un error, que es lo que hacía.

## Lo que NO se hizo, a propósito

**No hay lista de revocación.** No existe estado de sesión en el servidor, así que un token de
refresco robado no se puede anular de a uno. La palanca sigue siendo **desactivar al usuario**, que
corta al instante porque `JwtStrategy` revalida contra la base en cada petición; para cortar a
todos, rotar `JWT_SECRET`. Inventar una tabla de sesiones para el piloto habría sido más superficie
sin una necesidad demostrada.

## Pruebas

- 10 unitarias (`auth.service.spec.ts`): un token de acceso no refresca, uno de refresco no abre
  rutas, un usuario desactivado no renueva, y las tres rutas de la duración —configuración manda,
  valor inválido cae al entorno, sin clave rige el entorno—.
- 5 e2e (`test/auth.e2e-spec.ts`): login → refresh → el acceso nuevo abre `/auth/yo`; el refresco
  como `Bearer` da 401; un acceso usado para refrescar da 401.
- Suite completa en verde: 253 unitarias, typecheck de API y backoffice, lint.
- **Pendiente**: las pruebas de navegador (Playwright), que recrean su base y necesitan aprobación
  explícita para correr.

## Cómo comprobarlo en la sede

Poner `sesion_ttl_acceso` en `1m` desde Administración → Reglas, dejar la pestaña abierta cinco
minutos trabajando y comprobar que no reaparece el login. Devolverlo a `1h` después.
