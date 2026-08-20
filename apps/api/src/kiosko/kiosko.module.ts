import { Module } from '@nestjs/common';
import { KioskoController } from './kiosko.controller';

@Module({ controllers: [KioskoController] })
export class KioskoModule {}
