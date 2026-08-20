import { Module } from '@nestjs/common';
import { CitasController } from './citas.controller';
import { CitasService } from './citas.service';
import { AgendasModule } from '../agendas/agendas.module';

@Module({
  imports: [AgendasModule],
  controllers: [CitasController],
  providers: [CitasService],
  exports: [CitasService],
})
export class CitasModule {}
