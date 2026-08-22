import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ServiciosService } from './servicios.service';
import { ActualizarServicioDto, CrearServicioDto } from './dto/servicio.dto';
import { Permisos } from '../auth/decorators/permisos.decorator';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../auth/auth.types';

@Controller('servicios')
export class ServiciosController {
  constructor(private readonly servicios: ServiciosService) {}

  @Get()
  listar(@Query('todos') todos?: string) {
    return this.servicios.listar(todos !== 'true');
  }

  @Get(':id')
  porId(@Param('id') id: string) {
    return this.servicios.porId(id);
  }

  @Post()
  @Permisos('catalogo.editar')
  crear(@Body() dto: CrearServicioDto, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.servicios.crear(dto, usuario.id);
  }

  @Patch(':id')
  @Permisos('catalogo.editar')
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarServicioDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicios.actualizar(id, dto, usuario.id);
  }
}
