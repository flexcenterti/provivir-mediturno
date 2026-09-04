import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { json } from 'express';
import type { IncomingMessage } from 'node:http';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { fechaEnZona } from '@provivir/shared';
import { ConversacionService } from '../src/whatsapp/conversacion.service';
import { CLIENTE_LLM } from '../src/ia/ia.service';
import { MetaCliente } from '../src/whatsapp/meta.cliente';
import type { ClienteLlm, HerramientaLlm, MensajeLlm, RespuestaLlm } from '../src/ia/ia.tipos';

/**
 * Canal WhatsApp de punta a punta (Guía, FASE 4).
 *
 * El modelo se sustituye por un doble programable: así se prueban los escenarios
 * completos —con el motor y la base reales— sin depender de la API ni de su
 * variabilidad. La calidad de las respuestas del modelo real es otra cosa y se
 * mide con el set anotado antes del piloto.
 */

/**
 * Doble del modelo: se le encola la secuencia de respuestas que debe devolver.
 * Al trabajar sobre los tipos neutros, sirve igual para probar el orquestador
 * sea cual sea el proveedor configurado.
 */
class LlmFalso implements ClienteLlm {
  readonly proveedor = 'doble';
  private guion: RespuestaLlm[] = [];
  public llamadas: Array<{ system: string; mensajes: MensajeLlm[] }> = [];
  public disponible = true;

  programar(...respuestas: RespuestaLlm[]): void {
    this.guion = [...respuestas];
    this.llamadas = [];
  }

  responder(params: { system: string; mensajes: MensajeLlm[]; herramientas: HerramientaLlm[] }) {
    this.llamadas.push({ system: params.system, mensajes: params.mensajes });
    const siguiente = this.guion.shift();
    if (!siguiente) throw new Error('El doble del modelo se quedó sin respuestas programadas');
    return Promise.resolve(siguiente);
  }
}

const texto = (t: string): RespuestaLlm => ({ texto: t, llamadas: [], motivo: 'fin' });

const usaHerramienta = (nombre: string, argumentos: unknown, textoPrevio = ''): RespuestaLlm => ({
  texto: textoPrevio,
  llamadas: [{ id: `tu-${nombre}`, nombre, argumentos: argumentos as Record<string, string> }],
  motivo: 'herramientas',
});

const rechazo = (): RespuestaLlm => ({ texto: '', llamadas: [], motivo: 'rechazo' });

