import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { PERMISOS } from '@provivir/shared';
import { Permisos } from '../auth/decorators/permisos.decorator';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../auth/auth.types';
import { AccesoService } from './acceso.service';
import {
  ActualizarPerfilDto, ActualizarUsuarioDto, CrearPerfilDto, CrearUsuarioDto,
} from './dto/acceso.dto';

/**
 * Perfiles de acceso y usuarios. Todo aquí exige `usuarios.gestionar`: quien puede
 * repartir permisos puede concederse cualquier otro, así que es el permiso que hay
 * que dar con más cuidado.
 */
@Controller('acceso')
@Permisos('usuarios.gestionar')
export class AccesoController {
  constructor(private readonly acceso: AccesoService) {}

  /** El catálogo de permisos, para que el frontend pinte las casillas. */
  @Get('permisos')
  catalogo() {
    return PERMISOS;
  }

  @Get('perfiles')
  perfiles() {
    return this.acceso.perfiles();
  }

  @Post('perfiles')
  crearPerfil(@Body() dto: CrearPerfilDto, @UsuarioActual() u: UsuarioAutenticado) {
    return this.acceso.crearPerfil(dto, u.id);
  }

  @Patch('perfiles/:id')
  actualizarPerfil(@Param('id') id: string, @Body() dto: ActualizarPerfilDto, @UsuarioActual() u: UsuarioAutenticado) {
    return this.acceso.actualizarPerfil(id, dto, u.id);
  }

  @Delete('perfiles/:id')
  eliminarPerfil(@Param('id') id: string, @UsuarioActual() u: UsuarioAutenticado) {
    return this.acceso.eliminarPerfil(id, u.id);
  }

  @Get('usuarios')
  usuarios() {
    return this.acceso.usuarios();
  }

  @Post('usuarios')
  crearUsuario(@Body() dto: CrearUsuarioDto, @UsuarioActual() u: UsuarioAutenticado) {
    return this.acceso.crearUsuario(dto, u.id);
  }

  @Patch('usuarios/:id')
  actualizarUsuario(@Param('id') id: string, @Body() dto: ActualizarUsuarioDto, @UsuarioActual() u: UsuarioAutenticado) {
    return this.acceso.actualizarUsuario(id, dto, u.id);
  }

  @Post('usuarios/:id/clave')
  reiniciarClave(@Param('id') id: string, @UsuarioActual() u: UsuarioAutenticado) {
    return this.acceso.reiniciarClave(id, u.id);
  }
}
