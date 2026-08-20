import { Module } from '@nestjs/common';
import { TurnosController } from './turnos.controller';
import { TurnosService } from './turnos.service';
import { TurnosGateway } from './turnos.gateway';

@Module({
  controllers: [TurnosController],
  providers: [TurnosService, TurnosGateway],
  exports: [TurnosService, TurnosGateway],
})
export class TurnosModule {}
