import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ConversacionService } from '../src/whatsapp/conversacion.service';
import { ConocimientoService } from '../src/conocimiento/conocimiento.service';
import { MetaCliente } from '../src/whatsapp/meta.cliente';
import { CLIENTE_LLM } from '../src/ia/ia.service';
import { HERRAMIENTAS } from '../src/ia/ia.herramientas';
import type { ClienteLlm, HerramientaLlm, MensajeLlm, RespuestaLlm } from '../src/ia/ia.tipos';

/** Mismo doble del modelo que usa whatsapp.e2e-spec: se le encola el guion. */
class LlmFalso implements ClienteLlm {
  readonly proveedor = 'doble';
  private guion: RespuestaLlm[] = [];
  public disponible = true;
  /** Lo que la herramienta le devolvió al modelo, para poder afirmar sobre ello. */
  public vistos: MensajeLlm[] = [];

  programar(...respuestas: RespuestaLlm[]): void {
    this.guion = [...respuestas];
    this.vistos = [];
  }

  responder(params: { system: string; mensajes: MensajeLlm[]; herramientas: HerramientaLlm[] }) {
    this.vistos = params.mensajes;
    const siguiente = this.guion.shift();
    if (!siguiente) throw new Error('El doble del modelo se quedó sin respuestas programadas');
    return Promise.resolve(siguiente);
  }
}

const texto = (t: string): RespuestaLlm => ({ texto: t, llamadas: [], motivo: 'fin' });
const usa = (nombre: string, argumentos: unknown): RespuestaLlm => ({
  texto: '',
  llamadas: [{ id: `tu-${nombre}`, nombre, argumentos: argumentos as Record<string, string> }],
  motivo: 'herramientas',
});

/**
 * Herramientas de conocimiento en el orquestador (RN-13).
 *
 * Lo que importa aquí no es que la herramienta devuelva datos, sino que cuando la
 * base NO cubre la pregunta el modelo reciba una orden de escalar y no un texto
 * que pueda parafrasear.
 */
