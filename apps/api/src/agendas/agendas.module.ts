import { Module } from '@nestjs/common';
import { AgendasController } from './agendas.controller';
import { AgendasService } from './agendas.service';
import { DiasNoLaborablesController } from './dias-no-laborables.controller';
import { DiasNoLaborablesService } from './dias-no-laborables.service';

@Module({
  controllers: [AgendasController, DiasNoLaborablesController],
  providers: [AgendasService, DiasNoLaborablesService],
  exports: [AgendasService, DiasNoLaborablesService],
})
export class AgendasModule {}
