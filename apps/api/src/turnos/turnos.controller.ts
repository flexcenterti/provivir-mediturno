import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TurnosService } from './turnos.service';
import { LlamarSiguienteDto, PriorizarTurnoDto, RegistrarLlegadaDto } from './dto/turno.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../auth/auth.types';

@Controller('turnos')
export class TurnosController {
  constructor(private readonly turnos: TurnosService) {}

  /** RN-07.1 · el mostrador es el canal principal de llegada. */
  @Post('llegada')
  @Roles('admin', 'asistente')
  registrarLlegada(@Body() dto: RegistrarLlegadaDto, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.turnos.registrarLlegada(dto, usuario.id);
  }

  /** Cola ordenada por prioridad y llegada. El prestador ve la suya. */
  @Get()
  cola(@Query('prestadorId') prestadorId: string | undefined, @UsuarioActual() usuario: UsuarioAutenticado) {
    // Un prestador solo ve su propia cola, aunque pida otra.
    const id = usuario.rol === 'prestador' ? usuario.prestadorId : prestadorId;
    return this.turnos.cola(id);
  }

  /** RN-07.3 · llamado automático al siguiente en cola. */
  @Post('llamar-siguiente')
  @Roles('admin', 'asistente', 'prestador')
  llamarSiguiente(@Body() dto: LlamarSiguienteDto, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.turnos.llamarSiguiente(dto, usuario.id);
  }

  /** RN-07.4 · priorización con nota obligatoria (la exige el DTO). */
  @Patch(':id/priorizar')
  @Roles('admin', 'asistente', 'prestador')
  priorizar(
    @Param('id') id: string,
    @Body() dto: PriorizarTurnoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.turnos.priorizar(id, dto, usuario.id);
  }

  @Patch(':id/finalizar')
  @Roles('admin', 'asistente', 'prestador')
  finalizar(@Param('id') id: string, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.turnos.finalizar(id, usuario.id);
  }
}
