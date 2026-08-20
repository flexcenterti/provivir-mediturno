import {
  BadRequestException, Controller, Get, NotFoundException, Param, Post,
  Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { Response } from 'express';
import { CargaCola } from './carga.cola';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../auth/auth.types';

/** 200 MB cubre con holgura un CSV de 400.000 pacientes. */
const MAX_BYTES = 200 * 1024 * 1024;
const EXTENSIONES = ['.csv', '.txt'];
export const DIR_SUBIDAS = process.env.DIR_SUBIDAS ?? 'uploads';

@Controller('carga')
@Roles('admin')
export class CargaController {
  constructor(private readonly cola: CargaCola) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('archivo', {
      // Fuera del webroot y con nombre generado: nada del nombre original llega al disco.
      storage: diskStorage({
        destination: DIR_SUBIDAS,
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
      }),
      limits: { fileSize: MAX_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!EXTENSIONES.includes(ext)) {
          return cb(new BadRequestException(`Extensión no permitida. Use: ${EXTENSIONES.join(', ')}`), false);
        }
        cb(null, true);
      },
    }),
  )
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
