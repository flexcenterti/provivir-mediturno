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

**El bot recibe las fechas como dato**, igual que ya recibía la primera fecha agendable.

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

333 unitarias (API) · 91 (shared) · 416 e2e de API · las de navegador.

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
