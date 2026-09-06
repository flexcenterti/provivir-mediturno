import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CitasService } from '../src/citas/citas.service';
import { ConfiguracionService } from '../src/configuracion/configuracion.service';
import { hoyEnSede, momentoEnSede, SEDE_ID } from '@provivir/shared';

/**
 * RN-04.8 · Cuándo se permite el autoagendamiento, contra base real.
 *
 * Aquí se prueba el **cableado**, no la tabla: qué guardas corren, sobre qué canales y
 * en qué orden. La semántica de las siete filas —los `+N` que anotó el cliente— vive en
 * las unitarias puras, que la cubren exhaustivamente y no dependen del calendario.
 *
 * Por eso casi todas usan una ventana deliberadamente abierta (lunes a domingo): así la
 * suite no pasa o falla según el día en que se ejecute.
 */
describe('Ventana de autoagendamiento (integración)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let citas: CitasService;
  let config: ConfiguracionService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const DOC = '9644';
  const PRESTADOR = 'aa-pruebas';
  const TODA_LA_SEMANA = '1:1-7,2:1-7,3:1-7,4:1-7,5:1-7,6:1-7,7:1-7';

  let pacienteId: string;
  let contador = 0;

  /** Una fecha dentro de la ventana abierta: pasado mañana, para no rozar el borde. */
  const dentro = () => new Date(hoyEnSede().getTime() + 2 * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

    prisma = app.get(PrismaService);
    citas = app.get(CitasService);
    config = app.get(ConfiguracionService);
    await app.init();
    http = app.getHttpServer();

    // Prestador propio con agenda TODOS los días, mañana y tarde: así la regla es lo
    // único que puede quitar cupos.
    await prisma.prestador.upsert({
      where: { id: PRESTADOR },
      update: { activo: true },
      create: { id: PRESTADOR, nombre: 'Dr. Ventana', especialidad: 'Medicina General', activo: true, sedeId: SEDE_ID },
    });
    await prisma.prestadorServicio.upsert({
      where: { prestadorId_servicioId: { prestadorId: PRESTADOR, servicioId: 'mg' } },
      update: { duracionMin: 15 }, create: { prestadorId: PRESTADOR, servicioId: 'mg', duracionMin: 15 },
    });
    await prisma.agenda.deleteMany({ where: { prestadorId: PRESTADOR } });
    await prisma.agenda.create({
      data: {
        prestadorId: PRESTADOR, modo: 'semanal', diasSemana: [1, 2, 3, 4, 5, 6, 7],
        horaIni: '08:00', horaFin: '18:00', slotMin: 15, sedeId: SEDE_ID,
      },
    });

    const p = await prisma.paciente.upsert({
      where: { documento: `${DOC}0001` }, update: {},
      create: { documento: `${DOC}0001`, nombres: 'Val', apellidos: 'Ventana', sedeId: SEDE_ID },
    });
    pacienteId = p.id;
  });

  afterAll(async () => {
    await abrir();
    await prisma.cita.deleteMany({ where: { prestadorId: PRESTADOR } });
    await prisma.agenda.deleteMany({ where: { prestadorId: PRESTADOR } });
    await prisma.prestadorServicio.deleteMany({ where: { prestadorId: PRESTADOR } });
    await prisma.prestador.deleteMany({ where: { id: PRESTADOR } });
    await prisma.paciente.deleteMany({ where: { documento: { startsWith: DOC } } });
    await app.close();
  });

  beforeEach(async () => {
    await prisma.cita.deleteMany({ where: { prestadorId: PRESTADOR } });
    await abrir();
  });

  /** Deja la regla encendida pero sin restringir nada, para probar una cosa a la vez. */
  async function abrir() {
    await config.fijar('autoagendamiento_ventana_activa', 'true');
    await config.fijar('autoagendamiento_ventana_dias', TODA_LA_SEMANA);
    await config.fijar('autoagendamiento_dias_excluidos', '');
    await config.fijar('autoagendamiento_horario_cita', '00:00-23:59');
    await config.fijar('autoagendamiento_horario_canal', '00:00-23:59');
  }

  const auto = () => ({ autoservicio: true, pacienteId });

  const crear = (fecha: string, hora: string, opciones?: object) =>
    citas.crear({
      pacienteId, servicioId: 'mg', prestadorId: PRESTADOR, fecha, hora, origen: 'autoagendamiento',
      codigo: `V${String(++contador).padStart(4, '0')}`,
    } as never, 'sistema', opciones as never);

  describe('la ventana de días', () => {
    /*
     * Mata: no aplicar la ventana. Con la fila de hoy apuntando solo a mañana, pasado
     * mañana tiene que quedar fuera.
     */
    it('una fecha fuera de la ventana se rechaza, y el mensaje dice cuáles sí', async () => {
      const hoyIso = momentoEnSede().diaIso;
      const manana = (hoyIso % 7) + 1;
      await config.fijar('autoagendamiento_ventana_dias',
        [1, 2, 3, 4, 5, 6, 7].map((d) => `${d}:${manana}-${manana}`).join(','));

      await expect(citas.cupos({ servicioId: 'mg', fecha: iso(dentro()) } as never, auto()))
        .rejects.toThrow(/puedes agendar del/i);
    });

    /*
     * Mata: quitar el `if (!opciones?.autoservicio)`. La clínica dejaría de gobernar su
     * propia agenda, que es exactamente lo que estas reglas NO deben tocar.
     */
    it('el mostrador agenda cualquier día, con la ventana encendida', async () => {
      const hoyIso = momentoEnSede().diaIso;
      const manana = (hoyIso % 7) + 1;
      await config.fijar('autoagendamiento_ventana_dias',
        [1, 2, 3, 4, 5, 6, 7].map((d) => `${d}:${manana}-${manana}`).join(','));

      const cupos = await citas.cupos({ servicioId: 'mg', fecha: iso(dentro()) } as never);
      expect(cupos.length).toBeGreaterThan(0);
    });

    /* Mata: ignorar la clave del interruptor — no habría forma de desactivar la regla. */
    it('con el interruptor apagado vuelve el comportamiento de siempre', async () => {
      await config.fijar('autoagendamiento_ventana_activa', 'false');
      await config.fijar('autoagendamiento_ventana_dias', '1:1-1,2:1-1,3:1-1,4:1-1,5:1-1,6:1-1,7:1-1');

      const cupos = await citas.cupos({ servicioId: 'mg', fecha: iso(dentro()) } as never, auto());
      expect(cupos.length).toBeGreaterThan(0);
    });

    /*
     * Mata: aplicar la exclusión solo a los bordes de la ventana. La clínica sí atiende
     * los sábados; lo que quiere es reservarlos para el mostrador.
     */
    it('un día excluido no se ofrece aunque la ventana lo incluya', async () => {
      const f = dentro();
      const diaDeEsaFecha = ((f.getUTCDay() + 6) % 7) + 1;
      await config.fijar('autoagendamiento_dias_excluidos', String(diaDeEsaFecha));

      await expect(citas.cupos({ servicioId: 'mg', fecha: iso(f) } as never, auto()))
        .rejects.toThrow(/agendar/i);
      // …y el mostrador sí.
      expect((await citas.cupos({ servicioId: 'mg', fecha: iso(f) } as never)).length).toBeGreaterThan(0);
    });
  });

  describe('la franja horaria de la cita', () => {
    /*
     * Mata: filtrar después de `intercalarPorPrestador`, o sea después del `limite`:
     * devolvería tres cupos donde había diez. Se compara contra la lista del mostrador.
     */
    it('solo se ofrecen los cupos de la franja, y son exactamente los que quedan', async () => {
      await config.fijar('autoagendamiento_horario_cita', '12:00-18:00');
      const f = iso(dentro());

      // Con el prestador fijado: sin él, `cupos()` agrega todo el catálogo de medicina
      // general y el límite se llena con mañanas de otros médicos.
      const todos = await citas.cupos({ servicioId: 'mg', fecha: f, prestadorId: PRESTADOR, limite: 50 } as never);
      const propios = await citas.cupos({ servicioId: 'mg', fecha: f, prestadorId: PRESTADOR, limite: 50 } as never, auto());

      expect(propios.map((c) => c.hora).sort())
        .toEqual(todos.filter((c) => c.hora >= '12:00').map((c) => c.hora).sort());
      expect(propios.length).toBeGreaterThan(0);
      expect(propios.length).toBeLessThan(todos.length);
    });

    /*
     * Mata: filtrar solo en `cupos()`. El bot o un cliente manipulado mandarían la hora
     * directamente a `crear()` y se saltarían la regla entera.
     */
    it('crear rechaza una hora fuera de la franja aunque venga en la petición', async () => {
      await config.fijar('autoagendamiento_horario_cita', '12:00-18:00');
      const f = iso(dentro());

      await expect(crear(f, '09:00', auto())).rejects.toThrow(/se agenda de 12:00 a 18:00/i);
      // El mostrador sí la pone.
      await expect(crear(f, '09:00')).resolves.toBeDefined();
    });
  });

  describe('el reloj del canal', () => {
    /* Mata: evaluar el reloj solo en `crear()` — el paciente vería horarios y se
       estrellaría al confirmar. */
    it('con el canal cerrado, consultar y crear se rechazan diciendo el horario', async () => {
      // Una franja de un minuto que ya pasó hoy, calculada del reloj real de la sede.
      const ahora = momentoEnSede().minutos;
      const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const cerrada = ahora >= 120 ? `${hh(ahora - 120)}-${hh(ahora - 60)}` : `${hh(ahora + 60)}-${hh(ahora + 120)}`;
      await config.fijar('autoagendamiento_horario_canal', cerrada);
      const f = iso(dentro());

      await expect(citas.cupos({ servicioId: 'mg', fecha: f } as never, auto()))
        .rejects.toThrow(/agendamiento en línea está disponible/i);
      await expect(crear(f, '09:00', auto())).rejects.toThrow(/agendamiento en línea/i);

      // Y el mostrador sigue trabajando con el canal cerrado.
      expect((await citas.cupos({ servicioId: 'mg', fecha: f } as never)).length).toBeGreaterThan(0);
    });
  });

  /**
   * Lo que el cliente pidió con todas las letras: «esto solo aplica para la creación de
   * citas nuevas, las cancelaciones y modificaciones siempre estarán activas».
   */
  describe('reprogramar y cancelar nunca se bloquean', () => {
    /*
     * Mata: poner cualquiera de las tres guardas dentro de `validarCupo()`, que es el que
     * comparten `crear` y `reprogramar`. Hoy nadie llama a reprogramar con `autoservicio`,
     * y justo por eso hay que fijar la frontera ANTES de que alguien cablee el botón.
     */
    it('reprogramar funciona con la ventana cerrada, el canal cerrado y fuera de franja', async () => {
      const f = iso(dentro());
      const cita = await crear(f, '09:00');

      await config.fijar('autoagendamiento_ventana_dias', '1:1-1,2:2-2,3:3-3,4:4-4,5:5-5,6:6-6,7:7-7');
      await config.fijar('autoagendamiento_horario_cita', '12:00-18:00');
      await config.fijar('autoagendamiento_horario_canal', '00:00-00:01');

      await expect(
        citas.reprogramar(cita.id, { fecha: f, hora: '09:15' } as never, 'sistema', auto() as never),
      ).resolves.toBeDefined();
    });

    /* Mata: añadir la guarda del reloj a `cancelar`, que ni siquiera recibe opciones. */
    it('cancelar funciona con el canal cerrado', async () => {
      const cita = await crear(iso(dentro()), '09:00');
      await config.fijar('autoagendamiento_horario_canal', '00:00-00:01');

      await expect(citas.cancelar(cita.id, { motivo: 'prueba' } as never, 'sistema')).resolves.toBeDefined();
    });
  });

  describe('lo que se publica coincide con lo que el motor acepta', () => {
    /*
     * Mata: calcular la ventana en dos sitios. El portal ofrecería fechas que el motor
     * rechaza, que es el peor resultado posible: el paciente elige y se estrella.
     */
    it('todas las fechas publicadas son agendables, y ninguna de fuera lo es', async () => {
      await config.fijar('autoagendamiento_ventana_dias', '1:3-5,2:4-5,3:1-5,4:1-5,5:2-5,6:2-5,7:3-5');
      const ventana = await citas.ventanaDeAutoservicio();
      expect(ventana).not.toBeNull();
      expect(ventana!.fechas.length).toBeGreaterThan(0);

      for (const fecha of ventana!.fechas) {
        await expect(citas.cupos({ servicioId: 'mg', fecha } as never, auto())).resolves.toBeDefined();
      }
      // Y el día anterior al primero, no.
      const antes = new Date(new Date(`${ventana!.fechas[0]}T00:00:00Z`).getTime() - 86_400_000);
      await expect(citas.cupos({ servicioId: 'mg', fecha: iso(antes) } as never, auto())).rejects.toThrow();
    });

    /* Mata: devolver la ventana aunque la regla esté apagada — el bot anunciaría un
       límite que no existe. */
    it('con la regla apagada no se publica ninguna ventana', async () => {
      await config.fijar('autoagendamiento_ventana_activa', 'false');
      expect(await citas.ventanaDeAutoservicio()).toBeNull();
    });
  });

  describe('la configuración se valida al guardarla', () => {
    /*
     * Mata: quitar los validadores. La pantalla de Reglas pinta todas las claves como
     * texto libre, así que sin esto cualquiera guarda basura en un parámetro que gobierna
     * un canal público y el motor cae en silencio a la tabla base.
     */
    it('una tabla mal escrita se rechaza al guardar, no se traga', async () => {
      const login = await request(http).post('/api/auth/login')
        .send({ email: 'admin@provivir.local', password: 'Provivir2026!' }).expect(200);
      const t = login.body.accessToken;

      await request(http).put('/api/configuracion/autoagendamiento_ventana_dias')
        .set('Authorization', `Bearer ${t}`).send({ valor: 'basura' }).expect(400);
      await request(http).put('/api/configuracion/autoagendamiento_horario_cita')
        .set('Authorization', `Bearer ${t}`).send({ valor: '18:00-09:00' }).expect(400);
      await request(http).put('/api/configuracion/autoagendamiento_ventana_activa')
        .set('Authorization', `Bearer ${t}`).send({ valor: 'True' }).expect(400);

      await request(http).put('/api/configuracion/autoagendamiento_horario_cita')
        .set('Authorization', `Bearer ${t}`).send({ valor: '12:00-18:00' }).expect(200);
    });
  });
});
