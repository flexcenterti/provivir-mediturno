import {
  BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch,
  Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { EstadoArticulo } from '@prisma/client';
import { ConocimientoService } from './conocimiento.service';
import { ConocimientoCola } from './conocimiento.cola';
import { EXTENSIONES_KB } from './conocimiento.importacion.procesador';
import { opcionesSubida } from '../comun/subidas';
import {
  ActualizarArticuloDto,
  CrearArticuloDto,
  ListarArticulosDto,
  ProbarPreguntaDto,
  ResumenConocimientoDto,
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
  constructor(
    private readonly conocimiento: ConocimientoService,
    private readonly cola: ConocimientoCola,
  ) {}

  /** Todo lo que la pantalla necesita para pintarse, en una sola petición. */
  @Get('resumen')
  @Permisos('conocimiento.ver')
  resumen(@Query() filtros: ResumenConocimientoDto) {
    return this.conocimiento.resumen(filtros.dias ?? 30);
  }

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

  // ── Importación de documentos por archivo (RN-13 · P6, P13) ──

  /**
   * Sube el documento del cliente y lo trocea por encabezados en artículos.
   *
   * Va a una cola porque un documento largo tarda y la API no puede quedarse
   * esperando. **Todo entra como borrador** (RN-13.7.1): lo que acaba de subir
   * alguien no lo ha revisado nadie, y al bot solo se le sirve lo aprobado.
   *
   * 10 MB, no los 200 MB de la carga de pacientes: esto son documentos, no censos.
   */
  @Post('importar/documento')
  @Permisos('conocimiento.editar')
  @UseInterceptors(FileInterceptor('archivo', opcionesSubida(EXTENSIONES_KB, 10 * 1024 * 1024)))
  async importarDocumento(
    @UploadedFile() archivo: Express.Multer.File | undefined,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    if (!archivo) throw new BadRequestException('No se recibió el archivo');

    const jobId = await this.cola.encolarImportacion({
      rutaArchivo: archivo.path,
      nombreOriginal: archivo.originalname,
      usuarioId: usuario.id,
      sedeId: usuario.sedeId,
    });

    return { jobId, mensaje: 'Importación encolada. Los artículos entran como borrador.' };
  }

  @Get('importaciones')
  @Permisos('conocimiento.ver')
  listarImportaciones() {
    return this.cola.listarImportaciones();
  }

  @Get('importaciones/:jobId')
  @Permisos('conocimiento.ver')
  async estadoImportacion(@Param('jobId') jobId: string) {
    const estado = await this.cola.estadoImportacion(jobId);
    if (!estado) throw new NotFoundException('Importación no encontrada');
    return estado;
  }

  /** Qué bloques no entraron y por qué, para poder arreglar el documento y repetir. */
  @Get('importaciones/:jobId/errores.csv')
  @Permisos('conocimiento.ver')
  async erroresImportacion(@Param('jobId') jobId: string, @Res() res: Response) {
    const estado = await this.cola.estadoImportacion(jobId);
    if (!estado) throw new NotFoundException('Importación no encontrada');

    const errores = estado.resumen?.errores ?? [];
    const lineas = [
      'bloque,titulo,motivo',
      ...errores.map(
        (e) => `${e.bloque},"${e.titulo.replace(/"/g, '""')}","${e.motivo.replace(/"/g, '""')}"`,
      ),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="errores-importacion-${jobId}.csv"`);
    res.send(lineas.join('\n'));
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
