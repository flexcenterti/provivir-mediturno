import { Global, Module } from '@nestjs/common';
import { MetaCliente } from './meta.cliente';
import { TranscripcionService } from './transcripcion.service';
import { VentanaService } from './ventana.service';

/**
 * Infraestructura de salida de WhatsApp, sin dependencias de dominio.
 *
 * Va aparte porque tanto el canal conversacional como los recordatorios necesitan
 * enviar mensajes: si `RecordatoriosModule` importara `WhatsappModule` completo se
 * formaría el ciclo citas → recordatorios → whatsapp → ia → citas.
 */
@Global()
@Module({
  providers: [MetaCliente, TranscripcionService, VentanaService],
  exports: [MetaCliente, TranscripcionService, VentanaService],
})
export class MetaModule {}
