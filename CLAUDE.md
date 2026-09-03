# CLAUDE.md — Plataforma de agendamiento inteligente · Grupo Provivir (CDC Oriente)

Plataforma de agendamiento de citas médicas para Grupo Provivir, sede única **CDC Oriente**.
Escala: ~400 citas/día, 200.000 pacientes iniciales (dimensionar a 400.000), 5–6 médicos
generales + especialistas. Canales: backoffice, WhatsApp con IA, portal público de
autoagendamiento, pantallas de sala, vista del prestador.

## Stack

Monorepo: `apps/api` (NestJS + Prisma), `apps/backoffice` (React + Vite), `apps/portal`,
`apps/tv`, `packages/shared`. Postgres 16 + Redis/BullMQ. WhatsApp vía Meta Cloud API. IA vía
API de Anthropic u OpenAI, elegible por configuración (`IA_PROVEEDOR`).

## Comandos esenciales

```
npm install                        # workspaces
docker compose up -d               # postgres 16 + redis 7
npm run db:migrate && npm run db:seed
npm run dev                        # api :3000 + backoffice :5173
npm test                           # unitarias (shared) + e2e (api)
npm run lint
```

Variantes sin Docker, usuarios del seed y demás detalle de desarrollo:
[.claude/rules/operations.md](.claude/rules/operations.md).

## Documentos — fuente de verdad

Están en `docs/`. **Las reglas RN-01 a RN-13 son la fuente de verdad. Ante cualquier duda de
comportamiento, léelas antes de programar.**

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
| `docs/rn-04-6-anticipacion-minima.md` | **RN-04.6.** El autoservicio agenda desde mañana; la sede sí puede agendar hoy |
| `docs/rn-04-7-agenda-con-asistente.md` | **RN-04.7.** Servicios que el paciente no agenda solo; los coordina la asistente |
| `docs/rn-06-5-dias-no-laborables.md` | **RN-06.5.** Festivos y cierres: ningún canal agenda en un día cerrado |
| `docs/rn-13-base-conocimiento.md` | **RN-13.** Base de conocimiento del bot: artículos versionados con recuperación |
| `docs/adr-a5-proveedor-ia.md` | **ADR A5 revisado.** Proveedor de IA por configuración, dos adaptadores |
| `docs/adr-a8-recuperacion-conocimiento.md` | **ADR A8.** Recuperación sin pgvector, y por qué |

Precedencia si algo se contradice: Lógica de Negocio > Especificación > Arquitectura > prototipo.

## Reglas operativas de Claude Code (`.claude/rules/`)

| Archivo | Qué contiene |
|---|---|
| [business-rules.md](.claude/rules/business-rules.md) | Las RN que más se rompen al programar, prohibiciones de dominio, convenciones de nombres, parámetros configurables |
| [architecture.md](.claude/rules/architecture.md) | Estructura del monorepo, por qué el motor de reglas está centralizado, diseño de tokens, proveedor de IA |
| [operations.md](.claude/rules/operations.md) | Build/test gotchas, convenciones de desarrollo, comandos alternativos, qué requiere revisión humana |
| [implementation-phases.md](.claude/rules/implementation-phases.md) | Estado de cada fase, pendientes por confirmar, DoD, pendientes del cliente que bloquean |

## Primera sesión

1. Leer este archivo y `.claude/rules/implementation-phases.md` para saber en qué fase está el
   proyecto y qué sigue pendiente.
2. **Plan antes de código:** explicar qué archivos se tocan y esperar aprobación.
3. **Tests primero** en RN-01 a RN-04: escribir los tests que describen la regla, luego la
   implementación.
4. Al cerrar, actualizar `docs/changelog-faseN.md` para que la siguiente sesión retome sin
   repetir contexto.
