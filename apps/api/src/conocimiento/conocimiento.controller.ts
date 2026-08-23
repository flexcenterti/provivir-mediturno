import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { EstadoArticulo } from '@prisma/client';
import { ConocimientoService } from './conocimiento.service';
import {
  ActualizarArticuloDto,
  CrearArticuloDto,
  ListarArticulosDto,
  ProbarPreguntaDto,
} from './dto/articulo.dto';
import { Permisos } from '../auth/decorators/permisos.decorator';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../auth/auth.types';

/**
 * Base de conocimiento del bot (RN-13).
 *
 * Consultar exige `conocimiento.ver`; publicar y archivar exigen
 * `conocimiento.editar`, porque cambian lo que el bot le responde a los pacientes.
 */
@Controller('conocimiento')
export class ConocimientoController {
  constructor(private readonly conocimiento: ConocimientoService) {}

  // ── Artículos ──

  @Get('articulos')
  @Permisos('conocimiento.ver')
  listar(@Query() filtros: ListarArticulosDto) {
    return this.conocimiento.listar(filtros.estado as EstadoArticulo | undefined, filtros.servicioId);
  }

  @Get('articulos/:id')
  @Permisos('conocimiento.ver')
  porId(@Param('id') id: string) {
    return this.conocimiento.porId(id);
  }

  @Post('articulos')
  @Permisos('conocimiento.editar')
  crear(@Body() dto: CrearArticuloDto, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.conocimiento.crear(dto, usuario.id, usuario.sedeId);
  }

  @Patch('articulos/:id')
  @Permisos('conocimiento.editar')
  actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarArticuloDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.conocimiento.actualizar(id, dto, usuario.id);
  }

  @Post('articulos/:id/publicar')
  @Permisos('conocimiento.editar')
  publicar(@Param('id') id: string, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.conocimiento.publicar(id, usuario.id);
  }

  @Post('articulos/:id/archivar')
  @Permisos('conocimiento.editar')
  archivar(@Param('id') id: string, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.conocimiento.archivar(id, usuario.id);
  }

  @Post('articulos/:id/reactivar')
  @Permisos('conocimiento.editar')
  reactivar(@Param('id') id: string, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.conocimiento.reactivar(id, usuario.id);
  }

  /** Solo borradores. Lo publicado se archiva (RN-13.5.4). */
  @Delete('articulos/:id')
  @Permisos('conocimiento.editar')
  eliminar(@Param('id') id: string, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.conocimiento.eliminar(id, usuario.id);
  }

  // ── Probador ──

  /**
   * Ensaya una pregunta y devuelve lo que recuperaría el bot, con su puntaje.
   * Permite validar el contenido antes de exponerlo a un paciente.
   */
  @Post('probar')
  @Permisos('conocimiento.ver')
  probar(@Body() dto: ProbarPreguntaDto) {
    return this.conocimiento.buscar(dto.pregunta, {
      servicioId: dto.servicioId,
      registrar: dto.registrar === true,
    });
  }

  // ── Importación de la documentación comercial (RN-13) ──

  /**
   * Convierte `documentacion_comercial` en artículos publicados. Idempotente por
   * título: repetirla tras una entrega nueva del cliente no duplica nada.
   */
  @Post('importar')
  @Permisos('conocimiento.editar')
  importar(@UsuarioActual() usuario: UsuarioAutenticado) {
    return this.conocimiento.importarDocumentacionComercial(usuario.id, usuario.sedeId);
  }

  // ── Preguntas sin respuesta (RN-13.6) ──

  @Get('pendientes')
  @Permisos('conocimiento.ver')
  pendientes(@Query('todas') todas?: string) {
    return this.conocimiento.pendientes(todas !== 'true');
  }

  @Post('pendientes/:id/articulo')
  @Permisos('conocimiento.editar')
  crearDesdePendiente(@Param('id') id: string, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.conocimiento.crearDesdePendiente(id, usuario.id, usuario.sedeId);
  }

  @Post('pendientes/:id/descartar')
  @Permisos('conocimiento.editar')
  descartarPendiente(@Param('id') id: string, @UsuarioActual() usuario: UsuarioAutenticado) {
    return this.conocimiento.descartarPendiente(id, usuario.id);
  }
}
