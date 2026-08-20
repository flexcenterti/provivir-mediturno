import { Module } from '@nestjs/common';
import { MetricasController } from './metricas.controller';
import { MetricasService } from './metricas.service';
import { AgendasModule } from '../agendas/agendas.module';

@Module({
  imports: [AgendasModule],
  controllers: [MetricasController],
  providers: [MetricasService],
})
export class MetricasModule {}
