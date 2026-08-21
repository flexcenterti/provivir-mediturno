# Changelog · FASE 6 — Pantallas de administración, métricas y endurecimiento

**Estado:** completa. 120 unitarias + 103 e2e + prueba de carga en verde.

## Pantallas de administración
Las que faltaban del prototipo, todas sobre API ya existente y probada:

- **Pacientes** · búsqueda, alta, edición, marcas preferenciales y ventana emergente con los
  últimos 10 servicios. El documento no se edita: es el identificador de deduplicación.
- **Catálogo** · prestadores con duración por servicio, ventana de control propia y grupo de
  balanceo; servicios con tipo y cupos múltiples.
- **Agendas** · modos semanal y calendario, **programación mensual masiva** con calendario
  clicable y atajo "todos los martes del mes", y **bloqueo con simulación previa** que muestra
  las citas afectadas antes de aplicar.
- **Administración** · carga masiva de pacientes y contactos con avance en vivo y reporte de
  errores descargable; auditoría navegable y filtrable; configuración de pantallas incluido el
  frame de YouTube; kiosko visible en modo desactivado; y los parámetros de reglas editables
  sin desplegar código.
- **Bandeja** con burbuja roja de pendientes, sin sonido.

## Métricas
Reporte operativo por rango: citas por servicio y por prestador, y el desempeño del canal de
WhatsApp con el **porcentaje de resolución automática** — la métrica contra la que se medirá la
promesa hecha al cliente (30–40 % al arranque, 70–90 % con el tiempo).

## Prueba de carga (k6)

Instalado sin root. Tres escenarios simultáneos: consulta de cupos hasta 50 usuarios,
portal público y creación sostenida de citas.

| Métrica | Resultado | Objetivo |
|---|---|---|
| Citas creadas | **134 en 90 s** (≈5.300/hora) | 400+/día |
| p95 consulta de cupos | **117 ms** | < 1.000 ms |
| p95 creación de cita | **181 ms** | < 3.000 ms |
| Errores | **0 %** | < 2 % |
| Checks | **100 %** | — |

Dos cosas que encontró la prueba, no los tests:

**El límite del catálogo público era demasiado estricto.** 60 peticiones/minuto por IP suena
razonable hasta que se recuerda que toda una sala de espera comparte la IP pública del wifi de la
sede por NAT. Apretarlo ahí solo bloqueaba pacientes legítimos sin proteger nada: el catálogo es
una lista estática. Subido a 300/min; los endpoints que escriben siguen estrictos.

**Los umbrales globales medían lo que no debían.** `http_req_failed` contaba los 429 del portal
como fallos, castigando al rate limit por funcionar. Ahora los umbrales van **por endpoint**.

## Respaldos, con restauración probada de verdad

`scripts/respaldo.sh` genera un dump en formato custom, comprimido y **cifrado con AES-256**
(PBKDF2, 200.000 iteraciones), con rotación configurable. Se niega a correr sin `RESPALDO_CLAVE`:
un dump con 400.000 pacientes sin cifrar no debe existir. Si algo falla a mitad, borra el archivo
parcial — un respaldo a medias es peor que ninguno.

**Verificado end-to-end**, no solo escrito: respaldo → base desechable → restauración →
47 pacientes, 88 citas, 8 prestadores y 7 parámetros **idénticos al origen**. Con clave
equivocada, `bad decrypt`.

Nota de entorno: `pg_dump` no venía con los binarios embebidos ni con el jar de zonky, así que se
extrajo el cliente oficial de PostgreSQL 16 del paquete de Ubuntu sin root para poder probarlo.

## Revisión OWASP · verificando comportamiento, no afirmándolo

| | Verificación | Resultado |
|---|---|---|
| A01 | Sin token, prestador en bandeja, prestador modificando agenda, asistente tocando configuración | 401 / 403 / 403 / 403 |
| A03 | SQL en el buscador, campo no declarado, path traversal en documento | Parametrizado / 400 / 400 |
| A05 | Cabeceras de helmet y `x-powered-by` | 7 cabeceras presentes, versión oculta |
| A07 | Cuenta inexistente vs. contraseña incorrecta | **Respuesta idéntica** |
| A09 | Errores en `NODE_ENV=production` | Genéricos, sin detalle interno |

Un falso positivo que valió la pena investigar: A07 dio "DIFIEREN" en la primera pasada. No era
enumeración — era el rate limit del login devolviendo 429 a una de las dos peticiones. Con margen
de límite, las respuestas son idénticas byte a byte.

## Dos gates nuevos en CI

- **Terminología (D6):** falla si reaparece "urgencia" de cara al usuario. Admite un marcador
  `D6-permitido` para el único uso legítimo — derivar a alguien a un servicio **externo**, que es
  exactamente lo que la regla protege, no lo que prohíbe.
- **Aislamiento de reglas (ADR A3):** falla si aparece lógica de agendamiento fuera del módulo
  `citas`. Impide que alguien reimplemente el intercalado o el balanceo en otro canal.

## Despliegue
`docker-compose.prod.yml` (Postgres y Redis sin puertos publicados, límites de memoria,
healthchecks), `Dockerfile.api` multi-etapa que corre **como usuario `node`, nunca root**,
`Caddyfile` con TLS automático, CSP por dominio y las pantallas de sala **restringidas a la red
interna de la sede**, y una guía de despliegue paso a paso.

## Lo que sigue faltando
Ver `docs/checklist-piloto.md`. En corto: credenciales de Meta (camino crítico más largo, exige
verificación de negocio), clave de Anthropic, insumos P1–P10 del cliente, tres decisiones
pendientes, y las pruebas de navegador con Playwright — que no se pudieron ejecutar aquí por falta
de navegador y deberían correrse en staging.
