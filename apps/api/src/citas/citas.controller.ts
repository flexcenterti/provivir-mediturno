import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CitasService } from './citas.service';
import { CancelarCitaDto, ConsultarCuposDto, CrearCitaDto, ReprogramarCitaDto } from './dto/cita.dto';
import { Permisos } from '../auth/decorators/permisos.decorator';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../auth/auth.types';

/**
 * API del motor de agendamiento. Es el ÚNICO punto de asignación de cupos:
 * WhatsApp (Fase 4) y el portal público (Fase 5) consumen estos mismos endpoints.
 */
@Controller()
export class CitasController {
  constructor(private readonly citas: CitasService) {}

  /** Cupos válidos ya filtrados por RN-01 a RN-04. */
  @Get('cupos')
  cupos(@Query() dto: ConsultarCuposDto) {
    return this.citas.cupos(dto);
  }

  @Get('citas/buscar')
  buscar(
    @Query('q') q: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.citas.buscar(q ?? '', { desde, hasta });
  }

  /** Agenda consolidada día/semana/mes (Especificación §2.8). */
  @Get('citas/consolidada')
  consolidada(
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
    @Query('prestadorId') prestadorId?: string,
  ) {
    return this.citas.agendaConsolidada(desde, hasta, prestadorId);
  }

  @Get('citas/:id')
  porId(@Param('id') id: string) {
    return this.citas.porId(id);
  }

  /**
   * Si al paciente le llegó el aviso de su cita, y si no, por qué.
   *
   * Con `pacientes.ver` y no con `citas.gestionar`: lo que devuelve es el estado de
   * contacto de una persona —su número y cuándo escribió—, no el de la cita. El
   * perfil Asistente ya lo tiene.
   */
  @Get('citas/:id/contacto')
  @Permisos('pacientes.ver')
  contacto(@Param('id') id: string) {
    return this.citas.estadoDeContacto(id);
  }

  /**
   * Si el cupo se ocupó entre la oferta y la confirmación, responde con alternativas
   * en vez de un error seco: la IA y el portal necesitan seguir la conversación.
   */
  @Post('citas')
  @Permisos('citas.gestionar')
  crear(@Body() dto: CrearCitaDto, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.citas.crearConAlternativas(dto, usuario.id);
  }

  @Patch('citas/:id/reprogramar')
  @Permisos('citas.gestionar')
  reprogramar(
    @Param('id') id: string,
    @Body() dto: ReprogramarCitaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.citas.reprogramar(id, dto, usuario.id);
  }

  @Patch('citas/:id/cancelar')
  @Permisos('citas.gestionar')
  cancelar(
    @Param('id') id: string,
    @Body() dto: CancelarCitaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.citas.cancelar(id, dto, usuario.id);
  }
}
