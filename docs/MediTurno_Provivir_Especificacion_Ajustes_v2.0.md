# Especificación de ajustes — Versión 2.0
# Plataforma de agendamiento inteligente de citas médicas · Grupo Provivir

**Versión:** 2.0
**Base:** Documento final para desarrollo v1.0 (prototipo HTML) + reunión de validación con el cliente del 12 de agosto de 2026.
**Cliente:** Grupo Provivir (Sr. John Mendoza) · Sede única: CDC Oriente.
**Propósito:** consolidar todos los ajustes solicitados por el cliente sobre el prototipo v1.0, para (a) generar el nuevo index de presentación y (b) servir de especificación de desarrollo de la primera versión de producción.
**Regla de lectura:** todo lo no modificado por este documento conserva lo definido en la v1.0.

---

## 1. Decisiones estructurales de la v2.0

| # | Decisión | Detalle |
|---|---|---|
| D1 | Sede única | El cliente opera una sola sede (**CDC Oriente**). La capacidad multi-sede **se conserva en el código y el modelo de datos**, pero se **oculta de la interfaz** (sin selector de sede, sin columnas de sede). |
| D2 | Branding | El prototipo y la plataforma se personalizan como **Grupo Provivir**, conservando la paleta de colores, tipografías y componentes actuales. |
| D3 | Kiosko de llegada | Queda **visible en modo desactivado**. La operación real es: pago en recepción (mostrador) → sala de espera → llamado del prestador. El módulo permanece en el producto para activación futura (pago electrónico + autogestión). |
| D4 | Autoagendamiento web | Se **agrega un módulo nuevo**: portal público de autoagendamiento (enlace abierto + QR), sin IA, con flujo de selección simple. Se insertará en grupoprovivir.com. |
| D5 | Canal WhatsApp | El número del cliente se migra a la **API oficial de WhatsApp Business (Meta)** desde el inicio (se descarta la modalidad QR/WhatsApp Web). Se desarrolla el soporte de **todos los componentes multimedia entrantes**. |
| D6 | Terminología | La palabra **"urgencia" se reemplaza por "prioridad"** en toda la plataforma (UI, datos, documentación). "Urgencias" es un servicio habilitado que la clínica no presta. |

---

## 2. Matriz de cambios por módulo (v1.0 → v2.0)

Leyenda: **[A]** Agregar · **[M]** Modificar · **[D]** Desactivar/ocultar · **[R]** Renombrar

### 2.1 Estructura general y navegación
- **[D]** Selector de sede en topbar y toda referencia visual multi-sede (columnas "Sede", filtros por sede). El estado interno conserva `sede = 'oriente'`.
- **[M]** Login y marca: "Grupo Provivir · CDC Oriente". Acceso rápido agrega el rol/vista **"Autoagendamiento web (portal público)"**.
- **[A]** Indicador de fecha visible en el dashboard (el cliente lo pidió expresamente: "hoy, fecha tal").

### 2.2 Carga masiva de pacientes
- **[M]** Dimensionamiento: carga inicial ~200.000 registros; la base debe soportar **hasta ~400.000** sin degradación.
- **[M]** Campos reales de la carga: **nombres, apellidos, número de identificación, número de contacto**. El correo electrónico es opcional (el cliente casi no lo maneja).
- **[M]** La plantilla de carga se construirá **a partir del archivo que el cliente exporta de su plataforma actual** (él la envía); no se le exige reacomodar columnas ni títulos.
- **[A]** Criterio de filtrado sugerido y aceptado: cargar los pacientes **con al menos un servicio tomado en el último año**; los demás se crean al llegar.
- **[A]** La carga debe incluir los **servicios tomados** por paciente para alimentar el historial (ver 2.3). Si el registro no trae servicios, el historial queda vacío.
- **[M]** Comportamiento de re-carga: la plataforma **rechaza duplicados** de lo ya cargado y actualiza lo que corresponda.

### 2.3 Gestión de pacientes
- **[A]** **Historial de servicios tomados**: en la tabla de pacientes, opción con ventana emergente que muestra los **últimos 10 servicios** del paciente (tipo: cita médica, laboratorio, ecografía, etc., con fecha), **sin importar la fecha**. No es historia clínica: es un historial operativo de servicios, sin datos clínicos.
- **[M]** Se mantiene la restricción v1.0: **no se alojan datos clínicos** en la plataforma (evita el régimen de cumplimiento de datos sensibles de salud en esta etapa).
- Búsqueda por documento y nombre se conserva (v1.0).

