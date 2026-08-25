import { Module } from '@nestjs/common';
import { ConocimientoController } from './conocimiento.controller';
import { ConocimientoService } from './conocimiento.service';
import { ConocimientoCola } from './conocimiento.cola';
import { ImportacionProcesador } from './conocimiento.importacion.procesador';
import { SeguimientoModule } from '../seguimiento/seguimiento.module';
import { MetricasModule } from '../metricas/metricas.module';

/**
 * Base de conocimiento del bot (RN-13). Lo exporta para que el orquestador de IA
 * y el módulo de servicios (RN-04.5.4, marcar artículos para revisión) lo usen.
 */
@Module({
  // Sin ciclo: seguimiento depende de Meta y métricas de agendas; ninguno vuelve aquí.
  imports: [SeguimientoModule, MetricasModule],
  controllers: [ConocimientoController],
  providers: [ConocimientoService, ImportacionProcesador, ConocimientoCola],
  exports: [ConocimientoService],
})
export class ConocimientoModule {}
