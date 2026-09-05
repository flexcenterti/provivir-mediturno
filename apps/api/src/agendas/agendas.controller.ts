import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AgendasService } from './agendas.service';
import {
  ActualizarAgendaDto, BloquearAgendaDto, CrearAgendaDto, ProgramacionMensualDto, RetirarAgendaDto,
} from './dto/agenda.dto';
import { Permisos } from '../auth/decorators/permisos.decorator';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../auth/auth.types';

/**
 * RN-06.1 · Solo administración gobierna las agendas.
 * El prestador consulta la suya en `/api/agendas?prestadorId=…` en modo lectura
 * ("Información de agenda", Especificación §2.5) — de ahí que el GET no lleve @Roles.
 */
@Controller('agendas')
export class AgendasController {
  constructor(private readonly agendas: AgendasService) {}

  @Get()
  listar(
    @Query('prestadorId') prestadorId?: string,
    @Query('incluirRetiradas') incluirRetiradas?: string,
  ) {
    return this.agendas.listar(prestadorId, incluirRetiradas === 'true');
  }

  @Post()
  @Permisos('agenda.editar')
  crear(@Body() dto: CrearAgendaDto, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.agendas.crear(dto, usuario.id);
  }

  /** RN-06.4 · varios días del mes con una franja, en un solo paso. */
  @Post('programacion-mensual')
  @Permisos('agenda.editar')
  programacionMensual(@Body() dto: ProgramacionMensualDto, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.agendas.programacionMensual(dto, usuario.id);
  }

  /**
   * RN-06.6 · corregir días y horas. Misma mecánica que el bloqueo: sin `confirmar`
   * devuelve el impacto y no toca nada.
   */
  @Patch(':id')
  @Permisos('agenda.editar')
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarAgendaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.agendas.actualizar(id, dto, usuario.id);
  }

  /**
   * RN-06.6 · retirar una franja. POST y no DELETE porque no es un borrado: es una
   * transición de estado con inversa —`reactivar`— y necesita cuerpo para `confirmar` y
   * respuesta con el impacto.
   */
  @Post(':id/retirar')
  @Permisos('agenda.editar')
  retirar(
    @Param('id') id: string,
    @Body() dto: RetirarAgendaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.agendas.retirar(id, dto, usuario.id);
  }

  @Post(':id/reactivar')
  @Permisos('agenda.editar')
  reactivar(@Param('id') id: string, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.agendas.reactivar(id, usuario.id);
  }

  /** RN-06.3 · sin `confirmar` devuelve el impacto; con `confirmar` lo aplica. */
  @Post(':id/bloquear')
  @Permisos('agenda.editar')
  bloquear(
    @Param('id') id: string,
    @Body() dto: BloquearAgendaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.agendas.bloquear(id, dto, usuario.id);
  }

  @Post(':id/desbloquear')
  @Permisos('agenda.editar')
  desbloquear(@Param('id') id: string, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.agendas.desbloquear(id, usuario.id);
  }
}
