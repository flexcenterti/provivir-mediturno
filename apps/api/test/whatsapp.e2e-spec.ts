import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import type Anthropic from '@anthropic-ai/sdk';
import { json } from 'express';
import type { IncomingMessage } from 'node:http';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ConversacionService } from '../src/whatsapp/conversacion.service';
import { CLIENTE_LLM } from '../src/ia/ia.service';
import { MetaCliente } from '../src/whatsapp/meta.cliente';
import type { ClienteLlm } from '../src/ia/ia.tipos';

/**
 * Canal WhatsApp de punta a punta (Guía, FASE 4).
 *
 * El modelo se sustituye por un doble programable: así se prueban los escenarios
 * completos —con el motor y la base reales— sin depender de la API ni de su
 * variabilidad. La calidad de las respuestas del modelo real es otra cosa y se
 * mide con el set anotado antes del piloto.
 */

/** Doble del LLM: se le encola la secuencia de respuestas que debe devolver. */
class LlmFalso implements ClienteLlm {
  private guion: Anthropic.Message[] = [];
  public llamadas: Array<{ system: string; messages: Anthropic.MessageParam[] }> = [];
  public disponible = true;

  programar(...mensajes: Anthropic.Message[]): void {
    this.guion = [...mensajes];
    this.llamadas = [];
  }

  crearMensaje(params: { system: string; messages: Anthropic.MessageParam[]; tools: Anthropic.Tool[] }) {
    this.llamadas.push({ system: params.system, messages: params.messages });
    const siguiente = this.guion.shift();
    if (!siguiente) throw new Error('El doble del LLM se quedó sin respuestas programadas');
    return Promise.resolve(siguiente);
  }
}

const texto = (t: string): Anthropic.Message =>
  ({
    id: 'msg', type: 'message', role: 'assistant', model: 'falso',
    stop_reason: 'end_turn', stop_sequence: null,
    content: [{ type: 'text', text: t, citations: null }],
    usage: { input_tokens: 0, output_tokens: 0 },
  }) as unknown as Anthropic.Message;

const usaHerramienta = (nombre: string, input: unknown, textoPrevio = ''): Anthropic.Message =>
  ({
    id: 'msg', type: 'message', role: 'assistant', model: 'falso',
    stop_reason: 'tool_use', stop_sequence: null,
    content: [
      ...(textoPrevio ? [{ type: 'text', text: textoPrevio, citations: null }] : []),
      { type: 'tool_use', id: `tu-${nombre}`, name: nombre, input },
    ],
    usage: { input_tokens: 0, output_tokens: 0 },
  }) as unknown as Anthropic.Message;

const rechazo = (): Anthropic.Message =>
  ({
    id: 'msg', type: 'message', role: 'assistant', model: 'falso',
    stop_reason: 'refusal', stop_sequence: null, content: [],
    usage: { input_tokens: 0, output_tokens: 0 },
  }) as unknown as Anthropic.Message;

