# Changelog · FASE 14 — Sala compartida y vínculo con la ficha de prestador

**Estado:** desplegado en producción el 2026-09-04. 300 unitarias (API) + 39 (shared) + 281 e2e +
31 de navegador.

## Por qué

«Mi consulta» salía vacía para todos los perfiles: *«Este usuario no está asociado a
una ficha de prestador»*. Detrás había dos problemas distintos que se habían
confundido en uno, y un tercero que apareció al mirar.

## 1 · La asistente no podía gestionar la cola de nadie

La pantalla resolvía la cola por `usuario.prestadorId`, y una asistente **nunca puede
tenerlo**: ese vínculo está reservado a `rol = prestador` y es uno a uno con una ficha
(RN-06.2). No era un dato que faltara; era estructural.

Lo llamativo es que **todo lo demás ya estaba construido**. `llamar-siguiente` recibe
el prestador en el cuerpo y no lo contrasta con quien pulsa; el catálogo de permisos
dice literalmente que `turnos.atender` «lo usan asistentes y médicos» y el perfil base
Asistente ya lo traía; las pantallas de TV se resuelven por el servicio de la cita, no
por quién llamó; y la auditoría ya separaba actor de titular. Faltaba **solo la parte
de interfaz que eligiera de qué cola se trata**.

La regla, releída, tampoco lo prohibía: RN-07.3 restringe **el criterio de selección**
—al siguiente, no a quien uno quiera— no **quién pulsa**. Queda por escrito en
[`docs/rn-07-5-sala-compartida.md`](rn-07-5-sala-compartida.md).

### Una entrada, dos oficios

La misma entrada de menú se llama distinto según quién entre: con ficha, **«Mi
consulta»** abre tu cola exactamente como antes; sin ella, **«Sala de espera»** abre a
todos los que esperan, con el profesional en una columna más, y al elegir uno se abre
su cola con el botón de llamar.

Se adapta en el `.map` que ya filtraba el menú por permiso, no duplicando la entrada:
como el título de la barra superior se deriva de esa misma lista, se adapta solo.

**No hay botón de llamar en la vista de toda la sala, y no es un olvido.** El llamado
es siempre al siguiente de la cola de UN profesional: el DTO exige el prestador y sin
él no se sabe a qué consultorio pasa el paciente. La pantalla lo explica en vez de
dejar el hueco sin más.

`VistaPrestador` **no cambia de firma ni de comportamiento**: ya recibía solo un id y
no miraba la sesión, así que sirve tal cual. Solo se le extrajo la tabla para que la
sala la reutilice con la columna del profesional.

El desplegable de profesionales sale de la propia cola y no del catálogo: en la sala
solo tiene sentido abrir la de quien tiene gente esperando. Contrapartida honesta: no
se puede abrir la de un médico sin nadie en espera — donde el botón daría 404 igual.

### El cerrojo, que ahora sí hace falta

Con dos personas sobre la misma cola, ambas leían la lista, resolvían el mismo
paciente y las pantallas lo llamaban dos veces. Hasta ahora era imposible porque solo
una persona podía operar cada cola.

**Medido: sin cerrojo, seis llamados simultáneos devuelven el mismo turno las seis
veces.** No es un caso de laboratorio; es lo que pasa con dos clics seguidos.

`llamarSiguiente` toma un advisory lock transaccional y lee la cola **dentro** de la
transacción, con el mismo patrón del motor de citas. La clave lleva el prestador
dentro —dos médicos no se bloquean entre sí— y sufijo propio, para no serializar el
agendamiento con el llamado sin razón. Se prefirió al `updateMany` condicional porque
así la segunda persona obtiene **el siguiente** paciente, que es lo que quería, en vez
de un conflicto que no sabría interpretar.

*Detalle de método:* la primera versión de la prueba lanzaba **dos** peticiones y
pasaba igual con el cerrojo quitado — o sea que no probaba nada. Con dos, el
solapamiento no se da siempre. Con seis es determinista.

### La cola es la del día

`cola()` filtraba por estado y nada más, así que un turno abierto de un día para otro
seguía apareciendo indefinidamente. Con la cola de un médico apenas se nota; en la
vista de toda la sala sería lo primero que ve la asistente cada mañana, con «esperando
1.440 min».

Lo que esto **no** arregla, y conviene tenerlo escrito: el turno olvidado desaparece de
la vista pero **sigue vivo**, y su cita sigue en `llego`. Cerrarlo de verdad es el
cierre del día, que no existe.

## 2 · El vínculo con la ficha ya se puede corregir

Solo se fijaba **al crear** el usuario, y los usuarios no se borran —solo se
desactivan—. Así quedó atrapada en producción una cuenta con rol médico y sin ficha:
sin arreglo posible desde la interfaz.

La tabla de verdad de rol × ficha vive ahora en `acceso.reglas.ts`, **pura y con su
spec**, porque es exactamente donde se cuelan los errores:

- **médico sin ficha se rechaza** (RN-06.2), lo que cubre de un golpe promover a
  médico sin darle ficha y quitarle la ficha a uno que ya la tiene;
- **dejar de ser médico suelta la ficha sola**, en vez de exigir un baile de dos
  guardados que además no se puede hacer: el paso intermedio está prohibido por la
  regla anterior;
