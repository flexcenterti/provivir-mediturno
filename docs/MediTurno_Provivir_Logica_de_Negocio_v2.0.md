# Lógica de negocio — Versión 2.0
# Plataforma de agendamiento inteligente · Grupo Provivir (CDC Oriente)

**Propósito:** formalizar las reglas de negocio derivadas de la reunión de validación del 12 de agosto de 2026, como referencia normativa para el desarrollo. Cada regla tiene identificador estable (RN-XX) para trazabilidad en código, pruebas y auditoría.

---

## RN-01 · Tipos de cita en medicina general

1. Medicina general maneja **dos tipos de cita**: **Consulta general** y **Cita de control**.
2. La **cita de control** es una revisión corta posterior a una consulta (revisión de exámenes, continuidad de tratamiento, fórmula adicional). **No tiene costo** para el paciente. La política de costo es parametrizable a futuro (sin costo / costo pleno / porcentaje).
3. La cita de control solo puede agendarse dentro de una **ventana de días posterior a la consulta origen**, configurable **por prestador** (valores de referencia del cliente: 7–10 días; algunos prestadores manejan hasta un mes).
4. **Duraciones configurables por prestador y tipo** (referencia: consulta 15 min; control ~10 min o insertado entre consultas). Si todos los prestadores son iguales, se configura igual para todos.
5. **Regla de intercalado (dura):**
   - Las citas de control se insertan **entre** citas de consulta general (patrón objetivo: general, control, general, control…).
   - **Prohibido agendar dos citas de control consecutivas.** Motivo de negocio: los controles no facturan; una secuencia de controles deja al médico sin citas que generen ingreso.
   - **Sí se permiten dos (o más) consultas generales consecutivas.**
6. El motor de agendamiento valida la regla al asignar (IA, asistente y autoagendamiento). Si el cupo solicitado viola el intercalado, se ofrece el siguiente cupo válido.

## RN-02 · Balanceo de carga (solo medicina general)

1. El balanceo aplica **exclusivamente** al grupo de prestadores cuya especialidad es **medicina general** (5–6 médicos en la operación del cliente).
2. Cuando el paciente **no expresa preferencia** de médico, la plataforma asigna la cita al prestador elegible con **menor carga relativa**, buscando distribución equitativa.
3. Cuando el paciente **pide un médico específico**, se respeta la preferencia sin balancear.
4. Métrica de carga para comparar médicos generales: **cantidad de consultas generales del día** (las **citas de control NO se cuentan** en la comparación — distorsionan la equidad — aunque sí ocupan agenda).
5. La ocupación mostrada en dashboard se calcula como **% del tiempo de la jornada de atención reportada** que está ocupado (todas las citas ocupan tiempo, incluidos controles), mientras que el **conteo comparativo** entre médicos excluye controles. Son dos indicadores distintos y coexisten.
6. Para asignación manual, la asistente dispone de una vista con la carga del día de los médicos generales, de modo que pueda decidir a quién asignar.

## RN-03 · Asignación por bloques (optimización de agenda)

1. Al sugerir horarios, el motor **compacta la agenda** de cada prestador: la recomendación principal es el cupo **contiguo (o más cercano) a la última cita asignada** del prestador en ese día.
2. Objetivo: evitar espacios muertos (ej. cita a las 8:00 y la siguiente a las 12:00). Se define un **umbral de hueco máximo tolerado** configurable (valor inicial de trabajo: minimizar a 0; ajustable).
3. Esta optimización aplica a todos los prestadores, en conjunto con RN-01 (intercalado) y RN-02 (balanceo) cuando correspondan.
4. El paciente siempre puede pedir un horario específico; la optimización gobierna la **recomendación**, no impone.

## RN-04 · Especialidades

1. Los especialistas atienden **por fechas** (agenda por calendario): cada uno tiene días específicos (la ginecóloga atiende a diario; dermatóloga, nutricionista y otros, días puntuales).
2. El paciente escoge prestador específico o toma el que esté disponible en la fecha solicitada. **No hay balanceo** entre especialistas.
3. **Procedimientos**: son servicios propios con duración propia (ej. procedimiento dermatológico de 2 horas, sueros de vitamina C de 15 min). La cita se crea con el servicio de procedimiento para que reserve el tiempo correcto y el prestador lo identifique.
4. **Servicios de cupo múltiple**: algunos exámenes ocupan más de un cupo (ej. **ecografía Doppler = 2 cupos**). El modelo de agenda soporta duración = N × slot del prestador.

## RN-05 · Prioridad (terminología y aplicación)

