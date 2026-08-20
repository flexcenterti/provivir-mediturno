import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface EntradaAuditoria {
  usuario: string;
  accion: string;
  entidad: string;
  detalle?: string;
  estadoPrev?: string;
  estadoNext?: string;
}

/**
 * Tabla append-only: nunca se actualiza ni se borra (Arquitectura §5).
 * Registrar NO debe tumbar la operación de negocio: si la auditoría falla se loguea
 * y se sigue, porque perder una cita es peor que perder una línea de auditoría.
 */
@Injectable()
export class AuditoriaService {
  private readonly log = new Logger(AuditoriaService.name);

  constructor(private readonly prisma: PrismaService) {}

  async registrar(entrada: EntradaAuditoria): Promise<void> {
    try {
      await this.prisma.auditoria.create({ data: entrada });
    } catch (e) {
      this.log.error(`No se pudo registrar auditoría: ${entrada.accion} sobre ${entrada.entidad}`, e as Error);
    }
  }
}
