# RN-06.5 · Días no laborables (festivos y cierres)

**Origen:** al cargar los horarios reales, la clínica anotó «no atendemos domingos ni festivos»
(septiembre de 2026). Los domingos se resuelven solos —no se programan— pero los festivos no
existían como concepto en el sistema.

**Estado:** implementada (fase 11).

**Extiende:** RN-06, gobierno de agendas. RN-06.4 son los modos de disponibilidad; esto es la
excepción por día.

---

## Por qué

Sin esto el sistema ofrecía cupos el 25 de diciembre, el 1 de enero y los ~18 festivos
colombianos del año, con toda naturalidad: las agendas son semanales y el lunes de Reyes es un
lunes como cualquier otro.

**El bloqueo de agenda existente no sirve como sustituto.** `Agenda.bloqueada` es un booleano
sobre la fila, sin fecha: bloquear una agenda semanal la apaga *todos* los lunes, para siempre, no
un lunes concreto. Aquí la unidad tiene que ser el día, no la franja.

---

## Regla

**RN-06.5.1** · Un día marcado como no laborable **no ofrece ni acepta citas por ningún canal**.

**RN-06.5.2** · **No tiene excepción de canal.** A diferencia de RN-04.6 —donde el mostrador sí
puede agendar para hoy— aquí tampoco puede: si la clínica está cerrada, no hay nadie que atienda.
Si deciden abrir un festivo, administración quita esa fecha del calendario.

**RN-06.5.3** · Se distinguen dos tipos: **festivo** (nacional, se importa calculado) y **cierre**
(propio de la clínica: inventario, capacitación, mantenimiento).

**RN-06.5.4** · El rechazo dice **por qué** — «No atendemos el 2026-12-25: Navidad» — no «no hay
horarios», que sería falso y mandaría al paciente a probar otras horas del mismo día.

**RN-06.5.5** · Cerrar un día con citas ya agendadas **muestra primero a cuántas afecta** y solo
entonces confirma, igual que el bloqueo de agendas (RN-06.3). Las citas **no se cancelan solas**:
quedan para que una asistente las reprograme.

**RN-06.5.6** · Los domingos no se modelan aquí: sencillamente no se programan agendas para el
día 7. Marcarlos uno a uno sería ruido.

---

## Festivos de Colombia

Se calculan, no se listan: son dieciocho al año y **doce se mueven**.

| Grupo | Cuántos | Traslado |
|---|---|---|
| Fijos | 6 | ninguno — 1 ene, 1 may, 20 jul, 7 ago, 8 dic, 25 dic |
| Ley Emiliani (Ley 51 de 1983) | 7 | al **lunes siguiente** si no caen en lunes |
| Jueves y Viernes Santo | 2 | ninguno |
| Ascensión, Corpus Christi, Sagrado Corazón | 3 | al **lunes siguiente** |

La Pascua se calcula con el algoritmo de Meeus/Butcher. Todo vive en
`packages/shared/src/festivos.ts`, como función pura con pruebas contra años reales.

**Dos festivos pueden caer el mismo día** y entonces son un solo día cerrado: en 2025 San Pedro
(domingo 29 de junio) y el Sagrado Corazón (viernes 27) se corren ambos al lunes 30, y ese año
tiene 17 días festivos, no 18. La función los fusiona; sin eso la carga chocaría contra el único
`(sede, fecha)`.

---

## Dónde vive

| Pieza | Dónde |
|---|---|
| Cálculo de festivos | `packages/shared/src/festivos.ts` (puro) |
| Modelo | `DiaNoLaborable` — `(sedeId, fecha)` único |
| Calendario | `apps/api/src/agendas/dias-no-laborables.service.ts` |
| La regla | `citas.service.ts` · `validarDiaLaborable()`, llamada desde `cupos()` y `validarCupo()` |
| Interfaz | Backoffice → Administración → Días no laborables |

Los dos puntos de aplicación son los mismos que usa RN-04.6: `cupos()` para que no se ofrezca, y
`validarCupo()` dentro de la transacción para que no se cree ni se reprograme.

**El bot no necesita nada.** El motor rechaza y el mensaje le llega como resultado de la
herramienta, igual que RN-01 a RN-04 (ADR A3). Ni prompt ni base de conocimiento.

**Zona horaria:** las fechas se guardan como medianoche UTC y se leen en UTC. `fechaEnZona()`
sobre una de ellas devolvería el día anterior (UTC−5).

---

## Pendiente

- Cargar los festivos de cada año nuevo. Hoy es una acción manual desde el backoffice; si la
  clínica lo olvida, el 1 de enero vuelve a ser agendable. Vale la pena automatizarlo.
- Avisar por WhatsApp a los pacientes de las citas afectadas al cerrar un día. Hoy queda en manos
  de la asistente, como en RN-06.3.