1. El término oficial de la plataforma es **"prioridad"**. Está prohibido "urgencia" en UI y comunicaciones: urgencias es un servicio habilitado que la clínica **no presta** y usarlo genera expectativas legales/operativas incorrectas.
2. Ámbitos de prioridad:
   - **Cola de atención en sede**: pacientes con marcas preferenciales (adulto mayor, discapacidad, movilidad reducida, embarazo, marcación manual) se ubican primero, luego orden de llegada.
   - **Conversaciones escaladas**: cada conversación escalada muestra su prioridad y el **tiempo que lleva esperando** atención humana.
   - **Priorización por el prestador** (RN-07.4).
3. Los **criterios de clasificación** (alta/media/baja) están **pendientes de definición por el cliente** (ejemplos discutidos: dolor, menor de edad, condición particular). Mientras se definen, la columna operativa dominante es el **tiempo de espera**.

## RN-06 · Gobierno de agendas

1. **Solo administración** (y los roles que el cliente delegue en la parte administrativa) puede crear, modificar, bloquear o eliminar disponibilidad de los prestadores.
2. El prestador ve su agenda en modo **solo lectura** ("Información de agenda"). No puede bloquearse ni cambiar disponibilidad — decisión explícita del cliente para evitar conflictos de reasignación sin control.
3. Cuando administración bloquea disponibilidad con citas ya asignadas, la plataforma: identifica las citas afectadas → notifica a los pacientes por WhatsApp con opciones de reprogramación → deja el conflicto en manos de la asistente.
4. Modos de definición de disponibilidad: **semanal recurrente** y **por calendario** (fechas puntuales), más **programación masiva mensual** (selección de varios días del mes con una franja en un solo paso).

## RN-07 · Operación de atención en sede

1. **Flujo real del cliente (pay-per-view):** el paciente llega → **paga en recepción (mostrador)** → registro de llegada → sala de espera → **llamado del prestador** → atención. No hay turno intermedio de pago.
2. El **kiosko de llegada está desactivado** en esta etapa (queda en el producto para el futuro: pago electrónico + autogestión). El **llamado en sala de consulta se conserva** y funciona.
3. El llamado es **automático al siguiente en cola** (prioridad primero, luego orden de llegada). El prestador no elige arbitrariamente a quién llamar.
4. **Priorización por el prestador:** si el médico quiere atender antes a un paciente, toca su nombre en la lista, cambia la prioridad y **debe dejar una nota del motivo**. El sistema reordena la cola; queda auditado.
5. La vista del prestador muestra **el servicio/tipo de cita** de cada paciente (consulta, control, procedimiento, examen especial) para que sepa qué debe preparar.
6. Atención únicamente **con cita** (se conserva de v1.0).

## RN-08 · Escalamiento a asistente

1. Motivos de escalamiento (se conservan los de v1.0) con este cambio: **la foto de una orden médica de especialista (típicamente manuscrita) escala de inmediato y automáticamente**, sin intento de lectura por IA. La imagen queda adjunta como soporte para el humano. Racional: la caligrafía médica no es legible con confianza; la orden es apoyo, no fuente de verdad del sistema.
2. La lectura de órdenes por IA queda acotada a órdenes impresas/legibles de laboratorio, siempre con escalamiento por baja confianza.
3. La bandeja de la asistente muestra: **burbuja roja con el conteo de pendientes en el menú lateral (sin sonido)**, motivo, prioridad, **tiempo esperando** e historial. La asistente puede tomar la conversación y resolver por WhatsApp.
4. Expectativa de mejora comunicada al cliente: resolución automática inicial ~30–40%, con mejora progresiva hacia 70–90% a medida que se incorporan las dinámicas y "cosas culturales" de la clínica.

## RN-09 · Canal WhatsApp (API de Meta)

