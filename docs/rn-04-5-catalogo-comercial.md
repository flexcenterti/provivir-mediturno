# RN-04.5 · Ficha comercial y gobierno del catálogo de servicios

**Origen:** solicitud posterior a la Especificación v2.0. No está en la Lógica de Negocio v2.0;
se registra aquí para mantener la trazabilidad del resto de reglas.

**Estado:** especificada. Pendiente de implementación (fase 7).

**Extiende:** RN-04, que define servicios, procedimientos y cupos múltiples.

---

## Por qué

El catálogo es **dos cosas a la vez**: la configuración del motor de agendamiento (duración, cupos,
orden médica) y el guion de venta del bot. Un cambio mal hecho aquí rompe agendas o hace que el bot
ofrezca algo que ya no se presta.

De lo que sigue, parte ya existe: `Servicio.activo` da la baja lógica, y el controlador ya expone
`@Get`, `@Get(:id)`, `@Post` y `@Patch`. Falta la ficha comercial, el `@Delete` con su restricción y
los efectos en cadena de la desactivación.

---

## Regla

### RN-04.5.1 · Ficha comercial

Cada servicio incorpora los campos con los que el bot lo explica y lo vende: descripción, beneficios,
preparación, enlace de información, rango de precio y si es **agendable** por WhatsApp y portal.

Un servicio **sin ficha comercial no se ofrece** por esos canales. El bot no puede venderlo si no
sabe qué decir de él, y prefiere no ofrecerlo a improvisar.

Solo administración crea, modifica, desactiva o elimina servicios y edita su ficha. La asistente
consulta. Es la misma restricción que gobierna las agendas (RN-06.1) y por la misma razón.

### RN-04.5.2 · Los cambios no son retroactivos

1. Cambiar **duración o cupos** afecta solo a las citas que se creen desde ese momento. Las ya
   agendadas conservan su configuración: recalcularlas desplazaría agendas completas y dejaría
   pacientes sin aviso. La interfaz lo advierte al guardar y muestra cuántas citas quedan con la
   configuración anterior.
2. Activar `requiereOrden` en un servicio que no la exigía **no invalida** las citas ya creadas; se
   listan para que administración decida si avisa.
3. Cambiar la ficha comercial tiene efecto **inmediato** en las respuestas del bot: no toca agendas
   y por eso no necesita periodo de gracia.

### RN-04.5.3 · Baja: se desactiva, no se elimina

1. Un servicio **con citas asociadas no puede eliminarse**: se desactiva. Deja de ofrecerse en
   WhatsApp, portal y backoffice de inmediato, pero las citas agendadas se atienden y el historial
   del paciente conserva el nombre del servicio.
2. La **eliminación definitiva** solo se permite en servicios sin ninguna cita asociada —
   típicamente uno creado por error. La restricción se hace cumplir con clave foránea, no solo en
   el servicio.
3. Desactivar con citas futuras dispara el mismo tratamiento que un bloqueo de agenda (RN-06.3): se
   identifican las citas afectadas y quedan en manos de la asistente para reprogramar o cancelar
   con aviso.

### RN-04.5.4 · Efectos en cadena de la baja

Al desactivar un servicio, en la misma operación:

- se retira de la oferta del bot y del portal;
- se **cancelan las secuencias de seguimiento comercial activas** para ese servicio (RN-09.9.4):
  seguir persiguiendo pacientes para venderles algo descontinuado es el peor error posible del
  módulo;
- se **marcan sus artículos de conocimiento para revisión** (RN-13.5.6). Dejar viva la ficha de un
  servicio que ya no se presta es la forma más fácil de que el bot ofrezca algo inexistente.

### RN-04.5.5 · Auditoría

Alta, modificación, desactivación y eliminación quedan registradas con el valor anterior y el nuevo.
Los cambios de duración, cupos y `requiereOrden` se registran de forma explícita por su impacto
sobre el motor de agendamiento.

---

## Insumos del cliente

P2 (duraciones) y P3 (ventanas de control) ya son editables desde Catálogo. La ficha comercial se
alimenta de **P6**, y sin ella los servicios quedan visibles en el backoffice pero fuera de la
oferta automática.

## Pruebas mínimas

- Eliminar un servicio con citas **falla**; desactivarlo funciona.
- Cambiar la duración no altera las citas ya creadas: comparar duraciones antes y después.
- Crear sin ficha comercial deja el servicio fuera de la oferta del bot y del portal.
- Desactivar cancela los seguimientos de ese servicio y marca sus artículos para revisión.
- El prestador y la asistente no pueden mutar el catálogo (RBAC probado por test).
