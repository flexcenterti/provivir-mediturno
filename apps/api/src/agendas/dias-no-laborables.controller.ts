import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { DiasNoLaborablesService } from './dias-no-laborables.service';
import { CrearDiaNoLaborableDto, ImportarFestivosDto } from './dto/dia-no-laborable.dto';
import { Permisos } from '../auth/decorators/permisos.decorator';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../auth/auth.types';

/**
 * RN-06.5 · Días en que la sede no atiende: festivos nacionales y cierres propios.
 *
 * Gobierno de agenda, así que escribir exige `agenda.editar` (RN-06.1). El GET queda
 * abierto a cualquier autenticado por el mismo motivo que el de agendas: el prestador
 * necesita ver cuándo no se atiende, en solo lectura.
 */
@Controller('dias-no-laborables')
export class DiasNoLaborablesController {
  constructor(private readonly dias: DiasNoLaborablesService) {}

  @Get()
  listar(@Query('anio') anio?: string) {
    return this.dias.listar(anio ? Number(anio) : undefined);
  }

  /** Sin `confirmar` devuelve el impacto; con `confirmar` cierra el día. */
  @Post()
  @Permisos('agenda.editar')
  crear(@Body() dto: CrearDiaNoLaborableDto, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.dias.crear(dto, usuario.id);
  }

  /** Carga los 18 festivos nacionales del año. Idempotente. */
  @Post('importar-festivos')
  @Permisos('agenda.editar')
  importar(@Body() dto: ImportarFestivosDto, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.dias.importarFestivos(dto, usuario.id);
  }

  @Delete(':id')
  @Permisos('agenda.editar')
  eliminar(@Param('id') id: string, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.dias.eliminar(id, usuario.id);
  }
}
