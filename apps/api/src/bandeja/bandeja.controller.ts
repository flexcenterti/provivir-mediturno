import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { BandejaService } from './bandeja.service';
import { SeguimientoService } from '../seguimiento/seguimiento.service';
import { Permisos } from '../auth/decorators/permisos.decorator';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../auth/auth.types';

class ResponderDto {
  @IsString() @MinLength(1) @MaxLength(4000)
  texto!: string;
}

@Controller('bandeja')
@Permisos('bandeja.operar')
export class BandejaController {
  constructor(
    private readonly bandeja: BandejaService,
    private readonly seguimiento: SeguimientoService,
  ) {}

  @Get()
  pendientes() {
    return this.bandeja.pendientes();
  }

  /** Alimenta la burbuja roja del menú lateral (sin sonido). */
  /**
   * RN-09.9.8 · Interesados sin agendar, debajo de las conversaciones escaladas.
   * Va en la bandeja y no en un tablero aparte porque es donde la asistente trabaja.
   */
  @Get('interesados')
  interesados() {
    return this.seguimiento.interesados();
  }

  @Get('pendientes/conteo')
  async conteo() {
    return { pendientes: await this.bandeja.conteoPendientes(), sonido: false };
  }

  @Get(':id')
  detalle(@Param('id') id: string) {
    return this.bandeja.detalle(id);
  }

  @Patch(':id/tomar')
  tomar(@Param('id') id: string, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.bandeja.tomar(id, usuario.id);
  }

  @Post(':id/responder')
  responder(
    @Param('id') id: string,
    @Body() dto: ResponderDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.bandeja.responder(id, dto.texto, usuario.id);
  }

  @Patch(':id/resolver')
  resolver(@Param('id') id: string, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.bandeja.resolver(id, usuario.id);
  }
}
