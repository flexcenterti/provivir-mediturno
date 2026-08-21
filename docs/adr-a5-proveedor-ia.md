# ADR A5 (revisado) · Proveedor de IA conversacional y de transcripción

**Reemplaza:** la fila A5 de `MediTurno_Provivir_Arquitectura_v1.0.md` §10, que fijaba
"API de Anthropic (Claude)" como proveedor único.

**Fecha:** 21 de agosto de 2026 · **Decidido por:** el equipo técnico.

---

## Contexto

La arquitectura original eligió Anthropic con tool use (ADR A5) y dejó el STT abierto
("p. ej. Whisper API"). Al llegar el momento de contratar, el equipo optó por **OpenAI**
como proveedor principal para ambas cosas.

El argumento es operativo y es sólido: si de todos modos hace falta una cuenta de OpenAI
para la transcripción de notas de voz, tener un solo proveedor significa una clave, una
factura, un contrato y un solo lugar al que reclamar. En una operación del tamaño de esta
clínica eso pesa más que cualquier diferencia marginal de calidad entre modelos.

## Decisión

**El proveedor de IA se elige por configuración, no por código.** Se implementó un puerto
neutro con dos adaptadores intercambiables.

```
ia/
├── ia.tipos.ts          ← tipos neutros: HerramientaLlm, MensajeLlm, RespuestaLlm
├── ia.herramientas.ts   ← las 8 herramientas en JSON Schema, sin sabor de proveedor
├── ia.service.ts        ← orquestador: NO conoce ningún SDK
└── adaptadores/
    ├── openai.adaptador.ts      ← activo por defecto
    └── anthropic.adaptador.ts   ← alterno
```

`IA_PROVEEDOR=openai|anthropic` decide cuál se usa. Si el elegido no tiene su clave
configurada pero el otro sí, **se usa el otro** en vez de escalar el 100 % de las
conversaciones a la asistente por una variable mal puesta.

**Transcripción:** el puerto de STT ya hablaba el contrato de OpenAI
(`POST /audio/transcriptions`, multipart). Solo requiere configuración, ningún cambio de código.

## Por qué dos adaptadores y no un reemplazo

1. **Costaba casi lo mismo.** El puerto ya existía —se creó para poder probar el
   orquestador con un doble— así que el trabajo real fue el adaptador de OpenAI, no la
   arquitectura.
2. **Permite medir en vez de suponer.** El set de 30 mensajes anotados que exige la guía
   antes del piloto sirve para comparar ambos con conversaciones reales de la clínica, en
   español colombiano y con la jerga local. Elegir por catálogo antes de esa medición
   sería apostar.
3. **Riesgo de proveedor.** Con un solo adaptador, una caída del proveedor escala todas
   las conversaciones a la asistente. Con dos, cae al alterno y sigue atendiendo.

## Lo que NO cambió

- Las 8 herramientas, la política de escalamiento (RN-08), el tope de 8 turnos y todo el
  prompt del sistema son idénticos.
- **Las reglas RN-01 a RN-04 siguen fuera del prompt**, en el motor (ADR A3). Cambiar de
  modelo no puede alterar el comportamiento del agendamiento: eso es precisamente lo que
  protege esa decisión.
- Las 27 pruebas del canal de WhatsApp: el doble del modelo ahora habla tipos neutros y
  sirve igual para cualquier proveedor.

## Diferencias que absorben los adaptadores

| | Anthropic | OpenAI |
|---|---|---|
| Herramientas | `{name, description, input_schema}` | `{type:'function', function:{...parameters}}` |
| Llamada | Bloque `tool_use` en `content` | `message.tool_calls` |
| Argumentos | Objeto | **JSON en string** |
| Resultado | Bloque `tool_result` en mensaje `user` | Mensaje con rol `tool` |
| Error de herramienta | Campo `is_error` | **No existe**: se antepone `ERROR:` al contenido |
| Fin de turno | `stop_reason` | `finish_reason` |
| Prompt de sistema | Campo aparte | Primer mensaje del arreglo |
| Rechazo de seguridad | `stop_reason: 'refusal'` | `message.refusal` |

Dos sutilezas que costaron pruebas dedicadas: Anthropic exige que los resultados de
herramientas **consecutivas** vayan en un solo mensaje (partirlos entrena al modelo a
dejar de pedir llamadas en paralelo), y OpenAI puede devolver **JSON malformado** en los
argumentos, que no debe tumbar la conversación.

## Modelos

Verificado en el catálogo de OpenAI a la fecha:

| Modelo | Entrada / salida por 1M tokens | Uso sugerido |
|---|---|---|
| `gpt-5.6-luna` | $0.20 / $1.20 | Opción económica — probar con el set anotado |
| `gpt-5.6-terra` | $2.00 / $12.00 | **Configurado por defecto** |
| `gpt-5.6-sol` | $5.00 / $30.00 | Solo si la evaluación lo justifica |

Se dejó `terra` por defecto porque equivocarse en una fecha u hora de cita tiene costo
operativo real. **`luna` es 10× más barato y debe probarse con el set anotado**: si
sostiene la calidad, el ahorro es sustancial en el volumen de WhatsApp de la clínica.

## Pendiente antes de conectar las claves

Se enviarán **notas de voz de pacientes y conversaciones completas** a un tercero, en una
plataforma con hasta 400.000 registros bajo Ley 1581 de 2012. Antes de producción:

- ⬜ Acuerdo de tratamiento de datos (DPA) con el proveedor y verificación de su política
  de retención de la API.
- ⬜ Actualizar el aviso de privacidad del portal: hoy declara la finalidad pero no
  menciona proveedores externos de procesamiento.
- ✅ La orden médica manuscrita **nunca** llega al modelo. Lo garantiza RN-08 por diseño y
  hay una prueba que verifica que el modelo ni siquiera se invoca.
