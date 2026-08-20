import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Publico } from '../auth/decorators/publico.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: responde aunque la BD esté caída. */
  @Publico()
  @Get()
  vivo() {
    return { estado: 'ok', ts: new Date().toISOString() };
  }

  /** Readiness: verifica que la BD responde antes de declararse listo. */
  @Publico()
  @Get('ready')
  async listo() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { estado: 'ok', db: 'ok' };
    } catch {
      // Sin detalle del error hacia afuera (checklist §4.9)
      return { estado: 'degradado', db: 'error' };
    }
  }
}