- **`undefined` no toca el vínculo y `null` lo quita.** Si se colapsaran, guardar el
  nombre de un médico le arrancaría su ficha. La distinción viaja comentada por el DTO
  y el cliente.

Con base delante se comprueba además que la ficha exista y que **no la tenga ya otra
cuenta**, nombrándola: sin eso, el índice único devuelve un P2002 y la persona ve un
500 sin saber qué pasó. Y el `data` del update se arma campo a campo, no volcando el
DTO: con el vínculo de por medio hay combinaciones que las reglas acaban de corregir.

El campo pasa de **texto libre a desplegable**. Antes había que teclear el id interno
(`hamm`, `krg`) y el ejemplo que sugería era `ao`, un médico que la purga de la fase
11 borró. Las fichas que ya tienen cuenta se muestran **bloqueadas y diciendo de
quién son**: ocultarlas haría pensar que no existen, y dejarlas elegibles convertía el
desplegable en una ruleta. Se piden con los desactivados incluidos, o un usuario atado
a una ficha ya retirada perdería el vínculo al guardar.

La edición reutiliza el formulario de alta con un modo edición, y **no** dos
desplegables sueltos en la tabla: pasar a Médico exige ficha en la **misma** petición,
y con dos guardados independientes no hay forma de llegar al estado final.

En la lista se ve ahora el vínculo de cada médico, o el aviso de que le falta.

## 3 · El médico sin ficha veía la sala entera

Apareció diseñando. `turnos.controller.ts` hacía
`usuario.rol === 'prestador' ? usuario.prestadorId : prestadorId`: si el rol era
médico **y no había ficha**, el filtro quedaba en `undefined` — y `cola()` sin
prestador devuelve **todas las colas**. La intención escrita, «un prestador solo ve su
propia cola», se invertía en silencio justo en el caso que existía en producción: esa
cuenta veía a todos los pacientes del día con nombre y apellido. La interfaz lo tapaba;
la API no.

Ahora devuelve lista vacía, y no un error, para que la pantalla de «cuenta sin ficha»
no salga con un rojo encima.

## De paso

El `upsert` del seed no incluía `prestadorId` en su rama de actualización, así que
re-sembrar sobre un usuario que ya existía sin ficha lo dejaba igual. Misma clase de
fallo que el de la API.

## Pruebas

`turnos.e2e-spec.ts` es nuevo: no había ninguna prueba de la cola contra base.
Ocho casos —la cola del día, quién ve qué cola, el llamado de la asistente con su
traza, y la carrera—. Ocho unitarias de la tabla de verdad del vínculo, ocho e2e de
acceso y tres de navegador.

**Las cuatro protecciones se comprobaron contra mutación**: quitar el filtro de fecha,
quitar el cerrojo, devolver la sala al médico sin ficha y saltarse la comprobación de
ficha ocupada. La del cerrojo es la que enseñó algo: con la prueba de dos peticiones
la mutación **no se detectaba**.

## Al desplegar

**Sin migración.** Solo API y backoffice.

Un detalle para quien lo pruebe: la sesión del navegador es una foto. Cuando
administración ate una ficha a un médico, esa persona verá su cola **al recargar la
pestaña** o al volver a entrar. Los permisos sí se resuelven en cada petición, así que
no hay incoherencia de acceso, solo de pantalla.

## Lo que queda fuera, a propósito

- **Cierre del día** que marque `ausente` los turnos que quedaron y `no_asistio` sus
  citas. Sería la primera vez que el sistema escribe esos estados —o sea que **define
  el ausentismo**— y no hay planificador. Por eso tampoco se bloquea llamar a un
  segundo paciente con uno sin finalizar: sin forma de marcar «no se presentó», la
  cola quedaría atascada.
- **Refresco en vivo.** `socket.io-client` ya es dependencia sin usar, Caddy ya proxya
  `/tiempo-real/*` y el CSP ya permite `wss://`. Falta el proxy de desarrollo y un
  hook de veinte líneas — pero `suscribir-backoffice` no valida token alguno y a esa
  sala se emite el llamado **con nombre de paciente**: hoy es una fuga latente porque
  nadie escucha, y conectarse la convertiría en un camino usado. Si entra, entra con
  el handshake autenticado.
- **Las cuentas de los médicos.** Los 21 profesionales del catálogo siguen sin
  usuario; ahora se pueden crear y corregir desde la pantalla, pero quiénes entran lo
  decide la clínica.

---

## El despliegue

Desplegado el 2026-09-04 sobre `provivir.exagos.co`, **sin migración**: solo la imagen
de la API y los tres frontends. Los datos, intactos —241 conversaciones, 25 citas, 20
profesionales—, que es lo esperable cuando no se toca el esquema.

Se verificó que lo desplegado es lo nuevo y no solo que la API responda: la guarda del
médico sin ficha, el cerrojo y el filtro de fecha están en el `dist` de la imagen que
corre, y el bundle servido trae los textos de la sala.

Y queda un caso vivo para probarlo de verdad: `prestador@prueba.provivir.local` sigue
en producción con rol médico y **sin ficha**. Es exactamente la cuenta que motivó todo
esto, y ahora se arregla desde Administración → Perfiles y usuarios → Editar.
