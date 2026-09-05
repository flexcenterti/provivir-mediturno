# RN-06.6 y RN-06.7 · Editar y retirar franjas de agenda

**Estado:** implementadas (fase 21). Extienden RN-06, que desde el principio dice que
administración puede *«crear, **modificar**, bloquear o **eliminar**»* disponibilidad —
las dos palabras del medio no estaban implementadas.

---

## El punto de partida, medido

Solo se podía **crear** una franja y **bloquearla**. La consecuencia estaba a la vista en
producción el 2026-09-05: **las 27 agendas bloqueadas**, ninguna generando cupos, y los
motivos contando la historia entera:

| Motivo escrito por el operador | Veces |
|---|---|
| `AJUSTAR BLOQUEO POR DIAS` | 10 |
| `3226116545` (un teléfono, para pasar el campo obligatorio) | 10 |
| `NO DISPONIBLE` | 4 |
| `NO ATIENDE LOS SABADOS` | 1 |

«Ajustar bloqueo por días» y «no atiende los sábados» son literalmente esta funcionalidad
pedida a gritos: querían **quitar un día** y lo único que había era apagar la franja
entera. En dos días se registraron 31 bloqueos y 4 desbloqueos.

El propio cargador del catálogo lo decía en su cabecera: *«la interfaz no tiene forma de
corregir ni borrar una agenda (solo bloquearla): una franja mal tecleada se queda para
siempre»*.

---

## RN-06.6 · Cambiar o retirar una franja con citas dentro

**Una cita creada no se vuelve a validar contra la agenda. Nunca.** Se valida al crear y
al reprogramar, y ninguna consulta del sistema cruza `Cita` con `Agenda`. Por eso recortar
una franja no rompe nada visible: la cita se sigue atendiendo, sale en el mostrador y en
la cola del médico. Lo que se pierde en silencio es la **posibilidad de moverla**.

De ahí la regla:

1. **Antes de aplicar, se muestra qué citas quedarían fuera**, y solo entonces se guarda.
   Es el mismo gesto que «Bloquear agenda» y que cerrar un día, así que la asistente ya lo
   conoce.
2. **Afectada significa una cosa concreta**: *después del cambio, ninguna franja vigente
   del prestador la contiene*. No «cabía antes y no cabe ahora». La diferencia no es
   teórica —
   - contempla el **rescate por otra franja** del mismo médico (mañana y tarde) sin código
     extra;
   - sirve igual para editar, retirar y bloquear, con un solo cálculo;
   - y sobre todo **es, por construcción, «`validarCupo` la rechazaría ahora»**, así que la
     previsualización no puede divergir de la validación. Hay una prueba que lo ata: lo que
     se declara no afectado tiene que poder reprogramarse después del cambio, y lo
     declarado afectado, no.
3. **Las candidatas se recogen con un predicado distinto del de validación**, y esto es lo
   más fácil de hacer mal. «¿Cabe aquí?» y «¿vive aquí dentro?» no son la misma pregunta:
   una cita desalineada —creada cuando el `slotMin` era otro— o que desborda el cierre **no
   cabe** pero **sí está ahí**. Usar el predicado estricto para recoger candidatas
   **sub-reportaría el impacto**, que es el peor fallo posible en un diálogo de
   confirmación.
4. **Las huérfanas previas se reportan, pero marcadas.** El operador lee «3 salen de la
   franja · 1 ya estaba fuera antes de este cambio» en vez de creer que su edición rompió
   las cuatro. Esconderlas sería peor: aplicaría el cambio y dejaría a un paciente sin cupo
   reprogramable sin que nadie lo supiera.
5. **Ampliar no pide confirmación.** Si el cambio no deja a nadie fuera, se aplica directo.
   Cobrar un clic extra por ampliar media hora es lo que enseña a confirmar sin leer.
6. **El conteo nunca se trunca; la lista sí.** Se listan las primeras 50 y se dice cuántas
   hay. Sub-reportar el radio de impacto es inaceptable; pintar 300 filas en un modal es
   inútil.
