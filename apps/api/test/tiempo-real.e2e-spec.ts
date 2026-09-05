import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TurnosService } from '../src/turnos/turnos.service';
import { hoyEnSede, SEDE_ID } from '@provivir/shared';

/**
 * El canal en vivo hacia las pantallas de sala (RN-11), contra un socket de verdad.
 *
 * Esta suite existe porque **el gateway nunca había atendido una conexión real**: ni
 * en producción, ni en desarrollo, ni en la suite. El cliente pedía el handshake en
 * `/socket.io` —el path por defecto de socket.io— mientras el despliegue enrutaba
 * `/tiempo-real`, que es el *namespace*. Todo lo que cuelga del gateway estaba
 * escrito y nada estaba comprobado.
 *
 * Por eso se conecta un `socket.io-client` real contra la aplicación escuchando en un
 * puerto, en vez de invocar los métodos del gateway a mano: lo que falló durante seis
 * fases fue justamente el transporte, que un test de unidad no habría tocado.
 */
describe('Llamados en tiempo real (integración)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let turnos: TurnosService;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let base: string;

  const DOC = '9611';
  const CLAVE = 'Provivir2026!';
  const PREFIJO_PANTALLA = 'TR · ';

  let pacienteId: string;
  let contador = 0;
  const abiertos: Socket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

    prisma = app.get(PrismaService);
    turnos = app.get(TurnosService);
    // `init()` no basta: sin un puerto escuchando no hay handshake que probar.
    await app.listen(0);
    http = app.getHttpServer();
    base = await app.getUrl();

    const p = await prisma.paciente.upsert({
      where: { documento: `${DOC}0001` },
      update: {},
      create: { documento: `${DOC}0001`, nombres: 'Rosa María', apellidos: 'Quintero Ávila', sedeId: SEDE_ID },
    });
    pacienteId = p.id;
  });

  afterEach(() => {
    for (const s of abiertos.splice(0)) s.disconnect();
  });

  afterAll(async () => {
    await limpiar();
    await prisma.paciente.deleteMany({ where: { documento: { startsWith: DOC } } });
    await app.close();
  });

  beforeEach(limpiar);

  async function limpiar() {
    await prisma.cita.deleteMany({ where: { paciente: { documento: { startsWith: DOC } } } });
    await prisma.pantalla.deleteMany({ where: { nombre: { startsWith: PREFIJO_PANTALLA } } });
  }

  async function pantallaDe(servicios: string[]) {
    return prisma.pantalla.create({
      data: { nombre: `${PREFIJO_PANTALLA}${servicios.join('-')}`, servicios, sedeId: SEDE_ID },
    });
  }

  async function enEspera(servicioId: 'mg' | 'ctrl' = 'mg') {
    const cita = await prisma.cita.create({
      data: {
        codigo: `R${String(++contador).padStart(4, '0')}`,
        pacienteId, prestadorId: 'ao', servicioId,
        tipo: servicioId === 'ctrl' ? 'control' : 'general',
        fecha: hoyEnSede(), horaInicio: 480 + contador, duracionMin: 15,
        estado: 'llego', origen: 'mostrador', sedeId: SEDE_ID,
      },
    });
    return prisma.turno.create({ data: { citaId: cita.id, prioridad: 'baja', consultorio: '3' } });
  }

  /** Conecta por el path real del despliegue y espera a estar conectado. */
  async function conectar(auth?: Record<string, unknown>): Promise<Socket> {
    const s = io(`${base}/tiempo-real`, {
      path: '/tiempo-real',
      transports: ['websocket'],
      forceNew: true,
      ...(auth ? { auth } : {}),
    });
    abiertos.push(s);
    await new Promise<void>((listo, falla) => {
      s.on('connect', () => listo());
      s.on('connect_error', (e) => falla(e));
    });
    return s;
  }

  /** Espera a que el servidor cierre la conexión. */
  function esperarCierre(s: Socket, ms = 2_000): Promise<boolean> {
    if (!s.connected) return Promise.resolve(true);
    return new Promise((listo) => {
      const t = setTimeout(() => listo(false), ms);
      s.on('disconnect', () => { clearTimeout(t); listo(true); });
    });
  }

  /** Lo primero que llegue por `evento`, o `null` si en `ms` no llega nada. */
  function esperar<T>(s: Socket, evento: string, ms = 2_000): Promise<T | null> {
    return new Promise((listo) => {
      const t = setTimeout(() => listo(null), ms);
      s.on(evento, (dato: T) => { clearTimeout(t); listo(dato); });
    });
  }

  const token = async (email: string): Promise<string> => {
    const r = await request(http).post('/api/auth/login').send({ email, password: CLAVE }).expect(200);
    return r.body.accessToken;
  };

  describe('el transporte', () => {
    /*
     * Mata: quitar `path: '/tiempo-real'` del decorador. Es EXACTAMENTE el defecto
     * que estuvo seis fases en producción, y no había nada en el repo que lo cazara:
     * el cliente se conectaba a un path que el despliegue no enruta y todo degradaba
     * al sondeo en silencio.
     */
    it('el handshake se sirve en /tiempo-real, que es lo que enruta el despliegue', async () => {
      const r = await request(base).get('/tiempo-real/?EIO=4&transport=polling').expect(200);
      expect(r.text).toMatch(/^0\{"sid":/);
    });

    /*
     * Mata: dejar el path por defecto. Sin esta mitad, fijar el path y no fijarlo se
     * ven igual — la de arriba pasaría por el namespace aunque el path siguiera mal.
     */
    it('y ya no en /socket.io, que es donde nadie lo enruta', async () => {
      await request(base).get('/socket.io/?EIO=4&transport=polling').expect(404);
    });
  });

  describe('el reparto por servicio (RN-11.1)', () => {
    /*
     * Mata: quitar el `where: { servicios: { has: … } }` y emitir a todas las salas.
     * Es la regla entera de RN-11.1 y no tenía ninguna prueba: la pantalla del
     * laboratorio anunciaría a los pacientes de ginecología.
     */
    it('el llamado llega a la pantalla del servicio y no a las demás', async () => {
      const suya = await pantallaDe(['mg']);
      const ajena = await pantallaDe(['lab']);
      const turno = await enEspera('mg');

      const a = await conectar();
      const b = await conectar();
      await a.emitWithAck('suscribir-pantalla', suya.id);
      await b.emitWithAck('suscribir-pantalla', ajena.id);

      const recibeA = esperar<{ turnoId: string }>(a, 'llamado');
      const recibeB = esperar<{ turnoId: string }>(b, 'llamado');
      await turnos.llamarSiguiente({ prestadorId: 'ao' }, 'sistema');

      expect((await recibeA)?.turnoId).toBe(turno.id);
      expect(await recibeB).toBeNull();
    });

    /*
     * Mata: emitir `paciente.nombres` en crudo. El mismo recorte se calcula en dos
     * archivos (`pantallas.controller` y aquí); si divergen, el nombre completo se
     * cuela por el canal en vivo, que llega más lejos que la pantalla.
     */
    it('el nombre viaja ya recortado, como en la pantalla', async () => {
      const p = await pantallaDe(['mg']);
      await enEspera('mg');

      const s = await conectar();
      await s.emitWithAck('suscribir-pantalla', p.id);
      const recibe = esperar<{ paciente: string }>(s, 'llamado');
      await turnos.llamarSiguiente({ prestadorId: 'ao' }, 'sistema');

      // `abreviado` es el valor sembrado: primer nombre + inicial del primer apellido.
      expect((await recibe)?.paciente).toBe('Rosa Q.');
    });

    /*
     * Mata: borrar la emisión de retiro en `finalizar()`. Sin ella el paciente ya
     * atendido se queda en el televisor hasta el refetch de 60 s, y la sala ve
     * llamado a alguien que salió hace un minuto.
     */
    it('al finalizar, la pantalla recibe el retiro del turno', async () => {
      const p = await pantallaDe(['mg']);
      await enEspera('mg');
      const s = await conectar();
      await s.emitWithAck('suscribir-pantalla', p.id);

      const llamado = await turnos.llamarSiguiente({ prestadorId: 'ao' }, 'sistema');
      const retiro = esperar<{ turnoId: string }>(s, 'retirar-llamado');
      await turnos.finalizar(llamado.id, 'sistema');

      expect((await retiro)?.turnoId).toBe(llamado.id);
    });
  });

  describe('quién puede entrar a cada sala', () => {
    /*
     * Mata: exigir sesión también aquí. Es decisión escrita —un televisor no tiene
     * sesión que ofrecer— y romperla deja todas las salas sin llamados.
     */
    it('una pantalla entra sin sesión', async () => {
      const p = await pantallaDe(['mg']);
      const s = await conectar();
      expect(await s.emitWithAck('suscribir-pantalla', p.id)).toEqual({ ok: true });
    });

    /*
     * Mata: devolver `{ok:true}` incondicionalmente en `suscribirBackoffice`. Por esa
     * sala viajan nombres de pacientes; la fase 18 lo razonó y lo cerró, pero sin un
     * socket real nadie lo había comprobado.
     */
    it('el backoffice sin token es rechazado y desconectado', async () => {
      const s = await conectar();
      // El servidor cierra antes de que salga el acuse, así que el cierre ES la
      // respuesta. Esperar un `{ok:false}` aquí sería esperar algo que no llega.
      s.emit('suscribir-backoffice');
      expect(await esperarCierre(s)).toBe(true);
    });

    /* Mata: aceptar cualquier token. Un token de refresco no autoriza a operar. */
    it('el backoffice con una sesión válida entra', async () => {
      const s = await conectar({ token: await token('asistente@provivir.local') });
      expect(await s.emitWithAck('suscribir-backoffice')).toEqual({ ok: true });
    });

    /*
     * Mata: quitar la exigencia de `bandeja.operar`. El rol `pantalla` existe para
     * los televisores y solo tiene `turnos.ver`; si entrara al backoffice, un
     * televisor comprometido escucharía la bandeja entera.
     */
    it('una cuenta sin bandeja.operar no entra al backoffice', async () => {
      const s = await conectar({ token: await token('pantalla@provivir.local') });
      s.emit('suscribir-backoffice');
      expect(await esperarCierre(s)).toBe(true);
    });
  });
});
