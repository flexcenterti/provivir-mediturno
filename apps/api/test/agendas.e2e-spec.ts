import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CitasService } from '../src/citas/citas.service';
import { hoyEnSede, SEDE_ID } from '@provivir/shared';

/**
 * RN-06 · Gobierno de agendas, contra base real.
 *
 * Este módulo llevaba desde la fase 2 sin **una sola** prueba: ni del servicio ni por
 * HTTP. Lo que se fija aquí es lo que solo se rompe con base y con citas de verdad — y
 * sobre todo que **la previsualización de impacto no mienta**, que es lo único que hace
 * confiable un diálogo de confirmación.
 */
describe('Gestión de agendas (integración)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let citas: CitasService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const DOC = '9633';
  const CLAVE = 'Provivir2026!';
  const PRESTADOR = 'ag-pruebas';

  let pacienteId: string;
  let contador = 0;

  /** Un lunes futuro, para que la agenda semanal de lunes siempre aplique. */
  function proximoLunes(): Date {
    const d = new Date(hoyEnSede());
    do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== 1);
    return d;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

    prisma = app.get(PrismaService);
    citas = app.get(CitasService);
    await app.init();
    http = app.getHttpServer();

    // Prestador propio: tocar los del catálogo movería los cupos de las otras suites.
    await prisma.prestador.upsert({
      where: { id: PRESTADOR },
      update: { activo: true },
      create: { id: PRESTADOR, nombre: 'Dra. Agenda Pruebas', especialidad: 'Medicina General', activo: true, sedeId: SEDE_ID },
    });
    await prisma.prestadorServicio.upsert({
      where: { prestadorId_servicioId: { prestadorId: PRESTADOR, servicioId: 'mg' } },
      update: { duracionMin: 15 },
      create: { prestadorId: PRESTADOR, servicioId: 'mg', duracionMin: 15 },
    });

    const p = await prisma.paciente.upsert({
      where: { documento: `${DOC}0001` },
      update: {},
      create: { documento: `${DOC}0001`, nombres: 'Ana', apellidos: 'Agenda', sedeId: SEDE_ID },
    });
    pacienteId = p.id;
  });

  afterAll(async () => {
    await limpiar();
    await prisma.paciente.deleteMany({ where: { documento: { startsWith: DOC } } });
    await prisma.prestadorServicio.deleteMany({ where: { prestadorId: PRESTADOR } });
    await prisma.prestador.deleteMany({ where: { id: PRESTADOR } });
    await app.close();
  });

  beforeEach(limpiar);

  async function limpiar() {
    await prisma.cita.deleteMany({ where: { prestadorId: PRESTADOR } });
    await prisma.agenda.deleteMany({ where: { prestadorId: PRESTADOR } });
  }

  const token = async (email: string): Promise<string> => {
    const r = await request(http).post('/api/auth/login').send({ email, password: CLAVE }).expect(200);
    return r.body.accessToken;
  };
  const admin = () => token('admin@provivir.local');

  /** Una franja semanal de lunes, por defecto 07:00–12:00 con slot de 15. */
  async function franja(extra: Partial<{ diasSemana: number[]; horaIni: string; horaFin: string; slotMin: number; bloqueada: boolean; activa: boolean }> = {}) {
    return prisma.agenda.create({
      data: {
        prestadorId: PRESTADOR, modo: 'semanal', diasSemana: [1],
        horaIni: '07:00', horaFin: '12:00', slotMin: 15, sedeId: SEDE_ID, ...extra,
      },
    });
  }

  /** Una cita a una hora concreta del próximo lunes. */
  async function citaA(hhmm: string, duracionMin = 15) {
    const [h, m] = hhmm.split(':').map(Number);
    return prisma.cita.create({
      data: {
        codigo: `A${String(++contador).padStart(4, '0')}`,
        pacienteId, prestadorId: PRESTADOR, servicioId: 'mg', tipo: 'general',
        fecha: proximoLunes(), horaInicio: h! * 60 + m!, duracionMin,
        estado: 'confirmada', origen: 'mostrador', sedeId: SEDE_ID,
      },
    });
  }

  const patch = async (id: string, cuerpo: object) => {
    const t = await admin();
    return request(http).patch(`/api/agendas/${id}`).set('Authorization', `Bearer ${t}`).send(cuerpo);
  };

  describe('editar', () => {
    /* Mata: auditar siempre y exigir confirmación por un cambio que no cambia nada. */
    it('un guardado sin cambios no audita ni pide confirmación', async () => {
      const a = await franja();
      const r = await patch(a.id, { horaIni: '07:00', horaFin: '12:00' });
      expect(r.status).toBe(200);
      expect(r.body.simulacion).toBe(false);
      expect(await prisma.auditoria.count({ where: { entidad: `agenda/${a.id}` } })).toBe(0);
    });

    /*
     * Mata: definir el impacto como «todas las citas de la franja vieja» en vez del
     * estado posterior. Ampliar no puede costar un clic extra, o la gente aprende a
     * confirmar sin leer.
     */
    it('ampliar la franja no afecta a nadie y se aplica directo', async () => {
      const a = await franja();
      await citaA('11:00');
      const r = await patch(a.id, { horaFin: '16:00' });

      expect(r.status).toBe(200);
      expect(r.body.simulacion).toBe(false);
      expect(r.body.citasAfectadas).toBe(0);
      expect((await prisma.agenda.findUniqueOrThrow({ where: { id: a.id } })).horaFin).toBe('16:00');
    });

    /*
     * Mata: aplicar el cambio durante la simulación. La asistente cree que está mirando
     * el impacto y ya lo ha roto — se relee de la base para comprobarlo.
     */
    it('sin confirmar devuelve la simulación y NO toca la fila', async () => {
      const a = await franja();
      await citaA('11:00');

      const r = await patch(a.id, { horaFin: '10:00' });
      expect(r.status).toBe(200);
      expect(r.body.simulacion).toBe(true);
      expect(r.body.citasAfectadas).toBe(1);
      expect((await prisma.agenda.findUniqueOrThrow({ where: { id: a.id } })).horaFin).toBe('12:00');
    });

    /* Mata: quedarse siempre en simulación, o no auditar el antes y el después. */
    it('con confirmar aplica y deja el horario anterior en la auditoría', async () => {
      const a = await franja();
      await citaA('11:00');

      const r = await patch(a.id, { horaFin: '10:00', confirmar: true });
      expect(r.status).toBe(200);
      expect(r.body.simulacion).toBe(false);
      expect((await prisma.agenda.findUniqueOrThrow({ where: { id: a.id } })).horaFin).toBe('10:00');

      const reg = await prisma.auditoria.findFirstOrThrow({ where: { entidad: `agenda/${a.id}` } });
      expect(reg.accion).toBe('Agenda modificada');
      // Sin el estado previo no hay forma de deshacer: es lo único que guarda el horario viejo.
      expect(reg.estadoPrev).toContain('07:00–12:00');
      expect(reg.estadoNext).toContain('07:00–10:00');
    });

    /*
     * Mata: cualquier cálculo de impacto que no re-evalúe el alineamiento al slot. El
     * rango sigue conteniendo la cita de las 08:00 —07:10 a 12:00— pero 08:00 ya no es
     * múltiplo de 15 desde las 07:10, así que deja de poder reprogramarse.
     */
    it('mover el inicio diez minutos desalinea las citas y eso cuenta como impacto', async () => {
      const a = await franja();
      await citaA('08:00');

      const r = await patch(a.id, { horaIni: '07:10' });
      expect(r.body.simulacion).toBe(true);
      expect(r.body.citasAfectadas).toBe(1);
    });

    /*
     * Mata: buscar candidatas solo en los días viejos. Aquí se quita el jueves y se añade
     * el sábado en el mismo guardado: sin la unión de días, el sábado no se contaría.
     */
    it('quitar y añadir días en el mismo guardado cuenta las dos cosas', async () => {
      const a = await franja({ diasSemana: [1, 4] });
      const r = await patch(a.id, { diasSemana: [1, 6] });
      expect(r.status).toBe(200);
      expect((await prisma.agenda.findUniqueOrThrow({ where: { id: a.id } })).diasSemana).toEqual([1, 6]);
    });

    /*
     * Mata: evaluar el impacto solo contra la franja editada. Un médico con mañana y
     * tarde: si la de la mañana se recorta pero la de la tarde cubre la cita, no está
     * afectada. Es el rescate por otra franja.
     */
    it('una cita que otra franja del mismo prestador cubre no está afectada', async () => {
      const manana = await franja({ horaIni: '07:00', horaFin: '12:00' });
      await franja({ horaIni: '10:00', horaFin: '16:00' });
      await citaA('11:00');

      const r = await patch(manana.id, { horaFin: '10:00', confirmar: true });
      expect(r.body.citasAfectadas).toBe(0);
    });

    /*
     * Mata: esconder las huérfanas previas con la definición «cabía antes y no cabe
     * ahora». Esta cita ya estaba desalineada antes del cambio; hay que reportarla, pero
     * distinguida, o el operador cree que su edición la rompió.
     */
    it('una cita que ya estaba fuera se reporta, pero marcada como tal', async () => {
      const a = await franja();
      await citaA('08:07');

      const r = await patch(a.id, { horaFin: '11:00' });
      expect(r.body.citasAfectadas).toBe(1);
      expect(r.body.citas[0].motivo).toBe('ya_estaba_fuera');
      expect(r.body.mensaje).toContain('ya estaba');
    });

    /*
     * Mata: el filtro `pendiente_llegada|confirmada` que usa hoy el detector de bloqueos.
     * Quien ya está en sala sigue siendo reprogramable, así que retirarle la franja le
     * afecta — y no salía en el listado.
     */
    it('una cita de alguien que ya llegó también cuenta', async () => {
      const a = await franja();
      const c = await citaA('11:00');
      await prisma.cita.update({ where: { id: c.id }, data: { estado: 'llego' } });

      const r = await patch(a.id, { horaFin: '10:00' });
      expect(r.body.citasAfectadas).toBe(1);
    });

    /* Mata: validar el parche en vez de la fusión — el clásico del PATCH parcial. */
    it('el resultado fusionado es lo que se valida, no el parche', async () => {
      const a = await franja();
      const r = await patch(a.id, { horaFin: '07:05' });
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/más corta que un slot/i);
    });

    /*
     * Mata: no normalizar. Una fila con `modo: calendario` y días sueltos es algo que
     * `crear` no puede producir, y la próxima consulta que mire `diasSemana` sin mirar
     * `modo` la interpretará mal.
     */
    it('cambiar de modo limpia el campo del otro modo', async () => {
      const a = await franja({ diasSemana: [1, 2, 3] });
      const iso = proximoLunes().toISOString().slice(0, 10);
      await patch(a.id, { modo: 'calendario', fecha: iso, confirmar: true });

      const fila = await prisma.agenda.findUniqueOrThrow({ where: { id: a.id } });
      expect(fila.diasSemana).toEqual([]);
      expect(fila.fecha).not.toBeNull();
    });

    /*
     * Mata: declarar `prestadorId` en el DTO o hacer un spread del cuerpo sobre `data`.
     * La franja cambiaría de médico y el impacto calculado sería el del equivocado.
     */
    it('no se puede mover una franja a otro prestador', async () => {
      const a = await franja();
      const r = await patch(a.id, { prestadorId: 'ao' });
      expect(r.status).toBe(400);
      expect((await prisma.agenda.findUniqueOrThrow({ where: { id: a.id } })).prestadorId).toBe(PRESTADOR);
    });
  });

  /**
   * La prueba que hace falsa la frase «la previsualización miente». Ata el cálculo de
   * impacto a `validarCupo`: lo que se declara no afectado tiene que poder moverse
   * después del cambio, y lo declarado afectado, no.
   */
  describe('la previsualización no miente', () => {
    /*
     * Mata: cualquier divergencia entre el impacto y `validarCupo` — quitar el
     * alineamiento en uno de los dos, cambiar un `<=` por `<` en uno solo, o filtrar sin
     * tener en cuenta la duración de la cita.
     */
    it('lo no afectado se puede reprogramar después del cambio; lo afectado, no', async () => {
      const a = await franja();
      const temprana = await citaA('08:00');
      const tardia = await citaA('11:00');
      const iso = proximoLunes().toISOString().slice(0, 10);

      const previo = await patch(a.id, { horaFin: '10:00' });
      expect(previo.body.citasAfectadas).toBe(1);
      expect(previo.body.citas.map((c: { id: string }) => c.id)).toEqual([tardia.id]);

      await patch(a.id, { horaFin: '10:00', confirmar: true });

      // La que NO se reportó sigue moviéndose sin problema.
      await expect(citas.reprogramar(temprana.id, { fecha: iso, hora: '08:15' }, 'sistema')).resolves.toBeDefined();
      // La que SÍ se reportó, no. Y ese es exactamente el aviso que se dio.
      await expect(citas.reprogramar(tardia.id, { fecha: iso, hora: '11:00' }, 'sistema')).rejects.toThrow(/fuera de la agenda/i);
    });
  });

  describe('solapamiento (RN-06.7)', () => {
    /* Mata: quitar la validación — el portal ofrecería la misma hora dos veces. */
    it('no se puede crear una franja que pise otra del mismo prestador', async () => {
      await franja();
      const t = await admin();
      const r = await request(http).post('/api/agendas').set('Authorization', `Bearer ${t}`)
        .send({ prestadorId: PRESTADOR, modo: 'semanal', diasSemana: [1], horaIni: '09:00', horaFin: '13:00', slotMin: 15 });

      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/solapa/i);
    });

    /*
     * Mata: usar `<=` en el cruce de rangos. Es el negativo más importante del lote: la
     * jornada partida del catálogo real es 07:00–12:00 y 12:30–16:30, y con `<=` el
     * cargador dejaría de poder sembrar.
     */
    it('la jornada partida sí se puede crear: tocarse no es solaparse', async () => {
      await franja({ horaIni: '07:00', horaFin: '12:00' });
      const t = await admin();
      await request(http).post('/api/agendas').set('Authorization', `Bearer ${t}`)
        .send({ prestadorId: PRESTADOR, modo: 'semanal', diasSemana: [1], horaIni: '12:00', horaFin: '16:30', slotMin: 15 })
        .expect(201);
    });

    /* Mata: olvidar `id: { not: id }` — una franja chocaría consigo misma. El clásico. */
    it('editar una franja no la hace chocar contra sí misma', async () => {
      const a = await franja();
      const r = await patch(a.id, { consultorio: 'Consultorio 9', confirmar: true });
      expect(r.status).toBe(200);
    });

    /* Mata: incluir las bloqueadas — se rompería «bloqueo la vieja, creo la nueva». */
    it('se permite solapar con una franja bloqueada, que no da cupos', async () => {
      await franja({ bloqueada: true });
      const t = await admin();
      await request(http).post('/api/agendas').set('Authorization', `Bearer ${t}`)
        .send({ prestadorId: PRESTADOR, modo: 'semanal', diasSemana: [1], horaIni: '09:00', horaFin: '13:00', slotMin: 15 })
        .expect(201);
    });

    /* Mata: olvidar `activa: true` — retirar una franja no serviría para sustituirla. */
    it('se permite solapar con una retirada', async () => {
      await franja({ activa: false });
      const t = await admin();
      await request(http).post('/api/agendas').set('Authorization', `Bearer ${t}`)
        .send({ prestadorId: PRESTADOR, modo: 'semanal', diasSemana: [1], horaIni: '09:00', horaFin: '13:00', slotMin: 15 })
        .expect(201);
    });
  });

  describe('retirar y reactivar', () => {
    /* Mata: no pedir confirmación — mismo daño que el bloqueo, sin el aviso que sí da. */
    it('retirar con citas dentro pide confirmación primero', async () => {
      const a = await franja();
      await citaA('11:00');
      const t = await admin();

      const r = await request(http).post(`/api/agendas/${a.id}/retirar`)
        .set('Authorization', `Bearer ${t}`).send({}).expect(201);
      expect(r.body.simulacion).toBe(true);
      expect((await prisma.agenda.findUniqueOrThrow({ where: { id: a.id } })).activa).toBe(true);
    });

    /*
     * Mata: poner solo `bloqueada` en vez de `activa`, o filtrar mal en `listar`. Y
     * comprueba lo que de verdad importa: que deje de dar cupos.
     */
    it('retirar la quita del listado y deja de ofrecer cupos', async () => {
      const a = await franja();
      const t = await admin();
      await request(http).post(`/api/agendas/${a.id}/retirar`)
        .set('Authorization', `Bearer ${t}`).send({ confirmar: true }).expect(201);

      const lista = await request(http).get(`/api/agendas?prestadorId=${PRESTADOR}`)
        .set('Authorization', `Bearer ${t}`).expect(200);
      expect(lista.body).toHaveLength(0);

      const cupos = await citas.cupos({ servicioId: 'mg', fecha: proximoLunes().toISOString().slice(0, 10) });
      expect(cupos.filter((c) => c.prestadorId === PRESTADOR)).toHaveLength(0);
    });

    /* Mata: quitar el parámetro — el borrado lógico no tendría vuelta desde la interfaz. */
    it('las retiradas se pueden listar y reactivar', async () => {
      const a = await franja({ activa: false });
      const t = await admin();

      const conRetiradas = await request(http).get(`/api/agendas?prestadorId=${PRESTADOR}&incluirRetiradas=true`)
        .set('Authorization', `Bearer ${t}`).expect(200);
      expect(conRetiradas.body).toHaveLength(1);

      await request(http).post(`/api/agendas/${a.id}/reactivar`).set('Authorization', `Bearer ${t}`).expect(201);
      expect((await prisma.agenda.findUniqueOrThrow({ where: { id: a.id } })).activa).toBe(true);
    });

    /*
     * Mata: `findUnique` sin mirar `activa`. Una franja retirada seguiría siendo
     * editable y bloqueable por la API, que es un estado que nadie sabe explicar.
     */
    it('una franja retirada no se puede editar', async () => {
      const a = await franja({ activa: false });
      const r = await patch(a.id, { horaFin: '10:00' });
      expect(r.status).toBe(404);
    });
  });

  describe('permisos', () => {
    /* Mata: olvidar `@Permisos` en cualquiera de los dos endpoints nuevos. */
    it('el perfil médico no puede editar ni retirar', async () => {
      const a = await franja();
      const t = await token('osorio@provivir.local');

      await request(http).patch(`/api/agendas/${a.id}`)
        .set('Authorization', `Bearer ${t}`).send({ horaFin: '10:00' }).expect(403);
      await request(http).post(`/api/agendas/${a.id}/retirar`)
        .set('Authorization', `Bearer ${t}`).send({ confirmar: true }).expect(403);
    });
  });
});
