import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PacientesService } from './pacientes.service';
import { ActualizarPacienteDto, BuscarPacientesDto, CrearPacienteDto } from './dto/paciente.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../auth/auth.types';

@Controller('pacientes')
@Roles('admin', 'asistente')
export class PacientesController {
  constructor(private readonly pacientes: PacientesService) {}

  @Get()
  buscar(@Query() dto: BuscarPacientesDto) {
    return this.pacientes.buscar(dto);
  }

  @Get(':id')
  porId(@Param('id') id: string) {
    return this.pacientes.porId(id);
  }

  /** RN-12.4 · ventana emergente con los últimos 10 servicios tomados. */
  @Get(':id/historial')
  historial(@Param('id') id: string) {
    return this.pacientes.historial(id);
  }

  @Post()
  crear(@Body() dto: CrearPacienteDto, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.pacientes.crear(dto, usuario.id);
  }

  @Patch(':id')
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarPacienteDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.pacientes.actualizar(id, dto, usuario.id);
  }

  @Delete(':id')
  @Roles('admin')
  desactivar(@Param('id') id: string, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.pacientes.desactivar(id, usuario.id);
  }
}
