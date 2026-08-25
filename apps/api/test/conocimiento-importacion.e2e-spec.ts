import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ConocimientoService } from '../src/conocimiento/conocimiento.service';
import { ImportacionProcesador } from '../src/conocimiento/conocimiento.importacion.procesador';

/**
 * Importación de un documento del cliente a artículos (RN-13 · P6, P13).
 *
 * Lo que se verifica aquí es sobre todo **que nada de lo importado llegue al bot
 * sin revisión**: es la diferencia deliberada con la migración de
 * `documentacion_comercial`, que sí publica porque migra texto que el bot ya usaba.
 */
describe('Importación de documentos a la base de conocimiento (integración)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let kb: ConocimientoService;
  let procesador: ImportacionProcesador;

  const USUARIO = 'test-importacion';
  const SEDE = 'cdc-oriente';
  let dir: string;
  const titulos: string[] = [];

  const DOCUMENTO = [
    '## Convenios con aseguradoras',
    'Trabajamos con convenio directo para medicina laboral y exámenes ocupacionales.',
    '',
    '## Parqueadero para pacientes',
    'La sede cuenta con parqueadero gratuito durante la atención.',
    '',
    '## Nutrición',
    'Consulta nutricional de media hora con plan de alimentación personalizado.',
  ].join('\n');

  /** Sin cola: el trabajo de la cola es solo diferir, y aquí interesa el resultado. */
  const importar = async (nombre: string, contenido: string) => {
    const ruta = join(dir, nombre);
    await writeFile(ruta, contenido, 'utf8');
    return procesador.procesar(
      { rutaArchivo: ruta, nombreOriginal: nombre, usuarioId: USUARIO, sedeId: SEDE },
      async () => undefined,
    );
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    prisma = app.get(PrismaService);
    kb = app.get(ConocimientoService);
    procesador = app.get(ImportacionProcesador);
    await app.init();

    dir = await mkdtemp(join(tmpdir(), 'kb-import-'));
  }, 60_000);

  afterAll(async () => {
    await prisma.kbArticulo.deleteMany({ where: { titulo: { in: titulos } } });
    await app.close();
  });

  it('RN-13.7.1: un documento importado entra como borrador y el bot no lo recupera', async () => {
    const resumen = await importar('insumos.md', DOCUMENTO);
    titulos.push('Convenios con aseguradoras', 'Parqueadero para pacientes', 'Nutrición');

    expect(resumen.totalBloques).toBe(3);
    expect(resumen.creados).toBe(3);
    expect(resumen.erroneos).toBe(0);

    const articulos = await prisma.kbArticulo.findMany({
      where: { titulo: { in: titulos } },
      include: { _count: { select: { fragmentos: true } } },
    });
    expect(articulos).toHaveLength(3);

    for (const a of articulos) {
      expect(a.estado).toBe('borrador');
      // Sin fragmentos no hay nada que recuperar: el índice se construye al publicar.
      expect(a._count.fragmentos).toBe(0);
    }

    // Y de extremo a extremo: la pregunta que el documento cubre sigue escalando.
    const r = await kb.buscar('¿Tienen parqueadero para pacientes?', { registrar: false });
    expect(r.tipo).toBe('sin_cobertura');
  });

  it('RN-13: la importación por archivo es idempotente por título', async () => {
    const antes = await prisma.kbArticulo.count();
    const resumen = await importar('insumos-otra-vez.md', DOCUMENTO);

    expect(resumen.creados).toBe(0);
    expect(resumen.omitidos).toBe(3);
    expect(await prisma.kbArticulo.count()).toBe(antes);
  });

  it('RN-13.1: solo vincula el servicio cuando el emparejamiento es inequívoco', async () => {
    const [nutricion, parqueadero] = await Promise.all([
      prisma.kbArticulo.findFirstOrThrow({ where: { titulo: 'Nutrición' } }),
      prisma.kbArticulo.findFirstOrThrow({ where: { titulo: 'Parqueadero para pacientes' } }),
    ]);

    // «Nutrición» es un servicio del catálogo; «Parqueadero» no es ninguno.
    const servicio = await prisma.servicio.findFirst({ where: { nombre: 'Nutrición' } });
    if (servicio) expect(nutricion.servicioId).toBe(servicio.id);
    expect(parqueadero.servicioId).toBeNull();
  });

  it('RN-13: un formato no soportado se rechaza antes de tocar la base', async () => {
    const antes = await prisma.kbArticulo.count();
    await expect(importar('hoja.xlsx', 'lo que sea')).rejects.toThrow(/Formato no soportado/);
    expect(await prisma.kbArticulo.count()).toBe(antes);
  });
});
