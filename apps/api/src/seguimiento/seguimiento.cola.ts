import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { REDIS } from '../colas/colas.module';
import { SeguimientoService } from './seguimiento.service';

export const COLA_SEGUIMIENTO_COMERCIAL = 'seguimiento-comercial';

interface TrabajoPaso {
  seguimientoId: string;
}

/**
 * Cola de la secuencia comercial (RN-09.9).
 *
 * Un trabajo diferido por paso, con `jobId` determinista: rearmar la secuencia no
 * puede producir envíos duplicados. La decisión de enviar NO está aquí — el worker
 * solo despierta y le pregunta al servicio, que revalida todo antes de escribir.
 */
@Injectable()
export class SeguimientoCola implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SeguimientoCola.name);
  private cola!: Queue<TrabajoPaso>;
  private worker!: Worker<TrabajoPaso>;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly seguimiento: SeguimientoService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.cola = new Queue(COLA_SEGUIMIENTO_COMERCIAL, { connection: this.redis });
    this.worker = new Worker<TrabajoPaso>(
      COLA_SEGUIMIENTO_COMERCIAL,
      async (job) => {
        const desenlace = await this.seguimiento.despachar(job.data.seguimientoId);
        // Diferido por horario: vuelve a la cola con el nuevo momento.
        if (desenlace === 'diferido') await this.reprogramar(job.data.seguimientoId);
      },
      { connection: this.redis, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) =>
      this.log.error(`Seguimiento ${job?.id} falló: ${err.message}`),
    );

    await this.recuperarPendientes();
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.cola?.close();
  }

  /** Programa un paso. El `jobId` lo hace idempotente. */
  async programar(seguimientoId: string, cuando: Date): Promise<void> {
    await this.cola.add(
      'paso',
      { seguimientoId },
      {
        jobId: `seg-${seguimientoId}`,
        delay: Math.max(0, cuando.getTime() - Date.now()),
        attempts: 2,
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 200 },
      },
    );
  }

  private async reprogramar(seguimientoId: string): Promise<void> {
    const pendientes = await this.seguimiento.pendientesDeEnvio(new Date(Date.now() + 7 * 24 * 3_600_000));
    const fila = pendientes.find((p) => p.id === seguimientoId);
    if (!fila) return;
    // El jobId anterior ya se consumió, así que este add no choca.
    await this.programar(seguimientoId, fila.programadoPara);
  }

  /**
   * Al arrancar, vuelve a encolar lo que quedó programado en la tabla.
   *
   * La tabla es la fuente de verdad, no Redis: si se pierde la cola —reinicio,
   * purga, cambio de instancia— los envíos programados no se evaporan. Sin esto,
   * un paciente quedaría a medias de una secuencia para siempre.
   */
  private async recuperarPendientes(): Promise<void> {
    const enUnaSemana = new Date(Date.now() + 7 * 24 * 3_600_000);
    const pendientes = await this.seguimiento.pendientesDeEnvio(enUnaSemana);
    for (const p of pendientes) await this.programar(p.id, p.programadoPara);
    if (pendientes.length) this.log.log(`Recuperados ${pendientes.length} envío(s) de seguimiento`);
  }
}
