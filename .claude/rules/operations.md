# Operaciones y desarrollo

## `packages/shared` se compila antes que la API

La API resuelve `@provivir/shared` contra su `dist`, no contra el código; jest sí mapea al
fuente. Si no se recompila, una constante nueva del paquete compartido pasa las pruebas y no
llega a lo que corre.

## Convenciones de desarrollo

- TypeScript estricto. Nada de `any` sin justificación en comentario.
- Commits convencionales: `feat:`, `fix:`, `test:`, `chore:`.
- Entradas validadas con esquema (zod/class-validator) en **todos** los endpoints, incluidos
  webhooks y archivos.

## Comandos sin Docker en la máquina

`npm run db:local -w @provivir/api` levanta PostgreSQL 16 real con binarios de usuario, y
`npm run redis:local -w @provivir/api` un Redis 7.2, ambos sin root.

## Usuarios del seed

Solo desarrollo, password `Provivir2026!`:
`admin@` · `asistente@` · `osorio@` (rol prestador, ficha `ao`) · `pantalla@` — todos
`@provivir.local`.

## Lo que no se decide sin revisión humana

Borrar migraciones · cambiar el esquema de auditoría · tocar la verificación de firma del
webhook de Meta (`X-Hub-Signature-256`) · cambiar dependencias mayores · activar
`KIOSKO_ACTIVO`.

## Prohibiciones operativas

- **Nunca** tocar `.env` ni escribir secretos en el código. Solo `.env.example` con placeholders.
