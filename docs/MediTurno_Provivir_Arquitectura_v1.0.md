# Arquitectura de la aplicación — Versión 1.0
# Plataforma de agendamiento inteligente · Grupo Provivir (CDC Oriente)

**Propósito:** definir la arquitectura de la primera versión de producción que implementa la Especificación v2.0 y la Lógica de Negocio v2.0 (RN-01 a RN-12). Documento de referencia para el desarrollo con Claude Code.

---

## 1. Principios de arquitectura

1. **Monolito modular, no microservicios.** Un solo backend con módulos bien separados (dominios). El equipo es pequeño y el tiempo es corto (10–15 días a pruebas); los microservicios agregan complejidad sin beneficio a esta escala.
2. **La lógica de negocio vive en el dominio, no en el bot.** El motor de agendamiento (RN-01 a RN-04) es un módulo del backend con API propia; WhatsApp, el portal web y el backoffice son solo canales que lo consumen. Así las reglas se validan una vez y se cumplen igual en todos los canales.
3. **Multi-sede en el modelo, sede única en la UI (D1).** Toda entidad lleva `sede_id`; la interfaz opera con el valor fijo `cdc-oriente`.
4. **Sin datos clínicos.** La plataforma es operativa (RN-12.4): pacientes, citas, servicios, turnos, conversaciones. Ningún campo de diagnóstico, resultados ni notas médicas.
5. **Todo auditable.** Cada cambio de estado relevante escribe en la tabla de auditoría (quién, qué, antes → después).
6. **Asíncrono lo que puede fallar.** Envíos de WhatsApp, recordatorios, transcripción de audios y carga masiva corren en colas con reintentos; nunca bloquean la petición del usuario.

## 2. Stack tecnológico recomendado

| Capa | Tecnología | Justificación |
|---|---|---|
| Backend / API | **Node.js 22 + TypeScript + NestJS** (alternativa aceptable: Express + estructura modular) | Tipado fuerte para las reglas de negocio, ecosistema maduro para webhooks/colas, mismo lenguaje que el frontend, muy bien soportado por Claude Code |
| ORM / migraciones | **Prisma** | Esquema declarativo versionado, migraciones reproducibles, tipado end-to-end |
| Base de datos | **PostgreSQL 16** | 400.000 pacientes y 400+ citas/día es carga baja para Postgres bien indexado; transacciones para la asignación de cupos |
| Cache / colas | **Redis + BullMQ** | Recordatorios programados, envíos WhatsApp con reintento, procesamiento de multimedia, carga masiva por lotes |
| Frontend backoffice | **React 18 + Vite + TypeScript** | SPA del backoffice (dashboard, consolidada, mostrador, bandeja, prestador); el prototipo v2.0 es la especificación visual |
| Portal público | Página React ligera (mismo repo, build separado) | Autoagendamiento web embebible por iframe/enlace en grupoprovivir.com (RN-10) |
| Pantallas TV | Página web en modo kiosk (misma SPA, ruta `/tv/:pantallaId`) | Corre en cualquier TV con navegador o Fire TV/Chromecast; conexión por WebSocket para llamados en tiempo real |
| Tiempo real | **WebSocket (Socket.IO)** | Llamados de turno → pantallas; burbuja de bandeja → backoffice |
| WhatsApp | **Meta WhatsApp Business Cloud API** (webhooks entrantes + Graph API salientes) | Decisión D5/RN-09: API oficial desde el inicio |
| IA conversacional | **API de Anthropic (Claude)** con tool use hacia el motor de agendamiento; transcripción de audio con un servicio STT (p. ej. Whisper API) | El LLM detecta intención, extrae datos y llama herramientas (`buscar_paciente`, `ofrecer_cupos`, `confirmar_cita`, `escalar`); nunca escribe directo en la BD |
| Servidor | VPS **Ubuntu 24** + **Docker Compose** + **Caddy** (HTTPS automático) | Alineado con la infraestructura que ya opera el equipo |
| Observabilidad | Logs estructurados (pino) + Uptime Kuma/healthchecks + alertas | Suficiente para el MVP |

## 3. Vista de contexto (C4 nivel 1)

```
   Paciente ──WhatsApp──▶ Meta Cloud API ──webhook──▶ ┌──────────────────────┐
   Paciente ──navegador─▶ Portal autoagendamiento ───▶ │                      │
   Asistente/Admin ──────▶ Backoffice (SPA) ─────────▶ │   BACKEND PROVIVIR   │──▶ PostgreSQL
   Prestador (móvil) ────▶ Backoffice (vista médico) ▶ │  (API + reglas RN)   │──▶ Redis (colas)
   TV de sala ──────────▶ Página /tv (WebSocket) ◀────│                      │──▶ API Anthropic (IA)
   Kiosko (futuro) ─────▶ Página /kiosko (apagada)    └──────────┬───────────┘──▶ STT (audios)
                                                                 └──Graph API──▶ Meta (mensajes salientes)
   TV: frame YouTube (canal en vivo + videos) — embebido en la página /tv (RN-11)
```

