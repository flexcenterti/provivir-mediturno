import { Module } from '@nestjs/common';
import { PantallasController } from './pantallas.controller';
import { TurnosModule } from '../turnos/turnos.module';

@Module({
  imports: [TurnosModule],
  controllers: [PantallasController],
})
export class PantallasModule {}
