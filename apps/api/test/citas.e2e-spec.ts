import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CitasService } from '../src/citas/citas.service';
import { fechaEnZona, SEDE_ID } from '@provivir/shared';

/**
 * Motor de agendamiento contra base real (Guía, FASE 2 — la fase crítica).
 * Las reglas puras se prueban en citas.reglas.spec.ts; aquí se verifica la
 * orquestación transaccional, la concurrencia y la integración con agendas.
 */
describe('Motor de citas (integración)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let citas: CitasService;

  const USUARIO = 'test-motor';
  const DOC = '9500';
  let pacienteId: string;
  let paciente2Id: string;

  // Un lunes futuro: las agendas semanales del seed cubren lunes a sábado.
  const LUNES = '2026-09-07';
  const MARTES = '2026-09-08';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    prisma = app.get(PrismaService);
    citas = app.get(CitasService);
    await app.init();

    const p1 = await prisma.paciente.upsert({
      where: { documento: `${DOC}0001` },
      update: {},
      create: { documento: `${DOC}0001`, nombres: 'Test', apellidos: 'Motor', sedeId: 'cdc-oriente' },
    });
    const p2 = await prisma.paciente.upsert({
      where: { documento: `${DOC}0002` },
      update: {},
      create: { documento: `${DOC}0002`, nombres: 'Test2', apellidos: 'Motor', sedeId: 'cdc-oriente' },
    });
    pacienteId = p1.id;
    paciente2Id = p2.id;
  });

  afterAll(async () => {
    await limpiar();
    await prisma.paciente.deleteMany({ where: { documento: { startsWith: DOC } } });
    await app.close();
  });

  beforeEach(limpiar);

  async function limpiar() {
    await prisma.cita.deleteMany({ where: { paciente: { documento: { startsWith: DOC } } } });
  }

  const crear = (extra: Partial<Parameters<CitasService['crear']>[0]>) =>
    citas.crear(
      { pacienteId, servicioId: 'mg', fecha: LUNES, hora: '08:00', prestadorId: 'ao', origen: 'asistente', ...extra } as never,
      USUARIO,
    );

  // ─────────────────────── Cupos ───────────────────────

  describe('consulta de cupos', () => {
    it('ofrece cupos dentro de la franja de la agenda', async () => {
      const cupos = await citas.cupos({ servicioId: 'mg', fecha: LUNES, prestadorId: 'ao', limite: 50 } as never);
      expect(cupos.length).toBeGreaterThan(0);
      expect(cupos.every((c) => c.hora >= '08:00' && c.hora < '12:00')).toBe(true);
      expect(cupos.every((c) => c.duracionMin === 15)).toBe(true);
    });

    it('RN-03: el primer cupo ofrecido es el contiguo a la última cita', async () => {
      await crear({ hora: '08:00' });
      const cupos = await citas.cupos({ servicioId: 'mg', fecha: LUNES, prestadorId: 'ao' } as never);
      expect(cupos[0]!.hora).toBe('08:15');
    });

    it('el cupo ocupado desaparece de la oferta', async () => {
      await crear({ hora: '08:30' });
      const cupos = await citas.cupos({ servicioId: 'mg', fecha: LUNES, prestadorId: 'ao', limite: 50 } as never);
      expect(cupos.some((c) => c.hora === '08:30')).toBe(false);
    });

    it('RN-04.4: el Doppler ocupa 2 cupos — la duración ofrecida es 40 min', async () => {
      const cupos = await citas.cupos({ servicioId: 'ecod', fecha: LUNES, prestadorId: 'ec' } as never);
      expect(cupos.length).toBeGreaterThan(0);
      expect(cupos.every((c) => c.duracionMin === 40)).toBe(true);
    });

    it('RN-04.1: un especialista por calendario no ofrece cupos fuera de su fecha', async () => {
      // La dermatóloga solo atiende el 2026-08-21 según el seed.
      const cupos = await citas.cupos({ servicioId: 'der', fecha: LUNES, prestadorId: 'lp' } as never);
      expect(cupos).toEqual([]);
    });

    it('la oferta intercala prestadores: no esconde la mañana libre de uno tras la carga de otro', async () => {
      // Osorio y Ríos atienden 08:00–12:00; Ortiz 14:00–18:00. Con una cita en Osorio,
      // el balanceo lo manda al final — pero sus cupos de la mañana deben seguir visibles.
      await crear({ hora: '08:00', prestadorId: 'ao' });

      const cupos = await citas.cupos({ servicioId: 'mg', fecha: LUNES, limite: 9 } as never);
      const prestadores = new Set(cupos.map((c) => c.prestadorId));

      expect(prestadores.size).toBeGreaterThan(1);
      expect(cupos.some((c) => c.hora < '12:00')).toBe(true);
      expect(cupos.some((c) => c.hora >= '14:00')).toBe(true);
    });

    it('RN-02: el primer cupo ofrecido es del prestador con menor carga', async () => {
      await crear({ hora: '08:00', prestadorId: 'ao' });
      await crear({ hora: '08:15', prestadorId: 'ao', pacienteId: paciente2Id });

      const cupos = await citas.cupos({ servicioId: 'mg', fecha: LUNES, limite: 5 } as never);
      expect(cupos[0]!.prestadorId).not.toBe('ao');
    });

    it('sin agenda ese día, no hay cupos (Ortiz no atiende sábado)', async () => {
      const sabado = '2026-09-12';
      const cupos = await citas.cupos({ servicioId: 'mg', fecha: sabado, prestadorId: 'jo' } as never);
      expect(cupos).toEqual([]);
    });
  });

  // ─────────────────────── RN-02 · Balanceo ───────────────────────

  describe('RN-06.5 · días no laborables', () => {
    // Un martes futuro cualquiera: martes hay agenda de medicina general en el seed.
    const MARTES = '2026-09-08';

    afterEach(async () => {
      await prisma.diaNoLaborable.deleteMany({ where: { motivo: { startsWith: 'Prueba' } } });
    });

    it('RN-06.5: un día cerrado no ofrece cupos por ningún canal', async () => {
      const antes = await citas.cupos({ servicioId: 'mg', fecha: MARTES, prestadorId: 'ao', limite: 5 } as never);
      expect(antes.length).toBeGreaterThan(0);

      await prisma.diaNoLaborable.create({
        data: { fecha: new Date(`${MARTES}T00:00:00Z`), motivo: 'Prueba · festivo', tipo: 'festivo', sedeId: SEDE_ID },
      });

      // Sin excepción de canal: tampoco el mostrador, que sí puede agendar hoy (RN-04.6).
      await expect(
        citas.cupos({ servicioId: 'mg', fecha: MARTES, prestadorId: 'ao', limite: 5 } as never),
      ).rejects.toThrow(/No atendemos el 2026-09-08/);
      await expect(
        citas.cupos({ servicioId: 'mg', fecha: MARTES, prestadorId: 'ao' } as never, { autoservicio: true }),
      ).rejects.toThrow(/No atendemos/);
    });

    it('RN-06.5: el motivo del cierre viaja en el mensaje', async () => {
      await prisma.diaNoLaborable.create({
        data: { fecha: new Date(`${MARTES}T00:00:00Z`), motivo: 'Prueba · Navidad', tipo: 'festivo', sedeId: SEDE_ID },
      });
      await expect(
        citas.cupos({ servicioId: 'mg', fecha: MARTES, prestadorId: 'ao' } as never),
      ).rejects.toThrow(/Prueba · Navidad/);
    });

    it('RN-06.5: tampoco se puede crear una cita en un día cerrado', async () => {
      await prisma.diaNoLaborable.create({
        data: { fecha: new Date(`${MARTES}T00:00:00Z`), motivo: 'Prueba · cierre', tipo: 'cierre', sedeId: SEDE_ID },
      });
      await expect(
        citas.crear(
          { pacienteId, servicioId: 'mg', fecha: MARTES, hora: '08:00', prestadorId: 'ao', origen: 'mostrador' } as never,
          USUARIO,
        ),
      ).rejects.toThrow(/No atendemos/);
    });

    it('RN-06.5: reabrir el día lo vuelve a poner en oferta', async () => {
      const d = await prisma.diaNoLaborable.create({
        data: { fecha: new Date(`${MARTES}T00:00:00Z`), motivo: 'Prueba · cierre', tipo: 'cierre', sedeId: SEDE_ID },
      });
      await prisma.diaNoLaborable.delete({ where: { id: d.id } });

      const cupos = await citas.cupos({ servicioId: 'mg', fecha: MARTES, prestadorId: 'ao', limite: 5 } as never);
      expect(cupos.length).toBeGreaterThan(0);
    });
  });

  describe('RN-04.6 · anticipación mínima por canal', () => {
    const HOY = fechaEnZona();
    const sumarDias = (iso: string, d: number) => {
      const f = new Date(`${iso}T00:00:00Z`);
      f.setUTCDate(f.getUTCDate() + d);
      return f.toISOString().slice(0, 10);
    };

    it('RN-04.6: el autoservicio no puede consultar cupos de hoy', async () => {
      await expect(
        citas.cupos({ servicioId: 'mg', fecha: HOY, prestadorId: 'ao', limite: 5 } as never, { autoservicio: true }),
      ).rejects.toThrow(/más próxima disponible/);
    });

    it('RN-04.6: el backoffice sí consulta cupos de hoy: la sede gobierna su propio día', async () => {
      // Misma llamada, sin declararse autoservicio. Es la excepción de canal acordada
      // con el cliente: al paciente que llega al mostrador hay que poder atenderlo.
      await expect(
        citas.cupos({ servicioId: 'mg', fecha: HOY, prestadorId: 'ao', limite: 5 } as never),
      ).resolves.toBeDefined();
    });

    it('RN-04.6: el autoservicio tampoco crea una cita para hoy', async () => {
      await expect(
        citas.crear(
          { pacienteId, servicioId: 'mg', fecha: HOY, hora: '08:00', prestadorId: 'ao', origen: 'autoagendamiento' } as never,
          USUARIO,
          { autoservicio: true },
        ),
      ).rejects.toThrow(/más próxima disponible/);
    });

    it('RN-04.6: una fecha pasada tampoco pasa por autoservicio', async () => {
      await expect(
        citas.cupos({ servicioId: 'mg', fecha: sumarDias(HOY, -1), prestadorId: 'ao' } as never, { autoservicio: true }),
      ).rejects.toThrow(/más próxima disponible/);
    });

    it('RN-04.6: mañana sí es consultable desde el autoservicio', async () => {
      await expect(
        citas.cupos({ servicioId: 'mg', fecha: sumarDias(HOY, 1), prestadorId: 'ao', limite: 5 } as never, { autoservicio: true }),
      ).resolves.toBeDefined();
    });

    it('RN-04.6: la primera fecha agendable que anuncia el motor es mañana', () => {
      expect(citas.primeraFechaAgendableAutoservicio()).toBe(sumarDias(HOY, 1));
    });
  });

  describe('RN-02 · balanceo de medicina general', () => {
    it('RN-02: sin preferencia asigna al médico general con menor carga', async () => {
      // ao queda con 2 consultas generales; pr con 0.
      await crear({ hora: '08:00', prestadorId: 'ao' });
      await crear({ hora: '08:15', prestadorId: 'ao', pacienteId: paciente2Id });

      const cita = await citas.crear(
        { pacienteId, servicioId: 'mg', fecha: LUNES, hora: '09:00', origen: 'whatsapp' } as never,
        USUARIO,
      );
      expect(cita.prestadorId).toBe('pr');
    });

    it('RN-02.3: con preferencia explícita se respeta y no se balancea', async () => {
      await crear({ hora: '08:00', prestadorId: 'ao' });
      await crear({ hora: '08:15', prestadorId: 'ao', pacienteId: paciente2Id });

      const cita = await crear({ hora: '08:30', prestadorId: 'ao' });
      expect(cita.prestadorId).toBe('ao');
    });

    it('RN-02.4: los controles NO cuentan para el balanceo', async () => {
      const consulta = await crear({ hora: '08:00', prestadorId: 'ao' });
      // ao suma 3 controles, que no deben pesar en la comparación.
      await citas.crear({ pacienteId, servicioId: 'ctrl', fecha: LUNES, hora: '08:15', prestadorId: 'ao', tipo: 'control', citaOrigenId: consulta.id } as never, USUARIO);
      await crear({ hora: '08:30', prestadorId: 'pr' });
      await crear({ hora: '08:45', prestadorId: 'pr', pacienteId: paciente2Id });

      // ao: 1 general + 1 control. pr: 2 generales. Debe ganar ao.
      const cita = await citas.crear(
        { pacienteId, servicioId: 'mg', fecha: LUNES, hora: '09:30', origen: 'whatsapp' } as never,
        USUARIO,
      );
      expect(cita.prestadorId).toBe('ao');
    });
  });

  // ─────────────────────── RN-01 · Intercalado y ventana ───────────────────────

  describe('RN-01 · control', () => {
    it('RN-01: rechaza el control sin consulta origen', async () => {
      await expect(
        citas.crear({ pacienteId, servicioId: 'ctrl', fecha: LUNES, hora: '08:00', prestadorId: 'ao', tipo: 'control' } as never, USUARIO),
      ).rejects.toThrow(/consulta origen/i);
    });

    it('RN-01: rechaza el control fuera de la ventana del prestador (Osorio: 10 días)', async () => {
      const consulta = await crear({ hora: '08:00' });
      await expect(
        citas.crear({ pacienteId, servicioId: 'ctrl', fecha: '2026-10-05', hora: '08:00', prestadorId: 'ao', tipo: 'control', citaOrigenId: consulta.id } as never, USUARIO),
      ).rejects.toThrow(/10 días/);
    });

    it('RN-01: acepta el control dentro de la ventana', async () => {
      const consulta = await crear({ hora: '08:00' });
      const control = await citas.crear(
        { pacienteId, servicioId: 'ctrl', fecha: MARTES, hora: '08:00', prestadorId: 'ao', tipo: 'control', citaOrigenId: consulta.id } as never,
        USUARIO,
      );
      expect(control.tipo).toBe('control');
      expect(control.citaOrigenId).toBe(consulta.id);
    });

    it('RN-01: rechaza dos controles consecutivos', async () => {
      const consulta = await crear({ hora: '08:00' });
      await citas.crear({ pacienteId, servicioId: 'ctrl', fecha: LUNES, hora: '08:15', prestadorId: 'ao', tipo: 'control', citaOrigenId: consulta.id } as never, USUARIO);

      // El siguiente cupo (08:30) quedaría adyacente al control de 08:15.
      await expect(
        citas.crear({ pacienteId: paciente2Id, servicioId: 'ctrl', fecha: LUNES, hora: '08:30', prestadorId: 'ao', tipo: 'control', citaOrigenId: consulta.id } as never, USUARIO),
      ).rejects.toThrow(/control consecutivas/i);
    });

    it('RN-01: acepta la secuencia general–control–general–control', async () => {
      const c1 = await crear({ hora: '08:00' });
      await citas.crear({ pacienteId, servicioId: 'ctrl', fecha: LUNES, hora: '08:15', prestadorId: 'ao', tipo: 'control', citaOrigenId: c1.id } as never, USUARIO);
      await crear({ hora: '08:30', pacienteId: paciente2Id });
      const c4 = await citas.crear({ pacienteId, servicioId: 'ctrl', fecha: LUNES, hora: '08:45', prestadorId: 'ao', tipo: 'control', citaOrigenId: c1.id } as never, USUARIO);

      expect(c4.tipo).toBe('control');
    });

    it('RN-01: permite dos consultas generales consecutivas', async () => {
      await crear({ hora: '08:00' });
      const segunda = await crear({ hora: '08:15', pacienteId: paciente2Id });
      expect(segunda.horaInicio).toBe(495);
    });

    it('el cupo que viola el intercalado no se ofrece', async () => {
      const consulta = await crear({ hora: '08:00' });
      await citas.crear({ pacienteId, servicioId: 'ctrl', fecha: LUNES, hora: '08:15', prestadorId: 'ao', tipo: 'control', citaOrigenId: consulta.id } as never, USUARIO);

      const cupos = await citas.cupos({ servicioId: 'ctrl', fecha: LUNES, prestadorId: 'ao', tipo: 'control', citaOrigenId: consulta.id, limite: 50 } as never);
      expect(cupos.some((c) => c.hora === '08:30')).toBe(false);
    });
  });

  // ─────────────────────── Validaciones de cupo ───────────────────────

  describe('validación del cupo', () => {
    it('rechaza un horario fuera de la agenda', async () => {
      await expect(crear({ hora: '19:00' })).rejects.toThrow(/fuera de la agenda/i);
    });

    it('rechaza un horario desalineado con el slot', async () => {
      await expect(crear({ hora: '08:07' })).rejects.toThrow(/fuera de la agenda/i);
    });

    it('rechaza el cupo ya ocupado', async () => {
      await crear({ hora: '08:00' });
      await expect(crear({ hora: '08:00', pacienteId: paciente2Id })).rejects.toThrow(ConflictException);
    });

    it('RN-04.4: el Doppler pisa el cupo siguiente', async () => {
      await citas.crear({ pacienteId, servicioId: 'ecod', fecha: LUNES, hora: '07:00', prestadorId: 'ec' } as never, USUARIO);
      await expect(
        citas.crear({ pacienteId: paciente2Id, servicioId: 'eco', fecha: LUNES, hora: '07:20', prestadorId: 'ec' } as never, USUARIO),
      ).rejects.toThrow(/ocupado/i);
    });
  });

  // ─────────────────────── Concurrencia ───────────────────────

  describe('concurrencia', () => {
    it('20 peticiones simultáneas al mismo cupo → exactamente 1 creada', async () => {
      const intentos = Array.from({ length: 20 }, (_, i) =>
        citas
          .crear({ pacienteId: i % 2 === 0 ? pacienteId : paciente2Id, servicioId: 'mg', fecha: LUNES, hora: '09:00', prestadorId: 'ao', origen: 'whatsapp' } as never, USUARIO)
          .then(() => 'creada' as const)
          .catch(() => 'rechazada' as const),
      );

      const resultados = await Promise.all(intentos);
      expect(resultados.filter((r) => r === 'creada')).toHaveLength(1);
      expect(resultados.filter((r) => r === 'rechazada')).toHaveLength(19);

      const enBd = await prisma.cita.count({ where: { fecha: new Date(`${LUNES}T00:00:00Z`), prestadorId: 'ao', horaInicio: 540 } });
      expect(enBd).toBe(1);
    }, 60_000);

    it('los rechazados reciben alternativas, no un error seco', async () => {
      await crear({ hora: '09:00' });
      const r = await citas.crearConAlternativas(
        { pacienteId: paciente2Id, servicioId: 'mg', fecha: LUNES, hora: '09:00', prestadorId: 'ao', origen: 'whatsapp' } as never,
        USUARIO,
      );

      expect(r.creada).toBe(false);
      if (!r.creada) {
        expect(r.alternativas.length).toBeGreaterThan(0);
        expect(r.alternativas.some((a) => a.hora === '09:00')).toBe(false);
      }
    });

    it('creaciones concurrentes en cupos distintos no se estorban', async () => {
      const horas = ['10:00', '10:15', '10:30', '10:45', '11:00'];
      const r = await Promise.all(horas.map((hora) => crear({ hora }).then(() => true).catch(() => false)));
      expect(r.filter(Boolean)).toHaveLength(5);
    }, 30_000);
  });

  // ─────────────────────── Códigos, reprogramación, cancelación ───────────────────────

  describe('código de atención', () => {
    it('el código es único dentro del día', async () => {
      const a = await crear({ hora: '08:00' });
      const b = await crear({ hora: '08:15', pacienteId: paciente2Id });
      expect(a.codigo).not.toBe(b.codigo);
    });

    it('el control lleva prefijo C', async () => {
      const consulta = await crear({ hora: '08:00' });
      const control = await citas.crear({ pacienteId, servicioId: 'ctrl', fecha: LUNES, hora: '08:15', prestadorId: 'ao', tipo: 'control', citaOrigenId: consulta.id } as never, USUARIO);
      expect(control.codigo.startsWith('C')).toBe(true);
    });
  });

  describe('reprogramación y cancelación', () => {
    it('reprogramar dentro del mismo día conserva el código', async () => {
      const cita = await crear({ hora: '08:00' });
      const r = await citas.reprogramar(cita.id, { fecha: LUNES, hora: '09:00' }, USUARIO);
      expect(r.codigo).toBe(cita.codigo);
      expect(r.horaInicio).toBe(540);
    });

    it('reprogramar a otro día emite un código de la secuencia del día destino', async () => {
      // El código es único por sede y DÍA, así que se regenera según el nuevo día.
      await crear({ hora: '08:00', fecha: MARTES, pacienteId: paciente2Id } as never);
      const cita = await crear({ hora: '08:00' });

      const r = await citas.reprogramar(cita.id, { fecha: MARTES, hora: '09:00' }, USUARIO);
      expect(r.codigo).not.toBe(cita.codigo);
    });

    it('reprogramar libera el cupo anterior', async () => {
      const cita = await crear({ hora: '08:00' });
      await citas.reprogramar(cita.id, { fecha: LUNES, hora: '09:00' }, USUARIO);

      const cupos = await citas.cupos({ servicioId: 'mg', fecha: LUNES, prestadorId: 'ao', limite: 50 } as never);
      expect(cupos.some((c) => c.hora === '08:00')).toBe(true);
    });

    it('cancelar libera el cupo', async () => {
      const cita = await crear({ hora: '08:00' });
      await citas.cancelar(cita.id, { motivo: 'Paciente no puede asistir' }, USUARIO);

      const cupos = await citas.cupos({ servicioId: 'mg', fecha: LUNES, prestadorId: 'ao', limite: 50 } as never);
      expect(cupos.some((c) => c.hora === '08:00')).toBe(true);
    });

    it('no se reprograma una cita cancelada', async () => {
      const cita = await crear({ hora: '08:00' });
      await citas.cancelar(cita.id, { motivo: 'x' }, USUARIO);
      await expect(citas.reprogramar(cita.id, { fecha: LUNES, hora: '09:00' }, USUARIO)).rejects.toThrow(/cancelada/);
    });

    it('el motivo de cancelación no se lleva por delante la observación', async () => {
      const cita = await crear({ hora: '08:00', observacion: 'Paciente en silla de ruedas' });
      await citas.cancelar(cita.id, { motivo: 'Se enfermó el médico' }, USUARIO);

      const guardada = await prisma.cita.findUniqueOrThrow({ where: { id: cita.id } });
      expect(guardada.observacion).toBe('Paciente en silla de ruedas');
      expect(guardada.motivoCancelacion).toBe('Se enfermó el médico');
    });

    it('no se cancela una cita ya atendida', async () => {
      const cita = await crear({ hora: '08:00' });
      await prisma.cita.update({ where: { id: cita.id }, data: { estado: 'atendida' } });

      await expect(citas.cancelar(cita.id, { motivo: 'x' }, USUARIO)).rejects.toThrow(/atendida/);
    });

    /**
     * El paciente ya llegó y está en sala. `cola()` filtra solo por el estado del
     * TURNO, así que sin cerrarlo seguía en la lista de espera con la cita cancelada
     * — y podía ser llamado a consultorio.
     */
    describe('el turno de quien ya llegó', () => {
      const conLlegada = async (hora: string) => {
        const cita = await crear({ hora });
        const turno = await prisma.turno.create({
          data: { citaId: cita.id, prioridad: 'baja', estado: 'en_espera' },
        });
        return { cita, turno };
      };

      it('cancelar la cita lo saca de la cola', async () => {
        const { cita, turno } = await conLlegada('08:00');
        await citas.cancelar(cita.id, { motivo: 'El paciente se fue' }, USUARIO);

        expect((await prisma.turno.findUniqueOrThrow({ where: { id: turno.id } })).estado).toBe('cancelado');
        const cola = await prisma.turno.findMany({ where: { estado: { in: ['en_espera', 'llamado'] } } });
        expect(cola.some((t) => t.id === turno.id)).toBe(false);
      });

      it('moverla a otro día lo saca de la cola y la deja esperando llegada', async () => {
        const { cita, turno } = await conLlegada('08:00');
        await prisma.cita.update({ where: { id: cita.id }, data: { estado: 'llego' } });

        const movida = await citas.reprogramar(cita.id, { fecha: MARTES, hora: '09:00' }, USUARIO);

        expect((await prisma.turno.findUniqueOrThrow({ where: { id: turno.id } })).estado).toBe('cancelado');
        // Si se quedara en `llego`, el martes el mostrador no podría registrarlo:
        // `registrarLlegada` solo acepta pendiente_llegada|confirmada.
        expect(movida.estado).toBe('confirmada');
      });

      it('con el paciente ya dentro de consulta, no se toca la cita', async () => {
        const { cita, turno } = await conLlegada('08:00');
        await prisma.turno.update({ where: { id: turno.id }, data: { estado: 'en_atencion' } });

        await expect(citas.cancelar(cita.id, { motivo: 'x' }, USUARIO)).rejects.toThrow(/siendo atendido/);
      });
    });

    it('queda en auditoría cuando la asistente decide no avisar al paciente', async () => {
      const cita = await crear({ hora: '08:00' });
      await citas.cancelar(cita.id, { motivo: 'Cambio de plan', notificar: false }, USUARIO);

      // La auditoría es append-only y los códigos se reutilizan entre pruebas
      // (la secuencia del día arranca de cero al limpiar): hay que mirar la última.
      const registro = await prisma.auditoria.findFirstOrThrow({
        where: { entidad: `cita/${cita.codigo}`, accion: 'Cita cancelada' },
        orderBy: { ts: 'desc' },
      });
      expect(registro.detalle).toMatch(/sin avisar al paciente/);
    });
  });

  describe('auditoría', () => {
    it('cada creación y cancelación queda auditada', async () => {
      const cita = await crear({ hora: '08:00' });
      await citas.cancelar(cita.id, { motivo: 'prueba' }, USUARIO);

      const registros = await prisma.auditoria.findMany({ where: { entidad: `cita/${cita.codigo}` }, orderBy: { ts: 'asc' } });
      expect(registros.map((r) => r.accion)).toEqual(
        expect.arrayContaining(['Cita creada', 'Cita cancelada']),
      );
    });
  });
});
