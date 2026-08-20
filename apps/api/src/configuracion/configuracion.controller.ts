import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { ConfiguracionService } from './configuracion.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../auth/auth.types';

class FijarValorDto {
  @IsString() @MaxLength(200)
  valor!: string;
}

@Controller('configuracion')
@Roles('admin')
export class ConfiguracionController {
  constructor(
    private readonly config: ConfiguracionService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get()
  listar() {
    return this.config.todo();
  }

  @Put(':clave')
  async fijar(
    @Param('clave') clave: string,
    @Body() dto: FijarValorDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    const anterior = this.config.texto(clave, '');
    await this.config.fijar(clave, dto.valor);
    await this.auditoria.registrar({
      usuario: usuario.id,
      accion: 'Configuración modificada',
      entidad: `configuracion/${clave}`,
      estadoPrev: anterior,
      estadoNext: dto.valor,
    });
    return { clave, valor: dto.valor };
  }
}
