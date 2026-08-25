import { BadRequestException, Body, Controller, Get, Param, Put } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { ConfiguracionService } from './configuracion.service';
import { Permisos } from '../auth/decorators/permisos.decorator';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../auth/auth.types';

/**
 * Tope duro. El límite real se afina por clave más abajo: casi todo parámetro es
 * un número o una palabra, pero dos guardan documentos enteros y con 200
 * caracteres eran imposibles de configurar.
 */
class FijarValorDto {
  @IsString() @MaxLength(60_000)
  valor!: string;
}

const LIMITE_POR_DEFECTO = 200;

/**
 * Claves que legítimamente guardan texto largo:
 *  · `documentacion_comercial` — el documento del cliente (P6) que alimenta la importación.
 *  · `kb_temas_prohibidos` — la lista JSON de temas de escalamiento obligatorio (RN-13.4 · P12).
 * Con el tope general ninguna de las dos se podía guardar, así que P12 no tenía
 * dónde administrarse.
 */
const LIMITES: Record<string, number> = {
  documentacion_comercial: 60_000,
  kb_temas_prohibidos: 20_000,
};

@Controller('configuracion')
@Permisos('configuracion.editar')
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
    // El límite depende del `@Param`, que class-validator no ve desde el DTO.
    const limite = LIMITES[clave] ?? LIMITE_POR_DEFECTO;
    if (dto.valor.length > limite) {
      throw new BadRequestException(
        `El valor de «${clave}» supera el máximo de ${limite} caracteres (${dto.valor.length}).`,
      );
    }

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
