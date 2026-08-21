import { Controller, Get, Query } from '@nestjs/common';
import { MetricasService } from './metricas.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { fechaEnZona } from '@provivir/shared';

@Controller('metricas')
@Roles('admin', 'asistente')
export class MetricasController {
  constructor(private readonly metricas: MetricasService) {}

  /** Especificación §2.7 · fecha del día + selector de rango (por defecto: hoy). */
  @Get('resumen')
  resumen(@Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    const hoy = fechaEnZona();
    return this.metricas.resumen(desde ?? hoy, hasta ?? desde ?? hoy);
  }

  /** Reporte operativo ampliado: por servicio, por prestador y desempeño de la IA. */
  @Get('reporte')
  reporte(@Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    const hoy = fechaEnZona();
    return this.metricas.reporte(desde ?? hoy, hasta ?? desde ?? hoy);
  }

  /** RN-02 · panel de balanceo: a quién le corresponde la siguiente cita. */
  @Get('balanceo')
  balanceo(@Query('fecha') fecha?: string) {
    return this.metricas.balanceoMedicinaGeneral(fecha ?? fechaEnZona());
  }
}