### 2.4 Prestadores, servicios y tipos de cita
- **[A]** **Dos tipos de cita en medicina general**: **Consulta general** y **Cita de control**.
  - Duración **configurable por prestador y por tipo** (referencia actual del cliente: general 15 min; el cliente confirmará valores; se deja parametrizable).
  - La cita de control **no tiene costo** (parametrizable a futuro: sin costo / mismo costo / % del costo).
  - **Ventana de control configurable por prestador**: días máximos entre la consulta inicial y el control (referencia: 7–10 días; hay prestadores con ventanas de un mes).
- **[A]** Servicios de **procedimiento** como servicios independientes con su propia duración (ej.: "Procedimiento dermatológico" de 2 horas, "Suero de vitamina C"). Al crear la cita con ese servicio, queda con el tiempo correcto y el prestador lo ve identificado.
- **[A]** Servicios que **ocupan más de un cupo**: ej. **ecografía Doppler** requiere el espacio de dos citas. El modelo debe soportar duración = N × slot.
- **[M]** Configuración por prestador ampliada: por cada prestador se configuran las duraciones de cada tipo de cita/servicio que atiende (ej.: "Medicina general — consulta 15 min" y "Medicina general — control 10 min").

### 2.5 Agendas
- **[R]+[M]** Para el rol prestador, "Gestión de agenda" pasa a llamarse **"Información de agenda"** y es **solo informativa (solo lectura)**. Los prestadores **no** pueden crear, bloquear ni modificar su disponibilidad.
- **[M]** Los únicos roles que modifican agendas son **administración** (y asistente si el cliente lo autoriza como parte administrativa). Esto revierte lo definido en v1.0 §12.
- **[A]** Dos modos de definición de disponibilidad, ambos requeridos:
  1. **Agenda semanal recurrente** (patrón por día de semana con franjas y fracción de atención).
  2. **Agenda por calendario** (fechas puntuales; es como operan la mayoría de los especialistas, que atienden por fechas: "la dermatóloga un día, el nutricionista otro").
- **[A]** **Programación masiva mensual**: cuadro tipo calendario del mes donde administración selecciona varios días y les asigna franja horaria en un solo paso ("todos estos días a tal hora"), quedando programado de una vez.
- Se conserva (v1.0): al bloquear disponibilidad con citas asignadas, el sistema identifica las citas afectadas y notifica con opciones de reprogramación. El conflicto lo resuelve la parte administrativa (secretaria/asistente).

### 2.6 Motor de asignación de citas
- **[M]** **El balanceo de carga aplica únicamente a medicina general** (5–6 médicos del cliente): las citas sin preferencia de prestador se reparten equitativamente. Si el paciente pide un médico específico, se respeta.
- **[M]** Las **especialidades no balancean**: se manejan por las fechas en que el especialista atiende; el paciente escoge prestador o toma el disponible en la fecha solicitada.
- **[A]** **Asignación por bloques**: la recomendación de horario compacta la agenda del prestador — la cita sugerida es contigua (o casi) a la última asignada, evitando espacios muertos (ej.: no dejar un hueco de 8:00 a 12:00; sugerir 8:30 después de la de 8:00). El umbral de hueco máximo tolerado es configurable.
- **[A]** **Intercalado general/control**: entre citas generales se pueden insertar citas de control. Regla dura: **no se permiten dos citas de control consecutivas** (sí dos generales consecutivas). Ver RN-01 del documento de lógica de negocio.

### 2.7 Operación · Dashboard
- **[A]** **Buscador de citas** por código, nombre del paciente o documento (la clínica maneja **más de 400 citas/día**; la búsqueda visual es inviable).
- **[A]** Fecha del día visible + **selector de rango de fechas** en la parte superior (por defecto: hoy). Uso: reportes rápidos ("¿cómo vamos hoy?") que se comparten por foto/pantallazo.
- **[M]** **Ocupación por prestador**: porcentaje calculado sobre la **jornada de atención reportada** (horas disponibles del día). En los conteos comparativos entre médicos generales, **las citas de control no se cuentan** (hacen ruido en la comparación); el % de ocupación sí refleja el tiempo real ocupado.
- **[A]** Panel de **balanceo de medicina general**: citas del día por cada médico general, para que quien asigna manualmente vea a quién le corresponde la siguiente.

