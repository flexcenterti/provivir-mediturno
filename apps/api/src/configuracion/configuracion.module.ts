import { Global, Module } from '@nestjs/common';
import { ConfiguracionService } from './configuracion.service';
import { ConfiguracionController } from './configuracion.controller';

@Global()
@Module({
  controllers: [ConfiguracionController],
  providers: [ConfiguracionService],
  exports: [ConfiguracionService],
})
export class ConfiguracionModule {}
