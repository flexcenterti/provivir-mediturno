# RN-13 · Base de conocimiento del bot

**Origen:** solicitud posterior a la Especificación v2.0. No está en la Lógica de Negocio v2.0;
se registra aquí para mantener la trazabilidad del resto de reglas.

**Estado:** especificada. Pendiente de implementación (fase 7).

**Reemplaza parcialmente:** el parámetro `configuracion.documentacion_comercial`, que hoy inyecta
la documentación de servicios completa en el prompt de todas las conversaciones.

---

## Por qué

El bot ya vende y ya tiene prohibido inventar: eso está en `ia.prompt.ts` desde la fase 4. Lo que
no tiene es **de dónde sacar la información a escala**.

Hoy P6 se carga como un solo bloque de texto en `configuracion.documentacion_comercial` y se
inyecta completo en cada conversación. Con dos páginas funciona. Con la documentación real de
todos los servicios se rompe por tres lados:

1. **Costo por conversación.** Cada mensaje paga los tokens del documento entero, use o no esa
   información.
2. **Sin gobierno.** No hay versiones, estados, vigencia ni auditoría. Editar un parámetro de
   configuración no deja rastro de qué respondió el bot con la versión anterior — que es
   exactamente lo que se necesita cuando un paciente reclama una respuesta incorrecta.
3. **Sin ciclo de mejora.** No se sabe qué preguntó la gente que el bot no supo responder, así que
   no hay mecanismo para llegar del 30-40 % inicial al 70-90 % comprometido en RN-08.4.

RN-13 convierte ese bloque en **artículos versionados con recuperación**.

## Lo que ya existe y no se toca

Para que la implementación no lo reconstruya:

| Ya implementado | Dónde |
|---|---|
| «Si no lo devolvió una herramienta, no existe» | `ia.prompt.ts` |
| Derivación ante señales de emergencia a un servicio externo | `ia.prompt.ts` · `DERIVAR_EMERGENCIA` |
| «Vender, no solo informar»: beneficio, duración, disponibilidad y ofrecimiento | `ia.prompt.ts` |
| Herramienta `listar_servicios` | `ia.herramientas.ts` |

---

## Regla

### RN-13.1 · Dos fuentes, separadas a propósito

| Fuente | Contenido | Por qué separada |
|---|---|---|
| **Ficha comercial del servicio** (`Servicio`, RN-04.5) | Duración, cupos, si requiere orden, política de costo, preparación, si es agendable | Son los datos que no se pueden equivocar. Se leen por herramienta desde la base |
| **Artículos** (`KbArticulo`) | Prosa institucional: beneficios, horarios, formas de pago, políticas, preguntas frecuentes | Es lo que el cliente entrega en P6, en el formato que ya tenga |

**Toda cifra que el bot comunique sale del catálogo, nunca de un fragmento de texto recuperado.**
Un artículo puede quedar desactualizado sin que nadie lo note; el catálogo es el que gobierna las
agendas, así que si se equivoca se nota el mismo día.

### RN-13.2 · Alcance de lo que responde

Servicios y beneficios · preparación de exámenes y procedimientos · horarios y ubicación · formas
de pago · qué traer · política de cancelación y reprogramación · cómo funciona la cita de control ·
preguntas frecuentes operativas.

### RN-13.3 · Umbral y falta de cobertura

La recuperación devuelve los mejores fragmentos con un puntaje. Si el mejor no supera
`kb_score_min` (tabla `configuracion`), la consulta se considera **sin cobertura**:

1. La conversación escala con motivo `sin_cobertura_kb`.
2. La pregunta ingresa a la cola de **preguntas sin respuesta** (`KbPendiente`), agrupada por
   similitud y con contador de ocurrencias.
3. El paciente recibe un mensaje de transición honesto, nunca una respuesta aproximada.

### RN-13.4 · Temas de escalamiento obligatorio, como dato

Estos temas escalan **siempre**, sin importar el puntaje:

- consejo, diagnóstico u orientación clínica;
- interpretación de exámenes, fórmulas u órdenes;
- medicamentos y dosis;
- quejas, reclamos y solicitudes de devolución;
- asuntos legales o de facturación en disputa;
- negociación de precios o descuentos.

