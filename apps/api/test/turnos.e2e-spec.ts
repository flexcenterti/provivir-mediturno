import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TurnosService } from '../src/turnos/turnos.service';
import { hashearPassword } from '../src/auth/argon2.opciones';
import { hoyEnSede, SEDE_ID } from '@provivir/shared';

/**
 * Cola de sala contra base real (RN-05.2, RN-07.3).
 *
 * Lo que se prueba aquí no es el orden —eso vive en `turnos.reglas.spec.ts`, puro—
 * sino lo que solo se rompe con base y concurrencia: que la cola sea la de HOY, que
 * dos personas sobre la misma cola no saquen al mismo paciente, y quién puede ver
 * qué cola.
 */
describe('Cola de sala (integración)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let turnos: TurnosService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const DOC = '9600';
  const CLAVE = 'Provivir2026!';
  /** Médico con rol prestador pero SIN ficha: el estado que había en producción. */
  const MEDICO_SIN_FICHA = 'medico.sin.ficha.turnos@prueba.local';

  let pacienteId: string;
  let contador = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // Mismo montaje que `main.ts`: sin el prefijo y el pipe, ni las rutas ni la
    // validación de los DTO se parecerían a las de producción.
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

    prisma = app.get(PrismaService);
    turnos = app.get(TurnosService);
    await app.init();
    http = app.getHttpServer();

    const p = await prisma.paciente.upsert({
      where: { documento: `${DOC}0001` },
      update: {},
      create: { documento: `${DOC}0001`, nombres: 'Test', apellidos: 'Cola', sedeId: SEDE_ID },
    });
    pacienteId = p.id;

    await prisma.usuario.upsert({
      where: { email: MEDICO_SIN_FICHA },
      update: { activo: true, prestadorId: null, rol: 'prestador' },
      // Se crea con Prisma a propósito: el servicio de acceso lo rechazaría
      // (RN-06.2), y es justo la combinación que hay que poder defender.
      create: {
        email: MEDICO_SIN_FICHA, nombre: 'Médico sin ficha', rol: 'prestador',
        hashPassword: await hashearPassword(CLAVE), sedeId: SEDE_ID,
      },
    });
  });

  afterAll(async () => {
    await limpiar();
    await prisma.usuario.deleteMany({ where: { email: MEDICO_SIN_FICHA } });
    await prisma.paciente.deleteMany({ where: { documento: { startsWith: DOC } } });
    await app.close();
  });

  beforeEach(limpiar);

  async function limpiar() {
    await prisma.cita.deleteMany({ where: { paciente: { documento: { startsWith: DOC } } } });
  }

  /** Una cita con su llegada ya registrada, directamente: aquí no se prueba el motor. */
  async function enEspera(prestadorId: string, opciones: { dias?: number } = {}) {
    const fecha = new Date(hoyEnSede().getTime() + (opciones.dias ?? 0) * 86_400_000);
    const cita = await prisma.cita.create({
      data: {
        codigo: `T${String(++contador).padStart(4, '0')}`,
        pacienteId, prestadorId, servicioId: 'mg', tipo: 'general',
        fecha, horaInicio: 480 + contador, duracionMin: 15,
        estado: 'llego', origen: 'mostrador', sedeId: SEDE_ID,
      },
    });
    return prisma.turno.create({ data: { citaId: cita.id, prioridad: 'baja' } });
  }

  const token = async (email: string): Promise<string> => {
    const r = await request(http).post('/api/auth/login').send({ email, password: CLAVE }).expect(200);
    return r.body.accessToken;
  };

  describe('la cola es la de hoy', () => {
    it('un turno abierto de ayer ya no aparece', async () => {
      const ayer = await enEspera('ao', { dias: -1 });
      const hoy = await enEspera('ao');

      const cola = await turnos.cola('ao');
      expect(cola.map((t) => t.id)).toContain(hoy.id);
      /*
       * Sin el filtro de fecha este turno seguiría saliendo indefinidamente, y en la
       * vista de toda la sala sería lo primero que ve la asistente cada mañana.
       */
      expect(cola.map((t) => t.id)).not.toContain(ayer.id);
    });

    it('sin prestador devuelve la sala completa, con todos los profesionales', async () => {
      await enEspera('ao');
      await enEspera('pr');

      const sala = await turnos.cola();
      const prestadores = new Set(sala.map((t) => t.cita.prestadorId));
      expect(prestadores).toContain('ao');
      expect(prestadores).toContain('pr');
    });
  });

  describe('quién puede ver qué cola', () => {
    it('un médico con ficha recibe la suya aunque pida otra', async () => {
      await enEspera('ao');
      await enEspera('pr');
      const t = await token('osorio@provivir.local');

      const r = await request(http).get('/api/turnos?prestadorId=pr')
        .set('Authorization', `Bearer ${t}`).expect(200);

      expect(r.body.length).toBeGreaterThan(0);
      expect(r.body.every((x: { cita: { prestadorId: string } }) => x.cita.prestadorId === 'ao')).toBe(true);
    });

    /**
     * El caso que existía en producción. Con el filtro puesto a `undefined`, la cola
     * de un médico a medio configurar era la sala ENTERA: todos los pacientes del
     * día, con nombre y apellido.
     */
    it('un médico SIN ficha no recibe la sala entera', async () => {
      await enEspera('ao');
      await enEspera('pr');
      const t = await token(MEDICO_SIN_FICHA);

      const r = await request(http).get('/api/turnos')
        .set('Authorization', `Bearer ${t}`).expect(200);

      expect(r.body).toEqual([]);
    });

    it('una asistente sin ficha sí elige la cola que pide', async () => {
      await enEspera('ao');
      await enEspera('pr');
      const t = await token('asistente@provivir.local');

      const r = await request(http).get('/api/turnos?prestadorId=pr')
        .set('Authorization', `Bearer ${t}`).expect(200);

      expect(r.body.length).toBeGreaterThan(0);
      expect(r.body.every((x: { cita: { prestadorId: string } }) => x.cita.prestadorId === 'pr')).toBe(true);
    });
  });

  describe('llamar al siguiente', () => {
    it('la asistente llama en la cola de un médico y queda registrada como quien lo hizo', async () => {
      const turno = await enEspera('ao');
      const t = await token('asistente@provivir.local');

      await request(http).post('/api/turnos/llamar-siguiente')
        .set('Authorization', `Bearer ${t}`).send({ prestadorId: 'ao' }).expect(201);

      const llamado = await prisma.turno.findUniqueOrThrow({
        where: { id: turno.id }, include: { cita: true },
      });
      expect(llamado.estado).toBe('llamado');
      expect(llamado.cita.estado).toBe('en_atencion');

      // La auditoría distingue quién pulsó de para quién: sin eso, un llamado de la
      // asistente sería indistinguible de uno del médico.
      const registro = await prisma.auditoria.findFirstOrThrow({
        where: { entidad: `cita/${llamado.cita.codigo}`, accion: 'Llamado de turno' },
        orderBy: { ts: 'desc' },
      });
      const asistente = await prisma.usuario.findUniqueOrThrow({ where: { email: 'asistente@provivir.local' } });
      expect(registro.usuario).toBe(asistente.id);
      expect(registro.detalle).toMatch(/Osorio/);
    });

    /**
     * Desde que la asistente también puede llamar, hay dos personas sobre la misma
     * cola. Sin el cerrojo, todas leen la misma lista, resuelven el mismo paciente y
     * las pantallas lo llaman varias veces.
     *
     * Van SEIS y no dos a propósito: con dos peticiones el solapamiento no se da
     * siempre y la prueba pasaba igual con el cerrojo quitado — o sea que no probaba
     * nada. Con seis es determinista: medido, sin cerrojo devuelve **el mismo turno
     * las seis veces**.
     */
    it('varios llamados a la vez nunca sacan al mismo paciente', async () => {
      const esperando = await Promise.all(Array.from({ length: 6 }, () => enEspera('ao')));
      const t = await token('asistente@provivir.local');

      const llamar = () => request(http).post('/api/turnos/llamar-siguiente')
        .set('Authorization', `Bearer ${t}`).send({ prestadorId: 'ao' });
      const respuestas = await Promise.all(Array.from({ length: 6 }, llamar));

      expect(respuestas.every((r) => r.status === 201)).toBe(true);
      const devueltos = respuestas.map((r) => r.body.id as string);
      expect(new Set(devueltos).size).toBe(6);
      expect(new Set(devueltos)).toEqual(new Set(esperando.map((t2) => t2.id)));
    });

    it('sin nadie esperando responde que no hay a quién llamar', async () => {
      const t = await token('asistente@provivir.local');
      await request(http).post('/api/turnos/llamar-siguiente')
        .set('Authorization', `Bearer ${t}`).send({ prestadorId: 'ao' }).expect(404);
    });
  });
});