describe('Canal WhatsApp (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let conversaciones: ConversacionService;
  let meta: MetaCliente;
  let llm: LlmFalso;
  let http: ReturnType<INestApplication['getHttpServer']>;

  // Definidos en test/setup-e2e.ts, que corre antes de importar AppModule.
  const SECRETO = process.env.META_APP_SECRET!;
  const TEL = '+573009991111';
  const DOC = '9600000001';
  const LUNES = '2026-09-21';

  let enviados: Array<{ telefono: string; texto: string }> = [];
  let botones: Array<{ telefono: string; texto: string; ids: string[] }> = [];

  beforeAll(async () => {
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
    jest.spyOn(meta, 'enviarBotones').mockImplementation(async (telefono, t, bs) => {
      botones.push({ telefono, texto: t, ids: bs.map((b) => b.id) });
      return `wamid.btn.${botones.length}`;
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
    botones = [];
    await prisma.mensaje.deleteMany({ where: { conversacion: { telefono: TEL } } });
    await prisma.conversacion.deleteMany({ where: { telefono: TEL } });
    await prisma.cita.deleteMany({ where: { paciente: { documento: { startsWith: '96' } } } });

    // RN-09.10 · sin autorización no se atiende nada, así que el resto de escenarios
    // parten de un paciente que ya la dio. Los de consentimiento usan su propio número.
    await prisma.consentimientoWhatsapp.upsert({
      where: { identificador: TEL },
      update: { aceptado: true },
      create: { identificador: TEL, aceptado: true, politicaUrl: 'https://ejemplo/politica.pdf', sedeId: 'cdc-oriente' },
    });
  });

  async function limpiar() {
    await prisma.consentimientoWhatsapp.deleteMany({
      where: { OR: [{ identificador: { startsWith: '+57300999' } }, { identificador: { startsWith: 'wa:CO.999' } }] },
    });
    await prisma.mensaje.deleteMany({ where: { conversacion: { telefono: { startsWith: '+57300999' } } } });
    await prisma.conversacion.deleteMany({ where: { telefono: { startsWith: '+57300999' } } });
    await prisma.mensaje.deleteMany({ where: { conversacion: { telefono: { startsWith: 'wa:CO.999' } } } });
    await prisma.conversacion.deleteMany({ where: { telefono: { startsWith: 'wa:CO.999' } } });
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

  // ─────────── RN-09.10 · autorización de tratamiento de datos ───────────

  describe('RN-09.10 · consentimiento antes de atender', () => {
    // Números propios: el resto de pruebas parte de un consentimiento ya dado.
    const NUEVO = '+573009991234';
    // Quien escribe con nombre de usuario: Meta no entrega teléfono, sino este id.
    const USUARIO = 'wa:CO.9991112223334';

    let n = 0;
    const de = (telefono: string, extra: Record<string, unknown>) => ({
      waMessageId: `wamid.consent.${++n}.${Date.now()}`,
      telefono, ts: new Date(), ...extra,
    }) as never;

    beforeEach(async () => {
      // `programar()` es lo único que limpia `llm.llamadas`, y varias pruebas de aquí
      // afirman que la IA NO se invocó: sin esto heredarían las llamadas de la anterior.
      llm.programar();
      for (const id of [NUEVO, USUARIO]) {
        await prisma.mensaje.deleteMany({ where: { conversacion: { telefono: id } } });
        await prisma.conversacion.deleteMany({ where: { telefono: id } });
        await prisma.consentimientoWhatsapp.deleteMany({ where: { identificador: id } });
      }
    });

    it('RN-09.10: el primer contacto pide la autorización y NO invoca a la IA', async () => {
      await conversaciones.procesar(de(NUEVO, { tipo: 'texto', texto: 'quiero una cita' }));

      expect(llm.llamadas).toHaveLength(0);
      expect(botones).toHaveLength(1);
      expect(botones[0]!.texto).toMatch(/ley 1581 de 2012/i);
      expect(botones[0]!.texto).toMatch(/https?:\/\//);
      expect(botones[0]!.ids).toEqual(['consentimiento_acepto', 'consentimiento_rechazo']);
    });

    it('RN-09.10: aceptar saluda y retoma lo que el paciente había pedido', async () => {
      await conversaciones.procesar(de(NUEVO, { tipo: 'texto', texto: 'quiero una cita de medicina general' }));
      llm.programar(texto('Con gusto. ¿Me confirmas tu documento?'));

      await conversaciones.procesar(de(NUEVO, { tipo: 'texto', texto: 'Acepto', botonId: 'consentimiento_acepto' }));

      const suyos = enviados.filter((e) => e.telefono === NUEVO).map((e) => e.texto);
      expect(suyos[0]).toContain('Centro de Profesionales & Provivir');
      expect(suyos[0]).toContain('CPP Principal');
      // No tuvo que repetir su petición: la IA recibió el mensaje original.
      expect(llm.llamadas).toHaveLength(1);
      expect(JSON.stringify(llm.llamadas[0]!.mensajes)).toContain('medicina general');
      expect(suyos[1]).toMatch(/documento/i);
    });

    it('RN-09.10: rechazar no atiende, pero deja una salida', async () => {
      await conversaciones.procesar(de(NUEVO, { tipo: 'texto', texto: 'hola' }));
      await conversaciones.procesar(de(NUEVO, { tipo: 'texto', texto: 'No acepto', botonId: 'consentimiento_rechazo' }));

      expect(llm.llamadas).toHaveLength(0);
      const ultimo = enviados.filter((e) => e.telefono === NUEVO).at(-1)!;
      expect(ultimo.texto).toMatch(/sin esa autorización no puedo atenderte/i);
      expect(ultimo.texto).toMatch(/tel[eé]fono|sede/i);
    });

    it('RN-09.10: tras aceptar no se vuelve a preguntar', async () => {
      // Dos respuestas: el «hola» que se retoma al aceptar, y la pregunta posterior.
      llm.programar(texto('¿En qué te ayudo?'), texto('Claro que sí.'));

      await conversaciones.procesar(de(NUEVO, { tipo: 'texto', texto: 'hola' }));
      await conversaciones.procesar(de(NUEVO, { tipo: 'texto', texto: 'Acepto', botonId: 'consentimiento_acepto' }));

      // El espía numera los envíos por su posición en el array: vaciarlo repetiría un
      // waMessageId, que es único en la base. Se compara contra lo que había.
      const avisosPrevios = botones.length;
      await conversaciones.procesar(de(NUEVO, { tipo: 'texto', texto: '¿tienen pediatría?' }));

      expect(botones).toHaveLength(avisosPrevios);
      expect(llm.llamadas).toHaveLength(2);
    });

    it('RN-09.10: tras rechazar SÍ se vuelve a preguntar si escribe de nuevo', async () => {
      await conversaciones.procesar(de(NUEVO, { tipo: 'texto', texto: 'hola' }));
      await conversaciones.procesar(de(NUEVO, { tipo: 'texto', texto: 'No acepto', botonId: 'consentimiento_rechazo' }));

      const avisosPrevios = botones.length;
      await conversaciones.procesar(de(NUEVO, { tipo: 'texto', texto: 'lo pensé mejor' }));

      // Un "no" de hoy no le cierra el canal para siempre.
      expect(botones).toHaveLength(avisosPrevios + 1);
      expect(llm.llamadas).toHaveLength(0);
    });

    it('RN-09.10: una foto tampoco pasa sin autorización', async () => {
      // Sin el consentimiento por delante, esto escalaría a una asistente (RN-08.1) y
      // una persona leería el adjunto de alguien que no ha autorizado nada.
      await conversaciones.procesar(de(NUEVO, { tipo: 'imagen', mediaId: 'img-1', mimeType: 'image/jpeg' }));

      expect(botones).toHaveLength(1);
      const conv = await prisma.conversacion.findFirstOrThrow({ where: { telefono: NUEVO } });
      expect(conv.estado).toBe('ia_activa');
    });

    it('RN-09.10: funciona igual con nombre de usuario, sin teléfono', async () => {
      await conversaciones.procesar(de(USUARIO, { tipo: 'texto', texto: 'buenas' }));
      await conversaciones.procesar(de(USUARIO, { tipo: 'texto', texto: 'Acepto', botonId: 'consentimiento_acepto' }));

      const registro = await prisma.consentimientoWhatsapp.findUniqueOrThrow({
        where: { identificador: USUARIO },
      });
      expect(registro.aceptado).toBe(true);
      // Queda qué política aceptó: sin eso no se puede probar el consentimiento después.
      expect(registro.politicaUrl).toMatch(/^https?:\/\//);
      expect(registro.pacienteId).toBeNull();
    });

    it('RN-09.10: quien escribe «acepto» a mano también vale', async () => {
      await conversaciones.procesar(de(NUEVO, { tipo: 'texto', texto: 'hola' }));
      llm.programar(texto('Listo.'));
      // Sin botonId: es el respaldo en texto, y también quien no pulsa y contesta.
      await conversaciones.procesar(de(NUEVO, { tipo: 'texto', texto: 'ACEPTO' }));

      expect(await prisma.consentimientoWhatsapp.findUnique({ where: { identificador: NUEVO } }))
        .toMatchObject({ aceptado: true });
    });

    it('RN-09.10: la pregunta queda en la conversación, no solo la respuesta', async () => {
      await conversaciones.procesar(de(NUEVO, { tipo: 'texto', texto: 'hola' }));

      const conv = await prisma.conversacion.findFirstOrThrow({ where: { telefono: NUEVO } });
      const salientes = await prisma.mensaje.findMany({
        where: { conversacionId: conv.id, direccion: 'saliente' },
      });
      // Si no se persistiera, la bandeja mostraría un "Acepto" que no responde a nada.
      expect(salientes).toHaveLength(1);
      expect(salientes[0]!.contenido).toMatch(/ley 1581/i);
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
      const ultimoMensaje = ultimoTurno.mensajes.at(-1)!;
      expect(ultimoMensaje.rol).toBe('herramienta');
      expect(JSON.stringify(ultimoMensaje)).toMatch(/error/i);
      expect(enviados.at(-1)!.texto).toMatch(/consulta previa/i);
    });

    it('RN-04.6: pedir cupos de hoy le devuelve al modelo el error con la primera fecha agendable', async () => {
      // El bot puede intentarlo — el motor es quien manda. Lo que se comprueba es que
      // el rechazo viaja hasta el modelo con el motivo útil, no que el prompt lo evite.
      const hoy = fechaEnZona();
      llm.programar(
        usaHerramienta('ofrecer_cupos', { servicioId: 'mg', fecha: hoy }),
        texto('Para hoy no puedo agendarte, pero desde mañana sí.'),
      );

      await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'necesito que me vean hoy mismo' }) as never);

      const ultimoMensaje = llm.llamadas.at(-1)!.mensajes.at(-1)!;
      expect(ultimoMensaje.rol).toBe('herramienta');
      expect(JSON.stringify(ultimoMensaje)).toMatch(/más próxima disponible/);
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