La lista vive en `configuracion`, **no en el texto del prompt**: el cliente la aprueba y la ajusta
sin tocar código (P12). Es coherente con RN-12.4 (la plataforma no aloja datos clínicos) y con la
regla operativa ya acordada de que la IA no es fuente de verdad (Especificación §2.11).

### RN-13.5 · Ciclo de vida del artículo: se archiva, no se borra

1. **Archivar retira el artículo del índice en la misma transacción.** El bot deja de recuperarlo
   de inmediato; no hay ventana en la que siga respondiendo con información vieja.
2. **El artículo se conserva.** RN-13.7 exige poder rastrear qué artículo sustentó cada respuesta
   ya dada; borrarlo rompe esa cadena justo cuando se la necesita.
3. **Reactivar lo devuelve a `borrador`**, nunca directo a publicado: obliga a revisarlo antes de
   que vuelva a circular.
4. **Borrado físico solo de borradores**, que nunca sustentaron una respuesta.
5. Un artículo con `vigenteHasta` cumplido se archiva solo.
6. Al desactivar un servicio, sus artículos vinculados se marcan para revisión (RN-04.5.4).

### RN-13.6 · Ciclo de mejora

Las preguntas sin cobertura se agrupan y se ordenan por frecuencia. Administración las convierte en
artículos desde la misma pantalla. **Este bucle es el mecanismo concreto de RN-08.4**; sin él, esa
curva no ocurre sola.

### RN-13.7 · Gobierno y trazabilidad

1. Estados `borrador | publicado | archivado`, número de versión y fechas de vigencia. **Un
   borrador nunca se sirve al bot.**
2. Solo administración publica o archiva.
3. Cada respuesta registra **qué artículos la sustentaron y con qué puntaje**. Cuando el bot
   responde mal, se corrige el artículo culpable, no el prompt.
4. Publicación, edición y archivo quedan en auditoría.

### RN-13.8 · Sin datos de pacientes

La base es contenido institucional y su índice se comparte entre todas las conversaciones. Ningún
dato personal ni clínico se incorpora a ella. La pregunta del paciente se usa para consultar el
índice; no se persiste en él.

---

## Herramientas nuevas del orquestador

| Herramienta | Entrada | Salida |
|---|---|---|
| `buscar_conocimiento` | `pregunta`, `servicio_id?` | Mejores fragmentos de artículos **publicados y vigentes**, con puntaje |
| `consultar_servicio` | `nombre_o_id` | Ficha completa: duración, cupos, requiere orden, costo, preparación, beneficios |

`listar_servicios` ya existe y se conserva: devuelve el catálogo. `consultar_servicio` es el
detalle de uno solo, y es de donde salen las cifras.

## Recuperación

Sin extensiones nuevas de PostgreSQL. Ver **`docs/adr-a8-recuperacion-conocimiento.md`** para la
decisión y su motivo.

## Migración desde `documentacion_comercial`

El contenido actual del parámetro se trocea en artículos al desplegar. El parámetro se conserva
hasta que la base tenga contenido publicado, para no dejar al bot sin material a mitad de camino.

## Insumos del cliente

| # | Insumo | Bloquea |
|---|---|---|
| P6 | Documentación comercial por servicio. Un documento por servicio, o uno solo con un encabezado por servicio; el sistema lo trocea. Word, PDF o texto plano | Todo el valor de RN-13 |
| P12 | Lista aprobada por escrito de temas que siempre escalan (RN-13.4) | Salida a piloto |
| P13 | Información operativa: horarios, dirección, formas de pago, política de cancelación, qué traer | Primeras respuestas automáticas |

## Pruebas mínimas

- Golden set de 40-50 preguntas reales anotadas con `respuesta_esperada | debe_escalar`, en CI.
- Un test por cada tema de RN-13.4: puntaje alto pero tema prohibido → **escala igual**.
- Pregunta bajo umbral → escala con `sin_cobertura_kb` y genera `KbPendiente`; repetirla incrementa
  el contador en vez de duplicar la fila.
- Un artículo en borrador o archivado **nunca** aparece en resultados.
- Archivar retira los fragmentos del índice en la misma transacción: la búsqueda inmediatamente
  posterior no lo devuelve.
- Las cifras que cita el bot coinciden con el catálogo: mutar el servicio cambia la respuesta.
- Un artículo publicado no admite borrado físico; un borrador sí.
