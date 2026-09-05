import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode,
  NotFoundException, Param, Patch, Post, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'node:fs';
import type { Response } from 'express';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { SEDE_ID } from '@provivir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { esModoNombre, nombreParaPantalla, type ModoNombre } from './nombre-en-pantalla';
import { serviciosInexistentes } from './servicios-validos';
import {
  AnunciosService, EXTENSIONES_ANUNCIO, MAX_BYTES_ANUNCIO,
} from './anuncios.service';
import { opcionesSubidaEnMemoria } from '../comun/subidas';
import { TurnosService } from '../turnos/turnos.service';
import { Permisos } from '../auth/decorators/permisos.decorator';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import { Publico } from '../auth/decorators/publico.decorator';
import type { UsuarioAutenticado } from '../auth/auth.types';

class ActualizarPantallaDto {
  @IsOptional() @IsString() @MaxLength(120) nombre?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) servicios?: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) turnosVisibles?: number;
  @IsOptional() @IsBoolean() sonido?: boolean;
  @IsOptional() @IsString() @MaxLength(300) mensaje?: string;

  /** RN-11.2 · frame multimedia: canal en vivo + videos institucionales. */
  @IsOptional() @IsBoolean() media?: boolean;
  @IsOptional() @IsString() @MaxLength(300) canalYoutube?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) videosPromo?: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(120) intervaloInstitucionalMin?: number;
}

/**
 * `nombre` es lo único obligatorio: el resto lo ponen los defaults del esquema, que
 * son los buenos (4 turnos, con sonido, sin frame, 10 min). `sedeId` NO se acepta del
 * cuerpo — D1 dice sede única y este sería el primer sitio donde un cliente la elige.
 */
class MoverAnuncioDto {
  @IsIn(['izquierda', 'derecha']) direccion!: 'izquierda' | 'derecha';
}

class CrearPantallaDto extends ActualizarPantallaDto {
  @IsString() @MinLength(1) declare nombre: string;
}

