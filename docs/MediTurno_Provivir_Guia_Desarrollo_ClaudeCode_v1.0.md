# Guía de desarrollo con Claude Code — Versión 1.0
# Plataforma de agendamiento inteligente · Grupo Provivir (CDC Oriente)

**Propósito:** organizar el desarrollo por etapas con Claude Code, con pruebas y prácticas de desarrollo seguro en cada fase. Documentos de referencia obligatoria: **Especificación v2.0**, **Lógica de Negocio v2.0 (RN-01 a RN-12)** y **Arquitectura v1.0**. El prototipo `index_v2.html` es la especificación visual.

**Regla de oro:** ninguna fase se cierra sin sus pruebas en verde y su demo funcionando. No se avanza dejando deuda de la fase anterior.

---

## 1. Preparación del repositorio para Claude Code

### 1.1 Estructura del monorepo
```
provivir/
├── CLAUDE.md                  ← memoria del proyecto para Claude Code (ver 1.2)
├── docs/                      ← los 3 documentos v2.0 + arquitectura + esta guía
├── apps/
│   ├── api/                   ← backend NestJS + Prisma
│   ├── backoffice/            ← SPA React
│   ├── portal/                ← autoagendamiento público
│   └── tv/                    ← pantalla de sala
├── packages/shared/           ← tipos, constantes, validadores compartidos
├── docker-compose.yml         ← pg + redis + api + fronts (dev)
└── .github/workflows/ci.yml   ← lint + test + build + migraciones en seco
```

### 1.2 CLAUDE.md (créalo antes de la primera sesión)
Debe contener, corto y directo:
- Qué es el proyecto y dónde están los documentos (`docs/`): "las reglas RN-01 a RN-12 son la fuente de verdad; ante duda, leerlas antes de programar".
- Stack y comandos: `npm run dev`, `npm test`, `npx prisma migrate dev`, `npm run lint`.
- Convenciones: TypeScript estricto, nombres de dominio en español (`cita`, `prestador`, `turno`), commits convencionales (`feat:`, `fix:`, `test:`), una migración por cambio de esquema.
- Prohibiciones: **nunca** hardcodear reglas de negocio fuera del módulo `citas`; **nunca** usar la palabra "urgencia" en UI/código de cara al usuario (D6); **nunca** guardar datos clínicos; **nunca** tocar `.env` ni escribir secretos en el código.
- Definición de hecho (DoD) por tarea: código + test + migración (si aplica) + entrada en el changelog de la fase.

### 1.3 Higiene de la sesión con Claude Code
- **Una fase = una rama** (`fase-2-motor-citas`); dentro de la fase, tareas pequeñas con commits atómicos. PR por tarea o por bloque coherente; revisar el diff completo antes de mergear — el humano es el que aprueba.
- **Plan antes de código:** para cada tarea pídele primero el plan (modo plan / "explícame cómo lo vas a hacer y qué archivos tocas") y apruébalo. Evita que refactorice cosas fuera del alcance de la tarea.
- **Tests primero en las reglas:** para RN-01 a RN-04 pide explícitamente "escribe primero los tests que describen la regla, luego la implementación".
- **Contexto controlado:** empieza cada sesión pidiéndole leer `CLAUDE.md` y el documento de la fase; al cerrar, pídele actualizar el changelog de la fase (`docs/changelog-faseN.md`) para que la siguiente sesión retome sin repetir contexto.
- **Secretos fuera del alcance del agente:** `.env` en `.gitignore`, valores reales solo en el servidor; en dev, `.env.example` con placeholders. No pegues tokens de Meta ni claves de API en el chat de la sesión.
- **Lo que Claude Code no decide solo:** borrar migraciones, cambiar el esquema de auditoría, tocar la verificación de firma del webhook, cambiar dependencias mayores. Eso se revisa contigo o con Jefferson.

---

## 2. Plan por etapas

> Estimación orientativa para llegar a "listo para pruebas" en 10–15 días con dedicación completa. Cada fase lista: **objetivo → entregables → pruebas → seguridad de la fase**.

### FASE 0 · Fundaciones (día 1)
**Objetivo:** repo, ambientes y esqueleto corriendo.
- Monorepo con estructura 1.1, Docker Compose (Postgres 16 + Redis), NestJS con healthcheck, React con Vite, CI (lint + test + build).
- Prisma inicializado con las entidades base y **seed** con los datos del prototipo (3 médicos generales, especialistas, servicios con tipos y cupos).
- `auth`: usuarios, login JWT, roles (admin/asistente/prestador/pantalla), guards por rol.
**Pruebas:** CI en verde; e2e mínimo: login de cada rol devuelve token con el rol correcto; acceso denegado sin token.
**Seguridad:** Argon2 para contraseñas; helmet + CORS restringido; rate limit global; `.env.example`; escaneo de dependencias (`npm audit`) en CI.

