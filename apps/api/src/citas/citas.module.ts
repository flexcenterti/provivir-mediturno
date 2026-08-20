import { Module } from '@nestjs/common';
import { CitasController } from './citas.controller';
import { CitasService } from './citas.service';
import { AgendasModule } from '../agendas/agendas.module';
import { RecordatoriosModule } from '../recordatorios/recordatorios.module';

@Module({
  imports: [AgendasModule, RecordatoriosModule],
  controllers: [CitasController],
  providers: [CitasService],
  exports: [CitasService],
})
export class CitasModule {}
