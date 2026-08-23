import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ServiciosService } from '../src/servicios/servicios.service';
import { ConocimientoService } from '../src/conocimiento/conocimiento.service';
import { SeguimientoService } from '../src/seguimiento/seguimiento.service';

/**
 * Gobierno del catálogo contra base real (RN-04.5).
 *
 * Lo que importa aquí no es el CRUD, sino sus dos garantías: que un cambio de
 * duración no toque las citas ya agendadas, y que dar de baja un servicio arrastre
 * consigo todo lo que lo ofrecía.
 */
describe('Catálogo de servicios (integración)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let servicios: ServiciosService;
  let kb: ConocimientoService;
  let seg: SeguimientoService;

  const USUARIO = 'test-catalogo';
  const SEDE = 'cdc-oriente';
  const ID = 'test-masaje';
  const DOC = '9800000001';
  let pacienteId: string;

  const crearServicio = () =>
    servicios.crear(
      {
        id: ID,
        nombre: 'Masaje terapéutico',
        categoria: 'Procedimiento',
        tipo: 'procedimiento',
        duracionMin: 45,
        cupos: 1,
        descripcionComercial: 'Masaje descontracturante con fisioterapeuta.',
        beneficios: ['Alivia tensión de cuello y espalda'],
      },
      USUARIO,
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    prisma = app.get(PrismaService);
    servicios = app.get(ServiciosService);
    kb = app.get(ConocimientoService);
    seg = app.get(SeguimientoService);
    await app.init();

    const p = await prisma.paciente.upsert({
      where: { documento: DOC },
      update: {},
      create: { documento: DOC, nombres: 'Luis', apellidos: 'Catálogo', sedeId: SEDE },
    });
    pacienteId = p.id;
  }, 60_000);

  afterAll(async () => {
    await limpiar();
    await prisma.paciente.deleteMany({ where: { documento: DOC } });
    await app.close();
  });

  beforeEach(limpiar);

  async function limpiar() {
    await prisma.seguimiento.deleteMany({ where: { servicioId: ID } });
    await prisma.cita.deleteMany({ where: { servicioId: ID } });
    await prisma.kbFragmento.deleteMany({ where: { articulo: { servicioId: ID } } });
    await prisma.kbArticulo.deleteMany({ where: { servicioId: ID } });
    await prisma.prestadorServicio.deleteMany({ where: { servicioId: ID } });
    await prisma.servicio.deleteMany({ where: { id: ID } });
  }

  const crearCita = (fecha: string, duracionMin = 45) =>
    prisma.cita.create({
      data: {
        codigo: `CAT${Math.floor(Math.random() * 9000) + 1000}`,
        pacienteId,
        prestadorId: 'is',
        servicioId: ID,
        tipo: 'procedimiento',
        fecha: new Date(fecha),
        horaInicio: 600,
        duracionMin,
        origen: 'mostrador',
        sedeId: SEDE,
      },
    });

  describe('RN-04.5.1 · ficha comercial', () => {
    it('un servicio sin ficha queda registrado como tal en la auditoría', async () => {
      await servicios.crear(
        { id: ID, nombre: 'Sin ficha', categoria: 'Procedimiento', tipo: 'procedimiento', duracionMin: 20 },
        USUARIO,
      );
      const entrada = await prisma.auditoria.findFirst({
        where: { entidad: `servicio/${ID}`, accion: 'Servicio creado' },
        orderBy: { ts: 'desc' },
      });
      expect(entrada?.detalle).toContain('SIN ficha comercial');
    });

    it('con ficha no se marca', async () => {
      await crearServicio();
      const entrada = await prisma.auditoria.findFirst({
        where: { entidad: `servicio/${ID}`, accion: 'Servicio creado' },
        orderBy: { ts: 'desc' },
      });
      expect(entrada?.detalle).not.toContain('SIN ficha');
    });
  });

  describe('RN-04.5.2 · los cambios no son retroactivos', () => {
    it('cambiar la duración no altera las citas ya agendadas', async () => {
      await crearServicio();
      const cita = await crearCita('2026-10-05T00:00:00Z', 45);

      await servicios.actualizar(ID, { duracionMin: 90 }, USUARIO);

      const despues = await prisma.cita.findUnique({ where: { id: cita.id } });
      expect(despues?.duracionMin).toBe(45);
      expect((await servicios.porId(ID)).duracionMin).toBe(90);
    });

    it('el cambio con impacto en agenda queda auditado con el antes y el después', async () => {
      await crearServicio();
      await servicios.actualizar(ID, { duracionMin: 90, cupos: 2 }, USUARIO);

      const entrada = await prisma.auditoria.findFirst({
        where: { entidad: `servicio/${ID}`, accion: 'Servicio actualizado' },
        orderBy: { ts: 'desc' },
      });
      expect(entrada?.detalle).toContain('no retroactivo');
      expect(entrada?.estadoPrev).toContain('45 min');
      expect(entrada?.estadoNext).toContain('90 min');
    });

    it('un cambio sin impacto en agenda no se marca como tal', async () => {
      await crearServicio();
      await servicios.actualizar(ID, { descripcionComercial: 'Otra descripción' }, USUARIO);

      const entrada = await prisma.auditoria.findFirst({
        where: { entidad: `servicio/${ID}`, accion: 'Servicio actualizado' },
        orderBy: { ts: 'desc' },
      });
      expect(entrada?.detalle).not.toContain('no retroactivo');
    });
  });

  describe('RN-04.5.3 · baja lógica', () => {
    it('un servicio con citas NO se puede eliminar', async () => {
      await crearServicio();
      await crearCita('2026-10-05T00:00:00Z');

      await expect(servicios.eliminar(ID, USUARIO)).rejects.toBeInstanceOf(BadRequestException);
      expect(await servicios.porId(ID)).toBeDefined();
    });

    it('sin citas sí se elimina', async () => {
      await crearServicio();
      await expect(servicios.eliminar(ID, USUARIO)).resolves.toEqual({ eliminado: true });
      expect(await prisma.servicio.findUnique({ where: { id: ID } })).toBeNull();
    });

    it('desactivar conserva las citas ya agendadas', async () => {
      await crearServicio();
      const cita = await crearCita('2026-10-05T00:00:00Z');

      const impacto = await servicios.desactivar(ID, USUARIO);

      expect(impacto.citasVigentes).toBe(1);
      expect((await servicios.porId(ID)).activo).toBe(false);
      expect(await prisma.cita.findUnique({ where: { id: cita.id } })).not.toBeNull();
    });

    it('el impacto se puede consultar ANTES de decidir', async () => {
      await crearServicio();
      await crearCita('2026-10-05T00:00:00Z');

      const previo = await servicios.impacto(ID);
      expect(previo.citasVigentes).toBe(1);
      // Consultar no cambia nada.
      expect((await servicios.porId(ID)).activo).toBe(true);
    });
  });

  describe('RN-04.5.4 · efectos en cadena de la baja', () => {
    it('cancela los seguimientos y marca los artículos para revisión', async () => {
      await crearServicio();

      const conv = await prisma.conversacion.create({
        data: { telefono: '+573009994444', sedeId: SEDE, pacienteId },
      });
      await seg.armar({
        conversacionId: conv.id,
        telefono: '+573009994444',
        servicioId: ID,
        pacienteId,
        sedeId: SEDE,
        t0: new Date('2026-09-07T14:00:00Z'),
      });

      const art = await kb.crear(
        { titulo: 'Masaje terapéutico', categoria: 'Servicios', contenidoMd: '## Masaje\nDura 45 minutos.', servicioId: ID },
        USUARIO,
        SEDE,
      );
      await kb.publicar(art.id, USUARIO);

      const impacto = await servicios.desactivar(ID, USUARIO);

      expect(impacto.seguimientosCancelados).toBeGreaterThan(0);
      expect(impacto.articulosParaRevisar).toBe(1);

      expect(await prisma.seguimiento.count({ where: { servicioId: ID, estado: 'programado' } })).toBe(0);
      expect((await prisma.kbArticulo.findUnique({ where: { id: art.id } }))?.requiereRevision).toBe(true);

      await prisma.conversacion.delete({ where: { id: conv.id } });
    });

    it('la cascada ocurre también al desactivar desde el PATCH del formulario', async () => {
      await crearServicio();
      const art = await kb.crear(
        { titulo: 'Masaje terapéutico', categoria: 'Servicios', contenidoMd: '## Masaje\nDura 45 minutos.', servicioId: ID },
        USUARIO,
        SEDE,
      );
      await kb.publicar(art.id, USUARIO);

      await servicios.actualizar(ID, { activo: false }, USUARIO);

      expect((await prisma.kbArticulo.findUnique({ where: { id: art.id } }))?.requiereRevision).toBe(true);
    });

    it('reactivar vuelve a ofrecerlo y queda auditado', async () => {
      await crearServicio();
      await servicios.desactivar(ID, USUARIO);
      await servicios.activar(ID, USUARIO);

      expect((await servicios.porId(ID)).activo).toBe(true);
      const entrada = await prisma.auditoria.findFirst({
        where: { entidad: `servicio/${ID}`, accion: 'Servicio activado' },
        orderBy: { ts: 'desc' },
      });
      expect(entrada).not.toBeNull();
    });

    it('desactivar dos veces se rechaza en vez de repetir la cascada', async () => {
      await crearServicio();
      await servicios.desactivar(ID, USUARIO);
      await expect(servicios.desactivar(ID, USUARIO)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('RN-13 · un servicio desactivado sale de la oferta del bot', () => {
    it('listar_servicios deja de verlo', async () => {
      await crearServicio();
      expect((await servicios.listar()).some((s) => s.id === ID)).toBe(true);

      await servicios.desactivar(ID, USUARIO);
      expect((await servicios.listar()).some((s) => s.id === ID)).toBe(false);
      // Sigue existiendo para el historial y la auditoría.
      expect((await servicios.listar(false)).some((s) => s.id === ID)).toBe(true);
    });
  });
});
