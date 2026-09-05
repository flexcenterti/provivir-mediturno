import { Module } from '@nestjs/common';
import { TurnosController } from './turnos.controller';
import { TurnosService } from './turnos.service';
import { TurnosGateway } from './turnos.gateway';
import { AuthModule } from '../auth/auth.module';

@Module({
  // El gateway autentica el handshake del backoffice. `PrismaModule` es @Global.
  imports: [AuthModule],
  controllers: [TurnosController],
  providers: [TurnosService, TurnosGateway],
  exports: [TurnosService, TurnosGateway],
})
export class TurnosModule {}
