import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ConocimientoService } from '../src/conocimiento/conocimiento.service';

/**
 * Base de conocimiento contra base real (RN-13).
 *
 * Las reglas puras —troceado, temas prohibidos, umbral— viven en sus `.spec.ts`.
 * Aquí se verifica lo que solo se ve con PostgreSQL delante: la recuperación
 * léxica, el trigger que mantiene el `tsvector` y el archivado transaccional.
 */
describe('Base de conocimiento (integración)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let kb: ConocimientoService;

  const USUARIO = 'test-conocimiento';
  const SEDE = 'cdc-oriente';
  const creados: string[] = [];
  /** Para borrar la telemetría que genere la corrida y dejar la base como estaba. */
  const arranque = new Date();

  const publicar = async (titulo: string, contenidoMd: string): Promise<string> => {
    const art = await kb.crear({ titulo, categoria: 'Prueba', contenidoMd }, USUARIO, SEDE);
    creados.push(art.id);
    await kb.publicar(art.id, USUARIO);
    return art.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    prisma = app.get(PrismaService);
    kb = app.get(ConocimientoService);
    await app.init();

    await publicar(
      'Preparación para ecografías',
      '## Preparación para ecografías\nPara la ecografía abdominal se requiere ayuno de 6 horas. ' +
        'Para la pélvica se necesita la vejiga llena. El Doppler abdominal también exige ayuno de 6 horas.',
    );
    await publicar(
      'Horarios de atención',
      '## Horarios de atención\nAtendemos de lunes a viernes de 7 de la mañana a 6 de la tarde, ' +
        'y los sábados de 8 a 12 del mediodía.',
    );
    await publicar(
      'Formas de pago aceptadas',
      '## Formas de pago\nRecibimos efectivo, tarjeta débito y crédito, y transferencia por Nequi o Daviplata.',
    );
  }, 60_000);

  afterAll(async () => {
    for (const id of creados) {
      await prisma.kbArticulo.deleteMany({ where: { id } });
    }
    await prisma.kbConsulta.deleteMany({ where: { ts: { gte: arranque } } });
    await prisma.kbPendiente.deleteMany({ where: { creadoEn: { gte: arranque } } });
    await app.close();
  });

  describe('RN-13.3 · recuperación y umbral', () => {
    it('responde una pregunta cubierta por un artículo publicado', async () => {
      const r = await kb.buscar('¿Cómo me preparo para la ecografía?', { registrar: false });
      expect(r.tipo).toBe('respondida');
      if (r.tipo === 'respondida') {
        expect(r.fragmentos[0]!.titulo).toBe('Preparación para ecografías');
        expect(r.mejorPuntaje).toBeGreaterThanOrEqual(62);
      }
    });

    it('recupera aunque la pregunta no repita las palabras del artículo', async () => {
      // «abren» no aparece en el texto («Atendemos»); lo sostienen «horarios» y «sábados».
      const r = await kb.buscar('¿A qué hora abren los sábados?', { registrar: false });
      expect(r.tipo).toBe('respondida');
    });

    it('ignora tildes: el paciente escribe como puede', async () => {
      const con = await kb.buscar('¿Cómo me preparo para la ecografía?', { registrar: false });
      const sin = await kb.buscar('como me preparo para la ecografia', { registrar: false });
      expect(sin.tipo).toBe(con.tipo);
    });

    it('escala en vez de aproximar cuando nada la cubre', async () => {
      const r = await kb.buscar('¿Hacen cirugía bariátrica?', { registrar: false });
      expect(r.tipo).toBe('sin_cobertura');
    });
  });

  describe('RN-13.4 · temas de escalamiento obligatorio', () => {
    it('escala aunque haya artículos que podrían responder', async () => {
      const r = await kb.buscar('Me duele el pecho, ¿qué tengo?', { registrar: false });
      expect(r.tipo).toBe('bloqueada');
      if (r.tipo === 'bloqueada') expect(r.tema).toBe('Consejo o diagnóstico clínico');
    });
  });

  describe('RN-13.5 · ciclo de vida del artículo', () => {
    it('un borrador no se sirve al bot aunque cubra la pregunta', async () => {
      const borrador = await kb.crear(
        {
          titulo: 'Parqueadero',
          categoria: 'Prueba',
          contenidoMd: '## Parqueadero\nTenemos parqueadero gratuito para pacientes.',
        },
        USUARIO,
        SEDE,
      );
      creados.push(borrador.id);

      const r = await kb.buscar('¿Tienen parqueadero?', { registrar: false });
      expect(r.tipo).toBe('sin_cobertura');
    });

    it('archivar lo saca del índice de inmediato, en la misma transacción', async () => {
      const id = await publicar('Vacunas', '## Vacunas\nAplicamos vacuna contra la influenza todo el año.');
      expect((await kb.buscar('¿aplican vacuna de influenza?', { registrar: false })).tipo).toBe('respondida');

      await kb.archivar(id, USUARIO);

      expect((await kb.buscar('¿aplican vacuna de influenza?', { registrar: false })).tipo).toBe('sin_cobertura');
      expect(await prisma.kbFragmento.count({ where: { articuloId: id } })).toBe(0);
      // La ficha sobrevive: la auditoría debe poder explicar respuestas ya dadas.
      expect(await prisma.kbArticulo.findUnique({ where: { id } })).not.toBeNull();
    });

    it('reactivar devuelve a borrador, no a publicado', async () => {
      const id = await publicar('Certificados', '## Certificados\nExpedimos certificados de asistencia.');
      await kb.archivar(id, USUARIO);
      const r = await kb.reactivar(id, USUARIO);
      expect(r.estado).toBe('borrador');
    });

    it('un artículo publicado no puede eliminarse; un borrador sí', async () => {
      const id = await publicar('Convenios', '## Convenios\nTrabajamos con varias aseguradoras.');
      await expect(kb.eliminar(id, USUARIO)).rejects.toBeInstanceOf(BadRequestException);

      const borrador = await kb.crear(
        { titulo: 'Descartable', categoria: 'Prueba', contenidoMd: 'x' },
        USUARIO,
        SEDE,
      );
      await expect(kb.eliminar(borrador.id, USUARIO)).resolves.toEqual({ eliminado: true });
    });

    it('publicar un artículo vacío se rechaza', async () => {
      const vacio = await kb.crear({ titulo: 'Vacío', categoria: 'Prueba', contenidoMd: '   ' }, USUARIO, SEDE);
      creados.push(vacio.id);
      await expect(kb.publicar(vacio.id, USUARIO)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('republicar tras editar reindexa: la versión vieja deja de recuperarse', async () => {
      const id = await publicar('Sedes', '## Sedes\nAtendemos únicamente en la sede de Oriente.');
      await kb.actualizar(id, { contenidoMd: '## Sedes\nAtendemos en la sede de Oriente y en la de Norte.' }, USUARIO);

      const fragmentos = await prisma.kbFragmento.findMany({ where: { articuloId: id } });
      expect(fragmentos).toHaveLength(1);
      expect(fragmentos[0]!.texto).toContain('Norte');
    });
  });

  describe('RN-13 · importación de la documentación comercial', () => {
    // El parámetro trae el catálogo de demostración (P6 real sigue pendiente).
    it('convierte el bloque del prompt en artículos publicados y vinculados', async () => {
      const r = await kb.importarDocumentacionComercial(USUARIO, SEDE);
      creados.push(...(await prisma.kbArticulo.findMany({ select: { id: true } })).map((a) => a.id));

      expect(r.creados.length).toBeGreaterThan(5);
      expect(r.creados.some((c) => c.servicioId === 'ecod')).toBe(true);

      // «Medicina general» coincide con Consulta y con Control: no se vincula.
      expect(r.sinServicio).toContain('Medicina general');

      const publicados = await prisma.kbArticulo.count({ where: { estado: 'publicado' } });
      expect(publicados).toBeGreaterThan(5);
    });

    it('es idempotente: repetirla no duplica artículos', async () => {
      const antes = await prisma.kbArticulo.count();
      const r = await kb.importarDocumentacionComercial(USUARIO, SEDE);

      expect(r.creados).toHaveLength(0);
      expect(r.omitidos.length).toBeGreaterThan(0);
      expect(await prisma.kbArticulo.count()).toBe(antes);
    });

    it('lo importado se puede recuperar de inmediato', async () => {
      const r = await kb.buscar('¿La ecografía Doppler necesita ayuno?', { registrar: false });
      expect(r.tipo).toBe('respondida');
    });
  });

  describe('RN-13.6 · preguntas sin respuesta', () => {
    it('la misma pregunta repetida suma ocurrencias en vez de duplicar la fila', async () => {
      const pregunta = '¿Tienen convenio con Sura para medicina laboral?';
      await kb.buscar(pregunta, {});
      await kb.buscar('convenio con Sura medicina laboral', {});

      const abiertas = await kb.pendientes();
      const fila = abiertas.filter((p) => p.preguntaNormalizada.includes('sura'));
      expect(fila).toHaveLength(1);
      expect(fila[0]!.ocurrencias).toBeGreaterThanOrEqual(2);

      await prisma.kbPendiente.deleteMany({ where: { id: fila[0]!.id } });
    });

    it('un tema prohibido NO entra a la cola: no se resuelve escribiendo un artículo', async () => {
      const antes = await prisma.kbPendiente.count();
      await kb.buscar('¿Qué dosis de acetaminofén puedo tomar?', {});
      expect(await prisma.kbPendiente.count()).toBe(antes);
    });
  });
});
