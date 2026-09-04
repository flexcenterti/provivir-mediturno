import { Body, Controller, Get, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
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

  /**
   * El adjunto del paciente (RN-08.1). Se declara ANTES de `:id` porque, aunque hoy
   * no colisionen, un `@Get(':id')` que ganara la ruta serviría una conversación
   * donde se espera un archivo.
   *
   * Va por el mismo permiso `bandeja.operar` del controlador: quien atiende la
   * conversación es quien puede ver su soporte, y nadie más.
   */
  @Get('mensajes/:mensajeId/media')
  async media(
    @Param('mensajeId') mensajeId: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Res() res: Response,
  ) {
    const { ruta, contentType, nombreDescarga } = await this.bandeja.mediaDeMensaje(
      mensajeId,
      usuario.id,
    );

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${nombreDescarga}"`);
    // Sin `nosniff`, un adjunto de tipo inesperado podría interpretarse como HTML en
    // el navegador de la asistente.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Dato de paciente: no se cachea en disco ni en intermediarios.
    res.setHeader('Cache-Control', 'private, no-store');

    createReadStream(ruta).pipe(res);
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
