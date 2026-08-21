import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SEDE_ID } from '@provivir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { TurnosGateway } from '../turnos/turnos.gateway';
import { IaService } from '../ia/ia.service';
import type { MensajeLlm } from '../ia/ia.tipos';
import { MetaCliente } from './meta.cliente';
import { TranscripcionService } from './transcripcion.service';
import { variantesDeTelefono } from './whatsapp.normalizador';
import { enmascararTelefono } from '../comun/pii';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { WhatsappCola, type TrabajoSeguimiento } from './whatsapp.cola';
import type { MensajeEntrante } from './whatsapp.tipos';

/** Turnos previos que se le pasan al modelo. Más historial no mejora y encarece cada mensaje. */
const HISTORIAL_MAX = 20;

/**
 * Palabras con las que un paciente pide explícitamente atención humana.
 * Se revisan antes de invocar al modelo: si alguien pide una persona, no debe
 * gastar un turno de IA para conseguirla (RN-08.1).
 */
const PIDE_HUMANO = /\b(asesor|asistente|persona|humano|operador|secretaria|alguien\s+real)\b/i;

@Injectable()
export class ConversacionService {
  private readonly log = new Logger(ConversacionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ia: IaService,
    private readonly meta: MetaCliente,
    private readonly stt: TranscripcionService,
    private readonly auditoria: AuditoriaService,
    private readonly gateway: TurnosGateway,
    private readonly config: ConfigService,
    private readonly configuracion: ConfiguracionService,
    // La cola agenda el seguimiento y la cola invoca a este servicio: referencia circular.
    @Inject(forwardRef(() => WhatsappCola)) private readonly cola: WhatsappCola,
  ) {}

  /**
   * Procesa un mensaje entrante de punta a punta: persiste, decide si escala
   * y responde. Corre en el worker de la cola, nunca en el webhook.
   */
  async procesar(entrante: MensajeEntrante): Promise<void> {
    const conversacion = await this.obtenerOCrear(entrante);

    // Idempotencia: Meta reintenta el webhook si no respondemos rápido.
    const yaVisto = await this.prisma.mensaje.findUnique({
      where: { waMessageId: entrante.waMessageId },
    });
    if (yaVisto) {
      this.log.debug(`Mensaje ${entrante.waMessageId} ya procesado; se ignora el reintento`);
      return;
    }

    const { texto, mediaPath, transcripcion, escalarPorMedia } = await this.materializar(entrante);

    await this.prisma.mensaje.create({
      data: {
        conversacionId: conversacion.id,
        direccion: 'entrante',
        tipo: entrante.tipo,
        contenido: texto ?? null,
        mediaPath: mediaPath ?? null,
        transcripcion: transcripcion ?? null,
        waMessageId: entrante.waMessageId,
        ts: entrante.ts,
      },
    });

    // Si la conversación ya está en manos de una asistente, la IA no interviene.
    if (conversacion.estado === 'escalada' || conversacion.estado === 'en_gestion') {
      this.gateway.emitirPendientesBandeja(await this.pendientes());
      return;
    }

    if (escalarPorMedia) {
      await this.escalar(conversacion.id, escalarPorMedia.motivo, escalarPorMedia.prioridad, escalarPorMedia.aviso);
      return;
    }

    if (texto && PIDE_HUMANO.test(texto)) {
      await this.escalar(
        conversacion.id,
        'El paciente solicitó hablar con una persona',
        'media',
        'Con gusto. Te comunico con una de nuestras asistentes, en un momento te contactan.',
      );
      return;
    }

    if (!texto) {
      // Video, sticker o adjunto sin texto ni transcripción: no hay nada que interpretar.
      await this.escalar(
        conversacion.id,
        `Adjunto de tipo ${entrante.tipo} que la plataforma no interpreta`,
        'media',
        'Recibí tu mensaje. Una asistente lo revisa y te contacta en un momento.',
      );
      return;
    }

    await this.responderConIa(conversacion.id, entrante.telefono, texto);
  }

