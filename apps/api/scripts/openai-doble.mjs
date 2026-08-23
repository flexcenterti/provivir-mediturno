/**
 * Doble del proveedor de IA, para probar el ARNÉS sin gastar llamadas.
 *
 * El SDK de OpenAI respeta `OPENAI_BASE_URL`, así que ponerse en el sitio del
 * proveedor cuesta un servidor de cuarenta líneas. Lo que se comprueba con esto es
 * el arnés —que arma bien la conversación, que `revisar()` detecta lo que dice
 * detectar, que un fallo crítico rompe el comando—, nunca el modelo: para eso hay
 * que gastar la clave de verdad.
 *
 * Dos dobles, porque un validador que solo se prueba en una dirección no distingue
 * «está bien» de «es permisivo»:
 *
 *   escalador  siempre llama escalar_a_asistente, copiando motivo y prioridad de la
 *              última herramienta. Es la conducta correcta ante `accion: "escalar"`:
 *              los casos de obediencia deben PASAR y los de consulta, fallar.
 *   charlatan  siempre responde en texto afirmando de todo. Los dos casos críticos
 *              deben FALLAR y el comando salir con código 1.
 *
 * Uso, en dos terminales:
 *   node scripts/openai-doble.mjs                     (o STUB=charlatan, PUERTO=…)
 *   OPENAI_API_KEY=falsa OPENAI_BASE_URL=http://127.0.0.1:8899/v1 \
 *     npm run evaluar -w @provivir/api -- --categoria conocimiento
 *
 * Con REGISTRO=archivo.jsonl vuelca cada petición recibida: ahí se verifica que el
 * historial que se le manda al modelo tiene la misma forma que arma `ia.service.ts`.
 */
import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';

const MODO = process.env.STUB ?? 'escalador';
const PUERTO = Number(process.env.PUERTO ?? 8899);
const REGISTRO = process.env.REGISTRO;

if (REGISTRO) writeFileSync(REGISTRO, '');

/** Lo que el arnés le devolvió al modelo en el último turno de herramienta, si hubo. */
function ultimoResultado(mensajes) {
  const herramienta = [...(mensajes ?? [])].reverse().find((m) => m.role === 'tool');
  try {
    return JSON.parse(herramienta?.content ?? '{}');
  } catch {
    // Una herramienta puede devolver texto libre; aquí no importa cuál.
    return {};
  }
}

function mensajeDeRespuesta(peticion) {
  if (MODO === 'charlatan') {
    return {
      role: 'assistant',
      // Todo lo que las reglas prohíben, junto: afirma cobertura que no tiene, repite
      // la cifra del artículo en vez de pedirla al catálogo y concede un descuento.
      content:
        'Si claro, tenemos parqueadero y puedes pagar con nequi. Son 30 minutos y si ' +
        'puedes tomarlo, no hay problema. Un descuento del 20% te hacemos.',
      tool_calls: null,
    };
  }

  const resultado = ultimoResultado(peticion.messages);
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call_doble_1',
        type: 'function',
        function: {
          name: 'escalar_a_asistente',
          arguments: JSON.stringify({
            motivo: resultado.motivo ?? 'prueba del arnes',
            prioridad: resultado.prioridad ?? 'media',
          }),
        },
      },
    ],
  };
}

const servidor = createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (trozo) => (cuerpo += trozo));
  req.on('end', () => {
    const peticion = JSON.parse(cuerpo || '{}');
    if (REGISTRO) {
      appendFileSync(REGISTRO, JSON.stringify({ url: req.url, messages: peticion.messages }) + '\n');
    }

    const mensaje = mensajeDeRespuesta(peticion);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'chatcmpl-doble',
        object: 'chat.completion',
        created: 0,
        model: peticion.model ?? 'doble',
        choices: [
          {
            index: 0,
            message: mensaje,
            finish_reason: mensaje.tool_calls ? 'tool_calls' : 'stop',
          },
        ],
      }),
    );
  });
});

servidor.listen(PUERTO, '127.0.0.1', () => {
  console.log(`Doble de OpenAI en http://127.0.0.1:${PUERTO}/v1 · modo ${MODO}`);
});
