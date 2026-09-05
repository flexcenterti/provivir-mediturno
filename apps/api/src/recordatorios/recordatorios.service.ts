import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { aHHMM } from '@provivir/shared';
import { REDIS } from '../colas/colas.module';
import { PrismaService } from '../prisma/prisma.service';
import { MetaCliente } from '../whatsapp/meta.cliente';
import { VentanaService } from '../whatsapp/ventana.service';
import {
  parametrosTicket, ticketCancelacion, ticketConfirmacion, ticketRecordatorio,
  ticketReprogramacion, type DatosTicket,
} from '../whatsapp/whatsapp.plantillas';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { decidirEnvio } from './recordatorios.decision';
import { numeroDeContacto } from '../comun/contacto';

export const COLA_RECORDATORIOS = 'recordatorios';

/**
 * `confirmacion` es RN-10.3: sale al agendar, no antes de la cita. `cancelacion` y
 * `reprogramacion` salen cuando la asistente cambia la cita, y van por aquí para
 * heredar la ventana de 24 h, la plantilla y el descarte con auditoría — que es todo
 * lo que hace falta y ya estaba escrito.
 */
type Momento = '24h' | 'hoy' | 'confirmacion' | 'cancelacion' | 'reprogramacion';

interface TrabajoRecordatorio {
  citaId: string;
  cuando: Momento;
  /** Solo en `cancelacion`: la cita ya estará cancelada cuando el worker la lea. */
  motivo?: string;
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
  // La reprogramación reutiliza la de confirmación: sus cuatro variables son
  // exactamente los datos nuevos de la cita. Cancelar dice lo contrario, así que
  // esa sí necesita plantilla propia.
  reprogramacion: 'plantilla_confirmacion_cita',
  cancelacion: 'plantilla_cancelacion_cita',
};

const ETIQUETA: Record<Momento, string> = {
  '24h': 'Recordatorio 24h',
  hoy: 'Recordatorio del día',
  confirmacion: 'Confirmación de cita',
  reprogramacion: 'Aviso de reprogramación',
  cancelacion: 'Aviso de cancelación',
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
    private readonly ventana: VentanaService,
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

  /**
   * Avisos de un cambio hecho desde el backoffice. Van por la cola y no en la
   * transacción de la cita: que WhatsApp esté caído no puede impedir cancelarla.
   *
   * La asistente decide en cada caso si se avisa; cuando dice que no, no se llama a
   * esto y queda en auditoría que fue su decisión.
   */
  async programarCancelacion(citaId: string, motivo: string): Promise<void> {
    await this.encolarAviso(citaId, 'cancelacion', motivo);
  }

  async programarReprogramacion(citaId: string): Promise<void> {
    await this.encolarAviso(citaId, 'reprogramacion');
  }

  private async encolarAviso(citaId: string, cuando: Momento, motivo?: string): Promise<void> {
    await this.cola.add(
      'recordar',
      { citaId, cuando, motivo },
      {
        // Con la marca de tiempo: una cita se puede mover varias veces el mismo día,
        // y un jobId fijo haría que el segundo aviso no se encolara.
        jobId: `${cuando}-${citaId}-${Date.now()}`,
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

  /** Dentro de la ventana va texto libre, y cada momento tiene el suyo. */
  private textoDe(trabajo: TrabajoRecordatorio, datos: DatosTicket): string {
    switch (trabajo.cuando) {
      case 'confirmacion': return ticketConfirmacion(datos);
      case 'reprogramacion': return ticketReprogramacion(datos);
      case 'cancelacion':
        return ticketCancelacion(datos, trabajo.motivo ?? 'Cancelada por la clínica');
      default: return ticketRecordatorio(datos, trabajo.cuando);
    }
  }

  private async enviar(trabajo: TrabajoRecordatorio): Promise<void> {
    const cita = await this.prisma.cita.findUnique({
      where: { id: trabajo.citaId },
      include: { paciente: true, prestador: true, servicio: true },
    });

    if (!cita) return;
    // La cita pudo cancelarse entre la programación y el envío. El aviso DE la
    // cancelación es justo el que sí tiene que salir con la cita ya cancelada.
    if (cita.estado === 'cancelada' && trabajo.cuando !== 'cancelacion') return;

    const destino = numeroDeContacto(cita.paciente);
    if (!destino) {
      this.log.warn(`Cita ${cita.codigo} sin número de contacto: no se envía recordatorio`);
      return;
    }

    const datos = {
      codigo: cita.codigo,
      paciente: `${cita.paciente.nombres} ${cita.paciente.apellidos}`,
      servicio: cita.servicio.nombre,
      prestador: cita.prestador.nombre,
      /*
       * En UTC, NO con `fechaEnZona()`. Las fechas se guardan como medianoche UTC y
       * leerlas en la zona de la sede (UTC−5) las corre un día hacia atrás: el
       * recordatorio de una cita del 21 anunciaba el 20. La fase 11 lo dejó anotado
       * y sin corregir; se arregla aquí porque ahora este mismo objeto alimenta
       * también los avisos de cancelación y de reprogramación.
       */
      fecha: cita.fecha.toISOString().slice(0, 10),
      hora: aHHMM(cita.horaInicio),
      consultorio: cita.prestador.consultorio,
      indicaciones: cita.servicio.requiereOrden
        ? 'Recuerda traer tu orden médica el día de la cita.'
        : undefined,
    };

    // La ventana de 24 h la abre el PACIENTE con su último mensaje entrante, en
    // cualquier conversación de ese número. Un recordatorio sale 24 h o 3 h antes
    // de la cita, así que lo normal es que ya esté cerrada.
    const ventana = await this.ventana.estado(destino);

    const etiqueta = ETIQUETA[trabajo.cuando];
    const decision = decidirEnvio({
      ultimoMensajePaciente: ventana.ultimoEntranteTs,
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

    try {
      if (decision.modo === 'plantilla') {
        await this.meta.enviarPlantilla(destino, decision.nombre, parametrosTicket(datos));
      } else {
        await this.meta.enviarTexto(destino, this.textoDe(trabajo, datos));
      }
    } catch (e) {
      /*
       * Un rechazo duro de Meta —el número no tiene WhatsApp, #131026— dejaba de
       * rastro una línea de log tras agotar los tres reintentos, y nada más. Cuando
       * el cliente apruebe las plantillas esa va a ser la causa número uno de «no le
       * llegó», y la asistente no tenía dónde verlo.
       *
       * Se audita y se relanza: el reintento sigue teniendo sentido para un fallo
       * pasajero, y lo que no puede es agotarse en silencio.
       */
      const motivo = e instanceof Error ? e.message : String(e);
      await this.auditoria.registrar({
        usuario: 'sistema',
        accion: `${etiqueta} no enviado`,
        entidad: `cita/${cita.codigo}`,
        detalle: `WhatsApp rechazó el envío: ${motivo.slice(0, 300)}`,
      });
      throw e;
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
