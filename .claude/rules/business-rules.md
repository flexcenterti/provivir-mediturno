# Reglas de negocio

Extiende `docs/MediTurno_Provivir_Logica_de_Negocio_v2.0.md` (RN-01 a RN-12) y los `docs/rn-*.md`
posteriores (RN-13, RN-09.8, RN-09.9, RN-04.5). **Ante cualquier duda de comportamiento, léelos
antes de programar** — esto es un resumen operativo de lo que más se rompe al programar, no un
reemplazo de la fuente normativa.

## Reglas que más se rompen al programar

- **RN-01 · Intercalado:** prohibido agendar **dos citas de control consecutivas** (dos generales seguidas sí se permiten). El control exige `cita_origen_id` y debe caer dentro de la ventana configurable **por prestador**.
- **RN-02 · Dos métricas distintas que coexisten:** el **conteo comparativo** entre médicos generales **excluye controles**; el **% de ocupación** del dashboard **sí los cuenta** (ocupan tiempo). No unificarlas.
- **RN-02 · Balanceo solo en medicina general.** Especialistas nunca balancean. Si el paciente pide médico específico, se respeta sin balancear.
- **RN-04 · Cupos múltiples:** un servicio puede ocupar N slots (ecografía Doppler = 2).
- **RN-06 · El prestador ve su agenda en solo lectura.** Solo administración crea/bloquea/modifica disponibilidad.
- **RN-08 · Foto de orden médica manuscrita → escala inmediato, sin OCR.** La imagen queda adjunta como soporte.
- **Zona horaria:** "hoy" se calcula SIEMPRE con `hoyEnSede()`/`fechaEnZona()` de `@provivir/shared`.
  La clínica opera en Cali (UTC−5) y el servidor puede estar en otra zona; usar la del servidor
  desplaza el día entero. Nunca `new Date().toISOString().slice(0,10)`.
- **RN-13 · El bot no responde con conocimiento propio.** Toda afirmación sale de una herramienta
  (`buscar_conocimiento`, `consultar_servicio`, `listar_servicios`). **Las cifras salen del catálogo,
  nunca de un fragmento de texto.** Sin cobertura suficiente se escala, no se aproxima.
- **RN-13 · Los artículos se archivan, no se borran.** Archivar los saca del índice en la misma
  transacción; la ficha se conserva porque la auditoría debe poder explicar respuestas ya dadas.
  Borrado físico solo de borradores.
- **Ventana de 24 h de Meta: todo envío proactivo la respeta.** WhatsApp solo admite texto libre
  dentro de las 24 h que abre el ÚLTIMO mensaje del paciente. Fuera de ellas solo sale una
  **plantilla aprobada**; un texto libre se rechaza con `#131047` y el paciente no recibe nada.
  Se comprueba con `dentroDeVentanaMeta()` de `whatsapp/ventana-meta.ts` — la usan recordatorios,
  confirmación del portal y seguimiento comercial. Sin plantilla configurada **no se intenta**: se
  descarta con motivo en auditoría, porque un reintento no cambia el resultado y un fallo mudo sí.
- **RN-09.9 · Antes de cada envío de seguimiento se revalida todo**, no al encolarlo. El paciente
  pudo agendar por otro canal entretanto. Las condiciones que cancelan ganan sobre las que difieren.

## Convenciones de dominio

- **Nombres de dominio en español**: `cita`, `prestador`, `turno`, `paciente`, `servicio`, `agenda`, `sede`.
- **Cada test de regla lleva el ID en el nombre**: `RN-01: no permite dos controles consecutivos`. Así la cobertura de negocio se lee del reporte.

## Prohibiciones

- **Nunca** hardcodear reglas de negocio fuera del módulo `citas`. WhatsApp, portal y backoffice consumen `GET /cupos` y `POST /citas`; no recalculan nada. La IA solo actúa vía herramientas validadas — nunca SQL ni acceso directo a la BD. (Ver `.claude/rules/architecture.md` para la separación entre `citas.reglas.ts` y `citas.service.ts`.)
- **Nunca** la palabra "urgencia" en UI, datos ni código de cara al usuario (D6). Siempre **"prioridad"**. Urgencias es un servicio que la clínica no presta.
- **Nunca** almacenar datos clínicos (diagnósticos, resultados, notas médicas). El historial de servicios es operativo: tipo + fecha, últimos 10.
- **Nunca** exponer sede en la UI (D1): el modelo la conserva con valor fijo `cdc-oriente`.
- Logs sin PII en claro: documento y teléfono enmascarados. La auditoría es append-only.

## Parámetros configurables (nunca en código)

`hueco_max` (RN-03) · ventana de control por prestador (RN-01.3) · duraciones por prestador y tipo · umbrales de confianza de la IA · `KIOSKO_ACTIVO=false` (D3) · intervalo del video institucional (RN-11.2) · `whatsapp_seguimiento_portal_min` (RN-09.8.4) · `whatsapp_botones_interactivos` (RN-09.2) · `kb_score_min` y la lista de temas de escalamiento obligatorio (RN-13.3, RN-13.4) · encendido y cadencia del seguimiento comercial (RN-09.9). Van en tabla de configuración.
