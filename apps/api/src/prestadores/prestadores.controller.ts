import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PrestadoresService } from './prestadores.service';
import { ActualizarPrestadorDto, CrearPrestadorDto } from './dto/prestador.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../auth/auth.types';

@Controller('prestadores')
export class PrestadoresController {
  constructor(private readonly prestadores: PrestadoresService) {}

  /** Lectura abierta a todos los roles autenticados: la agenda y el motor la necesitan. */
  @Get()
  listar(@Query('todos') todos?: string) {
    return this.prestadores.listar(todos !== 'true');
  }

  /** RN-02 · panel de balanceo de medicina general. */
  @Get('grupo-balanceo')
  grupoBalanceo() {
    return this.prestadores.listarGrupoBalanceo();
  }

  @Get(':id')
  porId(@Param('id') id: string) {
    return this.prestadores.porId(id);
  }

  @Post()
  @Roles('admin')
  crear(@Body() dto: CrearPrestadorDto, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.prestadores.crear(dto, usuario.id);
  }

  @Patch(':id')
  @Roles('admin')
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarPrestadorDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.prestadores.actualizar(id, dto, usuario.id);
  }
}
