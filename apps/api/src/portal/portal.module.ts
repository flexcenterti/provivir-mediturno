import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { CaptchaService } from './captcha.service';
import { CitasModule } from '../citas/citas.module';

@Module({
  imports: [JwtModule.register({}), CitasModule],
  controllers: [PortalController],
  providers: [PortalService, CaptchaService],
  exports: [PortalService],
})
export class PortalModule {}
