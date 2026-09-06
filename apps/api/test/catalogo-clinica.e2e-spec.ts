import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { SEDE_ID } from '@provivir/shared';
import { AppModule } from '../src/app.module';
import { apagarVentana, encenderVentana } from './utiles-autoagendamiento';
import { PrismaService } from '../src/prisma/prisma.service';
import { CitasService } from '../src/citas/citas.service';
import { cargarCatalogoClinica, PRESTADORES, SERVICIOS } from '../src/cli/catalogo.clinica';
import { SERVICIOS as SERVICIOS_DEMO } from '../src/cli/catalogo.demo';

/**
 * El catálogo real de la clínica, contra base de verdad.
 *
 * Es la primera vez que el sistema usa **jornada partida** —el catálogo de
 * demostración nunca tuvo un médico con mañana y tarde— y **duraciones distintas
 * sobre el mismo servicio**. Las dos cosas se comprueban aquí con los datos reales,
 * porque un error de transcripción de horarios no lo detecta ninguna otra prueba:
 * el sistema ofrecería cupos con toda naturalidad a una hora en que no hay nadie.
 */
describe('Catálogo real de la clínica (integración)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let citas: CitasService;

  // Semana futura completa. 2026-09-07 es lunes.
  const LUNES = '2026-09-07';
  const MARTES = '2026-09-08';
  const SABADO = '2026-09-12';
  const DOMINGO = '2026-09-13';

  const horas = (cupos: Array<{ hora: string }>) => cupos.map((c) => c.hora).sort();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    prisma = app.get(PrismaService);
    citas = app.get(CitasService);
    await app.init();

    /*
     * RN-04.8 · Esta suite no va de la ventana de autoagendamiento: se apaga para que sus
     * fechas fijas no dependan del día de la semana en que se ejecute. La regla tiene su
     * propia suite.
     */
    await apagarVentana(app);

    await cargarCatalogoClinica(prisma, SEDE_ID);
  });

  /*
   * El catálogo real se retira al terminar. Si se queda, sus cinco médicos generales
   * entran en el grupo de balanceo y rompen las pruebas de RN-02 del motor, que cuentan
   * con los tres de demostración. Las suites comparten base y corren en serie.
   */
  afterAll(async () => {
    await encenderVentana(app);
    const ids = PRESTADORES.map((p) => p.id);
    await prisma.cita.deleteMany({ where: { prestadorId: { in: ids } } });
    await prisma.agenda.deleteMany({ where: { prestadorId: { in: ids } } });
    await prisma.prestadorServicio.deleteMany({ where: { prestadorId: { in: ids } } });
    await prisma.prestador.deleteMany({ where: { id: { in: ids } } });
    /*
     * Siete servicios existen en los dos catálogos (mg, ctrl, gin, nut, eco, ecod, lab)
     * y el real los pisa con sus propios valores. Se borran solo los que son
     * exclusivamente suyos y se devuelven los compartidos a como los deja la demo,
     * que es lo que esperan el resto de suites.
     */
    const deDemo = new Set(SERVICIOS_DEMO.map((s) => s.id));
    await prisma.servicio.deleteMany({
      where: { id: { in: SERVICIOS.map((s) => s.id).filter((id) => !deDemo.has(id)) } },
    });
    for (const s of SERVICIOS_DEMO) {
      // `agendable` explícito: el catálogo demo no lo declara y se quedaría en false.
      await prisma.servicio.upsert({ where: { id: s.id }, update: { ...s, agendable: true }, create: s });
    }
    await app.close();
  });

  describe('jornada partida · mañana y tarde son dos franjas', () => {
    it('RN-06.4: Oscar Ortiz ofrece cupos de la mañana y de la tarde el mismo día', async () => {
      const cupos = await citas.cupos({ servicioId: 'mg', fecha: LUNES, prestadorId: 'oo', limite: 50 } as never);
      const h = horas(cupos);

      expect(h).toContain('07:00');   // primera de la mañana
      expect(h).toContain('11:45');   // última de la mañana (11:45 + 15 = 12:00)
      expect(h).toContain('13:00');   // primera de la tarde
      expect(h).toContain('16:15');   // última de la tarde (16:15 + 15 = 16:30)
    });

    it('RN-06.4: la hora del almuerzo no existe como cupo', async () => {
      const cupos = await citas.cupos({ servicioId: 'mg', fecha: LUNES, prestadorId: 'oo', limite: 50 } as never);
      // Oscar Ortiz cierra a las 12:00 y vuelve a las 13:00.
      const enElHueco = horas(cupos).filter((x) => x >= '12:00' && x < '13:00');
      expect(enElHueco).toEqual([]);
    });

    it('RN-06.4: tampoco se puede agendar a la fuerza dentro del hueco', async () => {
      const paciente = await prisma.paciente.upsert({
        where: { documento: '96000001' },
        update: {},
        create: { documento: '96000001', nombres: 'Prueba', apellidos: 'Catálogo', sedeId: SEDE_ID },
      });

      await expect(
        citas.crear(
          { pacienteId: paciente.id, servicioId: 'mg', fecha: LUNES, hora: '12:30', prestadorId: 'oo', origen: 'mostrador' } as never,
          'test-catalogo',
        ),
      ).rejects.toThrow(/fuera de la agenda/);
    });
  });

  describe('duraciones por profesional sobre el mismo servicio', () => {
    it('RN-01.4: Katherin Rodriguez atiende medicina general en 10 minutos', async () => {
      const cupos = await citas.cupos({ servicioId: 'mg', fecha: LUNES, prestadorId: 'krg', limite: 50 } as never);
      expect(cupos[0]!.duracionMin).toBe(10);
      // Su rejilla también es de 10: 07:30, 07:40, 07:50…
      expect(horas(cupos).slice(0, 3)).toEqual(['07:30', '07:40', '07:50']);
    });

    it('RN-01.4: Cesar Osorio, mismo servicio, atiende en 15', async () => {
      const cupos = await citas.cupos({ servicioId: 'mg', fecha: LUNES, prestadorId: 'co', limite: 50 } as never);
      expect(cupos[0]!.duracionMin).toBe(15);
      expect(horas(cupos).slice(0, 3)).toEqual(['06:45', '07:00', '07:15']);
    });

    it('RN-01.4: la psicóloga trabaja en sesiones de una hora', async () => {
      const cupos = await citas.cupos({ servicioId: 'psi', fecha: MARTES, prestadorId: 'sloq', limite: 50 } as never);
      expect(cupos.every((c) => c.duracionMin === 60)).toBe(true);
      expect(horas(cupos)).toEqual(['08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00']);
    });
  });

  describe('horarios que cambian según el día', () => {
    it('Odontología entra a las 08:30, salvo el martes que entra a las 09:30', async () => {
      const lunes = await citas.cupos({ servicioId: 'odo', fecha: LUNES, prestadorId: 'cam', limite: 50 } as never);
      const martes = await citas.cupos({ servicioId: 'odo', fecha: MARTES, prestadorId: 'cam', limite: 50 } as never);

      expect(horas(lunes)[0]).toBe('08:30');
      expect(horas(martes)[0]).toBe('09:30');
    });

    it('el sábado Odontología solo atiende en la mañana, hasta las 12:00', async () => {
      const cupos = await citas.cupos({ servicioId: 'odo', fecha: SABADO, prestadorId: 'cam', limite: 50 } as never);
      expect(horas(cupos)).toEqual(['08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
    });

    it('Rafael Barrios atiende martes y viernes, no los lunes', async () => {
      const martes = await citas.cupos({ servicioId: 'otr', fecha: MARTES, prestadorId: 'rebr', limite: 50 } as never);
      const lunes = await citas.cupos({ servicioId: 'otr', fecha: LUNES, prestadorId: 'rebr', limite: 50 } as never);

      expect(horas(martes)[0]).toBe('07:00');
      /*
       * Su franja cierra a las 09:40, pero los cupos van de 15 en 15 desde las 07:00:
       * el último que cabe entero arranca 09:15 y termina 09:30. Los 10 minutos que
       * sobran no dan para otra consulta, así que no se ofrecen.
       */
      expect(horas(martes).at(-1)).toBe('09:15');
      expect(lunes).toEqual([]);
    });
  });

  describe('«no atendemos domingos ni festivos»', () => {
    it('ningún profesional ofrece cupos el domingo', async () => {
      for (const [servicioId, prestadorId] of [
        ['mg', 'co'], ['mg', 'oo'], ['mg', 'ipp'], ['mg', 'jlr'], ['mg', 'krg'],
        ['mest', 'evq'], ['mint', 'hamm'], ['odo', 'cam'], ['otr', 'rebr'], ['psi', 'sloq'],
      ]) {
        const cupos = await citas.cupos({ servicioId, fecha: DOMINGO, prestadorId, limite: 5 } as never);
        expect(cupos).toEqual([]);
      }
    });
  });

  describe('RN-04.7 · servicios que solo agenda la asistente', () => {
    it('RN-04.7: el portal y el bot no pueden pedir cupos de laboratorio', async () => {
      await expect(
        citas.cupos({ servicioId: 'lab', fecha: LUNES, limite: 5 } as never, { autoservicio: true }),
      ).rejects.toThrow(/Comunícate con una asistente/);
    });

    it('RN-04.7: el control de medicina general tampoco se agenda solo', async () => {
      // Exige consulta previa (RN-01): no es algo que el paciente resuelva por su cuenta.
      await expect(
        citas.cupos({ servicioId: 'ctrl', fecha: LUNES, prestadorId: 'co', limite: 5 } as never, { autoservicio: true }),
      ).rejects.toThrow(/Comunícate con una asistente/);
    });

    it('RN-04.7: la asistente sí puede, desde el backoffice', async () => {
      // Misma llamada sin declararse autoservicio: es exactamente para eso que se marcan.
      await expect(
        citas.cupos({ servicioId: 'lab', fecha: LUNES, limite: 5 } as never),
      ).resolves.toBeDefined();
    });

    it('RN-04.7: crear una cita de un servicio marcado tampoco pasa por autoservicio', async () => {
      const paciente = await prisma.paciente.upsert({
        where: { documento: '96000002' },
        update: {},
        create: { documento: '96000002', nombres: 'Prueba', apellidos: 'Asistente', sedeId: SEDE_ID },
      });

      await expect(
        citas.crear(
          { pacienteId: paciente.id, servicioId: 'eco', fecha: LUNES, hora: '08:00', origen: 'autoagendamiento' } as never,
          'test-catalogo',
          { autoservicio: true },
        ),
      ).rejects.toThrow(/Comunícate con una asistente/);
    });

    it('RN-04.7: los servicios de consulta con jornada semanal sí se agendan solos', async () => {
      const cupos = await citas.cupos(
        { servicioId: 'mg', fecha: LUNES, prestadorId: 'co', limite: 5 } as never,
        { autoservicio: true },
      );
      expect(cupos.length).toBeGreaterThan(0);
    });

    it('RN-04.7: los especialistas por fechas existen pero aún no tienen jornada', async () => {
      // La asistente les carga las fechas cada mes; hasta entonces no hay nada que ofrecer.
      for (const id of ['ama', 'cegg', 'cqg', 'dfbh', 'dfcc', 'jats', 'lfvp', 'lmbg', 'rjd']) {
        const p = await prisma.prestador.findUnique({ where: { id }, include: { agendas: true } });
        expect(p).not.toBeNull();
        expect(p!.agendas).toEqual([]);
      }
    });
  });

  describe('lo que quedó pendiente de la clínica', () => {
    it('medicina ocupacional existe en el catálogo pero no se puede agendar', async () => {
      const servicio = await prisma.servicio.findUnique({ where: { id: 'mocu' } });
      expect(servicio?.activo).toBe(true);
      expect(servicio?.duracionMin).toBe(20);
      // RN-13.9 · el bot lo describe, pero no ofrece agendarlo.
      expect(servicio?.agendable).toBe(false);
    });

    it('nadie está habilitado en medicina ocupacional mientras no haya jornada', async () => {
      /*
       * Ingrit Perea la atiende, pero la clínica no dijo cuándo. Habilitarla haría que
       * el motor ofreciera medicina ocupacional en toda su jornada de medicina general
       * —el servicio de la agenda es informativo, no una restricción—, doce horas
       * semanales que nadie autorizó. Sin habilitación no hay candidatos y no hay oferta.
       */
      const habilitada = await prisma.prestadorServicio.findUnique({
        where: { prestadorId_servicioId: { prestadorId: 'ipp', servicioId: 'mocu' } },
      });
      expect(habilitada).toBeNull();

      const cupos = await citas.cupos({ servicioId: 'mocu', fecha: LUNES, limite: 5 } as never);
      expect(cupos).toEqual([]);
    });
  });

  /**
   * RN-01.2 · la cita de control no tiene costo.
   *
   * La primera carga no declaró la política en NINGUNO de los 21 servicios y todos
   * cayeron en el default `costo_pleno`, control incluido. No se notó durante meses
   * porque el campo no decidía nada; desde RN-07.6 el mostrador lo lee y diría que el
   * control se cobra.
   */
  describe('política de costo', () => {
    it('el control queda sin costo', async () => {
      const control = await prisma.servicio.findUniqueOrThrow({ where: { id: 'ctrl' } });
      expect(control.politicaCosto).toBe('sin_costo');
    });

    /*
     * Sobre la constante y no sobre la base: contra la base pasaría igual gracias al
     * default de Prisma, que es exactamente cómo se coló el defecto. Lo que hay que
     * proteger es que el ARCHIVO lo declare.
     */
    it('los 21 servicios declaran su política en el archivo', () => {
      expect(SERVICIOS.every((sv) => sv.politicaCosto !== undefined)).toBe(true);
      expect(SERVICIOS.filter((sv) => sv.politicaCosto === 'sin_costo').map((sv) => sv.id)).toEqual(['ctrl']);
    });
  });
});