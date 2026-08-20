import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { aHHMM, fechaEnZona } from '@provivir/shared';
import { REDIS } from '../colas/colas.module';
import { PrismaService } from '../prisma/prisma.service';
import { MetaCliente } from '../whatsapp/meta.cliente';
import { ticketRecordatorio } from '../whatsapp/whatsapp.plantillas';
import { AuditoriaService } from '../auditoria/auditoria.service';

export const COLA_RECORDATORIOS = 'recordatorios';

interface TrabajoRecordatorio {
  citaId: string;
  cuando: '24h' | 'hoy';
}

/**
 * Recordatorios programados (Guía, FASE 4): 24 h antes y el mismo día.
 *
 * Van por cola con reintentos: un envío fallido de WhatsApp no debe perderse en
 * silencio, y tampoco debe bloquear nada (Arquitectura §1.6).
 */
@Injectable()
export class RecordatoriosService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RecordatoriosService.name);
  private cola!: Queue<TrabajoRecordatorio>;
  private worker!: Worker<TrabajoRecordatorio>;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly meta: MetaCliente,
    private readonly auditoria: AuditoriaService,
  ) {}

  onModuleInit(): void {
    this.cola = new Queue(COLA_RECORDATORIOS, { connection: this.redis });
    this.worker = new Worker<TrabajoRecordatorio>(
      COLA_RECORDATORIOS,
      async (job) => this.enviar(job.data),
      { connection: this.redis, concurrency: 5 },
    );
    this.worker.on('failed', (job, err) =>
      this.log.error(`Recordatorio ${job?.id} falló: ${err.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.cola?.close();
  }

  /**
   * Programa los dos recordatorios de una cita. El retraso se calcula contra la
   * hora real de la cita: si ya pasó el momento del recordatorio, no se programa.
   */
  async programar(citaId: string, fecha: Date, horaInicioMin: number): Promise<void> {
    const momentoCita = new Date(fecha.getTime() + horaInicioMin * 60_000);
    const ahora = Date.now();

    const planes: Array<{ cuando: '24h' | 'hoy'; ts: number }> = [
      { cuando: '24h', ts: momentoCita.getTime() - 24 * 3_600_000 },
      { cuando: 'hoy', ts: momentoCita.getTime() - 3 * 3_600_000 },
    ];

    for (const plan of planes) {
      const retraso = plan.ts - ahora;
      if (retraso <= 0) continue;

      await this.cola.add(
        'recordar',
        { citaId, cuando: plan.cuando },
        {
          jobId: `recordatorio-${citaId}-${plan.cuando}`,
          delay: retraso,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 200 },
        },
      );
    }
  }

  /** Al cancelar o reprogramar, los recordatorios viejos ya no aplican. */
  async cancelar(citaId: string): Promise<void> {
    for (const cuando of ['24h', 'hoy']) {
      const job = await this.cola.getJob(`recordatorio-${citaId}-${cuando}`);
      await job?.remove().catch(() => undefined);
    }
  }

  private async enviar(trabajo: TrabajoRecordatorio): Promise<void> {
    const cita = await this.prisma.cita.findUnique({
      where: { id: trabajo.citaId },
      include: { paciente: true, prestador: true, servicio: true },
    });

    // La cita pudo cancelarse entre la programación y el envío.
    if (!cita || cita.estado === 'cancelada') return;

    const destino = cita.paciente.whatsapp ?? cita.paciente.telefono;
    if (!destino) {
      this.log.warn(`Cita ${cita.codigo} sin número de contacto: no se envía recordatorio`);
      return;
    }

    const texto = ticketRecordatorio(
      {
        codigo: cita.codigo,
        paciente: `${cita.paciente.nombres} ${cita.paciente.apellidos}`,
        servicio: cita.servicio.nombre,
        prestador: cita.prestador.nombre,
        fecha: fechaEnZona(cita.fecha),
        hora: aHHMM(cita.horaInicio),
        consultorio: cita.prestador.consultorio,
      },
      trabajo.cuando,
    );

    await this.meta.enviarTexto(destino, texto);

    await this.auditoria.registrar({
      usuario: 'sistema',
      accion: `Recordatorio ${trabajo.cuando} enviado`,
      entidad: `cita/${cita.codigo}`,
      detalle: 'WhatsApp (texto formateado)',
    });
  }
}
