import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { CONFIG } from '@provivir/shared';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { Publico } from '../auth/decorators/publico.decorator';

/**
 * D3 · Kiosko de llegada: construido pero APAGADO en esta etapa.
 *
 * La operación real es pago en recepción → sala de espera → llamado del prestador.
 * El módulo queda en el producto para activarlo a futuro (pago electrónico +
 * autogestión) sin re-desarrollo — ADR A7. La bandera vive en la tabla de
 * configuración (`kiosko_activo`), no en el código.
 */
@Controller('kiosko')
@Publico()
export class KioskoController {
  constructor(private readonly configuracion: ConfiguracionService) {}

  @Get('estado')
  estado() {
    const activo = this.configuracion.booleano(CONFIG.KIOSKO_ACTIVO, false);
    return {
      activo,
      mensaje: activo ? null : 'Módulo desactivado en esta etapa',
      // Pantalla de opciones propuesta para el futuro; la dinámica definitiva
      // la decide el cliente (P8).
      opciones: [
        { id: 'tengo-cita', etiqueta: 'Tengo cita' },
        { id: 'solicitar', etiqueta: 'Solicitar cita nueva' },
        { id: 'nuevo', etiqueta: 'Soy paciente nuevo' },
        { id: 'ayuda', etiqueta: 'Ayuda en mostrador' },
      ],
    };
  }

  /** Cualquier operación real del kiosko responde 503 mientras esté apagado. */
  @Get('llegada')
  llegada() {
    if (!this.configuracion.booleano(CONFIG.KIOSKO_ACTIVO, false)) {
      throw new ServiceUnavailableException('El kiosko está desactivado en esta etapa');
    }
    return { ok: true };
  }
}
