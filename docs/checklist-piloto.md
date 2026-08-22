# Checklist de salida a piloto · Grupo Provivir

Estado a la fecha de cierre del desarrollo. Lo marcado ⬜ **no depende del código**:
son credenciales, insumos del cliente o decisiones suyas.

---

## Lo que ya está listo

- ✅ Regresión completa en verde: unitarias, e2e y prueba de carga.
- ✅ Motor de agendamiento con RN-01 a RN-04, probado con property-based y concurrencia.
- ✅ Carga masiva verificada con 100.000 registros sintéticos en 67 s.
- ✅ Prueba de carga con k6: 134 citas creadas en 90 s (≈5.300/hora frente al objetivo de 400/día),
  p95 de 117 ms al consultar cupos y 181 ms al crear, 0 % de errores.
- ✅ Respaldo cifrado con restauración **probada de verdad**: 47 pacientes, 88 citas y 8 prestadores
  restaurados idénticos, y clave equivocada que no descifra.
- ✅ Revisión OWASP con verificación de comportamiento real (ver más abajo).
- ✅ Artefactos de despliegue: `docker-compose.prod.yml`, `Dockerfile.api` multi-etapa sin root,
  `Caddyfile` con TLS automático y cabeceras, guía paso a paso.

## Credenciales que faltan

| # | Qué | Quién | Bloquea |
|---|---|---|---|
| ⬜ C1 | `OPENAI_API_KEY` | Equipo técnico | Respuestas de la IA **y transcripción de notas de voz**. Sin ella todo escala a la asistente; la plataforma sigue funcionando. `ANTHROPIC_API_KEY` es opcional: queda como proveedor alterno. |
| ⬜ C2 | Meta: `APP_SECRET`, `ACCESS_TOKEN`, `PHONE_NUMBER_ID`, `WEBHOOK_VERIFY_TOKEN` | Cliente + Meta | Todo el canal WhatsApp. **Camino crítico más largo**: exige verificación de negocio con documentos legales del cliente. Empezar ya. |
| ⬜ C3 | `TURNSTILE_SECRET` | Equipo técnico | CAPTCHA del portal. Sin él el portal opera con rate limiting pero sin CAPTCHA. |
| ⬜ C4 | STT · resuelto con OpenAI Whisper | Equipo técnico | Solo configuración, cero código: `STT_URL=https://api.openai.com/v1/audio/transcriptions` y la misma clave de C1. |
| ⬜ C5 | DNS de `provivir.exagos.co` → IP del VPS | Equipo técnico | Un solo registro A. Caddy emite el certificado solo. |

## Insumos del cliente

> 🟡 = cubierto con **datos de demostración** para poder probar, no entregado por el
> cliente. Cargar con `node apps/api/dist/cli/datos-demo.js`; retirar con `--purgar`.
> Los pacientes de demostración llevan la condición «DEMO» visible en su ficha. (P1–P10)

| # | Insumo | Bloquea | Estado |
|---|---|---|---|
| 🟡 P1 | Exportación de la base de pacientes con servicios históricos | Carga masiva | Importador listo y probado |
| 🟡 P2 | Duraciones reales por prestador y tipo | Configuración de agendas | Editable desde Catálogo |
| 🟡 P3 | Ventana de control por prestador (7/10/30 días) | RN-01 | Editable desde Catálogo |
| 🟡 P4 | Criterios de prioridad alta/media/baja | Bandeja | Opera con tiempo de espera mientras tanto |
| 🟡 P5 | Métricas del "pantallazo único" | Tablero | No bloquea la primera entrega |
| 🟡 P6 | Documentación comercial de servicios | Calidad de la IA | Sin ella el bot informa pero vende poco |
| 🟡 P7 | Esquema de atención y horarios actuales | Parametrización | — |
| 🟡 P8 | Dinámica definitiva del kiosko | Activación futura | Módulo apagado por bandera |
| 🟡 P9 | CSV de contactos del celular (50.000+) | Migración del número | Importador listo y probado |
| ⬜ P10 | Enlaces de YouTube (canal + videos) | Frame de pantallas | Configurable desde Administración |

