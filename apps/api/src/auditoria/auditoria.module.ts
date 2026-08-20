import { Global, Module } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service';
import { AuditoriaController } from './auditoria.controller';

@Global()
@Module({
  controllers: [AuditoriaController],
  providers: [AuditoriaService],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
