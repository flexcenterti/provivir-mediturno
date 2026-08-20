import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { REDIS } from '../colas/colas.module';
import { CargaProcesador } from './carga.procesador';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { DatosTrabajoCarga, ResumenCarga } from './carga.tipos';

export const COLA_CARGA = 'carga-masiva';

/**
 * RN-12 · la carga corre en cola para no bloquear la API: 200.000 registros
 * tardan minutos y la asistente tiene que poder seguir trabajando mientras tanto.
 */
@Injectable()
export class CargaCola implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(CargaCola.name);
  private cola!: Queue<DatosTrabajoCarga, ResumenCarga>;
  private worker!: Worker<DatosTrabajoCarga, ResumenCarga>;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly procesador: CargaProcesador,
    private readonly auditoria: AuditoriaService,
  ) {}

  onModuleInit(): void {
    this.cola = new Queue(COLA_CARGA, { connection: this.redis });

    this.worker = new Worker<DatosTrabajoCarga, ResumenCarga>(
      COLA_CARGA,
      async (job) => {
        const resumen = await this.procesador.procesar(job.data, async (procesadas) => {
          await job.updateProgress({ procesadas });
        });

        await this.auditoria.registrar({
          usuario: job.data.usuarioId,
          accion: 'Carga masiva completada',
          entidad: `carga/${job.id}`,
          detalle:
            `${job.data.nombreOriginal} · ${resumen.creados} creados · ` +
            `${resumen.actualizados} actualizados · ${resumen.duplicadosRechazados} duplicados · ` +
            `${resumen.fueraDeFiltro} fuera de filtro · ${resumen.erroneos} con error`,
        });

        return resumen;
      },
      // Uno a la vez: la carga es intensiva en BD y compite con la operación en sede.
      { connection: this.redis, concurrency: 1 },
    );

    this.worker.on('failed', (job, err) => {
      this.log.error(`Carga ${job?.id} falló: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.cola?.close();
  }

  async encolar(datos: DatosTrabajoCarga): Promise<string> {
    const job = await this.cola.add('procesar', datos, {
      attempts: 1, // Reintentar una carga a medias duplicaría trabajo: se reintenta manualmente.
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    });
    return job.id!;
  }

  async estado(jobId: string) {
    const job: Job<DatosTrabajoCarga, ResumenCarga> | undefined = await this.cola.getJob(jobId);
    if (!job) return null;

    return {
      id: job.id,
      archivo: job.data.nombreOriginal,
      estado: await job.getState(),
      progreso: job.progress,
      resumen: job.returnvalue ?? null,
      error: job.failedReason ?? null,
    };
  }

  async listar() {
    const jobs = await this.cola.getJobs(['active', 'waiting', 'completed', 'failed'], 0, 20);
    return Promise.all(
      jobs.map(async (j) => ({
        id: j.id,
        archivo: j.data.nombreOriginal,
        estado: await j.getState(),
        progreso: j.progress,
        resumen: j.returnvalue ?? null,
      })),
    );
  }
}
