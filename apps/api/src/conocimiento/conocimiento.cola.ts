import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { ZONA_SEDE } from '@provivir/shared';
import { REDIS } from '../colas/colas.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ConocimientoService } from './conocimiento.service';
import { ImportacionProcesador } from './conocimiento.importacion.procesador';
import type { DatosImportacionKb, ResumenImportacionKb } from './conocimiento.importacion.tipos';

export const COLA_CONOCIMIENTO = 'conocimiento';

const TRABAJO_VIGENCIA = 'archivar-vencidos';
const TRABAJO_IMPORTACION = 'importar-documento';

/**
 * En la zona de la sede y de madrugada: `archivarVencidos` recorre y reescribe
 * artículos, y hacerlo a media mañana competiría con la operación. Cali es UTC−5
 * y el servidor puede estar en otra zona, así que la hora se fija explícitamente.
 */
const CRON_VIGENCIA = '15 3 * * *';

type DatosTrabajo = DatosImportacionKb | Record<string, never>;
type ResultadoTrabajo = ResumenImportacionKb | { archivados: number };

/**
 * Cola de la base de conocimiento.
 *
 * Dos trabajos que no se parecen pero comparten dueño:
 *  · **vigencia** — RN-13.5.5, repetible diario. Estaba implementado en el
 *    servicio y no lo llamaba nadie: la fecha de vigencia no hacía nada.
 *  · **importación** — trocear un documento largo tarda y no puede bloquear la API.
 *
 * Cola propia y no la de `carga`: aquélla está tipada para el censo de pacientes
 * y su listado alimenta «Cargas recientes» en Administración, que no debe
 * mezclarse con las importaciones de artículos.
 */
@Injectable()
export class ConocimientoCola implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ConocimientoCola.name);
  private cola!: Queue<DatosTrabajo, ResultadoTrabajo>;
  private worker!: Worker<DatosTrabajo, ResultadoTrabajo>;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly conocimiento: ConocimientoService,
    private readonly importacion: ImportacionProcesador,
    private readonly auditoria: AuditoriaService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.cola = new Queue(COLA_CONOCIMIENTO, { connection: this.redis });

    this.worker = new Worker<DatosTrabajo, ResultadoTrabajo>(
      COLA_CONOCIMIENTO,
      async (job) => (job.name === TRABAJO_VIGENCIA ? this.correrVigencia() : this.correrImportacion(job)),
      // Uno a la vez: los dos trabajos escriben artículos y el troceo es intensivo.
      { connection: this.redis, concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      this.log.error(`Trabajo ${job?.name} ${job?.id} falló: ${err.message}`);
    });

    // `upsert` y no `add`: al reiniciar no se acumula un repetible por arranque.
    await this.cola.upsertJobScheduler(
      TRABAJO_VIGENCIA,
      { pattern: CRON_VIGENCIA, tz: ZONA_SEDE },
      { name: TRABAJO_VIGENCIA, opts: { removeOnComplete: { count: 30 }, attempts: 2 } },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.cola?.close();
  }

  private async correrVigencia(): Promise<{ archivados: number }> {
    return { archivados: await this.conocimiento.archivarVencidos() };
  }

  private async correrImportacion(job: Job<DatosTrabajo, ResultadoTrabajo>): Promise<ResumenImportacionKb> {
    const datos = job.data as DatosImportacionKb;

    const resumen = await this.importacion.procesar(datos, async (progreso) => {
      await job.updateProgress(progreso);
    });

    await this.auditoria.registrar({
      usuario: datos.usuarioId,
      accion: 'Documento importado a la base de conocimiento',
      entidad: `kb_articulo/importacion/${job.id}`,
      detalle:
        `${datos.nombreOriginal} · ${resumen.totalBloques} bloques · ${resumen.creados} creados · ` +
        `${resumen.omitidos} ya existían · ${resumen.erroneos} con error`,
      estadoNext: 'borrador',
    });

    return resumen;
  }

  async encolarImportacion(datos: DatosImportacionKb): Promise<string> {
    const job = await this.cola.add(TRABAJO_IMPORTACION, datos, {
      // Reintentar una importación a medias duplicaría trabajo: se repite a mano.
      attempts: 1,
      removeOnComplete: { count: 20 },
      removeOnFail: { count: 20 },
    });
    return job.id!;
  }

  async estadoImportacion(jobId: string) {
    const job = await this.cola.getJob(jobId);
    if (!job || job.name !== TRABAJO_IMPORTACION) return null;
    return this.aFila(job);
  }

  async listarImportaciones() {
    const jobs = await this.cola.getJobs(['active', 'waiting', 'completed', 'failed'], 0, 40);
    return Promise.all(jobs.filter((j) => j.name === TRABAJO_IMPORTACION).slice(0, 20).map((j) => this.aFila(j)));
  }

  private async aFila(job: Job<DatosTrabajo, ResultadoTrabajo>) {
    return {
      id: job.id,
      archivo: (job.data as DatosImportacionKb).nombreOriginal,
      estado: await job.getState(),
      progreso: job.progress,
      resumen: (job.returnvalue as ResumenImportacionKb | null) ?? null,
      error: job.failedReason ?? null,
    };
  }
}
