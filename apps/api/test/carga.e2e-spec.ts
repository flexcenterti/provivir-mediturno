import { Test } from '@nestjs/testing';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CargaProcesador } from '../src/carga/carga.procesador';
import type { INestApplication } from '@nestjs/common';

/**
 * Prueba de integración de la carga masiva (Guía, FASE 1).
 * Objetivo del cliente: 200.000 registros iniciales, dimensionado a 400.000.
 * Aquí se verifica el comportamiento con 100.000 sintéticos.
 */
describe('Carga masiva (integración)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let procesador: CargaProcesador;

  const DIR = join(tmpdir(), 'provivir-carga-test');
  const PREFIJO_DOC = '99';

  const hoy = new Date();
  const haceUnMes = new Date(hoy); haceUnMes.setMonth(haceUnMes.getMonth() - 1);
  const haceTresAnios = new Date(hoy); haceTresAnios.setFullYear(haceTresAnios.getFullYear() - 3);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    prisma = app.get(PrismaService);
    procesador = app.get(CargaProcesador);
    await app.init();
    await mkdir(DIR, { recursive: true });
  });

  afterAll(async () => {
    await prisma.historialServicio.deleteMany({ where: { paciente: { documento: { startsWith: PREFIJO_DOC } } } });
    await prisma.paciente.deleteMany({ where: { documento: { startsWith: PREFIJO_DOC } } });
    await app.close();
  });

  /** Genera un CSV con los campos reales del cliente (Especificación §2.2). */
  async function generarCsv(nombre: string, filas: number, opciones?: { fraccionAntigua?: number }): Promise<string> {
    const fraccionAntigua = opciones?.fraccionAntigua ?? 0;
    const partes = ['Nombres,Apellidos,Número de identificación,Número de contacto,Servicio,Fecha del servicio'];

    for (let i = 0; i < filas; i++) {
      const doc = `${PREFIJO_DOC}${String(i).padStart(8, '0')}`;
      const antigua = i % 100 < fraccionAntigua * 100;
      partes.push(
        `Paciente${i},Apellido${i},${doc},+57300${String(i).padStart(7, '0')},` +
        `Medicina general · Consulta,${iso(antigua ? haceTresAnios : haceUnMes)}`,
      );
    }

    const ruta = join(DIR, nombre);
    await writeFile(ruta, partes.join('\n'), 'utf8');
    return ruta;
  }

  it('RN-12.2: rechaza un archivo sin las columnas obligatorias', async () => {
    const ruta = join(DIR, 'malo.csv');
    await writeFile(ruta, 'Nombres,Teléfono\nCarlos,+573001111111', 'utf8');

    await expect(
      procesador.procesar({ rutaArchivo: ruta, nombreOriginal: 'malo.csv', usuarioId: 'test', filtrarUltimoAnio: false }),
    ).rejects.toThrow(/columnas obligatorias/);
  });

  it('el archivo se elimina del disco al terminar, incluso si falla', async () => {
    const ruta = join(DIR, 'borrable.csv');
    await writeFile(ruta, 'Nombres,Teléfono\nCarlos,+573001111111', 'utf8');

    await procesador
      .procesar({ rutaArchivo: ruta, nombreOriginal: 'borrable.csv', usuarioId: 'test', filtrarUltimoAnio: false })
      .catch(() => undefined);

    await expect(access(ruta)).rejects.toThrow();
  });

  it('RN-12.3: aplica el filtro de servicio en el último año', async () => {
    // 30% con servicio de hace tres años → deben quedar fuera.
    const ruta = await generarCsv('filtro.csv', 1_000, { fraccionAntigua: 0.3 });
    const r = await procesador.procesar({
      rutaArchivo: ruta, nombreOriginal: 'filtro.csv', usuarioId: 'test', filtrarUltimoAnio: true,
    });

    expect(r.totalFilas).toBe(1_000);
    expect(r.fueraDeFiltro).toBe(300);
    expect(r.creados).toBe(700);
  }, 120_000);

  it('RN-12.5: la re-carga rechaza duplicados y actualiza el contacto', async () => {
    const primera = await generarCsv('recarga-1.csv', 500);
    const r1 = await procesador.procesar({
      rutaArchivo: primera, nombreOriginal: 'recarga-1.csv', usuarioId: 'test', filtrarUltimoAnio: false,
    });

    const antes = await prisma.paciente.count({ where: { documento: { startsWith: PREFIJO_DOC } } });

    // Mismo archivo otra vez: ningún registro nuevo debe crearse.
    const segunda = await generarCsv('recarga-2.csv', 500);
    const r2 = await procesador.procesar({
      rutaArchivo: segunda, nombreOriginal: 'recarga-2.csv', usuarioId: 'test', filtrarUltimoAnio: false,
    });

    const despues = await prisma.paciente.count({ where: { documento: { startsWith: PREFIJO_DOC } } });

    expect(r1.creados).toBeGreaterThan(0);
    expect(r2.creados).toBe(0);
    expect(r2.duplicadosRechazados).toBe(500);
    expect(r2.actualizados).toBe(500);
    expect(despues).toBe(antes);
  }, 120_000);

  it('RN-12.5: los duplicados dentro del mismo archivo se rechazan', async () => {
    const ruta = join(DIR, 'duplicados.csv');
    const doc = `${PREFIJO_DOC}77777777`;
    await writeFile(ruta,
      ['Nombres,Apellidos,Número de identificación',
       `Ana,Torres,${doc}`,
       `Ana,Torres,${doc}`,
       `Ana,Torres,${doc}`].join('\n'), 'utf8');

    const r = await procesador.procesar({
      rutaArchivo: ruta, nombreOriginal: 'duplicados.csv', usuarioId: 'test', filtrarUltimoAnio: false,
    });

    expect(r.creados).toBe(1);
    expect(r.duplicadosRechazados).toBe(2);
  });

  it('RN-12.4: puebla el historial de servicios desde la carga', async () => {
    const ruta = await generarCsv('historial.csv', 50);
    const r = await procesador.procesar({
      rutaArchivo: ruta, nombreOriginal: 'historial.csv', usuarioId: 'test', filtrarUltimoAnio: false,
    });

    expect(r.historialesCreados).toBeGreaterThan(0);

    const paciente = await prisma.paciente.findUnique({
      where: { documento: `${PREFIJO_DOC}00000000` },
      include: { historial: true },
    });
    expect(paciente?.historial.length).toBeGreaterThan(0);
    expect(paciente?.origen).toBe('carga');
  }, 60_000);

  it('reporta las filas con error sin exponer el documento en claro', async () => {
    const ruta = join(DIR, 'errores.csv');
    await writeFile(ruta,
      ['Nombres,Apellidos,Número de identificación',
       'Carlos,Mora,12',          // documento inválido
       ',Mora,9988776655',        // sin nombres
       `Ana,Torres,${PREFIJO_DOC}66666666`].join('\n'), 'utf8');

    const r = await procesador.procesar({
      rutaArchivo: ruta, nombreOriginal: 'errores.csv', usuarioId: 'test', filtrarUltimoAnio: false,
    });

    expect(r.erroneos).toBe(2);
    expect(r.errores).toHaveLength(2);
    expect(r.errores.every((e) => !/\d{6,}/.test(e.documento))).toBe(true);
  });

  it('procesa 100.000 registros en menos de 5 minutos', async () => {
    const ruta = await generarCsv('carga-100k.csv', 100_000);

    const inicio = Date.now();
    const r = await procesador.procesar({
      rutaArchivo: ruta, nombreOriginal: 'carga-100k.csv', usuarioId: 'test', filtrarUltimoAnio: false,
    });
    const segundos = (Date.now() - inicio) / 1000;

    console.warn(`  100.000 filas en ${segundos.toFixed(1)} s · ${r.creados} creados, ${r.duplicadosRechazados} duplicados`);

    expect(r.totalFilas).toBe(100_000);
    expect(segundos).toBeLessThan(300);
  }, 400_000);
});
