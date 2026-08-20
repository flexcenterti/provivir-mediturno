import { Body, Controller, Get, NotFoundException, Param, Patch } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { TurnosService } from '../turnos/turnos.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { Publico } from '../auth/decorators/publico.decorator';

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

@Controller('pantallas')
export class PantallasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly turnos: TurnosService,
  ) {}

  @Get()
  @Roles('admin', 'asistente')
  listar() {
    return this.prisma.pantalla.findMany({ orderBy: { nombre: 'asc' } });
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

    return {
      pantalla: {
        id: pantalla.id,
        nombre: pantalla.nombre,
        turnosVisibles: pantalla.turnosVisibles,
        sonido: pantalla.sonido,
        mensaje: pantalla.mensaje,
        media: pantalla.media,
        canalYoutube: pantalla.canalYoutube,
        videosPromo: pantalla.videosPromo,
        intervaloInstitucionalMin: pantalla.intervaloInstitucionalMin,
      },
      llamados: llamados.map((t) => ({
        codigo: t.cita.codigo,
        paciente: `${t.cita.paciente.nombres} ${t.cita.paciente.apellidos}`,
        prestador: t.cita.prestador.nombre,
        consultorio: t.consultorio,
        ts: t.llamadoTs,
      })),
    };
  }

  @Patch(':id')
  @Roles('admin')
  async actualizar(@Param('id') id: string, @Body() dto: ActualizarPantallaDto) {
    const pantalla = await this.prisma.pantalla.findUnique({ where: { id } });
    if (!pantalla) throw new NotFoundException('Pantalla no encontrada');
    return this.prisma.pantalla.update({ where: { id }, data: { ...dto } });
  }
}