1. El número principal del cliente se **migra a la API oficial de WhatsApp Business (Meta)**. Se descarta la modalidad QR/WhatsApp Web. Racional: (a) el alto volumen en WhatsApp normal implica riesgo de bloqueo del número sin explicación; la API elimina ese riesgo; (b) permite que hablen N agentes con permisos (solo ver / ver y contestar); (c) todo queda controlado y auditado en la plataforma.
2. **Multimedia entrante completo:** la plataforma captura e interpreta notas de voz, fotos (fórmulas, zonas afectadas), videos y documentos del paciente, y los presenta a la asistente cuando el caso escala. **Las respuestas de la plataforma son siempre texto** (se permiten enlaces).
3. **Confirmación de cita = texto formateado** tipo ticket (fecha, hora, prestador, servicio, código de atención, indicaciones). Reemplaza la imagen/pantallazo que el cliente envía hoy.
4. **Confirmación del número:** WhatsApp oculta cada vez más el número del remitente; el flujo pide/confirma el número de contacto como dato demográfico obligatorio.
5. Los **contactos actuales del celular del cliente (50.000+)** se exportan a CSV y se cargan a la plataforma antes de la migración del número.
6. **El bot vende, no solo informa:** ante consultas de servicios responde con beneficio, duración, disponibilidad y ofrecimiento de agendar. Requiere la documentación comercial de servicios del cliente (pendiente P6).
7. Antes de migrar el número principal se hará un **ejercicio de prueba de la API con otro número** para validación del cliente.

## RN-10 · Autoagendamiento web (portal público)

1. Enlace abierto + **QR** (impreso en sede y embebido en grupoprovivir.com). Caso de uso principal: paciente en la cola autogestiona la cita desde su celular y se retira ("lo que vine a hacer lo hice ahí parado").
2. Flujo **sin IA**, selección simple: portada con **"Paciente nuevo"** / **"Paciente registrado"** → (nuevo: datos demográficos) → servicio → fecha/horario válido según RN-01..04 → confirmación con **código único de atención**.
3. Confirmación adicional por WhatsApp (texto formateado) cuando hay número.
4. Los pacientes creados por este canal entran a la base con marca de origen "autoagendamiento web".

## RN-11 · Pantallas de sala y contenido

1. Configuración **por sala/servicio** (no por pisos): cada televisor define los servicios que muestra, cantidad de turnos visibles, sonido y mensaje institucional.
2. **Frame multimedia:** cada pantalla incorpora un frame que reproduce un **canal en vivo de YouTube** (noticiero) y **rota** con los **videos promocionales de la clínica** subidos a YouTube. Aproximadamente **cada 10 minutos** (configurable) se interrumpe el canal para presentar el video institucional **completo**; requiere detectar el fin del video para retornar al canal.
3. **Nota de riesgo aceptada por ambas partes:** esta rotación no se ha construido antes; se intentará y se validará técnicamente ("no prometo nada" — registrado en reunión). Fuente única: YouTube, para no complicar la integración.
4. Requisito de hardware del cliente: TV con navegador o stick HDMI (Fire TV / Chromecast) + Wi-Fi en cada sala.

## RN-12 · Base de pacientes y carga masiva

1. Carga inicial ~**200.000** registros; dimensionamiento hasta **~400.000**.
2. Campos de la carga real: **nombres, apellidos, número de identificación, número de contacto** (correo opcional/escaso). La plantilla se construye a partir del export de la plataforma actual del cliente — no se le exige transformar su archivo.
3. **Filtro de carga acordado:** pacientes con **al menos un servicio en el último año**. Los demás se registran cuando lleguen.
4. La carga incluye los **servicios tomados** para poblar el **historial de servicios** (últimos 10 por paciente, sin importar fecha, visibles en ventana emergente). No es historia clínica; **no se almacenan datos clínicos** en la plataforma.
5. Recargas posteriores: la plataforma rechaza duplicados y actualiza lo que corresponda (identificador principal: documento).

---

## Estados y datos afectados (resumen para el modelo)

- `Cita.tipo`: `general | control | procedimiento | examen` (nuevo).
- `Cita.citaOrigenId`: referencia de la consulta origen para controles (nuevo, valida ventana RN-01.3).
- `Servicio.cupos`: número de slots que ocupa (default 1; Doppler = 2) (nuevo).
- `Prestador.duraciones[]`: por servicio **y tipo de cita** (modificado).
- `Prestador.grupoBalanceo`: booleano/etiqueta "medicina general" (nuevo).
- `Agenda.modo`: `semanal | calendario` + programación masiva mensual (nuevo).
- `Conversacion.prioridad` (renombrado desde urgencia) + `escaladaEn` (timestamp para tiempo de espera) (nuevo).
- `Turno.prioridad` + `notaPriorizacion` + `priorizadoPor` (nuevo, RN-07.4).
- `Paciente.historialServicios[]` (últimos 10, con tipo y fecha) + `origen` (`carga | mostrador | whatsapp | autoagendamiento`) (nuevo).
- `Pantalla.media`: `{canalYouTube, videosPromocionales[], intervaloInstitucionalMin}` (nuevo).
- `Sede`: persiste en el modelo (D1) con valor único `cdc-oriente`; sin exposición en UI.
