import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage,
  WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { permisosDe } from '../auth/permisos.resolucion';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/auth.types';

export interface LlamadoEmitido {
  turnoId: string;
  codigo: string;
  paciente: string;
  prestador: string;
  consultorio: string | null;
  servicioId: string;
  ts: string;
}

/**
 * RN-11 · Llamados en tiempo real hacia las pantallas de sala.
 *
 * Cada pantalla se suscribe a su propia sala y recibe solo los llamados de los
 * servicios que tiene configurados (RN-11.1: la configuración es por sala/servicio).
 */
@WebSocketGateway({
  namespace: '/tiempo-real',
  cors: { origin: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean) },
})
export class TurnosGateway implements OnGatewayConnection {
  private readonly log = new Logger(TurnosGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  handleConnection(cliente: Socket): void {
    this.log.debug(`Cliente conectado a tiempo real: ${cliente.id}`);
  }

  @SubscribeMessage('suscribir-pantalla')
  suscribirPantalla(@ConnectedSocket() cliente: Socket, @MessageBody() pantallaId: string): { ok: boolean } {
    void cliente.join(`pantalla:${pantallaId}`);
    return { ok: true };
  }

  /**
   * El backoffice escucha los cambios de cola para refrescar sin recargar.
   *
   * **Exige sesión, a diferencia de `suscribir-pantalla`.** Por esta sala viaja
   * `llamado`, que lleva el nombre del paciente: sin verificar nada, cualquiera que
   * alcanzara el servidor podía escucharlos. La pantalla de sala no tiene sesión que
   * ofrecer —es un televisor— y por eso su suscripción se queda como está; el
   * backoffice sí la tiene, así que aquí no hay excusa.
   *
   * Los permisos NO viajan en el token: se resuelven contra la base, igual que en
   * `JwtStrategy`, para que desactivar a alguien o cambiarle el perfil surta efecto sin
   * esperar a que caduque su sesión.
   */
  @SubscribeMessage('suscribir-backoffice')
  async suscribirBackoffice(@ConnectedSocket() cliente: Socket): Promise<{ ok: boolean }> {
    const usuario = await this.usuarioDelHandshake(cliente);
    if (!usuario) {
      // Desconectar y no solo negar: un cliente sin sesión no tiene nada más que hacer
      // aquí, y dejarlo conectado es una conexión abierta que nadie va a cerrar.
      cliente.disconnect();
      return { ok: false };
    }

    void cliente.join('backoffice');
    return { ok: true };
  }

  private async usuarioDelHandshake(cliente: Socket): Promise<{ id: string } | null> {
    const token = (cliente.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string' || !token) return null;

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      return null;
    }

    // Un token de refresco vive lo que la sesión entera: si valiera aquí, quedarse
    // escuchando ocho horas costaría lo mismo que robarlo una vez.
    if (payload.tipo === 'refresco') return null;

    const usuario = await this.prisma.usuario.findUnique({
      where: { id: payload.sub },
      select: { id: true, rol: true, activo: true, perfil: { select: { permisos: true, activo: true } } },
    });
    if (!usuario?.activo) return null;

    return permisosDe(usuario).includes('bandeja.operar') ? { id: usuario.id } : null;
  }

  emitirLlamado(pantallaIds: string[], llamado: LlamadoEmitido): void {
    for (const id of pantallaIds) {
      this.server?.to(`pantalla:${id}`).emit('llamado', llamado);
    }
    this.server?.to('backoffice').emit('llamado', llamado);
  }

  emitirColaActualizada(): void {
    this.server?.to('backoffice').emit('cola-actualizada', { ts: new Date().toISOString() });
  }

  /**
   * RN-08.3 · burbuja de pendientes de la bandeja. Sin sonido: decisión explícita
   * del cliente ("el sonido cansa", Especificación §2.9).
   */
  emitirPendientesBandeja(cantidad: number): void {
    this.server?.to('backoffice').emit('bandeja-pendientes', { cantidad, sonido: false });
  }
}