  /**
   * RN-08.1 · la foto de una orden médica escala de inmediato y automáticamente,
   * SIN intento de lectura por IA. La imagen queda adjunta como soporte.
   *
   * La caligrafía médica no es legible con confianza y la orden es apoyo, no fuente
   * de verdad del sistema. Aquí se descarga y se marca, nunca se interpreta.
   */
  private async materializar(entrante: MensajeEntrante): Promise<{
    texto?: string;
    mediaPath?: string;
    transcripcion?: string;
    escalarPorMedia?: { motivo: string; prioridad: 'alta' | 'media' | 'baja'; aviso: string };
  }> {
    if (entrante.tipo === 'texto') return { texto: entrante.texto };

    const mediaPath = entrante.mediaId
      ? ((await this.meta.descargarMedia(entrante.mediaId, entrante.mimeType)) ?? undefined)
      : undefined;

    if (entrante.tipo === 'imagen' || entrante.tipo === 'documento') {
      return {
        texto: entrante.texto,
        mediaPath,
        escalarPorMedia: {
          motivo: 'Imagen o documento del paciente (posible orden médica) - sin lectura por IA (RN-08)',
          prioridad: 'media',
          aviso:
            'Recibí tu documento. Para este tipo de solicitudes te atiende directamente una de ' +
            'nuestras asistentes, con la imagen como soporte. En un momento te contactamos.',
        },
      };
    }

    if (entrante.tipo === 'audio') {
      const transcripcion = mediaPath ? await this.stt.transcribir(mediaPath) : null;

      if (transcripcion) return { texto: transcripcion, mediaPath, transcripcion };

      // Sin transcripción NO se adivina el contenido: escala con el audio adjunto.
      return {
        mediaPath,
        escalarPorMedia: {
          motivo: 'Nota de voz sin transcripción disponible',
          prioridad: 'media',
          aviso: 'Recibí tu nota de voz. Una asistente la escucha y te responde en un momento.',
        },
      };
    }

    return { texto: entrante.texto, mediaPath };
  }

  private async responderConIa(conversacionId: string, telefono: string, texto: string): Promise<void> {
    const conversacion = await this.prisma.conversacion.findUniqueOrThrow({
      where: { id: conversacionId },
    });

    const historial = await this.historial(conversacionId);

    const resultado = await this.ia.responder(
      {
        conversacionId,
        telefono,
        pacienteId: conversacion.pacienteId ?? undefined,
        historial,
        yaOfrecioWeb: Boolean(conversacion.intencion?.includes('web-ofrecida')),
      },
      texto,
    );

    if (resultado.respuesta) {
      await this.enviar(conversacionId, telefono, resultado.respuesta);
    }

    await this.prisma.conversacion.update({
      where: { id: conversacionId },
      data: {
        ...(resultado.pacienteId ? { pacienteId: resultado.pacienteId } : {}),
        ...(resultado.ofrecioWeb ? { intencion: 'agendamiento web-ofrecida' } : {}),
      },
    });

    // RN-09.8 - si se ofreció la web y no se cerró la cita en el chat, se programa
    // el seguimiento. Al dispararse se verifica que no exista cita antes de escribir.
    if (resultado.ofrecioWeb && !resultado.citaCreada && !resultado.escalar) {
      const minutos = this.configuracion.numero('whatsapp_seguimiento_portal_min', 30);
      await this.cola.programarSeguimiento({ conversacionId, telefono }, minutos);
    }

    if (resultado.escalar) {
      await this.escalar(conversacionId, resultado.escalar.motivo, resultado.escalar.prioridad);
    }

    if (resultado.citaCreada) {
      await this.auditoria.registrar({
        usuario: 'ia',
        accion: 'Cita creada por la IA',
        entidad: `cita/${resultado.citaCreada.codigo}`,
        detalle: `Conversación ${conversacionId} - ${resultado.turnos} turno(s) de herramientas`,
      });
    }
  }

  /**
   * RN-08.3 · al escalar se marca el instante, que alimenta la columna
   * "tiempo esperando" de la bandeja, y se refresca la burbuja de pendientes.
   */
  async escalar(
    conversacionId: string,
    motivo: string,
    prioridad: 'alta' | 'media' | 'baja',
    avisoAlPaciente?: string,
  ): Promise<void> {
    const conversacion = await this.prisma.conversacion.update({
      where: { id: conversacionId },
      data: { estado: 'escalada', escalada: true, escaladaTs: new Date(), motivo, prioridad },
    });

    if (avisoAlPaciente) {
      await this.enviar(conversacionId, conversacion.telefono, avisoAlPaciente);
    }

    await this.auditoria.registrar({
      usuario: 'ia',
      accion: 'Escalamiento a asistente',
      entidad: `conversacion/${conversacionId}`,
      detalle: motivo,
      estadoPrev: 'ia_activa',
      estadoNext: 'escalada',
    });

    this.log.log(`Conversación escalada (${enmascararTelefono(conversacion.telefono)}): ${motivo}`);

    // RN-08.3 · burbuja roja con el conteo, SIN sonido (decisión explícita del cliente).
    this.gateway.emitirPendientesBandeja(await this.pendientes());
  }

