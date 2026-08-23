import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { CaptchaService } from './captcha.service';
import { CitasModule } from '../citas/citas.module';
import { RecordatoriosModule } from '../recordatorios/recordatorios.module';

@Module({
  imports: [JwtModule.register({}), CitasModule, RecordatoriosModule],
  controllers: [PortalController],
  providers: [PortalService, CaptchaService],
  exports: [PortalService],
})
export class PortalModule {}
