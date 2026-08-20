# RN-09.8 · Oferta de autoagendamiento web desde WhatsApp

**Origen:** solicitud del cliente posterior a la Especificación v2.0. No está en la
Lógica de Negocio v2.0; se registra aquí para mantener la trazabilidad del resto de reglas.

**Estado:** especificada y aprobada. Se implementa en la Fase 4.

---

## Regla

1. Cuando la IA detecta **intención de agendar**, responde en un solo mensaje ofreciendo el
   enlace del portal **y continuando la atención**. No pregunta ni espera respuesta: no se
   agrega un ida y vuelta a todas las conversaciones de agendamiento.

   > Con gusto te ayudo a agendar. 🙂
   > Si prefieres hacerlo tú mismo, aquí puedes: {PORTAL_URL}
   > O seguimos por aquí: ¿para qué servicio necesitas la cita?

2. El **enlace es genérico** — el mismo público de siempre, sin identidad embebida. El paciente
   entra como "registrado" y se verifica con documento + últimos 4 del teléfono (RN-10.2).
   Racional: un enlace con la identidad del paciente es una credencial que se reenvía sola.

3. Si el paciente **sigue en chat**, la IA lo atiende con normalidad: identifica, ofrece los cupos
   del motor y confirma con el texto formateado tipo ticket (RN-09.3).

4. Si el paciente **elige la web y no completa**, a los N minutos (configurable, valor inicial 30)
   el bot retoma: *"¿Pudiste agendar? Si prefieres, te ayudo por aquí"*. Antes de escribir se
   verifica que no exista cita creada para ese teléfono, para no molestar a quien sí agendó.
   Parámetro: `whatsapp_seguimiento_portal_min` en la tabla `configuracion`.

5. **Escalamiento:** se conservan todos los disparadores de RN-08, más uno nuevo — que el paciente
   se atasque después de haber recibido el enlace.

## Conflicto con RN-09.2 · pendiente de aprobación del cliente

RN-09.2 dice que las respuestas de la plataforma son **siempre texto**. Los botones interactivos de
la API de Meta harían este flujo notablemente más claro que pedir que el paciente escriba una opción.

Se implementan **ambas salidas** detrás del parámetro `whatsapp_botones_interactivos`, con valor
inicial `false`. El bot manda texto plano hasta que el cliente apruebe el ajuste de RN-09.2; al
aprobarlo se activa sin tocar código.

Probablemente RN-09.2 se redactó para excluir **imágenes** (el cliente hoy manda pantallazos), no
botones — pero es una decisión suya, no nuestra. **Confirmar con John Mendoza.**

## Métrica

Las citas creadas por el portal quedan con `origen = autoagendamiento`. Para medir cuántas vienen
de la oferta del bot habría que distinguirlas de las que llegan por el QR de la sede o la web.
Queda anotado como posible ajuste del tablero de métricas (P5), no bloqueante.
