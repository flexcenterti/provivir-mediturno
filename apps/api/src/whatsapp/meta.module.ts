import { Global, Module } from '@nestjs/common';
import { MetaCliente } from './meta.cliente';
import { TranscripcionService } from './transcripcion.service';

/**
 * Infraestructura de salida de WhatsApp, sin dependencias de dominio.
 *
 * Va aparte porque tanto el canal conversacional como los recordatorios necesitan
 * enviar mensajes: si `RecordatoriosModule` importara `WhatsappModule` completo se
 * formaría el ciclo citas → recordatorios → whatsapp → ia → citas.
 */
@Global()
@Module({
  providers: [MetaCliente, TranscripcionService],
  exports: [MetaCliente, TranscripcionService],
})
export class MetaModule {}
