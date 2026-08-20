import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { TurnosGateway } from '../turnos/turnos.gateway';
import { ConversacionService } from '../whatsapp/conversacion.service';
import { minutosEsperando } from '../turnos/turnos.reglas';

const PESO: Record<string, number> = { alta: 0, media: 1, baja: 2 };

/**
 * Bandeja de la asistente (RN-08.3, Especificación §2.9).
 *
 * Muestra motivo, prioridad, tiempo esperando e historial. La asistente toma la
 * conversación y responde por WhatsApp desde la plataforma.
 */
@Injectable()
export class BandejaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversaciones: ConversacionService,
    private readonly auditoria: AuditoriaService,
    private readonly gateway: TurnosGateway,
  ) {}

  /**
   * RN-05.3 · mientras el cliente no defina los criterios de prioridad (P4),
   * la columna operativa dominante es el TIEMPO DE ESPERA. Por eso el orden es
   * prioridad y, dentro de ella, quien lleva más esperando primero.
   */
  async pendientes() {
    const conversaciones = await this.prisma.conversacion.findMany({
      where: { escalada: true, resueltaTs: null },
      include: {
        paciente: { select: { id: true, nombres: true, apellidos: true, documento: true } },
        mensajes: { orderBy: { ts: 'desc' }, take: 1 },
      },
    });

    return conversaciones
      .map((c) => ({
        id: c.id,
        telefono: c.telefono,
        paciente: c.paciente,
        motivo: c.motivo,
        prioridad: c.prioridad,
        intencion: c.intencion,
        tomadaPor: c.tomadaPor,
        estado: c.estado,
        // RN-08.3 · para que la espera "no se vuelva paisaje".
        minutosEsperando: c.escaladaTs ? minutosEsperando(c.escaladaTs) : 0,
        ultimoMensaje: c.mensajes[0]?.contenido ?? null,
      }))
      .sort(
        (a, b) =>
          (PESO[a.prioridad] ?? 9) - (PESO[b.prioridad] ?? 9) ||
          b.minutosEsperando - a.minutosEsperando,
      );
  }

  async conteoPendientes(): Promise<number> {
    return this.prisma.conversacion.count({ where: { escalada: true, resueltaTs: null } });
  }

  /** Historial completo, con la media adjunta que el paciente envió (RN-09.2). */
  async detalle(id: string) {
    const conversacion = await this.prisma.conversacion.findUnique({
      where: { id },
      include: {
        paciente: true,
        mensajes: { orderBy: { ts: 'asc' } },
      },
    });
    if (!conversacion) throw new NotFoundException('Conversación no encontrada');

    return {
      ...conversacion,
      minutosEsperando: conversacion.escaladaTs ? minutosEsperando(conversacion.escaladaTs) : 0,
    };
  }

  async tomar(id: string, usuarioId: string) {
    const conversacion = await this.prisma.conversacion.findUnique({ where: { id } });
    if (!conversacion) throw new NotFoundException('Conversación no encontrada');
    if (conversacion.tomadaPor && conversacion.tomadaPor !== usuarioId) {
      throw new BadRequestException('Otra asistente ya tomó esta conversación');
    }

    const actualizada = await this.prisma.conversacion.update({
      where: { id },
      data: { tomadaPor: usuarioId, estado: 'en_gestion' },
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Conversación tomada',
      entidad: `conversacion/${id}`,
      estadoPrev: 'escalada',
      estadoNext: 'en_gestion',
    });

    this.gateway.emitirPendientesBandeja(await this.conteoPendientes());
    return actualizada;
  }

  /** La asistente responde por WhatsApp sin salir de la plataforma (RN-08.3). */
  async responder(id: string, texto: string, usuarioId: string) {
    const conversacion = await this.prisma.conversacion.findUnique({ where: { id } });
    if (!conversacion) throw new NotFoundException('Conversación no encontrada');

    await this.conversaciones.enviar(id, conversacion.telefono, texto);

    if (!conversacion.tomadaPor) {
      await this.prisma.conversacion.update({
        where: { id },
        data: { tomadaPor: usuarioId, estado: 'en_gestion' },
      });
    }

    return { enviado: true };
  }

  async resolver(id: string, usuarioId: string) {
    const conversacion = await this.prisma.conversacion.findUnique({ where: { id } });
    if (!conversacion) throw new NotFoundException('Conversación no encontrada');

    const resuelta = await this.prisma.conversacion.update({
      where: { id },
      data: { estado: 'resuelta', resueltaTs: new Date() },
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Conversación resuelta',
      entidad: `conversacion/${id}`,
      detalle: conversacion.escaladaTs
        ? `Atendida tras ${minutosEsperando(conversacion.escaladaTs)} min de espera`
        : undefined,
      estadoPrev: conversacion.estado,
      estadoNext: 'resuelta',
    });

    this.gateway.emitirPendientesBandeja(await this.conteoPendientes());
    return resuelta;
  }
}
