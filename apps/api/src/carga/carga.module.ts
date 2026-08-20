import { Module } from '@nestjs/common';
import { CargaController } from './carga.controller';
import { CargaCola } from './carga.cola';
import { CargaProcesador } from './carga.procesador';

@Module({
  controllers: [CargaController],
  providers: [CargaCola, CargaProcesador],
  exports: [CargaProcesador],
})
export class CargaModule {}
