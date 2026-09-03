# Changelog · FASE 11 — Ajustes de retroalimentación del cliente

**Estado:** en curso. Recoge los cambios que pide el cliente tras revisar el prototipo desplegado
en `provivir.exagos.co`, numerados como los fue enviando.

## 1 · Cambio de marca

`Grupo Provivir · CDC Oriente` → **`Centro de Profesionales & Provivir · CPP Principal`**, con
`CPP` en el distintivo que antes decía `GP`.

Alcanza el título de pestaña de los tres frontends, el encabezado lateral y la pantalla de inicio
de sesión del backoffice, la cabecera del portal público y de la pantalla de sala, y el encabezado
del ticket de llegada que recibe el paciente en el mostrador.

Las menciones a "Grupo Provivir" que quedan en `Prioridad.tsx` y `Metricas.tsx` son comentarios
sobre pendientes del cliente (P4, P5), no texto de interfaz.

**Queda pendiente:** el prompt del bot todavía se presenta como "Grupo Provivir, sede CDC Oriente"
(`ia.prompt.ts`), y el nombre viejo sigue en las plantillas de WhatsApp, el seed y el catálogo
demo. Son textos de cara al paciente y hay que decidir si se renombran también.

## 2 · RN-04.6 · El autoservicio no agenda para hoy

El cliente pidió que en el portal solo se pueda elegir desde mañana. Al revisarlo apareció algo
más grave: **no existía ninguna validación de fecha en el sistema**. Se podía agendar hoy y
también en fechas pasadas, por los tres canales; el `min` del selector era el único freno y un
atributo HTML no es una garantía.

La regla completa, con su justificación y sus pendientes, está en
[`docs/rn-04-6-anticipacion-minima.md`](rn-04-6-anticipacion-minima.md).

**Decisión de alcance acordada con el cliente:** portal y WhatsApp quedan restringidos; **el
backoffice sigue pudiendo agendar para hoy**, porque al paciente que llega al mostrador hay que
poder atenderlo.

### Qué se tocó

| Capa | Cambio |
|---|---|
| `citas.reglas.ts` | funciones puras `primeraFechaAgendable` y `cumpleAnticipacionMinima` |
| `citas.service.ts` | opción `{ autoservicio }`, validación en `cupos()` y en `validarCupo()`, y `primeraFechaAgendableAutoservicio()` |
| `portal.service.ts`, `ia.service.ts` | los dos canales de autoservicio se declaran como tales |
| `ia.prompt.ts` | la primera fecha agendable se inyecta como **dato**, no como regla (ADR A3) |
| `apps/portal` | el selector arranca en mañana y no deja elegir antes |
| configuración | clave nueva `agendamiento_anticipacion_dias` = `1`, editable en Administración → Reglas |

### Dos cosas que aparecieron por el camino

**`fechaEnZona()` no sirve para formatear una fecha ya almacenada.** Las fechas se guardan como
medianoche UTC; leerlas en la zona de la sede (UTC−5) las corre **un día hacia atrás**. Por eso el
motor formatea la primera fecha agendable en UTC, con el comentario correspondiente.

El mismo error está en `recordatorios.service.ts:161`, `fecha: fechaEnZona(cita.fecha)`:
comprobado que `fechaEnZona(new Date('2026-09-21T00:00:00Z'))` devuelve `2026-09-20`, así que el
recordatorio de WhatsApp le está anunciando al paciente **el día anterior al de su cita**. No se
tocó aquí porque es otro asunto; queda para corregir aparte, con su prueba.

### Pruebas

7 unitarias de la regla pura (`RN-04.6: …` en `citas.reglas.spec.ts`), 6 de integración del motor
que fijan la distinción de canal (`citas.e2e-spec.ts`), 2 del portal por HTTP, 1 del canal de
WhatsApp que comprueba que el rechazo llega al modelo con el motivo útil, 1 de configuración, y la
comprobación del selector en la prueba de navegador del portal.

## 3 · RN-06.5 · Días no laborables (festivos)

