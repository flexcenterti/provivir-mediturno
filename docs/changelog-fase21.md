# Changelog · FASE 21 — Editar y retirar agendas de prestador

**Estado:** desplegado en producción el 2026-09-05. **Sin migración.** 333 unitarias (API) +
74 (shared) + 404 e2e + 64 de navegador.

## Por qué

El cliente pidió un botón para editar la agenda de un prestador: adicionar, modificar y
eliminar días y horas de atención. Mandó una captura del formulario de «Nueva agenda» con
el botón cambiado a «Guardar» y los chips de días y las horas marcados en naranja.

Al mirar producción quedó claro que no era una mejora, era un atasco. **Las 27 agendas
estaban bloqueadas** y por tanto no había ni un cupo disponible por ningún canal. Los
motivos que la clínica escribió lo cuentan solo:

| Motivo | Veces |
|---|---|
| `AJUSTAR BLOQUEO POR DIAS` | 10 |
| `3226116545` — un teléfono, para pasar el campo obligatorio | 10 |
| `NO DISPONIBLE` | 4 |
| `NO ATIENDE LOS SABADOS` | 1 |

Querían **quitar un día** y lo único que tenían era apagar la franja entera. 31 bloqueos y
4 desbloqueos en dos días. El efecto se ve en las citas: el 4 de septiembre se agendaron
19 por autoservicio; el 5, una.

Y el cargador del catálogo ya lo decía en su cabecera: *«la interfaz no tiene forma de
corregir ni borrar una agenda (solo bloquearla): una franja mal tecleada se queda para
siempre»*.

---

## 1 · Dos predicados, no uno

Lo primero que hubo que arreglar fue una confusión mía, y merece quedar escrita porque es
el error natural aquí.

La condición «¿cabe este cupo en esta franja?» estaba escrita **dos veces palabra por
palabra** en `citas.service.ts`, y una **tercera, distinta y más laxa**, en el detector de
citas afectadas por un bloqueo. Mi plan decía «extraer una función y usarla en los tres
sitios». **Eso habría estado mal.**

Son dos preguntas distintas:

- **`cabeEnFranja`** — ¿es *legal* este cupo aquí? Rango, duración y alineamiento al slot.
  Es lo que valida al crear y al reprogramar.
- **`intersectaFranja`** — ¿*vive* aquí dentro? Una cita desalineada —creada cuando el
  `slotMin` era otro— o que desborda el cierre **no cabe** pero **sí está ahí**.

Para calcular qué se rompe al quitar una franja hay que preguntar lo segundo. Usar el
predicado estricto **sub-reportaría el impacto en un diálogo de confirmación**, que es el
único error imperdonable de esta funcionalidad.

`cabeEnFranja` vive en `citas.reglas.ts`, pegado a `generarCupos`, porque es el predicado
de pertenencia del conjunto que ese generador produce. La prueba que los ata —*todo cupo
generado cabe, y todo cupo que cabe se genera*— mata cualquier `<=` ↔ `<` en **una sola**
de las dos, que es exactamente cómo el motor y la validación se separarían con el tiempo.

## 2 · El impacto, formulado al revés de lo que parece

No es «cabía en la franja vieja y no cabe en la nueva», sino:

> **Afectada ⟺ después del cambio, ninguna franja vigente del prestador la contiene.**

Tres cosas salen gratis de plantearlo así y ninguna salía de la otra forma: el **rescate
por otra franja** del mismo médico (mañana y tarde), **un solo cálculo para editar,
retirar y bloquear**, y —lo que importa— que sea **por construcción** «`validarCupo` la
rechazaría ahora». La previsualización no puede divergir de la validación porque es la
misma pregunta.

Hay una prueba que lo ata y es la que hace falsa la frase «la previsualización miente»: lo
declarado no afectado tiene que poder reprogramarse después del cambio, y lo declarado
afectado, no.

Detalles que decidieron su forma:

- **Ampliar no pide confirmación.** Cobrar un clic extra por ampliar media hora enseña a
  confirmar sin leer.
- **Mover el inicio diez minutos cuenta como impacto**, aunque el rango siga conteniendo
  las citas: desde las 07:10 las 08:00 ya no es múltiplo de 15, y esa cita deja de poder
  moverse. Es el caso que nadie ve venir.
- **Las huérfanas previas se reportan marcadas**, no escondidas. El operador lee «3 salen
  de la franja · 1 ya estaba fuera antes de este cambio».
- **El conteo nunca se trunca; la lista sí** (50 filas).
- **Cuentan todas las citas reprogramables** —`estado ∉ {cancelada, atendida}`—, que es el
  criterio de `reprogramar`. El detector de bloqueos dejaba fuera a quien ya está en sala.
  **Eso cambia también lo que reporta el bloqueo**, y es una corrección.

## 3 · Retirar es una baja lógica con vuelta

`activa: false`, un campo que ya filtraban las dos rutas de lectura y que **nadie escribía
nunca**. No es un borrado: es una transición con inversa, de ahí `POST /:id/retirar` en vez
de `DELETE`, más `reactivar` y una casilla «Ver retiradas». Un borrado lógico sin camino de
vuelta paga el coste de la fila muerta sin cobrar el de poder deshacer.

