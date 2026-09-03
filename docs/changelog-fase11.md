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
