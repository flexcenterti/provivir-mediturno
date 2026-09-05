# Changelog · FASE 4 — WhatsApp + IA + bandeja

**Estado:** completa. 120 unitarias + 103 e2e en verde.

## Canal WhatsApp (RN-09, D5)
- **Webhook de Meta** con verificación obligatoria de `X-Hub-Signature-256`, comparada en
  **tiempo constante**: un `===` filtra por temporización cuántos bytes del prefijo coinciden y
  permite reconstruir la firma. El cuerpo crudo se preserva antes del parser de JSON, o la firma
  nunca coincidiría. 12 pruebas dedicadas.
- El webhook **solo encola** y responde 200: Meta reintenta si tardamos, y procesar en línea
  multiplicaría los duplicados. El `waMessageId` se usa como `jobId`, así BullMQ deduplica los reintentos.
- **Multimedia entrante completo** (RN-09.2): notas de voz, fotos, videos y documentos, normalizados
  del formato de Meta al interno. Ningún otro módulo conoce el formato de Meta.
- **Media fuera del webroot** con nombre generado: nada de lo que envía el paciente toca el
  sistema de archivos con su nombre original.
- Plantillas de **texto formateado tipo ticket** (RN-09.3): confirmación, recordatorio, cancelación
  y aviso de reprogramación. Un test verifica que ninguna usa la palabra "urgencia" (D6).
- **Sin credenciales de Meta el canal opera en simulación**: registra lo que habría enviado en vez
  de fallar. Así el sistema completo es probable sin cuenta de Meta.

## IA conversacional (ADR A3/A5)
- Orquestador con **8 herramientas** hacia el motor: buscar/registrar paciente, listar servicios,
  ofrecer cupos, confirmar, consultar, cancelar y escalar.
- **Las reglas RN-01 a RN-04 NO están en el prompt.** Viven en el motor y se revalidan al confirmar.
  Ponerlas en el prompt las volvería sugerencias en vez de invariantes, y divergirían entre canales.
  Cuando el motor rechaza, el error vuelve al modelo como resultado de herramienta para que ofrezca
  alternativas, no para que lo reinterprete.
- `claude-opus-5` con adaptive thinking y `effort: low` — agendar es una tarea acotada y la
  conversación tiene que ser ágil. `max_tokens: 2048`: las respuestas de WhatsApp son cortas a propósito.
- **Fallback de servidor activado**: si un clasificador de seguridad declina el turno, la API enruta
  a un modelo alterno; si aun así hay `stop_reason: "refusal"`, se escala en vez de dejar al paciente
  sin respuesta. Hay test.
- Tope de **8 turnos de herramientas** por mensaje: un bucle no debe gastar sin fin. Al agotarse, escala.
- El LLM **no accede a la base**: cada herramienta valida su entrada y delega. Un paciente no puede
  cancelar la cita de otro aunque el modelo lo pida — hay test.

## Escalamiento (RN-08)
- **Foto de orden médica → escala de inmediato, sin OCR.** El test decisivo verifica que el modelo
  **nunca se invoca**: la imagen se descarga, se adjunta y la conversación pasa a la asistente.
- **Nota de voz sin transcripción → escala con el audio adjunto.** No se adivina el contenido.
- **Pedir una persona escala sin gastar un turno de IA**: se detecta antes de invocar el modelo.
- Una conversación ya escalada **no vuelve a pasar por la IA**.

## Bandeja (RN-08.3, Especificación §2.9)
Motivo, prioridad, **tiempo esperando** e historial completo con los adjuntos del paciente.
Orden: prioridad y, dentro de ella, quien lleva más esperando — porque mientras el cliente no defina
los criterios de prioridad (P4), la columna operativa dominante es el tiempo de espera (RN-05.3).
**Superado en la fase 18**: la bandeja pasó a ordenarse por actividad reciente, con la
etiqueta de prioridad siempre visible. Ver `docs/rn-05-3-orden-de-la-bandeja.md`.
La asistente toma, responde por WhatsApp y resuelve sin salir de la plataforma.
**Burbuja roja con el conteo en el menú lateral, sin sonido** (decisión explícita del cliente).

## Recordatorios
24 h antes y 3 h antes, por cola con reintentos. Se reprograman al mover la cita y se cancelan al
cancelarla. Si la cita se canceló entre la programación y el envío, no se manda nada.

## RN-09.8 · oferta del portal web
Implementada como se especificó: se menciona el enlace y se sigue atendiendo en el mismo mensaje,
una sola vez por conversación. Pedir cupos cuenta como intención de agendar y programa el seguimiento
(`whatsapp_seguimiento_portal_min`, valor inicial 30). El seguimiento **verifica que no exista cita**
antes de escribir, y no interviene si una asistente ya tomó la conversación. Tres pruebas lo cubren.

## Importador de contactos (RN-09.5, P9)
CSV de la agenda del celular (50.000+), con mapeo tolerante a exportaciones de Google/iOS.
Va a una tabla `contacto` propia: **no crea pacientes**, porque un contacto del celular no tiene
documento y no es historia. Deduplica por teléfono normalizado a E.164.

## Ciclo de módulos que hubo que romper
`citas → recordatorios → whatsapp → ia → citas`. En vez de sembrar `forwardRef`, se extrajo la
infraestructura de salida (`MetaCliente`, `TranscripcionService`) a un `MetaModule` global sin
dependencias de dominio. Los recordatorios necesitan enviar mensajes, no el canal conversacional completo.

## Lo que NO se pudo probar aquí
- **La API real de Anthropic**: no hay clave en este entorno. El orquestador se prueba con un doble
  programable del modelo, lo que cubre el cableado, las herramientas y el escalamiento — **pero no la
  calidad de las respuestas del modelo real**. La evaluación con el set de 30 mensajes anotados que
  pide la guía **queda pendiente** y necesita la clave y mensajes reales del cliente.
- **La API real de Meta**: sin credenciales, el canal corre en simulación. La firma sí se prueba de
  verdad, con HMAC real.
- **STT**: sin proveedor configurado (el cliente no lo ha elegido). Las notas de voz escalan, que es
  el comportamiento correcto mientras tanto.

## Pendientes del cliente que bloquean calidad
- **P6 · documentación comercial**: sin ella el bot informa pero vende poco. El prompt lo dice
  explícitamente y le prohíbe inventar beneficios o precios.
- **P9 · CSV de contactos**: el importador está listo y espera el archivo.
- **RN-09.2 vs botones**: `whatsapp_botones_interactivos` está en `false`. El cliente debe aprobar
  el ajuste de RN-09.2 para activarlos (ver `docs/rn-09-8-oferta-web.md`).