@Controller('pantallas')
export class PantallasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly turnos: TurnosService,
    private readonly configuracion: ConfiguracionService,
    private readonly auditoria: AuditoriaService,
    private readonly anuncios: AnunciosService,
  ) {}

  // ─────── RN-11.7 · anuncios de la franja del televisor ───────
  //
  // Van declarados ANTES que las rutas de `:id` para que se lean en orden; no hay
  // colisión de todos modos, porque tienen distinto número de segmentos.

  @Get('anuncios')
  @Permisos('pantallas.ver')
  listarAnuncios() {
    return this.anuncios.listar();
  }

  @Post('anuncios')
  @Permisos('pantallas.editar')
  @UseInterceptors(
    FileInterceptor('archivo', opcionesSubidaEnMemoria(EXTENSIONES_ANUNCIO, MAX_BYTES_ANUNCIO)),
  )
  subirAnuncio(
    @UploadedFile() archivo: Express.Multer.File | undefined,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    if (!archivo) throw new BadRequestException('Falta el archivo');
    return this.anuncios.crear(archivo, usuario.id);
  }

  @Patch('anuncios/:id/mover')
  @Permisos('pantallas.editar')
  moverAnuncio(
    @Param('id') id: string,
    @Body() dto: MoverAnuncioDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.anuncios.mover(id, dto.direccion, usuario.id);
  }

  @Delete('anuncios/:id')
  @Permisos('pantallas.editar')
  @HttpCode(204)
  retirarAnuncio(@Param('id') id: string, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.anuncios.eliminar(id, usuario.id);
  }

  /**
   * La imagen, **sin sesión**: la consume el televisor, que no tiene ninguna. Y no hay
   * nada que proteger — es publicidad que la clínica quiere que se vea.
   *
   * No poner aquí un permiso «por si acaso»: dejaría los televisores sin franja y la
   * miniatura del backoffice perfecta, que es la peor combinación para diagnosticarlo.
   */
  @Publico()
  @Get('anuncios/:id/imagen')
  async imagenAnuncio(@Param('id') id: string, @Res() res: Response) {
    const { ruta, contentType, bytes } = await this.anuncios.imagen(id);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', bytes);
    // No depende del proxy: en desarrollo y en las pruebas la API se alcanza en :3000,
    // donde no hay Caddy que lo ponga.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    /*
     * Al revés que el adjunto de un paciente, que es `private, no-store`: un cartel es
     * público e **inmutable**. Un id apunta a un archivo fijo para siempre.
     *
     * Y eso es un contrato: NUNCA puede existir un «reemplazar la imagen de este
     * anuncio» que conserve el id. Sustituir es retirar y subir, lo que genera un id
     * nuevo. Si alguien añade el reemplazo en sitio, el televisor mostrará el anuncio
     * viejo hasta que se le borre el perfil del navegador — y eso se diagnostica
     * pésimamente desde una sala de espera.
     */
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // Sin `Content-Disposition`: con un tipo de imagen el navegador la pinta sola, y así
    // el nombre que escribió el operador nunca acaba en una cabecera.

    createReadStream(ruta).pipe(res);
  }

  @Get()
  @Permisos('pantallas.ver')
  listar() {
    return this.prisma.pantalla.findMany({ orderBy: { nombre: 'asc' } });
  }

  @Post()
  @Permisos('pantallas.editar')
  async crear(@Body() dto: CrearPantallaDto, @UsuarioActual() usuario: UsuarioAutenticado) {
    await this.exigirServiciosDelCatalogo(dto.servicios);

    const pantalla = await this.prisma.pantalla.create({ data: { ...dto, sedeId: SEDE_ID } });
    await this.auditoria.registrar({
      usuario: usuario.id,
      accion: 'Pantalla creada',
      entidad: `pantalla/${pantalla.id}`,
      detalle: pantalla.nombre,
    });
    return pantalla;
  }

  /**
   * Retirar una pantalla es **la revocación** de su enlace, y por eso el borrado es
   * duro.
   *
   * Todo lo que protege `/tv` es que la URL lleva un UUID que solo se ve desde el
   * backoffice; el propio Caddyfile escribe el procedimiento: «si alguno se filtra, se
   * corta creando una pantalla nueva y retirando la anterior». Retirar tiene entonces
   * un solo trabajo — que ese UUID deje de resolver— y el borrado duro lo cumple
   * incondicionalmente.
   *
   * Un `activo: false` solo lo cumpliría si las TRES rutas de lectura recordaran el
   * filtro: esta lista, el estado público y la selección de destinatarios de
   * `turnos.service`. Olvidar la tercera dejaría una pantalla «retirada» recibiendo
   * nombres de pacientes en vivo por el WebSocket: exactamente el fallo que el
   * procedimiento existe para evitar.
   *
   * La recuperación es la auditoría, que guarda la configuración entera. Rehacerla a
   * mano cuesta un minuto y produce un UUID nuevo, que es el resultado correcto: nadie
   * quiere que «deshacer» resucite un enlace filtrado.
   */
  @Delete(':id')
  @Permisos('pantallas.editar')
  @HttpCode(204)
  async eliminar(@Param('id') id: string, @UsuarioActual() usuario: UsuarioAutenticado) {
    const pantalla = await this.prisma.pantalla.findUnique({ where: { id } });
    if (!pantalla) throw new NotFoundException('Pantalla no encontrada');

    // `delete` y no `deleteMany`: el segundo responde 200 alegremente sobre nada.
    await this.prisma.pantalla.delete({ where: { id } });
    await this.auditoria.registrar({
      usuario: usuario.id,
      accion: 'Pantalla retirada',
      entidad: `pantalla/${id}`,
      detalle: JSON.stringify({
        nombre: pantalla.nombre, servicios: pantalla.servicios,
        turnosVisibles: pantalla.turnosVisibles, sonido: pantalla.sonido,
        mensaje: pantalla.mensaje, media: pantalla.media,
        canalYoutube: pantalla.canalYoutube, videosPromo: pantalla.videosPromo,
        intervaloInstitucionalMin: pantalla.intervaloInstitucionalMin,
      }),
    });
  }

  /**
   * La TV consume esta ruta sin login: es un dispositivo de sala, no una persona.
   * Devuelve solo lo que se pinta en pantalla — ningún dato identificable del paciente
   * más allá del nombre que ya se anuncia en voz alta en la sala.
   */
  @Publico()
  @Get(':id/estado')
  async estado(@Param('id') id: string) {
    const pantalla = await this.prisma.pantalla.findUnique({ where: { id } });
    if (!pantalla) throw new NotFoundException('Pantalla no encontrada');

    const llamados = await this.turnos.ultimosLlamados(pantalla.servicios, pantalla.turnosVisibles);

    const crudo = this.configuracion.texto('mostrar_nombre_en_pantalla', 'abreviado');
    const modoNombre: ModoNombre = esModoNombre(crudo) ? crudo : 'abreviado';
    const anuncios = await this.anuncios.listar();

    return {
      /*
       * `anuncios` y `ahora` van AQUÍ, hermanos de `pantalla`, y nunca dentro.
       *
       * La TV compara `JSON.stringify(prev) === JSON.stringify(d.pantalla)` para no
       * reemplazar la configuración cuando no ha cambiado; si `ahora` entrara ahí, esa
       * comparación no coincidiría jamás y el reproductor de YouTube se recrearía cada
       * 60 s — matando los institucionales de más de un minuto, que es exactamente el
       * defecto que la comparación existe para evitar.
       */
      anuncios: anuncios.map((a) => ({
        id: a.id,
        // Relativa: el mismo origen en producción y a través del proxy en desarrollo.
        url: `/api/pantallas/anuncios/${a.id}/imagen`,
      })),
      /*
       * La hora la manda el servidor. Los sticks HDMI baratos no traen reloj y arrancan
       * con la zona horaria mal, y un reloj equivocado colgado en la pared de una sala
       * de espera es peor que no tener ninguno.
       */
      ahora: new Date().toISOString(),
      pantalla: {
        id: pantalla.id,
        nombre: pantalla.nombre,
        // La TV lo necesita para poder decir «esta pantalla no tiene servicios» en vez
        // de quedarse en «Esperando llamados» para siempre.
        servicios: pantalla.servicios,
        turnosVisibles: pantalla.turnosVisibles,
        sonido: pantalla.sonido,
        mensaje: pantalla.mensaje,
        media: pantalla.media,
        canalYoutube: pantalla.canalYoutube,
        videosPromo: pantalla.videosPromo,
        intervaloInstitucionalMin: pantalla.intervaloInstitucionalMin,
      },
      llamados: llamados.map((t) => ({
        // La TV llavea por aquí para no duplicar: el mismo turno puede llegar por el
        // sondeo y por el socket, y con el rellamado, varias veces por el socket.
        turnoId: t.id,
        codigo: t.cita.codigo,
        paciente: nombreParaPantalla(t.cita.paciente.nombres, t.cita.paciente.apellidos, modoNombre),
        prestador: t.cita.prestador.nombre,
        consultorio: t.consultorio,
        ts: t.llamadoTs,
      })),
    };
  }

  @Patch(':id')
  @Permisos('pantallas.editar')
  async actualizar(@Param('id') id: string, @Body() dto: ActualizarPantallaDto) {
    const pantalla = await this.prisma.pantalla.findUnique({ where: { id } });
    if (!pantalla) throw new NotFoundException('Pantalla no encontrada');
    await this.exigirServiciosDelCatalogo(dto.servicios);
    return this.prisma.pantalla.update({ where: { id }, data: { ...dto } });
  }

  /**
   * Se valida en los dos verbos: hacerlo solo al crear deja la puerta abierta por el
   * otro lado, y el nombre del id que sobra va en el mensaje porque el operador acaba
   * de escribirlo y lo único que necesita saber es cuál se equivocó.
   *
   * La lista vacía se acepta: es el estado normal de una pantalla recién creada. El
   * aviso de que así no mostrará nada vive en la interfaz y en el propio televisor.
   */
  private async exigirServiciosDelCatalogo(servicios?: string[]): Promise<void> {
    if (!servicios?.length) return;

    const existentes = await this.prisma.servicio.findMany({ select: { id: true } });
    const sobran = serviciosInexistentes(servicios, existentes.map((s) => s.id));
    if (sobran.length) {
      throw new BadRequestException(`No existen estos servicios: ${sobran.join(', ')}`);
    }
  }
}
