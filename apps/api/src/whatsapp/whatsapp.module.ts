import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappCola } from './whatsapp.cola';
import { ConversacionService } from './conversacion.service';
import { IaModule } from '../ia/ia.module';
import { TurnosModule } from '../turnos/turnos.module';
import { SeguimientoModule } from '../seguimiento/seguimiento.module';

@Module({
  imports: [IaModule, TurnosModule, SeguimientoModule],
  controllers: [WhatsappController],
  providers: [WhatsappCola, ConversacionService],
  exports: [ConversacionService],
})
export class WhatsappModule {}
