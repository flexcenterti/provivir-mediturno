import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { AccesoController } from './acceso.controller';
import { AccesoService } from './acceso.service';

@Module({
  imports: [AuditoriaModule],
  controllers: [AccesoController],
  providers: [AccesoService],
  exports: [AccesoService],
})
export class AccesoModule {}