### 2.8 Operación · Agenda consolidada
- **[M]** Vistas por **día / semana / mes** (v1.0 solo mostraba el día). Debe permitir crear citas **futuras**, no solo inmediatas.
- **[A]** **Buscador** (código / nombre / documento) también en esta vista.
- **[A]** En el modal **"Crear cita"**: botón **"Crear paciente"** embebido, para no salir del flujo (crear y seleccionar en el mismo lugar). El formulario de cita incluye **tipo de cita** (general / control / procedimiento) y valida las reglas de intercalado.
- **[M]** **Selector de prestador** en lugar de mostrar todas las columnas apiladas cuando no caben (el cliente tiene ~6 médicos generales; en pantallas grandes pueden verse varios, con opción de reducir/seleccionar).

### 2.9 Operación · Bandeja de la asistente
- **[A]** **Burbuja roja con conteo** de conversaciones pendientes por resolver, visible en el menú lateral junto a "Bandeja asistente". **Sin sonido** (decisión explícita del cliente: el sonido cansa).
- **[A]** Columna **"Tiempo esperando"**: cuánto lleva la persona esperando ser atendida por un humano desde el escalamiento, para que no "se vuelva paisaje".
- **[R]** Columna "Urgencia" → **"Prioridad"** (D6). Los criterios de asignación de la prioridad (alta/media/baja) **quedan pendientes de definición por el cliente**; mientras tanto se muestran prioridad + tiempo de espera.

### 2.10 Operación · Mostrador
- **[M]** Es el **canal principal de llegada** (el paciente paga primero en recepción). Se conserva búsqueda por código/documento/nombre/teléfono, registro de llegada e impresión/reimpresión de ticket.
- **[A]** El ticket/confirmación puede reutilizarse como comprobante (el cliente hoy manda pantallazo por WhatsApp); en la v2.0 la confirmación de cita por WhatsApp es un **texto formateado tipo ticket** (ver 2.13). Idea del cliente en evaluación: impresora de stickers para el recibo (no compromete alcance).

### 2.11 Escalamiento de órdenes médicas (especialistas)
- **[M]** Cuando en la creación de una cita especializada el paciente entrega **foto de una orden médica (frecuentemente manuscrita)**, la conversación se **escala de manera inmediata y automática** al mostrador/asistente. **No se intenta OCR/lectura por IA** para estas órdenes en esta etapa: la imagen queda como soporte adjunto para el humano.
- **[M]** La lectura de órdenes por IA (v1.0 §15) queda acotada a órdenes legibles/impresas de laboratorio, y aun así con escalamiento por baja confianza. Regla operativa: "la IA no se fija como fuente de verdad; la orden es un apoyo".

### 2.12 Kiosko y pantallas de sala
- **[D]** **Kiosko de llegada: desactivado** (D3). En el prototipo se muestra con marca visible "Módulo desactivado en esta etapa" y con la pantalla de opciones estilo banco propuesta para el futuro (Tengo cita / Solicitar cita nueva / Soy paciente nuevo → QR / Ayuda en mostrador). La dinámica definitiva la decidirá el cliente.
- **[M]** El **llamado del paciente en sala de consulta se conserva** (turnos de atención): esa parte sí funciona hoy para el cliente.
- **[A]** **Frame multimedia en pantallas de sala**: cada pantalla incorpora un frame que reproduce un **canal en vivo de YouTube** (noticias) y **rota con los videos promocionales de la clínica** (subidos a YouTube). Cada ~10 minutos (configurable) se interrumpe el canal y se presenta el video institucional completo; requiere monitorear la duración/fin del video. *Nota de riesgo registrada: funcionalidad nueva, sin garantía plena hasta prueba técnica.*
- **[M]** Configuración de pantallas: **por sala/servicio** (no por pisos). Cada televisor define qué servicios muestra, cantidad de turnos, sonido, mensaje institucional, y ahora también: URL del canal de noticias, lista de videos promocionales e intervalo del video institucional.
- **[M]** Requisito de hardware: el televisor debe poder proyectar un navegador (Smart TV con navegador, o stick HDMI tipo Fire TV / Chromecast con conexión Wi-Fi).