## Antes de conectar las claves de IA

- ⬜ Acuerdo de tratamiento de datos (DPA) con OpenAI y verificación de su retención de API.
- ⬜ Actualizar el aviso de privacidad del portal para declarar el procesamiento por terceros.
- ✅ Comparados `gpt-5-mini`, `gpt-5-nano` y `gpt-4.1-mini` con el arnés de evaluación. Gana `gpt-5-mini`, único sin fallos críticos. Detalle en `docs/adr-a5-proveedor-ia.md`.

Detalle en `docs/adr-a5-proveedor-ia.md`.

## Nombres de usuario de WhatsApp

Un paciente puede escribir sin exponer su teléfono: Meta entrega `from_user_id`
(`CO.1023…`) en vez de `from`. La plataforma **lo recibe y lo atiende**, con una
limitación que no depende de nosotros:

**Para responderle, el destinatario va en `recipient`, no en `to`.** Poner el
identificador en `to` devuelve `131009 · The phone number is malformed` y el
paciente se queda sin respuesta. Comprobado contra la API: `recipient` se reconoce
desde v21.0.

Si aun así el envío falla, la conversación se escala con **prioridad alta** en vez
de reintentar en vano: una asistente puede contestar desde la bandeja de WhatsApp
Business, donde estos usuarios se ven con normalidad.

Lo que sigue sin poder hacerse es lo que necesita un número: ese paciente no se
cruza con la base —siempre es «nuevo», aunque lleve años en la clínica— ni recibe
recordatorios, hasta que dé su teléfono.

- ⬜ Decidir si se agenda a quien no quiere dar teléfono, sabiendo que se queda sin
  recordatorio, o si el número es obligatorio para confirmar la cita.

## Usuarios y perfiles

Se gestionan desde **Administración → Perfiles y usuarios**: primero se define un
perfil (qué puede ver y qué no, marcando permisos), después se crea la persona y se
le asigna uno. Los cuatro perfiles base —Administración, Asistente, Médico, Pantalla
de sala— se crean solos y reproducen lo que hacían los roles anteriores.

Dos salvaguardas que conviene conocer antes de tocarlos: un perfil con usuarios no se
puede eliminar, y el sistema rechaza cualquier cambio que dejara a nadie con el
permiso «Usuarios y perfiles» — quedarse sin administrador solo se arregla por consola.

También por CLI, para lo que haga falta antes de tener acceso:

    node apps/api/dist/cli/usuarios.js                    quién existe
    node apps/api/dist/cli/usuarios.js --perfiles-prueba  uno por cada rol
    node apps/api/dist/cli/usuarios.js --crear --email … --nombre … --rol …
    node apps/api/dist/cli/usuarios.js --clave --email …  contraseña nueva
    node apps/api/dist/cli/usuarios.js --desactivar --email …

- ⬜ **Retirar las cuentas de prueba antes de atender pacientes reales**:
  `--purgar-prueba`. Terminan en `@prueba.provivir.local` para poder distinguirlas.
- ⬜ Crear las cuentas reales del equipo (asistentes, médicos, pantallas).

## Pantallas de sala · acceso

Se sirven **sin restricción de red**, por decisión del cliente: los televisores se
instalan y reinstalan sin un técnico de redes cerca, y atarlos a un rango de IP
convertía cada cambio de router en una incidencia.

Lo que las protege es que la URL lleva el id de la pantalla (un UUID) y ese id solo
se ve desde el backoffice, que sí exige sesión. Es una defensa por secreto: quien
tenga el enlace entra, y el enlace no caduca.

Consecuencias asumidas, y cómo se acotan:

- El paciente aparece **abreviado** («Rosa Q.») por defecto, no con nombre completo.
  Se cambia en Administración → Reglas, clave `mostrar_nombre_en_pantalla`:
  `completo` | `abreviado` | `oculto`.
- Las pantallas responden `X-Robots-Tag: noindex`: una URL indexada anularía el
  único control que queda.