7. **Cuentan todas las citas reprogramables**, que es `estado ∉ {cancelada, atendida}` —
   el mismo criterio que aplica `reprogramar`. El detector de bloqueos usaba
   `pendiente_llegada|confirmada` y dejaba fuera a quien ya está en sala, que sigue siendo
   reprogramable. **Eso cambia también el impacto que reporta el bloqueo**, y es una
   corrección, no un efecto colateral.

### Retirar es una baja lógica, no un borrado

`activa: false`, que ya filtraban las dos rutas de lectura y que nadie escribía nunca. No
es un borrado: es una transición de estado **con inversa** —de ahí que sea un `POST
/:id/retirar` y no un `DELETE`, y de ahí que exista `reactivar` y una casilla «Ver
retiradas»—. Un borrado lógico sin camino de vuelta es el peor de los dos mundos: paga el
coste de la fila muerta y no cobra el de poder deshacer.

**No sobrevive a reejecutar el cargador del catálogo**, que hace `deleteMany` por
prestador y recrea las franjas. Tampoco sobrevivían las activas: no es una regresión, pero
conviene saberlo.

**`prestadorId` no se puede cambiar.** Mover una franja a otro médico no es corregirla: es
retirar una y crear otra, con otro impacto sobre otras citas.

---

## RN-06.7 · Dos franjas del mismo prestador no se pisan

Nunca se validó. Cuando dos se pisan, **el portal ofrece la misma hora dos veces** —
`cupos()` recorre cada franja por separado y no deduplica dentro de un prestador— y con
`slotMin` distintos salen además horas desalineadas entre sí. Poder editar horarios lo
vuelve trivial de provocar, así que se cierra ahora.

- **El borde es semiabierto**, `[ini, fin)`. La jornada partida del catálogo real es
  07:00–12:00 y 12:30–16:30: tocarse no es solaparse, y un `<=` de más impediría sembrar el
  catálogo.
- **Solo dentro del mismo modo.** Rechazar también el cruce semanal × calendario cerraría
  la única forma que hoy existe de decir «ese jueves concreto atiende de 8 a 10»: bloquear
  apagaría todos los jueves y `DiaNoLaborable` cierra la sede entera. Mientras no haya
  precedencia de calendario sobre semanal, dejar al operador sin remedio es peor que el
  riesgo — y hoy el catálogo es todo semanal, así que ese riesgo es cero.
- **Contra las bloqueadas no se valida**: no generan cupos, y hacerlo rompería el flujo
  real de «bloqueo la vieja, creo la nueva». Contra las retiradas tampoco, o retirar una
  franja no serviría para sustituirla.
- **`desbloquear` no valida.** Deshacer un bloqueo tiene que funcionar siempre. Queda como
  el camino conocido por el que todavía se puede llegar a un solape.

---

## Lo que queda pendiente y por qué

- **`programacionMensual` con «Reemplazar» borra agendas en duro y sin previsualización**,
  y la casilla viene marcada por defecto. Es el único sitio que destruye franjas por la
  API, y contradice el «Retirar» recuperable y con aviso que esta fase entrega. Cablearle
  el mismo cálculo de impacto son unas quince líneas, pero tocaría además el camino
  transaccional de la programación masiva, que tampoco tiene pruebas. **Fase propia.**
- **Las citas huérfanas que ya existan no se detectan.** Esta fase evita crear nuevas; no
  encuentra las viejas. Un informe de «citas fuera de la agenda de su prestador» sería
  útil.
- **La ocupación del tablero cae a 0 % si un día se queda sin franja**, con citas dentro:
  `porcentajeOcupacion` devuelve 0 cuando los minutos de jornada son 0. Ya pasaba con el
  bloqueo; retirar lo hará más frecuente. Arreglarlo bien exige relacionar `Cita` con
  `Agenda`, que es la causa raíz de todo este documento y merece su propia decisión.
