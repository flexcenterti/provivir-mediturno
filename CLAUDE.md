# CLAUDE.md — Plataforma de agendamiento inteligente · Grupo Provivir (CDC Oriente)

## Qué es esto

Plataforma de agendamiento de citas médicas para Grupo Provivir, sede única **CDC Oriente**.
Escala: ~400 citas/día, 200.000 pacientes iniciales (dimensionar a 400.000), 5–6 médicos generales + especialistas.
Canales: backoffice (asistentes/admin), WhatsApp con IA, portal público de autoagendamiento, pantallas de sala, vista del prestador.

## Documentos — fuente de verdad

Están en `docs/`. **Las reglas RN-01 a RN-13 son la fuente de verdad. Ante cualquier duda de comportamiento, léelas antes de programar.**

Los documentos v2.0 están **congelados**. Las reglas acordadas después viven en su propio archivo
(`docs/rn-*.md`) para no reescribir la línea base; ahí se anota de qué familia extienden.

| Archivo | Qué contiene |
|---|---|
| `docs/MediTurno_Provivir_Logica_de_Negocio_v2.0.md` | **RN-01 a RN-12.** Las reglas. Lo normativo. |
| `docs/MediTurno_Provivir_Especificacion_Ajustes_v2.0.md` | Decisiones D1–D6, matriz de cambios por módulo, criterios de aceptación, pendientes del cliente P1–P10 |
| `docs/MediTurno_Provivir_Arquitectura_v1.0.md` | Módulos, modelo de datos, ADRs A1–A7 |
| `docs/MediTurno_Provivir_Guia_Desarrollo_ClaudeCode_v1.0.md` | Fases 0–6, pruebas y seguridad por fase |
| `docs/index_v2.html` | **Especificación visual.** El prototipo manda en UI: layout, paleta, textos, componentes. |
| `docs/rn-09-8-oferta-web.md` | **RN-09.8.** El bot ofrece el enlace del portal al detectar intención de agendar |
| `docs/rn-09-9-seguimiento-comercial.md` | **RN-09.9.** Secuencia de 3 mensajes al interesado que no agenda (extiende RN-09.8) |
| `docs/rn-04-5-catalogo-comercial.md` | **RN-04.5.** Ficha comercial del servicio y gobierno del catálogo |
| `docs/rn-13-base-conocimiento.md` | **RN-13.** Base de conocimiento del bot: artículos versionados con recuperación |
| `docs/adr-a5-proveedor-ia.md` | **ADR A5 revisado.** Proveedor de IA por configuración, dos adaptadores |
| `docs/adr-a8-recuperacion-conocimiento.md` | **ADR A8.** Recuperación sin pgvector, y por qué |

Precedencia si algo se contradice: Lógica de Negocio > Especificación > Arquitectura > prototipo.

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
- **El token de refresco NO es un `Bearer`.** Los dos se firman con el mismo secreto, así que sin
  la marca `tipo` del payload son intercambiables y guardar el de refresco equivaldría a un token
  de acceso con la vida de la sesión entera. `JwtStrategy` rechaza los de refresco; el canje
  rechaza los de acceso. Las duraciones se editan en Administración → Reglas (`sesion_ttl_acceso`,
  `sesion_ttl_inactividad`), no en el código.
- **Ventana de 24 h de Meta: todo envío proactivo la respeta.** WhatsApp solo admite texto libre
  dentro de las 24 h que abre el ÚLTIMO mensaje del paciente. Fuera de ellas solo sale una
  **plantilla aprobada**; un texto libre se rechaza con `#131047` y el paciente no recibe nada.
  Se comprueba con `dentroDeVentanaMeta()` de `whatsapp/ventana-meta.ts` — la usan recordatorios,
  confirmación del portal y seguimiento comercial. Sin plantilla configurada **no se intenta**: se
  descarta con motivo en auditoría, porque un reintento no cambia el resultado y un fallo mudo sí.
- **RN-09.9 · Antes de cada envío de seguimiento se revalida todo**, no al encolarlo. El paciente
  pudo agendar por otro canal entretanto. Las condiciones que cancelan ganan sobre las que difieren.
