import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CitasService } from '../src/citas/citas.service';
import { fechaEnZona } from '@provivir/shared';

/**
 * Portal público de autoagendamiento (Guía, FASE 5).
 * Verifica el flujo nuevo/registrado, la consistencia con el motor y que la
 * superficie pública no permita enumerar pacientes.
 */
describe('Portal público (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let citas: CitasService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const DOC_REGISTRADO = '9700000001';
  const DOC_NUEVO = '9700000002';
  const TEL = '+573009998877';
  const LUNES = '2026-09-14';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    prisma = app.get(PrismaService);
    citas = app.get(CitasService);
    await app.init();
    http = app.getHttpServer();

    await limpiar();
    await prisma.paciente.create({
      data: {
        documento: DOC_REGISTRADO, nombres: 'Rosa', apellidos: 'Quintero',
        telefono: TEL, whatsapp: TEL, origen: 'carga', sedeId: 'cdc-oriente',
      },
    });
  });

  afterAll(async () => { await limpiar(); await app.close(); });

  /**
   * Las citas se borran ANTES de cada prueba, no solo al final del fichero.
   *
   * Antes se acumulaban, y con RN-10.5 —una cita por día agendándose solo— eso dejó de
   * ser inocuo: la cita que deja una prueba bloquea el agendamiento de la siguiente.
   * El orden no debería haber importado nunca; ahora además se nota.
   */
  beforeEach(limpiarCitas);

  async function limpiarCitas() {
    await prisma.turno.deleteMany({ where: { cita: { paciente: { documento: { startsWith: '97' } } } } });
    await prisma.cita.deleteMany({ where: { paciente: { documento: { startsWith: '97' } } } });
  }

  async function limpiar() {
    await limpiarCitas();
    await prisma.paciente.deleteMany({ where: { documento: { startsWith: '97' } } });
  }

  const post = (ruta: string, cuerpo: object) => request(http).post(`/api/portal${ruta}`).send(cuerpo);

  describe('aviso de privacidad y catálogo', () => {
    it('Ley 1581: el aviso de privacidad es público y declara la finalidad', async () => {
      const r = await request(http).get('/api/portal/aviso-privacidad').expect(200);
      expect(r.body.base).toMatch(/1581/);
      expect(r.body.finalidad).toMatch(/No se almacenan datos clínicos/i);
    });

    it('el catálogo de servicios es público', async () => {
      const r = await request(http).get('/api/portal/servicios').expect(200);
      expect(r.body.length).toBeGreaterThan(0);
      /*
       * Sin datos internos: el portal no expone políticas de costo ni cupos.
       * `agendable` sí sale (RN-04.7): es lo que le dice al paciente que ese servicio
       * lo coordina una asistente en vez de mostrarle una pantalla de horarios vacía.
       */
      expect(Object.keys(r.body[0]).sort()).toEqual(
        ['agendable', 'categoria', 'duracionMin', 'id', 'nombre', 'requiereOrden'],
      );
    });

    it('RN-10.1: genera el QR del portal para imprimir', async () => {
      const r = await request(http).get('/api/portal/qr.png').expect(200);
      expect(r.headers['content-type']).toBe('image/png');
      // Firma PNG
      expect(r.body.slice(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });

    it('RN-10.1: el enlace del portal se consulta sin sesión', async () => {
      const r = await request(app.getHttpServer()).get('/api/portal/enlace').expect(200);

      // Es la misma URL que codifica el QR; el backoffice la muestra en texto
      // porque una imagen no se puede leer desde el navegador.
      expect(r.body.url).toMatch(/^https?:\/\//);
    });
  });

  describe('RN-10.2 · paciente registrado', () => {
    it('identifica con documento y los últimos 4 del teléfono', async () => {
      const r = await post('/identificar', { documento: DOC_REGISTRADO, telefonoUltimos4: '8877' }).expect(201);
      expect(r.body.sesion).toEqual(expect.any(String));
      expect(r.body.paciente).toEqual({ nombres: 'Rosa', apellidos: 'Quintero' });
    });

    it('no revela si el documento existe cuando el teléfono no coincide', async () => {
      const r = await post('/identificar', { documento: DOC_REGISTRADO, telefonoUltimos4: '0000' }).expect(401);
      expect(r.body.message).toMatch(/no coinciden/i);
    });

    it('sin enumeración: documento inexistente devuelve el MISMO mensaje', async () => {
      const inexistente = await post('/identificar', { documento: '9799999999', telefonoUltimos4: '0000' }).expect(401);
      const existente = await post('/identificar', { documento: DOC_REGISTRADO, telefonoUltimos4: '0000' }).expect(401);
      expect(inexistente.body.message).toBe(existente.body.message);
      expect(inexistente.status).toBe(existente.status);
    });

    it('rechaza un formato de documento inválido', async () => {
      await post('/identificar', { documento: '../etc/passwd', telefonoUltimos4: '1234' }).expect(400);
    });

    it('exige los 4 dígitos del teléfono', async () => {
      await post('/identificar', { documento: DOC_REGISTRADO, telefonoUltimos4: '88' }).expect(400);
    });
  });

  describe('RN-10.2 · paciente nuevo', () => {
    it('Ley 1581: no registra sin aceptar el aviso de privacidad', async () => {
      await post('/registrar', {
        documento: DOC_NUEVO, nombres: 'Nuevo', apellidos: 'Paciente', telefono: TEL,
      }).expect(400);
    });

    it('RN-10.4: registra con origen "autoagendamiento"', async () => {
      const r = await post('/registrar', {
        documento: DOC_NUEVO, nombres: 'Nuevo', apellidos: 'Paciente',
        telefono: '+57 300 555 4433', aceptaPrivacidad: 'si',
      }).expect(201);

      expect(r.body.sesion).toEqual(expect.any(String));

      const creado = await prisma.paciente.findUnique({ where: { documento: DOC_NUEVO } });
      expect(creado?.origen).toBe('autoagendamiento');
      expect(creado?.whatsapp).toBe('+573005554433');
    });

    it('no revela datos si el documento ya existe: remite al otro flujo', async () => {
      const r = await post('/registrar', {
        documento: DOC_REGISTRADO, nombres: 'Otro', apellidos: 'Nombre',
        telefono: TEL, aceptaPrivacidad: 'si',
      }).expect(400);
      expect(r.body.message).toMatch(/Paciente registrado/);
      expect(r.body.message).not.toMatch(/Rosa|Quintero/);
    });
  });

  describe('RN-04.6 · el portal no agenda para hoy', () => {
    it('RN-04.6: pedir cupos de hoy devuelve 400 y dice desde cuándo se puede', async () => {
      const r = await post('/cupos', { servicioId: 'mg', fecha: fechaEnZona(), prestadorId: 'ao', limite: 5 })
        .expect(400);
      // El motivo real, no un "no hay horarios" que sería falso.
      expect(r.body.message).toMatch(/más próxima disponible/);
    });

    it('RN-04.6: una fecha futura sigue devolviendo cupos', async () => {
      const r = await post('/cupos', { servicioId: 'mg', fecha: LUNES, prestadorId: 'ao', limite: 5 }).expect(201);
      expect(r.body.length).toBeGreaterThan(0);
    });
  });

  describe('consistencia con el motor', () => {
    it('el portal ofrece exactamente los mismos cupos que el backoffice', async () => {
      const delPortal = await post('/cupos', { servicioId: 'mg', fecha: LUNES, prestadorId: 'ao', limite: 10 }).expect(201);
      const delMotor = await citas.cupos({ servicioId: 'mg', fecha: LUNES, prestadorId: 'ao', limite: 10 } as never);

      expect(delPortal.body).toEqual(JSON.parse(JSON.stringify(delMotor)));
      expect(delPortal.body.length).toBeGreaterThan(0);
    });

    it('un cupo ocupado desaparece también del portal', async () => {
      const paciente = await prisma.paciente.findUnique({ where: { documento: DOC_REGISTRADO } });
      await citas.crear(
        { pacienteId: paciente!.id, servicioId: 'mg', fecha: LUNES, hora: '08:00', prestadorId: 'ao', origen: 'asistente' } as never,
        'test',
      );

      const r = await post('/cupos', { servicioId: 'mg', fecha: LUNES, prestadorId: 'ao', limite: 20 }).expect(201);
      expect(r.body.some((c: { hora: string }) => c.hora === '08:00')).toBe(false);
    });
  });

  describe('agendamiento', () => {
    /*
     * Una sola identificación para el bloque. `/identificar` está limitado a 8 por
     * minuto a propósito —es la superficie por la que se enumeraría pacientes— y una
     * llamada por prueba agota el cupo y hace fallar a la última con un 429 que no
     * tiene nada que ver con lo que se estaba probando. La sesión es un JWT y vale
     * para todas.
     */
    let sesionPaciente: string;
    beforeAll(async () => {
      sesionPaciente = (await post('/identificar', { documento: DOC_REGISTRADO, telefonoUltimos4: '8877' })
        .expect(201)).body.sesion;
    });

    it('agenda y devuelve el código único de atención', async () => {
      const cupos = await post('/cupos', { servicioId: 'mg', fecha: LUNES, prestadorId: 'ao', limite: 5 }).expect(201);
      const cupo = cupos.body[0];

      const r = await post('/agendar', {
        sesion: sesionPaciente, servicioId: 'mg', fecha: LUNES,
        hora: cupo.hora, prestadorId: cupo.prestadorId,
      }).expect(201);

      expect(r.body.creada).toBe(true);
      expect(r.body.confirmacion.codigo).toMatch(/^[A-Z]\d{4}$/);
      expect(r.body.confirmacion.indicaciones).toBeTruthy();

      // El código es único por sede y DÍA: buscarlo sin acotar la fecha puede traer
      // la cita de otro día con el mismo código.
      const cita = await prisma.cita.findFirst({
        where: { codigo: r.body.confirmacion.codigo, fecha: new Date(`${LUNES}T00:00:00Z`) },
      });
      expect(cita?.origen).toBe('autoagendamiento');
    });

    /**
     * RN-10.5 · Una cita por día agendándose solo. La regla vive en el motor y se
     * prueba a fondo en `citas.e2e-spec.ts`; lo que se verifica aquí es el cableado
     * del portal, que es la parte que puede romperse en silencio.
     */
    describe('RN-10.5 · una cita por día', () => {
      const agendar = async (sesion: string, hora: string, estado: number) =>
        post('/agendar', { sesion, servicioId: 'mg', fecha: LUNES, hora, prestadorId: 'ao' }).expect(estado);

      it('la segunda del mismo día se rechaza y dice que llame', async () => {
        await agendar(sesionPaciente, '08:00', 201);

        const r = await agendar(sesionPaciente, '09:00', 400);
        expect(r.body.message).toMatch(/Ya tienes una cita ese día/);
      });

      /**
       * El cableado propiamente dicho: la sesión viaja con la consulta de horarios.
       *
       * Mutación que la mata: no pasar `pacienteId` desde `PortalService.cupos`. El
       * portal pintaría doce horas y las rechazaría las doce al confirmar.
       */
      it('con la sesión puesta, los cupos avisan antes de pintar horarios', async () => {
        await agendar(sesionPaciente, '08:00', 201);

        const r = await post('/cupos', { sesion: sesionPaciente, servicioId: 'mg', fecha: LUNES, prestadorId: 'ao', limite: 5 })
          .expect(400);
        expect(r.body.message).toMatch(/Ya tienes una cita ese día/);
      });

      it('sin sesión se siguen pudiendo mirar los horarios', async () => {
        await agendar(sesionPaciente, '08:00', 201);

        // Curiosear la agenda no exige identificarse: sería un paso nuevo por una
        // regla que no es suya, y `agendar` la vuelve a aplicar igual.
        const r = await post('/cupos', { servicioId: 'mg', fecha: LUNES, prestadorId: 'ao', limite: 5 }).expect(201);
        expect(r.body.length).toBeGreaterThan(0);
      });

      it('una sesión ilegible no rompe la consulta de horarios', async () => {
        const r = await post('/cupos', { sesion: 'token-falso', servicioId: 'mg', fecha: LUNES, prestadorId: 'ao', limite: 5 })
          .expect(201);
        expect(r.body.length).toBeGreaterThan(0);
      });
    });

    it('sin sesión válida no se agenda', async () => {
      await post('/agendar', {
        sesion: 'token-falso', servicioId: 'mg', fecha: LUNES, hora: '10:00', prestadorId: 'ao',
      }).expect(401);
    });

    it('un token del backoffice no sirve para agendar en el portal', async () => {
      const login = await request(http).post('/api/auth/login')
        .send({ email: 'admin@provivir.local', password: 'Provivir2026!' }).expect(200);

      await post('/agendar', {
        sesion: login.body.accessToken, servicioId: 'mg', fecha: LUNES, hora: '10:00', prestadorId: 'ao',
      }).expect(401);
    });

    it('si el cupo se ocupa, devuelve alternativas en vez de fallar', async () => {
      const paciente = await prisma.paciente.findUnique({ where: { documento: DOC_NUEVO } });

      await citas.crear(
        { pacienteId: paciente!.id, servicioId: 'mg', fecha: LUNES, hora: '11:00', prestadorId: 'ao', origen: 'asistente' } as never,
        'test',
      );

      const r = await post('/agendar', {
        sesion: sesionPaciente, servicioId: 'mg', fecha: LUNES, hora: '11:00', prestadorId: 'ao',
      }).expect(201);

      expect(r.body.creada).toBe(false);
      expect(r.body.alternativas.length).toBeGreaterThan(0);
    });
  });

  describe('D3 · kiosko desactivado', () => {
    it('el kiosko reporta estado apagado con la pantalla de opciones futura', async () => {
      const r = await request(http).get('/api/kiosko/estado').expect(200);
      expect(r.body.activo).toBe(false);
      expect(r.body.mensaje).toBe('Módulo desactivado en esta etapa');
      expect(r.body.opciones).toHaveLength(4);
    });

    it('cualquier operación real del kiosko responde 503', async () => {
      await request(http).get('/api/kiosko/llegada').expect(503);
    });
  });
});
