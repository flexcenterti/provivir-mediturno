import { Module } from '@nestjs/common';
import { SeguimientoService } from './seguimiento.service';
import { SeguimientoCola } from './seguimiento.cola';
import { MetaModule } from '../whatsapp/meta.module';

/**
 * Seguimiento comercial (RN-09.9). No depende del módulo de WhatsApp para evitar
 * una referencia circular: envía por `MetaCliente` y persiste el mensaje él mismo.
 */
@Module({
  imports: [MetaModule],
  providers: [SeguimientoService, SeguimientoCola],
  exports: [SeguimientoService, SeguimientoCola],
})
export class SeguimientoModule {}