### FASE 1 · Núcleo de datos + carga masiva (días 2–3)
**Objetivo:** pacientes, prestadores, servicios y agendas administrables; carga masiva real.
- CRUD + búsquedas (documento/nombre/teléfono con índices). Historial de servicios (últimos 10) — RN-12.4.
- Duraciones por prestador y tipo; ventana de control; grupo de balanceo (RN-01, RN-02).
- Agendas: modos semanal/calendario + **programación mensual masiva** + bloqueo con detección de citas afectadas (RN-06).
- Carga masiva: streaming del archivo del cliente por lotes en cola, filtro "servicio en el último año", deduplicación por documento, reporte de errores descargable (RN-12).
**Pruebas:** unitarias de deduplicación y filtro de año; integración: cargar un CSV de 100k sintético < 5 min y sin bloquear la API; verificación de que la re-carga rechaza duplicados y actualiza.
**Seguridad:** validación de esquema del archivo (tipo, tamaño máximo, extensión); el archivo se procesa y se **elimina** del disco al terminar; enmascarado de documento/teléfono en logs.

### FASE 2 · Motor de agendamiento (días 3–5) — **la fase crítica**
**Objetivo:** módulo `citas` con todas las reglas, expuesto por API.
- Generación de cupos desde agendas; `GET /cupos` y `POST /citas` transaccional con bloqueo por prestador/rango (sin dobles asignaciones concurrentes).
- RN-01: intercalado, prohibición de dos controles seguidos, ventana por prestador, control sin costo, `cita_origen_id`.
- RN-02: balanceo solo medicina general, conteo sin controles, respeto de preferencia.
- RN-03: compactación por bloques (`hueco_max` configurable).
- RN-04: especialistas por fecha, procedimientos con duración propia, cupos múltiples (Doppler = 2).
- Códigos únicos por sede/día; reprogramación (nuevo código si cambia el día) y cancelación con notificación.
**Pruebas (test-first, la batería más importante del proyecto):**
- Unitarias por regla con casos borde: control fuera de ventana → rechazado; secuencia G-C-G-C válida; G-C-C → rechazada; dos generales seguidas → válida; Doppler no cabe en 1 cupo → siguiente hueco de 2; balanceo con cargas 3/3/2 asigna al de 2; hueco de 4 h → recomienda el contiguo.
- **Concurrencia:** 20 peticiones simultáneas al mismo cupo → exactamente 1 creada, 19 con alternativas.
- Property-based (fast-check) sobre una agenda generada: ninguna secuencia resultante viola RN-01 ni solapa citas.
**Seguridad:** toda entrada validada con zod/class-validator; errores sin filtrar detalles internos; auditoría de cada creación/cancelación.

### FASE 3 · Operación en sede (días 5–7)
**Objetivo:** backoffice operativo replicando el prototipo.
- Dashboard: fecha + rango, buscador, KPIs, balanceo MG, ocupación sobre jornada (§2.7 spec).
- Agenda consolidada día/semana/mes, selector de prestadores, crear cita con tipo + **crear paciente embebido**.
- Mostrador: llegada, ticket (impresión + envío por WhatsApp como texto), prioridad de llegada.
- Vista prestador (móvil primero): cola, tipo de servicio visible, **priorización con nota obligatoria** auditada, llamado automático al siguiente (RN-07).
- Turnos + WebSocket hacia la pantalla `/tv/:id`; frame YouTube (canal en vivo + video institucional por intervalo) con su configuración (RN-11) — *spike técnico temprano: probar la rotación con la API de YouTube IFrame en el día 5; es el riesgo aceptado con el cliente*.
**Pruebas:** e2e (Playwright) del flujo completo: crear cita → llegada en mostrador → llamado del prestador → aparece en TV → finalizar; test de la nota obligatoria (guardar sin nota → bloqueado); ocupación calculada correctamente con controles incluidos en tiempo pero excluidos del conteo comparativo.
**Seguridad:** RBAC verificado por test (prestador no puede mutar agendas — RN-06); WebSocket autenticado por token de pantalla; sanitización de todo texto renderizado (notas, mensajes).

### FASE 4 · WhatsApp + IA + bandeja (días 7–11)
**Objetivo:** canal WhatsApp completo sobre número de prueba.
- Webhook Meta con verificación de firma; persistencia de mensajes; multimedia entrante (descarga de media, STT para audios) — RN-09.2.
- Orquestador IA (Claude + tool use hacia el motor): identificación, confirmación de número, oferta de cupos, confirmación con **texto formateado tipo ticket**, tono vendedor con la documentación de servicios (P6).
- Política de escalamiento: orden médica en foto → **escala de inmediato, sin OCR** (RN-08); baja confianza; solicitud explícita de humano.
- Bandeja: prioridad + tiempo de espera + burbuja en tiempo real (sin sonido); toma y resolución por la asistente respondiendo desde la plataforma.
- Recordatorios programados (24 h y mismo día) por cola; importador del CSV de contactos (P9).
**Pruebas:** suite de conversaciones simuladas (fixtures de webhooks) que cubren los 4 escenarios del prototipo + 10 variantes (errores de documento, paciente inexistente, cupo que se ocupa a mitad de conversación); test del escalamiento inmediato con imagen; **test de firma inválida → 401**; evaluación de la IA con un set de 30 mensajes reales anotados (intención esperada vs detectada) antes del piloto.
**Seguridad:** verificación `X-Hub-Signature-256` obligatoria (test dedicado); tokens de Meta y Anthropic solo en el servidor; el LLM solo actúa vía herramientas con validación (nunca SQL/acceso directo); límites de gasto y timeout por conversación; los prompts nunca incluyen datos de otros pacientes; media almacenada fuera del webroot con URLs firmadas.

