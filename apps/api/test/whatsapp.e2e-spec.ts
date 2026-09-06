import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import request from 'supertest';
import { json } from 'express';
import type { IncomingMessage } from 'node:http';
import { AppModule } from '../src/app.module';
import {
  apagarVentana, encenderVentana, restaurarVentana, ventanaSoloElProximoLunes,
} from './utiles-autoagendamiento';
import { PrismaService } from '../src/prisma/prisma.service';
import { fechaEnZona } from '@provivir/shared';
import { ConversacionService } from '../src/whatsapp/conversacion.service';
import { CLIENTE_LLM } from '../src/ia/ia.service';
import { MetaCliente } from '../src/whatsapp/meta.cliente';
import { ConfiguracionService } from '../src/configuracion/configuracion.service';
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
  /*
   * Se capturan los ARGUMENTOS y no solo el hecho de la llamada: afirmar «se envió»
   * deja pasar mandar la plantilla equivocada, con los cuatro parámetros del ticket
   * en vez del nombre, o al teléfono sin normalizar.
   */
  let plantillas: Array<{ telefono: string; nombre: string; parametros: string[] }> = [];

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
    jest.spyOn(meta, 'enviarPlantilla').mockImplementation(async (telefono, nombre, parametros) => {
      plantillas.push({ telefono, nombre, parametros });
      return `wamid.tpl.${plantillas.length}`;
    });
    jest.spyOn(meta, 'descargarMedia').mockResolvedValue('media/prueba.jpg');

    await app.init();
    http = app.getHttpServer();

    /*
     * RN-04.8 · Esta suite no va de la ventana de autoagendamiento: se apaga para que sus
     * fechas fijas no dependan del día de la semana en que se ejecute. La regla tiene su
     * propia suite.
     */
    await apagarVentana(app);

    await limpiar();
    await prisma.paciente.create({
      data: {
        documento: DOC, nombres: 'Rosa', apellidos: 'Quintero',
        telefono: TEL, whatsapp: TEL, origen: 'carga', sedeId: 'cdc-oriente',
      },
    });
  });

  afterAll(async () => { await encenderVentana(app); await limpiar(); await app.close(); });

  beforeEach(async () => {
    enviados = [];
    botones = [];
    plantillas = [];
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

  async function tokenAsistente(): Promise<string> {
    const r = await request(http).post('/api/auth/login')
      .send({ email: 'asistente@provivir.local', password: 'Provivir2026!' }).expect(200);
    return r.body.accessToken;
  }

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

    /**
     * El agujero que abre poder tomar un hilo que el bot todavía no ha escalado.
     *
     * La puerta del consentimiento va ANTES de comprobar si el hilo está en manos de
     * una persona —tiene que anteceder también a una foto o una nota de voz—, así que
     * al aceptar se retomaba el mensaje pendiente con la IA sin volver a mirarlo.
     *
     * Mutación que la mata: quitar la relectura del estado en `resolverConsentimiento`.
     */
    it('si una asistente ya tomó el hilo, aceptar NO le devuelve la conversación a la IA', async () => {
      // El paciente escribe algo que la IA tendría que contestar: así queda pendiente
      // y hay de verdad qué retomar. Sin mensaje pendiente la prueba pasaría sola.
      await conversaciones.procesar(de(NUEVO, { tipo: 'texto', texto: 'quiero una cita' }));
      const c = await prisma.conversacion.findFirstOrThrow({ where: { telefono: NUEVO } });

      const token = await tokenAsistente();
      await request(http).patch(`/api/bandeja/${c.id}/tomar`)
        .set('Authorization', `Bearer ${token}`).expect(200);
      const tomada = await prisma.conversacion.findUniqueOrThrow({ where: { id: c.id } });
      expect(tomada.estado).toBe('en_gestion');

      await conversaciones.procesar(de(NUEVO, { tipo: 'texto', texto: 'Acepto', botonId: 'consentimiento_acepto' }));

      // Lo decisivo: el modelo no se invocó por encima de quien está atendiendo.
      expect(llm.llamadas).toHaveLength(0);

      const despues = await prisma.conversacion.findUniqueOrThrow({ where: { id: c.id } });
      expect(despues.estado).toBe('en_gestion');
      expect(despues.tomadaPor).toBe(tomada.tomadaPor);

      // Y el paciente no se queda sin respuesta: la bienvenida sí sale.
      expect(enviados.some((e) => e.telefono === NUEVO)).toBe(true);
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
    it('RN-08.3: la conversación escalada aparece con motivo y tiempo esperando', async () => {
      await conversaciones.procesar(entrante({ tipo: 'imagen', mediaId: 'm1', mimeType: 'image/jpeg' }) as never);
      const token = await tokenAsistente();

      const r = await request(http).get('/api/bandeja').set('Authorization', `Bearer ${token}`).expect(200);
      const mia = r.body.datos.find((c: { telefono: string }) => c.telefono === TEL);

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

    it('la respuesta de la asistente queda firmada con su nombre', async () => {
      await conversaciones.procesar(entrante({ tipo: 'imagen', mediaId: 'm1', mimeType: 'image/jpeg' }) as never);
      const token = await tokenAsistente();
      const c = await prisma.conversacion.findFirstOrThrow({ where: { telefono: TEL } });

      await request(http).post(`/api/bandeja/${c.id}/responder`)
        .set('Authorization', `Bearer ${token}`).send({ texto: 'Te confirmo yo.' }).expect(201);

      const r = await request(http).get(`/api/bandeja/${c.id}`)
        .set('Authorization', `Bearer ${token}`).expect(200);
      const suyo = r.body.mensajes.find((m: { contenido: string }) => m.contenido === 'Te confirmo yo.');

      // Sin autor no habría forma de distinguirla del bot, que escribe por el mismo sitio.
      expect(suyo.autor).not.toBeNull();
      expect(typeof suyo.autor.nombre).toBe('string');
    });

    /**
     * Lo que hace falta para que una conversación cerrada no desaparezca para siempre.
     */
    describe('conversaciones cerradas', () => {
      /** Deja la conversación cerrada y decide si el paciente escribió hace poco. */
      async function cerrada(ultimoEntranteHaceHoras: number) {
        await conversaciones.procesar(entrante({ texto: 'buenas' }) as never);
        const c = await prisma.conversacion.findFirstOrThrow({ where: { telefono: TEL } });
        await prisma.mensaje.updateMany({
          where: { conversacionId: c.id, direccion: 'entrante' },
          data: { ts: new Date(Date.now() - ultimoEntranteHaceHoras * 3600_000) },
        });
        // Se devuelve la fila YA actualizada: leerla antes deja `escaladaTs` stale y
        // la comparación de después no compararía nada.
        return prisma.conversacion.update({
          where: { id: c.id },
          data: { estado: 'resuelta', resueltaTs: new Date(), escalada: true, escaladaTs: new Date() },
        });
      }

      it('no salen entre los pendientes, pero sí en el histórico', async () => {
        const c = await cerrada(1);
        const token = await tokenAsistente();

        const pend = await request(http).get('/api/bandeja')
          .set('Authorization', `Bearer ${token}`).expect(200);
        expect(pend.body.datos.some((x: { id: string }) => x.id === c.id)).toBe(false);

        const hist = await request(http).get('/api/bandeja?vista=cerradas')
          .set('Authorization', `Bearer ${token}`).expect(200);
        expect(hist.body.datos.some((x: { id: string }) => x.id === c.id)).toBe(true);
      });

      it('se reabre y vuelve a la bandeja, a nombre de quien la reabrió', async () => {
        const c = await cerrada(1);
        const token = await tokenAsistente();

        await request(http).patch(`/api/bandeja/${c.id}/reabrir`)
          .set('Authorization', `Bearer ${token}`).expect(200);

        const reabierta = await prisma.conversacion.findUniqueOrThrow({ where: { id: c.id } });
        expect(reabierta.resueltaTs).toBeNull();
        expect(reabierta.estado).toBe('en_gestion');
        expect(reabierta.tomadaPor).not.toBeNull();
        expect(reabierta.reaperturas).toBe(1);
        // Las métricas se calculan sobre el estado actual: pisar esto reescribiría
        // las escalaciones de un mes ya reportado.
        expect(reabierta.escalada).toBe(true);
        expect(reabierta.escaladaTs).toEqual(c.escaladaTs);

        const pend = await request(http).get('/api/bandeja')
          .set('Authorization', `Bearer ${token}`).expect(200);
        expect(pend.body.datos.some((x: { id: string }) => x.id === c.id)).toBe(true);
      });

      it('reabrir una que no está cerrada no hace nada', async () => {
        await conversaciones.procesar(entrante({ texto: 'buenas' }) as never);
        const c = await prisma.conversacion.findFirstOrThrow({ where: { telefono: TEL } });
        const token = await tokenAsistente();

        await request(http).patch(`/api/bandeja/${c.id}/reabrir`)
          .set('Authorization', `Bearer ${token}`).expect(400);
      });

      /**
       * El fallo que hoy se ve como un «500» con el error crudo de Meta. Tiene que
       * ser un 409 que diga qué hacer, y no debe salir nada.
       */
      it('fuera de la ventana de 24 h no se envía, y se explica por qué', async () => {
        const c = await cerrada(30);
        const token = await tokenAsistente();
        await request(http).patch(`/api/bandeja/${c.id}/reabrir`)
          .set('Authorization', `Bearer ${token}`).expect(200);

        const antes = enviados.length;
        const r = await request(http).post(`/api/bandeja/${c.id}/responder`)
          .set('Authorization', `Bearer ${token}`).send({ texto: 'hola' }).expect(409);

        expect(r.body.message).toMatch(/ventana de 24 h/i);
        expect(enviados).toHaveLength(antes);
      });

      it('dentro de la ventana sí se puede responder tras reabrir', async () => {
        const c = await cerrada(1);
        const token = await tokenAsistente();
        await request(http).patch(`/api/bandeja/${c.id}/reabrir`)
          .set('Authorization', `Bearer ${token}`).expect(200);

        await request(http).post(`/api/bandeja/${c.id}/responder`)
          .set('Authorization', `Bearer ${token}`).send({ texto: 'seguimos' }).expect(201);
        expect(enviados.some((e) => e.texto === 'seguimos')).toBe(true);
      });

      /** Sin plantilla configurada no se intenta: Meta lo rechazaría igual. */
      it('sin plantilla configurada, el envío no se intenta y lo dice', async () => {
        const c = await cerrada(30);
        const token = await tokenAsistente();

        const antes = enviados.length;
        const r = await request(http).post(`/api/bandeja/${c.id}/plantilla`)
          .set('Authorization', `Bearer ${token}`).expect(409);

        expect(r.body.message).toMatch(/plantilla/i);
        expect(enviados).toHaveLength(antes);
      });

      it('con la ventana abierta, la plantilla se rechaza: se responde con texto', async () => {
        const c = await cerrada(1);
        const token = await tokenAsistente();

        await request(http).post(`/api/bandeja/${c.id}/plantilla`)
          .set('Authorization', `Bearer ${token}`).expect(409);
      });

      it('el detalle dice si se puede escribir y hasta cuándo', async () => {
        const c = await cerrada(1);
        const token = await tokenAsistente();

        const r = await request(http).get(`/api/bandeja/${c.id}`)
          .set('Authorization', `Bearer ${token}`).expect(200);

        expect(r.body.ventana.dentro).toBe(true);
        expect(r.body.ventana.expiraTs).not.toBeNull();
        expect(r.body.ventana.plantillaConfigurada).toBe(false);
      });
    });

    /**
     * RN-08.1 · la orden médica escaneada es el soporte con el que trabaja la asistente.
     * Que la conversación escale no sirve de nada si el adjunto no se puede abrir.
     */
    describe('adjunto del paciente', () => {
      // Coincide con lo que devuelve el doble de `descargarMedia`.
      const RUTA = 'media/prueba.jpg';
      const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04]);

      beforeEach(async () => {
        await mkdir(dirname(RUTA), { recursive: true });
        await writeFile(RUTA, BYTES);
      });

      afterEach(async () => {
        await rm(RUTA, { force: true });
      });

      async function mensajeConAdjunto() {
        await conversaciones.procesar(entrante({ tipo: 'imagen', mediaId: 'm1', mimeType: 'image/jpeg' }) as never);
        return prisma.mensaje.findFirstOrThrow({
          where: { mediaPath: { not: null } },
          orderBy: { ts: 'desc' },
        });
      }

      it('RN-08.1: la asistente abre el adjunto de la conversación escalada', async () => {
        const m = await mensajeConAdjunto();
        const token = await tokenAsistente();

        const r = await request(http).get(`/api/bandeja/mensajes/${m.id}/media`)
          .set('Authorization', `Bearer ${token}`)
          .responseType('blob')
          .expect(200);

        expect(r.headers['content-type']).toContain('image/jpeg');
        // Sin `nosniff` un adjunto de tipo inesperado podría interpretarse como HTML.
        expect(r.headers['x-content-type-options']).toBe('nosniff');
        expect(Buffer.from(r.body)).toEqual(BYTES);
      });

      it('queda registrado en auditoría quién abrió el adjunto', async () => {
        const m = await mensajeConAdjunto();
        const token = await tokenAsistente();

        await request(http).get(`/api/bandeja/mensajes/${m.id}/media`)
          .set('Authorization', `Bearer ${token}`).responseType('blob').expect(200);

        const entrada = await prisma.auditoria.findFirst({
          where: { entidad: `mensaje/${m.id}`, accion: 'Adjunto consultado' },
        });
        expect(entrada).not.toBeNull();
      });

      it('un mensaje sin adjunto no sirve nada', async () => {
        await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'hola' }) as never);
        const m = await prisma.mensaje.findFirstOrThrow({ where: { mediaPath: null }, orderBy: { ts: 'desc' } });
        const token = await tokenAsistente();

        await request(http).get(`/api/bandeja/mensajes/${m.id}/media`)
          .set('Authorization', `Bearer ${token}`).expect(404);
      });

      it('una ruta fuera del directorio de media nunca se sirve', async () => {
        const m = await mensajeConAdjunto();
        await prisma.mensaje.update({ where: { id: m.id }, data: { mediaPath: '/etc/passwd' } });
        const token = await tokenAsistente();

        await request(http).get(`/api/bandeja/mensajes/${m.id}/media`)
          .set('Authorization', `Bearer ${token}`).expect(404);
      });

      it('un adjunto que ya no está en disco responde 404 en vez de reventar', async () => {
        const m = await mensajeConAdjunto();
        await rm(RUTA, { force: true });
        const token = await tokenAsistente();

        await request(http).get(`/api/bandeja/mensajes/${m.id}/media`)
          .set('Authorization', `Bearer ${token}`).expect(404);
      });

      it('un prestador no puede abrir el adjunto de un paciente', async () => {
        const m = await mensajeConAdjunto();
        const login = await request(http).post('/api/auth/login')
          .send({ email: 'osorio@provivir.local', password: 'Provivir2026!' }).expect(200);

        await request(http).get(`/api/bandeja/mensajes/${m.id}/media`)
          .set('Authorization', `Bearer ${login.body.accessToken}`).expect(403);
      });
    });

    /**
     * El hilo que el bot atendió de punta a punta: existe, y hasta ahora no había
     * forma de llegar a él. `PENDIENTES` pide `escalada` o `reabiertaTs`, y «cerradas»
     * pide `resueltaTs` —que solo escribe `resolver()`, o sea una persona—, así que
     * una conversación en `ia_activa` no caía en ninguna de las dos vistas.
     */
    describe('conversaciones que el bot atendió solo', () => {
      /** Una conversación real del bot: `ia_activa`, sin escalar y sin resolver. */
      async function delBot() {
        llm.programar(texto('Con gusto te ayudo.'));
        await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'gracias' }) as never);
        const c = await prisma.conversacion.findFirstOrThrow({ where: { telefono: TEL } });
        expect(c.estado).toBe('ia_activa');
        expect(c.escalada).toBe(false);
        expect(c.resueltaTs).toBeNull();
        return c;
      }

      const contiene = (cuerpo: { datos: Array<{ id: string }> }, id: string) =>
        cuerpo.datos.some((x) => x.id === id);

      it('no sale en pendientes ni en cerradas, pero sí en todas', async () => {
        const c = await delBot();
        const token = await tokenAsistente();
        const pedir = async (vista: string) => (await request(http)
          .get(`/api/bandeja?vista=${vista}`)
          .set('Authorization', `Bearer ${token}`).expect(200)).body;

        expect(contiene(await pedir('pendientes'), c.id)).toBe(false);
        expect(contiene(await pedir('cerradas'), c.id)).toBe(false);
        expect(contiene(await pedir('todas'), c.id)).toBe(true);
      });

      it('se encuentra buscando por el documento del paciente', async () => {
        const c = await delBot();
        const token = await tokenAsistente();
        const buscar = async (vista: string) => (await request(http)
          .get(`/api/bandeja?vista=${vista}&q=${DOC}`)
          .set('Authorization', `Bearer ${token}`).expect(200)).body;

        expect(contiene(await buscar('todas'), c.id)).toBe(true);
        // El buscador hereda el filtro de la vista: en pendientes sigue sin aparecer.
        expect(contiene(await buscar('pendientes'), c.id)).toBe(false);
      });

      it('la asistente la toma y el bot deja de contestar', async () => {
        const c = await delBot();
        const token = await tokenAsistente();

        await request(http).patch(`/api/bandeja/${c.id}/tomar`)
          .set('Authorization', `Bearer ${token}`).expect(200);

        // `programar()` es lo único que limpia `llamadas`: sin esto heredaría la del bot.
        llm.programar();
        await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'sigo aquí' }) as never);

        expect(llm.llamadas).toHaveLength(0);
        const despues = await prisma.conversacion.findUniqueOrThrow({ where: { id: c.id } });
        expect(despues.estado).toBe('en_gestion');
        expect(despues.tomadaPor).not.toBeNull();
      });

      it('al resolverla pasa al histórico, desde donde ya se sabe reabrir', async () => {
        const c = await delBot();
        const token = await tokenAsistente();

        await request(http).patch(`/api/bandeja/${c.id}/resolver`)
          .set('Authorization', `Bearer ${token}`).expect(200);

        const hist = await request(http).get('/api/bandeja?vista=cerradas')
          .set('Authorization', `Bearer ${token}`).expect(200);
        expect(contiene(hist.body, c.id)).toBe(true);
      });

      /**
       * El hilo vivo se busca por variantes del número, no por igualdad exacta.
       *
       * Hoy no se alcanza por el webhook —`normalizarIdentidad` corre a la entrada, así
       * que toda fila que crea el bot ya está en `+57…`—, pero sí en cuanto una fila
       * nace con el teléfono tal como lo tecleó el paciente en el portal. Sin esto, su
       * respuesta abriría un segundo hilo y la asistente se quedaría mirando el vacío.
       *
       * Mutación que la mata: volver a `where: { telefono: entrante.telefono }`.
       */
      it('un hilo guardado sin normalizar recibe la respuesta del paciente', async () => {
        const SIN_NORMALIZAR = '3009991111';
        await prisma.conversacion.deleteMany({ where: { telefono: SIN_NORMALIZAR } });
        const paciente = await prisma.paciente.findUniqueOrThrow({ where: { documento: DOC } });
        const c = await prisma.conversacion.create({
          data: {
            telefono: SIN_NORMALIZAR, pacienteId: paciente.id,
            estado: 'en_gestion', sedeId: 'cdc-oriente',
          },
        });

        try {
          llm.programar();
          // Meta siempre entrega el formato internacional.
          await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'ya te respondo' }) as never);

          const suyas = await prisma.conversacion.count({ where: { pacienteId: paciente.id } });
          expect(suyas).toBe(1);
          const m = await prisma.mensaje.findFirstOrThrow({
            where: { direccion: 'entrante', contenido: 'ya te respondo' },
          });
          expect(m.conversacionId).toBe(c.id);
        } finally {
          await prisma.mensaje.deleteMany({ where: { conversacionId: c.id } });
          await prisma.conversacion.deleteMany({ where: { telefono: SIN_NORMALIZAR } });
        }
      });
    });

    /**
     * Fase 16 · abrirle conversación a quien nunca ha escrito.
     *
     * Quien agenda por el portal no deja hilo —solo lo crea un entrante del webhook—,
     * así que no había forma de escribirle. Y como nunca escribió, tampoco hay ventana
     * de 24 h: lo único que Meta acepta es una plantilla aprobada.
     */
    describe('abrir conversación desde el backoffice', () => {
      const CLAVE = 'plantilla_contacto_inicial';

      async function conPlantilla(nombre: string) {
        await prisma.configuracion.update({ where: { clave: CLAVE }, data: { valor: nombre } });
        await app.get(ConfiguracionService).recargar();
      }

      let pacienteId: string;

      beforeEach(async () => {
        llm.programar();
        await prisma.configuracion.upsert({
          where: { clave: CLAVE },
          update: { valor: '' },
          create: { clave: CLAVE, valor: '', descripcion: 'prueba' },
        });
        await app.get(ConfiguracionService).recargar();
        pacienteId = (await prisma.paciente.findUniqueOrThrow({ where: { documento: DOC } })).id;
      });

      const abrir = async (token: string, cuerpo: Record<string, unknown>, estado = 201) =>
        (await request(http).post('/api/bandeja')
          .set('Authorization', `Bearer ${token}`).send(cuerpo).expect(estado)).body;

      it('crea el hilo, y se ve en la bandeja con el paciente identificado', async () => {
        const token = await tokenAsistente();
        const r = await abrir(token, { pacienteId });
        expect(r.creada).toBe(true);

        // Por HTTP y no por la columna recién escrita: lo que se pide es que la
        // asistente lo VEA, y `iniciadaTs` es justo lo que lo mete en pendientes.
        const lista = await request(http).get('/api/bandeja')
          .set('Authorization', `Bearer ${token}`).expect(200);
        const fila = lista.body.datos.find((c: { id: string }) => c.id === r.conversacionId);
        expect(fila).toBeDefined();
        // A diferencia del webhook, aquí sí se sabe de quién es el número.
        expect(fila.paciente?.documento).toBe(DOC);
        expect(fila.motivo).toMatch(/Contacto iniciado/);
      });

      it('dos clics no abren dos hilos ni gastan dos plantillas', async () => {
        await conPlantilla('contacto_inicial_v1');
        const token = await tokenAsistente();

        const primera = await abrir(token, { pacienteId });
        const segunda = await abrir(token, { pacienteId });

        expect(segunda.conversacionId).toBe(primera.conversacionId);
        expect(segunda.creada).toBe(false);
        expect(await prisma.conversacion.count({ where: { pacienteId } })).toBe(1);
        expect(plantillas).toHaveLength(1);
        expect(segunda.plantilla).toBe('ya_enviada');
      });

      /**
       * El hilo nace con el número normalizado, igual que lo entregará Meta.
       *
       * Mutación que la mata: guardar `paciente.whatsapp` tal cual. El paciente del
       * portal queda como `3009991111`, su respuesta llega como `+573009991111` y se
       * abre un SEGUNDO hilo: la asistente se queda mirando el suyo, vacío.
       */
      it('cuando el paciente responde, su mensaje cae en el hilo que se abrió', async () => {
        await prisma.paciente.update({ where: { id: pacienteId }, data: { whatsapp: '3009991111' } });
        const token = await tokenAsistente();
        const r = await abrir(token, { pacienteId });

        await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'aquí estoy' }) as never);

        expect(await prisma.conversacion.count({ where: { pacienteId } })).toBe(1);
        const m = await prisma.mensaje.findFirstOrThrow({
          where: { direccion: 'entrante', contenido: 'aquí estoy' },
        });
        expect(m.conversacionId).toBe(r.conversacionId);

        await prisma.paciente.update({ where: { id: pacienteId }, data: { whatsapp: TEL } });
      });

      it('sin plantilla configurada NO se intenta el envío, y queda dicho por qué', async () => {
        const token = await tokenAsistente();
        const r = await abrir(token, { pacienteId });

        expect(r.plantilla).toBe('sin_configurar');
        // Meta lo rechazaría: intentarlo solo gasta una llamada y ensucia la cuenta.
        expect(plantillas).toHaveLength(0);
        const a = await prisma.auditoria.findFirst({
          where: { entidad: `conversacion/${r.conversacionId}` },
          orderBy: { ts: 'desc' },
        });
        expect(a?.accion).toBe('Plantilla de contacto inicial no enviada');
        expect(a?.detalle).toContain(CLAVE);
      });

      /**
       * Se afirman los ARGUMENTOS. Mutación que la mata: pasar `parametrosTicket`
       * (cuatro valores), el nombre completo en vez del primero, o el teléfono sin
       * normalizar. Comprobar solo que se llamó deja pasar las tres.
       */
      it('con plantilla configurada la manda con el nombre y el número correctos', async () => {
        await conPlantilla('contacto_inicial_v1');
        const token = await tokenAsistente();
        const r = await abrir(token, { pacienteId });

        expect(r.plantilla).toBe('enviada');
        expect(plantillas).toEqual([
          { telefono: TEL, nombre: 'contacto_inicial_v1', parametros: ['Rosa'] },
        ]);
        // Y queda en el hilo, firmada por quien la mandó.
        const m = await prisma.mensaje.findFirstOrThrow({
          where: { conversacionId: r.conversacionId, tipo: 'plantilla' },
        });
        expect(m.autorId).not.toBeNull();
      });

      it('si la ventana está abierta no se gasta plantilla: cabe texto libre', async () => {
        await conPlantilla('contacto_inicial_v1');
        await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'buenas' }) as never);
        const token = await tokenAsistente();

        const r = await abrir(token, { pacienteId });
        expect(r.plantilla).toBe('ventana_abierta');
        expect(plantillas).toHaveLength(0);
      });

      it('un hilo ya cerrado se reabre en vez de crear otro al lado', async () => {
        await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'buenas' }) as never);
        const previa = await prisma.conversacion.findFirstOrThrow({ where: { telefono: TEL } });
        await prisma.mensaje.updateMany({
          where: { conversacionId: previa.id, direccion: 'entrante' },
          data: { ts: new Date(Date.now() - 48 * 3600_000) },
        });
        await prisma.conversacion.update({
          where: { id: previa.id }, data: { estado: 'resuelta', resueltaTs: new Date() },
        });

        const token = await tokenAsistente();
        const r = await abrir(token, { pacienteId });

        expect(r.conversacionId).toBe(previa.id);
        expect(r.reabierta).toBe(true);
        const reabierta = await prisma.conversacion.findUniqueOrThrow({ where: { id: previa.id } });
        expect(reabierta.reaperturas).toBe(1);
        expect(reabierta.resueltaTs).toBeNull();
      });

      /**
       * Mutación que la mata: crear el hilo con `telefono: ''`. Esa cadena casaría con
       * cualquier otro paciente sin número y les mezclaría las conversaciones.
       */
      it('sin número utilizable responde 400 y no escribe nada', async () => {
        const solo = await prisma.paciente.create({
          data: {
            documento: '9600000099', nombres: 'Sin', apellidos: 'Numero',
            telefono: '', whatsapp: '', origen: 'carga', sedeId: 'cdc-oriente',
          },
        });
        const token = await tokenAsistente();
        await request(http).post('/api/bandeja')
          .set('Authorization', `Bearer ${token}`).send({ pacienteId: solo.id }).expect(400);

        expect(await prisma.conversacion.count({ where: { pacienteId: solo.id } })).toBe(0);
      });

      it('no se puede estampar en el motivo la cita de otro paciente', async () => {
        const otro = await prisma.paciente.create({
          data: {
            documento: '9600000098', nombres: 'Otro', apellidos: 'Paciente',
            telefono: '+573009992222', whatsapp: '+573009992222', origen: 'carga', sedeId: 'cdc-oriente',
          },
        });
        const cita = await prisma.cita.create({
          data: {
            codigo: 'ZZ-999', pacienteId: otro.id, prestadorId: 'ao', servicioId: 'mg',
            tipo: 'general', fecha: new Date(`${LUNES}T00:00:00Z`), horaInicio: 480,
            duracionMin: 20, origen: 'mostrador', sedeId: 'cdc-oriente',
          },
        });

        const token = await tokenAsistente();
        await request(http).post('/api/bandeja')
          .set('Authorization', `Bearer ${token}`)
          .send({ pacienteId, citaId: cita.id }).expect(400);
      });

      /**
       * Mutación que la mata: quitar la guarda de `tomadaPor` en `asegurarConversacion`.
       * `mandarPlantilla` pone la conversación a nombre de quien envía, así que sin
       * ella una segunda asistente se la lleva sin que la primera se entere.
       */
      it('no le quita la conversación a la asistente que ya la tiene', async () => {
        await conPlantilla('contacto_inicial_v1');
        await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'buenas' }) as never);
        const c = await prisma.conversacion.findFirstOrThrow({ where: { telefono: TEL } });
        const otra = await prisma.usuario.findFirstOrThrow({ where: { email: 'admin@provivir.local' } });
        await prisma.conversacion.update({
          where: { id: c.id }, data: { tomadaPor: otra.id, estado: 'en_gestion' },
        });

        const token = await tokenAsistente();
        const r = await request(http).post('/api/bandeja')
          .set('Authorization', `Bearer ${token}`).send({ pacienteId }).expect(409);
        expect(r.body.message).toMatch(/ya está atendiendo/);

        const despues = await prisma.conversacion.findUniqueOrThrow({ where: { id: c.id } });
        expect(despues.tomadaPor).toBe(otra.id);
      });

      it('un prestador no puede abrir conversaciones', async () => {
        const login = await request(http).post('/api/auth/login')
          .send({ email: 'osorio@provivir.local', password: 'Provivir2026!' }).expect(200);

        await request(http).post('/api/bandeja')
          .set('Authorization', `Bearer ${login.body.accessToken}`)
          .send({ pacienteId }).expect(403);
      });
    });

    it('un prestador no puede ver la bandeja', async () => {
      const login = await request(http).post('/api/auth/login')
        .send({ email: 'osorio@provivir.local', password: 'Provivir2026!' }).expect(200);

      await request(http).get('/api/bandeja')
        .set('Authorization', `Bearer ${login.body.accessToken}`).expect(403);
    });
  });
  /*
   * RN-04.8 · Único bloque de esta suite que enciende la ventana. Va al final y restaura
   * en su `afterAll`: la base es compartida y la configuración la hereda lo que corra
   * después.
   */
  describe('RN-04.8 · lo que el agente sabe de la ventana', () => {
    let lunes: string;

    beforeAll(async () => { lunes = await ventanaSoloElProximoLunes(app, '12:00-23:59'); });
    afterAll(async () => { await restaurarVentana(app); await apagarVentana(app); });

    /**
     * Mata: devolver solo `sinDisponibilidad` cuando la franja vacía la lista.
     *
     * Es lo que hacía antes, y hacía que el bot le dijera al paciente que la agenda
     * estaba llena. No lo estaba: el lunes tiene mañana entera y ninguna hora de tarde,
     * así que por este canal no hay nada — pero la razón no es la que el paciente oía.
     */
    it('cuando la franja deja la lista vacía, el modelo recibe el motivo, no un «no hay»', async () => {
      llm.programar(
        usaHerramienta('ofrecer_cupos', { servicioId: 'mg', fecha: lunes, prestadorId: 'ao' }),
        texto('Ese día solo tenemos mañana; te paso con una asistente.'),
      );

      await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'Quiero cita el lunes' }) as never);

      // El resultado de la herramienta viaja en los mensajes de la SIGUIENTE llamada.
      const visto = JSON.stringify(llm.llamadas[1]!.mensajes);
      expect(visto).toContain('sinDisponibilidad');
      expect(visto).toContain('12:00');
      expect(visto).toMatch(/SI hay agenda/);
    });

    /**
     * Mata: dejar el horario solo en el resultado de `ofrecer_cupos`.
     *
     * Sin el dato en el prompt, el modelo abre la conversación prometiendo «tenemos por
     * la mañana» y se desdice después de consultar. Rectificar es peor que no prometer.
     */
    it('el prompt lleva la franja horaria, no solo las fechas', async () => {
      llm.programar(texto('Con gusto.'));
      await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'Hola' }) as never);

      expect(llm.llamadas[0]!.system).toContain('12:00 a 23:59');
      expect(llm.llamadas[0]!.system).toContain(lunes);
    });

    /**
     * Mata: quitar del prompt la regla de ofrecer y escalar al aceptar.
     *
     * Sin ella, la lista de «Cuándo escalar» no cubre este caso y la conversación puede
     * morir en un «no puedo» sin que nadie en la clínica se entere de que esa persona
     * quiso una cita. Es una afirmación sobre el prompt y no sobre la conducta del
     * modelo, que es lo único que se puede fijar aquí: lo otro se mide con el set
     * anotado antes del piloto.
     */
    it('el prompt manda ofrecer la asistente y escalar solo cuando el paciente acepte', async () => {
      llm.programar(texto('Con gusto.'));
      await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'Hola' }) as never);

      const system = llm.llamadas[0]!.system;
      expect(system).toMatch(/no se puede reservar/);
      expect(system).toMatch(/cuando acepte\*{0,2}, no antes/);
    });

    /**
     * Cubre el CAMINO, no un aserto propio: que una conversación que ya pasó por un
     * rechazo de cupos siga llegando a la IA y pueda escalar con su motivo. Importa
     * porque el estado de la conversación sí decide si vuelve a pasar por el modelo
     * —una ya escalada no lo hace—, y sin esto el consejo del prompt podría ser un
     * callejón sin salida.
     *
     * La mutación que la mata —perder el motivo al escalar— mata también la prueba de
     * más arriba que ya cubría la escalada directa. Se comprobó. Está aquí por el
     * camino completo, no por el aserto.
     */
    it('cuando el paciente acepta, la conversación llega a la bandeja con su motivo', async () => {
      llm.programar(
        usaHerramienta('ofrecer_cupos', { servicioId: 'mg', fecha: lunes, prestadorId: 'ao' }),
        texto('Ese día solo hay mañana. ¿Quieres que una asistente te la coordine?'),
      );
      await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'Quiero cita el lunes' }) as never);

      llm.programar(
        usaHerramienta('escalar_a_asistente', {
          motivo: 'Quiere una hora fuera de la franja del canal', prioridad: 'media',
        }),
      );
      await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'Sí, por favor' }) as never);

      const c = await prisma.conversacion.findFirstOrThrow({ where: { telefono: TEL } });
      expect(c.escalada).toBe(true);
      expect(c.motivo).toBe('Quiere una hora fuera de la franja del canal');
    });

    /**
     * Mata: anunciar la franja en el prompt aunque cubra el día entero.
     *
     * «Solo en horario de 00:00 a 23:59» no es una restricción, es ruido que el modelo
     * puede acabar repitiéndole al paciente como si lo fuera.
     *
     * La segunda afirmación —que tampoco aparece el motivo— no la mata quitar su atajo
     * en `motivoDelVacio`: con la franja abierta el sondeo devuelve cero igual y sale
     * por el mismo sitio. Se comprobó mutándolo. Se afirma de todos modos porque es la
     * conducta observable que le importa al paciente, pero el atajo es un ahorro de
     * consulta y así está anotado donde vive.
     */
    it('una franja de día entero no se anuncia ni como motivo ni en el prompt', async () => {
      await ventanaSoloElProximoLunes(app, '00:00-23:59');

      llm.programar(
        usaHerramienta('ofrecer_cupos', { servicioId: 'mg', fecha: lunes, prestadorId: 'ao' }),
        texto('Estos son los horarios.'),
      );
      await conversaciones.procesar(entrante({ tipo: 'texto', texto: 'Quiero cita el lunes' }) as never);

      expect(llm.llamadas[0]!.system).not.toContain('00:00 a 23:59');
      expect(JSON.stringify(llm.llamadas[1]!.mensajes)).not.toContain('motivoSinDisponibilidad');
    });
  });
});
