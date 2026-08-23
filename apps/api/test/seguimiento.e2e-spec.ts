import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SeguimientoService } from '../src/seguimiento/seguimiento.service';
import { MetaCliente } from '../src/whatsapp/meta.cliente';

/**
 * Seguimiento comercial contra base real (RN-09.9).
 *
 * El riesgo de este módulo no es que el mensaje no salga: es que salga cuando no
 * debía. Cada condición de corte se prueba con el envío YA programado, que es el
 * estado en el que se descubre el problema en producción.
 */
describe('Seguimiento comercial (integración)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seg: SeguimientoService;

  const SEDE = 'cdc-oriente';
  const TEL = '+573009993333';
  const DOC = '9700000001';
  const SERVICIO = 'nut';
  let pacienteId: string;
  let enviados: string[] = [];

  /** Un lunes a las 09:00 en Cali: dentro del horario de atención. */
  const HABIL = new Date('2026-09-07T14:00:00Z');

  const armar = async (opciones: { pacienteId?: string | null } = {}) => {
    const conv = await prisma.conversacion.create({
      data: { telefono: TEL, sedeId: SEDE, pacienteId: opciones.pacienteId ?? pacienteId },
    });
    // El mensaje del paciente que abre la ventana de 24 h de Meta y marca T0.
    await prisma.mensaje.create({
      data: { conversacionId: conv.id, direccion: 'entrante', tipo: 'texto', contenido: '¿cuánto vale?', ts: HABIL },
    });
    await seg.armar({
      conversacionId: conv.id,
      telefono: TEL,
      servicioId: SERVICIO,
      pacienteId: opciones.pacienteId ?? pacienteId,
      sedeId: SEDE,
      t0: HABIL,
    });
    // La secuencia se arma justo tras ese mensaje: se fija para que toda la prueba
    // viva en la misma línea de tiempo que `HABIL`.
    await prisma.seguimiento.updateMany({ where: { conversacionId: conv.id }, data: { creadoEn: HABIL } });

    const pasos = await prisma.seguimiento.findMany({
      where: { conversacionId: conv.id },
      orderBy: { programadoPara: 'asc' },
    });
    return { conversacionId: conv.id, pasos };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    prisma = app.get(PrismaService);
    seg = app.get(SeguimientoService);

    jest.spyOn(app.get(MetaCliente), 'enviarTexto').mockImplementation(async (_t, texto) => {
      enviados.push(texto);
      return `wamid.seg.${enviados.length}`;
    });

    await app.init();

    const p = await prisma.paciente.upsert({
      where: { documento: DOC },
      update: { noContactar: false },
      create: { documento: DOC, nombres: 'Ana', apellidos: 'Seguimiento', telefono: TEL, whatsapp: TEL, sedeId: SEDE },
    });
    pacienteId = p.id;
  }, 60_000);

  afterAll(async () => {
    await limpiar();
    await prisma.paciente.deleteMany({ where: { documento: DOC } });
    await app.close();
  });

  beforeEach(async () => {
    enviados = [];
    await limpiar();
    await prisma.paciente.update({ where: { id: pacienteId }, data: { noContactar: false } });
  });

  async function limpiar() {
    await prisma.seguimiento.deleteMany({ where: { telefono: TEL } });
    await prisma.cita.deleteMany({ where: { paciente: { documento: DOC } } });
    await prisma.mensaje.deleteMany({ where: { conversacion: { telefono: TEL } } });
    await prisma.conversacion.deleteMany({ where: { telefono: TEL } });
  }

  describe('RN-09.9.1 y RN-09.9.2 · armado', () => {
    it('programa los tres pasos a 2, 5 y 8 horas', async () => {
      const { pasos } = await armar();
      expect(pasos.map((p) => p.paso)).toEqual(['seguimiento_1', 'seguimiento_2', 'cierre']);

      const horas = pasos.map((p) => (p.programadoPara.getTime() - HABIL.getTime()) / 3_600_000);
      expect(horas).toEqual([2, 5, 8]);
    });

    it('RN-09.9.7.3 · un paciente no tiene dos secuencias a la vez', async () => {
      await armar();
      const segunda = await prisma.conversacion.create({ data: { telefono: TEL, sedeId: SEDE, pacienteId } });
      const n = await seg.armar({
        conversacionId: segunda.id, telefono: TEL, servicioId: 'gin', pacienteId, sedeId: SEDE, t0: HABIL,
      });
      expect(n).toBe(0);
    });

    it('RN-09.9.4 · a quien pidió no ser contactado no se le arma nada', async () => {
      await prisma.paciente.update({ where: { id: pacienteId }, data: { noContactar: true } });
      const conv = await prisma.conversacion.create({ data: { telefono: TEL, sedeId: SEDE, pacienteId } });
      const n = await seg.armar({
        conversacionId: conv.id, telefono: TEL, servicioId: SERVICIO, pacienteId, sedeId: SEDE, t0: HABIL,
      });
      expect(n).toBe(0);
    });
  });

  describe('RN-09.9.4 · condiciones de corte, con el envío ya programado', () => {
    it('envía cuando nada lo impide', async () => {
      const { pasos } = await armar();
      expect(await seg.despachar(pasos[0]!.id, HABIL)).toBe('enviado');
      expect(enviados).toHaveLength(1);
      expect(enviados[0]!.toLowerCase()).toContain('nutrición');
    });

    it('el paciente respondió → cancela la secuencia completa', async () => {
      const { conversacionId, pasos } = await armar();
      await prisma.mensaje.create({
        data: {
          conversacionId, direccion: 'entrante', tipo: 'texto', contenido: 'lo estoy pensando',
          ts: new Date(HABIL.getTime() + 60_000),
        },
      });

      expect(await seg.despachar(pasos[0]!.id, HABIL)).toBe('paciente_respondio');
      expect(enviados).toHaveLength(0);
      const restantes = await prisma.seguimiento.count({ where: { conversacionId, estado: 'programado' } });
      expect(restantes).toBe(0);
    });

    it('agendó por OTRO canal → cancela: nunca se le pregunta a quien ya tiene cita', async () => {
      const { conversacionId, pasos } = await armar();
      await prisma.cita.create({
        data: {
          codigo: 'SEG001', pacienteId, prestadorId: 'is', servicioId: SERVICIO, tipo: 'general',
          fecha: new Date('2026-09-10T00:00:00Z'), horaInicio: 600, duracionMin: 30,
          // El canal es el portal, no WhatsApp: la verificación no puede mirar solo su propio canal.
          origen: 'autoagendamiento', sedeId: SEDE,
        },
      });

      expect(await seg.despachar(pasos[0]!.id, HABIL)).toBe('ya_agendo');
      expect(enviados).toHaveLength(0);
      expect(await prisma.seguimiento.count({ where: { conversacionId, estado: 'programado' } })).toBe(0);
    });

    it('una asistente ya la tomó → no se le escribe encima', async () => {
      const { conversacionId, pasos } = await armar();
      await prisma.conversacion.update({
        where: { id: conversacionId },
        data: { escalada: true, escaladaTs: new Date(), tomadaPor: 'asistente' },
      });

      expect(await seg.despachar(pasos[0]!.id, HABIL)).toBe('en_gestion_humana');
      expect(enviados).toHaveLength(0);
    });

    it('opt-out posterior al armado → cancela antes de enviar', async () => {
      const { pasos } = await armar();
      await prisma.paciente.update({ where: { id: pacienteId }, data: { noContactar: true } });

      expect(await seg.despachar(pasos[0]!.id, HABIL)).toBe('no_contactar');
      expect(enviados).toHaveLength(0);
    });

    it('RN-04.5.4 · servicio desactivado → cancela', async () => {
      const { pasos } = await armar();
      await prisma.servicio.update({ where: { id: SERVICIO }, data: { activo: false } });
      try {
        expect(await seg.despachar(pasos[0]!.id, HABIL)).toBe('servicio_inactivo');
        expect(enviados).toHaveLength(0);
      } finally {
        await prisma.servicio.update({ where: { id: SERVICIO }, data: { activo: true } });
      }
    });

    it('un paso ya cancelado no vuelve a enviarse', async () => {
      const { pasos } = await armar();
      await seg.cancelarSecuencia(pasos[0]!.conversacionId, 'paciente_respondio');
      expect(await seg.despachar(pasos[0]!.id, HABIL)).toBe('secuencia_cancelada');
      expect(enviados).toHaveLength(0);
    });
  });

  describe('RN-09.9.5 y RN-09.9.6 · horario y ventana de Meta', () => {
    it('fuera de horario se DIFIERE, no se cancela', async () => {
      const { pasos } = await armar();
      const nocturno = new Date('2026-09-08T04:00:00Z'); // lunes 23:00 en Cali

      expect(await seg.despachar(pasos[0]!.id, nocturno)).toBe('diferido');
      expect(enviados).toHaveLength(0);

      const fila = await prisma.seguimiento.findUnique({ where: { id: pasos[0]!.id } });
      // Sigue programado: sacarlo de ese estado abriría hueco para otra secuencia.
      expect(fila?.estado).toBe('programado');
      expect(fila!.programadoPara.getTime()).toBeGreaterThan(nocturno.getTime());
    });

    it('una condición de corte GANA sobre el diferimiento', async () => {
      const { conversacionId, pasos } = await armar();
      await prisma.mensaje.create({
        data: {
          conversacionId, direccion: 'entrante', tipo: 'texto', contenido: 'ya agendé, gracias',
          ts: new Date(HABIL.getTime() + 60_000),
        },
      });
      const nocturno = new Date('2026-09-08T04:00:00Z');

      // Fuera de horario y además respondió: no se reprograma algo que no debía salir.
      expect(await seg.despachar(pasos[0]!.id, nocturno)).toBe('paciente_respondio');
    });

    it('fuera de la ventana de 24 h se descarta, no sale como texto libre', async () => {
      const { pasos } = await armar();
      const tarde = new Date(HABIL.getTime() + 26 * 3_600_000); // dentro de horario, fuera de la ventana

      expect(await seg.despachar(pasos[0]!.id, tarde)).toBe('fuera_de_ventana_meta');
      expect(enviados).toHaveLength(0);
      const fila = await prisma.seguimiento.findUnique({ where: { id: pasos[0]!.id } });
      expect(fila?.estado).toBe('descartado');
      expect(fila?.motivoCancelacion).toContain('24 h');
    });
  });

  describe('RN-09.9.8 · visibilidad en la bandeja', () => {
    it('agrupa la secuencia en una fila por conversación, con el próximo envío', async () => {
      const { conversacionId } = await armar();
      const filas = await seg.interesados();
      const fila = filas.find((f) => f.conversacionId === conversacionId);

      expect(fila).toBeDefined();
      expect(fila!.totalPasos).toBe(3);
      expect(fila!.enviados).toBe(0);
      expect(fila!.proximoPaso).toBe('seguimiento_1');
      expect(fila!.servicio).toContain('Nutrición');
    });
  });
});
