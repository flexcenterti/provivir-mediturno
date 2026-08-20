import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { REDIS } from '../colas/colas.module';
import { ConversacionService } from './conversacion.service';
import type { MensajeEntrante } from './whatsapp.tipos';

export const COLA_ENTRANTES = 'whatsapp-entrantes';
export const COLA_SEGUIMIENTO = 'whatsapp-seguimiento';

export interface TrabajoSeguimiento {
  conversacionId: string;
  telefono: string;
}

/**
 * Colas del canal WhatsApp (Arquitectura §1.6: asíncrono lo que puede fallar).
 *
 * Entrantes: el webhook solo encola; el trabajo real (descarga de media, STT, IA,
 * envío) corre aquí con reintentos. Así Meta recibe su 200 de inmediato.
 */
@Injectable()
export class WhatsappCola implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WhatsappCola.name);
  private entrantes!: Queue<MensajeEntrante>;
  private seguimiento!: Queue<TrabajoSeguimiento>;
  private workers: Worker[] = [];

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly conversaciones: ConversacionService,
  ) {}

  onModuleInit(): void {
    this.entrantes = new Queue(COLA_ENTRANTES, { connection: this.redis });
    this.seguimiento = new Queue(COLA_SEGUIMIENTO, { connection: this.redis });

    this.workers.push(
      new Worker<MensajeEntrante>(
        COLA_ENTRANTES,
        async (job) => this.conversaciones.procesar(job.data),
        // Varias conversaciones a la vez, pero acotado: cada una llama al modelo.
        { connection: this.redis, concurrency: 4 },
      ),
    );

    this.workers.push(
      new Worker<TrabajoSeguimiento>(
        COLA_SEGUIMIENTO,
        async (job) => this.conversaciones.seguimientoPortal(job.data),
        { connection: this.redis, concurrency: 2 },
      ),
    );

    for (const w of this.workers) {
      w.on('failed', (job, err) => this.log.error(`Trabajo ${job?.id} falló: ${err.message}`));
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await this.entrantes?.close();
    await this.seguimiento?.close();
  }

  async encolarEntrante(mensaje: MensajeEntrante): Promise<void> {
    await this.entrantes.add('procesar', mensaje, {
      // El id de Meta como jobId: si Meta reintenta el webhook, BullMQ deduplica.
      jobId: mensaje.waMessageId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    });
  }

  /**
   * RN-09.8 · seguimiento si el paciente eligió la web y no completó.
   * Se programa con retraso; al dispararse se verifica que no haya cita creada.
   */
  async programarSeguimiento(trabajo: TrabajoSeguimiento, minutos: number): Promise<void> {
    await this.seguimiento.add('seguir', trabajo, {
      jobId: `seguimiento-${trabajo.conversacionId}`,
      delay: minutos * 60_000,
      attempts: 2,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    });
  }
}
