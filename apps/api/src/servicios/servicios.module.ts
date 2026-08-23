import { Module } from '@nestjs/common';
import { ServiciosController } from './servicios.controller';
import { ServiciosService } from './servicios.service';
import { ConocimientoModule } from '../conocimiento/conocimiento.module';
import { SeguimientoModule } from '../seguimiento/seguimiento.module';

@Module({
  imports: [ConocimientoModule, SeguimientoModule],
  controllers: [ServiciosController],
  providers: [ServiciosService],
  exports: [ServiciosService],
})
export class ServiciosModule {}
