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

  /** Una cita de hoy SIN llegada registrada, para probar el mostrador de verdad. */
  async function porLlegar(servicioId: 'mg' | 'ctrl') {
    return prisma.cita.create({
      data: {
        codigo: `L${String(++contador).padStart(4, '0')}`,
        pacienteId, prestadorId: 'ao', servicioId,
        tipo: servicioId === 'ctrl' ? 'control' : 'general',
        fecha: hoyEnSede(), horaInicio: 600 + contador, duracionMin: 15,
        estado: 'confirmada', origen: 'mostrador', sedeId: SEDE_ID,
      },
    });
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

  /**
   * RN-07.6 · La constancia del cobro.
   *
   * Antes de esto, `registrarLlegada` escribía SIEMPRE en auditoría la cadena fija
   * «Mostrador · pago en recepción», hubiera pagado el paciente o no. El sistema
   * afirmaba un hecho sobre dinero que nunca había comprobado.
   */
  describe('constancia del cobro', () => {
    const llegada = (cuerpo: object) => request(http).post('/api/turnos/llegada')
      .set('Authorization', `Bearer ${tokenAsistente}`).send(cuerpo);

    let tokenAsistente: string;
    beforeAll(async () => { tokenAsistente = await token('asistente@provivir.local'); });

    it('sin decir qué pasó con el cobro, no se registra la llegada', async () => {
      const cita = await porLlegar('mg');
      const r = await llegada({ codigo: cita.codigo }).expect(400);

      /*
       * Y lo rechaza la VALIDACIÓN del DTO, no la regla de la nota. Sin esta
       * comprobación la prueba pasaba igual con el campo puesto como opcional: un
       * `cobro` ausente contradice la política de cualquier servicio de pago, así que
       * caía en el 400 de la nota y parecía correcto. `class-validator` devuelve una
       * lista de mensajes; las reglas del servicio, una cadena.
       */
      expect(Array.isArray(r.body.message)).toBe(true);
      expect(JSON.stringify(r.body.message)).toMatch(/cobro/);
    });

    it('cobrar un servicio de pago es el camino normal: sin nota', async () => {
      const cita = await porLlegar('mg');
      const r = await llegada({ codigo: cita.codigo, cobro: 'cobrado' }).expect(201);

      const turno = await prisma.turno.findUniqueOrThrow({ where: { id: r.body.id } });
      const asistente = await prisma.usuario.findUniqueOrThrow({ where: { email: 'asistente@provivir.local' } });
      expect(turno.cobro).toBe('cobrado');
      expect(turno.cobradoPor).toBe(asistente.id);
      expect(turno.cobroTs).not.toBeNull();
      expect(turno.cobroNota).toBeNull();
    });

    it('no cobrar un servicio de pago exige explicarlo', async () => {
      const cita = await porLlegar('mg');
      const r = await llegada({ codigo: cita.codigo, cobro: 'exento' }).expect(400);
      expect(r.body.message).toMatch(/RN-07\.6/);
    });

    it('con la explicación sí se registra, y queda guardada', async () => {
      const cita = await porLlegar('mg');
      const r = await llegada({
        codigo: cita.codigo, cobro: 'exento', cobroNota: 'Ya pagó el 04/09, cita movida',
      }).expect(201);

      const turno = await prisma.turno.findUniqueOrThrow({ where: { id: r.body.id } });
      expect(turno.cobro).toBe('exento');
      expect(turno.cobroNota).toBe('Ya pagó el 04/09, cita movida');
    });

    /** La política ya es la razón: pedir nota aquí sería burocracia. */
    it('no cobrar un control no exige nada: no tiene costo', async () => {
      const cita = await porLlegar('ctrl');
      const r = await llegada({ codigo: cita.codigo, cobro: 'exento' }).expect(201);
      expect((await prisma.turno.findUniqueOrThrow({ where: { id: r.body.id } })).cobro).toBe('exento');
    });

    /** La anomalía inversa, la que es fácil olvidar. */
    it('cobrar un control SÍ exige explicarlo', async () => {
      const cita = await porLlegar('ctrl');
      await llegada({ codigo: cita.codigo, cobro: 'cobrado' }).expect(400);
      await llegada({ codigo: cita.codigo, cobro: 'cobrado', cobroNota: 'Cobró por error de caja' }).expect(201);
    });

    /** Si falta la nota no puede quedar ni el turno creado ni la cita en `llego`. */
    it('cuando falta la explicación no queda nada a medias', async () => {
      const cita = await porLlegar('mg');
      await llegada({ codigo: cita.codigo, cobro: 'exento' }).expect(400);

      expect(await prisma.turno.findUnique({ where: { citaId: cita.id } })).toBeNull();
      expect((await prisma.cita.findUniqueOrThrow({ where: { id: cita.id } })).estado).toBe('confirmada');
    });

    it('la auditoría dice lo que pasó y ya no afirma que se pagó', async () => {
      const cita = await porLlegar('mg');
      await llegada({
        codigo: cita.codigo, cobro: 'exento', cobroNota: 'Convenio empresarial',
      }).expect(201);

      const registros = await prisma.auditoria.findMany({
        where: { entidad: `cita/${cita.codigo}` }, orderBy: { ts: 'desc' },
      });
      const llegadaReg = registros.find((r) => r.accion === 'Registro de llegada');
      expect(llegadaReg?.detalle).toMatch(/no se cobró/);
      // La cadena que mentía en toda llegada.
      expect(llegadaReg?.detalle).not.toMatch(/pago en recepción/);

      // Entrada aparte, para poder consultarla por acción en vez de buscar en el texto.
      const excepcion = registros.find((r) => r.accion === 'Excepción de cobro');
      expect(excepcion?.detalle).toBe('Convenio empresarial');
      expect(excepcion?.estadoPrev).toBe('costo_pleno');
      expect(excepcion?.estadoNext).toBe('exento');
    });

    it('lo normal no genera entrada de excepción', async () => {
      const cita = await porLlegar('mg');
      await llegada({ codigo: cita.codigo, cobro: 'cobrado' }).expect(201);

      const excepciones = await prisma.auditoria.count({
        where: { entidad: `cita/${cita.codigo}`, accion: 'Excepción de cobro' },
      });
      expect(excepciones).toBe(0);
    });

    /** El cobro no participa en el orden de la cola, y no debe empezar. */
    it('el cobro no altera el orden de la cola', async () => {
      const a = await porLlegar('mg');
      const b = await porLlegar('mg');
      await llegada({ codigo: a.codigo, cobro: 'cobrado' }).expect(201);
      await llegada({ codigo: b.codigo, cobro: 'exento', cobroNota: 'Cortesía autorizada' }).expect(201);

      const cola = await turnos.cola('ao');
      const codigos = cola.map((t) => t.cita.codigo);
      expect(codigos.indexOf(a.codigo)).toBeLessThan(codigos.indexOf(b.codigo));
    });
  });

  /**
   * El defecto que la fase 13 dejó a medias.
   *
   * Al reprogramar, la cita vuelve a `confirmada` y su turno queda `cancelado`. Pero
   * `registrarLlegada` rechazaba si existía CUALQUIER turno, mirara o no su estado:
   * al paciente al que le mueven la cita no se le podía registrar la llegada nunca.
   * La prueba de la fase 13 comprobaba solo la mitad que sí se arregló —el estado de
   * la cita— y por eso pasó inadvertido.
   */
  describe('volver a registrar tras una reprogramación', () => {
    it('la llegada del día nuevo se puede registrar', async () => {
      const cita = await porLlegar('mg');
      const t = await token('asistente@provivir.local');
      const llegada = (cuerpo: object) => request(http).post('/api/turnos/llegada')
        .set('Authorization', `Bearer ${t}`).send(cuerpo);

      const primera = await llegada({ codigo: cita.codigo, cobro: 'cobrado' }).expect(201);

      /*
       * Se le llamó y se le movió la cita estando ya en sala: `cerrarTurnoAbierto`
       * cancela también desde `llamado`, así que un turno cancelado puede arrastrar
       * su `llamadoTs`. Es lo que hace que limpiarlo importe.
       */
      await prisma.turno.update({
        where: { id: primera.body.id },
        data: { estado: 'cancelado', llamadoTs: new Date() },
      });
      await prisma.cita.update({ where: { id: cita.id }, data: { estado: 'confirmada' } });

      const segunda = await llegada({
        codigo: cita.codigo, cobro: 'exento', cobroNota: 'Ya pagó en la cita anterior',
      }).expect(201);

      // Se reutiliza la fila: `citaId` es único y no puede haber dos.
      expect(segunda.body.id).toBe(primera.body.id);

      const turno = await prisma.turno.findUniqueOrThrow({ where: { id: primera.body.id } });
      expect(turno.estado).toBe('en_espera');
      expect(turno.cobro).toBe('exento');
      // Sin limpiar esto, seguiría saliendo en las pantallas de sala.
      expect(turno.llamadoTs).toBeNull();
    });

    /**
     * Registrar dos veces sigue sin poder hacerse, pero lo frena la CITA, no el turno:
     * tras la primera queda en `llego` y el buscador solo mira
     * `pendiente_llegada|confirmada`, así que ni la encuentra. La guarda del turno es
     * la segunda línea, para un estado incoherente. Conviene saber cuál actúa: si
     * mañana alguien relaja el filtro de la cita, esta prueba sigue en verde y la de
     * abajo es la que avisa.
     */
    it('registrar dos veces sigue sin poder hacerse', async () => {
      const cita = await porLlegar('mg');
      const t = await token('asistente@provivir.local');
      const llegada = () => request(http).post('/api/turnos/llegada')
        .set('Authorization', `Bearer ${t}`).send({ codigo: cita.codigo, cobro: 'cobrado' });

      await llegada().expect(201);
      await llegada().expect(404);
    });

    it('y con la cita forzada a `confirmada`, la guarda del turno lo impide igual', async () => {
      const cita = await porLlegar('mg');
      const t = await token('asistente@provivir.local');
      const llegada = () => request(http).post('/api/turnos/llegada')
        .set('Authorization', `Bearer ${t}`).send({ codigo: cita.codigo, cobro: 'cobrado' });

      await llegada().expect(201);
      // Estado incoherente: turno vivo con la cita sin registrar. No debería ocurrir,
      // y si ocurre no puede acabar en dos llegadas.
      await prisma.cita.update({ where: { id: cita.id }, data: { estado: 'confirmada' } });

      const r = await llegada().expect(400);
      expect(r.body.message).toMatch(/ya fue registrada/);
    });
  });
});
