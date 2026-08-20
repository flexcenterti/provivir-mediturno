import { Module } from '@nestjs/common';
import { RecordatoriosService } from './recordatorios.service';

@Module({
  providers: [RecordatoriosService],
  exports: [RecordatoriosService],
})
export class RecordatoriosModule {}
