import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { Publico } from '../auth/decorators/publico.decorator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracion: ConfiguracionService,
  ) {}

  /** Liveness: responde aunque la BD esté caída. */
  @Publico()
  @Get()
  vivo() {
    return { estado: 'ok', ts: new Date().toISOString() };
  }

  /**
   * Readiness: ¿puede la plataforma atender de verdad?
   *
   * No basta con que la conexión abra: una base conectada pero SIN MIGRAR responde
   * a `SELECT 1` y falla en cada consulta real. Por eso se toca una tabla del
   * esquema, que es lo que distingue "hay base" de "hay plataforma".
   */
  @Publico()
  @Get('ready')
  async listo() {
    try {
      await this.prisma.configuracion.count();
    } catch (e) {
      const codigo = (e as { code?: string }).code;
      return {
        estado: 'degradado',
        db: codigo === 'P2021' ? 'sin migrar' : 'error',
        // El detalle interno no sale (checklist §4.9); el motivo accionable sí.
        detalle: codigo === 'P2021' ? 'Ejecuta prisma migrate deploy' : undefined,
      };
    }

    return {
      estado: 'ok',
      db: 'ok',
      configuracion: this.configuracion.disponible ? 'ok' : 'valores por defecto',
    };
  }
}