## 4 · El solapamiento, que nunca se validó

Cuando dos franjas del mismo prestador se pisan, **el portal ofrece la misma hora dos
veces**. Se cierra al crear y al editar, con tres matices que importan: el borde es
semiabierto —la jornada partida del catálogo es 07:00–12:00 y 12:30–16:30, y un `<=` de más
impediría sembrarlo—, solo dentro del mismo modo —rechazar el cruce semanal × calendario
cerraría la única forma de decir «ese jueves atiende de 8 a 10»— y no contra las bloqueadas
ni las retiradas, o se rompería «bloqueo la vieja, creo la nueva».

**Comprobado antes de construirlo: en producción no hay ni un solape**, así que la regla
nueva no deja ninguna franja ineditable.

## 5 · La interfaz

Botón «Editar» por fila, el mismo formulario con el título y el botón cambiados como pedía
la captura, y el selector de prestador deshabilitado al editar.

**El panel de impacto aparece dentro del propio modal**, y la razón no es estética:
«Volver a editar» conserva lo tecleado. Con un segundo modal encima, cancelar tira el
formulario entero. «Retirar franja» va bajo un separador, lejos del botón primario que se
pulsa por reflejo.

---

## Pruebas

El gobierno de agendas tenía **cero cobertura**: ni una prueba del servicio ni por HTTP.
Ahora **333 unitarias (API) + 74 (shared) + 404 e2e + 64 de navegador**, todas en verde.

Mutaciones comprobadas contra el código. Las que más dicen:

| Mutación | Qué pasó |
|---|---|
| Recoger candidatas con el predicado estricto | Cae. **Es el error que casi cometo** |
| Aplicar el cambio durante la simulación | Caen 2 |
| Volver al filtro `pendiente_llegada\|confirmada` | Cae: quien ya llegó dejaba de contar |
| Solape sin excluir la propia fila | Caen 10 |
| Incluir las bloqueadas en el solape | Cae |
| Retirar con `bloqueada` en vez de `activa` | Cae |
| `<=` en el cruce de rangos | Cae: la jornada partida dejaría de poder crearse |
| Relajar solo `cabeEnFranja` y no el generador | Caen 2, por la propiedad que los ata |
| Alinear contra medianoche | Caen 3 |

**Dos mutaciones mías fueron incompletas y una prueba no probaba nada:**

- La de la duración usaba una hora que además estaba **desalineada**, así que la cazaba el
  otro chequeo. Ahora usa una alineada que se pasa del cierre.
- La primera versión de la mutación del predicado laxo cambió **solo una de las dos ramas**
  del filtro, así que sobrevivió por un camino que seguía intacto. Con las dos, muere.

---

## Al desplegar

**Sin migración.** El refactor de `validarCupo` va en su propio commit, con las 187 pruebas
de citas, portal, whatsapp y catálogo real en verde antes y después.

Después: editar una franja real desde el backoffice y comprobar que el cambio se refleja
en los cupos.

**Y lo urgente, que no es de esta fase:** las 27 agendas siguen bloqueadas. Con el botón de
editar ya no hace falta bloquear para quitar un día, así que toca revisarlas una por una y
desbloquear lo que deba estar abierto. Mientras sigan así, no hay autoservicio.

## Lo que queda abierto

- **`programacionMensual` con «Reemplazar» borra en duro y sin previsualización**, con la
  casilla marcada por defecto. Contradice el «Retirar» que esta fase entrega. Fase propia.
- **Las citas huérfanas que ya existan no se detectan.** Esta fase evita crear nuevas.
- **La ocupación cae a 0 % si un día se queda sin franja** teniendo citas. Ya pasaba con el
  bloqueo; arreglarlo exige relacionar `Cita` con `Agenda`.

---

## El despliegue

Desplegado el 2026-09-05 a las 18:50. **Sin migración**, y `migrate status` lo confirma
contra la base real: siguen siendo 13, ninguna pendiente.

### Verificado en vivo

- Las **tres rutas nuevas** registradas: `PATCH /agendas/:id`, `POST /:id/retirar` y
  `POST /:id/reactivar`.
- `/api/health/ready` en `ok`, contenedor `healthy`, **cero errores** en el registro.
- Bundle del backoffice `index-BFzsO_6b.js`; **la TV y el portal no cambian**, que es lo
  que debía pasar. Sin `dist` anidado.
- Caddy no se tocó.
- Datos intactos salvo el tráfico real de la ventana: 93 pacientes, 25 citas, 27 agendas,
  13 migraciones.

### Lo que el despliegue NO hace

**Las 27 agendas siguen bloqueadas y sin ofrecer un solo cupo.** Esta fase entrega la
herramienta, no la corrección: hay que revisarlas una por una y desbloquear lo que deba
estar abierto. Lo que cambia es que a partir de ahora quitar un sábado o corregir una hora
ya no exige apagar la franja entera — y al hacerlo se ve por delante qué citas quedarían
fuera.
