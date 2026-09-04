import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { TurnosGateway } from '../turnos/turnos.gateway';
import { ConversacionService } from '../whatsapp/conversacion.service';
import { minutosEsperando } from '../turnos/turnos.reglas';
import { mimeDeExtension } from '../whatsapp/media.tipos';

const PESO: Record<string, number> = { alta: 0, media: 1, baja: 2 };

/**
 * Bandeja de la asistente (RN-08.3, Especificación §2.9).
 *
 * Muestra motivo, prioridad, tiempo esperando e historial. La asistente toma la
 * conversación y responde por WhatsApp desde la plataforma.
 */
@Injectable()
export class BandejaService {
  private readonly log = new Logger(BandejaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversaciones: ConversacionService,
    private readonly auditoria: AuditoriaService,
    private readonly gateway: TurnosGateway,
    private readonly config: ConfigService,
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

  /**
   * RN-08.1 · el adjunto es el soporte con el que trabaja la asistente. Si la orden
   * médica escaneada no se puede abrir, el escalamiento no sirve de nada: ve la
   * referencia al documento y sigue sin poder atender.
   *
   * La ruta NUNCA llega del cliente. Se direcciona por id de mensaje y sale de la base
   * de datos, así que la travesía de rutas no es posible por construcción; la
   * comprobación contra DIR_MEDIA es defensa en profundidad por si un valor almacenado
   * se corrompiera.
   */
  async mediaDeMensaje(mensajeId: string, usuarioId: string) {
    const mensaje = await this.prisma.mensaje.findUnique({
      where: { id: mensajeId },
      select: { id: true, conversacionId: true, tipo: true, contenido: true, mediaPath: true },
    });
    if (!mensaje?.mediaPath) throw new NotFoundException('El mensaje no tiene adjunto');

    const raiz = resolve(this.config.get<string>('DIR_MEDIA') || 'media');
    const ruta = resolve(mensaje.mediaPath);
    if (!ruta.startsWith(raiz + sep)) {
      this.log.error(`Adjunto fuera de DIR_MEDIA: mensaje ${mensajeId}`);
      throw new NotFoundException('Adjunto no disponible');
    }

    if (!existsSync(ruta)) {
      // Consta en la conversación pero no está en disco: es un incidente operativo,
      // no un 404 cualquiera, y tiene que poder investigarse.
      this.log.warn(`Adjunto ausente en disco: mensaje ${mensajeId} · ${basename(ruta)}`);
      throw new NotFoundException('Adjunto no disponible');
    }

    // Es un dato del paciente: queda trazado quién lo abrió (auditoría append-only).
    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Adjunto consultado',
      entidad: `mensaje/${mensajeId}`,
      detalle: `Conversación ${mensaje.conversacionId} · ${mensaje.tipo}`,
    });

    return {
      ruta,
      contentType: mimeDeExtension(ruta),
      nombreDescarga: nombreSeguro(mensaje.contenido) ?? basename(ruta),
    };
  }
}

/**
 * El nombre que muestra WhatsApp lo escribe el paciente, así que no puede ir tal cual
 * a una cabecera: un salto de línea o una comilla dentro del `Content-Disposition`
 * permitiría inyectar cabeceras. Se queda solo lo imprimible y sin comillas.
 */
function nombreSeguro(nombre: string | null): string | undefined {
  if (!nombre) return undefined;
  const limpio = nombre.replace(/[^\p{L}\p{N} ._()-]/gu, '').trim().slice(0, 80);
  return limpio || undefined;
}