describe('Herramientas de conocimiento (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let conversaciones: ConversacionService;
  let kb: ConocimientoService;
  let llm: LlmFalso;

  const TEL = '+573009992222';
  const SEDE = 'cdc-oriente';
  const creados: string[] = [];
  const arranque = new Date();
  let enviados: string[] = [];
  let contador = 0;

  const entrante = (contenido: string) => ({
    waMessageId: `wamid.kb.${++contador}`,
    telefono: TEL,
    ts: new Date(),
    tipo: 'texto' as const,
    texto: contenido,
  });

  /** Lo que la herramienta le devolvió al modelo, ya parseado. */
  const resultadoDe = (nombre: string): Record<string, unknown> => {
    const mensajes = llm.vistos as unknown as Array<{ rol: string; nombre?: string; contenido?: string }>;
    const ultimo = mensajes.filter((m) => m.rol === 'herramienta' && m.nombre === nombre).at(-1);
    return ultimo?.contenido ? (JSON.parse(ultimo.contenido) as Record<string, unknown>) : {};
  };

  beforeAll(async () => {
    llm = new LlmFalso();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLIENTE_LLM)
      .useValue(llm)
      .compile();

    app = moduleRef.createNestApplication();
    prisma = app.get(PrismaService);
    conversaciones = app.get(ConversacionService);
    kb = app.get(ConocimientoService);

    jest.spyOn(app.get(MetaCliente), 'enviarTexto').mockImplementation(async (_tel, t) => {
      enviados.push(t);
      return `wamid.out.${enviados.length}`;
    });

    await app.init();

    const art = await kb.crear(
      {
        titulo: 'Preparación para ecografías',
        categoria: 'Preparación',
        contenidoMd:
          '## Preparación para ecografías\nPara la ecografía abdominal se requiere ayuno de 6 horas. ' +
          'Para la pélvica se necesita la vejiga llena.',
      },
      'test',
      SEDE,
    );
    creados.push(art.id);
    await kb.publicar(art.id, 'test');
  }, 60_000);

  afterAll(async () => {
    for (const id of creados) await prisma.kbArticulo.deleteMany({ where: { id } });
    await prisma.mensaje.deleteMany({ where: { conversacion: { telefono: TEL } } });
    await prisma.conversacion.deleteMany({ where: { telefono: TEL } });
    // La consulta sobrevive al borrado de la conversación (SetNull): se limpia por fecha.
    await prisma.kbConsulta.deleteMany({ where: { ts: { gte: arranque } } });
    await prisma.kbPendiente.deleteMany({ where: { creadoEn: { gte: arranque } } });
    await app.close();
  });

  beforeEach(async () => {
    enviados = [];
    await prisma.mensaje.deleteMany({ where: { conversacion: { telefono: TEL } } });
    await prisma.kbConsulta.deleteMany({ where: { conversacion: { telefono: TEL } } });
    await prisma.conversacion.deleteMany({ where: { telefono: TEL } });
  });

  it('las dos herramientas quedan declaradas para el modelo', () => {
    const nombres = HERRAMIENTAS.map((h) => h.nombre);
    expect(nombres).toContain('buscar_conocimiento');
    expect(nombres).toContain('consultar_servicio');
  });

  it('una pregunta cubierta devuelve fragmentos y la respuesta queda trazada', async () => {
    llm.programar(
      usa('buscar_conocimiento', { pregunta: '¿Cómo me preparo para la ecografía?' }),
      texto('Para la ecografía abdominal necesitas ayuno de 6 horas 🙂'),
    );

    await conversaciones.procesar(entrante('¿Cómo me preparo para la ecografía?'));

    expect(resultadoDe('buscar_conocimiento').accion).toBe('responder');

    // RN-13.7.3 · el mensaje guarda qué artículo lo sustentó.
    const saliente = await prisma.mensaje.findFirst({
      where: { conversacion: { telefono: TEL }, direccion: 'saliente' },
      orderBy: { ts: 'desc' },
    });
    expect(saliente?.kbArticulosUsados).toEqual([creados[0]]);
    expect(saliente?.kbScore).toBeGreaterThanOrEqual(62);
  });

  it('sin cobertura la herramienta ordena escalar, no devuelve texto parafraseable', async () => {
    llm.programar(
      usa('buscar_conocimiento', { pregunta: '¿Tienen parqueadero para pacientes?' }),
      usa('escalar_a_asistente', { motivo: 'La documentación no cubre esta pregunta', prioridad: 'baja' }),
      texto('Déjame confirmarlo con una asistente 🙌'),
    );

    await conversaciones.procesar(entrante('¿Tienen parqueadero para pacientes?'));

    const devuelto = resultadoDe('buscar_conocimiento');
    expect(devuelto.accion).toBe('escalar');
    // No se le entrega texto que pueda parafrasear: solo la orden de escalar.
    expect(devuelto.fragmentos).toBeUndefined();

    const conv = await prisma.conversacion.findFirst({ where: { telefono: TEL } });
    expect(conv?.escalada).toBe(true);
  });

  it('un tema prohibido ordena escalar aunque la base tuviera con qué responder', async () => {
    llm.programar(
      usa('buscar_conocimiento', { pregunta: 'Me duele el pecho, ¿qué tengo?' }),
      usa('escalar_a_asistente', { motivo: 'Consulta clínica', prioridad: 'media' }),
      texto('Te paso con una asistente ahora mismo.'),
    );

    await conversaciones.procesar(entrante('Me duele el pecho, ¿qué tengo?'));

    const devuelto = resultadoDe('buscar_conocimiento');
    expect(devuelto.accion).toBe('escalar');
    expect(String(devuelto.motivo)).toContain('Consejo o diagnóstico clínico');
    expect(devuelto.fragmentos).toBeUndefined();
  });

  it('consultar_servicio entrega las cifras desde el catálogo', async () => {
    llm.programar(
      usa('consultar_servicio', { servicio: 'Ecografía Doppler' }),
      texto('El Doppler dura 40 minutos.'),
    );

    await conversaciones.procesar(entrante('¿Cuánto dura la ecografía Doppler?'));

    const ficha = resultadoDe('consultar_servicio');
    expect(ficha.encontrado).toBe(true);
    expect(ficha.duracionMin).toBe(40);
    expect(ficha.requiereOrden).toBe(true);
    // El Doppler ocupa dos espacios de agenda (RN-04.4): la cifra sale de la ficha.
    expect(ficha.cupos).toBe(2);
  });

  it('consultar_servicio no inventa: un servicio inexistente devuelve encontrado=false', async () => {
    llm.programar(
      usa('consultar_servicio', { servicio: 'resonancia magnética' }),
      texto('Ese servicio no lo tenemos.'),
    );

    await conversaciones.procesar(entrante('¿Hacen resonancia magnética?'));
    expect(resultadoDe('consultar_servicio').encontrado).toBe(false);
  });
});
