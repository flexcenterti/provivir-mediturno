import { Module } from '@nestjs/common';
import { MetricasController } from './metricas.controller';
import { MetricasService } from './metricas.service';
import { AgendasModule } from '../agendas/agendas.module';

@Module({
  imports: [AgendasModule],
  controllers: [MetricasController],
  providers: [MetricasService],
  // Lo consume la base de conocimiento para su KPI de resolución sin humano.
  exports: [MetricasService],
})
export class MetricasModule {}