### 2.13 WhatsApp e IA conversacional
- **[M]** Canal: **API oficial de Meta** desde el inicio (D5). Elimina el riesgo de bloqueo del número por alto volumen y permite múltiples agentes conectados con permisos (ver/contestar).
- **[A]** **Soporte multimedia entrante completo**: la plataforma captura e interpreta **audios (notas de voz), fotos, videos y documentos** que envíe el paciente, y se los presenta a la asistente cuando corresponda. **Las respuestas de la plataforma son siempre en texto.**
- **[M]** **Confirmación de cita como texto formateado** (reemplaza la imagen que el cliente genera hoy): fecha, hora, prestador, servicio, código de atención, indicaciones.
- **[A]** **Confirmación del número telefónico**: WhatsApp oculta el número del remitente (tendencia creciente); el flujo debe **pedir/confirmar el número de contacto** como dato demográfico.
- **[A]** Migración de contactos: los **50.000+ contactos** grabados en el celular del cliente se exportan (CSV) y se cargan a la plataforma.
- **[M]** Propósito del bot: **agendar y vender**. Ante preguntas informativas ("¿tienen sueros de vitamina C?") responde con información persuasiva y completa (beneficio, duración, disponibilidad) y ofrece agendar — no respuestas secas. Requiere que el cliente entregue la **documentación de sus servicios**.
- **[M]** Envío de enlaces permitido (ej. instrucciones de preparación de exámenes → página web del cliente).
- **[M]** Expectativa de resolución automática comunicada al cliente: arranque ~30–40% y mejora progresiva hacia 70–90%.

### 2.14 Autoagendamiento web (módulo nuevo)
- **[A]** **Portal público de autoagendamiento** accesible por enlace abierto y QR (para la página web y para código impreso en la sede — caso de uso: paciente en la cola autogestiona su cita desde el celular y se retira).
- Flujo **sin IA**, de selección simple:
  1. Pantalla inicial con dos botones grandes: **"Paciente nuevo"** y **"Paciente registrado"**.
  2. Nuevo: datos demográficos (nombres, apellidos, documento, teléfono/WhatsApp) → servicio → fecha/horario → confirmación con código.
  3. Registrado: documento → validación → servicio → fecha/horario → confirmación con código.
- La confirmación llega también por WhatsApp (texto formateado) cuando hay número.
- El mismo enlace se **inserta en grupoprovivir.com** para no mantener dos flujos.

### 2.15 Vista del prestador
- **[A]** Columna/etiqueta de **servicio y tipo de cita** en la lista de pacientes del día (consulta, control, procedimiento, examen especial), para que el prestador sepa qué viene a cumplir cada paciente y prepare lo necesario.
- **[A]** **Priorización con nota obligatoria**: al tocar el nombre del paciente se abre una ventana para **cambiar la prioridad**, exigiendo una **nota del motivo**. El llamado sigue siendo automático (siguiente en cola según prioridad + orden de llegada); la priorización manual es la forma en que el médico adelanta a alguien.
- **[R]** Menú "Mi agenda" → **"Información de agenda"** (solo lectura, ver 2.5).

### 2.16 Métricas
- **[M]** La métrica "Kiosko vs mostrador" queda marcada como **módulo apagado** (se conserva para el futuro).
- **[M]** El tablero definitivo de métricas **queda pendiente del cliente**: él definirá qué quiere ver en un solo pantallazo (se le compartió captura de la propuesta actual como base). No es bloqueante para la primera entrega.

### 2.17 Reglas de prioridad
- **[R]** Todo el módulo usa "prioridad" (D6).
- **[M]** Los criterios de clasificación (alta/media/baja) para conversaciones/citas quedan **pendientes de definición del cliente** (ejemplos mencionados: dolor, niño pequeño, condición del paciente). Mientras se definen, la columna operativa principal es el **tiempo de espera**.
- Se conservan las marcas preferenciales de llegada (adulto mayor, movilidad reducida, etc.) para la cola de atención.

---

## 3. Impacto en el prototipo (index v2.0)

