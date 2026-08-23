import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { aHHMM, fechaEnZona } from '@provivir/shared';
import { REDIS } from '../colas/colas.module';
import { PrismaService } from '../prisma/prisma.service';
import { MetaCliente } from '../whatsapp/meta.cliente';
import {
  parametrosTicket, ticketConfirmacion, ticketRecordatorio,
} from '../whatsapp/whatsapp.plantillas';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { decidirEnvio } from './recordatorios.decision';

export const COLA_RECORDATORIOS = 'recordatorios';

/** `confirmacion` es RN-10.3: sale al agendar, no antes de la cita. */
type Momento = '24h' | 'hoy' | 'confirmacion';

interface TrabajoRecordatorio {
  citaId: string;
  cuando: Momento;
}

/**
 * Plantilla aprobada en Meta para cada envío, por configuración: los nombres los
 * define el cliente en su Business Manager y pueden cambiar sin desplegar (P12).
 * Vacío = no hay plantilla, y fuera de la ventana el envío se descarta con motivo.
 */
const CLAVE_PLANTILLA: Record<Momento, string> = {
  '24h': 'plantilla_recordatorio_24h',
  hoy: 'plantilla_recordatorio_hoy',
  confirmacion: 'plantilla_confirmacion_cita',
};

const ETIQUETA: Record<Momento, string> = {
  '24h': 'Recordatorio 24h',
  hoy: 'Recordatorio del día',
  confirmacion: 'Confirmación de cita',
};

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
    private readonly configuracion: ConfiguracionService,
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

  /**
   * RN-10.3 · confirmación inmediata de una cita agendada por el portal.
   *
   * Va por la misma cola que los recordatorios para heredar sus reintentos y su
   * política de ventana; lo único distinto es que no se difiere. El bot de
   * WhatsApp NO la usa: cuando agenda él, ya responde con el ticket en la propia
   * conversación, y mandarlo dos veces es peor que no mandarlo.
   */
  async programarConfirmacion(citaId: string): Promise<void> {
    await this.cola.add(
      'recordar',
      { citaId, cuando: 'confirmacion' },
      {
        jobId: `confirmacion-${citaId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
      },
    );
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

    const datos = {
      codigo: cita.codigo,
      paciente: `${cita.paciente.nombres} ${cita.paciente.apellidos}`,
      servicio: cita.servicio.nombre,
      prestador: cita.prestador.nombre,
      fecha: fechaEnZona(cita.fecha),
      hora: aHHMM(cita.horaInicio),
      consultorio: cita.prestador.consultorio,
      indicaciones: cita.servicio.requiereOrden
        ? 'Recuerda traer tu orden médica el día de la cita.'
        : undefined,
    };

    // La ventana de 24 h la abre el PACIENTE con su último mensaje entrante, en
    // cualquier conversación de ese número. Un recordatorio sale 24 h o 3 h antes
    // de la cita, así que lo normal es que ya esté cerrada.
    const ultimoEntrante = await this.prisma.mensaje.findFirst({
      where: { direccion: 'entrante', conversacion: { telefono: destino } },
      orderBy: { ts: 'desc' },
      select: { ts: true },
    });

    const etiqueta = ETIQUETA[trabajo.cuando];
    const decision = decidirEnvio({
      ultimoMensajePaciente: ultimoEntrante?.ts ?? null,
      ahora: new Date(),
      plantilla: this.configuracion.texto(CLAVE_PLANTILLA[trabajo.cuando], ''),
    });

    if (decision.modo === 'descartar') {
      // Sin `throw`: Meta lo rechazaría con #131047 y reintentar no cambia el
      // resultado. Lo que sí importa es que no se pierda en silencio.
      this.log.warn(`${etiqueta} de la cita ${cita.codigo} no enviado: ${decision.motivo}`);
      await this.auditoria.registrar({
        usuario: 'sistema',
        accion: `${etiqueta} no enviado`,
        entidad: `cita/${cita.codigo}`,
        detalle: decision.motivo,
      });
      return;
    }

    if (decision.modo === 'plantilla') {
      await this.meta.enviarPlantilla(destino, decision.nombre, parametrosTicket(datos));
    } else {
      await this.meta.enviarTexto(
        destino,
        trabajo.cuando === 'confirmacion'
          ? ticketConfirmacion(datos)
          : ticketRecordatorio(datos, trabajo.cuando),
      );
    }

    await this.auditoria.registrar({
      usuario: 'sistema',
      accion: `${etiqueta} enviado`,
      entidad: `cita/${cita.codigo}`,
      detalle: decision.modo === 'plantilla'
        ? `WhatsApp (plantilla ${decision.nombre})`
        : 'WhatsApp (texto formateado)',
    });
  }
}
