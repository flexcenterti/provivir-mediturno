import { Module } from '@nestjs/common';
import { ConocimientoController } from './conocimiento.controller';
import { ConocimientoService } from './conocimiento.service';

/**
 * Base de conocimiento del bot (RN-13). Lo exporta para que el orquestador de IA
 * y el módulo de servicios (RN-04.5.4, marcar artículos para revisión) lo usen.
 */
@Module({
  controllers: [ConocimientoController],
  providers: [ConocimientoService],
  exports: [ConocimientoService],
})
export class ConocimientoModule {}
