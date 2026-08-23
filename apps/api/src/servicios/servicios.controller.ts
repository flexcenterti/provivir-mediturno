import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
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

  /**
   * Qué arrastra desactivar este servicio. Se consulta antes de decidir, para poder
   * mostrar cuántas citas quedan colgando antes de apretar el botón (RN-04.5.4).
   */
  @Get(':id/impacto')
  @Permisos('catalogo.editar')
  impacto(@Param('id') id: string) {
    return this.servicios.impacto(id);
  }

  /** RN-04.5.3 · Baja lógica: deja de ofrecerse, las citas agendadas se conservan. */
  @Post(':id/desactivar')
  @Permisos('catalogo.editar')
  desactivar(@Param('id') id: string, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.servicios.desactivar(id, usuario.id);
  }

  @Post(':id/activar')
  @Permisos('catalogo.editar')
  activar(@Param('id') id: string, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.servicios.activar(id, usuario.id);
  }

  /** Solo si no tiene ninguna cita asociada. Con citas, se desactiva (RN-04.5.3.2). */
  @Delete(':id')
  @Permisos('catalogo.editar')
  eliminar(@Param('id') id: string, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.servicios.eliminar(id, usuario.id);
  }
}
