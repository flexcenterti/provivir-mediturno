# Arquitectura

Detalle completo, módulos, modelo de datos y ADRs A1–A7 en
`docs/MediTurno_Provivir_Arquitectura_v1.0.md`. Esto es lo que hay que tener presente al tocar
código, no un reemplazo de ese documento.

## Estructura del monorepo

`apps/api` (NestJS + Prisma), `apps/backoffice` (React + Vite), `apps/portal`, `apps/tv`,
`packages/shared` (tipos, constantes, validadores). Postgres 16 + Redis/BullMQ. WhatsApp: Meta
Cloud API. IA: API de Anthropic con tool use.

## El motor es el único que calcula reglas

`citas.reglas.ts` tiene las funciones puras; `citas.service.ts` las orquesta en transacciones.
Ningún otro módulo replica lógica de agendamiento — WhatsApp, portal y backoffice consumen
`GET /cupos` y `POST /citas` (ver la prohibición correspondiente en
[business-rules.md](business-rules.md)).

## El token de refresco NO es un `Bearer`

Los dos se firman con el mismo secreto, así que sin la marca `tipo` del payload son
intercambiables y guardar el de refresco equivaldría a un token de acceso con la vida de la
sesión entera. `JwtStrategy` rechaza los de refresco; el canje rechaza los de acceso. Las
duraciones se editan en Administración → Reglas (`sesion_ttl_acceso`, `sesion_ttl_inactividad`),
no en el código.

## Proveedor de IA

Se elige con `IA_PROVEEDOR` (openai | anthropic). Los dos adaptadores viven en
`apps/api/src/ia/adaptadores/`; el orquestador no conoce ningún SDK.
Ver `docs/adr-a5-proveedor-ia.md`.