### FASE 5 · Autoagendamiento web + kiosko apagado (días 11–12)
**Objetivo:** portal público listo para insertar en grupoprovivir.com.
- Flujo nuevo/registrado → servicio → cupos del motor → confirmación con código + WhatsApp de confirmación (RN-10). QR generado para impresión.
- Ruta `/kiosko` construida con bandera `KIOSKO_ACTIVO=false` y la pantalla de opciones de referencia (D3).
**Pruebas:** e2e del portal (nuevo y registrado); el portal ofrece exactamente los mismos cupos que el backoffice (consistencia del motor); paciente nuevo queda con origen correcto.
**Seguridad:** rate limiting agresivo + CAPTCHA ligero (p. ej. Turnstile) en el portal; validación estricta de datos; sin enumeración de pacientes (respuesta genérica si el documento no existe); aviso de privacidad Ley 1581 visible.

### FASE 6 · Métricas, endurecimiento y piloto (días 12–15)
**Objetivo:** cerrar para pruebas con el cliente.
- Métricas del dashboard/reportes (tablero definitivo queda abierto — P5); auditoría completa navegable.
- **Endurecimiento:** revisión OWASP Top 10 con checklist (ver §4), `npm audit` limpio, headers verificados (securityheaders), backups automáticos + restauración probada, prueba de carga: 50 conversaciones concurrentes + 1.000 citas/día simuladas.
- Staging con número de prueba → **checklist de piloto** (§5) → migración del número real solo al aprobar el piloto.
**Pruebas:** regresión completa (todas las suites), prueba de restauración de backup, prueba de caída de Redis/Meta (la API degrada sin perder mensajes: reintentos).

---

## 3. Estrategia de pruebas (transversal)

| Nivel | Herramienta | Qué cubre | Cuándo corre |
|---|---|---|---|
| Unitarias | Vitest/Jest | Reglas RN-01–RN-04, utilidades, validadores | En cada commit (CI) |
| Integración | Jest + Testcontainers (pg/redis) | Motor transaccional, carga masiva, colas, webhook | En cada PR |
| E2E | Playwright | Flujos del backoffice, portal, ticket→TV | Al cerrar cada fase |
| Conversacionales | Fixtures de webhooks + set anotado | Escenarios WhatsApp, escalamientos, evaluación IA | Fase 4 y antes del piloto |
| Carga | k6 | 400+ citas/día, 50 chats concurrentes | Fase 6 |
| Seguridad | npm audit, ZAP baseline, checklist OWASP | Dependencias, endpoints públicos | Fase 6 + CI |

**Mapa de trazabilidad:** cada test de regla lleva el ID en el nombre (`RN-01: no permite dos controles consecutivos`) — así la cobertura de la lógica de negocio se lee directamente del reporte.

## 4. Checklist de desarrollo seguro (se revisa al cerrar cada fase)

1. Entradas validadas con esquema en **todos** los endpoints (incluye webhooks y archivos).
2. Autorización por rol probada por test en cada endpoint nuevo (no solo autenticación).
3. Sin secretos en el repo ni en el historial (`gitleaks` en CI).
4. Consultas solo vía ORM parametrizado; nada de SQL concatenado.
5. Salidas escapadas/sanitizadas (notas, mensajes de pacientes, nombres).
6. Logs sin PII en claro (documento/teléfono enmascarados); auditoría append-only.
7. Rate limiting en superficie pública; firma de webhook verificada.
8. Dependencias sin vulnerabilidades altas/críticas (`npm audit` en CI).
9. Errores genéricos hacia afuera, detalle solo en logs del servidor.
10. Media de WhatsApp fuera del webroot, con URL firmada y expiración.
11. Backups cifrados con restauración probada; TLS en todos los ambientes.
12. Datos personales: mínimos necesarios, aviso Ley 1581, sin datos clínicos.

## 5. Checklist de salida a piloto

- [ ] Regresión completa en verde + carga masiva real del archivo del cliente (P1) en staging.
- [ ] Parámetros del cliente configurados: duraciones (P2), ventanas de control (P3), documentación comercial en el prompt (P6).
- [ ] Número de prueba operando 3–5 días con el equipo del cliente (RN-09.7); métricas de resolución IA revisadas.
- [ ] Contactos CSV migrados (P9); enlaces de YouTube configurados (P10) y rotación validada en el TV real de la sede.
- [ ] Capacitación: asistentes (bandeja/mostrador), John (dashboard), médicos (vista prestador, 10 min).
- [ ] Plan de reversa: si la API falla, el número sigue operable manualmente desde la plataforma (modo asistente).
- [ ] Aprobación del cliente → migración del número principal → lanzamiento.
