import { Module } from '@nestjs/common';
import { PrestadoresController } from './prestadores.controller';
import { PrestadoresService } from './prestadores.service';

@Module({
  controllers: [PrestadoresController],
  providers: [PrestadoresService],
  exports: [PrestadoresService],
})
export class PrestadoresModule {}
