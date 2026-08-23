import { Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IaService, CLIENTE_LLM } from './ia.service';
import { AnthropicAdaptador } from './adaptadores/anthropic.adaptador';
import { OpenAiAdaptador } from './adaptadores/openai.adaptador';
import { CitasModule } from '../citas/citas.module';
import type { ClienteLlm } from './ia.tipos';
import { ConocimientoModule } from '../conocimiento/conocimiento.module';

/**
 * El proveedor de IA se elige por configuración (`IA_PROVEEDOR`), no por código.
 *
 * Si el proveedor elegido no tiene su clave configurada pero el otro sí, se usa
 * el otro: es preferible atender con el proveedor disponible que escalar el 100 %
 * de las conversaciones a la asistente por una variable mal puesta.
 */
@Module({
  imports: [CitasModule, ConocimientoModule],
  providers: [
    AnthropicAdaptador,
    OpenAiAdaptador,
    {
      provide: CLIENTE_LLM,
      inject: [ConfigService, OpenAiAdaptador, AnthropicAdaptador],
      useFactory: (
        config: ConfigService,
        openai: OpenAiAdaptador,
        anthropic: AnthropicAdaptador,
      ): ClienteLlm => {
        const log = new Logger('IaModule');
        const preferido = (config.get<string>('IA_PROVEEDOR') ?? 'openai').toLowerCase();

        const elegido = preferido === 'anthropic' ? anthropic : openai;
        const alterno = preferido === 'anthropic' ? openai : anthropic;

        if (elegido.disponible) {
          log.log(`Proveedor de IA: ${elegido.proveedor}`);
          return elegido;
        }

        if (alterno.disponible) {
          log.warn(
            `${elegido.proveedor} sin clave configurada; se usa ${alterno.proveedor} como alterno`,
          );
          return alterno;
        }

        log.warn('Ningún proveedor de IA configurado: todas las conversaciones escalarán');
        return elegido;
      },
    },
    IaService,
  ],
  exports: [IaService, CLIENTE_LLM],
})
export class IaModule {}
