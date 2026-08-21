# Plataforma de agendamiento inteligente · Grupo Provivir

Sede única CDC Oriente (Cali). Agendamiento de citas médicas por cuatro canales —
backoffice, WhatsApp con IA, portal público y pantallas de sala — sobre un único motor
de reglas.

## Arranque rápido

```bash
npm install
docker compose up -d                                  # Postgres 16 + Redis 7
npm run db:migrate -w @provivir/api
npm run db:seed -w @provivir/api
npm run dev                                           # API :3000 · backoffice :5173
```

Sin Docker en la máquina:

```bash
npm run db:local -w @provivir/api      # PostgreSQL 16 con binarios de usuario
npm run redis:local -w @provivir/api   # Redis 7 sin root
```

Usuarios del seed (solo desarrollo, contraseña `Provivir2026!`):
`admin@` · `asistente@` · `osorio@` (prestador) · `pantalla@`, todos `@provivir.local`.

## Aplicaciones

| App | Puerto | Para quién |
|---|---|---|
| `apps/api` | 3000 | API, motor de agendamiento, webhook de Meta |
| `apps/backoffice` | 5173 | Administración, asistentes y prestadores |
| `apps/portal` | 5174 | Pacientes — autoagendamiento público |
| `apps/tv` | 5175 | Pantallas de sala (`/?pantalla=<id>`) |

## Comandos

```bash
npm test                              # unitarias
npm run test:e2e -w @provivir/api     # integración contra base real
npm run lint
npm run carga:k6 -w @provivir/api     # prueba de carga
npm run carga:limpiar -w @provivir/api
```

## Dónde está todo

| | |
|---|---|
| Reglas de negocio | `docs/MediTurno_Provivir_Logica_de_Negocio_v2.0.md` — RN-01 a RN-12 |
| Qué se hizo en cada fase | `docs/changelog-fase0.md` … `changelog-fase6.md` |
| Qué falta para producción | `docs/checklist-piloto.md` |
| Cómo desplegar | `despliegue/GUIA-DESPLIEGUE.md` |
| Convenciones y prohibiciones | `CLAUDE.md` |

## El principio que gobierna el diseño

**Las reglas de agendamiento viven en un solo lugar: el módulo `citas`.** WhatsApp, el portal
y el backoffice consumen `GET /cupos` y `POST /citas`; ninguno recalcula nada, ni siquiera el
prompt de la IA. Un cupo ofrecido por cualquier canal es el mismo cupo, con las mismas reglas,
revalidadas al confirmar. Hay un gate en CI que falla si alguien reimplementa esa lógica fuera
del motor.