Al cargar los horarios reales apareció la nota del cliente: «no atendemos domingos ni festivos».
Los domingos salen solos —no se programan agendas para el día 7— pero **los festivos no existían
como concepto**: el sistema ofrecía cupos el 25 de diciembre igual que cualquier viernes.

El bloqueo de agenda no servía de parche: `bloqueada` es un booleano sobre la fila, sin fecha, así
que apagaría todos los lunes en vez de un lunes. La regla completa está en
[`docs/rn-06-5-dias-no-laborables.md`](rn-06-5-dias-no-laborables.md).

**Sin excepción de canal**, a diferencia de RN-04.6: si la clínica está cerrada tampoco agenda el
mostrador. Para abrir un festivo, administración quita la fecha del calendario.

Los 18 festivos colombianos se **calculan** (`packages/shared/src/festivos.ts`): doce se mueven
cada año, entre la Ley Emiliani y los derivados de la Pascua. Un detalle que apareció escribiendo
las pruebas: **dos festivos pueden caer el mismo día** —en 2025 San Pedro y el Sagrado Corazón se
corren ambos al lunes 30 de junio— y entonces son un solo día cerrado, no dos.

## 4 · El catálogo real de la clínica

Sustituye al catálogo de demostración: 10 profesionales, 7 servicios de consulta y 26 franjas de
jornada, transcritos de las tablas que envió Gerencia.

Viven en `apps/api/src/cli/catalogo.clinica.ts` y se aplican con
`node apps/api/dist/cli/cargar-catalogo.js`. Se hizo así, y no a mano por el backoffice, porque
son 26 franjas y **la interfaz no permite corregir ni borrar una agenda** —solo bloquearla—, así
que una franja mal tecleada se quedaría para siempre. De paso el horario de la clínica queda en
git, con su historial.

### Dos cosas que el catálogo real estrena

**Jornada partida.** Casi todos los médicos atienden mañana y tarde, y el catálogo demo nunca tuvo
un caso: son dos franjas de agenda distintas, no una con hueco. El motor ya lo soportaba pero
nunca se había ejercido con datos; ahora hay prueba de que la hora del almuerzo no existe como
cupo y de que tampoco se puede agendar a la fuerza dentro de ella.

**Duraciones distintas sobre el mismo servicio.** Katherin Rodriguez atiende medicina general en
10 minutos y el resto en 15, con un solo servicio en el catálogo.

### Un hallazgo al escribir las pruebas

La clínica registró a Ingrit Perea también en medicina ocupacional (20 min) pero **dejó su horario
en blanco**. Habilitarla parecía inofensivo y no lo era: el servicio que declara una agenda es
informativo, no una restricción, así que el motor ofrecía medicina ocupacional en **toda** su
jornada de medicina general —doce horas semanales que nadie autorizó, compitiendo además con sus
cupos de consulta.

Se dejó el servicio en el catálogo (con `agendable: false`, RN-13.9, para que el bot lo describa
sin ofrecer horas) pero **sin habilitar a nadie**, que es lo que hace que de verdad no se pueda
agendar. Cuando la clínica defina las horas, el comentario en el archivo dice exactamente qué
tocar.

### Lo que quedó pendiente del cliente

- **Consultorios**: no los envió. Es el dato que se le dice al paciente al llamarlo en sala.
- **Jornada de medicina ocupacional** de Ingrit Perea.
- **Confirmar `ctrl`**: la consulta de control no aparece en su lista, pero RN-01 entera depende
  de que exista, así que se conserva.
- El archivo de Gerencia tiene **más personal** que las tablas enviadas (Hernandez Amaris, Romero
  Ramirez, Exámenes Cardiovasculares). Se cargó solo lo pedido: «iniciamos con estos servicios».

### Pruebas

9 unitarias del cálculo de festivos, 4 de integración del día cerrado en el motor, y 12 del
catálogo real que fijan jornada partida, duraciones por profesional, los horarios que cambian
según el día y que nadie ofrece cupos en domingo.
