import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ServiciosService } from './servicios.service';
import { ActualizarServicioDto, CrearServicioDto } from './dto/servicio.dto';
import { Roles } from '../auth/decorators/roles.decorator';
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
  @Roles('admin')
  crear(@Body() dto: CrearServicioDto, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.servicios.crear(dto, usuario.id);
  }

  @Patch(':id')
  @Roles('admin')
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarServicioDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.servicios.actualizar(id, dto, usuario.id);
  }
}
