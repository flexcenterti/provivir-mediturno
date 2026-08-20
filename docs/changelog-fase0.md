# Changelog · FASE 0 — Fundaciones

**Objetivo (Guía §2):** repo, ambientes y esqueleto corriendo.
**Estado:** completa. Pruebas en verde y demo funcionando.

---

## Entregado

### Monorepo
- Estructura §1.1 con npm workspaces: `apps/{api,backoffice,portal,tv}`, `packages/shared`.
- `CLAUDE.md` (§1.2), `.gitignore` (con `.env` y `*.csv` — la carga masiva trae PII), `.env.example`.
- TypeScript estricto compartido en `tsconfig.base.json` (`noUncheckedIndexedAccess` incluido).
- ESLint 9 flat config + Prettier. `npm run lint` en verde con `--max-warnings 0`.

### Base de datos
- `docker-compose.yml`: Postgres 16-alpine + Redis 7-alpine con healthchecks.
- Esquema Prisma con las entidades base (Arquitectura §5) y migración inicial `20260820204143_inicial`.
- Índices del motor ya en su sitio: `cita(fecha, prestador_id, hora_inicio)`, `turno(estado, prioridad, llegada_ts)`,
  `conversacion(escalada, resuelta_ts)`, `paciente(documento)`.
- Invariante en BD: `@@unique([sedeId, fecha, codigo])` — el código de atención no se repite en el día.
- `cita.horaInicio` se guarda como **minutos desde medianoche** (int), no como texto ni timestamp:
  la aritmética de solapamiento del motor (Fase 2) queda sin ambigüedad de zona horaria.

### Seed
Datos del prototipo `index_v2.html`, idempotente:
- 10 servicios con tipo y cupos — **Doppler = 2 cupos** (RN-04.4), control con `politicaCosto = sin_costo` (RN-01.2).
- 8 prestadores, **3 en grupo de balanceo de medicina general** (RN-02.1), con duración por prestador y tipo (RN-01.4)
  y ventana de control propia: Osorio 10 días, Ríos 8, Ortiz 30 (RN-01.3).
- 8 agendas (semanal y calendario), 7 pacientes con historial de servicios, 3 pantallas.
- 7 parámetros en tabla `configuracion` (`hueco_max_min`, `kiosko_activo`, umbrales…) — fuera del código, Arquitectura §9.
- 4 usuarios, uno por rol. Password de desarrollo: `Provivir2026!`.

### Auth
- Login JWT con access + refresh; Argon2id (19 MiB, t=2) para contraseñas.
- `JwtAuthGuard` global: **todo exige token salvo lo marcado con `@Publico()`**.
- `RolesGuard` con `@Roles(...)`, listo para la Fase 3.
- La estrategia JWT revalida el usuario contra la BD en cada petición: un usuario desactivado
  pierde acceso de inmediato sin esperar a que expire el token.
- El token no transporta PII (hay un test que lo verifica).
- Mismo mensaje y costo aproximado exista o no la cuenta: sin enumeración de usuarios.

### Pruebas
- **15 unitarias** (`packages/shared`): RN-01 intercalado, RN-06 gobierno de agendas, conversión de horas, constantes.
- **16 e2e** (`apps/api`): login de los 4 roles con rol correcto en el token, acceso denegado sin token
  y con token inválido, RN-06.2 (usuario prestador atado a su ficha), validación de entrada, health.
- Los tests de regla llevan el ID de la RN en el nombre (Guía §3).

### CI
`.github/workflows/ci.yml` con servicios Postgres 16 + Redis 7: `npm audit --audit-level=high` → gitleaks →
lint → prisma generate → migrate deploy → seed → unitarias → e2e → build.

### Seguridad de la fase
- Argon2id, helmet, CORS restringido por lista, rate limit global + límite estricto en login.
- Validación de entrada con `class-validator` (`whitelist` + `forbidNonWhitelisted`) y de entorno con zod:
  **si falta una variable el proceso no levanta**.
- `disableErrorMessages` en producción; el health degrada sin filtrar el error interno.
- `npm audit`: **0 vulnerabilidades**.

---

## Decisiones tomadas en la fase

| # | Decisión | Motivo |
|---|---|---|
| F0-1 | Rate limits configurables por ambiente (`THROTTLE_*`) | La suite e2e necesita un techo distinto al de producción. Se resolvió con configuración, no con un parche de test. |
| F0-2 | `override` de `deepmerge-ts@^8.0.1` | `prisma@6.19.3` arrastra `deepmerge-ts@7.1.5` con vulnerabilidad alta (GHSA-ggr8-5vv4-36mx). Prisma 7 tampoco lo corrige. Verificado: `prisma validate/generate/migrate` funcionan con la versión parcheada. |
| F0-3 | `packages/shared` compila a `dist` y se consume como paquete | Con path mapping al código fuente, `tsc` anidaba la salida de la API en `dist/apps/api/src/`. |
| F0-4 | Se mantiene Prisma 6 (no se sube a 7) | Cambiar dependencias mayores requiere revisión humana (CLAUDE.md). |

---

## Deuda y notas para la Fase 1

- **Redis no está en uso todavía.** Declarado en compose y en `.env.example`; entra con BullMQ en la Fase 1 (carga masiva).
- **Sin `refresh` endpoint.** El login ya emite refresh token, pero falta la rotación. Fase 1.
- **Auditoría sin escrituras.** La tabla existe; el interceptor que la alimenta entra con el primer CRUD real.
- El seed borra y recrea agendas y pantallas en cada corrida (`deleteMany`). Es correcto en desarrollo;
  **no debe correrse contra staging con datos del cliente**.

## Limitaciones del entorno de desarrollo actual

La máquina donde se construyó esta fase no tiene Docker ni permisos de root, así que el stack de
`docker-compose.yml` **no se pudo ejecutar aquí** (sí está escrito y lo usa el CI, que corre Postgres 16 y Redis 7).
Para desarrollar sin Docker se agregó `npm run db:local -w @provivir/api`, que levanta **PostgreSQL 16.14 real**
con binarios de usuario (`embedded-postgres`) — misma major que producción.

Pendiente para el entorno definitivo: Docker instalado (necesita root) para levantar Redis, que es
**bloqueante para la Fase 1** (colas de carga masiva con BullMQ).
