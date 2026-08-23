# RN-09.9 · Seguimiento comercial del interesado que no agenda

**Origen:** solicitud posterior a la Especificación v2.0. No está en la Lógica de Negocio v2.0;
se registra aquí para mantener la trazabilidad del resto de reglas.

**Estado:** especificada. Pendiente de implementación (fase 7).

**Extiende:** `docs/rn-09-8-oferta-web.md` §4, que ya implementa un seguimiento diferido con
verificación previa de cita. Esta regla generaliza esa mecánica a una secuencia comercial.

---

## Por qué

RN-09.8.4 ya persigue al paciente que **eligió la web y no completó**: un mensaje a los N minutos,
verificando antes que no exista cita. Funciona y su racional está bien —"insistirle a quien ya
tiene su cita es peor que no hacer seguimiento".

Falta el otro caso, que es el más común: el paciente que **preguntó por un servicio, recibió el
ofrecimiento de agendar y simplemente no volvió a escribir**. Hoy se pierde entero: nadie lo retoma.

La mecánica es la misma cola y la misma verificación. Lo que cambia es el disparador, la cadencia y
el contenido.

---

## Regla

### RN-09.9.1 · Cuándo se arma

Cuando concurren las tres condiciones:

1. la conversación tiene interés comercial **alto o medio** con un servicio identificado;
2. el bot **ya ofreció la cita**;
3. la conversación queda **inactiva** y **no existe cita** para ese paciente y servicio.

`T0` es el instante del último mensaje de la conversación, no el de la pregunta. Así nunca se le
escribe encima a alguien que todavía está conversando.

### RN-09.9.2 · Cadencia: tres mensajes, máximo

| Mensaje | Momento | Propósito |
|---|---|---|
| Seguimiento 1 | `T0 + 2 h` | Pregunta abierta que resuelve la objeción más probable, con **un beneficio de la ficha comercial que aún no se mencionó** |
| Seguimiento 2 | `T0 + 5 h` | Algo **nuevo y concreto**: disponibilidad real de horarios, o la barrera detectada (preparación, orden médica, duración) |
| Cierre | `T0 + 8 h` | Cierre cordial que deja la puerta abierta, **sin pregunta y sin volver a insistir** |

### RN-09.9.3 · Contenido

1. Cada mensaje se construye con las herramientas de RN-13 (`consultar_servicio` para toda cifra,
   `buscar_conocimiento` para el resto). Aplica íntegra la prohibición de `ia.prompt.ts`: nada que
   no haya devuelto una herramienta.
2. **Cada mensaje debe aportar información nueva.** Repetir el mismo argumento tres veces es lo que
   convierte un seguimiento en spam y degrada la calidad del número.
3. **Un solo llamado a la acción por mensaje.**
4. El mensaje de cierre no lleva pregunta.

### RN-09.9.4 · Condiciones de corte

Se evalúan **inmediatamente antes de cada envío**, no al programarlo — reutilizando la verificación
que ya existe en `conversacion.service.ts`. El paciente pudo agendar por teléfono una hora después.

**Cancelan la secuencia completa:**
- el paciente responde cualquier cosa;
- se crea la cita por **cualquier** canal (WhatsApp, portal o mostrador);
- el paciente pide no ser contactado → además marca `Paciente.noContactar` de forma permanente
  (Ley 1581/2012);
- el servicio se desactiva (RN-04.5.4).

**Pausa la secuencia:** la conversación está escalada y tomada por una asistente. La plataforma no
le escribe encima a quien está atendiendo.

Las condiciones que **cancelan** se evalúan antes que las que **difieren**: no tiene sentido
reprogramar un envío que de todos modos no debía salir.

### RN-09.9.5 · Ventana horaria

Los envíos ocurren solo dentro del horario de atención de la sede. Lo que caiga fuera se difiere al
siguiente bloque hábil conservando el orden. Un mensaje comercial automático a las once de la noche
cuesta más de lo que puede ganar.

El horario se calcula con `hoyEnSede()` / `fechaEnZona()` de `@provivir/shared`. La clínica opera en
Cali (UTC−5) y el servidor puede estar en otra zona.

### RN-09.9.6 · Ventana de 24 horas de Meta

La secuencia completa termina en `T0 + 8 h` precisamente para caber en la **ventana de atención al
cliente de 24 horas** que abre el mensaje del paciente. Dentro de ella son mensajes de formato libre
y no requieren plantilla preaprobada.

Si un diferimiento por RN-09.9.5 empujara un envío fuera de esa ventana, solo puede salir como
**plantilla aprobada por Meta**; sin plantilla, **se descarta** y se registra el motivo. Es una
restricción de la plataforma de WhatsApp, no una decisión de producto.

### RN-09.9.7 · Límites de insistencia

1. Máximo **tres mensajes**. No hay cuarto intento.
2. **Una sola secuencia por paciente y servicio cada 30 días.** Si vuelve a preguntar lo mismo se
   le atiende normalmente, pero no se rearma.
3. Máximo **una secuencia activa por paciente**, aunque haya preguntado por varios servicios.

Los límites se hacen cumplir con **restricciones de base de datos**, no solo con lógica de
aplicación: un bug de reintentos que mande cinco mensajes comerciales en una tarde es un riesgo
reputacional y de bloqueo del número.

### RN-09.9.8 · Visibilidad para el personal

Los interesados sin agendar y el estado de su secuencia se ven **en la bandeja de la asistente,
debajo de las conversaciones escaladas**. Por cada uno: contacto, servicio, cuándo preguntó, en qué
paso va y cuándo sale el próximo mensaje. Acciones: tomar el caso y escribir a mano, detener el
seguimiento, o marcar como agendado.

Va en la bandeja y no en un tablero aparte por una razón operativa: es donde la asistente ya
trabaja. Lo automático es el piso, no el techo.

**No suma a la burbuja roja del menú.** Esa burbuja cuenta conversaciones que esperan respuesta
humana ahora (RN-08.3); mezclarlas diluye la señal que hace reaccionar a la asistente.

### RN-09.9.9 · Medición

Conversión por paso —cuántas citas cierra el mensaje 1, el 2 y el cierre— y tasa de opt-out, para
poder ajustar o apagar la secuencia con datos y no por impresión.

---

## Decisión pendiente del cliente

**¿El piloto arranca con la secuencia encendida o apagada?** Se controla por parámetro y se activa
después sin tocar código. Recomendación del equipo: **arrancar apagada**, medir cómo responde la
gente al bot en los primeros días y encenderla después. También hay que aprobar los textos de los
tres mensajes y el horario de envío.

## Pruebas mínimas

El riesgo no es que el mensaje no salga, sino que salga cuando no debía:

- Cada condición de corte, probada por separado con el trabajo **ya encolado**: responde → cancela;
  se crea la cita **desde el portal** (no desde WhatsApp) → cancela; `noContactar` → cancela;
  conversación tomada → pausa; servicio desactivado → cancela.
- Una condición de corte **gana** sobre una de diferimiento: lo que debe cancelarse no se difiere.
- Disparo a las 23:00 se difiere al siguiente bloque hábil conservando el orden de los tres pasos.
- Envío diferido más allá de las 24 h no sale como texto libre; sin plantilla se descarta con motivo.
- Rearmar la secuencia dos veces no duplica envíos; un paciente no recibe dos secuencias a la vez;
  no se rearma antes de 30 días para el mismo servicio.
- Los tres mensajes son distintos entre sí y el cierre no contiene pregunta.
- Un fallo transitorio de la API de Meta no se convierte en varios mensajes al mismo paciente.
