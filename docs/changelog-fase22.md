# Changelog · FASE 22 — Cuándo está abierto el autoagendamiento

**Estado:** en rama `fase-22-ventana-autoagendamiento`. **Sin migración.**

## Por qué

El cliente pidió *«un conjunto de reglas sobre los días y horas en los que está permitido
que el autoagendamiento se realice»*, con un menú en Administración para configurarlas, y
puso el límite del alcance en la misma frase: **solo aplica a la creación de citas nuevas;
las cancelaciones y modificaciones siempre estarán activas.**

Mandó la tabla de siete filas —el día en que se agenda determina qué días se pueden
reservar— con un `+N` anotado al margen en cada fila.

Hasta ahora la única regla era `agendamiento_anticipacion_dias`: cualquier día a partir de
mañana, a cualquier hora que tuviera la agenda.

## Lo que se entrega

**Cinco parámetros**, sembrados con los valores de la tabla y **encendidos desde el primer
momento**, como pediste. Nada está cableado: el interruptor apaga la regla entera en un
clic y devuelve el comportamiento anterior.

**Una pestaña «Autoagendamiento» en Administración** con la tabla en desplegables, los días
excluidos en casillas, los dos horarios, el interruptor — y, debajo, **el resultado de hoy
en texto**: «Hoy es viernes… Se puede reservar el martes 9 de septiembre». Siete filas de
días de la semana no dicen qué va a pasar.

**El portal deja de pedir que el paciente adivine.** El selector de fecha viene acotado a
la ventana vigente, que pide a un endpoint público nuevo, y lista los días sueltos cuando
la ventana tiene huecos. Y el vacío de cupos deja de mentir: antes decía «no hay horarios
disponibles ese día» cuando sí los había, solo que no para ese canal.

**El bot recibe las fechas y la franja como dato**, igual que ya recibía la primera fecha
agendable — y cuando la franja vacía la lista le dice al modelo por qué, en vez de un
«no hay disponibilidad» que le hacía contarle al paciente que la agenda estaba llena. Y
ofrece pasar con una asistente, escalando solo si el paciente acepta: hacerlo a la primera
llenaría la bandeja de quien solo estaba mirando fechas.

El detalle de las decisiones —el `+N` derivado y no guardado, el festivo que no puede abrir
la ventana antes que un día laborable, por qué las guardas no van en `validarCupo()`— está
en [RN-04.8](rn-04-8-ventana-de-autoagendamiento.md).

## Lo que NO se toca

`reprogramar`, `cancelar`, `validarCupo()`, `validarDiaLaborable` (RN-06.5), la
anticipación mínima y el motor de cupos. **El mostrador no se ve afectado por nada de esta
fase.**

Que reprogramar quede fuera no es una consecuencia feliz: las tres guardas viven al nivel
superior de `cupos()` y `crear()` precisamente porque `validarCupo()` lo comparten `crear`
y `reprogramar`, y ponerlas ahí las dejaría latentes sobre las reprogramaciones. Hay dos
pruebas cuya única razón de existir es que esa propiedad no se pierda.

## Las pruebas que esta fase rompía

Cinco suites agendaban por autoservicio para «mañana». **No se debilitaron ni se les cambió
la fecha** —eso las haría depender del día en que se ejecuten—: cada una declara que quiere
el autoagendamiento abierto, con un helper compartido que fija los parámetros y los
restaura. Así cada prueba sigue probando una sola cosa.

`portal.e2e-spec.ts` «el portal ofrece exactamente los mismos cupos que el backoffice» es
el caso especial: con la regla encendida **deja de ser cierto por diseño**, y se reescribió
para afirmar lo que ahora corresponde.

## Números

333 unitarias (API) · 91 (shared) · 421 e2e de API · 68 de navegador. Todo verde.

## Riesgos, con medidas de producción

**«Solo tardes» apaga más de la mitad de la clínica.** De las 27 franjas configuradas, **14
son solo de mañana**, 8 solo de tarde y 5 cruzan el mediodía. Con la franja de citas en
`12:00-23:59`, esas 14 no ofrecen un solo cupo por autoservicio. Es la consecuencia de la
regla, no un defecto; y la franja se cambia sin desplegar.