- **`packages/shared` se compila antes que la API.** La API resuelve `@provivir/shared` contra su
  `dist`, no contra el código; jest sí mapea al fuente. Si no se recompila, una constante nueva del
  paquete compartido pasa las pruebas y no llega a lo que corre.
- **El motor es el único que calcula reglas.** `citas.reglas.ts` tiene las funciones puras;
  `citas.service.ts` las orquesta en transacciones. Ningún otro módulo replica lógica de agendamiento.

## Stack y comandos

Monorepo: `apps/api` (NestJS + Prisma), `apps/backoffice` (React + Vite), `apps/portal`, `apps/tv`, `packages/shared` (tipos, constantes, validadores).
Postgres 16 + Redis/BullMQ. WhatsApp: Meta Cloud API. IA: API de Anthropic con tool use.

```
npm install                        # workspaces
docker compose up -d               # postgres 16 + redis 7
npm run db:migrate && npm run db:seed
npm run dev                        # api :3000 + backoffice :5173
npm test                           # unitarias (shared) + e2e (api)
npm run lint
```

**Sin Docker en la máquina:** `npm run db:local -w @provivir/api` levanta PostgreSQL 16 real con
binarios de usuario, y `npm run redis:local -w @provivir/api` un Redis 7.2, ambos sin root.

Usuarios del seed (solo desarrollo, password `Provivir2026!`):
`admin@` · `asistente@` · `osorio@` (rol prestador, ficha `ao`) · `pantalla@` — todos `@provivir.local`.

## Convenciones

- TypeScript estricto. Nada de `any` sin justificación en comentario.
- **Nombres de dominio en español**: `cita`, `prestador`, `turno`, `paciente`, `servicio`, `agenda`, `sede`.
- Commits convencionales: `feat:`, `fix:`, `test:`, `chore:`.
- Una fase = una rama (`fase-2-motor-citas`); dentro, commits atómicos.
- **Cada test de regla lleva el ID en el nombre**: `RN-01: no permite dos controles consecutivos`. Así la cobertura de negocio se lee del reporte.
- Entradas validadas con esquema (zod/class-validator) en **todos** los endpoints, incluidos webhooks y archivos.

## Prohibiciones

- **Nunca** hardcodear reglas de negocio fuera del módulo `citas`. WhatsApp, portal y backoffice consumen `GET /cupos` y `POST /citas`; no recalculan nada. La IA solo actúa vía herramientas validadas — nunca SQL ni acceso directo a la BD.
- **Nunca** la palabra "urgencia" en UI, datos ni código de cara al usuario (D6). Siempre **"prioridad"**. Urgencias es un servicio que la clínica no presta.
- **Nunca** almacenar datos clínicos (diagnósticos, resultados, notas médicas). El historial de servicios es operativo: tipo + fecha, últimos 10.
- **Nunca** tocar `.env` ni escribir secretos en el código. Solo `.env.example` con placeholders.
- **Nunca** exponer sede en la UI (D1): el modelo la conserva con valor fijo `cdc-oriente`.
- Logs sin PII en claro: documento y teléfono enmascarados. La auditoría es append-only.

## Lo que no se decide sin revisión humana

Borrar migraciones · cambiar el esquema de auditoría · tocar la verificación de firma del webhook de Meta (`X-Hub-Signature-256`) · cambiar dependencias mayores · activar `KIOSKO_ACTIVO`.

## Estado del proyecto