## 4. Vista de contenedores y módulos (C4 nivel 2)

**Backend (un solo despliegue, módulos NestJS):**

| Módulo | Responsabilidad | Reglas |
|---|---|---|
| `auth` | Login, JWT, RBAC (admin, asistente, prestador, pantalla), sesiones | — |
| `pacientes` | CRUD, búsqueda, historial de servicios (últimos 10), deduplicación por documento | RN-12 |
| `prestadores` | CRUD, duraciones por tipo, grupo de balanceo, ventana de control | RN-01, RN-02 |
| `servicios` | Catálogo, tipos (general/control/procedimiento/examen), cupos múltiples | RN-04 |
| `agendas` | Disponibilidad semanal/calendario, programación mensual, bloqueos con notificación | RN-06 |
| `citas` (motor) | **Núcleo:** generación de cupos, asignación por bloques, balanceo MG, intercalado general/control, validación de ventana, códigos únicos | RN-01–RN-04 |
| `turnos` | Llegadas, cola por prioridad, llamados, priorización con nota, estados de atención | RN-05, RN-07 |
| `whatsapp` | Webhook de Meta (verificación de firma), normalización de multimedia, envío saliente, plantillas de texto formateado, migración de contactos CSV | RN-09 |
| `ia` | Orquestación LLM: intención, extracción, tool use hacia `citas`, política de escalamiento, prompt con documentación comercial (venta) | RN-08, RN-09.6 |
| `bandeja` | Conversaciones escaladas, prioridad, tiempo de espera, toma/resolución | RN-05, RN-08 |
| `pantallas` | Config por sala/servicio, WebSocket de llamados, config del frame YouTube | RN-11 |
| `portal` | Endpoints públicos del autoagendamiento (rate-limited) | RN-10 |
| `carga` | Importación masiva por lotes (streaming, cola), filtro último año, reporte de errores | RN-12 |
| `metricas` | Agregaciones del dashboard y reportes | — |
| `auditoria` | Registro inmutable de acciones (append-only) | — |

**Frontends (mismo monorepo):** `app-backoffice` (SPA con roles), `app-portal` (público), `app-tv` (kiosk mode). El kiosko queda como ruta construida pero con bandera `KIOSKO_ACTIVO=false` (D3).

## 5. Modelo de datos (entidades principales)

```
sede(id, nombre, direccion, wa_numero, horario)                 -- única fila: cdc-oriente
paciente(id, tdoc, documento UNIQUE, nombres, apellidos, telefono, whatsapp,
         correo?, condiciones[], origen, sede_id, creado_en)
historial_servicio(id, paciente_id, fecha, servicio_texto)      -- últimos 10 visibles (RN-12.4)
servicio(id, nombre, categoria, tipo, duracion_min, cupos, requiere_orden, politica_costo)
prestador(id, nombre, especialidad, grupo_balanceo bool, consultorio, estado)
prestador_servicio(prestador_id, servicio_id, duracion_min)     -- duración por prestador y tipo
prestador_config(prestador_id, ventana_control_dias)
agenda(id, prestador_id, modo semanal|calendario, dias|fecha, hora_ini, hora_fin,
       slot_min, consultorio, estado, sede_id)
cita(id, codigo UNIQUE(sede,dia), paciente_id, prestador_id, servicio_id,
     tipo general|control|procedimiento|examen, cita_origen_id?,  -- controles (RN-01)
     fecha, hora, duracion_min, estado, origen, prioridad, observacion, sede_id)
turno(id, cita_id, llegada_ts, estado, prioridad, nota_priorizacion?, priorizado_por?)
conversacion(id, paciente_id?, telefono, estado, intencion, confianza,
             escalada bool, escalada_ts, motivo, prioridad, tomada_por?, resuelta_ts?)
mensaje(id, conversacion_id, direccion in|out, tipo texto|audio|imagen|video|doc,
        contenido, media_url?, transcripcion?, ts)
pantalla(id, nombre, servicios[], turnos_visibles, sonido, media bool,
         canal_youtube, videos_promo[], intervalo_institucional_min, mensaje)
auditoria(id, ts, usuario, accion, entidad, detalle, estado_prev, estado_next)  -- append-only
usuario(id, nombre, email, hash_password, rol, prestador_id?, activo)
```

**Índices críticos:** `paciente(documento)`, `paciente(telefono)`, `cita(fecha, prestador_id)`, `cita(codigo)`, `turno(estado, prioridad, llegada_ts)`, `conversacion(escalada, resuelta_ts)`.