describe('Canal WhatsApp (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let conversaciones: ConversacionService;
  let meta: MetaCliente;
  let llm: LlmFalso;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const SECRETO = 'secreto-de-prueba';
  const TEL = '+573009991111';
  const DOC = '9600000001';
  const LUNES = '2026-09-21';

  let enviados: Array<{ telefono: string; texto: string }> = [];

  beforeAll(async () => {
    process.env.META_APP_SECRET = SECRETO;
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'token-verificacion';

    llm = new LlmFalso();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLIENTE_LLM)
      .useValue(llm)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(json({
      verify: (req: IncomingMessage & { rawBody?: Buffer }, _res, buf: Buffer) => { req.rawBody = buf; },
    }));
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

    prisma = app.get(PrismaService);
    conversaciones = app.get(ConversacionService);
    meta = app.get(MetaCliente);

    // Se intercepta el envío para poder afirmar sobre lo que recibe el paciente.
    jest.spyOn(meta, 'enviarTexto').mockImplementation(async (telefono, t) => {
      enviados.push({ telefono, texto: t });
      return `wamid.out.${enviados.length}`;
    });
    jest.spyOn(meta, 'descargarMedia').mockResolvedValue('media/prueba.jpg');

    await app.init();
    http = app.getHttpServer();

    await limpiar();
    await prisma.paciente.create({
      data: {
        documento: DOC, nombres: 'Rosa', apellidos: 'Quintero',
        telefono: TEL, whatsapp: TEL, origen: 'carga', sedeId: 'cdc-oriente',
      },
    });
  });

  afterAll(async () => { await limpiar(); await app.close(); });

  beforeEach(async () => {
    enviados = [];
    await prisma.mensaje.deleteMany({ where: { conversacion: { telefono: TEL } } });
    await prisma.conversacion.deleteMany({ where: { telefono: TEL } });
    await prisma.cita.deleteMany({ where: { paciente: { documento: { startsWith: '96' } } } });
  });

  async function limpiar() {
    await prisma.mensaje.deleteMany({ where: { conversacion: { telefono: { startsWith: '+57300999' } } } });
    await prisma.conversacion.deleteMany({ where: { telefono: { startsWith: '+57300999' } } });
    await prisma.cita.deleteMany({ where: { paciente: { documento: { startsWith: '96' } } } });
    await prisma.paciente.deleteMany({ where: { documento: { startsWith: '96' } } });
  }

  let contador = 0;
  const entrante = (extra: Record<string, unknown>) => ({
    waMessageId: `wamid.${++contador}`,
    telefono: TEL,
    ts: new Date(),
    ...extra,
  });

  // ─────────────────────── Webhook y firma ───────────────────────

  describe('webhook', () => {
    const cuerpo = { object: 'whatsapp_business_account', entry: [] };
    const firmar = (b: string, s = SECRETO) => `sha256=${createHmac('sha256', s).update(Buffer.from(b)).digest('hex')}`;

    it('firma inválida → 401', async () => {
      const crudo = JSON.stringify(cuerpo);
      await request(http)
        .post('/api/webhooks/whatsapp')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', firmar(crudo, 'secreto-equivocado'))
        .send(crudo)
        .expect(401);
    });

    it('sin firma → 401', async () => {
      await request(http).post('/api/webhooks/whatsapp').send(cuerpo).expect(401);
    });

    it('firma válida → 200', async () => {
      const crudo = JSON.stringify(cuerpo);
      await request(http)
        .post('/api/webhooks/whatsapp')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', firmar(crudo))
        .send(crudo)
        .expect(200);
    });

    it('la verificación de registro devuelve el challenge con el token correcto', async () => {
      const r = await request(http)
        .get('/api/webhooks/whatsapp')
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'token-verificacion', 'hub.challenge': '99887' })
        .expect(200);
      expect(r.text).toBe('99887');
    });

    it('la verificación con token incorrecto → 401', async () => {
      await request(http)
        .get('/api/webhooks/whatsapp')
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'malo', 'hub.challenge': '1' })
        .expect(401);
    });
  });

  // ─────────────────────── RN-08 · escalamiento ───────────────────────

  describe('RN-08 · escalamiento', () => {
    it('RN-08.1: la foto de una orden médica escala de inmediato SIN pasar por la IA', async () => {
      await conversaciones.procesar(entrante({ tipo: 'imagen', mediaId: 'm1', mimeType: 'image/jpeg' }) as never);

      const c = await prisma.conversacion.findFirstOrThrow({ where: { telefono: TEL } });
      expect(c.escalada).toBe(true);
      expect(c.escaladaTs).not.toBeNull();
      expect(c.motivo).toMatch(/sin lectura por IA/i);
      // Lo decisivo: el modelo nunca se invocó.
      expect(llm.llamadas).toHaveLength(0);
    });

    it('RN-08.1: la imagen queda adjunta como soporte para la asistente', async () => {
      await conversaciones.procesar(entrante({ tipo: 'imagen', mediaId: 'm1', mimeType: 'image/jpeg' }) as never);

      const m = await prisma.mensaje.findFirstOrThrow({ where: { tipo: 'imagen' } });
      expect(m.mediaPath).toBe('media/prueba.jpg');
    });

    it('RN-08.1: el paciente recibe un aviso, no silencio', async () => {
      await conversaciones.procesar(entrante({ tipo: 'imagen', mediaId: 'm1', mimeType: 'image/jpeg' }) as never);
      expect(enviados).toHaveLength(1);
      expect(enviados[0]!.texto).toMatch(/asistente/i);
    });

    it('un documento adjunto escala igual que una imagen', async () => {
      await conversaciones.procesar(entrante({ tipo: 'documento', mediaId: 'd1', mimeType: 'application/pdf' }) as never);
      const c = await prisma.conversacion.findFirstOrThrow({ where: { telefono: TEL } });
      expect(c.escalada).toBe(true);
    });

    it('RN-09.2: una nota de voz sin transcripción escala con el audio adjunto', async () => {
      await conversaciones.procesar(entrante({ tipo: 'audio', mediaId: 'a1', mimeType: 'audio/ogg', esNotaDeVoz: true }) as never);

      const c = await prisma.conversacion.findFirstOrThrow({ where: { telefono: TEL } });
      expect(c.escalada).toBe(true);
      expect(c.motivo).toMatch(/nota de voz/i);
      expect(llm.llamadas).toHaveLength(0);
    });

    it('RN-08.1: pedir una persona escala sin gastar un turno de IA', async () => {
      await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'quiero hablar con una persona' }) as never);

      const c = await prisma.conversacion.findFirstOrThrow({ where: { telefono: TEL } });
      expect(c.escalada).toBe(true);
      expect(llm.llamadas).toHaveLength(0);
    });

    it('la IA puede escalar por sí misma con motivo y prioridad', async () => {
      llm.programar(usaHerramienta('escalar_a_asistente', { motivo: 'Reclamo de facturación', prioridad: 'alta' }));
      await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'me cobraron de más' }) as never);

      const c = await prisma.conversacion.findFirstOrThrow({ where: { telefono: TEL } });
      expect(c.escalada).toBe(true);
      expect(c.motivo).toBe('Reclamo de facturación');
      expect(c.prioridad).toBe('alta');
    });

    it('si el modelo declina el turno, se escala en vez de dejar al paciente sin respuesta', async () => {
      llm.programar(rechazo());
      await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'hola' }) as never);

      const c = await prisma.conversacion.findFirstOrThrow({ where: { telefono: TEL } });
      expect(c.escalada).toBe(true);
      expect(enviados).toHaveLength(1);
    });

    it('una conversación ya escalada NO vuelve a pasar por la IA', async () => {
      await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'quiero hablar con una persona' }) as never);
      llm.programar(texto('esto no debería enviarse'));

      await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'sigo aquí' }) as never);
      expect(llm.llamadas).toHaveLength(0);
    });
  });

  // ─────────────────────── Escenarios del prototipo ───────────────────────

  describe('escenarios de agendamiento', () => {
    it('agenda una consulta general de punta a punta', async () => {
      llm.programar(
        usaHerramienta('buscar_paciente', { documento: DOC }),
        usaHerramienta('ofrecer_cupos', { servicioId: 'mg', fecha: LUNES }),
        usaHerramienta('confirmar_cita', {
          pacienteId: 'se-reemplaza', servicioId: 'mg', fecha: LUNES, hora: '08:00', prestadorId: 'ao',
        }),
        texto('Listo, tu cita quedó agendada.'),
      );

      // El id real del paciente lo resuelve buscar_paciente; el doble usa el del contexto.
      const paciente = await prisma.paciente.findUniqueOrThrow({ where: { documento: DOC } });
      llm.programar(
        usaHerramienta('buscar_paciente', { documento: DOC }),
        usaHerramienta('ofrecer_cupos', { servicioId: 'mg', fecha: LUNES }),
        usaHerramienta('confirmar_cita', {
          pacienteId: paciente.id, servicioId: 'mg', fecha: LUNES, hora: '08:00', prestadorId: 'ao',
        }),
        texto('Listo, tu cita quedó agendada.'),
      );

      await conversaciones.procesar(entrante({ tipo: 'texto', texto: `Quiero una cita, mi cédula es ${DOC}` }) as never);

      const cita = await prisma.cita.findFirst({ where: { pacienteId: paciente.id } });
      expect(cita).not.toBeNull();
      expect(cita!.origen).toBe('whatsapp');
      expect(enviados.at(-1)!.texto).toMatch(/agendada/i);
    });

    it('RN-01: si el motor rechaza por regla de negocio, el error llega al modelo como resultado', async () => {
      llm.programar(
        // Un control sin cita origen: el motor debe rechazarlo.
        usaHerramienta('confirmar_cita', {
          pacienteId: 'x', servicioId: 'ctrl', fecha: LUNES, hora: '08:00', prestadorId: 'ao',
        }),
        texto('Necesito primero tu consulta previa.'),
      );

      await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'quiero un control' }) as never);

      // El segundo turno del modelo recibió el resultado de error de la herramienta.
      const ultimoTurno = llm.llamadas.at(-1)!;
      const resultados = JSON.stringify(ultimoTurno.messages.at(-1));
      expect(resultados).toMatch(/error/i);
      expect(enviados.at(-1)!.texto).toMatch(/consulta previa/i);
    });

    it('el paciente nuevo se registra con origen whatsapp', async () => {
      llm.programar(
        usaHerramienta('registrar_paciente', {
          documento: '9600000002', nombres: 'Nuevo', apellidos: 'Paciente', telefono: TEL,
        }),
        texto('Listo, ya te registré.'),
      );

      await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'soy nuevo' }) as never);

      const p = await prisma.paciente.findUnique({ where: { documento: '9600000002' } });
      expect(p?.origen).toBe('whatsapp');
    });

    it('un paciente no puede cancelar la cita de otro', async () => {
      const otro = await prisma.paciente.create({
        data: { documento: '9600000003', nombres: 'Otro', apellidos: 'Paciente', sedeId: 'cdc-oriente' },
      });
      const cita = await prisma.cita.create({
        data: {
          codigo: 'Z9999', pacienteId: otro.id, prestadorId: 'ao', servicioId: 'mg',
          tipo: 'general', fecha: new Date(`${LUNES}T00:00:00Z`), horaInicio: 600,
          duracionMin: 15, origen: 'asistente', sedeId: 'cdc-oriente',
        },
      });

      const yo = await prisma.paciente.findUniqueOrThrow({ where: { documento: DOC } });
      llm.programar(
        usaHerramienta('buscar_paciente', { documento: DOC }),
        usaHerramienta('cancelar_cita', { citaId: cita.id, motivo: 'ya no puedo' }),
        texto('No encontré esa cita.'),
      );

      await conversaciones.procesar(entrante({ tipo: 'texto', texto: `cancela mi cita, doc ${DOC}` }) as never);

      const sigueViva = await prisma.cita.findUniqueOrThrow({ where: { id: cita.id } });
      expect(sigueViva.estado).not.toBe('cancelada');
      expect(yo.id).not.toBe(otro.id);
    });
  });

  // ─────────────────────── RN-09.8 · oferta web ───────────────────────

  describe('RN-09.8 · oferta del portal web', () => {
    it('el prompt incluye la oferta del portal en una conversación nueva', async () => {
      llm.programar(texto('Con gusto te ayudo.'));
      await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'quiero una cita' }) as never);

      expect(llm.llamadas[0]!.system).toMatch(/Autoagendamiento web/);
    });

    it('pedir cupos marca la intención de agendar y programa el seguimiento', async () => {
      llm.programar(
        usaHerramienta('ofrecer_cupos', { servicioId: 'mg', fecha: LUNES }),
        texto('Estos son los horarios disponibles.'),
      );
      await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'horarios para medicina general' }) as never);

      const c = await prisma.conversacion.findFirstOrThrow({ where: { telefono: TEL } });
      expect(c.intencion).toMatch(/web-ofrecida/);
    });

    it('el seguimiento NO escribe si el paciente ya agendó', async () => {
      const paciente = await prisma.paciente.findUniqueOrThrow({ where: { documento: DOC } });
      const c = await prisma.conversacion.create({
        data: { telefono: TEL, pacienteId: paciente.id, estado: 'ia_activa', sedeId: 'cdc-oriente' },
      });
      await prisma.cita.create({
        data: {
          codigo: 'Y0001', pacienteId: paciente.id, prestadorId: 'ao', servicioId: 'mg',
          tipo: 'general', fecha: new Date(`${LUNES}T00:00:00Z`), horaInicio: 540,
          duracionMin: 15, origen: 'autoagendamiento', sedeId: 'cdc-oriente',
        },
      });

      await conversaciones.seguimientoPortal({ conversacionId: c.id, telefono: TEL });
      expect(enviados).toHaveLength(0);
    });

    it('el seguimiento escribe si el paciente NO agendó', async () => {
      const c = await prisma.conversacion.create({
        data: { telefono: TEL, estado: 'ia_activa', sedeId: 'cdc-oriente' },
      });

      await conversaciones.seguimientoPortal({ conversacionId: c.id, telefono: TEL });
      expect(enviados).toHaveLength(1);
      expect(enviados[0]!.texto).toMatch(/pudiste agendar/i);
    });

    it('el seguimiento NO escribe si una asistente ya tomó la conversación', async () => {
      const c = await prisma.conversacion.create({
        data: { telefono: TEL, estado: 'en_gestion', escalada: true, sedeId: 'cdc-oriente' },
      });

      await conversaciones.seguimientoPortal({ conversacionId: c.id, telefono: TEL });
      expect(enviados).toHaveLength(0);
    });
  });

  // ─────────────────────── Bandeja ───────────────────────

  describe('bandeja de la asistente', () => {
    async function tokenAsistente(): Promise<string> {
      const r = await request(http).post('/api/auth/login')
        .send({ email: 'asistente@provivir.local', password: 'Provivir2026!' }).expect(200);
      return r.body.accessToken;
    }

    it('RN-08.3: la conversación escalada aparece con motivo y tiempo esperando', async () => {
      await conversaciones.procesar(entrante({ tipo: 'imagen', mediaId: 'm1', mimeType: 'image/jpeg' }) as never);
      const token = await tokenAsistente();

      const r = await request(http).get('/api/bandeja').set('Authorization', `Bearer ${token}`).expect(200);
      const mia = r.body.find((c: { telefono: string }) => c.telefono === TEL);

      expect(mia).toBeDefined();
      expect(mia.motivo).toMatch(/sin lectura por IA/i);
      expect(typeof mia.minutosEsperando).toBe('number');
    });

    it('RN-08.3: el conteo de pendientes viene sin sonido', async () => {
      await conversaciones.procesar(entrante({ tipo: 'imagen', mediaId: 'm1', mimeType: 'image/jpeg' }) as never);
      const token = await tokenAsistente();

      const r = await request(http).get('/api/bandeja/pendientes/conteo')
        .set('Authorization', `Bearer ${token}`).expect(200);

      expect(r.body.pendientes).toBeGreaterThan(0);
      expect(r.body.sonido).toBe(false);
    });

    it('la asistente toma, responde y resuelve', async () => {
      await conversaciones.procesar(entrante({ tipo: 'imagen', mediaId: 'm1', mimeType: 'image/jpeg' }) as never);
      const token = await tokenAsistente();
      const c = await prisma.conversacion.findFirstOrThrow({ where: { telefono: TEL } });

      await request(http).patch(`/api/bandeja/${c.id}/tomar`).set('Authorization', `Bearer ${token}`).expect(200);
      await request(http).post(`/api/bandeja/${c.id}/responder`)
        .set('Authorization', `Bearer ${token}`).send({ texto: 'Hola, soy Paula.' }).expect(201);
      await request(http).patch(`/api/bandeja/${c.id}/resolver`).set('Authorization', `Bearer ${token}`).expect(200);

      const resuelta = await prisma.conversacion.findUniqueOrThrow({ where: { id: c.id } });
      expect(resuelta.estado).toBe('resuelta');
      expect(resuelta.resueltaTs).not.toBeNull();
      expect(enviados.some((e) => e.texto === 'Hola, soy Paula.')).toBe(true);
    });

    it('un prestador no puede ver la bandeja', async () => {
      const login = await request(http).post('/api/auth/login')
        .send({ email: 'osorio@provivir.local', password: 'Provivir2026!' }).expect(200);

      await request(http).get('/api/bandeja')
        .set('Authorization', `Bearer ${login.body.accessToken}`).expect(403);
    });
  });
});