  /** Envía y persiste. El envío real va por cola con reintentos (whatsapp.cola.ts). */
  async enviar(conversacionId: string, telefono: string, texto: string): Promise<void> {
    const waMessageId = await this.meta.enviarTexto(telefono, texto);

    await this.prisma.mensaje.create({
      data: {
        conversacionId,
        direccion: 'saliente',
        tipo: 'texto',
        contenido: texto,
        waMessageId: waMessageId || null,
      },
    });
  }

  /**
   * RN-09.8 - seguimiento del portal. Solo escribe si el paciente NO agendó:
   * insistirle a quien ya tiene su cita es peor que no hacer seguimiento.
   */
  async seguimientoPortal(trabajo: TrabajoSeguimiento): Promise<void> {
    const conversacion = await this.prisma.conversacion.findUnique({
      where: { id: trabajo.conversacionId },
    });
    if (!conversacion) return;

    // Si ya la toma una asistente o se resolvió, el bot no interviene.
    if (conversacion.resueltaTs || conversacion.estado === 'escalada' || conversacion.estado === 'en_gestion') {
      return;
    }

    const desde = conversacion.creadoEn;
    const yaAgendo = await this.prisma.cita.count({
      where: {
        creadoEn: { gte: desde },
        estado: { not: 'cancelada' },
        ...(conversacion.pacienteId
          ? { pacienteId: conversacion.pacienteId }
          : { paciente: { OR: [
              { telefono: { in: variantesDeTelefono(trabajo.telefono) } },
              { whatsapp: { in: variantesDeTelefono(trabajo.telefono) } },
            ] } }),
      },
    });

    if (yaAgendo > 0) {
      this.log.debug(`Seguimiento omitido: ${enmascararTelefono(trabajo.telefono)} ya agendó`);
      return;
    }

    await this.enviar(
      trabajo.conversacionId,
      trabajo.telefono,
      '¿Pudiste agendar tu cita? Si prefieres, te ayudo por aquí: dime qué servicio necesitas.',
    );
  }

  async pendientes(): Promise<number> {
    return this.prisma.conversacion.count({ where: { escalada: true, resueltaTs: null } });
  }

  /** Reconstruye el historial en el formato del SDK, del más antiguo al más reciente. */
  private async historial(conversacionId: string): Promise<MensajeLlm[]> {
    const mensajes = await this.prisma.mensaje.findMany({
      where: { conversacionId, tipo: { in: ['texto', 'audio'] } },
      orderBy: { ts: 'desc' },
      take: HISTORIAL_MAX,
    });

    return mensajes
      .reverse()
      .map((m): MensajeLlm => ({
        rol: m.direccion === 'entrante' ? 'usuario' : 'asistente',
        contenido: m.transcripcion ?? m.contenido ?? '',
      }))
      .filter((m) => m.contenido.length > 0);
  }

  /**
   * Una conversación viva por teléfono. Se intenta atar al paciente por sus
   * variantes de número, porque la base cargada trae formatos mezclados.
   */
  private async obtenerOCrear(entrante: MensajeEntrante) {
    const abierta = await this.prisma.conversacion.findFirst({
      where: { telefono: entrante.telefono, resueltaTs: null },
      orderBy: { creadoEn: 'desc' },
    });
    if (abierta) return abierta;

    const paciente = await this.prisma.paciente.findFirst({
      where: {
        OR: [
          { telefono: { in: variantesDeTelefono(entrante.telefono) } },
          { whatsapp: { in: variantesDeTelefono(entrante.telefono) } },
        ],
      },
      select: { id: true },
    });

    return this.prisma.conversacion.create({
      data: {
        telefono: entrante.telefono,
        pacienteId: paciente?.id ?? null,
        estado: 'ia_activa',
        sedeId: this.config.get<string>('SEDE_ID') ?? SEDE_ID,
      },
    });
  }
}