| Fase | Estado |
|---|---|
| 0 · Fundaciones | **Completa** — `docs/changelog-fase0.md` |
| 1 · Núcleo de datos + carga masiva | **Completa** — `docs/changelog-fase1.md` |
| 2 · Motor de agendamiento | **Completa** — `docs/changelog-fase2.md` |
| 3 · Operación en sede | **Completa** — `docs/changelog-fase3.md`. Las vistas que su changelog daba por ausentes (carga masiva, auditoría navegable, programación mensual) están en `Administracion.tsx` y `Agendas.tsx` |
| 5 · Autoagendamiento web + kiosko apagado | **Completa** — `docs/changelog-fase5.md` |
| 4 · WhatsApp + IA + bandeja | **Completa** (incluye RN-09.8) — `docs/changelog-fase4.md` |
| 6 · Métricas, endurecimiento y piloto | **Completa** — `docs/changelog-fase6.md` |
| 7 · Base de conocimiento + seguimiento comercial | **Completa** salvo el golden set — `docs/changelog-fase7.md` |
| 8 · Envíos proactivos y ventana de Meta | **Completa** salvo las plantillas del cliente — `docs/changelog-fase8.md` |
| 9 · Sesión que no se corta mientras se trabaja | **Completa** — `docs/changelog-fase9.md` |

**Las seis primeras fases están completas.** Lo que falta para producción son credenciales e insumos
del cliente, no código: ver `docs/checklist-piloto.md` y `despliegue/GUIA-DESPLIEGUE.md`.

**Fase 7** es trabajo posterior al alcance original: convierte `configuracion.documentacion_comercial`
—hoy un bloque de texto inyectado en cada conversación— en artículos versionados con recuperación
(RN-13), extiende el seguimiento de RN-09.8 a una secuencia comercial (RN-09.9) y completa el
gobierno del catálogo (RN-04.5).

**La Fase 5 se adelantó a la Fase 4** por decisión del cliente: el bot debe ofrecer el enlace
del portal (RN-09.8) y no puede apuntar a algo inexistente.

**Pendientes de confirmar con el cliente:**
1. RN-01.5 · qué cuenta como "control consecutivo" (`docs/changelog-fase2.md`).
2. RN-10.2 · el portal exige documento + últimos 4 del teléfono, no solo documento (`docs/changelog-fase5.md`).
3. RN-09.2 · usar botones interactivos de WhatsApp en vez de solo texto (`docs/rn-09-8-oferta-web.md`).

**Proveedor de IA:** se elige con `IA_PROVEEDOR` (openai | anthropic). Los dos adaptadores
viven en `apps/api/src/ia/adaptadores/`; el orquestador no conoce ningún SDK.
Ver `docs/adr-a5-proveedor-ia.md`.

## Definición de hecho (DoD) por tarea

Código + test (con ID de RN si aplica) + migración si cambia el esquema + entrada en `docs/changelog-faseN.md`.
Ninguna fase se cierra sin sus pruebas en verde y su demo funcionando. No se avanza dejando deuda de la fase anterior.

## Cómo trabajar cada sesión

1. Leer este archivo y el documento de la fase en curso.
2. **Plan antes de código:** explicar qué archivos se tocan y esperar aprobación.
3. **Tests primero** en RN-01 a RN-04: escribir los tests que describen la regla, luego la implementación.
4. Al cerrar, actualizar `docs/changelog-faseN.md` para que la siguiente sesión retome sin repetir contexto.

## Parámetros configurables (nunca en código)

`hueco_max` (RN-03) · ventana de control por prestador (RN-01.3) · duraciones por prestador y tipo · umbrales de confianza de la IA · `KIOSKO_ACTIVO=false` (D3) · intervalo del video institucional (RN-11.2) · `whatsapp_seguimiento_portal_min` (RN-09.8.4) · `whatsapp_botones_interactivos` (RN-09.2) · `kb_score_min` y la lista de temas de escalamiento obligatorio (RN-13.3, RN-13.4) · encendido y cadencia del seguimiento comercial (RN-09.9). Van en tabla de configuración.

## Pendientes del cliente que bloquean

P1 base de pacientes (bloquea carga masiva) · P2 duraciones · P3 ventanas de control (bloquea RN-01) · P6 documentación comercial (bloquea RN-13 entera) · P9 CSV de contactos · P10 enlaces de YouTube · P12 temas que el bot siempre escala (RN-13.4) · P13 información operativa para los primeros artículos. Detalle en la Especificación §5 y en `docs/checklist-piloto.md`.
