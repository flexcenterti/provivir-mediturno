import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { Publico } from '../auth/decorators/publico.decorator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracion: ConfiguracionService,
    private readonly config: ConfigService,
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

    /**
     * La sede es la raíz de casi todo: conversaciones, citas y usuarios cuelgan de
     * ella por clave foránea. Si falta, la API arranca, responde /health y acepta
     * el webhook con 200 —Meta queda conforme— pero cada mensaje entrante muere
     * en el worker con una violación de clave foránea y el paciente no recibe
     * nada. Un fallo invisible desde fuera; por eso se declara aquí.
     */
    const sedeId = this.config.get<string>('SEDE_ID');
    const sede = await this.prisma.sede.count({ where: { id: sedeId } });
    if (sede === 0) {
      return {
        estado: 'degradado',
        db: 'ok',
        sede: 'no existe',
        detalle: `La sede "${sedeId}" no está en la base. Ejecuta el alta inicial: node apps/api/dist/cli/alta-inicial.js`,
      };
    }

    return {
      estado: 'ok',
      db: 'ok',
      sede: 'ok',
      configuracion: this.configuracion.disponible ? 'ok' : 'valores por defecto',
    };
  }
}
