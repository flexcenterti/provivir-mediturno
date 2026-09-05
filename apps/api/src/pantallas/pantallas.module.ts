import { Module } from '@nestjs/common';
import { PantallasController } from './pantallas.controller';
import { AnunciosService } from './anuncios.service';
import { TurnosModule } from '../turnos/turnos.module';

@Module({
  imports: [TurnosModule],
  controllers: [PantallasController],
  providers: [AnunciosService],
})
export class PantallasModule {}
