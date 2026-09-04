import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TurnosService } from './turnos.service';
import { LlamarSiguienteDto, PriorizarTurnoDto, RegistrarLlegadaDto } from './dto/turno.dto';
import { Permisos } from '../auth/decorators/permisos.decorator';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../auth/auth.types';

@Controller('turnos')
export class TurnosController {
  constructor(private readonly turnos: TurnosService) {}

  /** RN-07.1 · el mostrador es el canal principal de llegada. */
  @Post('llegada')
  @Permisos('mostrador.operar')
  registrarLlegada(@Body() dto: RegistrarLlegadaDto, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.turnos.registrarLlegada(dto, usuario.id);
  }

  /**
   * Cola ordenada por prioridad y llegada. El prestador ve la suya.
   *
   * El permiso faltaba: estaba declarado en el catálogo y no se exigía en ninguna
   * ruta, así que cualquier usuario autenticado veía la cola del día con nombres y
   * apellidos de pacientes. Los cuatro perfiles base lo traen, y comprobado en
   * producción que no hay perfiles personalizados: nadie se queda sin la cola.
   */
  @Get()
  @Permisos('turnos.ver')
  cola(@Query('prestadorId') prestadorId: string | undefined, @UsuarioActual() usuario: UsuarioAutenticado) {
    // Un prestador solo ve su propia cola, aunque pida otra.
    const id = usuario.rol === 'prestador' ? usuario.prestadorId : prestadorId;
    return this.turnos.cola(id);
  }

  /** RN-07.3 · llamado automático al siguiente en cola. */
  @Post('llamar-siguiente')
  @Permisos('turnos.atender')
  llamarSiguiente(@Body() dto: LlamarSiguienteDto, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.turnos.llamarSiguiente(dto, usuario.id);
  }

  /** RN-07.4 · priorización con nota obligatoria (la exige el DTO). */
  @Patch(':id/priorizar')
  @Permisos('turnos.atender')
  priorizar(
    @Param('id') id: string,
    @Body() dto: PriorizarTurnoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.turnos.priorizar(id, dto, usuario.id);
  }

  @Patch(':id/finalizar')
  @Permisos('turnos.atender')
  finalizar(@Param('id') id: string, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.turnos.finalizar(id, usuario.id);
  }
}
