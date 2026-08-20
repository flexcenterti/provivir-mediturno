import { Module } from '@nestjs/common';
import { IaService, CLIENTE_LLM } from './ia.service';
import { AnthropicCliente } from './anthropic.cliente';
import { CitasModule } from '../citas/citas.module';

@Module({
  imports: [CitasModule],
  providers: [
    AnthropicCliente,
    // El puerto permite sustituir el modelo por un doble en las pruebas.
    { provide: CLIENTE_LLM, useExisting: AnthropicCliente },
    IaService,
  ],
  exports: [IaService, CLIENTE_LLM],
})
export class IaModule {}
