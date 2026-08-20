import { Logger } from '@nestjs/common';
import {
  ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage,
  WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

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

  handleConnection(cliente: Socket): void {
    this.log.debug(`Cliente conectado a tiempo real: ${cliente.id}`);
  }

  @SubscribeMessage('suscribir-pantalla')
  suscribirPantalla(@ConnectedSocket() cliente: Socket, @MessageBody() pantallaId: string): { ok: boolean } {
    void cliente.join(`pantalla:${pantallaId}`);
    return { ok: true };
  }

  /** El backoffice escucha los cambios de cola para refrescar sin recargar. */
  @SubscribeMessage('suscribir-backoffice')
  suscribirBackoffice(@ConnectedSocket() cliente: Socket): { ok: boolean } {
    void cliente.join('backoffice');
    return { ok: true };
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
