import { Module } from '@nestjs/common';
import { CargaController } from './carga.controller';
import { CargaCola } from './carga.cola';
import { CargaProcesador } from './carga.procesador';
import { ContactosProcesador } from './contactos.procesador';

@Module({
  controllers: [CargaController],
  providers: [CargaCola, CargaProcesador, ContactosProcesador],
  exports: [CargaProcesador, ContactosProcesador],
})
export class CargaModule {}