**Invariantes que protege la BD (además del código):**
- `cita.codigo` único por sede y día (constraint).
- Solapamiento de citas del mismo prestador prohibido (constraint de exclusión por rango horario o validación transaccional con `SELECT … FOR UPDATE`).
- `cita.tipo='control'` exige `cita_origen_id` y fecha dentro de la ventana del prestador (validación en servicio + check).

## 6. El motor de agendamiento (módulo `citas`)

Único punto de asignación de cupos. Expone:

- `GET /cupos?servicio&fecha&prestador?` → lista de cupos válidos ya filtrados por: disponibilidad de agenda, intercalado (RN-01), compactación por bloques (RN-03: primero el cupo contiguo a la última cita, respetando `hueco_max`), cupos múltiples (RN-04) y, si no hay preferencia de prestador en medicina general, ordenados por menor carga (RN-02).
- `POST /citas` → crea dentro de una **transacción con bloqueo del rango del prestador** (evita doble asignación concurrente entre WhatsApp, portal y asistentes). Revalida todas las reglas al confirmar; si el cupo se ocupó, responde con alternativas.
- La IA y el portal **nunca calculan reglas**: solo muestran lo que este módulo ofrece.

## 7. Integración WhatsApp + IA (flujo)

1. Meta → `POST /webhooks/whatsapp` (verificación de `X-Hub-Signature-256` obligatoria). Se persiste el mensaje y se encola.
2. Worker: si es audio → STT → transcripción; si es imagen y el contexto es "orden médica" → **escalamiento inmediato sin OCR** (RN-08), imagen adjunta.
3. Orquestador IA: contexto de conversación + herramientas del motor. Umbral de confianza y política de escalamiento configurables. Prompt del sistema incluye la documentación comercial (P6) para responder "vendiendo".
4. Salida siempre texto (RN-09.2); confirmaciones con la plantilla de texto formateado tipo ticket (RN-09.3). Envíos salientes por cola con reintentos y registro de estado (enviado/entregado/leído).
5. Bandeja en tiempo real vía WebSocket (burbuja de pendientes, sin sonido).
6. **Antes de migrar el número real:** ambiente de prueba con un número secundario (RN-09.7) y carga del CSV de contactos (P9).

## 8. Seguridad y cumplimiento

- **Habeas Data (Ley 1581/2012):** datos personales de ~400k pacientes → aviso de privacidad en el portal y en el primer contacto por WhatsApp; finalidad limitada a la gestión de citas; procedimiento de supresión/corrección; sin datos sensibles de salud (decisión de alcance).
- **Autenticación:** JWT de corta vida + refresh, contraseñas con Argon2/bcrypt, bloqueo por intentos, RBAC por módulo (el prestador solo lee su agenda — RN-06).
- **Superficie pública mínima:** solo portal y webhook expuestos; backoffice tras login; rate limiting y CAPTCHA ligero en el portal; validación de firma en el webhook.
- **Datos:** TLS en todo (Caddy), cifrado en reposo del volumen, secretos en variables de entorno fuera del repo, backups diarios cifrados con restauración probada.
- **Aplicación:** validación de entrada con esquemas (zod/class-validator) en todos los endpoints, consultas parametrizadas (Prisma), sanitización de todo lo que se renderiza, CORS restringido, headers de seguridad (helmet).
- **Logs y auditoría:** logs sin números de documento ni teléfonos completos (enmascarados); tabla de auditoría append-only.

## 9. Ambientes y despliegue

| Ambiente | Uso | WhatsApp |
|---|---|---|
| `dev` | desarrollo local (Docker Compose: pg + redis + api + fronts) | número de prueba de Meta |
| `staging` | pruebas con el cliente (10–15 días) y piloto | número secundario (RN-09.7) |
| `prod` | lanzamiento | número principal migrado |

Despliegue: GitHub → CI (lint, tests, build, migraciones en seco) → imagen Docker → VPS por Compose. Migraciones siempre versionadas con Prisma y reversibles. Bandera `KIOSKO_ACTIVO` y parámetros de reglas (`hueco_max`, ventanas, umbrales IA) en tabla de configuración, no en código.

## 10. Decisiones registradas (ADR resumido)

| # | Decisión | Alternativa descartada | Motivo |
|---|---|---|---|
| A1 | Monolito modular | Microservicios | Equipo pequeño, plazo corto, carga baja |
| A2 | PostgreSQL | MongoDB | Transacciones para cupos, integridad relacional |
| A3 | Reglas en el motor, no en el bot | Prompt con reglas | Consistencia entre canales, testeable |
| A4 | Meta Cloud API directa | BSP intermediario / WhatsApp Web QR | D5: control, sin riesgo de bloqueo, multiagente |
| A5 | LLM con tool use | NLU entrenado a mano | Time-to-market y calidad conversacional |
| A6 | Pantallas como página web | App nativa de TV | Cualquier TV con navegador o stick HDMI (RN-11.4) |
| A7 | Kiosko construido pero apagado por bandera | No construirlo | D3: activación futura sin re-desarrollo |