**Los sábados no son redundantes con que las ventanas acaben en viernes.** Hay 6 franjas de
sábado: la clínica trabaja el sábado y lo reserva para el mostrador. Por eso el sábado está
en «días excluidos».

**Las 27 agendas siguen bloqueadas** y no hay cupos por ningún canal. El efecto de esta
fase no se verá hasta que se desbloqueen — y entonces se sumarán dos restricciones a la
vez. Sigue siendo lo urgente, y sigue sin ser de esta fase.

**La caché de configuración es por proceso.** Hoy hay una sola instancia de la API.

## Después de desplegar

Abrir el portal y comprobar que **solo ofrece las fechas de la ventana y solo horarios de
tarde**, y que el mostrador sigue agendando cualquier día. Es la única verificación que
importa de verdad.

---

## El despliegue

Desplegado el 2026-09-06 a las 20:39. **Sin migración**, y `migrate status` lo confirma
contra la base real: siguen siendo 13, ninguna pendiente.

### Verificado en vivo

- **Las cinco claves sembradas solas** al arrancar, con los valores de la tabla: la
  configuración pasa de 31 a 36 parámetros. Nadie tuvo que tocar la base.
- **`GET /api/portal/ventana` registrada y respondiendo** por el dominio real. Hoy es
  domingo, así que rige la fila 7 —miércoles a viernes— y devuelve exactamente
  `2026-09-09`, `10` y `11`.
- **La regla muerde, y con el mensaje correcto.** Pedir cupos para mañana por el portal
  devuelve *«Por este medio puedes agendar del 2026-09-09 al 2026-09-11»*, no un «no hay
  horarios» que sería falso.
- `/api/health/ready` en `ok` (db, sede y configuración), contenedor `healthy`, **cero
  errores** en el registro de arranque.
- Bundles: backoffice `index-BM9gd5_d.js`, portal `index-tEhqizmz.js`. **La TV no cambia**
  —`index-_5pAeNb5.js`, el mismo de la fase 21—, que es lo que debía pasar. Sin `dist`
  anidado; los tres `index.html` apuntan al bundle nuevo servido por Caddy.
- Caddy no se tocó. Datos intactos: 98 pacientes, 25 citas, 27 agendas, 13 migraciones.
- Respaldo previo verificado **por contenido** antes de tocar nada: 12 363 líneas, 27
  bloques `COPY` y el marcador de cierre del volcado.

### Lo que NO se pudo verificar en vivo

**Que el mostrador siga agendando cualquier día.** No por un problema de la fase: con las
27 agendas bloqueadas, dentro de la ventana el portal devuelve `[]` igual que devolvería el
mostrador, así que la comprobación no distinguiría nada. Queda cubierta por la suite —una
prueba cuya única razón de existir es esa— y por la estructura: la guarda mira
`opciones.autoservicio`, que el controlador del backoffice no envía nunca.

**Y sigue pendiente lo de siempre:** las 27 agendas bloqueadas. Mientras sigan así no hay
autoservicio por ningún canal, y esta fase no se notará. Cuando se desbloqueen, se sumarán
dos restricciones a la vez —la ventana de días y la franja de tardes— y ahí es donde hay
que mirar si «solo tardes» deja fuera las 14 franjas de mañana.

---

## Segundo despliegue · el bot (2026-09-06, 23:01)

Solo API: sin migración y sin frontend —los tres bundles salen idénticos a los que ya
servía Caddy, que es lo que debía pasar—.

- Código nuevo confirmado **dentro del contenedor**: la regla de escalada en
  `ia.prompt.js`, y `motivoSinDisponibilidad` con su sondeo en `ia.service.js`.
- `/api/health/ready` en `ok` (db, sede, configuración), contenedor `healthy`, **cero
  errores** en el arranque —las dos coincidencias del registro son las rutas
  `errores.csv`—.
- `/api/portal/ventana` sigue devolviendo del 9 al 11 de septiembre.
- Datos intactos y con tráfico real: 100 pacientes (dos nuevos desde el despliegue de la
  tarde), 25 citas, 27 agendas, 36 parámetros.
- Respaldo previo verificado por contenido: 12 474 líneas, 27 bloques `COPY`, marcador de
  cierre.
