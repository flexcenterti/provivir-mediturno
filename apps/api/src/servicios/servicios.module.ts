import { Module } from '@nestjs/common';
import { ServiciosController } from './servicios.controller';
import { ServiciosService } from './servicios.service';

@Module({
  controllers: [ServiciosController],
  providers: [ServiciosService],
  exports: [ServiciosService],
})
export class ServiciosModule {}
