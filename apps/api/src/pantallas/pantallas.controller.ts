import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode,
  NotFoundException, Param, Patch, Post,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { SEDE_ID } from '@provivir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { esModoNombre, nombreParaPantalla, type ModoNombre } from './nombre-en-pantalla';
import { serviciosInexistentes } from './servicios-validos';
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
  ) {}

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

    return {
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
