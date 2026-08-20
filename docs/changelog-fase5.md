# Changelog · FASE 5 — Autoagendamiento web + kiosko apagado

**Estado:** completa. 19 pruebas e2e propias en verde.
**Nota de orden:** esta fase se adelantó a la Fase 4 por decisión del cliente: el bot de
WhatsApp debe ofrecer el enlace del portal (RN-09.8), y no tiene sentido soltar un enlace
a algo que no existe.

## Backend · módulo `portal`
Toda la superficie es pública (`@Publico`), con rate limiting por endpoint según su riesgo:
identificar 8/min, registrar 5/min, agendar 10/min, cupos 40/min.

- `GET /portal/aviso-privacidad` — Ley 1581/2012: responsable, finalidad, derechos.
- `GET /portal/servicios` — catálogo reducido; **no expone** política de costo ni cupos internos.
- `POST /portal/identificar` — paciente registrado.
- `POST /portal/registrar` — paciente nuevo, con `origen = autoagendamiento` (RN-10.4).
- `POST /portal/cupos` — **el mismo motor** que usa el backoffice (Arquitectura §6).
- `POST /portal/agendar` — confirmación con código único de atención.
- `GET /portal/qr.png` — QR para imprimir en sede y embeber en grupoprovivir.com (RN-10.1).

**Sesión efímera:** identificar/registrar devuelven un JWT de 20 minutos marcado `portal: true`.
Un token del backoffice **no sirve** para agendar por el portal (hay test que lo verifica): sin esa
marca, una credencial de asistente valdría como sesión de paciente.

## Módulo `kiosko` (D3)
Construido y **apagado por bandera** (`kiosko_activo` en la tabla de configuración, no en código).
`GET /kiosko/estado` devuelve la pantalla de opciones propuesta para el futuro; cualquier operación
real responde 503. Cumple el ADR A7: activación futura sin re-desarrollo.

## Frontend · portal público
Pensado para el celular primero — el caso de uso es el paciente en la cola que se autogestiona y se
retira. Flujo **sin IA**: dos botones grandes → datos → servicio → fecha/horario → confirmación con
el código en grande. Aviso de privacidad desplegable en el pie y consentimiento explícito con
checkbox antes de guardar datos de un paciente nuevo.

## Interpretación de RN-10.2 que conviene confirmar

**El portal pide documento + los últimos 4 dígitos del teléfono**, no solo el documento.

RN-10.2 dice "Registrado: documento → validación". Pero el portal es público y sin login: con solo
el documento, cualquiera podría averiguar quién es paciente de la clínica probando cédulas — y el
checklist §4 exige explícitamente "sin enumeración de pacientes". Los cuatro dígitos convierten la
consulta en una verificación en vez de un oráculo. El mensaje de error es **idéntico** cuando el
documento no existe y cuando el teléfono no coincide (hay test que compara ambas respuestas).

Costo: un paciente cuyo teléfono cambió no puede entrar por ese camino y debe llamar o escribir.
**Confirmar con John Mendoza** si prefiere asumir el riesgo de enumeración a cambio de esa comodidad.

## Mejora encontrada al usar el portal, no en las pruebas

Tras agendar la primera cita de la mañana con Osorio, el portal pasaba a ofrecer **solo las tardes
de Ortiz** y escondía por completo la mañana libre de Osorio y Ríos. Era el balanceo (RN-02)
funcionando: al ordenar prestadores por carga, la lista se llenaba con los cupos del primero.

Correcto según la regla, pésimo para el paciente, que pidió "el lunes" y solo veía las 14:00.

Ahora la oferta **intercala por prestador en ronda**: el mejor cupo del menos cargado, luego el del
siguiente, y así. RN-02 sigue decidiendo a quién se propone primero y RN-03 qué hora dentro de cada
agenda, pero el paciente ve un abanico real de horarios. Dos pruebas nuevas lo cubren.

## Seguridad de la fase
- Rate limiting agresivo por endpoint; CAPTCHA (Cloudflare Turnstile) detrás de `TURNSTILE_SECRET`.
  **Sin clave configurada el portal opera sin CAPTCHA** y lo advierte en el log de arranque —
  no hay clave en este entorno, así que esa ruta no se pudo probar contra Cloudflare.
- Sin enumeración de pacientes (dos tests dedicados).
- Validación estricta de entrada; el registro exige aceptar el aviso de privacidad.
- Auditoría del alta de paciente desde el portal, con documento enmascarado.

## Pendiente
- `TURNSTILE_SECRET` real para validar el CAPTCHA de punta a punta.
- `PORTAL_URL` de producción para que el QR apunte al dominio del cliente y no a localhost.
- Confirmación por WhatsApp del código (RN-10.3): se encola en la Fase 4.
