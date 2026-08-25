import {
  BadRequestException, Controller, Get, NotFoundException, Param, Post,
  Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { opcionesSubida } from '../comun/subidas';
import { CargaCola } from './carga.cola';
import { ContactosProcesador } from './contactos.procesador';
import { Permisos } from '../auth/decorators/permisos.decorator';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../auth/auth.types';

/** 200 MB cubre con holgura un CSV de 400.000 pacientes. */
const MAX_BYTES = 200 * 1024 * 1024;
const EXTENSIONES = ['.csv', '.txt'];

// Se re-exporta para no romper a quien ya lo importaba desde aquí.
export { DIR_SUBIDAS } from '../comun/subidas';

@Controller('carga')
@Permisos('carga.ejecutar')
export class CargaController {
  constructor(
    private readonly cola: CargaCola,
    private readonly contactos: ContactosProcesador,
  ) {}

  /**
   * RN-09.5 · CSV de contactos del celular del cliente (P9), cargado antes de
   * migrar el número. No crea pacientes: es el directorio para saludar por su
   * nombre a quien escribe sin estar registrado.
   */
  @Post('contactos')
  @UseInterceptors(FileInterceptor('archivo', opcionesSubida(EXTENSIONES, MAX_BYTES)))
  async subirContactos(@UploadedFile() archivo: Express.Multer.File | undefined) {
    if (!archivo) throw new BadRequestException('No se recibió el archivo');
    return this.contactos.procesar(archivo.path, archivo.originalname);
  }

  @Post()
  @UseInterceptors(FileInterceptor('archivo', opcionesSubida(EXTENSIONES, MAX_BYTES)))
  async subir(
    @UploadedFile() archivo: Express.Multer.File | undefined,
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Query('filtrarUltimoAnio') filtrar?: string,
  ) {
    if (!archivo) throw new BadRequestException('No se recibió el archivo');

    const jobId = await this.cola.encolar({
      rutaArchivo: archivo.path,
      nombreOriginal: archivo.originalname,
      usuarioId: usuario.id,
      // RN-12.3 · el filtro del último año viene activo por defecto (criterio acordado).
      filtrarUltimoAnio: filtrar !== 'false',
    });

    return { jobId, mensaje: 'Carga encolada. Consulte el avance en /api/carga/:jobId' };
  }

  @Get()
  listar() {
    return this.cola.listar();
  }

  @Get(':jobId')
  async estado(@Param('jobId') jobId: string) {
    const estado = await this.cola.estado(jobId);
    if (!estado) throw new NotFoundException('Carga no encontrada');
    return estado;
  }

  /** Reporte de errores descargable (RN-12 / Guía Fase 1). Documentos enmascarados. */
  @Get(':jobId/errores.csv')
  async reporteErrores(@Param('jobId') jobId: string, @Res() res: Response) {
    const estado = await this.cola.estado(jobId);
    if (!estado) throw new NotFoundException('Carga no encontrada');

    const errores = estado.resumen?.errores ?? [];
    const lineas = ['fila,documento,motivo', ...errores.map((e) => `${e.fila},${e.documento},"${e.motivo.replace(/"/g, '""')}"`)];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="errores-${jobId}.csv"`);
    res.send(lineas.join('\n'));
  }
}
