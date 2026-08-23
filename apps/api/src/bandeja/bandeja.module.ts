import { Module } from '@nestjs/common';
import { BandejaController } from './bandeja.controller';
import { BandejaService } from './bandeja.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { TurnosModule } from '../turnos/turnos.module';
import { SeguimientoModule } from '../seguimiento/seguimiento.module';

@Module({
  imports: [WhatsappModule, TurnosModule, SeguimientoModule],
  controllers: [BandejaController],
  providers: [BandejaService],
})
export class BandejaModule {}