| Vista | Acción |
|---|---|
| Login | [M] Branding Grupo Provivir; acceso rápido agrega "Autoagendamiento web" |
| Dashboard | [M] fecha + selector de rango, buscador, ocupación %, panel balanceo MG, sin sede |
| Agenda consolidada | [M] tabs día/semana/mes, buscador, selector de prestador, crear cita con tipo + crear paciente embebido |
| WhatsApp IA | [M] nuevos escenarios: control intercalado, balanceo MG, orden manuscrita → escalamiento inmediato, multimedia (nota de voz), confirmación de texto formateado |
| Bandeja asistente | [M] burbuja roja en menú, columna tiempo esperando, "Prioridad" |
| Mostrador | [M] textos (canal principal de llegada), sin sede |
| Vista prestador | [M] columna servicio/tipo, modal de priorización con nota; agenda solo lectura |
| Pacientes | [A] historial de servicios (últimos 10) en ventana emergente |
| Prestadores | [M] duraciones por tipo de cita; médicos generales del cliente (balanceo) |
| Servicios | [M] tipos de cita + procedimientos + servicios de doble cupo |
| Gestión de agendas | [M] modos semanal/calendario + programación mensual masiva; solo administración |
| Carga masiva | [M] campos reales, filtro último año, servicios históricos |
| Métricas | [M] kiosko marcado apagado; nota de pendiente del cliente |
| Pantallas (config) | [A] frame YouTube: canal, videos promocionales, intervalo |
| Pantalla de sala | [A] frame multimedia simulado |
| Kiosko | [D] visible con marca "desactivado" + pantalla de opciones futura |
| Autoagendamiento web | [A] vista nueva de pantalla completa (portal público) |
| Reglas de prioridad | [R]/[M] terminología y nota de criterios pendientes |
| Auditoría | Sin cambios funcionales |

---

## 4. Criterios de aceptación del index v2.0

El index v2.0 se considera completo para presentación si permite demostrar:

1. Branding Grupo Provivir · CDC Oriente sin rastro visual de multi-sede.
2. Dashboard con fecha, selector de rango, buscador y panel de balanceo de medicina general.
3. Agenda consolidada con vistas día/semana/mes y creación de cita futura con tipo de cita y creación de paciente embebida.
4. Simulación WhatsApp: cita general, cita de control intercalada, asignación balanceada de medicina general, orden manuscrita escalada de inmediato, y confirmación como texto formateado.
5. Bandeja con burbuja de pendientes en el menú y tiempo de espera por conversación.
6. Historial de servicios tomados (últimos 10) desde la ficha del paciente.
7. Vista del prestador con tipo de servicio visible y priorización con nota obligatoria.
8. Información de agenda del prestador en modo solo lectura.
9. Programación mensual masiva de disponibilidad (administración).
10. Kiosko visible en modo desactivado con la pantalla de opciones propuesta.
11. Portal de autoagendamiento web navegable (nuevo/registrado) con confirmación y código.
12. Pantalla de sala con frame multimedia (noticias/video institucional) simulado.
13. Terminología "prioridad" consistente en toda la interfaz.

---

## 5. Pendientes del cliente (insumos para producción)

| # | Insumo | Responsable | Bloquea |
|---|---|---|---|
| P1 | Plantilla/exportación de la base de pacientes (nombres, apellidos, documento, teléfono) con servicios históricos | John Mendoza | Carga masiva |
| P2 | Duraciones definitivas por prestador y tipo de cita (general / control / procedimientos) | John Mendoza | Configuración de agendas |
| P3 | Ventana de días de la cita de control por prestador (7/10/30 días) | John Mendoza | Regla RN-01 |
| P4 | Criterios de prioridad (alta/media/baja) o decisión de operar solo con tiempo de espera | John Mendoza | Bandeja/prioridad |
| P5 | Definición de métricas del "pantallazo único" | John Mendoza | Tablero de métricas (no bloquea 1ª entrega) |
| P6 | Documentación de servicios con enfoque comercial (para que el bot venda) | John Mendoza | Calidad de respuestas IA |
| P7 | Esquema de atención, horarios y agendas actuales (jerga interna) | John Mendoza | Parametrización + capacitación |
| P8 | Decisión de dinámica definitiva del kiosko (menú de opciones) | John Mendoza | Activación futura del kiosko |
| P9 | Exportación CSV de contactos del celular (50.000+) | John Mendoza | Migración a API |
| P10 | Enlaces de YouTube: canal de noticias y videos promocionales | John Mendoza | Frame de pantallas |

---

## 6. Plan de entrega (acordado en la reunión)

1. Aprobación de esta versión por el cliente.
2. **10–15 días**: plataforma lista para pruebas.
3. Pruebas y corrección → piloto inicial → corrección → lanzamiento.
4. Requisitos del cliente en paralelo: verificación de elementos tecnológicos en sede (computadores, TVs con navegador o stick HDMI, Wi-Fi en salas, impresora de tickets).