- ⬜ Definir con la clínica el procedimiento si un enlace se filtra: se crea una
  pantalla nueva y se retira la anterior, lo que invalida el enlace viejo.
- ⬜ Tratar los enlaces como credenciales: no mandarlos por WhatsApp ni dejarlos en
  el historial de un televisor compartido.

## Decisiones pendientes del cliente

| # | Decisión | Dónde está documentada |
|---|---|---|
| ⬜ D-a | **RN-01.5** · qué cuenta como "control consecutivo". Se implementó adyacencia real: un procedimiento entre dos controles rompe la cadena, porque sí factura. | `docs/changelog-fase2.md` |
| ⬜ D-b | **RN-10.2** · el portal exige documento **+ últimos 4 del teléfono**, no solo documento, para impedir enumerar quién es paciente. Cuesta comodidad a quien cambió de número. | `docs/changelog-fase5.md` |
| ⬜ D-c | **RN-09.2** · usar botones interactivos de WhatsApp en vez de solo texto. Implementado tras la bandera `whatsapp_botones_interactivos`. | `docs/rn-09-8-oferta-web.md` |

## Antes del piloto

- ⬜ Carga real del archivo del cliente (P1) en staging y revisión del reporte de errores.
- ⬜ Parámetros del cliente configurados desde Administración → Reglas (P2, P3, P6).
- ⬜ Número de prueba de Meta operando 3–5 días con el equipo del cliente.
- 🟡 **Evaluación de la IA.** El arnés existe y corre: `npm run evaluar -w @provivir/api`
  (`--repeticiones 3`, `--modelos a,b`, `--categoria seguridad`). Los 30 casos de
  `apps/api/evaluacion/casos.json` son **sintéticos**: sirven para detectar regresiones,
  no sustituyen a los 30 mensajes **reales** anotados, que siguen pendientes. Al llegar,
  se agregan al mismo archivo con el mismo formato.
  Requiere C1 y mensajes reales. **Pendiente: es la brecha de calidad más importante.**
- ⬜ Contactos CSV migrados (P9).
- ⬜ Enlaces de YouTube configurados (P10) y **rotación validada en el TV real de la sede**
  — riesgo registrado y aceptado por ambas partes en la reunión.
- ⬜ Verificación de hardware en sede: computadores, TVs con navegador o stick HDMI,
  wifi en salas, impresora de tickets.
- ⬜ Capacitación: asistentes (bandeja y mostrador), John (dashboard), médicos (vista prestador, 10 min).
- ⬜ Respaldos copiados **fuera del servidor**.

## Dominio temporal

Se despliega en **`provivir.exagos.co`** con enrutamiento por ruta (`/` backoffice,
`/citas` portal, `/tv` pantallas), pendiente del dominio definitivo del cliente.
Cambiarlo son tres variables en `/etc/provivir/.env` y un reinicio de Caddy.

⚠️ **No imprimir los QR de la sede hasta tener el dominio definitivo.** El QR codifica
`PORTAL_URL`; si el dominio cambia después, todo lo impreso queda muerto. Lo mismo aplica
al iframe embebido en el sitio del cliente y a la URL registrada en el panel de Meta.

## Brecha de cobertura conocida

✅ **Pruebas e2e de navegador (Playwright)**: 13 pruebas sobre los tres frontends.
`npm run e2e` (o `-- --project=portal`, `-- --headed` para verlas correr). Levanta la
API y los tres vite contra `provivir_e2e`, una base propia que se recrea en cada
corrida. Verificadas en tres ejecuciones seguidas.
No se ejecutaron porque el entorno de desarrollo no tiene navegador ni permisos para
instalarlo. Los flujos se verificaron contra la API y manualmente. **Recomendación:
correrlas en el entorno de staging antes del lanzamiento**, donde sí hay Docker.

## Plan de reversa

Si la API de Meta falla, el número sigue operable a mano: las asistentes atienden desde
la bandeja, el mostrador opera sin WhatsApp, y el portal y el backoffice agendan igual.
Ningún canal depende de otro.
